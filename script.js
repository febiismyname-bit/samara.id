const REPORTS_STORAGE_KEY = 'smartwarga.reports';
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const LOGIN_ENDPOINT = '/api/auth/login';
const SESSION_ENDPOINT = '/api/auth/session';
let lastNominatimRequestAt = 0;
let nominatimRequestQueue = Promise.resolve();
let adminSession = false;

function requestNominatim(url) {
    const request = nominatimRequestQueue.then(async function() {
        const wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimRequestAt);
        if (wait > 0) {
            await new Promise(resolve => setTimeout(resolve, wait));
        }
        lastNominatimRequestAt = Date.now();
        return fetch(url);
    });
    nominatimRequestQueue = request.then(() => undefined, () => undefined);
    return request;
}

function getStoredReports() {
    const stored = localStorage.getItem(REPORTS_STORAGE_KEY);
    if (stored === null) return [];
    try {
        const reports = JSON.parse(stored);
        if (!Array.isArray(reports)) throw new Error('Data laporan lokal tidak valid.');
        return reports.filter(item => item && typeof item === 'object' && !Array.isArray(item));
    } catch (error) {
        console.error('Data laporan lokal tidak dapat dibaca:', error);
        throw new Error('Data laporan lokal tidak valid atau rusak.');
    }
}

function saveLocalReport(report) {
    const reports = getStoredReports();
    const requestedId = Number(report.id);
    const id = Number.isInteger(requestedId) && requestedId > 0
        ? requestedId
        : reports.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
    const today = new Date();
    const tanggal = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0')
    ].join('-');
    reports.unshift({
        ...report,
        id,
        status: 'Diterima',
        tanggal,
        has_foto: Boolean(report.foto)
    });
    if (!saveStoredReports(reports)) {
        throw new Error('Laporan tidak dapat disimpan: penyimpanan browser penuh atau tidak tersedia.');
    }
    return { id };
}

function saveStoredReports(reports) {
    try {
        localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
        return true;
    } catch (error) {
        console.error('Penyimpanan lokal SAMARA gagal:', error);
        showRequestError(new Error('Perubahan tidak dapat disimpan: penyimpanan browser penuh atau tidak tersedia.'));
        return false;
    }
}

async function saveServerReport(report) {
    const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nama: report.nama,
            email: report.email,
            kategori: report.kategori,
            alamat: report.alamat,
            deskripsi: report.deskripsi,
            lat: report.lat,
            lng: report.lng,
            foto: report.foto || null
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Laporan gagal dikirim ke server (HTTP ${response.status}).`);
    }
    return result;
}

function escapeHtml(value) {
    const entities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return String(value).replace(/[&<>"']/g, character => entities[character]);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', () => reject(reader.error || new Error('Foto tidak dapat dibaca.')));
        reader.readAsDataURL(file);
    });
}

function showRequestError(error) {
    console.error('Penyimpanan lokal SAMARA gagal:', error);
    const notice = document.getElementById('apiErrorNotice');
    const message = document.getElementById('apiErrorMessage');
    if (!notice || !message) return;

    message.textContent = error.message || 'Data laporan lokal tidak dapat diakses. Silakan coba lagi.';
    notice.hidden = false;
}

const BANDAR_LAMPUNG_CENTER = { lat: -5.4290, lng: 105.2620 };
const BANDAR_LAMPUNG_BOUNDS = {
    north: -5.35,
    south: -5.60,
    east: 105.38,
    west: 105.15
};

function isWithinBandarLampung(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= BANDAR_LAMPUNG_BOUNDS.south && lat <= BANDAR_LAMPUNG_BOUNDS.north &&
        lng >= BANDAR_LAMPUNG_BOUNDS.west && lng <= BANDAR_LAMPUNG_BOUNDS.east;
}

const WEATHER_CODES = {
    0: { description: 'Cerah', icon: '☀️' },
    1: { description: 'Cerah berawan', icon: '🌤️' },
    2: { description: 'Berawan sebagian', icon: '⛅' },
    3: { description: 'Mendung', icon: '☁️' },
    45: { description: 'Berkabut', icon: '🌫️' },
    48: { description: 'Berkabut tebal', icon: '🌫️' },
    51: { description: 'Gerimis ringan', icon: '🌦️' },
    53: { description: 'Gerimis', icon: '🌦️' },
    55: { description: 'Gerimis lebat', icon: '🌧️' },
    56: { description: 'Gerimis beku ringan', icon: '🌧️' },
    57: { description: 'Gerimis beku lebat', icon: '🌧️' },
    61: { description: 'Hujan ringan', icon: '🌦️' },
    63: { description: 'Hujan sedang', icon: '🌧️' },
    65: { description: 'Hujan lebat', icon: '🌧️' },
    66: { description: 'Hujan beku ringan', icon: '🌧️' },
    67: { description: 'Hujan beku lebat', icon: '🌧️' },
    71: { description: 'Salju ringan', icon: '🌨️' },
    73: { description: 'Salju sedang', icon: '🌨️' },
    75: { description: 'Salju lebat', icon: '❄️' },
    77: { description: 'Butiran salju', icon: '❄️' },
    80: { description: 'Hujan lokal ringan', icon: '🌦️' },
    81: { description: 'Hujan lokal sedang', icon: '🌧️' },
    82: { description: 'Hujan lokal lebat', icon: '🌧️' },
    85: { description: 'Hujan salju ringan', icon: '🌨️' },
    86: { description: 'Hujan salju lebat', icon: '🌨️' },
    95: { description: 'Badai petir', icon: '⛈️' },
    96: { description: 'Badai petir dengan hujan es ringan', icon: '⛈️' },
    99: { description: 'Badai petir dengan hujan es lebat', icon: '⛈️' }
};

function initWeatherWidget() {
    const trigger = document.getElementById('btnCuaca');
    const modal = document.getElementById('weatherModal');
    const content = document.getElementById('weatherContent');
    const refreshButton = document.getElementById('btnMuatCuaca');
    const locationButton = document.getElementById('btnCuacaLokasi');
    const districtSelect = document.getElementById('weatherDistrict');
    const title = document.getElementById('weatherTitle');
    const closeButton = document.getElementById('btnTutupCuaca');
    if (!trigger || !modal || !content || !refreshButton || !locationButton || !title || !closeButton) return;

    function closeModal() {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        trigger.focus();
    }

    function showMessage(message) {
        const paragraph = document.createElement('p');
        paragraph.textContent = message;
        content.replaceChildren(paragraph);
    }

    function addWeatherDetail(container, label, value) {
        const detail = document.createElement('div');
        detail.className = 'weather-detail';
        detail.append(document.createTextNode(label));
        const strong = document.createElement('strong');
        strong.textContent = value;
        detail.append(strong);
        container.append(detail);
    }

    function getSelectedDistrict() {
        if (!districtSelect) return { location: BANDAR_LAMPUNG_CENTER, label: 'Bandar Lampung' };
        const option = districtSelect.options[districtSelect.selectedIndex];
        const lat = parseFloat(option.dataset.lat);
        const lng = parseFloat(option.dataset.lng);
        const label = option.textContent.trim();
        return { location: { lat, lng }, label };
    }

    async function loadWeather(location, locationLabel) {
        if (!location || !locationLabel) {
            const selected = getSelectedDistrict();
            location = selected.location;
            locationLabel = selected.label;
        }
        refreshButton.disabled = true;
        refreshButton.textContent = 'Memuat...';
        locationButton.disabled = true;
        title.textContent = locationLabel;
        showMessage(`Mengambil data cuaca ${locationLabel}...`);

        const params = new URLSearchParams({
            latitude: String(location.lat),
            longitude: String(location.lng),
            current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
            timezone: 'Asia/Jakarta'
        });

        try {
            const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
            if (!response.ok) throw new Error(`Layanan cuaca merespons HTTP ${response.status}.`);

            const data = await response.json();
            const current = data.current;
            if (!current || !Number.isFinite(current.temperature_2m) ||
                !Number.isFinite(current.weather_code)) {
                throw new Error('Data cuaca yang diterima tidak lengkap.');
            }

            const weather = WEATHER_CODES[current.weather_code] || {
                description: 'Kondisi cuaca tidak diketahui',
                icon: '🌡️'
            };
            const icon = document.createElement('div');
            icon.className = 'weather-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = weather.icon;

            const temperature = document.createElement('div');
            temperature.className = 'weather-temperature';
            temperature.textContent = `${Math.round(current.temperature_2m)}°C`;

            const description = document.createElement('div');
            description.className = 'weather-description';
            description.textContent = weather.description;

            const details = document.createElement('div');
            details.className = 'weather-details';
            addWeatherDetail(details, 'Terasa seperti', `${Math.round(current.apparent_temperature)}°C`);
            addWeatherDetail(details, 'Kelembapan', `${current.relative_humidity_2m}%`);
            addWeatherDetail(details, 'Angin', `${current.wind_speed_10m} km/jam`);

            const observedAt = document.createElement('small');
            observedAt.textContent = `Data: ${new Date(current.time).toLocaleString('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Jakarta'
            })}`;

            content.replaceChildren(icon, temperature, description, details, observedAt);
        } catch (error) {
            console.error(`Gagal memuat cuaca ${locationLabel}:`, error);
            showMessage(`Cuaca ${locationLabel} tidak dapat dimuat (${error.message}). Periksa koneksi internet lalu coba lagi.`);
        } finally {
            refreshButton.disabled = false;
            refreshButton.textContent = 'Muat Ulang Cuaca';
            locationButton.disabled = false;
        }
    }

    async function loadWeatherAtCurrentLocation() {
        if (!navigator.geolocation) {
            showMessage('Browser tidak mendukung geolokasi. Cuaca Bandar Lampung tetap tersedia.');
            return;
        }

        locationButton.disabled = true;
        showMessage('Meminta izin lokasi perangkat...');
        navigator.geolocation.getCurrentPosition(async function(position) {
            const location = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            let locationLabel = `Lokasi Anda (${location.lat.toFixed(3)}, ${location.lng.toFixed(3)})`;

            try {
                const params = new URLSearchParams({
                    format: 'jsonv2',
                    lat: String(location.lat),
                    lon: String(location.lng),
                    zoom: '14',
                    addressdetails: '1'
                });
                const response = await requestNominatim(`https://nominatim.openstreetmap.org/reverse?${params}`);
                if (!response.ok) {
                    throw new Error(`Layanan lokasi merespons HTTP ${response.status}.`);
                }
                const result = await response.json();
                const address = result.address || {};
                const nearbyArea = address.city_district || address.suburb || address.neighbourhood ||
                    address.village || address.town || address.city;
                if (nearbyArea) locationLabel = nearbyArea;
            } catch (error) {
                console.warn('Nama kecamatan tidak dapat ditemukan:', error);
            }

            await loadWeather(location, locationLabel);
        }, function(error) {
            locationButton.disabled = false;
            const message = error.code === error.PERMISSION_DENIED
                ? 'Izin lokasi ditolak. Izinkan akses lokasi atau muat cuaca Bandar Lampung.'
                : 'Lokasi perangkat tidak dapat ditemukan. Muat cuaca Bandar Lampung sebagai gantinya.';
            showMessage(message);
        }, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000
        });
    }

    trigger.addEventListener('click', function() {
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        refreshButton.focus();
        loadWeather();
    });
    refreshButton.addEventListener('click', function() { loadWeather(); });
    if (districtSelect) {
        districtSelect.addEventListener('change', function() { loadWeather(); });
    }
    locationButton.addEventListener('click', loadWeatherAtCurrentLocation);
    closeButton.addEventListener('click', closeModal);
    modal.addEventListener('click', event => {
        if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !modal.hidden) closeModal();
    });
}

function initChatbot() {
    const launcher = document.getElementById('chatLauncher');
    const panel = document.getElementById('chatPanel');
    const closeButton = document.getElementById('chatClose');
    const form = document.getElementById('chatForm');
    const input = document.getElementById('chatInput');
    const sendButton = document.getElementById('chatSend');
    const messagesContainer = document.getElementById('chatMessages');
    const suggestions = document.getElementById('chatSuggestions');
    if (!launcher || !panel || !closeButton || !form || !input || !sendButton || !messagesContainer) return;

    function getCategorySuggestion(query) {
        const rules = [
            { category: 'Jalan Rusak', keywords: ['jalan rusak', 'lubang', 'jalan berlubang', 'permukaan jalan', 'retak', 'aspal', 'berlubang', 'jalan berlubang'] },
            { category: 'Lampu Penerangan Mati', keywords: ['lampu mati', 'lampu rusak', 'lampu penerangan', 'penerangan jalan', 'gelap', 'lampu jalan'] },
            { category: 'Drainase Tersumbat', keywords: ['drainase', 'saluran air', 'banjir', 'genangan', 'tersumbat', 'got', 'parit'] },
            { category: 'Penumpukan Sampah', keywords: ['sampah', 'membuang sampah', 'tempat sampah', 'tumpukan sampah', 'sampah berserakan'] },
            { category: 'Taman/Fasilitas Umum Rusak', keywords: ['taman', 'fasilitas umum', 'bangku', 'gazebo', 'trotoar', 'rusak', 'reklame', 'jembatan', 'pagar'] },
            { category: 'Kebersihan Lingkungan', keywords: ['kebersihan', 'lingkungan', 'kumuh', 'bau', 'kotor', 'dedaunan'] },
            { category: 'Keamanan & Sosial', keywords: ['keamanan', 'mencurigakan', 'ancaman', 'pencurian', 'pengamen', 'mencari', 'amankan'] },
            { category: 'Air & Sanitasi', keywords: ['air', 'keran', 'kran', 'sanitasi', 'wc umum', 'mck', 'sumber air', 'air bersih'] }
        ];

        const normalized = query.toLowerCase();
        return rules.find(rule => rule.keywords.some(keyword => normalized.includes(keyword))) || null;
    }

    function findReportFromQuery(query) {
        const reports = getStoredReports();
        const idMatch = query.match(/(?:laporan|pengaduan|id)\s*(?:nomor\s*)?(?:#)?(\d+)/i);
        if (idMatch) {
            const id = Number(idMatch[1]);
            return reports.find(report => Number(report.id) === id) || null;
        }

        const emailMatch = query.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
        if (emailMatch) {
            const email = emailMatch[0].toLowerCase();
            return reports.find(report => String(report.email || '').toLowerCase() === email) || null;
        }

        return null;
    }

    function answerQuestion(text) {
        const query = String(text).toLowerCase();

        if (/(darurat|bahaya|kebakaran|kecelakaan|korban|pingsan|sesak)/.test(query)) {
            return 'Jika kondisi berbahaya atau ada korban, segera hubungi 112 atau layanan darurat terdekat. SAMARA dipakai untuk melaporkan fasilitas publik, bukan untuk menggantikan layanan darurat.';
        }

        const categorySuggestion = getCategorySuggestion(query);
        if ((query.includes('kategori') || query.includes('jenis kerusakan') || query.includes('pilih kategori') || query.includes('kategori laporan') || query.includes('sesuai dengan')) && categorySuggestion) {
            return `Berdasarkan masalah yang Anda deskripsikan, kategori paling sesuai adalah "${categorySuggestion.category}". Alasan: ${categorySuggestion.keywords[0]} merupakan indikator yang paling dekat dengan keluhan tersebut. Anda bisa memilih kategori ini saat mengisi form laporan agar petugas lebih cepat memahami prioritas penanganan.`;
        }

        if (query.includes('proses pengaduan') || query.includes('alur pengaduan') || query.includes('cara pengaduan') || query.includes('langkah pengaduan')) {
            return 'Proses pengaduan di SAMARA biasanya berjalan seperti ini: 1) warga melaporkan masalah melalui formulir; 2) sistem mengumpulkan lokasi, foto, dan kategori; 3) admin/RT/RW memeriksa kelengkapan data; 4) laporan diproses dan status diperbarui ke Diterima, Diproses, atau Selesai; 5) warga dapat mengecek status lewat bagian Lacak. Semakin jelas lokasi dan foto, semakin cepat penanganan.';
        }

        if (query.includes('cek status') || query.includes('status laporan') || query.includes('status pengaduan') || query.includes('lacak') || query.includes('cek laporan')) {
            const report = findReportFromQuery(query);
            if (report) {
                return `Status laporan #${report.id} saat ini adalah "${report.status || 'Diterima'}". Kategori: ${report.kategori || 'Belum diisi'}. Tanggal: ${report.tanggal || 'Belum tercatat'}. Jika status masih Diterima, artinya laporan masuk dan menunggu verifikasi. Jika Diproses, petugas sedang menindaklanjuti. Jika Selesai, penanganan sudah selesai.`;
            }
            return 'Untuk mengecek status, buka menu Lacak dan masukkan ID laporan atau email yang digunakan saat membuat laporan. Jika Anda sudah punya ID laporan, misalnya “cek status laporan 12”, saya bisa membantunya jika data laporan ada di browser ini.';
        }

        if (query.includes('buat laporan') || query.includes('cara lapor') || query.includes('laporkan') || query.includes('membuat laporan')) {
            return 'Cara membuat laporan: buka bagian Lapor, isi nama, email, kategori kerusakan, alamat lengkap, dan deskripsi singkat. Cari alamat di peta atau tandai titik secara manual, pastikan pin berada di Bandar Lampung, lalu kirim. Sertakan titik acuan yang jelas, misalnya nama jalan, nomor, gedung, atau ciri lokasi. Simpan ID Laporan yang muncul setelah berhasil dikirim.';
        }
        if (query.includes('foto') || query.includes('gambar') || query.includes('bukti')) {
            return 'Foto bukti sebaiknya jelas, menampilkan kerusakan/objek utama, dan diambil dari sudut yang mudah dipahami petugas. Gunakan format JPG atau PNG dengan ukuran maksimal 2 MB. Usahakan tidak menampilkan data pribadi, wajah orang, plat nomor, atau dokumen sensitif jika tidak diperlukan.';
        }
        if (query.includes('lokasi') || query.includes('peta') || query.includes('alamat') || query.includes('titik')) {
            return 'Isi alamat seteliti mungkin, lalu pilih kandidat lokasi dari hasil pencarian peta atau tandai langsung pada peta. Pastikan lokasi berada dalam wilayah Bandar Lampung dan pin sudah tepat sebelum mengirim laporan. Jika alamat tidak ditemukan, gunakan nama jalan, nomor, atau patokan yang lebih spesifik.';
        }
        if (query.includes('status') || query.includes('diterima') || query.includes('diproses') || query.includes('selesai')) {
            return 'Arti status: Diterima berarti laporan sudah masuk dan menunggu verifikasi, Diproses berarti laporan sedang ditindaklanjuti oleh petugas/RT/RW, dan Selesai berarti pekerjaan dinyatakan selesai. Gunakan ID Laporan untuk memantau perubahannya di bagian Lacak.';
        }
        if (query.includes('kategori') || query.includes('jenis kerusakan')) {
            return 'Kategori yang tersedia: Jalan Rusak, Lampu Penerangan Mati, Drainase Tersumbat, Taman/Fasilitas Umum Rusak, Penumpukan Sampah, Kebersihan Lingkungan, Air & Sanitasi, dan Lainnya. Pilih kategori yang paling mendekati masalah agar petugas lebih mudah memprioritaskan penanganan.';
        }
        if (query.includes('admin') || query.includes('rt') || query.includes('rw')) {
            return 'Laporan yang masuk dapat dilihat oleh admin/RT/RW melalui Dasbor Admin. Admin dapat memverifikasi, mengubah status menjadi Diproses atau Selesai, dan menghapus data yang tidak valid. Jika laporan mendesak, tetap laporkan melalui kanal resmi RT/RW terdekat.';
        }
        if (query.includes('data') || query.includes('privasi') || query.includes('email')) {
            return 'Data laporan dipakai untuk tindak lanjut fasilitas publik. Email dan ID Laporan digunakan untuk melacak status. Hindari mengirim data pribadi yang tidak diperlukan, seperti NIK, nomor rekening, atau dokumen pribadi.';
        }
        if (query.includes('biaya') || query.includes('bayar')) {
            return 'Tidak ada biaya untuk membuat laporan melalui SAMARA. Aplikasi ini dibuat untuk membantu warga melaporkan masalah fasilitas publik secara terstruktur.';
        }
        if (query.includes('tidak bisa kirim') || query.includes('gagal mengirim') || query.includes('error')) {
            return 'Jika laporan gagal dikirim, periksa: lokasi wajib dipilih di peta, alamat tidak kosong, kategori dipilih, format foto JPG/PNG maksimal 2 MB, dan email valid. Muat ulang halaman lalu coba lagi. Jika masih gagal, simpan detail laporan dan hubungi RT/RW setempat.';
        }
        if (query.includes('informasi') || query.includes('warga') || query.includes('pengaduan kepada warga')) {
            return 'SAMARA membantu warga menyampaikan keluhan fasilitas publik secara cepat dan terdokumentasi. Informasi penting yang perlu disampaikan adalah lokasi jelas, jenis masalah, foto pendukung, dan kontak email yang bisa dihubungi. Dengan data yang lengkap, penanganan akan lebih cepat dan akuntabel.';
        }
        return 'Saya bisa membantu menjelaskan cara membuat laporan, menentukan kategori keluhan, mengecek status pengaduan, memilih lokasi di peta, mengunggah foto, dan menjelaskan alur penanganan laporan warga. Coba tanyakan misalnya: “Beri saya kategori untuk jalan berlubang” atau “Cek status laporan saya.”';
    }

    function addMessage(role, text, className = '') {
        const message = document.createElement('p');
        message.className = `chat-message ${role}${className ? ` ${className}` : ''}`;
        message.textContent = text;
        messagesContainer.append(message);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return message;
    }

    function openChat() {
        panel.hidden = false;
        launcher.setAttribute('aria-expanded', 'true');
        input.focus();
    }

    function closeChat() {
        panel.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        launcher.focus();
    }

    launcher.addEventListener('click', function() {
        if (panel.hidden) openChat();
        else closeChat();
    });
    closeButton.addEventListener('click', closeChat);

    if (suggestions) {
        suggestions.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', function() {
                input.value = button.textContent.trim();
                form.requestSubmit();
            });
        });
    }

    input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
        }
    });

    form.addEventListener('submit', function(event) {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || sendButton.disabled) return;

        input.value = '';
        if (suggestions) suggestions.hidden = true;
        addMessage('user', text);
        const pending = addMessage('assistant', 'Sedang menyiapkan jawaban...', 'is-pending');
        sendButton.disabled = true;
        input.disabled = true;

        window.setTimeout(function() {
            pending.classList.remove('is-pending');
            pending.textContent = answerQuestion(text);
            sendButton.disabled = false;
            input.disabled = false;
            input.focus();
        }, 250);
    });

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && !panel.hidden) closeChat();
    });
}

let refreshMapMarkers = function() {};

// ============ HALAMAN INDEX ============
async function fetchServerStats() {
    const response = await fetch('/api/stats', { cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Statistik server gagal dimuat (HTTP ${response.status}).`);
    }
    return result;
}

async function updateStats() {
    const totalEl = document.getElementById('totalLaporan');
    if (!totalEl) return;
    const totalSelesai = document.getElementById('totalSelesai');
    const totalProses = document.getElementById('totalProses');
    const totalWarga = document.getElementById('totalWarga');
    try {
        const stats = await fetchServerStats();
        totalEl.textContent = stats.total ?? 0;
        if (totalSelesai) totalSelesai.textContent = stats.selesai ?? 0;
        if (totalProses) totalProses.textContent = stats.diproses ?? 0;
        if (totalWarga) totalWarga.textContent = stats.warga ?? 0;
        return;
    } catch (error) {
        console.warn('Statistik server tidak tersedia; memakai data browser:', error);
    }
    const reports = getStoredReports();
    totalEl.textContent = reports.length;
    if (totalSelesai) totalSelesai.textContent =
        reports.filter(report => report.status === 'Selesai').length;
    if (totalProses) totalProses.textContent =
        reports.filter(report => report.status === 'Diproses').length;
    if (totalWarga) totalWarga.textContent =
        new Set(reports.map(report => String(report.email || '').trim().toLowerCase()).filter(Boolean)).size;
}

// ============ HALAMAN LAPOR (FORM PETA LEAFLET) ============
function initFormLaporan() {
    const form = document.getElementById('formLaporan');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const submitButton = form.querySelector('[type="submit"]');
        const latitude = document.getElementById('lat').value;
        const longitude = document.getElementById('lng').value;
        const lat = Number(latitude);
        const lng = Number(longitude);
        const photoFile = document.getElementById('foto').files[0];
        if (!latitude || !longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            document.getElementById('addressMapStatus').textContent =
                'Pilih hasil alamat atau titik langsung di peta, lalu pastikan pin muncul sebelum mengirim laporan.';
            document.getElementById('mapForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        if (!isWithinBandarLampung(lat, lng)) {
            alert('Lokasi laporan harus berada di wilayah Bandar Lampung.');
            return;
        }
        if (photoFile && (!['image/jpeg', 'image/png'].includes(photoFile.type) ||
            photoFile.size > 2 * 1024 * 1024)) {
            alert('Foto bukti harus JPG atau PNG dengan ukuran maksimal 2 MB.');
            return;
        }
        submitButton.disabled = true;
        try {
            const foto = photoFile ? await readFileAsDataUrl(photoFile) : null;
            const reportPayload = {
                nama: document.getElementById('nama').value.trim(),
                email: document.getElementById('email').value.trim(),
                kategori: document.getElementById('kategori').value,
                alamat: document.getElementById('alamat').value.trim(),
                deskripsi: document.getElementById('deskripsi').value.trim(),
                lat,
                lng,
                foto
            };
            let serverResult = null;
            let serverError = null;
            try {
                serverResult = await saveServerReport(reportPayload);
            } catch (error) {
                serverError = error;
                console.warn('Laporan gagal dikirim ke server admin:', error);
            }
            const result = saveLocalReport({
                ...reportPayload,
                id: serverResult && serverResult.id
            });
            const refreshResults = await Promise.allSettled([
                updateStats(),
                refreshMapMarkers()
            ]);
            const refreshFailed = refreshResults.some(result => result.status === 'rejected');
            refreshResults.forEach(result => {
                if (result.status === 'rejected') {
                    console.error('Laporan tersimpan, tetapi tampilan gagal diperbarui:', result.reason);
                }
            });
            const serverFailed = Boolean(serverError);
            const syncNote = serverFailed
                ? ' Laporan tersimpan di browser, tetapi belum masuk ke data admin karena server tidak dapat dihubungi atau admin perlu login ulang. Jalankan/refresh server, lalu laporkan ulang jika diperlukan.'
                : ' Laporan sudah masuk ke data admin dan juga tersimpan di browser perangkat ini.';
            if (window.Swal && typeof Swal.fire === 'function') {
                await Swal.fire({
                    icon: refreshFailed || serverFailed ? 'warning' : 'success',
                    title: serverFailed ? 'Laporan tersimpan lokal' : 'Laporan Berhasil Disimpan!',
                    text: `ID Laporan Anda: ${result.id}. Simpan ID ini untuk melacak status.` +
                        syncNote +
                        (refreshFailed ? ' Beberapa tampilan belum diperbarui; muat ulang halaman.' : ''),
                    confirmButtonColor: '#10b981',
                    background: '#fff',
                    color: '#1e293b'
                });
            }
            form.reset();
            document.getElementById('searchLaporan').value = result.id;
            document.getElementById('btnCari').click();
            window.location.hash = 'lacak';
        } catch (error) {
            showRequestError(error);
        } finally {
            submitButton.disabled = false;
        }
    });
}

function initFormMap() {
    const mapEl = document.getElementById('mapForm');
    if (!mapEl) return;
    if (typeof L === 'undefined') {
        console.warn('Leaflet belum termuat; peta formulir tidak dapat dibuat.');
        return;
    }

    // 1. Inisialisasi Peta Leaflet untuk Form
    const map = L.map('mapForm').setView([BANDAR_LAMPUNG_CENTER.lat, BANDAR_LAMPUNG_CENTER.lng], 13);
    window.addEventListener('load', () => window.setTimeout(() => map.invalidateSize(), 150));
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map);

    let marker;
    let addressLookupId = 0;
    let lastAddressQuery = '';
    const addressInput = document.getElementById('alamat');
    const addressStatus = document.getElementById('addressMapStatus');
    const addressCandidates = document.getElementById('addressCandidates');

    function setMarker(lat, lng) {
        if (!isWithinBandarLampung(lat, lng)) {
            alert('Pilih lokasi di dalam wilayah Bandar Lampung.');
            return;
        }
        if (marker) {
            map.removeLayer(marker);
        }
        marker = L.marker([lat, lng]).addTo(map);
        document.getElementById('lat').value = lat;
        document.getElementById('lng').value = lng;
    }

    addressInput.addEventListener('input', function() {
        addressLookupId += 1;
        lastAddressQuery = '';
        addressCandidates.replaceChildren();
        document.getElementById('lat').value = '';
        document.getElementById('lng').value = '';
        if (marker) {
            map.removeLayer(marker);
            marker = null;
        }
        const address = this.value.trim();

        if (address.length < 5) {
            addressStatus.textContent = '';
            return;
        }
        addressStatus.textContent = 'Selesai mengetik? Klik di luar kolom untuk mencari lokasi di peta.';
    });

    addressInput.addEventListener('blur', async function() {
        const address = this.value.trim();
        if (address.length < 5 || address === lastAddressQuery) return;

        const queryTerms = address.toLocaleLowerCase('id-ID')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/)
            .filter(term => term.length > 1 && ![
                'jalan', 'jl', 'nomor', 'no', 'bandar', 'lampung', 'indonesia',
                'kecamatan', 'kec', 'kelurahan', 'kel'
            ].includes(term));
        if (queryTerms.length === 0) {
            addressStatus.textContent = 'Tambahkan nama jalan, nomor, gedung, atau patokan lokasi selain nama kota.';
            return;
        }

        const lookupId = addressLookupId;
        lastAddressQuery = address;
        addressStatus.textContent = 'Mencari alamat di peta...';
        const params = new URLSearchParams({
            q: `${address}, Bandar Lampung, Indonesia`,
            format: 'jsonv2',
            limit: '5',
            countrycodes: 'id',
            viewbox: [
                BANDAR_LAMPUNG_BOUNDS.west,
                BANDAR_LAMPUNG_BOUNDS.north,
                BANDAR_LAMPUNG_BOUNDS.east,
                BANDAR_LAMPUNG_BOUNDS.south
            ].join(','),
            bounded: '1',
            'accept-language': 'id'
        });

        try {
            const response = await requestNominatim(`https://nominatim.openstreetmap.org/search?${params}`);
            if (!response.ok) {
                throw new Error(`Layanan pencarian alamat merespons HTTP ${response.status}.`);
            }
            const results = await response.json();
            if (lookupId !== addressLookupId) return;
            if (!Array.isArray(results) || results.length === 0) {
                addressStatus.textContent = 'Alamat tidak ditemukan. Coba tambahkan nama jalan atau kelurahan.';
                return;
            }

            const minimumMatchedTerms = Math.ceil(queryTerms.length / 2);
            const candidates = results.filter(result => {
                if (!isWithinBandarLampung(Number(result.lat), Number(result.lon))) return false;
                const resultTerms = new Set(result.display_name.toLocaleLowerCase('id-ID')
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .split(/[^a-z0-9]+/));
                const matchedTerms = queryTerms.filter(term => resultTerms.has(term)).length;
                return matchedTerms >= minimumMatchedTerms;
            });
            if (candidates.length === 0) {
                addressStatus.textContent = 'Tidak ada hasil yang cukup cocok dengan kata kunci alamat di Bandar Lampung. Periksa ejaan atau coba nama jalan/patokan lain.';
                return;
            }

            addressStatus.textContent = 'Pilih alamat yang paling cocok. Hasil pencarian belum dipasang sebagai pin.';
            const fragment = document.createDocumentFragment();
            candidates.forEach(candidate => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'address-candidate';
                button.textContent = candidate.display_name;
                button.setAttribute('aria-pressed', 'false');
                button.addEventListener('click', function() {
                    const latitude = Number(candidate.lat);
                    const longitude = Number(candidate.lon);
                    if (!isWithinBandarLampung(latitude, longitude)) {
                        addressStatus.textContent = 'Alamat yang dipilih berada di luar Bandar Lampung.';
                        return;
                    }

                    map.setView([latitude, longitude], 17);
                    setMarker(latitude, longitude);
                    addressCandidates.querySelectorAll('.address-candidate').forEach(item => {
                        item.setAttribute('aria-pressed', String(item === button));
                    });
                    addressStatus.textContent = `Pin dipasang pada: ${candidate.display_name}. Periksa kembali posisi pin di peta.`;
                });
                fragment.append(button);
            });
            addressCandidates.replaceChildren(fragment);
        } catch (error) {
            if (lookupId !== addressLookupId) return;
            lastAddressQuery = '';
            addressStatus.textContent = 'Pencarian alamat gagal. Periksa koneksi internet atau pilih titik di peta.';
            console.error('Pencarian alamat dengan Nominatim gagal:', error);
        }
    });

    map.on('click', function(e) {
        setMarker(e.latlng.lat, e.latlng.lng);
        addressStatus.textContent = 'Titik lokasi dipilih secara manual di peta.';
    });

    document.getElementById('btnLokasi').addEventListener('click', function() {
        if (!navigator.geolocation) {
            alert('Browser Anda tidak mendukung fitur lokasi.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            function(pos) {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (!isWithinBandarLampung(lat, lng)) {
                    alert('Lokasi Anda berada di luar wilayah Bandar Lampung.');
                    return;
                }
                map.setView([lat, lng], 15);
                setMarker(lat, lng);
                addressStatus.textContent = 'Lokasi Anda dipilih di peta.';
            },
            function(error) {
                alert(`Lokasi tidak dapat diakses: ${error.message}`);
            }
        );
    });
}

// ============ HALAMAN LOGIN ADMIN ============
function initLogin() {
    const modal = document.getElementById('loginModal');
    const openButton = document.getElementById('navAdmin');
    const closeButton = document.getElementById('btnTutupLogin');
    const form = document.getElementById('formLogin');
    const input = document.getElementById('passwordAdmin');
    const errorBox = document.getElementById('loginError');
    const submitButton = form ? form.querySelector('[type="submit"]') : null;
    if (!modal || !form || !input) return;

    function setOpen(open) {
        modal.hidden = !open;
        modal.setAttribute('aria-hidden', String(!open));
        if (open) {
            if (errorBox) errorBox.hidden = true;
            if (input) input.value = '';
            if (submitButton) submitButton.disabled = false;
            if (input) input.focus();
        }
    }

    function closeModal() {
        setOpen(false);
    }

    window.openAdminLogin = function() {
        if (adminSession) {
            window.location.href = 'admin.html';
            return;
        }
        setOpen(true);
    };

    if (openButton) {
        openButton.addEventListener('click', function(event) {
            event.preventDefault();
            if (adminSession) {
                window.location.href = 'admin.html';
                return;
            }
            setOpen(true);
        });
    }
    if (closeButton) closeButton.addEventListener('click', closeModal);
    modal.addEventListener('click', function(event) {
        if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && !modal.hidden) closeModal();
    });

    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        if (adminSession) { closeModal(); return; }
        const password = input.value;
        if (!password) {
            if (errorBox) { errorBox.textContent = 'Masukkan kata sandi admin terlebih dahulu.'; errorBox.hidden = false; }
            return;
        }
        if (submitButton) submitButton.disabled = true;
        try {
            const response = await fetch(LOGIN_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password })
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.ok) {
                adminSession = true;
                adminSessionCheck = null;
                closeModal();
                if (window.Swal && typeof Swal.fire === 'function') {
                    await Swal.fire({
                        icon: 'success',
                        title: 'Login Berhasil!',
                        text: 'Selamat datang admin SAMARA.',
                        confirmButtonColor: '#10b981',
                        background: '#fff',
                        color: '#1e293b'
                    });
                }
                const adminSection = document.getElementById('admin');
                if (adminSection) adminSection.hidden = false;
                showAdminView();
                loadDashboardData();
                window.location.href = 'admin.html';
                return;
            }
            throw new Error(result.error || 'Kata sandi admin salah. Silakan coba lagi.');
        } catch (error) {
            if (errorBox) { errorBox.textContent = error.message || 'Login gagal. Silakan coba lagi.'; errorBox.hidden = false; }
            if (window.Swal && typeof Swal.fire === 'function') {
                await Swal.fire({
                    icon: 'error',
                    title: 'Login Gagal!',
                    text: error.message || 'Kata sandi admin salah. Silakan coba lagi.',
                    confirmButtonColor: '#ef4444',
                    background: '#fff',
                    color: '#1e293b'
                });
            }
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}

let adminSessionCheck = null;

function checkAdminSession() {
    if (!adminSessionCheck) {
        adminSessionCheck = (async function() {
            try {
                const response = await fetch(SESSION_ENDPOINT);
                if (!response.ok) return false;
                const result = await response.json();
                adminSession = Boolean(result.authenticated);
                return adminSession;
            } catch (error) {
                adminSession = false;
                return false;
            }
        })();
    }
    return adminSessionCheck;
}

// ============ HALAMAN DASHBOARD ADMIN ============
let adminReports = [];

function filterReports(reports, query) {
    const value = query.trim().toLowerCase();
    if (!value) return reports;
    return reports.filter(report => {
        const idText = String(report.id || '');
        const namaText = String(report.nama || '');
        const kategoriText = String(report.kategori || '');
        return idText.includes(value) || namaText.toLowerCase().includes(value) || kategoriText.toLowerCase().includes(value);
    });
}

let dashboardDataSource = 'local';

async function fetchServerReports() {
    const response = await fetch('/api/reports', { cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(result.error || `Data admin gagal dimuat (HTTP ${response.status}).`);
    }
    return Array.isArray(result.reports) ? result.reports : [];
}

async function loadDashboardData() {
    try {
        const reports = await fetchServerReports();
        dashboardDataSource = 'server';
        adminReports = reports;
    } catch (error) {
        console.warn('Server admin tidak tersedia; memakai data browser:', error);
        dashboardDataSource = 'local';
        adminReports = getStoredReports();
    }
    renderDashboard(adminReports);
    return dashboardDataSource;
}

function renderDashboard(reports = adminReports) {
    adminReports = reports;

    const totalElement = document.getElementById('adminStatTotal');
    const wargaElement = document.getElementById('adminStatWarga');
    const diprosesElement = document.getElementById('adminStatDiproses');
    const selesaiElement = document.getElementById('adminStatSelesai');
    const total = reports.length;
    const wargaAktif = new Set(reports.map(report => String(report.email || '').toLowerCase()).filter(Boolean)).size;
    const diproses = reports.filter(report => report.status === 'Diproses').length;
    const selesai = reports.filter(report => report.status === 'Selesai').length;
    if (totalElement) totalElement.textContent = String(total);
    if (wargaElement) wargaElement.textContent = String(wargaAktif);
    if (diprosesElement) diprosesElement.textContent = String(diproses);
    if (selesaiElement) selesaiElement.textContent = String(selesai);

    renderDashboardTable();
}

// Render Data Table Terintegrasi dengan Tailwind CSS
function renderDashboardTable() {
    const tbody = document.getElementById('adminTableBody');
    if (!tbody) return;
    const searchInput = document.getElementById('adminSearch');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const reports = query ? filterReports(adminReports, query) : adminReports;
    
    if (reports.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-12 text-center text-gray-500">
                    <div class="flex flex-col items-center justify-center">
                        <span class="text-3xl mb-2">📭</span>
                        <p class="font-medium">Tidak ada laporan ditemukan.</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = reports.map(report => {
        let badgeClass = '';
        let dotColor = '';
        if (report.status === 'Diterima') {
            badgeClass = 'bg-yellow-100 text-yellow-800 border-yellow-200';
            dotColor = 'bg-yellow-500';
        } else if (report.status === 'Diproses') {
            badgeClass = 'bg-blue-100 text-blue-800 border-blue-200';
            dotColor = 'bg-blue-500';
        } else {
            badgeClass = 'bg-green-100 text-green-800 border-green-200';
            dotColor = 'bg-green-500';
        }

        const statusActions = report.status === 'Diterima'
            ? `<button type="button" class="text-blue-600 hover:text-blue-800 font-medium text-sm mr-3 transition-colors" data-action="proses" data-id="${escapeHtml(report.id)}">Proses</button>`
            : '';
        const selesaiAction = report.status === 'Diproses'
            ? `<button type="button" class="text-emerald-600 hover:text-emerald-800 font-medium text-sm mr-3 transition-colors" data-action="selesai" data-id="${escapeHtml(report.id)}">Selesai</button>`
            : '';

        return `
        <tr class="hover:bg-gray-50/50 transition-colors border-b border-gray-100 last:border-0">
            <td class="px-6 py-4 font-medium text-gray-900">#${escapeHtml(report.id)}</td>
            <td class="px-6 py-4 text-gray-900 font-medium">
                ${escapeHtml(report.nama)}
                <div class="text-xs text-gray-500 font-normal mt-0.5">${escapeHtml(report.email)}</div>
            </td>
            <td class="px-6 py-4 text-gray-600">${escapeHtml(report.kategori)}</td>
            <td class="px-6 py-4 text-gray-600 text-xs">${escapeHtml(report.alamat)}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${badgeClass}">
                    <span class="w-1.5 h-1.5 rounded-full mr-1.5 ${dotColor}"></span>
                    ${escapeHtml(report.status)}
                </span>
            </td>
            <td class="px-6 py-4 text-right whitespace-nowrap">
                ${statusActions}
                ${selesaiAction}
                <button type="button" class="text-red-600 hover:text-red-800 font-medium text-sm transition-colors" data-action="hapus" data-id="${escapeHtml(report.id)}">Hapus</button>
            </td>
        </tr>
        `;
    }).join('');
}

function showAdminView() {
    const main = document.querySelector('main');
    if (!main) return;
    main.querySelectorAll(':scope > section').forEach(section => {
        section.style.display = section.id === 'admin' ? 'block' : 'none';
    });
}

function showMainView() {
    const main = document.querySelector('main');
    if (!main) return;
    main.querySelectorAll(':scope > section').forEach(section => {
        section.style.display = section.id === 'admin' ? 'none' : '';
    });
}

function initDashboard() {
    const section = document.getElementById('admin');
    const searchInput = document.getElementById('adminSearch');
    const tableBody = document.getElementById('adminTableBody');
    const logoutButton = document.getElementById('btnLogoutAdmin');
    if (!section) return;

    showMainView();

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            renderDashboardTable();
        });
    }
    if (tableBody) {
            tableBody.addEventListener('click', async function(event) {
                const button = event.target.closest('[data-action]');
                if (!button) return;
                const id = Number(button.dataset.id);
                if (Number.isNaN(id)) return;
                const action = button.dataset.action;
                button.disabled = true;
                try {
                    if (dashboardDataSource === 'server') {
                        const response = action === 'hapus'
                            ? await fetch(`/api/reports/${id}`, { method: 'DELETE' })
                            : await fetch(`/api/reports/${id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: action === 'proses' ? 'Diproses' : 'Selesai' })
                            });
                        const result = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(result.error || `Perubahan gagal disimpan (HTTP ${response.status}).`);
                        await loadDashboardData();
                        return;
                    }
                    const reports = getStoredReports();
                    const index = reports.findIndex(report => Number(report.id) === id);
                    if (index === -1) return;
                    if (action === 'hapus') {
                        reports.splice(index, 1);
                        if (!saveStoredReports(reports)) return;
                    } else {
                        reports[index].status = action === 'proses' ? 'Diproses' : 'Selesai';
                        if (!saveStoredReports(reports)) return;
                    }
                    renderDashboard();
                } catch (error) {
                    console.error('Perubahan laporan gagal:', error);
                    alert(error.message || 'Perubahan laporan gagal disimpan.');
                } finally {
                    button.disabled = false;
                }
            });
        }
    if (logoutButton) {
        logoutButton.addEventListener('click', async function() {
            if (logoutButton.disabled) return;
            logoutButton.disabled = true;
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (error) {
                console.warn('Logout admin gagal dihubungi ke server:', error);
            } finally {
                adminSession = false;
                adminSessionCheck = null;
                const modal = document.getElementById('loginModal');
                if (modal) {
                    modal.hidden = true;
                    modal.setAttribute('aria-hidden', 'true');
                }
                const adminSection = document.getElementById('admin');
                if (adminSection) adminSection.hidden = true;
                showMainView();
                window.scrollTo(0, 0);
                window.location.href = 'index.html';
            }
        });
    }

    checkAdminSession().then(function(authenticated) {
        if (!authenticated) {
            window.location.replace('index.html#login');
            return;
        }
        loadDashboardData();
    });
}

// ============ HALAMAN LACAK ============
function initLacak() {
    const btnCari = document.getElementById('btnCari');
    const idInput = document.getElementById('searchLaporan');
    const emailInput = document.getElementById('searchEmail');
    if (!btnCari || !idInput || !emailInput) return;

    async function fetchServerReport(id, email) {
        const params = new URLSearchParams({ id, email });
        const response = await fetch(`/api/public/track?${params}`, { cache: 'no-store' });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.error || `Pelacakan server gagal (HTTP ${response.status}).`);
        }
        return result.report;
    }

    function renderReport(l, offlineNote = '') {
        const statusClass = ['Diterima', 'Diproses', 'Selesai'].includes(l.status) ? l.status : 'Diterima';
        const alamat = l.alamat || 'Detail alamat hanya tersedia di perangkat tempat laporan dibuat.';
        const deskripsi = l.deskripsi || 'Deskripsi hanya tersedia di perangkat tempat laporan dibuat.';
        return `
                <div style="border-left:4px solid var(--primary);padding:1rem;background:var(--light);border-radius:8px;margin-bottom:1rem;">
                    <h3>Laporan #${escapeHtml(l.id)} <span class="status-badge status-${statusClass}">${escapeHtml(l.status)}</span></h3>
                    <p><strong>Kategori:</strong> ${escapeHtml(l.kategori)}</p>
                    <p><strong>Alamat:</strong> ${escapeHtml(alamat)}</p>
                    <p><strong>Tanggal:</strong> ${escapeHtml(l.tanggal)}</p>
                    <p><strong>Deskripsi:</strong> ${escapeHtml(deskripsi)}</p>
                    ${offlineNote ? `<p role="note">${escapeHtml(offlineNote)}</p>` : ''}
                    <div class="timeline">
                        <div class="timeline-item ${['Diterima','Diproses','Selesai'].includes(l.status) ? 'active' : ''}">Diterima</div>
                        <div class="timeline-item ${['Diproses','Selesai'].includes(l.status) ? 'active' : ''}">Diverifikasi</div>
                        <div class="timeline-item ${l.status === 'Diproses' ? 'active' : ''}">Sedang Diperbaiki</div>
                        <div class="timeline-item ${l.status === 'Selesai' ? 'active' : ''}">Selesai</div>
                    </div>
                </div>`;
    }

    btnCari.addEventListener('click', async function() {
        const id = idInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const hasil = document.getElementById('hasilLacak');
        if (!id || !email) { alert('Masukkan ID Laporan dan email yang dipakai saat melapor.'); return; }
        if (!/^\d+$/.test(id)) { alert('ID Laporan harus berupa angka.'); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Format email tidak valid.'); return; }

        btnCari.disabled = true;
        try {
            hasil.style.display = 'block';
            hasil.innerHTML = '<p style="text-align:center;color:#2563eb;">Mencari laporan...</p>';

            let localReports = [];
            try {
                localReports = getStoredReports();
            } catch (error) {
                console.warn('Data browser tidak dapat dibaca:', error);
                localReports = [];
            }
            const localIndex = localReports.findIndex(report => String(report.id) === id);

            let serverReport = null;
            let serverError = null;
            try {
                serverReport = await fetchServerReport(id, email);
            } catch (error) {
                serverError = error;
                console.warn('Pelacakan server tidak tersedia:', error);
            }

            if (serverReport) {
                if (localIndex >= 0) {
                    localReports[localIndex].status = serverReport.status;
                    localReports[localIndex].tanggal = serverReport.tanggal;
                    saveStoredReports(localReports);
                    hasil.innerHTML = renderReport(localReports[localIndex]);
                } else {
                    hasil.innerHTML = renderReport({
                        id: serverReport.id,
                        kategori: serverReport.kategori,
                        tanggal: serverReport.tanggal,
                        status: serverReport.status
                    }, 'Ditemukan di server. Detail alamat dan deskripsi hanya tersedia di perangkat tempat laporan dibuat.');
                }
                return;
            }

            if (localIndex >= 0) {
                hasil.innerHTML = renderReport(localReports[localIndex], 'Server tidak terhubung; status mungkin belum diperbarui.');
                return;
            }

            hasil.innerHTML = `<p role="alert" style="text-align:center;color:#ef4444;">${escapeHtml(serverError ? serverError.message : 'Laporan tidak ditemukan.')}</p>`;
        } catch (error) {
            showRequestError(error);
        } finally {
            btnCari.disabled = false;
        }
    });
}

// ============ HALAMAN PETA (LEAFLET) ============
function initPeta() {
    const mapEl = document.getElementById('mapFull');
    if (!mapEl) return;
    if (typeof L === 'undefined') {
        console.warn('Leaflet belum termuat; peta sebaran tidak dapat dibuat.');
        return;
    }

    const map = L.map('mapFull').setView([BANDAR_LAMPUNG_CENTER.lat, BANDAR_LAMPUNG_CENTER.lng], 13);
    window.addEventListener('load', () => window.setTimeout(() => map.invalidateSize(), 150));
    window.addEventListener('hashchange', () => window.setTimeout(() => map.invalidateSize(), 150));

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    let markers = [];
    let currentFilter = 'all';

    async function renderMarkers(filter = 'all') {
        currentFilter = filter;
        
        // Bersihkan marker lama
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];

        const isAdminPage = Boolean(document.getElementById('admin'));
        const mapEndpoint = isAdminPage ? '/api/reports/map' : '/api/public/map';
        let reports;
        try {
            const response = await fetch(mapEndpoint, { cache: 'no-store' });
            if (!response.ok) throw new Error(`Peta server gagal dimuat (HTTP ${response.status}).`);
            const result = await response.json();
            reports = Array.isArray(result.reports) ? result.reports : [];
        } catch (error) {
            console.warn('Memakai data laporan browser untuk peta:', error);
            reports = getStoredReports();
        }
        reports = reports.filter(l =>
            isWithinBandarLampung(Number(l.lat), Number(l.lng)) &&
            (filter === 'all' || l.status === filter)
        );

        reports.forEach(l => {
            let markerColor = '';
            let iconHtml = '';
            
            if (l.status === 'Selesai') {
                markerColor = 'bg-emerald-500';
                iconHtml = '✅';
            } else if (l.status === 'Diproses') {
                markerColor = 'bg-blue-500';
                iconHtml = '🚧';
            } else {
                markerColor = 'bg-yellow-500';
                iconHtml = '❗';
            }

            const customIcon = L.divIcon({
                className: 'custom-leaflet-marker',
                html: `<div class="flex items-center justify-center w-8 h-8 rounded-full shadow-lg ${markerColor} border-2 border-white text-xs">${iconHtml}</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -16]
            });

            const marker = L.marker([Number(l.lat), Number(l.lng)], { icon: customIcon }).addTo(map);
            
            marker.bindPopup(`
                <div class="font-sans min-w-[150px]">
                    <strong class="text-gray-900 block mb-1 text-sm">#${escapeHtml(l.id)} - ${escapeHtml(l.kategori)}</strong>
                    ${isAdminPage && l.alamat ? `<p class="text-xs text-gray-600 mb-2 leading-relaxed">${escapeHtml(l.alamat)}</p>` : ''}
                    <span class="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full ${markerColor} text-white">${escapeHtml(l.status)}</span>
                </div>
            `);
            
            markers.push(marker);
        });
    }

    refreshMapMarkers = function() {
        return renderMarkers(currentFilter);
    };

    renderMarkers().catch(showRequestError);

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Reset style semua tombol
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.remove('active', 'bg-emerald-600', 'text-white');
                b.classList.add('bg-gray-100', 'text-gray-600');
            });
            
            // Aktifkan style tombol yg diklik
            this.classList.remove('bg-gray-100', 'text-gray-600');
            this.classList.add('active', 'bg-emerald-600', 'text-white');
            
            renderMarkers(this.dataset.filter).catch(showRequestError);
        });
    });
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', function() {
    const closeApiErrorButton = document.getElementById('btnCloseApiError');
    if (closeApiErrorButton) {
        closeApiErrorButton.addEventListener('click', function() {
            document.getElementById('apiErrorNotice').hidden = true;
        });
    }
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    if (navToggle && navMenu) {
        const closeNavMenu = function() {
            navMenu.classList.remove('is-open');
            navToggle.setAttribute('aria-expanded', 'false');
            navToggle.setAttribute('aria-label', 'Buka menu navigasi');
        };
        navToggle.addEventListener('click', function() {
            const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
            navToggle.setAttribute('aria-expanded', String(!isOpen));
            navToggle.setAttribute('aria-label', isOpen ? 'Buka menu navigasi' : 'Tutup menu navigasi');
            navMenu.classList.toggle('is-open', !isOpen);
        });
        navMenu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeNavMenu));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeNavMenu();
        });
        window.addEventListener('resize', function() {
            if (window.innerWidth > 768) closeNavMenu();
        });
    }
    
    // Inisialisasi Peta Leaflet dan Fungsi Lainnya. Satu fitur gagal tidak boleh mematikan fitur lain.
    const safeInit = function(name, fn) {
        try {
            return fn();
        } catch (error) {
            console.error(`Inisialisasi ${name} gagal:`, error);
            return undefined;
        }
    };
    safeInit('statistik', () => updateStats().catch(showRequestError));
    safeInit('peta formulir', initFormMap);
    safeInit('peta sebaran', initPeta);
    safeInit('form laporan', initFormLaporan);
    safeInit('lacak laporan', initLacak);
    safeInit('widget cuaca', initWeatherWidget);
    safeInit('chatbot', initChatbot);
    safeInit('login admin', initLogin);
    safeInit('cek sesi admin', checkAdminSession);
    safeInit('dasbor admin', initDashboard);
    
    const navLinks = document.querySelectorAll('.nav-menu a[href^="#"]');
    function updateActiveNav() {
        const currentHash = window.location.hash || '#beranda';
        navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === currentHash));
    }
    window.addEventListener('hashchange', updateActiveNav);
    updateActiveNav();
});

// Loading Screen Logic
window.addEventListener('load', function() {
    const loader = document.createElement('div');
    loader.id = 'loader';
    loader.innerHTML = '<div class="loader-spinner"></div><h2>Memuat SAMARA...</h2>';
    document.body.prepend(loader);
    
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 500);
    }, 800);
});