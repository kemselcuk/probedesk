# Phase 4 — Kalıcı olaylardan SSE yayını (P4-01)

Tarih: 2026-11-03
Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 11.6.2, PostgreSQL 18.1 (`probedesk-postgres-test`, 127.0.0.1:5433).
Kapsam: `GET /api/runs/:id/events`, kalıcı `RunEvent` tablosundan replay/canlı takip, cursor doğrulaması, heartbeat, oturum kontrolü, terminal kapanış ve teardown. Frontend, `packages/api-client` SSE tipleri, migration ve ücretli altyapı kapsam dışıdır.

## Sonuç

P4-01 uygulandı ve In Review'a alındı. Planner, Operator ve Viewer rolleri aynı run'ın commit edilmiş olaylarını `text/event-stream` olarak okuyabiliyor. `?after=` veya `Last-Event-ID` cursor'ı run'ın son sequence değerine göre doğrulanıyor; hatalar SSE header'ı yazılmadan normal JSON hata gövdesiyle dönüyor. Terminal run'da eksik olay yoksa `204` dönülüyor; backlog varsa terminal olaya kadar replay edilip bağlantı kapatılıyor.

Replay ve canlı takip aynı `RunEvent` tablosunu ascending sequence ile okuyor. Her bağlantıda aynı anda tek olay sorgusu ve tek oturum kontrolü çalışıyor; ilk sorgu cursor sonrası birikmiş tüm olayları sırayla aktarıyor, ardından varsayılan 200 ms aralıkla takip ediyor. `id` alanı run-local sequence, `event` alanı sözleşmedeki dotted ad, `data` alanı `{schemaVersion, runId, sequence, occurredAt, payload}` zarfı.

Heartbeat 15 saniyede bir `: heartbeat` SSE comment'i olarak yazılıyor ve domain sequence tüketmiyor. Her heartbeat oturumun süresini ve revocation durumunu yeniden kontrol ediyor; geçersizse akış temiz kapanıyor. İstemci bağlantıyı kapatınca poll/heartbeat timer'ları ve bağlantı kaydı temizleniyor; executor etkilenmiyor. Testlerde kısa poll/heartbeat aralıkları enjekte edildi; üretim varsayılanları 200 ms / 15 s.

## Protokol ayrıntıları

1. `SessionAuthGuard` ve `RolesGuard` önce çalışır. Oturum yok/expired/revoked ise `401 UNAUTHENTICATED`; oturum varsa ve run yoksa `404 NOT_FOUND`; UUID olmayan yol `400 VALIDATION_ERROR`.
2. Run satırı tek sorguda okunur (`status`, `eventSequence`). Cursor daha sonra doğrulanır; böylece bilinmeyen run ile geçersiz cursor birleşiminde sözleşmedeki run-varlığı önceliği korunur.
3. `Last-Event-ID` header'ı varsa `after` query değeri tamamen yok sayılır. Header boş veya bozuksa `after` geçerli olsa bile `400` döner. Cursor yalnız rakamlardan oluşmalı, negatif olmamalı ve run'ın `eventSequence` değerini aşmamalıdır.
4. `after` dışında query parametresi `UNKNOWN_FIELD` alan hatasıyla reddedilir. `after` tekrarlanırsa dizi olduğu için `INVALID_TYPE` döner.
5. Terminal run ve `cursor === eventSequence` ise `204 No Content` döner; SSE header'ı açılmaz. Terminal run'da backlog varsa `200` stream açılır, cursor sonrası olaylar sırayla yazılır, terminal olay son frame olur ve bağlantı kapanır. Terminal durumdayken olay geçmişi tutarsız/terminal eventsiz olsa bile replay tükendiğinde bağlantı kapanır.
6. Canlı takip sorgusu `sequence > lastSentSequence` ve `orderBy sequence asc`, batch 500'dür. Aynı bağlantıda paralel takip sorgusu açılmaz; batch dolduysa hemen, dolmadıysa poll aralığı kadar sonra tek sorgu yeniden kurulur.
7. Heartbeat oturum kontrolü de aynı promise kuyruğundan geçer; böylece olay sorgusu ile oturum sorgusu üst üste binmez. Oturum geçersizse veya süre dolmuşsa `response.end()` ile sessiz kapanış yapılır.
8. `response.on('close')` ve request `aborted` olayları timer'ları temizler. `RunEventsService.activeStreamCount` testte kaynakların bırakıldığını gözlemlemek için kullanılır. `OnModuleDestroy` açık stream'leri kapatır.
9. Başlıklar: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`. `flushHeaders()` ilk frame'den önce çağrılır; socket timeout kapatılır ve Nagle kapatılır.
10. Event payload'ları yalnız run/adım/ölçüm alanları taşır. SSE yanıtında parola, session token, CSRF, taslak içeriği, idempotency key veya request hash yoktur; test ham yanıt gövdesini bu dizeler için tarar.

## Eklenen ve değişen dosyalar

- `apps/api/src/events/run-events.controller.ts`: yetkili SSE endpoint'i, 204/JSON hata ayrımı, OpenAPI dokümantasyonu.
- `apps/api/src/events/run-events.service.ts`: run/cursor hazırlığı, 404/400/204 kararı, açık bağlantı kaydı ve shutdown cleanup.
- `apps/api/src/events/run-event-connection.ts`: replay/canlı poll döngüsü, heartbeat, oturum kontrolü, disconnect cleanup, terminal kapanış.
- `apps/api/src/events/run-event-cursor.ts`: `after`/`Last-Event-ID` önceliği, unknown query reddi, aralık doğrulaması.
- `apps/api/src/events/run-event-stream.ts`: SSE frame/envelope serileştirme, terminal event kümesi, heartbeat sabiti.
- `apps/api/src/events/run-events.options.ts`: 200 ms poll, 15 s heartbeat, batch 500 varsayılanları ve test injection token'ı.
- `apps/api/src/events/dto/run-event-envelope.dto.ts`: OpenAPI `RunEventEnvelopeDto`.
- `apps/api/src/events/run-event-cursor.spec.ts`, `run-event-stream.spec.ts`: cursor ve frame birim testleri.
- `apps/api/src/runs/runs.module.ts`: controller/servis/options kaydı.
- `apps/api/src/common/openapi/openapi.ts`: OpenAPI parametre sırasını deterministik yapan normalizasyon. Yeni çok parametreli SSE rotası, `tsx` ile Vitest transformları arasında Nest route/decorator metadata sırası farkı ürettiği için gerekliydi; REST semantiği değişmedi.
- `apps/api/test/sse.e2e-spec.ts`: gerçek HTTP/SSE + gerçek PostgreSQL ile 12 test.
- `apps/api/test/support/sse-client.ts`: chunk sınırlarını ve heartbeat comment'lerini işleyen streaming test istemcisi.
- `apps/api/test/openapi.e2e-spec.ts`: yeni yol, güvenlik, 200/204/400/401/404 ve `text/event-stream` içerik doğrulamaları. Nominal sahiplik listesi dışında zorunlu asgari düzenleme.
- `apps/api/openapi.json`: yeniden üretildi.
- `apps/api/README.md`: SSE sözleşmesi, frame örneği, event tipleri, heartbeat, 204 ve proxy başlıkları.
- `docs/tasks/P4-01.md`: In Review durumu ve gerçek kontrol sonuçları.
- Bu kanıt dosyası.

## Test edilen davranışlar

- `after=0` ile terminal run'ın tüm olayları sırayla replay edildi; her frame'in `id` değeri DB sequence'i, `event` değeri DB tipinin dotted karşılığı, `data` zarfı DB satırıyla birebir eşleşti. Son frame `run.completed` idi ve bağlantı kapandı.
- `after=3` yalnız 4+ sequence'leri döndürdü.
- `Last-Event-ID: 4` ile `after=1` birlikte gönderildiğinde header kazandı; ayrıca `after=not-an-integer` ile geçerli header gönderildiğinde query hata üretmeden header kullanıldı.
- `after=-1`, `abc`, `1.5`, son sequence + 1, tekrarlanan `after`, bilinmeyen `limit` parametresi, bozuk `Last-Event-ID` ve gelecekteki `Last-Event-ID` değerlerinin hepsi SSE header'ı yazılmadan `400 VALIDATION_ERROR` döndü.
- Oturumsuz istek `401`; bilinmeyen UUID `404 NOT_FOUND`; UUID olmayan yol `400` döndü. Hata gövdelerinde `requestId` ve yanıtlarda `X-Request-Id` vardı.
- Planner, Operator ve Viewer aynı terminal run'ı replay edebildi.
- Terminal run'da `after=lastSequence` ve `Last-Event-ID=lastSequence` ayrı ayrı `204` döndü; `text/event-stream` header'ı açılmadı.
- Kontrollü paused scheduler ile canlı run izlendi: `run.started` stream açıldıktan sonra geldi, sürücü adım adım ilerletildi, tüm 14 olay sırayla ve tek kez alındı; terminal `run.completed` sonrası bağlantı kapandı.
- 60 ms heartbeat aralığıyla `: heartbeat` comment'i gözlendi; aynı anda DB `RunEvent` sayısı değişmedi ve yeni domain event üretilmedi.
- İstemci abort'u sonrası `activeStreamCount` 0'a indi; ardından executor çalıştırılmaya devam edildi ve run `COMPLETED` oldu. Abort executor'ı durdurmadı.
- Ayrı login oturumu logout ile revoke edildiğinde stream en geç sonraki heartbeat'te kapandı; yanıt 200 olarak başlamıştı ve terminal olay almadı. Executor paused run'ı daha sonra terminale ulaştırdı.
- Ayrı login oturumunun `expiresAt` değeri geçmişe çekildiğinde stream yine sonraki heartbeat'te kapandı; executor etkilenmedi.

## Çalıştırılan komutlar ve gerçek sonuçlar

Komutlar `apps/api` çalışma alanında, 2026-11-03 tarihinde sırayla çalıştırıldı. `openapi:emit`, committed doküman e2e kontrolünden önce bir kez ve build sonrasında son kez çalıştırıldı.

```text
$ npm run lint --workspace apps/api
> oxlint --type-aware src/ test/
Found 0 warnings and 0 errors.
Finished in 363ms on 126 files with 107 rules using 8 threads.
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
Duration    759ms
```

```text
$ npm run db:migrate:test --workspace apps/api
Applying migrations to the isolated test database.
7 migrations found in prisma/migrations
No pending migrations to apply.
```

İlk e2e denemesinde yalnız OpenAPI committed dokümanı, DTO dokümantasyonu değiştikten sonra yeniden üretilmediği için `openapi.e2e-spec` başarısız oldu:

```text
$ npm run test:e2e --workspace apps/api
Test Files  1 failed | 16 passed (17)
Tests       1 failed | 162 passed (163)
# Yalnız openapi.e2e-spec > keeps the committed document in sync ...
```

`openapi:emit` çalıştırılıp aynı e2e yeniden koşuldu:

```text
$ npm run openapi:emit --workspace apps/api
Wrote OpenAPI document to /Users/kemalselcuk/.t3/projects/probedesk/apps/api/openapi.json

$ npm run test:e2e --workspace apps/api
Test Files  17 passed (17)
Tests       163 passed (163)
Duration    19.94s
```

Yeni `sse.e2e-spec.ts` 12 test içerir; toplam e2e 163 testtir.

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

Son emit sonrası committed doküman kontrolü ayrıca tekrarlandı:

```text
$ npx vitest run --config ./vitest.config.e2e.ts test/openapi.e2e-spec.ts
Test Files  1 passed (1)
Tests       3 passed (3)
```

`openapi:check` ayrıca denendi; committed `apps/api/openapi.json` uygulamayla eşleşti, ancak sahiplik dışındaki istemci şeması güncel olmadığı için drift bildirdi:

```text
$ npm run openapi:check
OpenAPI drift check failed: packages/api-client/src/schema.ts is out of date with apps/api/openapi.json. Run `npm run openapi:generate` and commit the result.
```

## OpenAPI ve istemci

`apps/api/openapi.json` içinde `/api/runs/{id}/events` için:

- `security: [{ session: [] }]`
- `Last-Event-ID` header parametresi, `after` integer query parametresi ve `id` path parametresi
- `200` yanıtı `text/event-stream` içerik tipi ve örnek frame
- `204`, `400`, `401`, `404` yanıtları
- `RunEventEnvelopeDto` component'i (`schemaVersion`, `runId`, `sequence`, `occurredAt`, `payload`)

OpenAPI tek tek SSE frame'lerini modelleyemez; bu nedenle `event:` adları, frame biçimi ve heartbeat davranışı controller açıklamasında ve `apps/api/README.md` içinde belgelendi. `packages/api-client` sahiplik dışı olduğu için SSE tipleri (`src/sse.ts`) bu görevde eklenmedi; P4-02 kapsamındadır. Bu nedenle `npm run openapi:check`, `packages/api-client/src/schema.ts` yeniden üretilmediği sürece drift verebilir.

## Kalan riskler ve kapsam dışı

- Poll tabanlı takip 200 ms varsayılan aralık kullanır; gecikme garantisi yoktur ve yük altında poll gecikmesi artabilir.
- Her heartbeat bir oturum sorgusu yapar; çok sayıda eşzamanlı SSE bağlantısında 15 saniyede bir ek DB yükü oluşur.
- Akış ortasında veritabanı erişilemezse bağlantı sessizce kapanır; istemci snapshot ile uzlaşmalıdır. Bu durum için ayrı bir SSE hata event'i sözleşmede yoktur.
- Yavaş istemciler için `response.write` backpressure'ı özel olarak sınırlandırılmadı; Node buffer'ı kullanılır.
- Heartbeat oturum kontrolü en geç sonraki heartbeat'tedir; oturum iptali ile bağlantı kapanışı arasında en fazla bir heartbeat aralığı vardır.
- `apps/api/src/common/openapi/openapi.ts` deterministik parametre sıralaması için değiştirildi; bu dosya nominal SSE sahiplik listesinin dışındadır ve incelemede ayrıca kontrol edilmelidir.
- `apps/api/test/openapi.e2e-spec.ts` yeni rota nedeniyle zorunlu asgari düzeyde değiştirildi.
- `docs/tasks/README.md` ve `docs/roadmap.md` sahiplik dışında olduğu için güncellenmedi; lead aynı commit'te P4-01 durumunu buralara işlemeli.
- Şema/migration değişikliği gerekmedi; `RunEvent` modeli ve `run_events` tablosu mevcut yapıyı karşılıyor.
- Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı; kart In Review'dadır, Accepted değildir.
