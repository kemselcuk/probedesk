# Phase 4 — Web inceleme bulgularının düzeltme kanıtı (H-01, M-01, M-02, M-03)

- Tarih: 2026-11-03
- Kapsam: [phase-4-review.md](phase-4-review.md) içindeki **H-01 (High)**, **M-01 (Medium)**, **M-02 (Medium)** ve **M-03 (Medium)** bulgularının `apps/web` ve `scripts/` tarafı.
- Ortam: macOS arm64, Node.js `22.23.2`, npm `11.6.2`, Angular 22.2.4, gerçek PostgreSQL 18 geliştirme veritabanı (`127.0.0.1:5434`), Google Chrome headless. API `127.0.0.1:3100`, akış proxy'si `127.0.0.1:3200`, statik uygulama sunucusu `127.0.0.1:4300`.
- Taban: bağımsız inceleme `b14209c` üzerinde yapıldı. Bu düzeltmeler ortak checkout'ta commit edilmedi; commit/push lead tarafından yapılacak. Bu worker hiçbir git komutu çalıştırmadı.
- Bu belge bir düzeltme kanıtıdır, ürün kabulü değildir. P4-02 … P4-07 kartları `In Review` durumunda bırakılmıştır; `Accepted` değildir. Düzeltmelerin bağımsız yeniden incelemesi gerekir.
- Kapsam dışı: `apps/api`, `packages/`, kök yapılandırma, P5 geçmiş/grafik çalışması ve P7 E2E/erişilebilirlik işleri. Ortak checkout'ta P5 dosyaları üzerinde eşzamanlı çalışma vardı; bu worker o dosyalara dokunmadı.

## Kapatılan bulgular

### H-01 — Açılıp olay üretmeden kapanan akış artık deneme bütçesini sıfırlamıyor

**Önce:** `RunEventSession.handleOpen` her `open` olayında `attempt = 0` yapıyordu. `200 text/event-stream` açıp tek bir domain olayı üretmeden kapanan bağlantı, her seferinde taze deneme bütçesi alıyordu; gerçek Chrome deneyinde 13 saniyede 31 EventSource açıldı ve ekran sürekli `Reconnecting` kaldı.

**Sonra:**

- `apps/web/src/app/core/runs/run-events.service.ts`:
  - `handleOpen` artık yalnız bağlantı durumunu `connected` yapar; deneme sayacını **sıfırlamaz**.
  - `handleMessage` yalnız doğrulanmış, bu run'a ait ve cursor'ı **ilerleten** bir domain olayından sonra `attempt = 0` yapar. Heartbeat comment'ları EventSource API'sinde görünmediği için tek sağlık sinyali ilerleyen domain olayıdır; aynı sequence'in tekrarı bütçe tazelemez.
  - `restartAt` de artık deneme bütçesini sıfırlamaz. Tüketici kaynaklı bir cursor yeniden başlatması taşımanın sağlıklı olduğunu kanıtlamaz; aç/kapa döngüsü yeni cursor isteyerek sonsuz deneme kazanamaz.
- Backoff korunmuştur: varsayılan `500 / 1000 / 2000 / 4000 ms`. Bütçe tükendiğinde `error(code: 'unavailable')` yayınlanır ve bağlantı `disconnected` olarak kapatılır. Kaynak, listener ve timer temizliği aynı kalır.
- UI: `live-run-page.html` mevcut `#live-stream-warning` panelini gösterir; panel “Live updates are not flowing”, son durumun korunduğu açıklaması ve “Reconnect live updates” aksiyonunu içerir.

**Regresyon testleri:**

- `run-events.service.spec.ts` — “gives up when every stream opens and closes without a domain event”: test yapılandırmasındaki iki gecikme sonunda toplam üç EventSource oluşur (varsayılan dört gecikmede beş kaynak), hepsi kapalı ve listener sayısı sıfırdır; `unavailable` hatası ve `disconnected` durumu üretilir.
- `run-events.service.spec.ts` — “resets the reconnect budget only after a delivered domain event”: olaysız iki hatadan sonra üçüncü kaynak ilerleyen bir domain olayı teslim eder; sonraki hata bütçeyi tüketmez ve dördüncü kaynak açılır.
- `run-events.service.spec.ts` — “does not reset the reconnect budget for a duplicate replay”: aynı sequence'in tekrarı cursor'ı ilerletmez; üçüncü hatada bütçe tükenir ve `unavailable` + `disconnected` üretilir.
- `live-run-page.spec.ts` — “shows the explicit stream warning after empty streams exhaust the retry budget”: test yapılandırmasındaki üç olaysız aç/kapa sonunda `#live-stream-warning`, “Live updates stopped after several reconnect attempts” metni, `disconnected` bağlantı etiketi ve `Running` run durumu birlikte doğrulanır.

**Sınır:** H-01'in gerçek tarayıcıdaki boş akış sunucusu senaryosu bu turda yeniden kurulmadı. Aynı yol servis ve bileşen testleriyle deterministik olarak kapsanmıştır; gerçek Chrome ile tekrar doğrulama bağımsız yeniden incelemeye bırakılmıştır.

### M-03 — Terminal sonrası final snapshot sınırlı deneniyor; kalan adım durumları “unavailable” işaretleniyor

**Önce:** Terminal olay uygulandıktan sonra yapılan tek final `GET /api/runs/:id` başarısız olursa yalnız `streamError` yazılıyordu. Run terminal görünürken adımlar `RUNNING`/`PENDING` kalabiliyor, “In progress” metni terminal ekranda gösterilebiliyordu.

**Sonra:**

- `apps/web/src/app/features/runs/live-run.facade.ts`:
  - Final snapshot en fazla **3** kez denenir (`FINAL_SNAPSHOT_ATTEMPTS`). Denemeler aynı request kimliğini kullanır; arada yeni bir yükleme başlarsa eski yanıt yok sayılır.
  - Tüm denemeler başarısız olursa run seviyesindeki terminal durum (COMPLETED/CANCELLED/INTERRUPTED/ERROR) korunur; `finalStepStateUnavailable = true` ve açıklayıcı `finalStepStateError` yayınlanır.
  - Başarılı bir deneme bayrağı ve hatayı temizler.
- `live-run-page.html` / `.ts`:
  - `#live-final-steps-warning` paneli “Final step detail could not be loaded” başlığıyla gösterilir; “Reload snapshot” aksiyonu sunulur.
  - Son snapshot yüklenemediğinde `RUNNING` veya `PENDING` kalan adımlar “Unavailable” olarak etiketlenir; “In progress”/“Pending” metni bu adımlar için gösterilmez. Satırın `data-status` değeri `UNAVAILABLE` olur. `CANCELLED`, `COMPLETED`, `ERROR` gibi terminal adım durumları olduğu gibi korunur.
- Final snapshot başarılıysa uyarı ve `UNAVAILABLE` işareti görünmez; mevcut “terminal geriye dönmez” davranışı değişmez.

**Regresyon testleri:**

- `live-run.facade.spec.ts` — üç başarısız denemeden sonra `finalStepStateUnavailable` doğru, `finalStepStateError` üç denemeyi ve “marked unavailable” açıklamasını içeriyor, run `CANCELLED` kalıyor.
- `live-run.facade.spec.ts` — ilk iki deneme başarısız, üçüncü başarılı olduğunda adım durumu `CANCELLED` olarak yükleniyor ve uyarı bayrağı temiz kalıyor.
- `live-run-page.spec.ts` — üç başarısız denemede `#live-final-steps-warning`, `Unavailable` rozeti ve `data-status="UNAVAILABLE"` görünür; “In progress”/“Pending” metni yoktur ve run durumu `Failed` kalır.
- `live-run-page.spec.ts` — ikinci denemede snapshot başarılı olduğunda uyarı görünmez, adım `Completed` olur.

**Gerçek koşu notu:** Bu turdaki canlı tarayıcı koşusunda ve SSE kontrolünde terminal sonrası final snapshot `200` döndü; incelemedeki tek seferlik boş gövdeli `400` yeniden üretilmedi. Kök nedeni hâlâ bilinmiyor; düzeltme bu tür bir hatada UI'ın stale `RUNNING`/`PENDING` göstermesini engeller.

### M-01 — İki sekme kesinti kanıtı artık gerçek upstream kapanışına dayanıyor

**Önce:** `scripts/phase-4-live-check.mjs`, Vite dev sunucusunun proxy `SIGKILL` sonrası downstream SSE soketini açık tutması nedeniyle her iki sekmeye `source.dispatchEvent(new Event('error'))` ile yapay hata gönderiyordu. Demo bunu gerçek kesinti gibi sunuyordu; ayrıca demo, commit'te olmayan bir `proxy-to-3200` yapılandırmasına dayanıyordu.

**Sonra:**

- Yeni `scripts/app-server.mjs`:
  - `apps/web/dist/web` çıktısını sunar; Angular'ın gerçek çıktısı olan `dist/web/browser/index.html` alt dizinini otomatik algılar. Bilinmeyen SPA yollarında `index.html` fallback'i vardır.
  - `/api` isteklerini `127.0.0.1:3200` akış proxy'sine `agent: false` ile aktarır.
  - Upstream hata verirse ve header'lar zaten gönderilmişse downstream SSE yanıtını `destroy()` eder; upstream kapanırsa yanıtı sonlandırır. Böylece Vite'ın yarı-açık soket davranışı devre dışı kalır ve tarayıcı gerçek `EventSource` hatasını görür.
  - `APP_PORT` (varsayılan 4300), `PROXY_URL` (varsayılan `http://127.0.0.1:3200`) ve `WEB_DIST` ile yapılandırılabilir.
- `scripts/phase-4-live-check.mjs`:
  - Varsayılan `APP_URL` artık `http://127.0.0.1:4300`; script `app-server` ve `sse-proxy` süreçlerini kendisi başlatır.
  - `new Event('error')` gönderimi tamamen kaldırıldı. Kesinti yalnız `sse-proxy` sürecinin `SIGKILL` edilmesiyle oluşur; iki sekme de `Reconnecting`/`Disconnected` durumuna kendi `onerror` yoluyla ulaşmalıdır. Ulaşamazsa kontrol başarısız olur.
  - Gerekli web derlemesi yoksa (veya `BUILD_WEB=1` ise) script `npm run build --workspace apps/web` çalıştırır. `WEB_DIST` verilmişse önceden derlenmiş çıktı da kullanılabilir.
  - Kesinti algılama süresi, kesinti anındaki EventSource `readyState`/URL listesi ve son 5 hata yanıtı çıktıya eklenir.
- `apps/web/proxy.conf.json` değiştirilmedi; hedefi `http://127.0.0.1:3000` olarak kalır. Phase 4 kontrolü Vite/proxy.conf kullanmaz.

**Gerçek sonuç (run `e50636ea-6f8f-487c-85a6-822801dd9855`):**

```text
APP_URL=http://127.0.0.1:4300 (served by scripts/app-server.mjs)
offlineLabel: Reconnecting
outageDetectedMs: 154
offlineSources: [ { url: .../events?after=13, readyState: 2 } ]
finalA: status Passed, connection Disconnected, recorded 90, terminal true
finalB: status Passed, recorded 90
exceptions: []
failedResponseCount: 7   # tamamı kesinti sırasında 502 UPSTREAM_UNAVAILABLE
```

`7` hatalı yanıtın tamamı kesinti penceresindeki `/api/.../events` ve `/api/auth/me` isteklerinin `502 UPSTREAM_UNAVAILABLE` yanıtlarıdır; kesinti dışında hata yoktur. `Runtime.exceptionThrown` kaydı yoktur. Her iki sekme de aynı run için `Passed` ve `90 of 90` sonucuna ulaşmıştır. Ekran görüntüsü: [phase-4-live.png](phase-4-live.png).

**Yeniden üretme:**

```bash
PORT=3100 node apps/api/dist/main.js
npm run build --workspace apps/web
RUN_VERSION_ID=<published-plan-version-uuid> node scripts/phase-4-live-check.mjs
```

Script `scripts/app-server.mjs` (4300) ve `scripts/sse-proxy.mjs` (3200) süreçlerini kendisi başlatır ve kapatır. Farklı bir API adresi için `PROBEDESK_API_URL`, farklı bir uygulama portu için `APP_PORT` kullanılabilir. Önceden derlenmiş bir çıktı verilecekse `WEB_DIST=/path/to/apps/web/dist/web` ayarlanır.

### M-02 — Görev kartları, yol haritası ve kanıt bağlantıları gerçek kayıtlarla güncellendi

- `docs/tasks/P4-02.md` … `P4-07.md`: uygulama commit'i alanı, gerçek komut/çıktılar, kanıt bağlantıları, inceleme bulguları ve düzeltmeler yazıldı. Yalnız gerçekten doğrulanan kabul ölçütleri işaretlendi; doğrulanmayanlar `[ ]` bırakıldı ve gerekçeleri karta yazıldı.
- `docs/roadmap.md`: “canlı SSE akışı … henüz yoktur” ifadesi düzeltildi; Phase 4 satırı `In Review` yapıldı ve Phase 5'in sürdüğü belirtildi. P5 grafik/geçmiş işi bu düzeltmenin kapsamı dışındadır.
- `docs/evidence/phase-4-live-ui.md` ve `phase-4-demo.md`: yapay `error` anlatımı kaldırıldı; app-server, gerçek upstream kapanışı, H-01 deneme bütçesi ve M-03 final snapshot davranışı işlendi.
- Bu dosya `docs/evidence/` dizinine eklendi.

## Değişen dosyalar

Ürün kodu ve scriptler:

- `apps/web/src/app/core/runs/run-events.service.ts`
- `apps/web/src/app/features/runs/live-run.facade.ts`
- `apps/web/src/app/features/runs/live-run-page.ts`
- `apps/web/src/app/features/runs/live-run-page.html`
- `scripts/app-server.mjs` (yeni)
- `scripts/phase-4-live-check.mjs`

Testler:

- `apps/web/src/app/core/runs/run-events.service.spec.ts`
- `apps/web/src/app/features/runs/live-run.facade.spec.ts`
- `apps/web/src/app/features/runs/live-run-page.spec.ts`

Dokümanlar:

- `docs/tasks/P4-02.md`, `P4-03.md`, `P4-04.md`, `P4-05.md`, `P4-06.md`, `P4-07.md`
- `docs/evidence/phase-4-live-ui.md`
- `docs/evidence/phase-4-demo.md`
- `docs/evidence/phase-4-review-fixes-web.md` (bu dosya)
- `docs/roadmap.md`
- `docs/evidence/README.md`

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: repo kökü, 2026-11-03 22:15 (CET). Komutlar paylaşılan checkout'ta çalıştırıldı.

```text
$ npm run lint --workspace apps/web
> oxlint src
Found 0 warnings and 0 errors.
Finished in 19ms on 94 files with 93 rules using 8 threads.
EXIT: 0
```

```text
$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
EXIT: 0
```

```text
$ npm run test --workspace apps/web
> ng test
Application bundle generation complete. [3.851 seconds]
Test Files  31 passed (31)
     Tests  314 passed (314)
  Duration  8.16s
EXIT: 0
```

Test sayısı önceki 253'ten 314'e çıktı. Artışın 8'i bu düzeltmedeki H-01/M-03 senaryolarıdır; kalan artış ortak checkout'taki P5 test dosyalarından gelir. P4 kapsamındaki beş test dosyası ayrıca `64/64` geçti.

```text
$ npm run build --workspace apps/web
Application bundle generation complete. [2.269 seconds]
WARNING: Module 'hammerjs' used by 'chartjs-plugin-zoom' is not ESM
Output location: apps/web/dist/web
EXIT: 0
```

Kalan tek uyarı P5 grafik eklentisinin CommonJS bağımlılığıdır; Phase 4 değişikliklerinden kaynaklanmaz ve P5 kapsamındadır.

```text
$ RUN_VERSION_ID=89064e8a-… node scripts/phase-4-sse-check.mjs
eventCount: 98
firstEvent: run.started
lastEvent: run.completed
lastSequence: 98
snapshotSequence: 98
recordedSampleCount: 90
replayFrom: 49
replayEventCount: 49
lastEventIdPrecedence: 6
terminalNoBacklogStatus: 204
invalidCursorStatus: 400
futureCursorStatus: 400
EXIT: 0
```

```text
$ RUN_VERSION_ID=89064e8a-… node scripts/phase-4-live-check.mjs
APP_URL=http://127.0.0.1:4300 (served by scripts/app-server.mjs)
offlineLabel: Reconnecting
outageDetectedMs: 154
finalA: Passed / Disconnected / 90
finalB: Passed / 90
exceptions: []
failedResponseCount: 7
EXIT: 0
```

## Temizlik ve sınırlar

- Bu turda oluşturulan 6 test run'ı ve bağlı satırlar geliştirme veritabanından silindi: 540 measurement, 588 run event, 18 run step, 6 test run.
- API `:3100`, `app-server` `:4300`, `sse-proxy` `:3200` ve Chrome oturumları kontrol sonunda kapatıldı; kalan süreç bırakılmadı.
- **Gerçek H-01 tarayıcı senaryosu** (boş `200 text/event-stream` sunucusu) bu turda tekrarlanmadı; servis/bileşen testleri aynı yolu kapsar.
- **Gerçek M-03 hata yolu** tarayıcıda zorlanmadı; final snapshot hataları facade/bileşen testleriyle doğrulandı. Gerçek koşularda final snapshot `200` döndü.
- **Gerçek 401/logout UI** ve gerçek SPA geri dönüş turu hâlâ P7/T16 kapsamındadır; bu turda yalnız mevcut `/auth/me` 401 ve route teardown testleri korunmuştur.
- **Gerçek snapshot/olay yarışı** (T14/T15) zorlanmadı; P4-06'nın birinci kabul ölçütü bu nedenle işaretsiz bırakıldı.
- **P5 geçmiş/grafik çalışması** ortak checkout'ta devam etmektedir ve bu düzeltmenin parçası değildir. İlk doğrulama denemesinde P5 dosyalarındaki geçici tip hataları nedeniyle `typecheck`/`test` başarısız oldu; P5 dosyaları bu worker tarafından değiştirilmedi. Son koşuda P5 dosyaları tip-temiz hale geldiğinde yukarıdaki repo sonuçları alındı.
- **Git komutu çalıştırılmadı.** Commit/push lead tarafından yapılacak.
