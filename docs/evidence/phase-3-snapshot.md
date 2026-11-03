# Phase 3 — Çalıştırma snapshot API'si (P3-06)

Tarih: 2026-11-03
Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 11.6.2, PostgreSQL 18.1 (`probedesk-postgres-test`, 127.0.0.1:5433).
Kapsam: `GET /api/runs/active`, `GET /api/runs/:id`, tutarlı snapshot okuması, snapshot DTO'ları, OpenAPI çıktısı ve gerçek PostgreSQL + Supertest testleri. SSE, iptal, recovery ve istemci üretimi kapsam dışıdır.

## Sonuç

P3-06 uygulandı ve In Review'a alındı. Aktif çalışma özeti, çalışma yokken `404` yerine gövdede JSON `null` döndürüyor. Tek çalışma snapshot'ı run satırı, bütün adımlar, bütün ölçümler ve `lastEventSequence` değerini tek `REPEATABLE READ` okuma transaction'ında yüklüyor. Böylece executor aynı anda ölçüm/sayaç/olay commit ederken yarım güncellenmiş bir yanıt oluşmuyor.

Snapshot yalnızca başlangıçta kopyalanan run/adım satırlarını okur; canlı plan, taslak veya yeni yayımlanmış sürüm terminal sonucu değiştirmiyor. Ölçüm ve tolerans değerleri kanonik altı ondalık metin olarak dönüyor. Kısmi adımın istatistikleri sıfırla doldurulmuyor; `minimum`, `maximum`, `average` ve `sampleCount` null kalıyor. `hasOutOfTolerance`, `outOfToleranceCount > 0` olarak türetiliyor.

Migration gerekmedi. P3-03 şeması tek RUNNING kısıtını, sayaç CHECK'lerini, ölçüm benzersizliğini ve `(runId, sequence)` benzersizliğini zaten sağlıyor.

## Eklenen ve değişen dosyalar

- `apps/api/src/runs/dto/run-snapshot.dto.ts`: `RunSnapshotDto`, `RunSnapshotStepDto`, `RunMeasurementDto`, `RunStepStatisticsDto`, `RunRequestedByDto`, `RunActiveDto` ve OpenAPI alan açıklamaları.
- `apps/api/src/runs/run-snapshot.service.ts`: aktif run sorgusu; `REPEATABLE READ` snapshot transaction'ı; Decimal/JSON/profile/istatistik eşlemesi; hassas alanları seçmeyen dar `select`.
- `apps/api/src/runs/runs.controller.ts`: `GET /runs/active` ve `GET /runs/:id`; statik route `:id`'den önce; bilinmeyen kimlik için güvenli `404 NOT_FOUND`; açık JSON null.
- `apps/api/src/runs/runs.module.ts`: `RunSnapshotService` sağlayıcısı.
- `apps/api/test/runs-snapshot.e2e-spec.ts`: gerçek PostgreSQL ve gerçek HTTP ile 6 test.
- `apps/api/test/openapi.e2e-spec.ts`: yeni iki yol ve snapshot şemaları için yol listesi/şema kontrolleri. Bu dosya P3-06 kartındaki nominal sahiplik listesinde yoktu; yeni rotalar OpenAPI testinin sabit yol listesini kırdığı için zorunlu asgari düzenleme yapıldı.
- `apps/api/openapi.json`: `npm run openapi:emit` ile yeniden üretildi.
- `apps/api/README.md`: aktif/snapshot uçları, tutarlı okuma ve null istatistik davranışı belgelendi.
- `docs/tasks/P3-06.md`: durum ve kanıt alanları.
- Bu kanıt dosyası.

## Okuma tasarımı

1. `GET /api/runs/active` PostgreSQL'deki tek `RUNNING` satırı `startedAt DESC` ile okur. Satır yoksa servis `null` döndürür. Controller yanıtı doğrudan `response.json(null)` ile yazar; NestJS'in null sonucu boş gövdeye çevirmesi engellenir. Böylece sözleşmedeki açık JSON null korunur.
2. `GET /api/runs/:id` Prisma interactive transaction içinde `RepeatableRead` izolasyonu kullanır. Run, `requestedBy` özeti, adımlar ve her adımın ölçümleri aynı snapshot'tan okunur. `lastEventSequence`, aynı run satırındaki `eventSequence` alanıdır; bu sayaç olayla aynı transaction'da commit edildiği için snapshot'ın gördüğü state ile tutarlıdır.
3. Sorgu yalnızca UUID, ad, birim, sınır, örnek ayarı, durum, sayaç, istatistik ve ölçüm alanlarını seçer. `passwordHash`, session/token, `idempotencyKey`, `requestHash`, taslak içeriği veya canlı plan ilişkisi yüklenmez.
4. Adımlar `position ASC`, ölçümler `sampleIndex ASC` sırasındadır. Değerler `NUMERIC(18,6)` üzerinden `toFixed(6)` ile kanonik metne çevrilir.
5. İstatistikler P3-05'in yazdığı JSON nesnesinden okunur. Nesne yoksa dört alan da null döner. Bozuk/eksik JSON alanı varsa yalnızca ilgili alan null olur; sayısal alan sıfırla doldurulmaz. Metin alanları kanonik altı ondalık biçimine karşı doğrulanır.
6. Bilinmeyen UUID `404 NOT_FOUND`; UUID olmayan parametre mevcut `ParseUUIDPipe` ile `400 VALIDATION_ERROR` döndürür. Bu iki durum birbirine karıştırılmaz.
7. `RunActiveDto` OpenAPI'de `nullable: true` + `allOf` ile belgelenir; istemci üretimi bu gövdenin null olabileceğini şemadan görebilir.

## Yanıt biçimleri

`GET /api/runs/active` — çalışma varken:

```json
{
  "runId": "6b1f9c9e-2a7c-4d8d-9f5f-7d2c4a1b3e6f",
  "planName": "Snapshot API plan",
  "versionNumber": 1,
  "status": "RUNNING",
  "expectedSampleCount": 6,
  "recordedSampleCount": 1,
  "startedAt": "2026-01-01T00:00:00.000Z",
  "scenario": "NORMAL"
}
```

Çalışma yokken gövde tam olarak `null`, HTTP durumu `200`.

`GET /api/runs/:id` — kısmi RUNNING örneği (kısaltılmış):

```json
{
  "id": "6b1f9c9e-2a7c-4d8d-9f5f-7d2c4a1b3e6f",
  "planId": "0d6f0e0c-0f7e-4f0e-9b7c-1d2a3b4c5d6e",
  "planVersionId": "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910",
  "planName": "Snapshot API plan",
  "versionNumber": 1,
  "profile": {
    "id": "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
    "code": "runs-api-e2e-profile-…",
    "name": "Run Start E2E Device",
    "description": "Fixture profile for run start tests"
  },
  "scenario": "NORMAL",
  "seed": 123456789,
  "errorProbability": null,
  "failureStepId": null,
  "simulatorVersion": "mulberry32-v1",
  "evaluationVersion": "decimal-v1",
  "status": "RUNNING",
  "outcome": null,
  "startedAt": "2026-01-01T00:00:00.000Z",
  "finishedAt": null,
  "requestedBy": {
    "id": "…",
    "email": "runs-api-e2e-…@example.test",
    "role": "OPERATOR"
  },
  "reasonCode": null,
  "expectedSampleCount": 6,
  "recordedSampleCount": 1,
  "lastEventSequence": 3,
  "steps": [
    {
      "runStepId": "…",
      "logicalStepId": "…",
      "position": 1,
      "name": "Output Voltage",
      "unit": "V",
      "minimum": "4.750000",
      "maximum": "5.250000",
      "sampleCount": 2,
      "intervalMs": 200,
      "status": "RUNNING",
      "outcome": null,
      "recordedCount": 1,
      "outOfToleranceCount": 0,
      "firstFailureSampleIndex": null,
      "hasOutOfTolerance": false,
      "statistics": {
        "minimum": null,
        "maximum": null,
        "average": null,
        "sampleCount": null
      },
      "measurements": [
        {
          "sampleIndex": 0,
          "value": "4.980120",
          "isWithinTolerance": true,
          "recordedAt": "2026-01-01T00:00:00.200Z",
          "elapsedMs": 200
        }
      ]
    }
  ]
}
```

Tamamlanmış adımda `statistics` dört alanla dolu döner; örnek değerler testte doğrudan veritabanında saklanan JSON ile karşılaştırılır.

## Test edilen davranışlar

- Kontrollü/paused scheduler ile run başlatıldı; yalnızca start gecikmesi ve bir örnek aralığı serbest bırakıldı. Yanıt `RUNNING`, adım 1 `RUNNING`, 1/6 örnek, `lastEventSequence=3`, diğer adımlar `PENDING`, kısmi istatistikler null olarak doğrulandı.
- FORCED_FAILURE senaryosunda da yalnızca ilk örnek kaydedilmişken snapshot alındı. Adım hâlâ `RUNNING` ve `outcome` null olmasına karşın `hasOutOfTolerance=true`, `outOfToleranceCount=1`, `firstFailureSampleIndex=0` ve ihlal örneği `5.500000`/`isWithinTolerance=false` döndü; istatistikler null kaldı.
- Snapshot'ın tam alan kümesi, profil/requester/adım/istatistik/ölçüm anahtar kümeleri ve tam DTO değerleri doğrulandı. Ölçüm sırası ve `recordedCount` eşleşmesi kontrol edildi.
- Planner, Operator ve Viewer üçü de aktif özeti ve tam snapshot'ı okuyabildi; gövdeler birbirine eşit. Oturumsuz istekler `401 UNAUTHENTICATED`.
- Paused scheduler tek olaylık adımlarla ilerletildi. Her durma noktasında snapshot'taki `recordedSampleCount`, adım sayaçlarının toplamı, ölçüm sayısı ve olay sayısı birbirine eşit; `lastEventSequence` veritabanındaki en büyük committed sequence ile birebir aynı. Terminal snapshot `COMPLETED/PASSED`, 6/6, `lastEventSequence=14`.
- FORCED_FAILURE run'ı `COMPLETED/FAILED` döndü. İlk adım `outOfToleranceCount=1`, `firstFailureSampleIndex=0`, `hasOutOfTolerance=true`; ihlal örneği `5.500000` ve `isWithinTolerance=false`. Sonraki iki adım PASSED. Bütün tamamlanmış adımların istatistikleri veritabanındaki saklanan JSON ile aynı.
- Terminal run'dan sonra aynı plan için yeni taslak oluşturuldu, adı/kuralları değiştirildi ve yeni sürüm yayımlandı. Eski snapshot gövdesi bayt düzeyinde değişmedi; plan adı, sürüm 1, üç adım ve eski sınırlar korundu; yeni ad/taslak sızmadı.
- Çalışma yokken `/api/runs/active` gövdesi `null` (metin olarak `null`) döndü. Bilinmeyen UUID `404 NOT_FOUND`, UUID olmayan kimlik `400 VALIDATION_ERROR`, hata gövdesinde SQL/secret yok.
- Normal auto yürüyüş sırasında 25 ardışık snapshot alındı. Her yanıtta sayaç/ölçüm/olay tutarlılığı korundu; `lastEventSequence` istek öncesi ve sonrası committed maksimum sequence aralığında kaldı. Final snapshot yeniden doğrulandı.
- Yanıtların hiçbirinde `passwordHash`, `idempotencyKey`, `requestHash`, `session`, parola veya `draft` alanı bulunmadı.

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: `apps/api` çalışma alanı, 2026-11-03. Komutlar tek tek, paralel `prisma generate` yarışı olmadan çalıştırıldı. `openapi:emit`, e2e'nin committed doküman kontrolü geçsin diye e2e'den önce ve build sonrasında yeniden çalıştırıldı.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 293ms on 111 files with 107 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/api
> tsc --noEmit -p tsconfig.json
(çıkış kodu 0, hata yok)
```

```text
$ npm run test --workspace apps/api
Test Files  14 passed (14)
Tests       97 passed (97)
Duration    619ms
```

```text
$ npm run db:migrate:test --workspace apps/api
6 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npm run openapi:emit --workspace apps/api
Wrote OpenAPI document to /Users/kemalselcuk/.t3/projects/probedesk/apps/api/openapi.json

$ npm run test:e2e --workspace apps/api
Test Files  14 passed (14)
Tests       131 passed (131)
Duration    14.48s
```

Yeni `test/runs-snapshot.e2e-spec.ts` tek başına:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
Duration    1.66s
```

Önceki P3-05 tabanı 125 e2e testiydi; 6 yeni testle toplam 131 test geçti. Mevcut testlerde kapsam değişikliği yapılmadı; yalnız OpenAPI sabit yol listesi yeni rotalarla güncellendi.

```text
$ npm run build --workspace apps/api
> nest build
(çıkış kodu 0)

$ npm run openapi:emit --workspace apps/api
Wrote OpenAPI document to /Users/kemalselcuk/.t3/projects/probedesk/apps/api/openapi.json
```

## Kalan riskler ve kapsam dışı

- `packages/api-client` bu görevde üretilmedi. Lead, güncel `apps/api/openapi.json` üzerinden istemci paketini yeniden üretmeli ve `RunActiveDto` gövdesinin nullable olduğunu tüketmeli.
- SSE uç noktası P4 kapsamındadır. Bu görev yalnızca `lastEventSequence` cursor'ını ve REST snapshot'ını sağlar; replay/canlı akış ayrı test edilmelidir.
- İptal (P3-07), süreç kapanışı ve INTERRUPTED recovery (P3-08) bu görevde yoktur. Snapshot servisi bu durumları okumaya hazırdır; ancak bu terminal yolların ürettiği veriler ayrı görevlerde doğrulanacaktır.
- `REPEATABLE READ` okuma transaction'ı 10 saniye timeout ve 5 saniye maxWait taşır. Ürün sınırındaki 10.000 örnek için tek yanıt boyutu ve sorgu süresi yük testiyle ölçülmedi; mevcut testler küçük planlarla çalışır.
- Profil snapshot'ta `description` alanı yoksa null döner. Bozuk profil JSON'u (UUID/ad/kod eksik veya yanlış tip) güvenli `500 INTERNAL_ERROR` üretir; yanıtta ham JSON/SQL sızmaz.
- İstatistik JSON'u yalnızca `jsonb_typeof = 'object'` ile korunur. Bozuk iç alanlar null'a düşürülür; bu durum test edilmedi.
- `apps/api/test/openapi.e2e-spec.ts` nominal sahiplik listesi dışında asgari olarak değiştirildi. Lead incelemesinde bu dosya diff'i ayrıca kontrol edilmelidir.
- `docs/tasks/README.md` ve `docs/roadmap.md` bu görevin sahiplik alanı dışında olduğu için güncellenmedi; lead aynı commit'te P3-06 durumunu buralara işlemelidir.
- Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı; kart In Review'dadır, Accepted değildir.
