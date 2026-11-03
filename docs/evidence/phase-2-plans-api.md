# Phase 2 plan veri modeli ve API kanıtı

- Tarih: 2026-11-03
- Kapsam: P2-01 (plan/revision/step veri modeli, migration, demo profil seed'i, `GET /api/device-profiles`) ve P2-02 (plan oluşturma, role uygun okuma, atomik taslak kaydı).
- Ortam: Node.js 22.23.2; geliştirme PostgreSQL 18 `127.0.0.1:5434`; test PostgreSQL 18 `127.0.0.1:5433` (`probedesk_test`).
- Uygulama commit'i: Bu çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge commit hash'i iddia etmez.
- Kapsam dışı: Publish, yeni taslak oluşturma ve sürüm listeleme uçları (P2-03/P2-04/P2-06). `packages/api-client` üretimi bu görevin sahipliğinde değildir.

## P2-01 — Veri modeli, migration ve profil seed'i

### Eklenen tablolar ve kısıtlar

| Nesne | Doğrulanan davranış |
|---|---|
| `test_plans` | UUID kimlik, profil ve oluşturan kullanıcı FK'ları, `RESTRICT` silme. |
| `plan_revisions` | `DRAFT`/`PUBLISHED` enum; `editRevision >= 1`; taslakta `versionNumber` null; yayımlanmışta sürüm, yayınlayan ve zaman zorunlu. |
| `plan_revisions_planId_draft_key` | Partial unique index: plan başına en fazla bir açık taslak. |
| `plan_revisions_planId_versionNumber_key` | Partial unique index: null dışındaki sürüm numarası plan içinde benzersiz. |
| `step_identities` | Kalıcı mantıksal adım kimliği; tam olarak bir plana ait. |
| `plan_steps` | `(revisionId, position)` ve `(revisionId, logicalStepId)` benzersiz; `(revisionId, planId)` ve `(logicalStepId, planId)` composite FK'ları başka planın revision/kimliğini reddeder. |
| Sayısal sınırlar | `NUMERIC(18,6)`; `minimum <= maximum`; örnek/aralık DB checkleri; geçmişi silen cascade yok. |

Partial unique index'ler ve table check'leri Prisma şemasının ifade edemediği korumalardır; `prisma/migrations/20261103160000_plans/migration.sql` içinde elle yazıldı. Şemanın geri kalanı normal Prisma modelidir (`prisma/schema.prisma`).

### Migration kanıtı

Test veritabanı önceki aşamadaki iki migration'ı içeriyordu; üçüncü migration uygulandı:

```text
$ npm run db:migrate:test --workspace apps/api
Applying migrations to the isolated test database.
Datasource "db": PostgreSQL database "probedesk_test", schema "public" at "127.0.0.1:5433"
3 migrations found in prisma/migrations
Applying migration `20261103160000_plans`
All migrations have been successfully applied.
```

Aynı migration boş bir veritabanına baştan uygulandı (`probedesk_empty_p2`):

```text
Applying migration `20261103120000_init`
Applying migration `20261103130000_session_csrf_token_optional`
Applying migration `20261103160000_plans`
All migrations have been successfully applied.
```

Boş veritabanında beklenen 15 index ve 15 FK/check kısıtı listelendi; doğrulama sonrası geçici veritabanı silindi. Geliştirme veritabanı da önceki iki migration'dan üçüncüye yükseltildi:

```text
$ npm run db:migrate
Applying migration `20261103160000_plans`
All migrations have been successfully applied.
```

### Demo profil seed'i

`prisma/seed-device-profiles.ts` tek `DC_POWER_MODULE` profilini (`DC Power Module`) code üzerinden idempotent ekler; var olan satırı güncellemez. İki ardışık çalıştırma:

```text
$ npm run demo:seed
Demo users ready: 3 accounts (0 created, 3 already present).
Demo device profiles ready: 1 profiles (1 created, 0 already present).

$ npm run demo:seed
Demo users ready: 3 accounts (0 created, 3 already present).
Demo device profiles ready: 1 profiles (0 created, 1 already present).
```

## P2-02 — Plan API sözleşmesi

| Yöntem | Yol | Rol | Davranış |
|---|---|---|---|
| GET | `/api/device-profiles` | P/O/V | Profil dizisi; seed edilen `DC Power Module` dahil. |
| POST | `/api/plans` | P | `name` + `profileId`; plan ve boş `DRAFT` (`editRevision=1`, `versionNumber=null`) tek transaction. |
| GET | `/api/plans` | P/O/V | Planner tüm planları taslak adı/özetiyle görür; O/V yalnız yayımlanmış planları görür, `draft` alanı hiç gönderilmez. |
| GET | `/api/plans/:id` | P/O/V | Planner açık taslağı adımlarıyla alır; O/V yalnız son yayımlanmış revision içeriğini alır; yalnız taslağı olan plan O/V için 404. |
| PUT | `/api/plans/:id/draft` | P | `name`, `expectedRevision`, tam `steps` listesi; sıra otoriter, pozisyonlar sunucuda, yeni `logicalStepId` sunucuda üretilir. |

Yanıt biçimi OpenAPI'de tanımlıdır. Liste ve detayda `latestPublishedVersion`, `{ id, versionNumber, publishedAt }` özetidir; profil `profile` alanındadır. `draft` yalnız Planner yanıtında bulunur. Tüm limit değerleri altı ondalıklı kanonik metin olarak döner (`"4.750000"`).

### Doğrulama davranışı

- Plan/adım adı trim sonrası 1–100; birim 1–16; taslak 0–30 adım.
- `sampleCount` 1–1000, `intervalMs` 100–5000, toplam örnek ≤10.000, nominal süre ≤600.000 ms.
- Ondalık yalnız `-?(0|[1-9]\d*)(\.\d{1,6})?`; bilimsel gösterim, virgül, `NaN`, `Infinity`, 1e9 dışı ve 6'dan fazla ondalık reddedilir; `minimum <= maximum` tam ölçekli `bigint` ile karşılaştırılır.
- Bilinmeyen üst/alt alanlar `fieldErrors` içinde `steps.N.field` yoluyla döner.
- `expectedRevision` uyuşmazlığı 409 `DRAFT_CONFLICT` (`details.currentRevision`) ve hiçbir satır değişmez.
- Başka planın `logicalStepId` değeri veya aynı istekte tekrarı 400 `VALIDATION_ERROR` (`steps.N.logicalStepId`) olur; yeni kimlik oluşturulmaz.
- Plan satırı `FOR UPDATE` ile kilitlenir; aynı `expectedRevision` ile eşzamanlı iki kayıttan biri 200, diğeri 409 alır.

## Çalıştırılan kontroller (gerçek çıktılar)

Aşağıdaki komutlar sırayla, kod son hali üzerinde çalıştırıldı.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 287ms on 80 files with 107 rules using 8 threads.

$ npm run typecheck --workspace apps/api
tsc --noEmit -p tsconfig.json
(çıkış kodu 0; hata yok)

$ npm run test --workspace apps/api
Test Files  9 passed (9)
Tests       43 passed (43)

$ npm run db:migrate:test --workspace apps/api
3 migrations found in prisma/migrations
No pending migrations to apply.

$ npm run test:e2e --workspace apps/api
Test Files  9 passed (9)
Tests       76 passed (76)
Duration    9.79s

$ npm run build --workspace apps/api
nest build
(çıkış kodu 0; hata yok)

$ npm run openapi:emit
Wrote OpenAPI document to .../apps/api/openapi.json
```

Emit sonrası OpenAPI senkron testi ayrıca doğrulandı:

```text
$ npx vitest run --config ./vitest.config.e2e.ts test/openapi.e2e-spec.ts
Test Files  1 passed (1)
Tests       3 passed (3)
```

### Test kapsamı

- `test/plans-schema.e2e-spec.ts`: gerçek PostgreSQL üzerinde sürüm tekilliği, tek taslak, sıra/kimlik tekilliği, çapraz plan revision/kimlik reddi, aynı kimliğin sonraki revision'da korunması, `NUMERIC(18,6)` okuma, history `RESTRICT` davranışı, draft/published check kısıtları.
- `test/plans.e2e-spec.ts`: Supertest + gerçek PostgreSQL; oluşturma, rol matrisi, CSRF, 404 sızıntı testleri, liste/detay role göre içerik, sıra koruma, kimlik koruma, boş adım, sınır değerleri, tüm doğrulama yolları, stale revision ve eşzamanlı iki kayıt.
- `test/demo-seed.e2e-spec.ts`: `DC Power Module` profilinin idempotent seed'i ve var olan satırı ezmemesi.
- `test/openapi.e2e-spec.ts`: yeni yolların, güvenlik şemalarının, DTO'ların ve commit edilen belgenin uyumu.
- `src/plans/plan-decimal.spec.ts`: kanonik ondalık ayrıştırma/biçimlendirme sınırları.

## Açık noktalar ve riskler

1. `packages/api-client` yeniden üretilmedi; bu path bu görevin sahipliğinde değil. `apps/api/openapi.json` günceldir; istemci tipleri ve web'deki geçici plan tipleri lead/P1-05/P7-06 kapsamında yeniden üretilmelidir. Bu nedenle kök `npm run openapi:check` çalıştırılmadı (eski istemci paketiyle uyumsuz çıkması beklenir).
2. Publish, yeni taslak oluşturma ve sürüm listeleme uçları bu iki görevin kapsamı dışındadır; `publishedById`, `publishedAt` ve sürüm ataması P2-03/P2-06'da tamamlanacaktır. Migration'daki `plan_revisions_state_fields_check` yayımlanmış satırda bu alanları zorunlu tutar.
3. Eşzamanlılık testi iki gerçek HTTP isteğiyle doğrulanır; uzun süreli yük/soak testi değildir ve çok süreçli dağıtım garantisi vermez (sözleşme tek API süreci).
4. Bağımsız teknik inceleme henüz yapılmadı; bu nedenle görev kartları `In Review` durumundadır, `Accepted` değildir.
