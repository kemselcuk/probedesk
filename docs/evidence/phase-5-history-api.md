# Phase 5 — Geçmiş listeleme ve kayıtlı ölçüm özetleri (P5-01)

Tarih: 2026-11-03
Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 11.6.2, PostgreSQL 18.1 (`probedesk-postgres-test`, 127.0.0.1:5433).
Kapsam: `GET /api/runs` sayfalı/filtreli geçmiş, kayıtlı adım sayaçlarından türetilen özetler ve ilk ihlal bilgisi. Frontend, `packages/api-client`, Prisma şeması/migration ve yeni indeks kapsam dışıdır.

## Sonuç

P5-01 uygulandı ve In Review'a alındı. Planner, Operator ve Viewer rolleri `planId`, `status`, `outcome`, `from`, `to`, `page` ve `limit` filtreleriyle geçmişi okuyabiliyor. Sıra `startedAt DESC, id DESC`; aynı `startedAt` değerine sahip run'lar sayfa sınırında bile kimlikle kararlı sıralanıyor. Liste öğeleri adım veya ölçüm dizileri taşımıyor; ayrıntı için `GET /api/runs/:id` kullanılıyor.

Özetler yalnızca run başlarken kopyalanan `RunStep` satırlarından hesaplanıyor; canlı plana hiçbir sorguyla geri dönülmüyor. Beklenen örnek sayısı `Σ(step.sampleCount)`, alınan örnek sayısı `Σ(step.recordedCount)`, ihlal sayısı `Σ(step.outOfToleranceCount)` ve ilk ihlal adım `position` sırasına göre ilk `firstFailureSampleIndex` değerinden geliyor. Bu nedenle aynı run içinde 2. adımın 0. örneği ile 1. adımın 1. örneği birlikte ihlaldeyse ilk ihlal 1. adımın 1. örneği oluyor.

`partial`, yalnızca alınan örnek sayısı beklenenden azsa `true`. Terminal bir CANCELLED, INTERRUPTED veya ERROR run tüm beklenen örnekleri kaydettiyse `partial=false` kalır; durdurulma bilgisini `status` ve `outcome` taşır. Bu ayrım P5-01 incelemesindeki Bulgu 2'ye göre düzeltilmiştir; ayrıntı ekranı tüm örnekler kaydedilmişken duran run için "All expected samples were recorded" mesajını ayrıca gösterir. Hiç ölçümü olmayan run'da liste `recordedSampleCount: 0`, `outOfToleranceCount: 0`, `firstFailure: null` döndürüyor; ayrıntı snapshot'ındaki adım istatistikleri sıfırla doldurulmadan dört alanda da `null` kalıyor.

## Sözleşme

`GET /api/runs` yanıtı:

```json
{
  "items": [
    {
      "id": "…",
      "planId": "…",
      "planVersionId": "…",
      "planName": "Power rail verification",
      "versionNumber": 2,
      "scenario": "NORMAL",
      "seed": 123456789,
      "status": "COMPLETED",
      "outcome": "FAILED",
      "startedAt": "2026-11-03T12:00:00.000Z",
      "finishedAt": "2026-11-03T12:00:06.200Z",
      "expectedSampleCount": 6,
      "recordedSampleCount": 6,
      "outOfToleranceCount": 2,
      "firstFailure": {
        "stepPosition": 2,
        "stepName": "Current Draw",
        "logicalStepId": "…",
        "sampleIndex": 1
      },
      "partial": false,
      "requestedBy": { "id": "…", "email": "operator@example.com", "role": "OPERATOR" }
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 7,
  "totalPages": 1
}
```

- `limit` varsayılan 20, üst sınır 100. `101`, `0`, kesirli veya sayı olmayan değerler `400 VALIDATION_ERROR` döndürüyor.
- `page` 1 tabanlı. `totalPages` eşleşme yoksa 0; aralık dışı sayfa `200` ve boş `items` döndürüyor, toplamlar değişmiyor.
- `from` dahil, `to` hariç: `[from, to)`. Tam ISO date-time (`Z` veya sayısal offset) ve `2026-11-03` gibi UTC date kabul ediliyor; timezone'suz date-time yerel saat varsayımıyla yorumlanmak yerine reddediliyor.
- `status` ve `outcome` bilinmeyen değerleri, UUID olmayan `planId`, bozuk tarihler ve bilinmeyen query parametreleri ortak hata gövdesiyle (`code`, `message`, `requestId`, `fieldErrors`) reddediliyor.
- `totalPages` için `Math.ceil(total / limit)` kullanılıyor; sayaç ve sayfa aynı `REPEATABLE READ` işleminde okunuyor.

## İndeksler

Sorgu indeksleri:

- `test_runs (planId, startedAt, id)` → plan + tarih filtresi ve `startedAt DESC, id DESC` sırası birlikte.
- `test_runs (status)` → yalnız durum filtresi.
- `test_runs ("startedAt" DESC, id DESC)` (`test_runs_startedAt_id_idx`, ayrı migration) → filtresiz varsayılan geçmiş ve yalnız tarih filtresi; sıralama için tüm tablo taranmaz.

P5-01 incelemesindeki Bulgu 3'e göre `20261103210000_run_history_index` migration'ı eklendi ve test/dev veritabanlarına uygulandı. Testte indeksin varlığı `pg_indexes` ile, varsayılan history sorgusunu karşılayabilmesi ise `EXPLAIN` ile doğrulanıyor; küçük test tablosunda serbest plan Seq Scan olduğu için EXPLAIN kanıtı `enable_seqscan=off` ile alınıyor. `outcome` iki değerli düşük seçicilikli olduğundan ayrı indeks eklenmedi; yalnız `outcome` filtresi aday satırları sıralamaya devam eder.

## Eklenen ve değişen dosyalar

- `apps/api/src/runs/dto/list-runs-query.dto.ts`: filtre/pagination DTO'su, UUID/enum/ISO tarih/aralık doğrulaması, 100 limit sınırı.
- `apps/api/src/runs/dto/run-history.dto.ts`: `RunHistoryPageDto`, `RunHistoryItemDto`, `RunFirstFailureDto`.
- `apps/api/src/runs/run-history.service.ts`: filtrelenmiş `count` + sayfa sorgusu, tekrar edilebilir okuma, adım sayaçlarından özet ve ilk ihlal hesabı; `partial` yalnızca eksik örnek durumunu gösterir.
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261103210000_run_history_index/migration.sql`, `apps/api/src/prisma/migration-manifest.ts`: `test_runs ("startedAt" DESC, id DESC)` indeksi ve migration kaydı.
- `apps/api/test/database.e2e-spec.ts`: indeks varlığı ve varsayılan history sıralamasının `EXPLAIN` ile indeksi kullanabildiği kontrolü.
- `apps/api/src/runs/runs.controller.ts`: `GET /api/runs`, roller, OpenAPI parametreleri ve hata yanıtları.
- `apps/api/src/runs/runs.module.ts`: `RunHistoryService` kaydı.
- `apps/api/test/runs-history.e2e-spec.ts`: gerçek PostgreSQL + Supertest testleri; tüm örnekleri kaydedilmiş CANCELLED run'ın `partial=false` olduğu ayrı senaryo.
- `apps/api/openapi.json`: yeniden üretildi; 7 query parametresi ve üç history şeması eklendi.
- `apps/api/README.md`: history sözleşmesi, örnek yanıt, tarih/partial/ilk ihlal/indeks notları.
- `docs/tasks/P5-01.md`: In Review durumu ve gerçek kontrol sonuçları.
- Bu kanıt dosyası.

## Test edilen davranışlar

- Varsayılan sayfa `page=1, limit=20, total=7, totalPages=1`; tüm öğelerde tam anahtar kümesi doğrulandı; `steps`, `measurements`, `lastEventSequence`, `idempotencyKey` ve `requestHash` yok.
- `startedAt DESC, id DESC`: 7 run'ın tam sırası; aynı `startedAt` değerine sahip iki PASSED run sayfa 3/4 sınırında kimlik azalan sırayla ayrıldı.
- `limit=2` ile 4 sayfa: sayfa 1 [FAILED t6, ERROR t5], sayfa 2 [INTERRUPTED t4, CANCELLED t3], sayfa 3 [FAILED t2, tie], sayfa 4 [tie]. `page=99` boş `items` ve değişmeyen `total/totalPages` döndürdü.
- `planId` A → 4, B → 3; `status=COMPLETED` → 4, `CANCELLED` → 1; `outcome=PASSED` → 2, `FAILED` → 2; `planId+status+outcome` kombinasyonları → 2 ve 1; eşleşmeyen kombinasyon → `total=0, totalPages=0`.
- Tarih: `[2026-11-02T10:00Z, 2026-11-04T10:00Z)` → 2 (tam `to` değerindeki run hariç); 3 günlük aralık → 3; date-only `[2026-11-03, 2026-11-06)` → 3; yalnız `from` → 2; yalnız `to` → 2; tam `from` sınırındaki run dahil → 1.
- PASSED: 6/6, ihlal 0, `firstFailure=null`, `partial=false`. FAILED: ilk ihlal 2. adım 1. örnek; başka FAILED run'da 1. adım 1. örnek, 2. adım 0. örnekten önce seçildi. CANCELLED 1/6 ve INTERRUPTED 0/6 `partial=true`; ERROR 1/6, ihlal 1, ilk ihlal 1. adım 0. örnek ve `partial=true`.
- Geçici CANCELLED run 6/6 örnekle (finalization sırasında iptal senaryosu) `partial=false`, `outcome=null` döndü; aynı filtredeki CANCELLED 1/6 run `partial=true` kaldı. Geçici run test sonunda silindi; varsayılan sayfa `page=1, limit=5, total=8, totalPages=2` ile toplamı ve sayfalamayı doğruladı.
- Tüm run'larda yanıt sayaçları DB `TestRun` sayaçları ve `Σ(RunStep)` değerleriyle karşılaştırıldı; ilk ihlal DB adım sırasından yeniden hesaplandı.
- Hiç ölçümü olmayan INTERRUPTED run'ın snapshot'ında her adımın `statistics` alanı dört alanda `null`, `measurements` boş; history satırı sıfır sayaç ve `firstFailure=null` döndürdü.
- Planner, Operator ve Viewer aynı gövdeyi aldı; oturumsuz istek `401 UNAUTHENTICATED`.
- `planId`, `status`, `outcome`, `from` (bozuk ve timezone'suz), `to` (takvim dışı), `page` (0, 1.5, abc), `limit` (0, 101, abc) ve bilinmeyen query parametresi ayrı ayrı `400 VALIDATION_ERROR` ve doğru `fieldErrors.path` üretti.
- `limit=100` kabul edildi; `limit=101` reddedildi; varsayılan limit 20 doğrulandı.

## Çalıştırılan komutlar ve gerçek sonuçlar

Komutlar `apps/api` çalışma alanında, 2026-11-03 tarihinde sırayla çalıştırıldı. `openapi:emit` en sonda bir kez çalıştırıldı.

```text
$ npm run lint --workspace apps/api
> oxlint --type-aware src/ test/
Found 0 warnings and 0 errors.
Finished in 404ms on 130 files with 107 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/api
> tsc --noEmit -p tsconfig.json
(çıkış kodu 0, hata yok)
```

```text
$ npm run test --workspace apps/api
Test Files  16 passed (16)
Tests       118 passed (118)
Duration    757ms
```

```text
$ npm run db:migrate:test --workspace apps/api
Applying migrations to the isolated test database.
7 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  18 passed (18)
Tests       173 passed (173)
Duration    23.95s
```

Yeni `runs-history.e2e-spec.ts` 10 test içerir; önceki 163 e2e testi de yeşil kaldı (toplam 173). İlk e2e denemesinde iki geçici hata görüldü: yeni testte tüm run'ların `partial=false` olacağı yanlış varsayılmıştı (CANCELLED/INTERRUPTED/ERROR için düzeltildi) ve OpenAPI parametrelerine örnek eklendikten sonra committed doküman yeniden üretilmemişti. Düzeltmelerden ve emit'ten sonra tam suite yeşil.

```text
$ npm run build --workspace apps/api
> nest build
(çıkış kodu 0)
```

```text
$ npm run openapi:emit
> tsx src/common/openapi/emit-openapi.ts
Wrote OpenAPI document to /Users/kemalselcuk/.t3/projects/probedesk/apps/api/openapi.json
```

Son emit sonrası committed dokümanın uygulamayla eşleşmesi ayrıca kontrol edildi:

```text
$ npx vitest run --config ./vitest.config.e2e.ts test/openapi.e2e-spec.ts
Test Files  1 passed (1)
Tests       3 passed (3)
```

## OpenAPI ve istemci

`apps/api/openapi.json` içinde `GET /api/runs` için:

- `security: [{ session: [] }]`
- `planId`, `status`, `outcome`, `from`, `to`, `page`, `limit` query parametreleri (sıralı, açıklamalı, enum ve sınır değerleriyle)
- `200` yanıtı `RunHistoryPageDto`; `400` ve `401` ortak `ApiErrorDto`
- `RunHistoryPageDto`, `RunHistoryItemDto`, `RunFirstFailureDto` component'leri

`packages/api-client` sahiplik dışında olduğu için istemci şeması bu görevde yeniden üretilmedi. Lead `npm run openapi:generate` çalıştırıp üretilen istemciyi commit etmeli; aksi halde `npm run openapi:check` drift verebilir.

## Kalan riskler ve kapsam dışı

- Yalnız `outcome` filtresi için özel indeks yok; iki değerli düşük seçicilik ve "rastgele indeks yok" kuralı nedeniyle eklenmedi. Filtresiz ve tarih-only sorgular artık `test_runs ("startedAt" DESC, id DESC)` indeksini kullanabilir; yalnız `outcome` filtresi aday satırları sıralar.
- `from >= to` isteği hata değil, boş sonuç döndürür; sözleşme bu durum için özel bir hata tanımlamıyor.
- Tarih-saatlerde en fazla milisaniye hassasiyeti kabul edilir; daha uzun kesirli saniye reddedilir. Sayısal offset'ler UTC'ye normalize edilir.
- Liste başına run düzeyinde min/max/ortalama istatistiği bilerek yoktur: adımların birimleri farklı olabilir ve run düzeyinde birleştirme yanıltıcı olur. Adım istatistikleri ayrıntı snapshot'ında kalır; boş ölçümde null davranışı orada doğrulandı.
- `firstFailure` sözleşmede istenen üç alana ek olarak `stepPosition` taşır; frontend'in adımı eşleştirmesi için yararlıdır.
- Özetler `RunStep` satırlarından hesaplanır. Uygulama dışı bir yazma run sayaçları ile adım sayaçlarını tutarsız bırakırsa liste adım toplamlarını esas alır; bu durumda `TestRun` sayaçlarıyla fark inceleme gerektirir.
- Migration ve şema değişikliği yapıldı: `test_runs ("startedAt" DESC, id DESC)` indeksi ayrı bir migration ile eklendi; mevcut `(planId, startedAt, id)`, `status` ve `planRevisionId` indeksleri korundu.
- `ComparisonRunSummaryDto.partial` bu düzeltmenin kapsamı dışında bırakıldı; Phase 6 karşılaştırma sözleşmesi ayrıca aynı tanıma göre değerlendirilmelidir.
- `docs/tasks/README.md` ve `docs/roadmap.md` sahiplik dışında olduğu için güncellenmedi; lead aynı commit'te P5-01 durumunu buralara işlemeli.
- Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı; kart In Review'dadır, Accepted değildir.
