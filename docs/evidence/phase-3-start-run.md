# Phase 3 — Çalıştırma başlatma ve tek aktif çalışma (P3-04)

Tarih: 2026-11-03
Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 10.9.8, PostgreSQL 18.1 (Docker, `probedesk-postgres-test`, 127.0.0.1:5433).
Kapsam: `POST /api/runs` başlatma transaction'ı, immutable snapshot, kullanıcı kapsamlı idempotency, request hash, tek RUNNING garantisi, OpenAPI ve gerçek PostgreSQL + Supertest testleri. Yürütücü, ölçüm kaydı, iptal, recovery, snapshot okuma ve SSE kapsam dışıdır (P3-05+).

## Sonuç

P3-04 uygulandı ve In Review'a alındı. Yayımlanmış sürüm için `TestRun`, bütün `RunStep` kopyaları ve `run.started` olayı tek transaction'da yazılıyor. Aynı kullanıcı + aynı `Idempotency-Key` + aynı normalize istek mevcut run'ı `200` ile döndürüyor; farklı istek `409 IDEMPOTENCY_CONFLICT`, farklı anahtarın aktif run'a çarpması `409 RUN_ALREADY_ACTIVE` ve güvenli `details.activeRunId` üretiyor. İki gerçek HTTP isteğiyle yapılan eşzamanlı başlangıç testinde yalnızca biri kabul edildi. Yeni kayıt `202` döndürüyor.

## Eklenen ve değişen dosyalar

- `apps/api/src/runs/dto/start-run.dto.ts`: istek gövdesi; UUID, senaryo enum'u, uint32 seed, isteğe bağlı `failureStepId`/`errorProbability` ve bilinmeyen alan reddi.
- `apps/api/src/runs/dto/run-start-response.dto.ts`: `runId`, `status`, `outcome`, `snapshotUrl`, `eventsUrl`.
- `apps/api/src/runs/run-start.ts`: `Idempotency-Key` doğrulaması, senaryo ayarlarının normalizasyonu, ondalık olasılığın altı haneli kanonik biçimi ve SHA-256 istek hash'i.
- `apps/api/src/runs/run-start.spec.ts`: hash/kanonikleştirme, senaryo uyumsuzluğu, seed/UUID/olasılık ve anahtar sınırı birim testleri (4 test).
- `apps/api/src/runs/runs.service.ts`: yayımlanmış revision yükleme, snapshot üretimi, tek transaction, idempotent replay ve unique ihlali çözümlemesi.
- `apps/api/src/runs/runs.controller.ts`: Operator + CSRF korumalı `POST /api/runs`, `Idempotency-Key` başlığı, `202`/`200` yanıtları.
- `apps/api/src/runs/runs.module.ts`: controller ve servis kaydı; `apps/api/src/app.module.ts` içine modül bağlandı.
- `apps/api/src/runs/run-domain.ts`: `RUN_EVALUATION_VERSION = 'decimal-v1'` sabiti (P3-05 değerlendiricisi gelene kadar run'lara yazılan sürüm).
- `apps/api/test/support/run-helpers.ts`: test kullanıcıları/profili, yayımlanmış ve yalnız taslak fixture'ları, run ve plan temizliği.
- `apps/api/test/runs.e2e-spec.ts`: 15 gerçek HTTP + PostgreSQL testi.
- `apps/api/test/openapi.e2e-spec.ts`: yeni `/api/runs` yolu, güvenlik şeması, `Idempotency-Key` parametresi, `200/202/400/409` yanıtları ve iki şema kontrolü eklendi. Bu dosya, mevcut testteki kesin yol listesi nedeniyle zorunlu olarak güncellendi.
- `apps/api/openapi.json`: yeni uç, istek/yanıt şemaları ve başlık parametresiyle yeniden üretildi.
- `apps/api/README.md`: run start sözleşmesi, idempotency ve tek aktif çalışma davranışı belgelendi.
- `docs/tasks/P3-04.md`: durum ve kanıt alanları.
- Bu kanıt dosyası.

Migration eklenmedi. P3-03'teki `20261103190000_runs` migration'ı `(requestedById, idempotencyKey)` unique'ini ve `((1)) WHERE status = 'RUNNING'` partial unique indeksini zaten kuruyor; uygulama bu kısıtları kullanıyor.

## Davranış

### İstek ve doğrulama

- `POST /api/runs` yalnızca Operator rolüne açıktır; oturum yoksa `401 UNAUTHENTICATED`, rol uygun değilse veya CSRF eksik/yanlışsa `403 FORBIDDEN`.
- `Idempotency-Key` zorunlu, boş olamaz ve en fazla 200 karakterdir; eksik/boş `400 VALIDATION_ERROR` + `fieldErrors[].path = "Idempotency-Key"`.
- Gövde: `planVersionId` (UUID), `scenario` (`NORMAL|FORCED_FAILURE|RANDOM`), `seed` (0–4.294.967.295 tamsayı), yalnız `FORCED_FAILURE` için `failureStepId`, yalnız `RANDOM` için `errorProbability` (0–1, en fazla 6 ondalık).
- Bilinmeyen alanlar (ör. `status`, `outcome`, `expectedSampleCount`) global whitelist tarafından `UNKNOWN_FIELD` olarak reddedilir.
- Senaryoya uymayan alanlar, geçersiz seed/UUID/olasılık ve yayımlanmış sürümde bulunmayan `failureStepId` `fieldErrors` ile 400 döndürür.
- Taslak revision ve bilinmeyen revision aynı `404 NOT_FOUND` yanıtını verir; taslak varlığı sızdırılmaz.

### Snapshot ve transaction

Tek transaction içinde:

1. `TestRun` satırı oluşturulur (`status=RUNNING`, `outcome=null`, `recordedSampleCount=0`, `eventSequence=1`, `startedAt`).
2. Yayımlanmış revision'dan plan adı, sürüm numarası, profil, senaryo/seed/ayarlar, `simulatorVersion` (simülatör modülünden `mulberry32-v1`) ve evaluation sürümü kopyalanır.
3. Bütün `RunStep` satırları `PENDING`, sayaçlar 0 ve ad/birim/min/max/sampleCount/intervalMs kopyalarıyla oluşturulur. `expectedSampleCount` adım `sampleCount` toplamıdır.
4. `sequence=1`, `schemaVersion=1`, `type=run.started` olayı aynı `startedAt` ile yazılır. Payload durum, plan/versiyon kimliği, ad, sürüm, senaryo, beklenen örnek ve adım sayısını taşır; idempotency anahtarı ve request hash payload'a girmez.

Transaction içinde olay yazımı geçici bir PostgreSQL trigger'ıyla zorla başarısız bırakıldığında run, adımlar ve olayın hiçbiri commit edilmedi; aynı anahtarla sonraki istek temiz bir şekilde `202` aldı.

### Idempotency ve tek aktif çalışma

- Hash, normalize edilmiş `planVersionId` (küçük harf), senaryo, seed, `failureStepId`, altı haneli `errorProbability` ve `probedesk-run-start-v1` işaretinden SHA-256 ile üretilir. `0.05` ile `0.050000` aynı istek sayılır; UUID büyük/küçük harf farkı aynı sayılır.
- Aynı kullanıcı + anahtar + aynı hash: mevcut run, terminal olsa bile `200` replay; ikinci satır oluşmaz.
- Aynı kullanıcı + anahtar + farklı hash: `409 IDEMPOTENCY_CONFLICT`; ilk run korunur. Bu kontrol plan doğrulamasından önce yapıldığı için taslak/geçersiz sürüm gönderilse bile anahtar çakışması 409 döner.
- Farklı anahtar ve mevcut `RUNNING` run: `409 RUN_ALREADY_ACTIVE`, `details.activeRunId`; istek kuyruğa alınmaz, yeni satır yazılmaz.
- İki eşzamanlı farklı anahtar: PostgreSQL'deki partial unique index son garantidir. Prisma `P2002` hatası önce anahtar kaydıyla (varsa replay), sonra aktif run ile (409) çözülür. Testte üç tur boyunca iki gerçek HTTP isteği gönderildi; her turda tam olarak bir `202` ve bir `409` alındı, DB'de tek run kaldı.
- Aynı anahtar + aynı gövde iki eşzamanlı istek: bir `202` ve bir `200`, aynı `runId`, tek run ve tek olay.

## Testler

`apps/api/test/runs.e2e-spec.ts` (15 test):

1. Başarılı başlangıç; yanıt `202` ve tam snapshot: plan adı/versiyon/profil, senaryo, seed, simülatör/evaluation sürümleri, beklenen örnek 6, sayaçlar 0, `eventSequence=1`, üç adımın kanonik altı haneli sınırları ve tek `run.started` olayı (DB'de `::text` okunuşu `run.started`).
2. RANDOM senaryosunda `"0.05"` girdisinin `"0.050000"` olarak saklanması, en büyük uint32 seed (`4294967295`) ve `failureStepId=null`.
3. Taslak revision ve rastgele UUID'nin aynı `404 NOT_FOUND` ile reddi; run yazılmaması.
4. Senaryo uyumsuzlukları: NORMAL'da `failureStepId`/`errorProbability`, FORCED_FAILURE'da olasılık, FORCED_FAILURE'da eksik veya sürümde olmayan `failureStepId`, RANDOM'da `failureStepId`, eksik veya 1'den büyük olasılık; her biri doğru `fieldErrors.path` ile 400.
5. `status`, `outcome` ve `expectedSampleCount` gibi istemci alanlarının `UNKNOWN_FIELD` ile reddi.
6. Geçersiz seed (-1, 4294967296, 1.5, `"42"`), UUID, `failureStepId` ve olasılık biçimleri (`1e-2`, `0,05`, 7 ondalık, boşluklu, sayı) için 400.
7. Oturumsuz `401`; Planner/Viewer `403`; CSRF'siz ve yanlış CSRF `403`; eksik, boş ve 201 karakterlik anahtar `400`.
8. Aynı anahtar/istek `200` replay; terminal (`CANCELLED`) durumdan sonra da aynı run ve tek kayıt.
9. Aynı anahtar/farklı gövde `409 IDEMPOTENCY_CONFLICT`; taslak sürümle bile 409; ilk run korunur.
10. Anahtarın kullanıcı kapsamı: farklı Operator aynı anahtarı kullanabilir ve farklı run alır.
11. İkinci aktif başlangıç `409 RUN_ALREADY_ACTIVE` + doğru `activeRunId`; ikinci anahtar için run yok.
12. Üç tur eşzamanlı farklı anahtar: tam bir `202`, bir `409`; DB'de tek run, tek olay, üç adım.
13. Eşzamanlı aynı anahtar/gövde: `200` + `202`, aynı run, tek kayıt.
14. Olay yazımı geçici trigger ile bozulduğunda `500` ve tam rollback; aynı anahtarla temiz retry `202`.
15. Temizlik sonrası test kullanıcılarına ait run/adım/olay satırı kalmaması.

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: repo kökü, 2026-11-03.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 325ms on 102 files with 107 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/api
> tsc --noEmit -p tsconfig.json
(çıkış kodu 0, hata yok)
```

```text
$ npm run test --workspace apps/api
Test Files  13 passed (13)
Tests       90 passed (90)
Duration    660ms
```

`src/runs/run-start.spec.ts` toplamı: 4 test. Mevcut simülatör 31, şema 10, plan/auth paketleri değişmeden geçti.

```text
$ npm run db:migrate:test --workspace apps/api
6 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  12 passed (12)
Tests       118 passed (118)
Duration    12.39s
```

`test/runs.e2e-spec.ts` tek başına:

```text
$ npx vitest run --config ./vitest.config.e2e.ts test/runs.e2e-spec.ts
Test Files  1 passed (1)
Tests       15 passed (15)
Duration    1.54s
```

```text
$ npm run build --workspace apps/api
> nest build
(çıkış kodu 0)
```

```text
$ npm run openapi:emit
Wrote OpenAPI document to /Users/kemalselcuk/.t3/projects/probedesk/apps/api/openapi.json
```

OpenAPI belgesinde `/api/runs` yolu; zorunlu `Idempotency-Key` header parametresi (min 1, max 200); `StartRunDto`, `RunStartResponseDto`; `200`, `202`, `400`, `401`, `403`, `409` yanıtları; `session + csrfToken` güvenliği bulunur. `openapi.e2e-spec.ts` commit edilmiş belgenin uygulamayla eşleştiğini doğrular.

## Test edilen HTTP yanıt kodları

| Durum | Kod | Bağlam |
|---|---|---|
| 202 | — | Yeni run kabulü |
| 200 | — | Aynı anahtar/istek replay'i (terminal dahil) |
| 400 | `VALIDATION_ERROR` | Gövde alanı, senaryo ayarı, seed/olasılık/UUID veya `Idempotency-Key` |
| 401 | `UNAUTHENTICATED` | Oturum yok |
| 403 | `FORBIDDEN` | Planner/Viewer rolü veya CSRF |
| 404 | `NOT_FOUND` | Taslak veya bilinmeyen sürüm |
| 409 | `IDEMPOTENCY_CONFLICT` | Aynı anahtar, farklı istek |
| 409 | `RUN_ALREADY_ACTIVE` | Farklı anahtar, mevcut RUNNING run; `details.activeRunId` |

## Kalan riskler ve kapsam dışı

- Yürütücü, ölçüm kaydı, adım/run sonucu, iptal, recovery, `GET /runs/:id`, `GET /runs/active`, geçmiş ve SSE bu görevde yoktur. `snapshotUrl`/`eventsUrl` sözleşmedeki gelecek uçları işaret eder; P3-05+ bunları ekleyecektir.
- P3-05 değerlendiricisi henüz olmadığı için run'lara `RUN_EVALUATION_VERSION = 'decimal-v1'` yazılır. Değerlendirme kuralları değişirse bu sabit artırılmalıdır.
- Başlatma servisi `buildRunSnapshot` sonrasında `eventSequence` değerini 1'e yükseltir; snapshot yardımcısının kendi varsayılanı 0'dır ve yalnız satır üretiminde kullanılır. Gelecekteki yürütücü olay dizisini TestRun satırı altında artırmalıdır.
- Aktif run çakışması DB unique ihlaliyle çözülür. Bir terminalizasyon yarışı, ihlal sonrası aktif satır bulunamazsa `500` üretebilir; P3-07 iptal yarışları geldiğinde bu yol yeniden değerlendirilmelidir.
- Tek API süreci varsayımı korunur; çok süreçli recovery garantisi bu görevin kapsamı dışındadır.
- Test temizliği yalnız `runs-api-e2e-` önekli kullanıcı/plan/profil verisini hedefler ve yayımlanmış plan trigger'larını yalnız schema owner olarak geçici devre dışı bırakır. Uygulama bağlantılarında bu kaçış yolu yoktur.
- `docs/tasks/README.md` ve `docs/roadmap.md` bu çalışan tarafından güncellenmedi (görev sahipliği dışında); durum değişikliği lead commit'inde işlenmelidir.
- Bağımsız teknik inceleme ve kullanıcı kabulü henüz yapılmadı; kart In Review'dadır, Accepted değildir.
