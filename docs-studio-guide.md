# Flowbase Studio 0.2 — Panduan dan cakupan

## Posisi produk

Flowbase mengikuti pola interaksi studio proses seperti Camunda Modeler dan studio aplikasi seperti Creatio: palet, kanvas graf, properties panel, validasi, deployment versi, runtime dan monitoring. Ini **bukan Camunda engine**, tidak memakai Zeebe/Camunda APIs, tidak menjalankan BPMN XML, dan tidak menyatakan kesetaraan fitur enterprise.

Format executable aplikasi adalah `flowbase-graph-v1` berupa JSON. Impor/ekspor memakai berkas `.flowbase.json`, bukan BPMN 2.0 XML. Label UI “Start event”, “User task”, “Exclusive gateway”, dan “Timer event” menunjukkan pola desain, bukan sertifikasi kompatibilitas BPMN.

## Design Studio

- **Model data:** entitas dan field dengan key stabil; reference antarentitas dalam aplikasi.
- **Form builder:** palet field, drag urutan komponen dan alternatif tombol, default, required, preview, layout 1/2 kolom.
- **Page designer:** judul/deskripsi halaman, section dengan label dan urutan, penempatan field ke section, full-width, placeholder, help text, dan conditional visibility.
- **Data rules:** min/max numerik, panjang teks, enum options, default, required, searchable; constraint diterapkan server pada CRUD dan publish/backfill.
- **List builder:** kolom, urutan dan default sort; runtime search/status filter.
- **Hak akses:** izin member read/create/update/delete per entitas; none/own/all.
- **Versions:** lihat snapshot JSON published/draft, restore snapshot published ke draft, kemudian publish versi baru. Restore tidak mengubah versi live, data bisnis, atau instance aktif secara otomatis.

Conditional visibility mengubah tampilan field, bukan izin data. Required field tidak boleh conditional hidden. Hidden optional field yang memiliki nilai tidak otomatis dihapus. Untuk perpindahan field antar-section gunakan Page designer; Form builder menyelaraskan urutan dalam section dan menambahkan komponen baru ke section pertama.

## Process Modeler

1. Buka **Workflow engine → Buka process modeler**, atau **Design studio → Workflow**.
2. Pilih proses atau klik **Proses baru**; pilih entitas custom atau CRM.
3. Seret elemen dari palet atau klik palet untuk menambah node.
4. Tarik titik source ke titik target. Menghubungkan kembali source/branch mengganti sequence flow lama pada jalur itu.
5. Klik node/edge untuk properties. Klik area kosong untuk properties proses.
6. Jalankan Validasi; pesan dapat dipilih untuk memusatkan kanvas ke node bermasalah.
7. Jalankan Simulasi dengan data JSON dan keputusan approval; tidak menulis database.
8. Simpan draft lalu Publish. Model belum lengkap boleh disimpan, tetapi tidak dapat dipublikasikan.
9. Jalankan dari detail record melalui dropdown **Workflow untuk record** dan **Mulai proses**.

Controls: undo/redo perubahan model, delete node/edge, duplicate node/proses, auto layout, pan/zoom, fit view, fullscreen, minimap, dan import/export JSON. Undo/redo adalah riwayat lokal per proses (maksimum 30), bukan version history database.

## Elemen executable

| Elemen | Runtime |
|---|---|
| Start | Memulai sequence flow dari satu start event |
| End | Menyelesaikan instance dan memberitahu pemilik record |
| User task | Menunggu satu assignee; branches `approved` dan `rejected`; beberapa user task boleh berurutan |
| Exclusive gateway | Evaluasi satu predikat bertipe; branches `true` dan `false` |
| Data task | Menulis konstanta bertipe ke satu field, termasuk system-managed field; bukan SQL/script bebas |
| Notification task | Inbox record owner, initiator, atau anggota yang memiliki akses baca |
| Timer event | Tunda 1–604800 detik melalui durable outbox; dipulihkan setelah server/database reopen |

Trigger: **manual_submit** atau **record_created**. Trigger record-created dan pembuatan record/run/event dicatat dalam satu transaksi. Maksimum 20 workflow/aplikasi, 50 node dan 100 edge/proses. Setiap jalur wajib berakhir; loops dan parallel gateway belum didukung.

## Workflow Engine / Instances

- Ringkasan semua instance, waiting user, running/timer, completed, incident failed, dan conflict.
- Filter status, pencarian proses/record/ID, refresh, detail instance, node aktif, versi pinned, snapshot, decision variables, dan execution history per node.
- **Cancel** untuk admin: menghentikan run, membatalkan task pending dan outbox pending. Side effect data yang telah committed tidak di-undo.
- **Retry failed node** untuk graph-v1: resume dari cursor terakhir; prior committed nodes tidak diulang. Record revision harus tetap cocok.
- **Conflict** tidak dapat di-retry untuk melewati revision guard. Tinjau data lalu mulai instance baru.
- Approvals inbox memakai assignee dan izin baca terkini. Reassign task tetap tersedia pada dialog approval.

Monitor menerima maksimum 100 run dari state API. Daftar record bootstrap maksimum 1.000; filter/pagination/agregasi skala besar masih belum server-side. Widget dashboard tetap CRM.

## Mesin eksekusi

Setiap node diproses sebagai transaksi dengan cursor/history/outbox. Run menyimpan snapshot metadata dan app version saat dimulai. Node berikutnya baru dijadwalkan setelah commit. Delivery at-least-once dilindungi terminal run checks, idempotency start key dan unique event/task constraints.

Timer menyimpan dueAt dalam context serta available_at pada outbox; tidak mengandalkan timer browser. User task menyimpan keputusan pada approval_tasks dan menambah event resume per node. Serial approvals tidak berbagi dedupe event yang sama.

Data task memeriksa tipe terhadap versi pinned dan versi aktif, mengubah revision, serta memperbarui expectedRevision. Record berubah oleh pengguna saat proses menunggu akan menghasilkan conflict sebelum mutasi berikutnya.

Worker tetap single-instance dalam proses Node.js/PGlite. Belum distributed worker, process partitioning, BPMN execution server, compensation/saga engine, parallel join, loop, subprocess/call activity, event/message correlation, DMN, external connectors, script execution, timer boundary escalation, expression variables dinamis, atau real OIDC accounts.

## Verifikasi versi ini

`npm test`: **103 assertion lulus** (55 regression + 48 graph/studio), termasuk migration template, typed validation, siklus/unreachable, graph idempotency setelah completion, exclusive branch, serial approvals, generic entity data task, per-node history, record-created trigger, timer recovery setelah reopen, cancel, bounded retry incident, retry cursor, conflict, version pinning, section/visibility validation dan restore-to-draft.

Playwright: create/publish proses generic Lead, simulasi, configure page sections/help text/visibility, preview visibility new→qualified, start instance dari record, approve melalui persona Maya, instance completed di monitor, tambah timer dan hubungkan handles dengan mouse, validate/publish model, fullscreen dan mobile viewport 390×844.

Belum load test kapasitas PRD, pentest, audit WCAG formal, backup/PITR drill, distribusi multi-instance, atau uji crash hard-kill pada tiap titik commit. Gunakan data contoh saja; demo personas masih terbuka.

## Mode demo GitHub Pages

Fitur yang sama dapat dicoba tanpa backend hosting. Engine dan PostgreSQL berjalan di browser melalui Web Worker; data tersimpan dalam IndexedDB per origin/browser. Tidak ada akun produksi, cloud sync, shared database, atau background workflow saat tab ditutup. Timer yang jatuh tempo dilanjutkan saat dibuka kembali. Tampilan banner selalu menunjukkan batas mode ini. Mode server tetap memakai Express dan data directory.
