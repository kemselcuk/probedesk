# Phase 4 — Canlı çalışma UI kanıtı (P4-02, P4-03, P4-04, P4-05)

- Tarih: 2026-11-03
- Kapsam: Angular SSE taşıması, snapshot + canlı olay birleştirme, `/runs/:runId/live` ekranı, yeniden bağlanma ve oturum kaybı.
- Ortam: macOS (arm64), Node.js 22.23.2, npm 11.6.2 (`packageManager`), Angular 22.2.4, RxJS 7.8.2, Vitest 5.1.0 + TestBed + `HttpTestingController`.
- Uygulama commit'i: Henüz yok. Çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge bir commit hash'i iddia etmez.
- Kapsam dışı: P4-01 backend SSE endpoint'inin kendi testleri, gerçek tarayıcı E2E (P7-01), grafik/zoom (P5), bağımsız teknik inceleme ve kullanıcı kabulü.

## Sonuç

Angular istemcisi artık `GET /api/runs/:id/events?after=<sequence>` akışını tipli bir RxJS servisiyle tüketiyor. Ekran önce `GET /api/runs/:id` snapshot'ını ve `lastEventSequence` cursor'ını yükler; run terminal değilse akış bu cursor'dan açılır. Olaylar yalnızca kesin sıradaki `sequence` değeriyle uygulanır; duplicate ve başka run'a ait olaylar yok sayılır, ileri boşlukta tahmin yapılmaz, yeni snapshot ile uzlaştırılır.

Canlı ekran çalışma durumu ile bağlantı durumunu ayrı etiketler. İlerleme backend'in `recordedSampleCount` / `expectedSampleCount` sayaçlarından gelir. İlk tolerans dışı örnek geldiği anda adım işaretlenir ve sonraki normal örnekler bu bilgiyi temizlemez. İptal yalnızca Operator'a ve yalnızca `RUNNING` durumda gösterilir; sunucu yanıtı gelene kadar terminal durum yazılmaz.

## Tasarım

### SSE sözleşmesi ve taşıma

- `apps/web/src/app/core/runs/run-event.types.ts` tek SSE sözleşme kaynağıdır. Sekiz olay adı, zarf alanları (`schemaVersion: 1`, `runId`, `sequence`, `occurredAt`, `payload`) ve payload tipleri burada tanımlıdır. REST DTO'ları yine generated `@probedesk/api-client` şemalarından gelir; ikinci bir REST modeli yoktur.
- `parseRunEventEnvelope` JSON, `schemaVersion`, UUID `runId`, güvenli tamsayı `sequence`, ISO tarih, SSE `id` ile sequence eşitliği ve olay tipine özel payload alanlarını doğrular. Hata `MalformedRunEventError` olarak fırlar; servis bunu kontrollü stream hatasına dönüştürür, DOM callback'inden kaçan istisna oluşmaz.
- `RunEventsService` aynı run için tek `EventSource` açar. Abonelik sayısı `refCount` gibi yönetilir: ilk abone kaynağı açar, son abone kapanınca `close()` çağrılır, tüm listener'lar `removeEventListener` ile sökülür. Farklı cursor isteyen ikinci çağrı mevcut oturumun cursor'ını kullanır; aynı run için ikinci bağlantı açılmaz.
- Bağlantı durumları `connecting`, `connected`, `reconnecting`, `disconnected`, `unauthenticated` olarak ayrı akıtılır.
- Ağ hatasında native EventSource'un kendi reconnect'i kapatılır; son uygulanan sequence ile `after=<cursor>` kullanılarak sınırlı backoff (varsayılan 500/1000/2000/4000 ms) uygulanır. Denemeler tükenirse `disconnected` + görünür hata üretilir; sonsuz döngü yoktur.
- `readyState === CLOSED` olan ölümcül kapanışta `/auth/me` çağrılır. 401 ise oturum `anonymous` işaretlenir, akış kapatılır, yeniden denenmez ve `/login?returnUrl=<mevcut URL>` adresine gidilir. 200 ise hata geçici kabul edilip sınırlı reconnect yapılır; diğer ağ hatalarında oturum kaybı uydurulmaz.
- Terminal olay (`run.completed`, `run.cancelled`, `run.interrupted`, `run.errored`) alındığında taşıma akışı kapatır ve tamamlar. Terminal run için ekran hiç akış açmaz.

### Snapshot + canlı birleştirme

- `applyRunEvent` her olayı `cursor + 1` kuralıyla uygular. `sequence <= cursor` duplicate, `sequence > cursor + 1` gap, başka `runId` foreign, terminal sonrası domain olayı `after-terminal` olarak sınıflandırılır.
- `measurement.recorded`: örnek `sampleIndex` ile bir kez eklenir; `recordedCount`, `outOfToleranceCount` ve run sayaçları monoton artar; `firstFailureSampleIndex` yalnızca daha küçük değerle değişebilir; `hasOutOfTolerance` OR'lanır. Tolerans kararı yeniden hesaplanmaz, payload'daki backend bayrağı kullanılır.
- `step.completed`: backend outcome'u, istatistikleri ve sayaçları uygular. Snapshot merge sırasında dolu outcome/istatistik null ile ezilmez.
- `mergeRunSnapshot`: terminal run'ı RUNNING snapshot ile değiştirmez; adım durumu PENDING → RUNNING → terminal yönünde ilerler; ölçümler `sampleIndex` birleşimiyle korunur; ilk ihlal ve tolerans bayrakları geri alınmaz.
- Gap geldiğinde akış kapatılır, yeni snapshot okunur, cursor snapshot'ın `lastEventSequence` değerine çekilir ve akış yeniden açılır. Eksik olay tahmin edilmez, çift uygulanmaz.
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
- `apps/web/src/app/core/runs/run-events.service.spec.ts` (9 senaryo): açma/olay/kapatma, yabancı run, bozuk payload, reconnect cursor'ı, `/auth/me` 200/401, paylaşımlı abonelik, terminal kapanışı, sınırlı deneme tükenmesi.
- `apps/web/src/app/features/runs/live-run.reducer.spec.ts` (10 senaryo): sıralı uygulama, step PENDING→RUNNING→COMPLETED geçişi, duplicate, gap, ilk ihlal kalıcılığı, yabancı run, terminal sonrası domain olayı, terminal geri dönmezliği, ihlal/ölçüm birleşimi, outcome korunması.
- `apps/web/src/app/features/runs/live-run.facade.spec.ts` (12 senaryo): snapshot sonrası stream cursor'ı, canlı örnek/ihlal, duplicate, gap uzlaştırma, terminal + final snapshot, terminal geri dönmezliği, iptal onayı, iptal hatası, ağ kesintisi, terminal snapshot'ta akış yokluğu, stale snapshot reddi.
- `docs/evidence/phase-4-live-ui.md`: bu dosya.

### Değişen

- `apps/web/src/app/features/runs/live-run-page.ts`: placeholder yerine `LiveRunFacade` kullanan gerçek bileşen.
- `apps/web/src/app/features/runs/live-run-page.spec.ts`: placeholder testleri gerçek ekran senaryolarıyla değiştirildi (11 test).
- `apps/web/src/app/features/routes.spec.ts`: Live Run route smoke testindeki `P4-04` placeholder metin beklentisi kaldırıldı. P3-09 kanıtında da aynı gerekçeyle dokunulan ortak route testidir; başka bir worker'ın dosyası değildir.
- `docs/tasks/P4-02.md`, `P4-03.md`, `P4-04.md`, `P4-05.md`: durum `In Review`, kabul kutuları ve gerçek komut sonuçları.

## Test eşlemesi

| Gereksinim | Test kanıtı |
|---|---|
| Named event/payload doğrulama, bozuk olay | `run-event.types.spec.ts`; `run-events.service.spec.ts` malformed senaryosu |
| Unsubscribe'da kaynak/listener kapanışı | `run-events.service.spec.ts` open/close ve paylaşımlı abonelik testleri |
| Sıra, duplicate, yabancı run | `live-run.reducer.spec.ts`; `live-run.facade.spec.ts` |
| Gap → snapshot uzlaştırma | `live-run.facade.spec.ts` gap testi |
| Terminal geri dönmezliği | `live-run.reducer.spec.ts`; `live-run.facade.spec.ts` terminal testleri |
| İlk ihlalin kalıcılığı | `live-run.reducer.spec.ts`; `live-run.facade.spec.ts`; `live-run-page.spec.ts` |
| Backend sayaçlarından ilerleme | `live-run-page.spec.ts` "1 of 4 samples recorded (25%)" |
| Ayrı run/bağlantı etiketleri | `live-run-page.spec.ts` connected/reconnecting testleri |
| Operator-only iptal ve sunucu onayı | `live-run-page.spec.ts` iptal testleri; `live-run.facade.spec.ts` iptal testleri |
| Reconnect cursor/replay | `run-events.service.spec.ts` after=4 reconnect; `live-run.facade.spec.ts` after=4 |
| 401 oturum kaybı | `run-events.service.spec.ts` `/auth/me` 401 + login redirect |
| Route teardown ve geri dönüş | `live-run-page.spec.ts` View run details + geri dönüş testi |
| Aynı run için tek EventSource | `run-events.service.spec.ts` paylaşımlı abonelik testi |

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: repo kökü, 2026-11-03.

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 28ms on 81 files with 93 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
(çıkış kodu 0; hata yok)
```

```text
$ npm run test --workspace apps/web
Test Files  27 passed (27)
Tests       250 passed (250)
Duration    4.59s
```

Önceki taban 199 test (23 dosya) korunmuştur. Dört yeni test dosyası ve 51 yeni test eklendi; placeholder testleri değiştirildi.

```text
$ npm run build --workspace apps/web
Application bundle generation complete. [2.389 seconds]
Output location: apps/web/dist/web
(warning/error yok)
```

## Gerçek API / tarayıcı smoke

Bu oturumda gerçek SSE endpoint'i kullanılamadı: P4-01 backend çalışması aynı checkout'ta başka bir agent tarafından eşzamanlı yürütülüyordu. Çakışmayı önlemek için API/DB/dev-server başlatılmadı ve gerçek ağ akışı, gerçek PostgreSQL kaydı veya Chromium görsel kontrolü yapılmadı.

Sonuç: P4-02–P4-05 UI davranışı **fake EventSource + HttpTestingController ile mock-tested** durumundadır. Envelope payload alanları mevcut backend writer kodundaki `run.started`, `step.started`, `measurement.recorded`, `step.completed`, terminal olay payload'larıyla eşleşecek şekilde tanımlandı; gerçek endpoint smoke'u ve T13/T14/T15/T16 gerçek ağ koşuları P4-06/P7 kapsamında yapılmalıdır.

## Kalan riskler ve ertelenen işler

1. **Gerçek SSE smoke yapılmadı.** P4-01 eşzamanlı geliştirildiği için canlı endpoint, heartbeat, 204 terminal ve gerçek reconnect davranışı bu oturumda çalıştırılmadı. Frontend sözleşmesi mevcut backend event writer'ındaki payload alanlarına dayanır; backend alan adlarını değiştirirse parser kontrollü hata verir ve ekran snapshot'a düşer.
2. **`/auth/me` yalnızca ölümcül kapanışta çağrılır.** `CONNECTING` durumundaki ağ hatalarında oturum probu yapılmaz; bu bilinçli bir ayrımdır. 403/404 gibi HTTP nedenleri EventSource tarafından görülemediği için geçici sayılıp en fazla dört kez denenir; sonra `disconnected` olur ve kullanıcı yeniden bağlanmayı seçebilir.
3. **Terminal sonrası final snapshot bir ek GET üretir.** Terminal olay sayaç/outcome taşır, fakat iptal/kesinti adım durumlarını taşımaz. Final snapshot gelmezse terminal durum korunur ve uyarı gösterilir; adım listesi son canlı halinde kalabilir.
4. **Yalnızca son 20 örnek görsel tabloda gösterilir.** Tüm örnekler facade state'inde tutulur ve `/runs/:runId` kaydında mevcuttur; grafik/zoom P5 kapsamındadır.
5. **Aynı run için farklı cursor isteyen ikinci tüketici mevcut oturumu paylaşır.** Uygulamada tek facade tüketicisi vardır; farklı cursor'lar desteklenmez. Bu, tek EventSource kuralının bilinçli sonucudur.
6. **`routes.spec.ts` sahiplik listesi dışında değiştirildi.** Live Run placeholder "P4-04" beklentisi gerçek ekranla uyumsuz olduğu için kaldırıldı. Başka bir web worker'ı yoktu; lead bu değişikliği incelemelidir.
7. **Erişilebilirlik gerçek tarayıcıda denenmedi.** Tablo caption/scope, canlı bölge ve metin etiketleri eklendi; klavye/ekran okuyucu turu P7-04 kapsamındadır.
8. **Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı.** Dört kart `In Review`; hiçbiri `Accepted` değildir.
9. **`docs/tasks/README.md` ve `docs/roadmap.md` güncellenmedi.** Bu dosyalar worker sahiplik alanı dışında bırakıldı; durum değişiklikleri lead commit'inde işlenmelidir. Commit/push da bu worker tarafından yapılmadı.
