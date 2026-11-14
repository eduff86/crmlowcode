# Skema MVP — Arsitektur, data, dan alur
Versi 0.1 • 15 November 2026 • Rancangan pendamping PRD. Status: fondasi implementasi, bukan kode aplikasi lengkap.

## 1. Keputusan arsitektur
Modular monolith lebih cocok untuk MVP daripada microservices: satu codebase backend, dua proses (API dan worker), satu PostgreSQL. Metadata dirender runtime; aplikasi pengguna tidak menghasilkan kode atau menjalankan SQL/JavaScript bebas.

```text
Browser
  ├─ Studio: Data/Form/List/Workflow Builder
  └─ Runtime: CRM / Dashboard / My Approvals
             │ HTTPS + session/token
             ▼
API — NestJS + TypeScript
  ├─ Auth & Tenant Context ─────────── OIDC Provider
  ├─ Metadata & Publish Validator
  ├─ Record Runtime & Authorization
  ├─ Workflow Commands & Approval
  └─ Audit / Notifications / Dashboard
             │ transaksi, RLS, parameterized SQL
             ▼
PostgreSQL
  ├─ Metadata versioned + JSONB record
  ├─ Relations + workflow runs/tasks
  └─ Audit + transactional outbox
             │ durable event polling
             ▼
Worker ── Redis/BullMQ untuk transport/retry, bukan source of truth
  └─ Execute workflow / create notification / resume approval
```

Frontend: React, TypeScript, React Flow untuk workflow, dnd-kit untuk form, komponen aksesibel. Backend: NestJS, PostgreSQL 16+, driver/query builder dengan dukungan transaksi dan SQL eksplisit. Redis/BullMQ opsional saat awal; worker bisa mem-poll outbox langsung. Container Docker, CI/CD, secret manager, log/metrics, backup. Object storage/email integrasi bisnis belum P0; email undangan dapat ditangani provider identitas.

## 2. Modul dan batas tanggung jawab
| Modul | Tanggung jawab | Larangan |
|---|---|---|
| Identity | Verifikasi token dan membership aktif | Menerima tenant dari body tanpa verifikasi |
| Studio | Draft metadata, form/list, preview | Mengubah published snapshot |
| Publish | Validasi graf, permission, kompatibilitas, backfill | Publish perubahan destructive |
| Runtime | Validasi field, CRUD, referensi, filter | Mengeksekusi ekspresi pengguna sebagai kode |
| Authorization | Role tetap dan entity scope | Mengandalkan UI sebagai kontrol akses |
| Workflow | State machine, idempotency, approval | Auto-approve tugas tanpa penerima aktif |
| Notifications | Inbox per penerima | Menampilkan notifikasi tenant/penerima lain |
| Audit | Append-only perubahan bisnis | Menyimpan token/password atau full PII |

## 3. ERD logis
Notasi: 1:N = satu ke banyak. Kolom tenant_id wajib pada semua tabel tenant-scoped.

```text
tenants 1:N memberships N:1 users
tenants 1:N apps 1:N app_versions
apps 1:1 current published app_version (nullable sebelum publish)
apps 1:N records N:1 app_versions (versi validasi record)
records 1:N record_links N:1 records (reference dalam app yang sama)
records 1:N workflow_runs N:1 app_versions (snapshot workflow)
workflow_runs 1:N approval_tasks N:1 memberships (penerima)
memberships 1:N notifications
tenants 1:N outbox_events
tenants 1:N audit_events
```

Entity, field, form, view, permission, dashboard, dan workflow adalah objek dalam app_versions.definition JSONB, bukan tabel terpisah pada MVP. Ini menghindari mutasi metadata live dan menyederhanakan snapshot atomik. Bila kebutuhan pencarian konfigurasi kompleks meningkat, indeks atau tabel projection dapat ditambah tanpa mengganti sumber metadata.

## 4. Kamus tabel
| Tabel | Kolom inti | Aturan |
|---|---|---|
| tenants | id, name, slug, timezone, status | Satu perusahaan; slug unik |
| users | id, auth_subject, email, display_name | Identitas global; tidak dibaca langsung oleh API runtime |
| memberships | tenant_id, user_id, role, status | PK gabungan; role owner/admin/member; nonaktif bukan dihapus |
| apps | tenant_id, id, key, name, current_version_id | Key unik per tenant; pointer versi terbit |
| app_versions | tenant_id, id, app_id, version_no, status, definition | Draft mutable; published immutable; nomor versi unik per app |
| records | tenant_id, id, app_id, schema_version_id, entity_key, data, owner_id, revision | JSONB object; soft-delete; owner anggota tenant |
| record_links | tenant_id, app_id, source_record_id, field_key, target_record_id | Satu target per source+field; FK mencegah lintas app/tenant |
| workflow_runs | tenant_id, id, app_id, record_id, app_version_id, workflow_key, trigger_key, status, cursor, context | Trigger key unik per app; context berisi snapshot dan revision |
| approval_tasks | tenant_id, id, run_id, node_key, assignee_id, status, decided_by, decision_note | Unik run+node; satu keputusan; assignee anggota tenant |
| notifications | tenant_id, id, recipient_id, type, payload, dedupe_key, read_at | Dedupe per tenant; izin penerima di API dan RLS |
| outbox_events | tenant_id, id, event_key, type, payload, status, attempts, available_at, locked_at, lease_token | Event durable, dedupe, lease recovery |
| audit_events | tenant_id, id, actor_id, action, resource_type, resource_id, changes, request_id, created_at | Append-only untuk role aplikasi; operator retensi terpisah |

Semua UUID dibuat server/database. Nilai uang: JSON string decimal, contoh "12500000.00", currency terpisah. Waktu: timestamptz dan string ISO UTC untuk field datetime; date memakai YYYY-MM-DD. Tombstone record tetap mempertahankan FK, tetapi referensi ke tombstone ditolak layanan.

## 5. Bentuk metadata aplikasi
Contoh berikut adalah subset, bukan seed CRM lengkap atau JSON Schema executable.

```json
{
  "schemaFormat": 1,
  "entities": [
    {
      "key": "opportunity",
      "label": "Opportunity",
      "fields": [
        {"key": "name", "type": "text", "required": true, "maxLength": 200, "searchable": true},
        {"key": "amount", "type": "decimal", "precision": 18, "scale": 2, "min": "0"},
        {"key": "discount_percent", "type": "decimal", "precision": 5, "scale": 2, "min": "0", "max": "100"},
        {"key": "discount_status", "type": "enum", "options": ["none", "pending", "approved", "rejected"], "default": "none", "systemManaged": true},
        {"key": "account", "type": "reference", "targetEntity": "account", "required": true}
      ]
    }
  ],
  "forms": [{"key": "opportunity_main", "entity": "opportunity", "columns": 2, "fields": ["name", "account", "amount", "discount_percent", "discount_status"]}],
  "views": [{"key": "opportunities", "entity": "opportunity", "columns": ["name", "amount", "discount_status"], "sort": {"field": "name", "direction": "asc"}}],
  "permissions": [{"role": "member", "entity": "opportunity", "read": "own", "create": true, "update": "own", "delete": "none"}],
  "workflows": [{"key": "discount_approval", "entity": "opportunity", "trigger": "manual_submit", "start": "threshold", "nodes": [
    {"key": "threshold", "type": "condition", "predicates": [{"field": "discount_percent", "op": "gt", "value": "10"}], "trueNext": "manager", "falseNext": "accept"},
    {"key": "manager", "type": "approval", "assigneeMemberId": "MEMBER_UUID_PLACEHOLDER", "approvedNext": "accept", "rejectedNext": "decline"},
    {"key": "accept", "type": "set_field", "field": "discount_status", "value": "approved", "next": "notice"},
    {"key": "decline", "type": "set_field", "field": "discount_status", "value": "rejected", "next": "notice"},
    {"key": "notice", "type": "notify", "recipient": "record_owner", "next": "end"},
    {"key": "end", "type": "end"}
  ]}],
  "dashboard": {"template": "crm_default"}
}
```

Aplikasi lengkap juga wajib mendefinisikan entity account agar contoh reference valid. Placeholder assignee harus diganti UUID membership aktif; contoh ini sengaja belum bisa dipublikasikan langsung. Trigger domain submit-discount menandai pending, menyimpan snapshot/revision setelah perubahan itu, membuat run/outbox, dan audit dalam satu transaksi. Member tidak boleh menulis systemManaged field lewat CRUD generik.

## 6. Bentuk record dan referensi
```json
{
  "id": "RECORD_UUID",
  "entityKey": "opportunity",
  "schemaVersionId": "VERSION_UUID",
  "ownerId": "USER_UUID",
  "revision": 3,
  "data": {
    "name": "Penawaran ERP PT Contoh",
    "amount": "12500000.00",
    "discount_percent": "15.00",
    "discount_status": "pending"
  },
  "references": {"account": "ACCOUNT_RECORD_UUID"}
}
```

Reference hanya disimpan secara kanonik di record_links; tidak diduplikasi dalam records.data. API membentuk references saat membaca. Field reference diwajibkan/ditipekan oleh metadata validator dan ditulis bersama record dalam satu transaksi. Payload unknown field ditolak. Identitas, tenant, timestamp, owner, revision, serta schemaVersion tidak diterima bebas dari klien.

## 7. Versioning dan publish
1. Edit draft dengan revision/ETag untuk mencegah overwrite builder lain.
2. Validasi struktur metadata, semua field key/reference, izin, node workflow, tidak ada siklus, satu approval maksimum, seluruh jalur memiliki end, dan penerima aktif.
3. Periksa kompatibilitas dengan versi terbit serta data existing. Tambahan required field memerlukan default valid dan backfill.
4. Ambil advisory lock per app; setiap record-write juga mengambil lock yang sama. Jalankan backfill kecil dalam transaksi pilot; bila melewati timeout, publish dibatalkan dan perlu pekerjaan migrasi terjadwal sebelum dicoba lagi.
5. Set versi draft menjadi published dan ubah apps.current_version_id atomik; simpan audit. Published tidak boleh diedit/dihapus.
6. Buat draft berikutnya sebagai salinan versi terbit. Runtime hanya memakai current published version; workflow lama tetap memakai app_version_id sebelumnya.

SQL menyediakan FK dan immutable trigger. Validasi JSON Schema, pembuktian kompatibilitas, read/write lock, serta draft revision berada di service layer dan harus diimplementasikan. Trigger juga memastikan pointer current_version_id mengarah ke published, bukan draft.

## 8. Workflow state machine dan transaksi
```text
queued → running → waiting_approval → running → completed
              ├→ failed
              └→ conflict
waiting_approval → conflict (record berubah sebelum efek lanjutan)
queued/running/waiting_approval → canceled (admin, teraudit)
Approval: pending → approved | rejected | canceled
```

- Run mem-pin definition melalui app_version_id, workflow_key, snapshot trigger, expected_revision, cursor, dan hasil node dalam context.
- Worker mengambil row lock run; satu node set-field memperbarui record, revision, cursor, audit, dan outbox lanjutan dalam transaksi yang sama. Crash setelah commit tidak boleh mengulang efek bisnis.
- Masuk approval menyimpan task dengan unique(run_id,node_key), status waiting_approval, revision yang diharapkan, dan notifikasi durable. Restart membaca state database.
- Endpoint keputusan mengunci task dan run, memverifikasi assignee aktif + read permission + task pending, menyimpan satu keputusan dan event resume atomik. Double-decision mendapat 409.
- Approval decision disimpan walau record sudah berubah; run ditandai conflict dan tidak melakukan efek lanjutan. Admin meninjau lalu melakukan submit baru dengan trigger_key baru, bukan replay mutasi lama.
- Outbox diklaim dengan FOR UPDATE SKIP LOCKED, locked_at dan lease_token. Lease kedaluwarsa dikembalikan pending. Worker hanya boleh menyelesaikan claim bila lease_token masih cocok. Dedupe event/run/notifikasi menangani at-least-once delivery; tidak mengklaim exactly-once transport.
- Tugas reassignment mengunci task, mengganti assignee, membuat notifikasi baru, dan audit. Notifikasi lama boleh tetap sebagai riwayat, tetapi UI dan API selalu memeriksa assignee serta status task terkini; tombol keputusan lama tidak lagi aktif. Member nonaktif tidak otomatis disetujui.
- Workflow sistem boleh menulis field yang diizinkan metadata workflow, tetapi tidak menyamakan hak worker dengan hak semua pengguna. Aturan owner/tenant, validasi tipe, batas field sistem, dan revision tetap berlaku.

## 9. Kontrak API awal
Path bersifat rancangan internal, bukan URL layanan yang sudah tersedia. Semua aksi tenant memverifikasi membership terlebih dahulu. Idempotency-Key wajib untuk submit workflow; revision wajib untuk update record/draft dan publish.

| Method / path | Fungsi | Respons penting |
|---|---|---|
| GET /api/me/tenants | Membership milik pengguna | 200 / 401 |
| GET /api/tenants/:tenant/apps | Daftar aplikasi yang dapat diakses | 200 / 403 |
| POST /api/tenants/:tenant/apps | Buat app dan draft | 201 / 403 / 409 key konflik |
| PUT /api/tenants/:tenant/apps/:app/draft | Simpan metadata + revision | 200 / 409 |
| POST /api/tenants/:tenant/apps/:app/publish | Validate + publish | 200 / 409 / 422 |
| GET /api/tenants/:tenant/apps/:app/entities/:entity/records | List/filter/sort/pagination | 200 / 403 / 422 |
| POST /api/tenants/:tenant/apps/:app/entities/:entity/records | Create record | 201 / 403 / 422 |
| GET/PATCH/DELETE /api/tenants/:tenant/apps/:app/records/:id | Detail/update/soft-delete | 200/204 / 404 / 409 / 422 |
| POST /api/tenants/:tenant/apps/:app/records/:id/submit/:workflow | Submit workflow | 202 + runId / 409 |
| GET /api/tenants/:tenant/approvals/mine | Inbox penerima | 200 |
| POST /api/tenants/:tenant/approvals/:id/decision | Approve/reject | 200 / 403 / 409 |
| POST /api/tenants/:tenant/approvals/:id/reassign | Admin reassign | 200 / 403 / 422 |
| GET /api/tenants/:tenant/apps/:app/dashboard | Agregasi terotorisasi | 200 / 403 |
| GET /api/tenants/:tenant/audit | Audit admin | 200 / 403 |

Error envelope: code, message, requestId, fieldErrors opsional; jangan mengungkap isi record tenant lain. Record tidak terlihat diperlakukan 404. Request list memakai filter DSL bertipe; field key/arah sort diperiksa allowlist, value diparameterisasi. Tidak ada SQL literal dari klien.

## 10. Keamanan dan batas SQL
Schema_MVP.sql menyediakan 12 tabel, composite FK, indeks dasar, RLS tenant, RLS penerima notifikasi, immutable published metadata, dan audit append-only pada role runtime.

Database tidak menyediakan seluruh kebijakan bisnis: active membership, role/action/own scope, field validation, target entity reference, aturan soft-delete, validitas graf, sistem-managed field, dan state transition tetap ditegakkan API/worker. RLS tenant adalah defense in depth, bukan pengganti authorization.

Koneksi runtime harus memakai role terpisah yang bukan pemilik tabel, bukan superuser, tanpa BYPASSRLS. Migrasi/provisioning memakai role terpisah. Dalam setiap transaksi API, backend menjalankan set_config('app.tenant_id', verifiedTenant, true) dan set_config('app.user_id', verifiedUser, true). Worker hanya mengambil tenant dari event database terpercaya, tidak dari payload bebas klien. Gunakan SET LOCAL/transaction-scoped context agar connection pool tidak membocorkan tenant.

Custom PostgreSQL setting tidak kebal manipulasi oleh pihak yang memiliki kredensial database: browser tidak pernah mendapat kredensial/akses SQL; endpoint SQL bebas dilarang. users tidak diberi grant runtime; profil anggota disediakan melalui layanan identity dengan field terbatas. Audit hanya SELECT/INSERT; grant UPDATE/DELETE tidak diberikan. Membership, app metadata, outbox, workflow dan record masih memerlukan authorization service meskipun RLS lulus.

## 11. Indeks, kapasitas, dan pemeliharaan
Indeks dasar: tenant/app/entity/created_at untuk list, owner untuk scope own, task assignee/status, outbox available_at/status, audit created_at, dan GIN data untuk containment. GIN JSONB bukan jaminan pencarian substring/range/sort cepat. Sebelum uji target beban, tambahkan expression index/trigram untuk field searchable terpilih dan numeric/date expression index terkontrol berdasarkan query plan. Dynamic DDL hanya dilakukan migrasi/worker berprivilege terbatas, tidak query pengguna.

Batasi awal: 10 entitas per app, 50 field per entitas, 5 field searchable per entitas, 20 node per workflow, 5 predicate per kondisi, 100 record per halaman, 64 KB JSON per record, metadata 1 MB. Semua batas perlu konfigurasi server serta validasi ukuran. Soft-delete bukan penghapusan permanen atau proses kepatuhan. Tenant deletion/retention menggunakan runbook operator dan tidak dilakukan melalui FK cascade umum.

## 12. Rencana verifikasi implementasi
- Schema: jalankan migration pada database kosong, periksa seluruh FK/constraint/trigger/index/policy.
- Tenant: role non-owner tenant A gagal membaca/menulis tenant B, termasuk relasi/notifikasi/audit; tanpa tenant context tidak ada record terlihat.
- Metadata: draft boleh diubah; published tidak; pointer tidak boleh draft; mismatch versi/app ditolak.
- Runtime: invalid field/reference/systemManaged, inactive membership, own scope, record tombstone, dan revision conflict ditolak.
- Workflow: duplicate trigger, worker crash, concurrent decision, inactive approver, lease expiry, reassignment, serta stale record conflict.
- Operasional: load target PRD, restore backup, worker restart, alert, dan UI keyboard test.

SQL lampiran telah diuji struktural dan sejumlah invariannya pada PostgreSQL embedded kompatibel. Ini tidak menggantikan uji integrasi aplikasi, uji PostgreSQL deployment asli, penetration test, atau pembuktian kapasitas. Tidak ada server produk yang dibuat dalam tahap PRD ini.

## 13. Handoff deployment dan role
Jalankan migrasi dengan akun deployment terpisah pada database kosong. Jangan menjalankan API menggunakan akun migration. Contoh grant berikut dijalankan operator database, dengan autentikasi role diatur melalui secret manager/managed identity, bukan password di repository:

```sql
CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT EXECUTE ON FUNCTION context_tenant(), context_user() TO app_runtime;
GRANT SELECT ON tenants, memberships, apps, app_versions, records,
  record_links, workflow_runs, approval_tasks, notifications,
  outbox_events, audit_events TO app_runtime;
GRANT INSERT, UPDATE ON memberships, apps, app_versions, records,
  workflow_runs, approval_tasks, outbox_events TO app_runtime;
GRANT INSERT, UPDATE, DELETE ON record_links TO app_runtime;
GRANT INSERT ON notifications, audit_events TO app_runtime;
GRANT UPDATE (read_at) ON notifications TO app_runtime;
```

Buat login layanan terpisah yang menjadi anggota role di atas dan tanpa privilege elevated. NOLOGIN adalah role kelompok, bukan kredensial siap pakai. Provider/provisioning tetap mengelola users dan tenants melalui jalur kontrol terpisah; tidak ada grant users kepada runtime. Draft tidak perlu physical delete untuk P0; overwrite draft memakai revision.

Dispatcher perlu daftar tenant aktif dari control plane/registry tepercaya, kemudian membuka transaksi dengan konteks satu tenant untuk polling outbox. Registry tidak memberikan data bisnis. Pilot dapat memakai daftar tenant dari provisioning service. Jangan memberi worker umum BYPASSRLS hanya untuk mem-poll lintas tenant. Pengambilan claim, pemrosesan, dan retry semuanya memakai konteks tenant event yang tervalidasi. Jika memilih BullMQ, dispatcher tetap menggunakan outbox database dan tidak menganggap enqueue Redis sebagai bukti efek bisnis selesai.

Validasi lampiran: 19 pemeriksaan lulus, mencakup migrasi 12 tabel, edit draft, larangan pointer ke draft, immutable published version, valid reference, penolakan reference lintas tenant/aplikasi, mismatch versi record, trigger duplicate, validitas keputusan, RLS tanpa konteks/lintas tenant, notifikasi per penerima, audit tidak berubah melalui role non-owner, dan pembatasan users. Uji ini berjalan di PGlite/PostgreSQL embedded; jalankan ulang pada PostgreSQL 16+ deployment asli sebelum pilot. Dokumen Word lulus validasi OOXML.
