# Phase 4 — Canlı çalışma UI kanıtı (P4-02, P4-03, P4-04, P4-05)

- Tarih: 2026-11-03
- Kapsam: Angular SSE taşıması, snapshot + canlı olay birleştirme, `/runs/:runId/live` ekranı, yeniden bağlanma, sonsuz reconnect sınırı, terminal sonrası final snapshot ve oturum kaybı. Gerçek API + iki Chrome sekmesi + SIGKILL edilen akış proxy'si ile gerçek upstream kapanışına dayanan yeniden bağlanma smoke'u dahil.
- Ortam: macOS (arm64), Node.js 22.23.2, npm 11.6.2 (`packageManager`), Angular 22.2.4, RxJS 7.8.2, Vitest 5.1.0 + TestBed + `HttpTestingController`; gerçek koşuda Google Chrome headless, API `127.0.0.1:3100`, derlenmiş SPA'yı sunan `scripts/app-server.mjs` `127.0.0.1:4300`, SSE proxy `127.0.0.1:3200`.
- Uygulama commit'i: H-01/M-03 ürün düzeltmeleri `b9134d6` (`feat(web): add measurement charts…`) içinde; kanıt/script/doküman `8f06f33` içinde. Geçmiş yeniden yazılmadı; `8f06f33` tek başına H-01/M-03 ürün kodunu içermez. Bağımsız inceleme `b14209c` üzerinde yapıldı; düzeltmelerin yeniden incelemesi `phase-4-review.md` içindeki Fix re-check bölümündedir.
- Kapsam dışı: P4-01 backend SSE endpoint'inin kendi testleri, otomatik Playwright E2E (P7-01), P5 geçmiş/grafik çalışması, bağımsız teknik inceleme ve kullanıcı kabulü.

## Sonuç

Angular istemcisi artık `GET /api/runs/:id/events?after=<sequence>` akışını tipli bir RxJS servisiyle tüketiyor. Ekran önce `GET /api/runs/:id` snapshot'ını ve `lastEventSequence` cursor'ını yükler; run terminal değilse akış bu cursor'dan açılır. Olaylar yalnızca kesin sıradaki `sequence` değeriyle uygulanır; duplicate ve başka run'a ait olaylar yok sayılır, ileri boşlukta tahmin yapılmaz, yeni snapshot ile uzlaştırılır.

Canlı ekran çalışma durumu ile bağlantı durumunu ayrı etiketler. İlerleme backend'in `recordedSampleCount` / `expectedSampleCount` sayaçlarından gelir. İlk tolerans dışı örnek geldiği anda adım işaretlenir ve sonraki normal örnekler bu bilgiyi temizlemez. İptal yalnızca Operator'a ve yalnızca `RUNNING` durumda gösterilir; sunucu yanıtı gelene kadar terminal durum yazılmaz.

## Tasarım

### SSE sözleşmesi ve taşıma

- `apps/web/src/app/core/runs/run-event.types.ts` tek SSE sözleşme kaynağıdır. Sekiz olay adı, zarf alanları (`schemaVersion: 1`, `runId`, `sequence`, `occurredAt`, `payload`) ve payload tipleri burada tanımlıdır. REST DTO'ları yine generated `@probedesk/api-client` şemalarından gelir; ikinci bir REST modeli yoktur.
- `parseRunEventEnvelope` JSON, `schemaVersion`, UUID `runId`, güvenli tamsayı `sequence`, ISO tarih, SSE `id` ile sequence eşitliği ve olay tipine özel payload alanlarını doğrular. Hata `MalformedRunEventError` olarak fırlar; servis bunu kontrollü stream hatasına dönüştürür, DOM callback'inden kaçan istisna oluşmaz.
- `RunEventsService` aynı run için tek `EventSource` açar. Abonelik sayısı `refCount` gibi yönetilir: ilk abone kaynağı açar, son abone kapanınca `close()` çağrılır, tüm listener'lar `removeEventListener` ile sökülür. İstenen cursor otoritedir: `connect(runId, afterSequence)` mevcut oturumun cursor'ı ile istenen değer eşitse oturumu paylaşır; farklıysa eski kaynağı kapatıp oturumu tam `afterSequence` değerinden yeniden başlatır. Böylece facade gap uzlaştırması veya düşük cursor'lu bir yeniden bağlanma, taşımanın parse ettiği ama facade'ın uygulamadığı olayların ilerisine atlamaz. Yeniden başlatma sırasında eski kaynağın `onopen`/`onerror` callback'leri ve tüm named-event listener'ları sökülür; aynı run için aynı anda açık ikinci kaynak kalmaz.
- Bağlantı durumları `connecting`, `connected`, `reconnecting`, `disconnected`, `unauthenticated` olarak ayrı akıtılır.
- Ağ hatasında native EventSource'un kendi reconnect'i kapatılır; son teslim edilen sequence ile `after=<cursor>` kullanılarak sınırlı backoff (varsayılan 500/1000/2000/4000 ms) uygulanır. Deneme bütçesi yalnız bu run'a ait doğrulanmış ve cursor'ı ilerleten bir domain olayından sonra sıfırlanır; `200 text/event-stream` açılışı tek başına sıfırlama sayılmaz. Böylece açılıp olay üretmeden kapanan akış döngüsü de bütçeyi tüketir. Oturum içi otomatik reconnect bu teslim edilen cursor'ı kullanır; facade'ın uyguladığı cursor daha gerideyse facade açıkça o cursor ile `connect` çağırır ve taşıma oturumu o değere geri sarar. Denemeler tükenirse `unavailable` hatası + `disconnected` durumu ve görünür uyarı paneli üretilir; sonsuz döngü yoktur.
- `readyState === CLOSED` olan ölümcül kapanışta `/auth/me` çağrılır. 401 ise oturum `anonymous` işaretlenir, akış kapatılır, yeniden denenmez ve `/login?returnUrl=<mevcut URL>` adresine gidilir. 200 ise hata geçici kabul edilip sınırlı reconnect yapılır; diğer ağ hatalarında oturum kaybı uydurulmaz.
- Terminal olay (`run.completed`, `run.cancelled`, `run.interrupted`, `run.errored`) alındığında taşıma akışı kapatır ve tamamlar. Terminal run için ekran hiç akış açmaz.

### Snapshot + canlı birleştirme

- `applyRunEvent` her olayı `cursor + 1` kuralıyla uygular. `sequence <= cursor` duplicate, `sequence > cursor + 1` gap, başka `runId` foreign, terminal sonrası domain olayı `after-terminal` olarak sınıflandırılır.
- `measurement.recorded`: örnek `sampleIndex` ile bir kez eklenir; `recordedCount`, `outOfToleranceCount` ve run sayaçları monoton artar; `firstFailureSampleIndex` yalnızca daha küçük değerle değişebilir; `hasOutOfTolerance` OR'lanır. Tolerans kararı yeniden hesaplanmaz, payload'daki backend bayrağı kullanılır.
- `step.completed`: backend outcome'u, istatistikleri ve sayaçları uygular. Snapshot merge sırasında dolu outcome/istatistik null ile ezilmez.
- `mergeRunSnapshot`: terminal run'ı RUNNING snapshot ile değiştirmez; adım durumu PENDING → RUNNING → terminal yönünde ilerler; ölçümler `sampleIndex` birleşimiyle korunur; ilk ihlal ve tolerans bayrakları geri alınmaz.
- Gap geldiğinde akış kapatılır, yeni snapshot okunur, cursor `Math.max(uygulanan cursor, snapshot.lastEventSequence)` olur ve akış yeniden açılır. Cursor asla uygulanan değerin gerisine çekilmez; snapshot ilerideyse yeni cursor'dan, snapshot gerideyse uygulanan cursor'dan devam edilir. Yeniden açılışta taşıma oturumu farklı cursor'ı otomatik olarak yeniden başlatır; ileri cursor'lı eski oturum yeniden kullanılmaz. Eksik olay tahmin edilmez, çift uygulanmaz.
- Terminal olaydan sonra final snapshot en fazla üç kez denenir. Bu snapshot iptal/kesinti/hatada adım durumlarını (`CANCELLED`, `INTERRUPTED`, `NOT_RUN`, `ERROR`) tamamlar; akış yeniden açılmaz ve terminal durum geri alınmaz. Üç deneme de başarısız olursa run terminal kalır, “Final step detail could not be loaded” uyarısı gösterilir ve son snapshot'ta `RUNNING`/`PENDING` kalan adımlar “Unavailable” olarak işaretlenir; stale “In progress”/“Pending” metni gösterilmez.

### Live Run ekranı

- `/runs/:runId/live` placeholder'ı gerçek ekranla değiştirildi. Plan adı/sürüm, run durumu, ayrı bağlantı paneli, backend sayaçlarından ilerleme, sıralı adım listesi, canlı örnek sayıları, ilk ihlal işareti ve erişilebilir "Recent measurements" tablosu gösterilir.
- Çalışma durumu badge'i (`Running`, `Passed`, `Failed`, `Cancelled`, `Interrupted`, `Error`) ile bağlantı etiketi (`Connected`, `Reconnecting`, `Disconnected`, `Signed out`) ayrı metinlerdir; renk tek gösterge değildir.
- İptal düğmesi yalnızca Operator + `RUNNING` için görünür. Onay dialog'undan sonra "Cancelling…" gösterilir; sunucu yanıtı gelene kadar hiçbir terminal alanı yazılmaz. Hata durumunda run RUNNING kalır ve hata paneli görünür.
- Terminal özet, kısmi/iptal/kesinti/hatada eksik örnekleri sıfır gibi göstermez; reason code ve "No further live updates" notu gösterilir.
- `#live-run-details-link` her zaman `/runs/:runId` adresine gider. Route'tan ayrılmak yalnızca facade/stream aboneliğini kapatır; çalışma iptal edilmez. Geri dönüşte snapshot yeniden okunur ve yeni cursor'dan devam edilir.
- Bileşen `DestroyRef` + `takeUntilDestroyed` kullanır; facade bileşen seviyesinde sağlanır, böylece route teardown'ı tüm HTTP/SSE aboneliklerini kapatır.

## Eklenen ve değişen dosyalar

### Yeni

- `apps/web/src/app/core/runs/run-event.types.ts`: SSE zarf/payload sözleşmesi, doğrulayıcı parser ve `MalformedRunEventError`.
- `apps/web/src/app/core/runs/run-events.service.ts`: paylaşılan EventSource oturumu, bağlantı durumları, sınırlı reconnect, `/auth/me` oturum probu ve login yönlendirmesi.
- `apps/web/src/app/core/runs/testing/fake-event-source.ts`: testler için deterministik EventSource double'ı ve zarf üreticisi.
- `apps/web/src/app/features/runs/live-run.reducer.ts`: saf `applyRunEvent` ve `mergeRunSnapshot` fonksiyonları.
- `apps/web/src/app/features/runs/live-run.facade.ts`: snapshot yükleme, stream birleştirme, gap uzlaştırma, terminal final snapshot ve sunucu onaylı iptal.
- `apps/web/src/app/features/runs/live-run-page.html`, `.scss`: canlı ekran şablonu ve stilleri.
- `apps/web/src/app/features/runs/testing/run-fixtures.ts`: facade ve ekran testleri için ortak snapshot/olay fixture'ları.
- `apps/web/src/app/core/runs/run-event.types.spec.ts` (11 test): olay adları, geçerli zarf, bilinmeyen tip, bozuk JSON, şema sürümü, UUID/sequence/tarih, SSE id uyuşmazlığı, eksik tolerans bayrağı.
- `apps/web/src/app/core/runs/run-events.service.spec.ts` (14 senaryo): açma/olay/kapatma, yabancı run, bozuk payload, reconnect cursor'ı, uygulanmamış gap olayından sonra düşük cursor'la oturumu yeniden başlatma, hata sonrası bekleyen ileri reconnect'in iptali ve tek açık kaynak, `/auth/me` 200/401, paylaşımlı abonelik, terminal kapanışı, sınırlı deneme tükenmesi, olaysız aç/kapa döngüsünün bütçeyi tüketmesi ve bütçenin yalnız ilerleyen bir domain olayından sonra sıfırlanması; duplicate replay'in bütçe tazelememesi.
- `apps/web/src/app/features/runs/live-run.reducer.spec.ts` (10 senaryo): sıralı uygulama, step PENDING→RUNNING→COMPLETED geçişi, duplicate, gap, ilk ihlal kalıcılığı, yabancı run, terminal sonrası domain olayı, terminal geri dönmezliği, ihlal/ölçüm birleşimi, outcome korunması.
- `apps/web/src/app/features/runs/live-run.facade.spec.ts` (15 senaryo): snapshot sonrası stream cursor'ı, canlı örnek/ihlal, duplicate, gap uzlaştırma, hayatta kalan ileri cursor'lı oturumla gap uzlaştırma ve 11..15 replay'inin atlanmaması, terminal + final snapshot, terminal geri dönmezliği, final snapshot'ın üç denemede tükenmesi ve adım durumlarının unavailable işaretlenmesi, sınırlı denemede toparlanma, iptal onayı, iptal hatası, ağ kesintisi, terminal snapshot'ta akış yokluğu, stale snapshot reddi.
- `docs/evidence/phase-4-live-ui.md`: bu dosya.

### Değişen

- `apps/web/src/app/features/runs/live-run-page.ts`: placeholder yerine `LiveRunFacade` kullanan gerçek bileşen.
- `apps/web/src/app/features/runs/live-run-page.spec.ts`: placeholder testleri gerçek ekran senaryolarıyla değiştirildi (14 test).
- `apps/web/src/app/features/routes.spec.ts`: Live Run route smoke testindeki `P4-04` placeholder metin beklentisi kaldırıldı. P3-09 kanıtında da aynı gerekçeyle dokunulan ortak route testidir; başka bir worker'ın dosyası değildir.
- `docs/tasks/P4-02.md`, `P4-03.md`, `P4-04.md`, `P4-05.md`, `P4-06.md`, `P4-07.md`: durum `In Review`, kabul kutuları, gerçek komut sonuçları, kanıt bağlantıları ve inceleme bulguları.
- `scripts/app-server.mjs` (yeni): derlenmiş SPA'yı sunar ve `/api` isteklerini `127.0.0.1:3200` akış proxy'sine gerçek soket kapanışını koruyarak aktarır.
- `scripts/phase-4-live-check.mjs`: kesinti artık yapay `error` olayıyla değil, `sse-proxy` SIGKILL edildiğinde app-server'ın upstream kapanışını downstream'e yansıtmasıyla oluşur; iki sekme de kendi `onerror` yolunu kullanır.

### Reconnect düzeltmesi (2026-11-03)

Gerçek iki-sekme koşusu, taşıma oturumunun cursor'ının tüketicinin uyguladığı cursor'dan ileri gidebildiğini gösterdi. Oturum bir olayı parse ederken `lastSequence` değerini ilerletiyordu; facade aynı olayı gap olarak reddettiğinde taşıma çoktan ilerideydi. `connect(runId, afterSequence)` mevcut oturumu cursor farkını yok sayarak paylaşıyor, gap uzlaştırması da bu ileri cursor'lı oturumu yeniden kullanabiliyordu.

- `RunEventsService.connect`: istenen cursor oturumun cursor'ından farklıysa oturum `restartAt(afterSequence)` ile tam o değerden yeniden başlar. Eski `EventSource` önce kapatılır, `onopen`/`onerror` ve tüm named-event listener'ları sökülür, bekleyen reconnect timer'ı temizlenir. Deneme bütçesi burada sıfırlanmaz; yalnız cursor'ı ilerleten bir domain olayı bütçeyi tazeler. Aynı run için aynı anda açık ikinci kaynak kalmaz.
- `RunEventSession.restartAt`: yeniden başlatmadan sonra kaynak istenen `after` değeriyle açılır; aboneler bağlı kalır ve tekrar gelen sequence'ler reducer tarafından duplicate olarak yok sayılır.
- `LiveRunFacade.reconcileGap`: snapshot sonrası cursor `Math.max(uygulanan, snapshot.lastEventSequence)` olur; uygulanan cursor asla geri alınmaz. Yeni stream istenen cursor'dan açılır, böylece snapshot sonrası her olay tam bir kez replay edilir.
- Regresyon testleri: `run-events.service.spec.ts` iki yeni senaryo (uygulanmamış gap olayı + düşük cursor'la yeniden başlatma; hata sonrası bekleyen ileri reconnect'in iptali ve tek açık kaynak), `live-run.facade.spec.ts` bir yeni senaryo (hayatta kalan ileri cursor'lı oturumla gap uzlaştırma; 11..15 replay'inin atlanmaması ve tek açık kaynak).

### İnceleme düzeltmeleri — H-01 ve M-03 (2026-11-03)

- `RunEventSession.handleOpen` artık `attempt = 0` yapmaz. `200 text/event-stream` açıp domain olayı üretmeden kapanan akış, her açılışta taze deneme bütçesi alamaz; tanımlı gecikme bütçesi tükendiğinde `unavailable` + `disconnected` üretilir. Bütçe yalnız `handleMessage` içinde doğrulanmış, bu run'a ait ve cursor'ı ilerleten bir olaydan sonra sıfırlanır; duplicate replay tazelemez.
- `restartAt` de bütçeyi sıfırlamaz; tüketici kaynaklı cursor yeniden başlatması sağlık kanıtı sayılmaz.
- Bileşen testi, bütçe tükendiğinde `#live-stream-warning` panelinin, “Live updates stopped after several reconnect attempts” metninin ve `disconnected` etiketinin göründüğünü doğrular.
- Terminal sonrası final snapshot tek sefer yerine en fazla üç kez denenir. Üçü de başarısız olursa `#live-final-steps-warning` gösterilir; `RUNNING`/`PENDING` kalan adımlar “Unavailable” olarak işaretlenir ve “In progress”/“Pending” metni gösterilmez. Başarılı bir deneme uyarıyı temizler.
- Ayrıntılı düzeltme kaydı: [phase-4-review-fixes-web.md](phase-4-review-fixes-web.md).

## Test eşlemesi

| Gereksinim | Test kanıtı |
|---|---|
| Named event/payload doğrulama, bozuk olay | `run-event.types.spec.ts`; `run-events.service.spec.ts` malformed senaryosu |
| Unsubscribe'da kaynak/listener kapanışı | `run-events.service.spec.ts` open/close ve paylaşımlı abonelik testleri |
| Sıra, duplicate, yabancı run | `live-run.reducer.spec.ts`; `live-run.facade.spec.ts` |
| Gap → snapshot uzlaştırma | `live-run.facade.spec.ts` gap testi; hayatta kalan ileri cursor'lı oturum testi |
| Terminal geri dönmezliği | `live-run.reducer.spec.ts`; `live-run.facade.spec.ts` terminal testleri |
| İlk ihlalin kalıcılığı | `live-run.reducer.spec.ts`; `live-run.facade.spec.ts`; `live-run-page.spec.ts` |
| Backend sayaçlarından ilerleme | `live-run-page.spec.ts` "1 of 4 samples recorded (25%)" |
| Ayrı run/bağlantı etiketleri | `live-run-page.spec.ts` connected/reconnecting testleri |
| Operator-only iptal ve sunucu onayı | `live-run-page.spec.ts` iptal testleri; `live-run.facade.spec.ts` iptal testleri |
| Reconnect cursor/replay | `run-events.service.spec.ts` after=4 reconnect; `live-run.facade.spec.ts` after=4 |
| İstenen cursor otoritesi, düşük cursor'dan devam | `run-events.service.spec.ts` gap sonrası restart ve hata sonrası düşük cursor testleri; `live-run.facade.spec.ts` gap + hayatta kalan oturum testi |
| Olaysız aç/kapa döngüsünde sınırlı reconnect | `run-events.service.spec.ts` olaysız turlar + `unavailable`/`disconnected`; bütçenin yalnız ilerleyen bir domain olayından sonra sıfırlanması; duplicate replay'in bütçe tazelememesi |
| Bütçe tükendiğinde görünür uyarı | `live-run-page.spec.ts` `#live-stream-warning` ve “Reconnect live updates” |
| Terminal sonrası final snapshot hatası | `live-run.facade.spec.ts` üç deneme + unavailable; `live-run-page.spec.ts` `#live-final-steps-warning` ve `UNAVAILABLE` adım rozeti |
| 401 oturum kaybı | `run-events.service.spec.ts` `/auth/me` 401 + login redirect |
| Route teardown ve geri dönüş | `live-run-page.spec.ts` View run details + geri dönüş testi |
| Aynı run için tek EventSource | `run-events.service.spec.ts` paylaşımlı abonelik ve restart testleri |

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: repo kökü, 2026-11-03.

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 40ms on 81 files with 93 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
(çıkış kodu 0; hata yok)
```

```text
$ npm run test --workspace apps/web
Test Files  27 passed (27)
Tests       253 passed (253)
Duration    4.41s
```

Önceki taban 199 test (23 dosya) korunmuştur. Phase 4'te dört yeni test dosyası eklendi ve reconnect düzeltmesiyle birlikte üç yeni regresyon senaryosu (toplam 253 test) çalışıyor.

```text
$ npm run build --workspace apps/web
Application bundle generation complete. [2.595 seconds]
Output location: apps/web/dist/web
(warning/error yok)
```

### İnceleme düzeltmeleri sonrası (2026-11-03 22:10 CET)

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 19ms on 94 files with 93 rules using 8 threads.
EXIT: 0

$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
EXIT: 0

$ npm run test --workspace apps/web
Test Files  31 passed (31)
Tests       314 passed (314)
Duration    8.16s
EXIT: 0

$ npm run build --workspace apps/web
Application bundle generation complete. [2.269 seconds]
WARNING: Module 'hammerjs' used by 'chartjs-plugin-zoom' is not ESM
Output location: apps/web/dist/web
EXIT: 0
```

`314` testin `8'i` bu düzeltmede eklenen H-01/M-03 senaryolarıdır; kalan artış ortak checkout'taki P5 testlerinden gelir. P4 kapsamındaki beş test dosyası ayrıca `64/64` geçmiştir. Tek build uyarısı P5 grafik eklentisinin CommonJS bağımlılığıdır; Phase 4 değişikliği değildir.

## Gerçek API / tarayıcı smoke

Gerçek iki-sekme kontrolü 2026-11-03 akşamı çalıştırıldı: API `127.0.0.1:3100`, derlenmiş SPA `scripts/app-server.mjs` üzerinden `127.0.0.1:4300`, `/api` istekleri `scripts/sse-proxy.mjs` üzerinden 3200'den API'ye aktarıldı. Yayınlanmış 3 adımlı plan (30 örnek, 200 ms) `NORMAL` senaryosuyla başlatıldı ve aynı run için iki Chrome sekmesi `/runs/:id/live` adresinde açıldı. Akış proxy'si SIGKILL edildi, ~1.5 saniye sonra yeniden başlatıldı.

İlk koşu (düzeltmeden önceki gözlem): sekme A yeniden bağlandı ve terminal duruma ulaştı; sekme B `Connection: Connected` etiketiyle 8/90'da kaldı. Bu görüntünün doğrudan nedeni test ortamıydı: Vite, 3200'deki proxy SIGKILL edildikten sonra downstream soketini açık tuttu; sekme B hiç `error` olayı görmedi. O dönemde betik iki sekmeye de yapay `error` gönderiyordu; bu nedenle o kanıt gerçek ağ kesintisi olarak sunulmadı.

Bu gözlemden bağımsız olarak kod incelemesi ve regresyon testleri, taşıma oturumunun tüketicinin uygulamadığı olaylardan sonra ileri bir cursor'ı yeniden kullanabildiğini gösterdi: oturum bir olayı parse ederken `lastSequence` ilerliyor, facade aynı olayı gap olarak reddettiğinde taşıma çoktan ileride oluyor ve `connect()` farklı cursor isteğini mevcut oturuma birleştiriyordu. Bu ayrı ve gerçek bir kusurdu; yukarıdaki `restartAt` düzeltmesi ve yeni testlerle kapatıldı.

Düzeltme sonrası son koşu (run `e50636ea-6f8f-487c-85a6-822801dd9855`): `app-server` 4300'de SPA'yı ve `/api` proxy'sini sundu, yapay hata gönderilmedi. `sse-proxy` SIGKILL edildikten `154 ms` sonra iki sekme de `Reconnecting` gösterdi; kesinti anında sekme A'da eski EventSource `readyState=2` (kapalı) ve yeni bir kaynak açılmamıştı. Proxy yeniden açıldıktan sonra iki sekme de yeniden bağlandı; run sunucuda ilerlemeye devam etti. Terminalde iki sekme de `Passed`, `90 of 90`, sekme A `Connection: Disconnected`, `Run finished`; `Runtime.exceptionThrown` yok. Kesinti sırasındaki `7` istek `502 UPSTREAM_UNAVAILABLE` döndü (beklenen gerçek kesinti); başka hata yanıtı yok.

Not: Bu turdaki canlı koşuda terminal sonrası final snapshot `200` döndü; incelemede kaydedilen tek seferlik boş gövdeli `400` yeniden üretilmedi. Ekran artık final snapshot'ı üç kez dener, yine başarısız olursa terminal durumu korur ve kalan `RUNNING`/`PENDING` adımları “Unavailable” olarak işaretler; stale “In progress” göstermez. Gerçek 401 oturum sona erme akışı `scripts/phase-4-lifecycle-check.mjs` ile kapatıldı ([phase-4-remaining-checks.md](phase-4-remaining-checks.md)); erişilebilirlik turları hâlâ P7 kapsamındadır.

## Kalan riskler ve ertelenen işler

1. **Gerçek SSE smoke sınırlı kapsamdadır.** İki sekme, SIGKILL edilen akış proxy'si ve yeniden başlatma gerçek app-server üzerinden doğrulandı; heartbeat'in 15 saniyelik comment davranışı, 204 terminal yanıtı ve oturum expiry/revocation (T16) bu tarayıcı koşusunda ayrıca zorlanmadı. Heartbeat comment'ları EventSource API'sinde görünmediği için istemci yalnızca hata olayına veya uygulama olaylarına tepki verebilir.
2. **`/auth/me` yalnızca ölümcül kapanışta çağrılır.** `CONNECTING` durumundaki ağ hatalarında oturum probu yapılmaz; bu bilinçli bir ayrımdır. 403/404 gibi HTTP nedenleri EventSource tarafından görülemediği için geçici sayılıp en fazla dört kez denenir; sonra `disconnected` olur ve kullanıcı yeniden bağlanmayı seçebilir.
3. **Terminal sonrası final snapshot en fazla üç kez denenir.** Terminal olay sayaç/outcome taşır, fakat iptal/kesinti adım durumlarını taşımaz. Üç deneme de başarısız olursa terminal durum korunur, “Final step detail could not be loaded” uyarısı gösterilir ve `RUNNING`/`PENDING` kalan adımlar “Unavailable” olarak işaretlenir. Bu turda final snapshot her koşuda `200` döndü; incelemedeki tek seferlik `400` yeniden üretilmedi ve kök nedeni bilinmiyor.
4. **Yalnızca son 20 örnek görsel tabloda gösterilir.** Tüm örnekler facade state'inde tutulur ve `/runs/:runId` kaydında mevcuttur; grafik/zoom P5 kapsamındadır.
5. **Farklı cursor isteyen tüketiciler aynı oturumu yeniden başlatır.** Uygulamada run başına tek facade tüketicisi vardır. İkinci bir tüketici farklı cursor isterse oturum istenen cursor'a sarılır; mevcut aboneler tekrar eden sequence'leri reducer sayesinde yok sayar, ancak ileri cursor isteyen bir tüketici diğerinin arada kalan olaylarını atlamasına yol açabilir. Bu, tek EventSource kuralının bilinçli sonucudur ve mevcut ekran akışında oluşmaz.
6. **Vite dev-server yarı-açık soket davranışı artık kontrol yolunda değildir.** `scripts/app-server.mjs`, `/api` için upstream kapanışını downstream SSE yanıtına yansıtır; betik yapay `error` göndermez. Üretimde ters proxy'nin bağlantıyı kapatması beklenir; istemci, görünmeyen heartbeat comment'ları yüzünden yarı-açık bir soketi tek başına ayırt edemez.
7. **`routes.spec.ts` sahiplik listesi dışında değiştirildi.** Live Run placeholder "P4-04" beklentisi gerçek ekranla uyumsuz olduğu için kaldırıldı. Başka bir web worker'ı yoktu; lead bu değişikliği incelemelidir.
8. **Erişilebilirlik gerçek tarayıcıda denenmedi.** Tablo caption/scope, canlı bölge ve metin etiketleri eklendi; klavye/ekran okuyucu turu P7-04 kapsamındadır.
9. **Bağımsız yeniden inceleme ve kullanıcı kabulü yapılmadı.** Yedi P4 kartı `In Review`; hiçbiri `Accepted` değildir. H-01/M-01/M-03 düzeltmeleri ve M-02 kanıt güncellemeleri yeniden incelenmelidir.
10. **P5 geçmiş/grafik çalışması bu düzeltmenin kapsamı dışındadır.** Ortak checkout'ta eşzamanlı P5 dosyaları vardı; bu worker onlara dokunmadı. Build'de kalan `hammerjs` CommonJS uyarısı P5 grafik eklentisinden gelir. Commit/push bu worker tarafından yapılmadı.
