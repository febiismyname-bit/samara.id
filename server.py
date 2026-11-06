import sys
import getpass
import base64
import binascii
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import shutil
import sqlite3
import time
from contextlib import contextmanager
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("SMARTWARGA_DATA_DIR", APP_DIR.parent / "smartwarga-data")).resolve()
DATABASE_PATH = DATA_DIR / "smartwarga.sqlite3"
LEGACY_DATABASE_PATH = APP_DIR / "smartwarga.sqlite3"
HOST = "127.0.0.1"
PORT = 8000
MAX_REQUEST_BYTES = 3 * 1024 * 1024
MAX_IMAGE_BYTES = 2 * 1024 * 1024
LOGIN_RATE_LIMIT = 5
LOGIN_RATE_WINDOW_SECONDS = 900
TRACK_RATE_LIMIT = 20
TRACK_RATE_WINDOW_SECONDS = 60
SESSION_TTL_SECONDS = 28800
MAX_SESSION_ENTRIES = 1000
MAX_RATE_LIMIT_ENTRIES = 1000
PASSWORD_ITERATIONS = 310_000
PASSWORD_MIN_LENGTH = 12
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}", f"[::1]:{PORT}"}
STATUSES = {"Diterima", "Diproses", "Selesai"}
CATEGORIES = {
    "Jalan Rusak",
    "Lampu Mati",
    "Drainase",
    "Taman",
    "Sampah",
    "Lainnya",
}
BOUNDS = {"north": -5.35, "south": -5.60, "east": 105.38, "west": 105.15}
SESSIONS = {}
LOGIN_ATTEMPTS = {}
TRACK_ATTEMPTS = {}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def prune_attempts(store, window_seconds):
    now = time.monotonic()
    for key, attempts in list(store.items()):
        recent = [attempt for attempt in attempts if now - attempt < window_seconds]
        if recent:
            store[key] = recent
        else:
            store.pop(key, None)
    while len(store) > MAX_RATE_LIMIT_ENTRIES:
        store.pop(next(iter(store)))


def prune_sessions():
    now = time.time()
    expired = [token for token, expires_at in SESSIONS.items() if expires_at <= now]
    for token in expired:
        SESSIONS.pop(token, None)
    while len(SESSIONS) > MAX_SESSION_ENTRIES:
        SESSIONS.pop(next(iter(SESSIONS)))


def create_session():
    prune_sessions()
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = time.time() + SESSION_TTL_SECONDS
    return token


def is_admin_session(session):
    prune_sessions()
    if not session:
        return False
    expires_at = SESSIONS.get(session)
    if not expires_at:
        return False
    if expires_at <= time.time():
        SESSIONS.pop(session, None)
        return False
    return True


@contextmanager
def connect_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATABASE_PATH.exists() and LEGACY_DATABASE_PATH.exists():
        shutil.copy2(LEGACY_DATABASE_PATH, DATABASE_PATH)
        logging.info("Database lama dipindahkan ke direktori data di luar root web.")
    with connect_database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nama TEXT NOT NULL,
                email TEXT NOT NULL,
                kategori TEXT NOT NULL,
                alamat TEXT NOT NULL,
                deskripsi TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('Diterima', 'Diproses', 'Selesai')),
                tanggal TEXT NOT NULL,
                foto BLOB,
                foto_mime TEXT
            )
            """
        )
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(reports)").fetchall()
        }
        if "foto" not in columns:
            connection.execute("ALTER TABLE reports ADD COLUMN foto BLOB")
        if "foto_mime" not in columns:
            connection.execute("ALTER TABLE reports ADD COLUMN foto_mime TEXT")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_credentials (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                salt BLOB NOT NULL,
                password_hash BLOB NOT NULL
            )
            """
        )


def prompt_new_admin_password():
    while True:
        password = getpass.getpass("Kata sandi admin baru: ")
        if len(password) < PASSWORD_MIN_LENGTH:
            print(f"Kata sandi minimal {PASSWORD_MIN_LENGTH} karakter.")
            continue
        confirmation = getpass.getpass("Ulangi kata sandi admin: ")
        if not hmac.compare_digest(password, confirmation):
            print("Kata sandi tidak sama. Silakan coba lagi.")
            continue
        salt = secrets.token_bytes(16)
        password_hash = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
        )
        return salt, password_hash


def ensure_admin_password():
    with connect_database() as connection:
        configured = connection.execute(
            "SELECT 1 FROM admin_credentials WHERE id = 1"
        ).fetchone()
    if configured:
        return

    print("Pengaturan awal SAMARA: buat kata sandi admin (minimal 12 karakter).")
    salt, password_hash = prompt_new_admin_password()
    with connect_database() as connection:
        connection.execute(
            "INSERT INTO admin_credentials (id, salt, password_hash) VALUES (1, ?, ?)",
            (salt, password_hash),
        )
    print("Kredensial admin tersimpan secara aman di database lokal.")


def reset_admin_password():
    print("Ganti kata sandi admin SAMARA (minimal 12 karakter).")
    salt, password_hash = prompt_new_admin_password()
    with connect_database() as connection:
        cursor = connection.execute(
            "UPDATE admin_credentials SET salt = ?, password_hash = ? WHERE id = 1",
            (salt, password_hash),
        )
        if cursor.rowcount == 0:
            connection.execute(
                "INSERT INTO admin_credentials (id, salt, password_hash) VALUES (1, ?, ?)",
                (salt, password_hash),
            )
    print("Kata sandi admin berhasil diubah.")


def security_headers():
    content = ("default-src 'self'; "
               "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com "
               "https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; "
               "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.tailwindcss.com; "
               "font-src 'self' https://fonts.gstatic.com; "
               "img-src 'self' data: blob: https://img.icons8.com https://*.tile.openstreetmap.org https://unpkg.com; "
               "connect-src 'self' https://nominatim.openstreetmap.org https://api.open-meteo.com https://generativelanguage.googleapis.com; "
               "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
    return {
        "Content-Security-Policy": content,
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
        "Cross-Origin-Opener-Policy": "same-origin",
    }


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class SmartWargaHandler(BaseHTTPRequestHandler):
    server_version = "SAMARA"

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, format_string, *args):
        logging.info("%s - %s", self.address_string(), urlparse(self.path).path)

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in security_headers().items():
            self.send_header(name, value)
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip()
        if content_type != "application/json":
            raise ApiError(415, "Permintaan harus menggunakan JSON.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ApiError(400, "Ukuran permintaan tidak valid.") from error
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ApiError(413, "Ukuran data permintaan tidak valid.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ApiError(400, "Format JSON tidak valid.") from error
        if not isinstance(payload, dict):
            raise ApiError(400, "Format data permintaan tidak valid.")
        return payload

    def require_same_origin(self):
        host = self.headers.get("Host", "")
        if host not in ALLOWED_HOSTS:
            raise ApiError(403, "Host tidak diizinkan.")
        origin = self.headers.get("Origin")
        if not origin:
            raise ApiError(403, "Permintaan lintas situs ditolak.")
        parsed_origin = urlparse(origin)
        if parsed_origin.scheme not in {"http", "https"} or parsed_origin.netloc != host:
            raise ApiError(403, "Permintaan lintas situs ditolak.")

    def session_id(self):
        for item in self.headers.get("Cookie", "").split(";"):
            name, separator, value = item.strip().partition("=")
            if separator and name == "smartwarga_session":
                return value
        return None

    def require_admin(self):
        session = self.session_id()
        if not is_admin_session(session):
            raise ApiError(401, "Silakan masuk sebagai admin terlebih dahulu.")

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/auth/session":
                self.send_json(200, {"authenticated": is_admin_session(self.session_id())})
            elif parsed.path == "/api/stats":
                self.get_stats()
            elif parsed.path == "/api/public/track":
                self.track_report(parse_qs(parsed.query))
            elif parsed.path == "/api/public/map":
                self.get_public_map_reports()
            elif parsed.path == "/api/reports/map":
                self.require_admin()
                self.get_map_reports()
            elif parsed.path == "/api/reports/lookup":
                self.require_admin()
                self.lookup_reports(parse_qs(parsed.query).get("q", [""])[0])
            elif re.fullmatch(r"/api/reports/\d+/photo", parsed.path):
                self.require_admin()
                self.get_report_photo(parsed.path)
            elif parsed.path == "/api/reports":
                self.require_admin()
                self.get_reports()
            elif parsed.path.startswith("/api/"):
                raise ApiError(404, "Endpoint tidak ditemukan.")
            else:
                self.serve_static(parsed.path)
        except ApiError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.Error:
            logging.exception("Kesalahan database saat memproses GET %s", urlparse(self.path).path)
            self.send_json(500, {"error": "Database tidak dapat memproses permintaan."})
        except Exception:
            logging.exception("Kesalahan internal saat memproses GET %s", urlparse(self.path).path)
            self.send_json(500, {"error": "Terjadi kesalahan internal."})

    def do_POST(self):
        try:
            self.require_same_origin()
            parsed = urlparse(self.path)
            if parsed.path == "/api/auth/login":
                self.login()
            elif parsed.path == "/api/auth/logout":
                session = self.session_id()
                if session:
                    SESSIONS.pop(session, None)
                self.send_json(
                    200,
                    {"ok": True},
                    {"Set-Cookie": "smartwarga_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"},
                )
            elif parsed.path == "/api/reports":
                self.create_report()
            else:
                raise ApiError(404, "Endpoint tidak ditemukan.")
        except ApiError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.Error:
            logging.exception("Kesalahan database saat memproses POST %s", urlparse(self.path).path)
            self.send_json(500, {"error": "Database tidak dapat menyimpan permintaan."})
        except Exception:
            logging.exception("Kesalahan internal saat memproses POST %s", urlparse(self.path).path)
            self.send_json(500, {"error": "Terjadi kesalahan internal."})

    def do_PATCH(self):
        try:
            self.require_same_origin()
            self.require_admin()
            match = re.fullmatch(r"/api/reports/(\d+)", urlparse(self.path).path)
            if not match:
                raise ApiError(404, "Laporan tidak ditemukan.")
            payload = self.read_json()
            status = payload.get("status")
            if not isinstance(status, str) or status not in STATUSES:
                raise ApiError(400, "Status laporan tidak valid.")
            with connect_database() as connection:
                cursor = connection.execute(
                    "UPDATE reports SET status = ? WHERE id = ?", (status, int(match.group(1)))
                )
            if cursor.rowcount == 0:
                raise ApiError(404, "Laporan tidak ditemukan.")
            self.send_json(200, {"ok": True})
        except ApiError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.Error:
            logging.exception("Kesalahan database saat memperbarui laporan %s", urlparse(self.path).path)
            self.send_json(500, {"error": "Database tidak dapat memperbarui laporan."})
        except Exception:
            logging.exception("Kesalahan internal saat memperbarui laporan %s", urlparse(self.path).path)
            self.send_json(500, {"error": "Terjadi kesalahan internal."})

    def do_DELETE(self):
        try:
            self.require_same_origin()
            self.require_admin()
            match = re.fullmatch(r"/api/reports/(\d+)", urlparse(self.path).path)
            if not match:
                raise ApiError(404, "Laporan tidak ditemukan.")
            with connect_database() as connection:
                cursor = connection.execute(
                    "DELETE FROM reports WHERE id = ?", (int(match.group(1)),)
                )
            if cursor.rowcount == 0:
                raise ApiError(404, "Laporan tidak ditemukan.")
            self.send_json(200, {"ok": True})
        except ApiError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.Error:
            logging.exception("Kesalahan database saat menghapus laporan %s", urlparse(self.path).path)
            self.send_json(500, {"error": "Database tidak dapat menghapus laporan."})
        except Exception:
            logging.exception("Kesalahan internal saat menghapus laporan %s", urlparse(self.path).path)
            self.send_json(500, {"error": "Terjadi kesalahan internal."})

    def login(self):
        client = self.client_address[0]
        now = time.monotonic()
        prune_attempts(LOGIN_ATTEMPTS, LOGIN_RATE_WINDOW_SECONDS)
        attempts = LOGIN_ATTEMPTS.get(client, [])
        if len(attempts) >= LOGIN_RATE_LIMIT:
            raise ApiError(429, "Terlalu banyak percobaan. Coba lagi dalam 15 menit.")

        payload = self.read_json()
        password = payload.get("password")
        if not isinstance(password, str) or len(password) > 1024:
            raise ApiError(400, "Kata sandi tidak valid.")
        with connect_database() as connection:
            credentials = connection.execute(
                "SELECT salt, password_hash FROM admin_credentials WHERE id = 1"
            ).fetchone()
        if credentials is None:
            logging.error("Kredensial admin belum tersedia di database.")
            raise ApiError(503, "Kredensial admin belum tersedia. Jalankan pengaturan awal server.")
        candidate = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            credentials["salt"],
            PASSWORD_ITERATIONS,
        )
        if not hmac.compare_digest(candidate, credentials["password_hash"]):
            attempts.append(now)
            LOGIN_ATTEMPTS[client] = attempts
            raise ApiError(401, "Kata sandi admin salah.")

        LOGIN_ATTEMPTS.pop(client, None)
        session = create_session()
        self.send_json(
            200,
            {"ok": True},
            {
                "Set-Cookie": (
                    f"smartwarga_session={session}; HttpOnly; SameSite=Strict; "
                    f"Path=/; Max-Age={SESSION_TTL_SECONDS}"
                )
            },
        )

    def create_report(self):
        payload = self.read_json()
        fields = {}
        limits = {"nama": 120, "email": 254, "kategori": 40, "alamat": 300, "deskripsi": 5000}
        for key, maximum in limits.items():
            value = payload.get(key)
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
                raise ApiError(400, f"Isian {key} wajib diisi dan maksimal {maximum} karakter.")
            fields[key] = value.strip()
        if fields["kategori"] not in CATEGORIES:
            raise ApiError(400, "Kategori laporan tidak valid.")
        email = fields["email"]
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ApiError(400, "Format email tidak valid.")

        try:
            lat = float(payload.get("lat"))
            lng = float(payload.get("lng"))
        except (TypeError, ValueError):
            raise ApiError(400, "Titik lokasi laporan tidak valid.")
        if not math.isfinite(lat) or not math.isfinite(lng):
            raise ApiError(400, "Titik lokasi laporan tidak valid.")
        if not (BOUNDS["south"] <= lat <= BOUNDS["north"] and BOUNDS["west"] <= lng <= BOUNDS["east"]):
            raise ApiError(400, "Lokasi laporan harus berada di wilayah Bandar Lampung.")

        photo_data = payload.get("foto")
        photo = None
        photo_mime = None
        if photo_data is not None:
            if not isinstance(photo_data, str):
                raise ApiError(400, "Format foto bukti tidak valid.")
            match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})", photo_data)
            if not match:
                raise ApiError(400, "Foto bukti harus berupa JPG atau PNG yang valid.")
            photo_mime = f"image/{match.group(1)}"
            try:
                photo = base64.b64decode(match.group(2), validate=True)
            except (binascii.Error, ValueError) as error:
                raise ApiError(400, "Isi foto bukti tidak valid.") from error
            if not photo or len(photo) > MAX_IMAGE_BYTES:
                raise ApiError(400, "Ukuran foto maksimal 2 MB.")
            if photo_mime == "image/png" and not photo.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ApiError(400, "Isi foto PNG tidak valid.")
            if photo_mime == "image/jpeg" and not photo.startswith(b"\xff\xd8\xff"):
                raise ApiError(400, "Isi foto JPG tidak valid.")

        with connect_database() as connection:
            cursor = connection.execute(
                """
                INSERT INTO reports (nama, email, kategori, alamat, deskripsi, lat, lng, status, tanggal, foto, foto_mime)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Diterima', ?, ?, ?)
                """,
                (
                    fields["nama"],
                    email,
                    fields["kategori"],
                    fields["alamat"],
                    fields["deskripsi"],
                    lat,
                    lng,
                    date.today().isoformat(),
                    photo,
                    photo_mime,
                ),
            )
        self.send_json(201, {"id": cursor.lastrowid})

    def get_reports(self):
        with connect_database() as connection:
            rows = connection.execute(
                "SELECT id, nama, email, kategori, alamat, deskripsi, lat, lng, status, tanggal, "
                "(foto IS NOT NULL) AS has_foto "
                "FROM reports ORDER BY id DESC LIMIT 500"
            ).fetchall()
        self.send_json(200, {"reports": [dict(row) for row in rows]})

    def get_report_photo(self, path):
        report_id = int(re.fullmatch(r"/api/reports/(\d+)/photo", path).group(1))
        with connect_database() as connection:
            row = connection.execute(
                "SELECT foto, foto_mime FROM reports WHERE id = ?", (report_id,)
            ).fetchone()
        if not row or row["foto"] is None:
            raise ApiError(404, "Foto bukti tidak ditemukan.")
        data_url = f"{row['foto_mime']};base64,{base64.b64encode(row['foto']).decode('ascii')}"
        self.send_json(200, {"dataUrl": f"data:{data_url}"})

    def get_map_reports(self):
        with connect_database() as connection:
            rows = connection.execute(
                "SELECT id, kategori, alamat, lat, lng, status FROM reports ORDER BY id DESC LIMIT 1000"
            ).fetchall()
        self.send_json(200, {"reports": [dict(row) for row in rows]})

    def get_public_map_reports(self):
        with connect_database() as connection:
            rows = connection.execute(
                "SELECT id, kategori, lat, lng, status FROM reports ORDER BY id DESC LIMIT 1000"
            ).fetchall()
        self.send_json(200, {"reports": [dict(row) for row in rows]})

    def track_report(self, query_params):
        client = self.client_address[0]
        prune_attempts(TRACK_ATTEMPTS, TRACK_RATE_WINDOW_SECONDS)
        attempts = TRACK_ATTEMPTS.get(client, [])
        if len(attempts) >= TRACK_RATE_LIMIT:
            raise ApiError(429, "Terlalu banyak percobaan pelacakan. Coba lagi sebentar.")

        report_id = query_params.get("id", [""])[0].strip()
        email = query_params.get("email", [""])[0].strip()
        if not report_id.isdigit():
            raise ApiError(400, "ID Laporan harus berupa angka.")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ApiError(400, "Format email tidak valid.")

        attempts.append(time.monotonic())
        TRACK_ATTEMPTS[client] = attempts
        with connect_database() as connection:
            row = connection.execute(
                "SELECT id, kategori, status, tanggal FROM reports WHERE id = ? AND lower(email) = lower(?)",
                (int(report_id), email),
            ).fetchone()
        if not row:
            raise ApiError(404, "Laporan tidak ditemukan. Periksa kembali ID Laporan dan email.")
        self.send_json(200, {"report": dict(row)})

    def get_stats(self):
        with connect_database() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total,
                       COUNT(DISTINCT lower(email)) AS warga,
                       COALESCE(SUM(CASE WHEN status = 'Selesai' THEN 1 ELSE 0 END), 0) AS selesai,
                       COALESCE(SUM(CASE WHEN status = 'Diproses' THEN 1 ELSE 0 END), 0) AS diproses
                FROM reports
                """
            ).fetchone()
        self.send_json(
            200,
            {
                "total": row["total"],
                "warga": row["warga"],
                "selesai": row["selesai"],
                "diproses": row["diproses"],
            },
        )

    def lookup_reports(self, query):
        query = query.strip()
        if not query or len(query) > 254:
            raise ApiError(400, "Masukkan ID laporan atau email yang valid.")
        with connect_database() as connection:
            if query.isdigit():
                report_id = int(query)
                if report_id > 9_223_372_036_854_775_807:
                    rows = []
                else:
                    rows = connection.execute(
                        "SELECT id, kategori, alamat, deskripsi, status, tanggal FROM reports WHERE id = ?",
                        (report_id,),
                    ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT id, kategori, alamat, deskripsi, status, tanggal FROM reports
                    WHERE lower(email) = lower(?) ORDER BY id DESC
                    """,
                    (query,),
                ).fetchall()
        self.send_json(200, {"reports": [dict(row) for row in rows]})

    def serve_static(self, request_path):
        relative = unquote(request_path).lstrip("/") or "index.html"
        candidate = (APP_DIR / relative).resolve()
        if APP_DIR not in candidate.parents and candidate != APP_DIR:
            raise ApiError(404, "Halaman tidak ditemukan.")
        if not candidate.is_file() or candidate.suffix.lower() not in {
            ".html",
            ".css",
            ".js",
            ".jpe",
            ".jpg",
            ".jpeg",
            ".png",
        }:
            raise ApiError(404, "Halaman tidak ditemukan.")
        content = candidate.read_bytes()
        content_type = "text/html; charset=utf-8"
        if candidate.suffix.lower() == ".css":
            content_type = "text/css; charset=utf-8"
        elif candidate.suffix.lower() == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif candidate.suffix.lower() in {".jpe", ".jpg", ".jpeg"}:
            content_type = "image/jpeg"
        elif candidate.suffix.lower() == ".png":
            content_type = "image/png"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache" if candidate.suffix.lower() in {".html", ".css", ".js"} else "public, max-age=3600")
        for name, value in security_headers().items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    initialize_database()
    if "--reset-admin-password" in sys.argv:
        reset_admin_password()
        sys.exit(0)
    ensure_admin_password()
    httpd = ThreadingHTTPServer((HOST, PORT), SmartWargaHandler)
    print(f"SAMARA berjalan di http://{HOST}:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer SAMARA dihentikan.")