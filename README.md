# SAMARA (situs statis lokal)

SAMARA adalah aplikasi pelaporan fasilitas publik untuk Bandar Lampung. Nama di sudut kiri atas aplikasi adalah **SAMARA**.

## Mengganti kata sandi admin

Kata sandi admin tidak disimpan sebagai teks biasa, hanya hash-nya di database. Untuk menggantinya, hentikan server dulu, lalu jalankan:

```powershell
python server.py --reset-admin-password
```

Server akan meminta kata sandi baru dua kali. Minimal 12 karakter. Setelah berhasil, jalankan lagi server seperti biasa:

```powershell
python server.py
```

Sesi admin yang masih aktif bisa tetap berlaku sampai server dihentikan atau sesi kedaluwarsa; jika ingin sesi lama langsung tidak berlaku, restart server setelah mengganti kata sandi.

## Menjalankan

Untuk fitur situs dasar, buka `index.html` langsung di browser. Untuk fitur admin dan penyimpanan laporan ke database, jalankan server Python dari folder proyek:

```powershell
python server.py
```

Saat pertama kali server berjalan, server akan meminta pembuatan kata sandi admin untuk database lokal. Buka `http://127.0.0.1:8000` setelah server aktif.

Server Python menyimpan database di luar folder file statis, yaitu `../smartwarga-data/smartwarga.sqlite3` secara default. Lokasinya bisa dioverride lewat environment variable `SMARTWARGA_DATA_DIR`. Jika database lama `smartwarga.sqlite3` masih ada di folder proyek, server akan menyalinnya ke lokasi baru saat pertama dijalankan; setelah dipastikan aplikasi berjalan normal, salinan lama dapat dihapus manual. Endpoint laporan detail seperti `/api/reports`, `/api/reports/map`, dan `/api/reports/lookup` hanya bisa diakses setelah login admin.

## Chatbot SAMARA

Chatbot SAMARA memakai **jawaban langsung di aplikasi**, bukan API eksternal dan tidak memerlukan API key Gemini. Jawabannya dirancang untuk membantu pembuat laporan, misalnya cara membuat laporan, memilih titik di peta, mengunggah foto bukti, melacak ID Laporan, memahami status, kategori, data/privasi, dan kendala saat mengirim laporan.

## Penyimpanan laporan

Saat warga mengirim laporan, aplikasi mencoba mengirimkannya ke server lokal agar **langsung masuk ke data admin**. Jika server aktif dan warga sedang online, laporan tersimpan di database dan dapat dilihat/ditindaklanjuti oleh admin/RT/RW. Aplikasi juga menyimpan salinan laporan di penyimpanan lokal browser agar ID Laporan bisa langsung dipakai untuk pelacakan di perangkat yang sama.

Jika server tidak aktif atau tidak dapat dihubungi, laporan tetap tersimpan di browser perangkat tersebut, tetapi belum masuk ke data admin. Pesan setelah pengiriman akan memberitahukan kondisi ini.

Pelacakan warga memakai ID Laporan **dan email** yang dipakai saat membuat laporan. Jika server aktif, status terbaru dari admin akan ditampilkan melalui endpoint `/api/public/track` yang hanya mengembalikan data minimal (ID, kategori, tanggal, status) tanpa alamat dan deskripsi. Detail alamat/deskripsi hanya tersedia di perangkat tempat laporan dibuat; jika server tidak aktif, aplikasi menampilkan data dari browser dengan catatan bahwa status mungkin belum diperbarui.

Pencarian alamat menggunakan Nominatim OpenStreetMap saat pengguna selesai mengetik lalu meninggalkan kolom alamat; pencarian tidak berjalan sebagai autocomplete. Hingga lima kandidat yang berada dalam batas Bandar Lampung ditampilkan untuk dipilih pengguna, bukan langsung memasang hasil pertama. Periksa kandidat dan posisi pin sebelum mengirim; alamat yang tidak tersedia atau kurang rinci pada data peta tidak dapat dijamin akurasinya dan perlu dipilih manual di peta. Laporan tidak dapat dikirim sebelum koordinat lokasi dipilih. Permintaan dibatasi minimal 1,1 detik antar-request dan hasil pencarian diberi atribusi OpenStreetMap. Penggunaan layanan publik harus mengikuti [kebijakan Nominatim](https://operations.osmfoundation.org/policies/nominatim/); layanan ini ditujukan untuk penggunaan moderat dan dapat berubah sewaktu-waktu. Peta menggunakan Leaflet dengan tile OpenStreetMap, bukan Google Maps JavaScript API.

Widget cuaca dapat memakai GPS untuk meminta cuaca pada koordinat perangkat. Pengguna dapat memilih nama kecamatan Bandar Lampung; koordinat dikirim ke layanan cuaca dan OpenStreetMap untuk mencari nama wilayah. Akses lokasi harus diizinkan browser.
