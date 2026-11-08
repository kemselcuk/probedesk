# EX-13 — EX-02 M-1 gerçek önceki migration/seed veritabanı yükseltme kanıtı

- Tarih: 2026-11-08
- Branch: `feat/analytics-reporting-devices`
- Baseline/current HEAD: `49ec0b0c5b9c12be044698f4af3c2cac0e67e367`
- Eski (pre-feature) commit: `e46b740c6ba5fd35326a95326b0427d6a5bf43db`
- Kapsam: Yalnız EX-02 M-1. Bu kayıt EX-13 kartının tamamının veya ürün kabulünün
  kanıtı değildir. Geniş unit/integration/web/E2E/CI suite'leri bu kontrolde yeniden
  çalıştırılmadı.
- Sahiplik: Test sub-agent. Yalnız
  [`scripts/feature-pack-upgrade-check.mjs`](../../../scripts/feature-pack-upgrade-check.mjs)
  ve bu kanıt dosyası eklendi. Uygulama kodu, şema, migration, seed, görev kartı,
  roadmap, README ve başka worker dosyaları değiştirilmedi.

## Yöntem

1. Eski kaynak `git archive` ile `e46b740` commit'inden geçici dizine çıkarıldı.
   `git checkout`, `git worktree`, `git reset` veya `git stash` kullanılmadı; paylaşılan
   checkout ve bağımlılıklar değiştirilmedi.
2. Geçici dizinde eski `schema.prisma` üzerinden eski Prisma client üretildi. `node_modules`
   yalnız okunmak üzere symlink edildi; paket kurulumu ve lockfile değişikliği yapılmadı.
3. Eski 8 migration'ın `migration.sql` dosyaları sırayla ve Prisma uyumlu checksum/
   `_prisma_migrations` kayıtlarıyla uygulandı. Eski `seed.ts` gerçekten çalıştırıldı;
   sentetik fixture kullanılmadı.
4. Seed sonrası veritabanının canonical parmak izi alındı. Idle veritabanı için
   `CREATE DATABASE ... TEMPLATE ...` ile ayrı bir kopya oluşturuldu; bu, host'ta
   `pg_dump` bulunmadığı için temiz `pg_dump`/`pg_restore` eşdeğeri olarak kullanıldı.
   Kopyanın migration öncesi parmak izi kaynakla birebir aynı çıktı.
5. Yükseltme yalnız korumalı `db:migrate:test` komutuyla yapıldı. Ortam değişkenleri
   açıkça verildi; `PROBEDESK_SKIP_DOTENV=1` ile dotenv fallback kapatıldı. Doğrudan
   `prisma migrate deploy` veya `prisma migrate reset` çalıştırılmadı.
6. Yükseltme sonrası aynı canonical parmak izleri, satır sayıları, nullable kolonlar,
   yeni tablolar, FK/unique/check, indeksler, trigger ve migration geçmişi doğrulandı.
   Yalnız bu koşuda oluşturulan iki `_test` veritabanı doğrulama sonunda silindi.

## Çalıştırılan komut ve gerçek sonuç

```text
set -a; . ./.env; set +a
node scripts/feature-pack-upgrade-check.mjs \
  --old-commit=e46b740c6ba5fd35326a95326b0427d6a5bf43db
```

- Exit: **0**
- Geçici eski kaynak: `/var/folders/.../T/probedesk-ex02-upgrade-qCY00G`
- Kaynak DB: `probedesk_ex02_upgrade_c33dc719_source_test` (loopback `127.0.0.1:5433`)
- Kopya DB: `probedesk_ex02_upgrade_c33dc719_copy_test` (aynı sunucu, ayrı veritabanı)
- Bitiş: `EX-02 M-1 upgrade check passed.`
- Temizlik: iki DB de `DROP DATABASE ... WITH (FORCE)` ile silindi; `probedesk_ex02%`
  sorgusu boş liste döndürdü. `5434` geliştirme ve `5432` delivery veritabanlarına
  bağlanılmadı.

Ek olarak:

```text
node --check scripts/feature-pack-upgrade-check.mjs
./node_modules/.bin/prettier --check scripts/feature-pack-upgrade-check.mjs
```

- `node --check`: exit **0**
- Prettier: `All matched files use Prettier code style!`, exit **0**

## Yükseltme çıktısı

```text
10 migrations found in prisma/migrations
Applying migration `20261106120000_devices_and_copy_requests`
Applying migration `20261107120000_analytics_query_indexes`
All migrations have been successfully applied.
```

`_prisma_migrations` sonunda **10 kayıt** vardır; 8 eski migration değişmeden korunmuş,
yalnız iki yeni migration uygulanmıştır. Her kaydın checksum'ı çalışma ağacındaki
`migration.sql` SHA-256 değeriyle eşleşmiştir.

## Eski seed ve korunan veri

Eski seed çıktısı:

```text
Demo users ready: 3 accounts (3 created, 0 already present).
Demo device profiles ready: 1 profiles (1 created, 0 already present).
Demo plan ready: Power Supply Validation (created), 2 published versions,
4 runs (4 created, 0 already present).
  - Partial cancelled v1: CANCELLED/-
  - Forced failure v1: COMPLETED/FAILED
  - Normal v1: COMPLETED/PASSED
  - Normal v2: COMPLETED/PASSED
```

Satır sayıları yükseltme öncesi ve sonrası aynıdır:

| Tablo             | Önce | Sonra | Sonuç |
| ----------------- | ---: | ----: | ----- |
| `users`           |    3 |     3 | MATCH |
| `device_profiles` |    1 |     1 | MATCH |
| `test_plans`      |    1 |     1 | MATCH |
| `plan_revisions`  |    2 |     2 | MATCH |
| `step_identities` |    3 |     3 | MATCH |
| `plan_steps`      |    6 |     6 | MATCH |
| `test_runs`       |    4 |     4 | MATCH |
| `run_steps`       |   12 |    12 | MATCH |
| `measurements`    |  315 |   315 | MATCH |
| `run_events`      |  344 |   344 | MATCH |

Canonical parmak izi, her tablonun eski kolonlarının deterministic sırada tam satır
içeriğinden (UUID, decimal metni, timestamp metni, JSON ve null dahil) SHA-256 ile
hesaplanmıştır. Yeni nullable kolonlar fingerprint kapsamına alınmamıştır; ayrıca
NULL oldukları doğrulanmıştır.

| Tablo             | Satır | Önce = Sonra SHA-256                                               |
| ----------------- | ----: | ------------------------------------------------------------------ |
| `users`           |     3 | `c11deaf0ee3e818a69199d72e0db618ad77426f8bee73b6807dc399ccd6ff387` |
| `device_profiles` |     1 | `358ff2aa6c1aebff090194466890b8688f5fe141a6718b8f0788d4781080ef56` |
| `test_plans`      |     1 | `447b0dccba6bffed712a6da5c6893791fe53f9af65e6a65d1613394f0d1742cc` |
| `plan_revisions`  |     2 | `3fcc3d3a624dffb7820493c84510d7e2654ee9195f3f8850224374cd347afa91` |
| `step_identities` |     3 | `23843995e0f0846a2a88c54d1711bc71a8842843733650d89768387438b04f82` |
| `plan_steps`      |     6 | `4557e667e353ca4b82fb61cb812fbcf25f61671f6d8f09609e9b6b9ebdac302f` |
| `test_runs`       |     4 | `1727357a515c9677028a95ada10a9791492cd568257ddc8b3aa1569797c9e708` |
| `run_steps`       |    12 | `be65cf15c1ff7cd889bdb33cac13a17b52928e934611077a944b87905accd1b4` |
| `measurements`    |   315 | `8daedcaf96bee4608bc024f72999f318c4959e866fd1f17a3444a5da03b2507d` |
| `run_events`      |   344 | `d41087bd4df2052b902a114a1df79d235fe59b712e26baa34da75cce7b3637fa` |
| **Aggregate**     |       | `7a87f6c1e1673279735d6cc34e2a4b18c62de7645a1dd092227330056e99246b` |

`requestHash` ve idempotency anahtarları da `test_runs` fingerprint'i içindedir; ek
olarak ayrı doğrulandı:

| Idempotency key                                       | Durum              | requestHash                                                        |
| ----------------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `demo-seed:power-supply-validation:v1:cancelled`      | CANCELLED / —      | `e4feaa0e2987ce34d8b6117697e5bd1139456fc398dcbd0b21ba31336c67155a` |
| `demo-seed:power-supply-validation:v1:forced-failure` | COMPLETED / FAILED | `a5071285a4de8c629f6f4c1007d5b3f9bba2d8d7bb2cc1d17ff6094ca70cc4fd` |
| `demo-seed:power-supply-validation:v1:normal`         | COMPLETED / PASSED | `e4feaa0e2987ce34d8b6117697e5bd1139456fc398dcbd0b21ba31336c67155a` |
| `demo-seed:power-supply-validation:v2:normal`         | COMPLETED / PASSED | `2934bae228c1f1fa303c19fe91c53bf5af45993e60ea2a3e7ee77ea436f0f804` |

Not: Eski seed her çalışmada yeni UUID ve göreli zaman ürettiği için iki ayrı seed
koşusunun SHA-256 değerleri aynı olmaz. Bu kayıttaki önce/sonra karşılaştırması aynı
koşunun kaynak ve yükseltilmiş kopyası arasındadır.

## Şema doğrulamaları

- `test_runs.deviceId` (`uuid`), `deviceSnapshot` (`jsonb`), `batchNumber` (`text`) ve
  `batchNumberKey` (`text`) eklendi; dördü de **nullable** ve dört eski run'da NULL.
- `devices` ve `plan_copy_requests` tabloları eklendi; yükseltmeden sonra ikisi de boş.
- `devices_deviceProfileId_serialNumberKey_key` ve
  `plan_copy_requests_requestedById_idempotencyKey_key` **unique** indeksleri mevcut.
- `test_runs_deviceId_startedAt_id_idx`, `test_runs_batchNumberKey_startedAt_id_idx`,
  `test_runs_planId_startedAt_id_idx`, `test_runs_startedAt_id_idx`,
  `test_runs_planRevisionId_idx`, `test_runs_status_idx` indeksleri mevcut.
- `devices_deviceProfileId_idx` redundant indeksi EX-08 migration'ı ile kaldırılmış.
- Altı yeni ilişki (`devices` ve `plan_copy_requests` ile `test_runs.deviceId`) gerçek
  PostgreSQL'de `ON DELETE RESTRICT` olarak doğrulandı.
- `test_runs_device_metadata_check`, `test_runs_device_snapshot_check`,
  `test_runs_batch_metadata_check`, `test_runs_batchNumber_check` ve
  `test_runs_batchNumberKey_check` check constraint'leri mevcut.
- Immutability trigger'ı 20 alanı donduruyor: 16 eski alan aynen korunmuş; `deviceId`,
  `deviceSnapshot`, `batchNumber`, `batchNumberKey` eklenmiş. Terminal status kuralı
  korunmuş.
- Eski terminal bir run üzerinde `batchNumber` güncellemesi denendi; trigger
  `SQLSTATE 23514` ile reddetti ve transaction geri alındı.

## Sınırlar ve açık kapılar

- Bu kayıt yalnız **EX-02 M-1** maddesini kapatır. EX-13 kartı ve ürün kabulü açıktır;
  kart durumu ve bağımsız inceleme lead'e aittir.
- 8080 delivery smoke, CI, tam suite'ler, görsel/print ve kullanıcı ürün kabulü bu
  kontrolde çalıştırılmadı; başka kayıtların yerine geçmez.
- Host'ta `pg_dump` bulunmadığından kopya `CREATE DATABASE ... TEMPLATE` ile alındı.
  Kaynak veritabanı idle olduğu için bu, temiz bir dump/restore kopyasıyla aynı içeriği
  üretir; kopyanın migration öncesi parmak izi kaynakla eşleşmiştir.
- Eski migration bootstrap'ı, doğrudan Prisma komutu yerine yardımcı betiğin içinde eski
  `migration.sql` dosyalarını Prisma checksum'larıyla uygular. Mevcut 10 migration'a
  yükseltme yalnız korumalı `db:migrate:test` ile yapılmıştır.
- Yardımcı betiğin ilk iki denemesi kendi doğrulamasında unique indeksleri
  `pg_constraint` sanması nedeniyle başarısız oldu; betik düzeltildi ve yukarıdaki nihai
  koşu exit 0 ile geçti. Ürün kodu veya migration değişmedi.

Lead kod incelemesi: fingerprint eski kolonların tam satırlarını kapsıyor; yeni kolonlar
ayrıca doğrulanıyor. `node --check`, hedefli oxlint (0 warning/error) ve diffcheck
exit0. Son savunma düzeltmesi prefix uzunluğunu PostgreSQL identifier sınırının altında
tutar ve DB cleanup başarısızlığını exit1 yapar; başarılı upgrade yolunu değiştirmez.
