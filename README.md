# Flowbase — Low-code CRM & Process Studio 0.2

Implementasi fungsional dari PRD v0.1 dengan perluasan Studio 0.2. Lihat `docs-studio-guide.md` untuk panduan workflow/page designer dan batas kompatibilitas Camunda/Creatio. Bahasa UI: Indonesia. Produk referensi: kategori platform low-code/no-code seperti Creatio, bukan replika fitur enterprise.

## Demo online gratis — GitHub Pages

Mode demo browser tersedia di **https://eduff86.github.io/crmlowcode/** setelah GitHub Actions berhasil melakukan deployment. `npm run build:pages` menghasilkan `dist-pages/` dengan base path repository, worker lokal, WASM dan data bundle PostgreSQL. Workflow `.github/workflows/pages.yml` menjalankan tests/build dan deploy setiap push ke main. Mode Node.js/Express tetap tersedia melalui build/start biasa.

- Tidak memerlukan VPS, layanan backend, API key atau langganan hosting.
- Database PostgreSQL WASM berjalan di Web Worker dan disimpan dalam IndexedDB **browser pengunjung sendiri**. Tidak ada server database cloud, sinkronisasi perangkat atau kolaborasi antar-pengguna.
- CRUD, Studio, graph workflow, approvals dengan ganti persona, notifications dan versioning dapat dicoba lokal. Persona bukan autentikasi produksi; aturan role/RLS hanya mendemonstrasikan logika aplikasi, bukan melindungi data dari pemilik browser.
- Timer diproses saat worker tab berjalan; jika tab ditutup, event yang jatuh tempo dilanjutkan ketika aplikasi dibuka kembali. Tidak ada layanan background 24/7.
- Reload mempertahankan data pada origin/browser yang sama. Browser lain, mode private, hapus data situs, eviction storage, atau pindah domain tidak mempertahankan workspace tersebut. Ini bukan backup.
- Gunakan satu tab aktif; Web Locks mencegah dua worker mengakses database yang sama. Browser harus mendukung WebAssembly, IndexedDB, Web Workers dan Web Locks.
- Pembukaan pertama mengunduh bundle database sekitar 14 MB sebelum kompresi, sehingga dapat lebih lambat. Hanya gunakan data contoh. Batas dan ketersediaan hosting mengikuti layanan GitHub Pages; bukan SLA produksi.

## Yang sudah berjalan

- React UI responsif: ringkasan, CRM, daftar/board opportunity, inbox approval, studio, aplikasi, dan audit.
- Dua tenant demo dengan isolasi API + PostgreSQL Row-Level Security.
- Persona Edvan (owner), Maya (admin/approver), dan Rafi (member dengan scope own).
- Buat aplikasi menggunakan template CRM atau kanvas kosong.
- Model data: entitas custom, field text, long_text, integer, decimal, boolean, date, datetime, enum, email, dan reference.
- Form metadata: drag urutan komponen, alternatif tombol naik/turun, label, default, required, searchable, layout satu/dua kolom, hide dari form, dan preview nonproduksi.
- List builder: pemilihan dan urutan kolom, default sort, pencarian text, serta filter status di runtime.
- Draft/publish: revision optimistic, snapshot published immutable, kompatibilitas tipe/key, dan backfill required field dengan default.
- Runtime CRUD: validasi server, relasi FK, owner, optimistic revision, dan soft-delete dengan pemeriksaan reference/workflow aktif.
- Permission member per entity/action: none, own, all; create boolean. Akses baca/ubah/hapus diterapkan API.
- Process modeler graf: start/end, exclusive gateway, beberapa user task berurutan, data task, notifikasi, dan timer; trigger manual/record-created; undo/redo, fullscreen, simulasi dan import/export JSON.
- Workflow engine monitor: instance, execution trace, task/decision variables, incident, cancel, retry node gagal, revision conflict, dan pinned version.
- Page designer: sections, judul/deskripsi, full-width, placeholder/help text, conditional visibility, dan preview interaktif.
- Data rules serta versi aplikasi: constraint field, inspect snapshot, dan restore-to-draft.
- Transactional outbox, idempotency key submit, revision conflict detection, retry backoff + jitter maksimum lima kali, dan dead-letter.
- Audit append-only pada role database runtime dan notifikasi hanya untuk penerima.
- Pada mode server, data pada disk, bukan localStorage. Data tetap tersedia setelah database dibuka ulang selama direktori datanya dipertahankan.

## Cara mencoba di preview

1. Buka App studio → Model data/Form builder untuk menambahkan field.
2. Simpan draft; versi runtime belum berubah. Publish untuk menerapkan konfigurasi yang kompatibel.
3. Tambahkan opportunity dan isi diskon >10%; simpan, buka detail, lalu Ajukan diskon.
4. Ganti persona ke Maya Putri melalui avatar. Buka Persetujuan saya dan putuskan tugas.
5. Ganti ke Rafi untuk membuktikan scope record sendiri dan tidak adanya akses Studio.
6. Buka Aplikasi → Buat aplikasi → Kanvas kosong, tambahkan entitas/field, publish, dan buat record custom.
7. Ganti perusahaan untuk melihat data tenant terpisah.

Persona terbuka ini sengaja untuk uji demo. Siapa pun yang memiliki akses preview dapat mengambil persona owner atau approver. Jangan memasukkan data pelanggan, password, dokumen internal, atau data sensitif.

## Stack dan struktur

- Node.js 22+, Express 5, React 19, Vite 6, Lucide icons.
- PGlite/PostgreSQL embedded pada filesystem: SQL relasional dan RLS nyata, bukan database produksi PostgreSQL multi-proses.
- Pada mode server, worker polling single-instance berada dalam proses server. Semua akses PGlite aplikasi diserialkan untuk menjaga konteks transaksi.
- `server/schema.sql`: fondasi 12 tabel dari rancangan awal.
- `server/index.js`: seed, API, authorization, validasi, publish dan worker.
- `server/test.js` + `server/graph-test.js`: 103 assertion integrasi dalam database sementara terisolasi.
- `server/workflow-engine.js`: eksekusi per-node dan command instance.
- `src/WorkflowStudio.jsx`: React Flow modeler dan process operations.
- `src/DesignStudio.jsx`: page sections, visibility, data rules dan version history.
- `src/shared/workflow.js`: metadata graph, type validation dan simulasi.
- `src/main.jsx`: UI dan builder metadata.
- `src/styles.css`: desain navy/teal, responsive layout, dan dukungan reduced motion.

Form drag-and-drop memakai HTML drag events dan tombol alternatif. Process modeler menggunakan React Flow dan graf executable Flowbase JSON. Bukan editor/engine BPMN 2.0 kompatibel Camunda; impor/ekspor BPMN XML belum tersedia. Stack ini sengaja lebih ringan daripada NestJS + React Flow pada rancangan awal, agar fungsi inti segera dapat dicoba.

## Pengembangan di lingkungan sendiri

Prasyarat: Node.js 22+ dan npm. Ini petunjuk untuk pengembang yang menerima kode sumber, bukan instruksi untuk mengakses sandbox preview.

```sh
npm ci
npm run build
npm test
DATA_DIR=/direktori-persisten/flowbase npm start
```

Server memakai port 3000. `DATA_DIR` default `/tmp/flowbase-mvp-data`; untuk hosting, wajib mengganti ke volume persisten. Dataset contoh di-seed hanya saat database kosong. Jangan membuka direktori database yang sama dari dua proses PGlite sekaligus.

Archive tidak memuat node_modules, direktori database, cookie/sesi, atau data pengguna preview. Instalasi baru memulai seed CRM awal; field/record/aplikasi tambahan yang dibuat melalui UI preview tidak otomatis ikut masuk source archive.

Untuk container, Dockerfile tersedia; mount volume persisten pada `/data`. Container tetap menjalankan mode demo, bukan deployment produksi.

## Batas implementasi terhadap PRD

| Area | Status / batas saat ini |
|---|---|
| Autentikasi | Persona demo + cookie HttpOnly/SameSite; belum OIDC, password, undangan, atau SSO. `DEMO_MODE=false` menghentikan startup, bukan mengaktifkan auth produksi. |
| Pengelolaan tenant/member | Dua tenant dan tiga anggota seeded; belum UI provisioning, undangan, nonaktifkan membership, atau transfer owner. Membership aktif tetap diverifikasi setiap request. |
| Database | PGlite single-instance. Migrasi ke PostgreSQL 16+ server dan pool transaksi diperlukan untuk SaaS/pilot multi-instance. |
| List / kapasitas | Bootstrap maksimum 1.000 record per app, pagination 10 per halaman di client, search text dan filter status; belum query range, saved filters, atau pagination server. Dashboard hanya agregasi record bootstrap yang dapat dibaca, bukan seluruh dataset besar. |
| Workflow | Graph tanpa siklus; trigger manual/record-created; user task berurutan; timer/outbox. Belum BPMN XML, parallel branch/join, loop, subprocess, external connector atau escalation. |
| Publish | Backfill kecil dalam transaksi tunggal, write serial per instance. Belum job migrasi besar, distributed lock, atau rollback konfigurasi otomatis. |
| Error/conflict recovery | Cancel dan retry failed node tersedia; conflict memerlukan pengajuan ulang dan tidak boleh bypass revision. Belum advanced process migration/compensation dan distributed dead-letter console. |
| Dashboard | Widget CRM tetap, mata uang awal IDR; belum dashboard builder, pelaporan lintas currency, dan agregasi server skala besar. |
| Integrasi | Belum email bisnis, webhook eksternal, API token publik, lampiran, import/export CSV, atau file storage. |
| Operasional | Belum backup/PITR otomatis, restore drill, telemetry platform, alert, SLA, security audit, atau uji beban target PRD. |
| Compliance/aksesibilitas | Ada focus ring, label, dialog keyboard/focus trap, alternatif reorder, reduced motion dan mobile layout. Belum audit penuh WCAG 2.2 AA atau review kepatuhan UU PDP. |

UI angka finansial untuk monitoring demo, bukan pembukuan; decimal tersimpan sebagai string dengan maksimum dua desimal. Jangan menggunakan pembulatan widget compact untuk perhitungan kontrak/akuntansi. Waktu tampilan mengikuti lingkungan browser pada versi ini; tenant timezone tersimpan tetapi pengaturan UI timezone lengkap belum tersedia.

## Keamanan dasar yang diterapkan

- Validasi membership aktif dan tenant aktif sebelum handler bisnis.
- Semua query parameterized; field/entity key divalidasi allowlist.
- Role aplikasi non-superuser tanpa BYPASSRLS, konteks tenant/user dengan SET LOCAL, dan composite FK.
- Role runtime tidak memiliki akses tabel identitas global; audit hanya SELECT/INSERT.
- API write memerlukan custom header `X-Flowbase-Client: web`; CORS pihak lain tidak diaktifkan. Batas sederhana 300 request per sesi/IP per menit.
- System-managed field tidak dapat ditulis melalui CRUD generik, bahkan oleh owner.
- Notifikasi worker sementara memakai konteks penerima yang ditentukan server dalam transaksi tenant yang sama, lalu mengembalikan konteks semula. Ini dibutuhkan agar dedupe insert memenuhi policy SELECT penerima.
- Tidak ada eksekusi JavaScript/SQL bebas dari pengguna.

RLS tidak melindungi dari orang yang memiliki kredensial database superuser, dan public demo tidak membuktikan autentikasi pengguna nyata. Jangan mempublikasikan mode demo sebagai layanan data pelanggan.

## Gate sebelum pilot/produksi

1. Ganti demo-session dan auto-bootstrap owner dengan OIDC serta session secure/CSRF yang sesuai domain deployment.
2. Tambahkan provisioning/invitation, manajemen membership, dan control plane tenant tepercaya.
3. Port adapter database ke PostgreSQL server; uji kembali RLS, pool context dan worker concurrency.
4. Pindahkan filtering, pagination, agregasi, dan indeks ke server untuk kapasitas target.
5. Lengkapi worker/control-plane recovery, backup/PITR, telemetry, log redaction, secret manager dan alert.
6. Jalankan threat review, pentest, restore drill, load test, usability test, dan audit aksesibilitas.
7. Review privasi, retensi, penghapusan data dan izin dukungan operator bersama pemilik bisnis.
