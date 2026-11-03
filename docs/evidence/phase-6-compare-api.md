# Phase 6 — Karşılaştırma API'si (P6-01)

Tarih: 2026-11-03
Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, PostgreSQL 18.1 (`probedesk-postgres-test`, 127.0.0.1:5433).
Kapsam: `GET /api/comparisons?leftRunId=&rightRunId=`, iki terminal run'ın kendi snapshot'ları, `logicalStepId` eşleşmesi, sürüm/kural farkları, birim ve örnekleme farkları, kısmi terminal run'lar. Frontend, `packages/api-client`, Prisma şeması/migration ve yeni indeks kapsam dışıdır.

## Sonuç

P6-01 uygulandı ve In Review'a alındı. Planner, Operator ve Viewer rolleri aynı planın iki terminal run'ını okuyabiliyor. İki run ve tüm adım/ölçüm satırları tek bir `REPEATABLE READ` işleminde okunuyor; yanıt yalnızca run başlarken kopyalanan kuralları, verdict'leri ve ölçümleri taşıyor. Canlı plana, taslağa veya yeni sürüme hiçbir sorguyla dönülmüyor.

Adım eşleşmesi yalnızca kalıcı `logicalStepId` ile yapılıyor. Aynı sürümde PASSED/FAILED, farklı sürümlerde rename/reorder/limit/sampleCount/intervalMs değişimi, birim değişimi ve aynı adla silinip yeniden eklenen adım ayrı ayrı doğrulandı. Birim aynıysa özetler yan yana ve `right - left` delta ile dönüyor; birim farklıysa `numericComparison.statistics` `null` ve delta yok. Her seri kendi `sampleIndex` ve `elapsedMs` değerleriyle taşınıyor; indeks hizalama, interpolasyon, pad veya sıfır doldurma yapılmıyor. CANCELLED, INTERRUPTED ve ERROR run'ları karşılaştırılabiliyor; outcome ve eksik istatistikler `null`, eksik ölçümler boş dizi.

## Sözleşme

`GET /api/comparisons?leftRunId=<uuid>&rightRunId=<uuid>` — P/O/V, oturum cookie'si; mutasyon olmadığı için CSRF gerekmez.

Başarılı yanıtın üst düzey alanları:

```json
{
  "planId": "…",
  "versionDifference": {
    "sameVersion": false,
    "leftVersionNumber": 1,
    "rightVersionNumber": 2
  },
  "leftRun": { "…": "ComparisonRunSummaryDto" },
  "rightRun": { "…": "ComparisonRunSummaryDto" },
  "matchedSteps": [
    {
      "logicalStepId": "…",
      "changedFields": [
        { "field": "unit", "left": "A", "right": "mA" },
        { "field": "position", "left": 2, "right": 1 },
        { "field": "minimum", "left": "0.450000", "right": "450.000000" },
        { "field": "maximum", "left": "0.550000", "right": "550.000000" }
      ],
      "numericComparison": {
        "comparable": false,
        "reason": "UNIT_MISMATCH",
        "statistics": null
      },
      "left": { "…": "RunSnapshotStepDto" },
      "right": { "…": "RunSnapshotStepDto" }
    }
  ],
  "addedSteps": [{ "…": "right-only RunSnapshotStepDto" }],
  "removedSteps": [{ "…": "left-only RunSnapshotStepDto" }]
}
```

- `ComparisonRunSummaryDto`: `id`, `planId`, `planVersionId`, `planName`, `versionNumber`, `profile`, `scenario`, `seed`, `errorProbability`, `failureStepId`, `simulatorVersion`, `evaluationVersion`, `status`, `outcome`, `startedAt`, `finishedAt`, `requestedBy`, `reasonCode`, `expectedSampleCount`, `recordedSampleCount`, `outOfToleranceCount`, `stepCount`, `partial`.
- `ComparisonRunSummaryDto` sayaçları kopyalanmış `RunStep` satırlarından hesaplanır. `partial`, run `COMPLETED` değilse veya alınan örnek sayısı beklenenden azsa `true`.
- Eşleşen adımlar sol run'ın `position`, ardından `logicalStepId` sırasına göre; eklenen/kaldırılan adımlar kendi taraflarının `position`, ardından `logicalStepId` sırasına göre döner. Yanıtta üretim zamanı yoktur; aynı kayıtlı veri aynı JSON'u üretir.
- `changedFields` `{field, left, right}` nesnelerinden oluşur ve sabit sıradadır: `name`, `unit`, `position`, `minimum`, `maximum`, `sampleCount`, `intervalMs`. Yalnızca değişen alanlar bulunur; her iki değer de ilgili run'ın kendi snapshot'ındandır.
- `leftRun`/`rightRun` run özetleridir; eşleşen adımdaki `left`/`right` nesneleri run snapshot adım şekliyle aynıdır: kopyalanmış kurallar, status/outcome, sayaçlar, `statistics` ve `measurements`. Değerlendirme eski sınırlarla korunur; yeni sürüm yayımlanması eski run'ı değiştirmez.
- Birim aynıysa `numericComparison` = `{comparable: true, reason: "SAME_UNIT", statistics: {...}}`. `statistics.minimum/maximum/average` her biri `{left, right, delta}` ondalık metin, `sampleCount` ise `{left, right, delta}` tamsayıdır. `delta = right - left`; bir taraf `null` ise delta da `null`.
- Birim farklıysa `numericComparison` = `{comparable: false, reason: "UNIT_MISMATCH", statistics: null}`. Hiçbir sayısal delta üretilmez; birim değişimi ayrıca `changedFields` içindeki `unit` girdisinde görünür.
- Her ölçüm `{sampleIndex, value, isWithinTolerance, recordedAt, elapsedMs}` taşır. İki seri arasında indeks hizalama, interpolasyon veya ortak eksen üretimi yoktur; `sampleCount` veya `intervalMs` değişse bile diziler kendi uzunluklarında ve kendi `elapsedMs` değerleriyle döner.
- Kısmi terminal run'da `outcome: null`, eksik `statistics` üyeleri `null`, olmayan ölçümler boş dizidir. `0`, boş metin veya `PASSED` yerine geçmez.

Hata sözleşmesi:

| HTTP | Kod | Durum |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Eksik/bozuk/tekrarlanmış UUID, bilinmeyen query parametresi veya aynı run'ın iki kez verilmesi (`rightRunId` alan hatası) |
| 401 | `UNAUTHENTICATED` | Oturum yok/expired/revoked |
| 404 | `NOT_FOUND` | Bir veya iki run bulunamadı; hangi tarafın eksik olduğu açıklanmaz |
| 409 | `RUN_NOT_TERMINAL` | En az bir run `RUNNING`; `details.leftStatus` ve `details.rightStatus` |
| 422 | `COMPARISON_PLAN_MISMATCH` | Run'lar farklı planlarda; `details.leftPlanId` ve `details.rightPlanId` |

Aynı planın farklı sürümleri kabul edilir. Aynı run iki kez verildiğinde terminal durum kontrolü önce çalışır: run `RUNNING` ise 409, terminal ise 400 döner.

## Eklenen ve değişen dosyalar

- `apps/api/src/comparisons/comparisons.module.ts`: yeni modül.
- `apps/api/src/comparisons/comparisons.controller.ts`: `GET /api/comparisons`, P/O/V rolleri, OpenAPI parametreleri ve 200/400/401/404/409/422 yanıtları.
- `apps/api/src/comparisons/comparisons.service.ts`: tek `REPEATABLE READ` okuma, terminal/aynı run/farklı plan kontrolleri.
- `apps/api/src/comparisons/comparison-builder.ts`: `logicalStepId` eşleşmesi, deterministik sıralama, kural farkları, birim koşullu delta ve tek taraflı adımlar.
- `apps/api/src/comparisons/dto/comparison-query.dto.ts`: iki zorunlu UUID query alanı.
- `apps/api/src/comparisons/dto/comparison.dto.ts`: `RunComparisonDto`, run özeti, eşleşen/tek taraflı adım, kural farkı ve sayısal karşılaştırma şemaları.
- `apps/api/src/runs/run-snapshot-read.ts`: run snapshot select'i ve DTO okuyucuları snapshot/comparison arasında paylaşılacak şekilde çıkarıldı.
- `apps/api/src/runs/run-snapshot.service.ts`: paylaşılan okuyucuyu kullanacak şekilde sadeleştirildi; davranış değişmedi.
- `apps/api/src/app.module.ts`: `ComparisonsModule` kaydı.
- `apps/api/test/comparisons.e2e-spec.ts`: gerçek PostgreSQL + Supertest ile 10 test.
- `apps/api/test/openapi.e2e-spec.ts`: yeni yol ve şemalar için zorunlu asgari güncelleme (sahiplik listesi dışında; yol listesi aksi halde başarısız olurdu).
- `apps/api/openapi.json`: yeniden üretildi.
- `apps/api/README.md`: karşılaştırma sözleşmesi, örnek yanıt, birim/örnekleme/kısmi run kuralları.
- `docs/tasks/P6-01.md`: In Review durumu ve gerçek kontrol sonuçları.
- Bu kanıt dosyası.

## Test edilen davranışlar

- Aynı plan sürümünde PASSED (NORMAL) ile FAILED (FORCED_FAILURE) karşılaştırıldı. Sol run 6/6 örnek, 0 ihlal, `partial: false`; sağ run 6/6, 1 ihlal, `partial: false`. Üç adım `logicalStepId` ile eşleşti; `changedFields: []` idi. Her iki run'un kendi sınırları ve verdict'leri korundu; zorlanmış hatalı örnek sağ run'ın kendi `maximum` değerinin üzerinde ve `isWithinTolerance: false`.
- Aynı istek iki kez çağrıldığında gövde birebir aynı JSON'u üretti. Yanıt `idempotencyKey`, `requestHash`, `passwordHash` veya `tokenHash` içermedi.
- Aynı planın v1/v2 run'ları: `sameVersion: false`, sürüm numaraları 1/2, plan adları snapshot'tan farklı. v2'de iki kimlik yeniden adlandırıldı ve sıralandı; eşleşme kaybolmadı. Değişen alanlar tam olarak `name`, `position`, `minimum`, `maximum`, `sampleCount`, `intervalMs` (Supply Voltage) ve `unit`, `position`, `minimum`, `maximum` (Current Draw) olarak döndü.
- Aynı birimde `numericComparison.statistics` dolu; minimum/maximum/average deltaları `right - left` olarak Prisma Decimal ile bağımsız hesapla karşılaştırıldı. `sampleCount` delta 1 (2 → 3).
- Birim A → mA değişiminde `comparable: false`, `reason: "UNIT_MISMATCH"`, `statistics: null`; nesnede `delta` anahtarı yok. Birim değişimi ayrıca `changedFields` içindeki `unit` girdisinde görünür.
- Örneklem değişimi: Supply Voltage sol seri 2 örnek (`sampleIndex` 0,1; `elapsedMs` 100,200), sağ seri 3 örnek (`sampleIndex` 0,1,2; `elapsedMs` 150,300,450). Sol seri sağa göre pad edilmedi veya hizalanmadı; `intervalMs` 100 → 150, `sampleCount` 2 → 3.
- v1'deki Legacy Probe silindi, v2'de aynı görünen adla yeni bir kimlik eklendi. Sonuçta `removedSteps` yalnız sol içerikli eski kimlik, `addedSteps` yalnız sağ içerikli yeni kimlik oldu; iki kimlik farklıydı. Hiçbir tarafta sıfır doldurulmuş karşı adım yoktu.
- Sol/sağ argüman sırası değiştirildiğinde run özetleri yer değiştirdi; kimlik eşleşmesi ve iki taraflı liste doğru kaldı.
- Yeni sürüm yayımlandıktan sonra eski run'un `GET /api/runs/:id` snapshot'ı yayın öncesiyle birebir aynı kaldı. Karşılaştırmada eski tarafın adı, sınırları, örnek sayısı, aralığı ve ölçümleri v1 değerlerini korudu.
- Farklı planlardan iki run 422 `COMPARISON_PLAN_MISMATCH` döndürdü; `details.leftPlanId` ve `details.rightPlanId` farklıydı. Argüman sırası sonucu değiştirmedi.
- RUNNING run ile terminal run 409 `RUN_NOT_TERMINAL` döndürdü; `details.leftStatus: RUNNING`, `details.rightStatus: COMPLETED`. RUNNING run'ın kendisiyle karşılaştırılması da 409 döndürdü (terminal kontrolü aynı-run kontrolünden önce).
- CANCELLED run (henüz ölçüm yokken iptal) ile PASSED run karşılaştırıldı: `outcome: null`, `reasonCode: USER_CANCELLED`, `partial: true`, 0/6 örnek. Üç eşleşen adımda sol `statistics` dört alanda `null`, `measurements: []`, `status: NOT_RUN`. Sayısal karşılaştırmada sol değerler `null`, delta `null`; 0 üretilmedi.
- INTERRUPTED run gerçek recovery yolu ile, ERROR run doğrudan terminal DB geçişi ile hazırlandı. İkisi de PASSED run ile 200 döndü; `outcome: null`, `partial: true`, eksik istatistikler `null`, ölçümler boş.
- Eksik iki id, bozuk UUID, bilinmeyen query parametresi, tekrarlanmış `leftRunId` ve aynı run 400 `VALIDATION_ERROR` üretti; alan yolları ve kodları sırasıyla doğrulandı (`leftRunId`/`rightRunId`, `INVALID_TYPE`, `UNKNOWN_FIELD`, `INVALID_VALUE`).
- Bilinmeyen sol id, bilinmeyen sağ id ve iki bilinmeyen id 404 `NOT_FOUND` döndürdü; gövdede hangi tarafın eksik olduğu yoktu.
- Planner, Operator ve Viewer aynı gövdeyi aldı; oturumsuz istek 401 `UNAUTHENTICATED` döndürdü.
- OpenAPI testi yeni `/api/comparisons` yolunu, `session` güvenliğini, 200/400/401/404/409/422 yanıtlarını ve `RunComparisonDto`/`ComparisonMatchedStepDto` şemalarını doğruladı.

## Çalıştırılan komutlar ve gerçek sonuçlar

Komutlar `apps/api` çalışma alanında, 2026-11-03 tarihinde istenen sırayla çalıştırıldı. `openapi:emit` en sonda bir kez çalıştırıldı.

```text
$ npm run lint --workspace apps/api
> oxlint --type-aware src/ test/
Found 0 warnings and 0 errors.
Finished in 410ms on 138 files with 107 rules using 8 threads.
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
Duration    747ms
```

```text
$ npm run db:migrate:test --workspace apps/api
Applying migrations to the isolated test database.
Datasource "db": PostgreSQL database "probedesk_test", schema "public" at "127.0.0.1:5433"
7 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  19 passed (19)
Tests       183 passed (183)
Duration    25.12s
```

```text
$ npm run build --workspace apps/api
> nest build
(çıkış kodu 0, hata yok)
```

```text
$ npm run openapi:emit --workspace apps/api
> tsx src/common/openapi/emit-openapi.ts
Wrote OpenAPI document to /Users/kemalselcuk/.t3/projects/probedesk/apps/api/openapi.json
```

Mevcut 173 e2e testi korunmuş, 10 yeni karşılaştırma testiyle toplam 183 teste çıkmıştır.

## Kalan riskler ve devir

- `packages/api-client/src/schema.ts` bu worker tarafından üretilmedi. Lead, `apps/api/openapi.json` üzerinden `npm run openapi:generate` çalıştırmalı; aksi halde `openapi:check` ve frontend tipleri yeni endpoint'i görmez.
- Frontend'in geçici karşılaştırma zarfı (`leftRun`/`rightRun`, özet `id`, `{field,left,right}` dizisi olarak `changedFields`, ham `addedSteps`/`removedSteps` adım dizileri) bu API şekliyle uyumludur; ek `versionDifference` ve `numericComparison` alanları parser tarafından yok sayılabilir. Yine de nihai tipler OpenAPI'den üretilmelidir.
- `docs/tasks/README.md` ve `docs/roadmap.md` güncellemesi lead'e aittir; bu worker kapsam dışı olduğu için dokunmadı. Görev kartı In Review'dur, Accepted değildir; bağımsız inceleme bekliyor.
- Karşılaştırma yanıtı iki run'ın tüm ölçüm dizilerini taşır (run başına en fazla 10.000 örnek). Bilinçli olarak sayfalama veya downsampling yoktur; sözleşme tam seriyi ve kendi `elapsedMs` değerlerini korumayı gerektirir. Çok büyük iki run'da yanıt boyutu artabilir.
- Birim değişiminde sayısal özet üretilmemesi ve eksik verinin `null` kalması test edildi; UI'ın bu `statistics: null` durumunu ortak eksen/overlay olarak çizmemesi P6-04/P6-05 kapsamındadır.
- Aynı run için seçilen HTTP kodu sözleşmede ayrıca tanımlı değildi; parametre hatası olarak 400 `VALIDATION_ERROR` ve `rightRunId` alan hatası seçildi. RUNNING aynı run'da terminal kontrolü önceliklidir (409).
- Yeni indeks eklenmedi. Sorgu iki run'ı birincil anahtar üzerinden okur; `RunStep`/`Measurement` ilişkileri mevcut indeksleri kullanır.
- INTERRUPTED fixture'ı gerçek recovery yolundan, ERROR fixture'ı doğrudan terminal DB geçişinden üretildi. Yazma yollarının kendisi P3/P4 testlerinde ayrıca kapsanmıştır; bu görev yalnızca okuma sözleşmesini sınar.
