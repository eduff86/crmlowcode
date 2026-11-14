# Hasil verifikasi implementasi

Status build: **lulus**. `npm run build` dan `npm run build:pages` berhasil; build server menghasilkan bundle React/Vite production. Dependency audit saat instalasi: tidak ada vulnerability yang dilaporkan npm pada dependency snapshot ini; bukan penetration test.

Status integrasi: **117 assertion lulus** (55 regression + 48 graph/studio + 14 browser bridge) melalui `npm test`. Database sementara di filesystem terpisah, lalu dihapus setelah uji.

Cakupan: seed CRM; metadata runtime; scope own; pembatasan draft/audit member; isolasi tenant/API/reference; header write; validasi uang/system-managed; CRUD; optimistic conflict; idempotent submit; worker approval; notifikasi; non-assignee denial; alasan reject; duplicate decision; approval/auto-approval; stale record conflict; reference delete restriction; draft revision; draft/live separation; publish version/backfill; breaking type rejection; entity custom; UUID validation; inbox recipient; reassignment; rejection; role SQL untuk identity/audit/RLS; lima retry dan dead-letter; persistence setelah database dibuka ulang.

Alur browser diuji dengan Playwright:

- Field enum ditambahkan lewat Studio lalu dipublikasikan sebagai versi baru.
- Field baru otomatis muncul pada form runtime; lead dibuat dengan enum dan dibuka ulang.
- Pencarian menemukan lead sesuai keyword.
- Opportunity dibuat, disimpan, lalu diajukan untuk approval.
- Persona Maya membuka inbox dan menyetujui; jumlah pending turun sesuai keputusan.
- Aplikasi kanvas kosong dibuat; entitas dan field enum custom dikonfigurasi/published tanpa kode.
- Record pengajuan dibuat pada aplikasi custom.
- Navigasi mobile dan perpindahan aplikasi diuji pada viewport 390×844; tidak ada overflow horizontal document pada halaman yang diperiksa.
- Dashboard dan form studio ditinjau visual pada viewport 1440×1000.

Bug yang ditemukan dan diperbaiki saat verifikasi: bootstrap sesi demo ganda; interaksi RLS recipient dengan dedupe notification insert; serta filter pencarian yang terbawa saat berpindah entitas.

Build/test ini tidak membuktikan keamanan produksi, SLA, target beban PRD, restore backup, audit WCAG, crash recovery hard-kill, atau kompatibilitas deployment PostgreSQL server multi-instance.

## Verifikasi Studio 0.2

Graph engine, serial approval, typed data task, exclusive branches, timer recovery, record-created trigger, incident/retry/cancel, conflict guard, pinned version, page sections/visibility, version restore, dan UI handle connection diuji. Rincian tersedia pada `docs-studio-guide.md`. Build React Flow berhasil; bundler melaporkan advisory chunk size dan mengabaikan directive use client pada library, bukan kegagalan build.

## Demo browser gratis

Runtime SQL/workflow yang sama dipisahkan ke `server/core.js`; adapter Node mempertahankan Express/filesystem, adapter demo menjalankan API in-process di Web Worker dengan PGlite/IndexedDB. 14 assertion tambahan menguji middleware, route/params/PATCH, error mapping, query string, draft/publish graf, CRUD, start, persona approval, completion, data task dan scope tenant. Playwright menguji startup WASM di base path GitHub Pages serta persistensi record setelah reload. Bukan database cloud atau keamanan multi-user.
