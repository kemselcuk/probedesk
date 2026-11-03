# Phase 2 inceleme bulguları — API düzeltmeleri

- Tarih: 2026-11-03
- Kapsam: `docs/evidence/phase-2-review.md` içindeki H-01, M-05, M-06 ve L-10 bulgularının API/veritabanı tarafı.
- Ortam: macOS, Node.js `22.23.2`, PostgreSQL 18 geliştirme `127.0.0.1:5434/probedesk`, test `127.0.0.1:5433/probedesk_test`.
- Bu kayıt bağımsız bir ürün kabulü değildir. P2-01 ve P2-06 kartları `In Review` durumunda bırakılmıştır.

## 1. Yapılan düzeltmeler

### H-01 — Publish öncesi saklanmış ad doğrulaması

- `apps/api/src/plans/plan-limits.ts`: `assertPublishableName` eklendi. Kaydetme ile aynı kural uygulanır: `trim()` sonrası 1–100 karakter; ihlalde `VALIDATION_ERROR` ve `name` alan yolu üretilir.
- `apps/api/src/plans/plans.service.ts`: `publishDraft` hem DRAFT→PUBLISHED geçişinden önce hem de geçiş sonrası yeniden okunan satırda adı doğrular. Böylece doğrudan SQL ile bozulmuş eski bir satır publish edilemez.
- `apps/api/prisma/migrations/20261103180000_plan_revision_integrity/migration.sql`: `plan_revisions_name_check` eklendi:
  `char_length(btrim("name")) BETWEEN 1 AND 100`. Migration mevcut satırları doğrular; geçersiz satır varsa sessizce silmeden hata verir.
- Liste/detay okuma yolu: `resolvePlanName` eklendi. Geçerli draft adı yoksa yayımlanmış ad, o da yoksa `Untitled plan` kullanılır. Tek bozuk/eski satır artık tüm liste veya detay isteğini 500 yapmaz.

### M-05 — `baseVersionId` sahipliği

- `plan_revisions_baseVersionId_fkey` kaldırıldı; yerine
  `plan_revisions_baseVersionId_planId_fkey` kompozit FK'si eklendi:
  `("baseVersionId", "planId") REFERENCES plan_revisions("id", "planId")`.
- `plan_revisions_base_version_is_published` BEFORE INSERT OR UPDATE OF `baseVersionId` trigger'ı, dolu `baseVersionId` değerinin `PUBLISHED` bir revision'a işaret etmesini zorunlu kılar. Aynı plan kontrolünü kompozit FK yapar.
- `apps/api/prisma/schema.prisma` içindeki `baseVersion` ilişkisi kompozit hedefi yansıtacak şekilde güncellendi.

### M-06 — Published immutability ve metadata bütünlüğü

- `plan_revisions_reject_published_insert` BEFORE INSERT trigger'ı doğrudan `PUBLISHED` satır eklenmesini reddeder. Published revision yalnızca DRAFT→PUBLISHED geçişiyle oluşur.
- `plan_revisions_reject_truncate` ve `plan_steps_reject_truncate` BEFORE TRUNCATE statement trigger'ları `TRUNCATE` ve `TRUNCATE ... CASCADE` işlemlerini reddeder.
- `plan_revisions_validate_published_transition` AFTER UPDATE constraint trigger'ı (DEFERRABLE INITIALLY DEFERRED) geçişte en az bir `plan_step` ve `publishedById` alanında `PLANNER` rolü ister.
  - Deferred seçildi: publish servisi geçiş sonrası içeriği yeniden okur; yarışan doğrudan yazım varsa COMMIT'ten önce 409 `DRAFT_CHANGED` ile döner. Deferred trigger doğrudan SQL için son savunma katmanıdır ve COMMIT'te işlemi reddeder.
- Mevcut DRAFT→PUBLISHED yolu, publish/clone/race testleri korunarak geçti.

## 2. Eklenen gerçek PostgreSQL/HTTP testleri

- `apps/api/test/plans-schema.e2e-spec.ts`
  - Boş, yalnız boşluk ve 101 karakterlik revision adının doğrudan SQL ile reddi (`plan_revisions_name_check`).
  - Doğrudan `INSERT ... state='PUBLISHED'` reddi.
  - `TRUNCATE plan_steps` ve `TRUNCATE plan_revisions CASCADE` reddi; satırların korunması.
  - Adımsız DRAFT→PUBLISHED geçişinin reddi; satırın DRAFT kalması.
  - `VIEWER` yayınlayanla DRAFT→PUBLISHED geçişinin reddi; satırın DRAFT kalması.
  - Başka planın published revision'ının `baseVersionId` olarak reddi (kompozit FK).
  - DRAFT revision'ın `baseVersionId` olarak reddi (state trigger'ı).
  - Eski doğrudan `PUBLISHED` insert yardımcıları, gerçek DRAFT→PUBLISHED geçişine çevrildi.
- `apps/api/test/plan-publish.e2e-spec.ts`
  - CHECK geçici olarak kaldırılarak eski/bozuk boş adlı draft simüle edildi; publish 400 `VALIDATION_ERROR` ve `name` alan hatası döndürdü.
  - Aynı bozuk satır varken Planner/Operator/Viewer liste ve detay istekleri 200 döndü; fallback olarak yayımlanmış ad kullanıldı. Yalnız draft'ı olan ve adı boş bırakılan plan için Planner liste/detay `Untitled plan` ile 200 döndü.
  - CHECK geri eklendikten sonra doğrudan SQL rename reddedildi ve liste/detay yine 200 kaldı.
- `apps/api/test/plans.e2e-spec.ts`
  - En yüksek published sürüm testi, doğrudan INSERT yerine geçerli DRAFT→PUBLISHED geçişi kullanacak şekilde güncellendi.

## 3. Migration ve veritabanı uygulaması

- Yeni migration: `apps/api/prisma/migrations/20261103180000_plan_revision_integrity/migration.sql`.
- `apps/api/src/prisma/migration-manifest.ts` beş migration'ı listeler.
- Test veritabanına uygulandı; ardından `No pending migrations to apply.` alındı.
- Geliştirme veritabanına uygulandı; mevcut 2 plan, 5 revision ve 15 step korundu.
- Boş geçici PostgreSQL veritabanına beş migration'ın tamamı uygulandı (`probedesk_review_fix_empty`, inceleme sonunda silindi): 5/5 migration `finished_at` dolu, `plan_revisions_name_check` ve kompozit FK doğrulanmış, 7 kullanıcı trigger'ı etkin.
- Geliştirme verisinde doğrulama (uygulama sonrası):

```text
invalid_names | invalid_base_versions | invalid_publishers | published_without_steps
--------------+-----------------------+--------------------+-------------------------
            0 |                     0 |                  0 |                       0
```

```text
 plans | revisions | steps
-------+-----------+-------
     2 |         5 |    15
```

## 4. Çalıştırılan kontroller ve gerçek sonuçlar

Sıra: lint → typecheck → unit test → test migration → e2e → build.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 349ms on 83 files with 107 rules using 8 threads.
EXIT: 0
```

```text
$ npm run typecheck --workspace apps/api
tsc --noEmit -p tsconfig.json
EXIT: 0
```

```text
$ npm run test --workspace apps/api
Test Files  9 passed (9)
Tests       43 passed (43)
Duration    403ms
EXIT: 0
```

```text
$ npm run db:migrate:test --workspace apps/api
5 migrations found in prisma/migrations
No pending migrations to apply.
EXIT: 0
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  10 passed (10)
Tests       93 passed (93)
Duration    10.21s
EXIT: 0
```

```text
$ npm run build --workspace apps/api
nest build
EXIT: 0
```

API yüzeyi değişmediği için `apps/api/openapi.json` yeniden üretilmedi. Mevcut sözleşme kontrolü:

```text
$ npm run openapi:check
OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
EXIT: 0
```

## 5. Doğrudan SQL şema kontrolleri

Geliştirme veritabanında:

```text
plan_revisions_baseVersionId_planId_fkey | FOREIGN KEY ("baseVersionId", "planId") REFERENCES plan_revisions(id, "planId") ON UPDATE CASCADE ON DELETE RESTRICT | validated
plan_revisions_name_check                | CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 100)))                                      | validated
```

Etkin trigger'lar (`tgenabled = 'O'`):

```text
plan_revisions_base_version_is_published
plan_revisions_reject_published_insert
plan_revisions_reject_truncate
plan_revisions_validate_published_transition
plan_steps_reject_truncate
plan_steps_published_immutable
plan_revisions_published_immutable
```

Şema drift kontrolü:

```text
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- This is an empty migration.
```

E2E testleri doğrudan SQL ile şu redleri doğruladı: boş/boşluklu/101 karakter ad, doğrudan `PUBLISHED` INSERT, `TRUNCATE plan_steps`, `TRUNCATE plan_revisions CASCADE`, çapraz plan `baseVersionId`, DRAFT `baseVersionId`, adımsız geçiş ve `VIEWER` yayınlayan. Ayrıca H-01 senaryosunda publish 400 `VALIDATION_ERROR` (`name`) döndü ve liste/detay 200 kaldı.

## 6. Kalan riskler ve notlar

- M-06'da istenen kapsam uygulandı; `versionNumber`'ın DB seviyesinde `max+1` olması bu düzeltmede ayrıca zorlanmadı. API publish yolu plan satırı kilidi altında `max+1` atamaya devam eder; doğrudan SQL ile DRAFT→PUBLISHED geçişinde farklı bir sürüm numarası seçilebilir.
- `plan_revisions_name_check`, `btrim` ile yalnız boşlukları kırpar; API `trim()` daha geniş Unicode boşluklarını temizler. Plan adımı CHECK'i ile aynı davranış korunmuştur.
- Liste/detay fallback'i `Untitled plan` sabitini kullanır. Bu yalnızca eski/bozuk veri için savunma katmanıdır; yeni API yazımları ad doğrulaması ve CHECK nedeniyle bu duruma gelemez.
- H-01 testi, eski/bozuk satırı simüle etmek için yalnızca izole test veritabanında CHECK'i geçici olarak kaldırıp `finally` içinde geri ekler.
- Immutability trigger'ları yalnızca şema sahibi tarafından devre dışı bırakılabilir; üretimde API rolünün tablo sahibi olmaması gereksinimi P2-06 kapsamındaki gibi açık kalmıştır.
- `packages/api-client` ve kök `openapi.json` bu görevin sahipliğinde değiştirilmedi; API yüzeyi değişmediği için yeniden üretim gerekmedi.
