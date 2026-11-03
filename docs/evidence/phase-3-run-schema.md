# Phase 3 — Çalıştırma kayıtları ve snapshot (P3-03)

Tarih: 2026-11-03
Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 10.9.8, PostgreSQL 18.1 (Docker, `probedesk-postgres` ve `probedesk-postgres-test`).
Kapsam: yalnızca şema, migration, saf snapshot/servis yardımcıları ve gerçek PostgreSQL kısıt testleri. Başlatma/iptal/yürütücü uçları P3-04 ve sonrasına bırakıldı.

## Sonuç

P3-03 şema katmanı tamamlandı ve In Review'a alındı. `TestRun`, `RunStep`, `Measurement` ve `RunEvent` tabloları; tek RUNNING çalışma kısıtı; kullanıcı kapsamlı idempotency anahtarı; run/step/örnek/olay benzersizlikleri; durum-outcome ve sayaç CHECK kuralları; measurement'ın run-step sahipliğini kanıtlayan kompozit FK; geçmişi koruyan RESTRICT FK'lar ve TRUNCATE reddi eklendi. Migration hem boş bir veritabanına hem mevcut test/geliştirme veritabanlarına uygulandı.

## Eklenen dosyalar ve değişiklikler

- `apps/api/prisma/schema.prisma`: `TestRun`, `RunStep`, `Measurement`, `RunEvent` modelleri ve `RunStatus`, `RunOutcome`, `RunScenario`, `RunStepStatus`, `RunEventType` enum'ları; gerekli geri ilişkiler.
- `apps/api/prisma/migrations/20261103190000_runs/migration.sql`: tablolar, indeksler, CHECK'ler, FK'lar ve TRUNCATE trigger'ları.
- `apps/api/src/prisma/migration-manifest.ts`: `20261103190000_runs` kaydı.
- `apps/api/src/runs/run-domain.ts`: terminal durum kümeleri, olay tipi listesi, Prisma olay kimliğinden sözleşmedeki noktalı ada eşleme, `RUN_EVENT_SCHEMA_VERSION=1`, `MAX_RUN_SEED=4294967295`.
- `apps/api/src/runs/run-snapshot.ts`: yayımlanmış revision + adımlarından immutable run/step satırlarını üreten saf yardımcı; beklenen örnek sayısı, senaryo/seed/olasılık ve kopya alanı doğrulamaları.
- `apps/api/src/runs/run-domain.spec.ts`: terminal durum ve olay adı eşleme birim testleri (3 test).
- `apps/api/src/runs/run-snapshot.spec.ts`: snapshot kopyalama, süre/sayı sınırı ve senaryo doğrulama birim testleri (9 test).
- `apps/api/src/runs/runs.module.ts`: P3-04'te `AppModule`'e bağlanacak modül iskeleti (controller/provider yok).
- `apps/api/test/runs-schema.e2e-spec.ts`: gerçek PostgreSQL kısıt, atomiklik ve readback testleri (10 test).
- `docs/tasks/P3-03.md`: durum ve kanıt alanları.
- Bu kanıt dosyası.

## Migration ve veri modeli özeti

Migration: `20261103190000_runs` (altı migration'ın sonuncusu).

Tablolar:

| Tablo          | Ana kısıtlar                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_runs`    | `(requestedById, idempotencyKey)` unique; `((1)) WHERE status='RUNNING'` partial unique (global tek aktif run); `(planId, startedAt, id)`, `status`, `planRevisionId` indeksleri |
| `run_steps`    | `(runId, position)` unique; `(runId, logicalStepId)` unique; kompozit FK hedefi için `(id, runId)` unique                                                                        |
| `measurements` | `(runStepId, sampleIndex)` unique; `(runStepId, runId)` → `run_steps(id, runId)` kompozit FK                                                                                     |
| `run_events`   | `(runId, sequence)` unique                                                                                                                                                       |

Foreign key'lerin tümü `ON DELETE RESTRICT / ON UPDATE CASCADE`:

- `test_runs.planId` → `test_plans.id`
- `test_runs.planRevisionId` → `plan_revisions.id`
- `test_runs.requestedById` ve `test_runs.cancelledById` → `users.id`
- `run_steps.runId` → `test_runs.id`
- `measurements.(runStepId, runId)` → `run_steps(id, runId)`
- `run_events.runId` → `test_runs.id`

Durum ve kopya CHECK'leri:

- `test_runs_status_outcome_check`: yalnız `COMPLETED` outcome taşır; diğer durumlarda outcome null.
- `test_runs_terminal_timestamps_check`: `RUNNING` için `finishedAt` null; terminal durumlarda dolu ve `finishedAt >= startedAt`.
- `test_runs_completed_counts_check`: `COMPLETED` ise `recordedSampleCount = expectedSampleCount`.
- `test_runs_expectedSampleCount_check`: 1–10.000.
- `test_runs_recordedSampleCount_check`: 0 ≤ recorded ≤ expected.
- `test_runs_eventSequence_check`: ≥ 0.
- `test_runs_seed_check`: 0–4.294.967.295 (BIGINT).
- `test_runs_errorProbability_check`: null veya 0–1.
- `test_runs_scenario_settings_check`: NORMAL'da iki ayar null; FORCED_FAILURE'da yalnız `failureStepId`; RANDOM'da yalnız `errorProbability`.
- `test_runs_planNameSnapshot_check`, `test_runs_versionNumberSnapshot_check`, `test_runs_profileSnapshot_check`: kopya adı/versiyonu ve JSONB profil nesnesi (`id`, `code`, `name`) doğrulanır.
- `run_steps_status_outcome_check`: yalnız `COMPLETED` adım outcome taşır.
- `run_steps_recordedCount_check`, `run_steps_outOfToleranceCount_check`: sayaçlar örnek sayısını ve birbirini aşmaz.
- `run_steps_firstFailure_check`: ihlal sayısı 0 ise indeks null; değilse `0 <= firstFailureSampleIndex < recordedCount`.
- `run_steps_completed_counts_check`: `COMPLETED` adım bütün örnekleri kaydetmiş olmalıdır.
- `run_steps_sampleCount_check` (1–1.000), `run_steps_intervalMs_check` (100–5.000), `run_steps_bounds_check`, `run_steps_limit_check` (±1.000.000.000), `run_steps_position_check`, `run_steps_name_check`, `run_steps_unit_check`.
- `run_steps_statistics_check`: statistics null veya JSONB nesnesi.
- `measurements_sampleIndex_check`: ≥ 0; `measurements_elapsedMs_check`: ≥ 0; `measurements_value_range_check`: NUMERIC(18,6) temsil aralığı.
- `run_events_sequence_check`: ≥ 1; `run_events_schemaVersion_check`: ≥ 1; `run_events_payload_check`: JSONB nesnesi.

`RunEventType` veritabanında sözleşmedeki noktalı adlarla saklanır (`run.started`, `step.started`, `measurement.recorded`, `step.completed`, `run.completed`, `run.cancelled`, `run.interrupted`, `run.errored`). Test, Prisma enum değeriyle yazılan olayın `::text` okumasında `run.started` döndüğünü doğrular.

`test_runs`, `run_steps`, `measurements` ve `run_events` üzerinde `BEFORE TRUNCATE` trigger'ı vardır; satır FK'larını atlayan toplu silme reddedilir.

## Test edilen davranışlar

- İkinci RUNNING run reddedilir; ilk run terminal yapıldıktan sonra yeni RUNNING kabul edilir.
- Aynı kullanıcı + aynı idempotency anahtarı reddedilir; aynı anahtar farklı kullanıcıda kabul edilir.
- Aynı run-step içinde duplicate `sampleIndex` reddedilir; başka run'ın `runId`'siyle measurement yazımı kompozit FK tarafından reddedilir.
- `(runId, position)` ve `(runId, logicalStepId)` aynı run içinde benzersiz; aynı kimlik/sıra başka run'da kullanılabilir.
- Olay sequence run içinde benzersiz; 0 sequence, JSON dizi payload ve 0 schemaVersion reddedilir; aynı sequence başka run'da kullanılabilir.
- Run ve adım için outcome yalnız COMPLETED'da kabul edilir; terminal timestamp, sayaç, seed, olasılık, senaryo ayarı, profil/ad/versiyon snapshot ve step bounds/statistics ihlalleri reddedilir.
- `NUMERIC(18,6)` kolonları information_schema üzerinden doğrulanır; `4.75` değeri `4.750000` olarak okunur; 13 haneli değer numeric taşma ile reddedilir.
- Run + adımlar + measurement + event tek transaction'da commit edilir ve birlikte okunur. Geçersiz measurement içeren ikinci transaction tamamen geri alınır; run/steps kalmaz.
- Geçmişi olan run silinemez (`P2003`); `run_events` ve `test_runs CASCADE` TRUNCATE reddedilir.
- `_prisma_migrations` içindeki tamamlanmış kayıtlar `EXPECTED_MIGRATIONS` ile birebir eşleşir.

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: `apps/api` çalışma alanı, 2026-11-03.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 339ms on 94 files with 107 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/api
> tsc --noEmit -p tsconfig.json
(çıkış kodu 0, hata yok)
```

```text
$ npm run test --workspace apps/api
Test Files  12 passed (12)
Tests       86 passed (86)
Duration    540ms
```

`src/runs/run-snapshot.spec.ts` tek başına: `1 passed (1)`, `9 passed (9)`.
`src/runs/run-domain.spec.ts` tek başına: `1 passed (1)`, `3 passed (3)`.

```text
$ npx vitest run src/prisma/migration-manifest.spec.ts
Test Files  1 passed (1)
Tests       1 passed (1)
```

```text
$ npm run db:migrate:test --workspace apps/api
6 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  11 passed (11)
Tests       103 passed (103)
Duration    10.98s
```

`test/runs-schema.e2e-spec.ts` tek başına: `1 passed (1)`, `10 passed (10)`.

```text
$ npm run build --workspace apps/api
> nest build
(çıkış kodu 0)
```

Boş veritabanı kontrolü: `probedesk_p3_clean_test` veritabanı oluşturuldu, `prisma migrate deploy` ile altı migrationın tamamı uygulandı (`All migrations have been successfully applied.`). `test_runs`, `run_steps`, `measurements`, `run_events` tabloları ve `test_runs_single_running_key` partial unique indeksi doğrulandı; geçici veritabanı sonra silindi.

Geliştirme veritabanı: `npm run db:migrate` ile `20261103190000_runs` uygulandı. Önce/sonra korunan veri: `plans=2`, `revisions=5`, `steps=15`, `users=3`.

## Kalan riskler ve kapsam dışı

- Başlatma, executor, iptal, recovery, snapshot API'si ve SSE bu görevde yok; P3-04 ve sonrası.
- `TestRun.expectedSampleCount` ile `RunStep.sampleCount` toplamı arasındaki çapraz tablo eşitliği DB trigger'ı ile değil, `buildRunSnapshot` ve P3-04 başlatma transaction'ı ile korunur.
- Geçmiş run satırlarında snapshot alanlarının doğrudan SQL ile güncellenmesini engelleyen ayrı bir immutability trigger'ı bu kapsamda eklenmedi; ürün yazma yolu bu alanları güncellemez. P3-04/P3-05 servisleri yalnız durum/sayaç/olay alanlarını yazmalıdır.
- RunStep/Measurement/RunEvent üzerinde uygulama seviyesinde "terminal run'a yazma yok" kontrolü P3-05/P3-07'de kurulacak; şema yalnız yapısal bütünlüğü sağlar.
- `failureStepId` ve `logicalStepId` alanları StepIdentity'ye FK ile bağlanmadı; bunlar sürüm snapshot'ına ait UUID'lerdir ve P3-04 başlatma doğrulaması `failureStepId`'yi yayımlanmış revision'ın adımlarıyla eşleştirecektir.
- TRUNCATE trigger'ları test temizliğinde yalnızca satır silme kullanır; test veritabanı sıfırlama aracı şemayı tamamen düşürdüğü için trigger'lardan etkilenmez.
- Bağımsız teknik inceleme ve kullanıcı kabulü henüz yapılmadı; kart In Review'dadır, Accepted değildir.
