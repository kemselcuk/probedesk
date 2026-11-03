# Phase 4 — Canlı çalışma UI kanıtı (P4-02, P4-03, P4-04, P4-05)

- Tarih: 2026-11-03
- Kapsam: Angular SSE taşıması, snapshot + canlı olay birleştirme, `/runs/:runId/live` ekranı, yeniden bağlanma ve oturum kaybı. Gerçek API + iki Chrome sekmesi + SIGKILL edilen akış proxy'si ile yeniden bağlanma smoke'u dahil.
- Ortam: macOS (arm64), Node.js 22.23.2, npm 11.6.2 (`packageManager`), Angular 22.2.4, RxJS 7.8.2, Vitest 5.1.0 + TestBed + `HttpTestingController`; gerçek koşuda Google Chrome headless, API `127.0.0.1:3100`, Angular dev server `localhost:4200`, SSE proxy `127.0.0.1:3200`.
- Uygulama commit'i: Henüz yok. Çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge bir commit hash'i iddia etmez.
- Kapsam dışı: P4-01 backend SSE endpoint'inin kendi testleri, otomatik Playwright E2E (P7-01), grafik/zoom (P5), bağımsız teknik inceleme ve kullanıcı kabulü.

## Sonuç

Angular istemcisi artık `GET /api/runs/:id/events?after=<sequence>` akışını tipli bir RxJS servisiyle tüketiyor. Ekran önce `GET /api/runs/:id` snapshot'ını ve `lastEventSequence` cursor'ını yükler; run terminal değilse akış bu cursor'dan açılır. Olaylar yalnızca kesin sıradaki `sequence` değeriyle uygulanır; duplicate ve başka run'a ait olaylar yok sayılır, ileri boşlukta tahmin yapılmaz, yeni snapshot ile uzlaştırılır.

Canlı ekran çalışma durumu ile bağlantı durumunu ayrı etiketler. İlerleme backend'in `recordedSampleCount` / `expectedSampleCount` sayaçlarından gelir. İlk tolerans dışı örnek geldiği anda adım işaretlenir ve sonraki normal örnekler bu bilgiyi temizlemez. İptal yalnızca Operator'a ve yalnızca `RUNNING` durumda gösterilir; sunucu yanıtı gelene kadar terminal durum yazılmaz.

## Tasarım

### SSE sözleşmesi ve taşıma

- `apps/web/src/app/core/runs/run-event.types.ts` tek SSE sözleşme kaynağıdır. Sekiz olay adı, zarf alanları (`schemaVersion: 1`, `runId`, `sequence`, `occurredAt`, `payload`) ve payload tipleri burada tanımlıdır. REST DTO'ları yine generated `@probedesk/api-client` şemalarından gelir; ikinci bir REST modeli yoktur.
- `parseRunEventEnvelope` JSON, `schemaVersion`, UUID `runId`, güvenli tamsayı `sequence`, ISO tarih, SSE `id` ile sequence eşitliği ve olay tipine özel payload alanlarını doğrular. Hata `MalformedRunEventError` olarak fırlar; servis bunu kontrollü stream hatasına dönüştürür, DOM callback'inden kaçan istisna oluşmaz.
- `RunEventsService` aynı run için tek `EventSource` açar. Abonelik sayısı `refCount` gibi yönetilir: ilk abone kaynağı açar, son abone kapanınca `close()` çağrılır, tüm listener'lar `removeEventListener` ile sökülür. İstenen cursor otoritedir: `connect(runId, afterSequence)` mevcut oturumun cursor'ı ile istenen değer eşitse oturumu paylaşır; farklıysa eski kaynağı kapatıp oturumu tam `afterSequence` değerinden yeniden başlatır. Böylece facade gap uzlaştırması veya düşük cursor'lu bir yeniden bağlanma, taşımanın parse ettiği ama facade'ın uygulamadığı olayların ilerisine atlamaz. Yeniden başlatma sırasında eski kaynağın `onopen`/`onerror` callback'leri ve tüm named-event listener'ları sökülür; aynı run için aynı anda açık ikinci kaynak kalmaz.
- Bağlantı durumları `connecting`, `connected`, `reconnecting`, `disconnected`, `unauthenticated` olarak ayrı akıtılır.
- Ağ hatasında native EventSource'un kendi reconnect'i kapatılır; son teslim edilen sequence ile `after=<cursor>` kullanılarak sınırlı backoff (varsayılan 500/1000/2000/4000 ms) uygulanır. Oturum içi otomatik reconnect bu teslim edilen cursor'ı kullanır; facade'ın uyguladığı cursor daha gerideyse facade açıkça o cursor ile `connect` çağırır ve taşıma oturumu o değere geri sarar. Denemeler tükenirse `disconnected` + görünür hata üretilir; sonsuz döngü yoktur.
- `readyState === CLOSED` olan ölümcül kapanışta `/auth/me` çağrılır. 401 ise oturum `anonymous` işaretlenir, akış kapatılır, yeniden denenmez ve `/login?returnUrl=<mevcut URL>` adresine gidilir. 200 ise hata geçici kabul edilip sınırlı reconnect yapılır; diğer ağ hatalarında oturum kaybı uydurulmaz.
- Terminal olay (`run.completed`, `run.cancelled`, `run.interrupted`, `run.errored`) alındığında taşıma akışı kapatır ve tamamlar. Terminal run için ekran hiç akış açmaz.

### Snapshot + canlı birleştirme

- `applyRunEvent` her olayı `cursor + 1` kuralıyla uygular. `sequence <= cursor` duplicate, `sequence > cursor + 1` gap, başka `runId` foreign, terminal sonrası domain olayı `after-terminal` olarak sınıflandırılır.
- `measurement.recorded`: örnek `sampleIndex` ile bir kez eklenir; `recordedCount`, `outOfToleranceCount` ve run sayaçları monoton artar; `firstFailureSampleIndex` yalnızca daha küçük değerle değişebilir; `hasOutOfTolerance` OR'lanır. Tolerans kararı yeniden hesaplanmaz, payload'daki backend bayrağı kullanılır.
- `step.completed`: backend outcome'u, istatistikleri ve sayaçları uygular. Snapshot merge sırasında dolu outcome/istatistik null ile ezilmez.
- `mergeRunSnapshot`: terminal run'ı RUNNING snapshot ile değiştirmez; adım durumu PENDING → RUNNING → terminal yönünde ilerler; ölçümler `sampleIndex` birleşimiyle korunur; ilk ihlal ve tolerans bayrakları geri alınmaz.
- Gap geldiğinde akış kapatılır, yeni snapshot okunur, cursor `Math.max(uygulanan cursor, snapshot.lastEventSequence)` olur ve akış yeniden açılır. Cursor asla uygulanan değerin gerisine çekilmez; snapshot ilerideyse yeni cursor'dan, snapshot gerideyse uygulanan cursor'dan devam edilir. Yeniden açılışta taşıma oturumu farklı cursor'ı otomatik olarak yeniden başlatır; ileri cursor'lı eski oturum yeniden kullanılmaz. Eksik olay tahmin edilmez, çift uygulanmaz.
- Terminal olaydan sonra tek bir final snapshot okunur. Bu snapshot iptal/kesinti/hatada adım durumlarını (`CANCELLED`, `INTERRUPTED`, `NOT_RUN`, `ERROR`) tamamlar; akış yeniden açılmaz ve terminal durum geri alınmaz.

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
- `apps/web/src/app/core/runs/run-events.service.spec.ts` (11 senaryo): açma/olay/kapatma, yabancı run, bozuk payload, reconnect cursor'ı, uygulanmamış gap olayından sonra düşük cursor'la oturumu yeniden başlatma, hata sonrası bekleyen ileri reconnect'in iptali ve tek açık kaynak, `/auth/me` 200/401, paylaşımlı abonelik, terminal kapanışı, sınırlı deneme tükenmesi.
- `apps/web/src/app/features/runs/live-run.reducer.spec.ts` (10 senaryo): sıralı uygulama, step PENDING→RUNNING→COMPLETED geçişi, duplicate, gap, ilk ihlal kalıcılığı, yabancı run, terminal sonrası domain olayı, terminal geri dönmezliği, ihlal/ölçüm birleşimi, outcome korunması.
- `apps/web/src/app/features/runs/live-run.facade.spec.ts` (13 senaryo): snapshot sonrası stream cursor'ı, canlı örnek/ihlal, duplicate, gap uzlaştırma, hayatta kalan ileri cursor'lı oturumla gap uzlaştırma ve 11..15 replay'inin atlanmaması, terminal + final snapshot, terminal geri dönmezliği, iptal onayı, iptal hatası, ağ kesintisi, terminal snapshot'ta akış yokluğu, stale snapshot reddi.
- `docs/evidence/phase-4-live-ui.md`: bu dosya.

### Değişen

- `apps/web/src/app/features/runs/live-run-page.ts`: placeholder yerine `LiveRunFacade` kullanan gerçek bileşen.
- `apps/web/src/app/features/runs/live-run-page.spec.ts`: placeholder testleri gerçek ekran senaryolarıyla değiştirildi (11 test).
- `apps/web/src/app/features/routes.spec.ts`: Live Run route smoke testindeki `P4-04` placeholder metin beklentisi kaldırıldı. P3-09 kanıtında da aynı gerekçeyle dokunulan ortak route testidir; başka bir worker'ın dosyası değildir.
- `docs/tasks/P4-02.md`, `P4-03.md`, `P4-04.md`, `P4-05.md`: durum `In Review`, kabul kutuları ve gerçek komut sonuçları.
- `scripts/phase-4-live-check.mjs`: gerçek koşuda kesinti sinyali artık her iki sekmeye de gönderiliyor, iki sekmenin de terminal duruma ulaşması bekleniyor ve başarısız HTTP yanıtları tanı için kaydediliyor.

### Reconnect düzeltmesi (2026-11-03)

Gerçek iki-sekme koşusu, taşıma oturumunun cursor'ının tüketicinin uyguladığı cursor'dan ileri gidebildiğini gösterdi. Oturum bir olayı parse ederken `lastSequence` değerini ilerletiyordu; facade aynı olayı gap olarak reddettiğinde taşıma çoktan ilerideydi. `connect(runId, afterSequence)` mevcut oturumu cursor farkını yok sayarak paylaşıyor, gap uzlaştırması da bu ileri cursor'lı oturumu yeniden kullanabiliyordu.

- `RunEventsService.connect`: istenen cursor oturumun cursor'ından farklıysa oturum `restartAt(afterSequence)` ile tam o değerden yeniden başlar. Eski `EventSource` önce kapatılır, `onopen`/`onerror` ve tüm named-event listener'ları sökülür, bekleyen reconnect timer'ı temizlenir, deneme sayacı sıfırlanır. Aynı run için aynı anda açık ikinci kaynak kalmaz.
- `RunEventSession.restartAt`: yeniden başlatmadan sonra kaynak istenen `after` değeriyle açılır; aboneler bağlı kalır ve tekrar gelen sequence'ler reducer tarafından duplicate olarak yok sayılır.
- `LiveRunFacade.reconcileGap`: snapshot sonrası cursor `Math.max(uygulanan, snapshot.lastEventSequence)` olur; uygulanan cursor asla geri alınmaz. Yeni stream istenen cursor'dan açılır, böylece snapshot sonrası her olay tam bir kez replay edilir.
- Regresyon testleri: `run-events.service.spec.ts` iki yeni senaryo (uygulanmamış gap olayı + düşük cursor'la yeniden başlatma; hata sonrası bekleyen ileri reconnect'in iptali ve tek açık kaynak), `live-run.facade.spec.ts` bir yeni senaryo (hayatta kalan ileri cursor'lı oturumla gap uzlaştırma; 11..15 replay'inin atlanmaması ve tek açık kaynak).

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

## Gerçek API / tarayıcı smoke

Gerçek iki-sekme kontrolü 2026-11-03 akşamı çalıştırıldı: API `127.0.0.1:3100`, Angular dev server `localhost:4200`, `/api` istekleri `scripts/sse-proxy.mjs` üzerinden 3200'den API'ye aktarıldı. Yayınlanmış 3 adımlı plan (30 örnek, 200 ms) `NORMAL` senaryosuyla başlatıldı ve aynı run için iki Chrome sekmesi `/runs/:id/live` adresinde açıldı. Akış proxy'si SIGKILL edildi, 2 saniye sonra yeniden başlatıldı; iki sekme de yeniden bağlanmaya zorlandı.

İlk koşu (test betiği düzeltmesinden önceki gözlem): sekme A yeniden bağlandı ve terminal duruma ulaştı; sekme B `Connection: Connected` etiketiyle 8/90'da kaldı. Sekme B'nin EventSource'u `after=10` ile açık görünüyordu, sunucu ise çok ilerideydi. Bu görüntünün doğrudan nedeni test ortamıydı: Vite, 3200'deki proxy SIGKILL edildikten sonra downstream soketini açık tuttu; sekme B hiç `error` olayı görmedi ve kontrol betiği yalnızca sekme A'ya yapay `error` gönderiyordu. Betik artık kesintiyi iki sekmeye de bildiriyor ve iki sekmenin de terminal duruma ulaşmasını bekliyor.

Bu gözlemden bağımsız olarak kod incelemesi ve regresyon testleri, taşıma oturumunun tüketicinin uygulamadığı olaylardan sonra ileri bir cursor'ı yeniden kullanabildiğini gösterdi: oturum bir olayı parse ederken `lastSequence` ilerliyor, facade aynı olayı gap olarak reddettiğinde taşıma çoktan ileride oluyor ve `connect()` farklı cursor isteğini mevcut oturuma birleştiriyordu. Bu ayrı ve gerçek bir kusurdu; yukarıdaki `restartAt` düzeltmesi ve yeni testlerle kapatıldı.

Düzeltme sonrası koşu (run `d1c2d868-088a-4cc2-853c-c50c08d9ee57`): iki sekme de `Passed`, `90 of 90`, `Connection: Disconnected`, `Run finished`; `Runtime.exceptionThrown` yok. Son doğrulama koşusu (run `d3fb8417-347d-447c-be40-7d910d60865c`) de sunucuda `COMPLETED`/`PASSED`, `recordedSampleCount=90`, `expectedSampleCount=90`, `lastEventSequence=98` ile bitti; iki sekme de `Passed` ve `90/90` durumuna ulaştı, `offlineLabel` ara durumda `Reconnecting` idi. Sekmelerin bağımsız oturumları ayrı EventSource zincirleri kullandı; bir sekmenin reconnect'i diğerini etkilemedi.

Not: Bu koşularda terminal olaydan sonraki final snapshot GET'i, test proxy'si üzerinden boş gövdeli `400` aldı; istek proxy tarafından API'ye iletildi, aynı URL doğrudan API'ye sorulduğunda `200` döndü ve run terminal durumda kaldı. Ekran bu durumda son terminal durumu koruyup "Reload snapshot" aksiyonunu gösteriyor; doğrudan API çağrısında yeniden üretilmediği için ürün API'sinde doğrulanmış bir hata olarak kaydedilmedi. Gerçek 401 oturum sona erme (T16) ve erişilebilirlik turları hâlâ P7 kapsamındadır.

## Kalan riskler ve ertelenen işler

1. **Gerçek SSE smoke sınırlı kapsamdadır.** İki sekme, SIGKILL edilen akış proxy'si ve yeniden başlatma doğrulandı; heartbeat'in 15 saniyelik comment davranışı, 204 terminal yanıtı ve oturum expiry/revocation (T16) bu koşuda ayrıca zorlanmadı. Heartbeat comment'ları EventSource API'sinde görünmediği için istemci yalnızca hata olayına veya uygulama olaylarına tepki verebilir.
2. **`/auth/me` yalnızca ölümcül kapanışta çağrılır.** `CONNECTING` durumundaki ağ hatalarında oturum probu yapılmaz; bu bilinçli bir ayrımdır. 403/404 gibi HTTP nedenleri EventSource tarafından görülemediği için geçici sayılıp en fazla dört kez denenir; sonra `disconnected` olur ve kullanıcı yeniden bağlanmayı seçebilir.
3. **Terminal sonrası final snapshot bir ek GET üretir.** Terminal olay sayaç/outcome taşır, fakat iptal/kesinti adım durumlarını taşımaz. Final snapshot gelmezse terminal durum korunur ve uyarı gösterilir; adım listesi son canlı halinde kalabilir. Gerçek koşuda final snapshot'ın test proxy'si üzerinden boş gövdeli 400 alması bu davranışı doğruladı; aynı istek doğrudan API'ye sorulduğunda 200 döndü. 400'ün nedeni bu görev kapsamında kesinleştirilmedi.
4. **Yalnızca son 20 örnek görsel tabloda gösterilir.** Tüm örnekler facade state'inde tutulur ve `/runs/:runId` kaydında mevcuttur; grafik/zoom P5 kapsamındadır.
5. **Farklı cursor isteyen tüketiciler aynı oturumu yeniden başlatır.** Uygulamada run başına tek facade tüketicisi vardır. İkinci bir tüketici farklı cursor isterse oturum istenen cursor'a sarılır; mevcut aboneler tekrar eden sequence'leri reducer sayesinde yok sayar, ancak ileri cursor isteyen bir tüketici diğerinin arada kalan olaylarını atlamasına yol açabilir. Bu, tek EventSource kuralının bilinçli sonucudur ve mevcut ekran akışında oluşmaz.
6. **Vite dev-server downstream soketini proxy ölümünden sonra açık tutabilir.** Gerçek kontrol betiği bu nedenle iki sekmeye de yapay `error` gönderir. Üretimde ters proxy'nin bağlantıyı kapatması beklenir; istemci, görünmeyen heartbeat comment'ları yüzünden yarı-açık bir soketi tek başına ayırt edemez.
7. **`routes.spec.ts` sahiplik listesi dışında değiştirildi.** Live Run placeholder "P4-04" beklentisi gerçek ekranla uyumsuz olduğu için kaldırıldı. Başka bir web worker'ı yoktu; lead bu değişikliği incelemelidir.
8. **Erişilebilirlik gerçek tarayıcıda denenmedi.** Tablo caption/scope, canlı bölge ve metin etiketleri eklendi; klavye/ekran okuyucu turu P7-04 kapsamındadır.
9. **Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı.** Dört kart `In Review`; hiçbiri `Accepted` değildir.
10. **`docs/tasks/README.md` ve `docs/roadmap.md` güncellenmedi.** Bu dosyalar worker sahiplik alanı dışında bırakıldı; durum değişiklikleri lead commit'inde işlenmelidir. Commit/push da bu worker tarafından yapılmadı.
