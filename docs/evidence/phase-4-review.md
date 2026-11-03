# Phase 4 — Bağımsız Teknik İnceleme

- İnceleme hedefi: ürün kodu `b14209c` (`test: record phase 4 SSE and multi-tab reconnect evidence`).
- Tarih: 2026-11-03.
- Ortam: macOS arm64, Node.js `22.23.2`, npm `11.6.2`, Angular 22.2.4, PostgreSQL 18; geliştirme DB `127.0.0.1:5434`, test DB `127.0.0.1:5433`.
- Kapsam: P4-01 … P4-07; SSE protokolü, Angular taşıması, snapshot/olay birleştirme, Live Run ekranı, çok sekme, yeniden bağlanma, oturum kaybı ve kanıtların doğruluğu.
- Yöntem: sözleşme ve kod okuması; `b14209c`'nin temiz `git archive` kopyasında toplu doğrulama; ayrı API süreci ve gerçek PostgreSQL üzerinden adversarial HTTP/SSE; gerçek headless Chrome ile iki sekme, route teardown ve hatalı akış deneyleri.
- **Bu bir bağımsız teknik incelemedir; ürün kabulü değildir.** Hiçbir görev bu inceleme nedeniyle `Accepted` yapılmadı. Ürün kodu değiştirilmedi; bu inceleme için yalnızca bu dosya yazıldı.

> Not: İnceleme sırasında paylaşılan checkout'ta Phase 5'e ait commit edilmemiş değişiklikler vardı. Karışıklığı önlemek için aşağıdaki toplu doğrulamalar `b14209c`'nin `git archive` ile alınmış temiz kopyasında, mevcut `node_modules` bağlanarak ve `.env` kopyalanarak çalıştırıldı. Paylaşılan checkout'taki geçici test kırılmaları ve OpenAPI drift'i bu commit'e atfedilmedi. İki sekmeli Vite koşusu sırasında da paylaşılan checkout'ta Phase 5 değişiklikleri vardı; aynı senaryo `b14209c`'nin 21:41'de derlenmiş bundle'ı statik sunucudan verilerek ayrıca çalıştırıldı ve aynı terminal sonucu verdi. Phase 5, P4 canlı akış servis/facade dosyalarını değiştirmiyordu.

## Kısa sonuç

SSE sunucusu, cursor/replay/terminal davranışı ve snapshot + olay birleştirme büyük ölçüde sözleşmeye uyuyor. Kritik seviyede veri kaybı, sıra bozulması veya yetkisiz erişim bulunmadı. Ancak Phase 4 teknik kabul için hazır değil:

- **Yüksek (H-01):** Taşıma katmanı, açılıp olay üretmeden kapanan bir SSE bağlantısında yeniden bağlanma denemelerini sıfırlıyor ve **sonsuz reconnect** döngüsüne giriyor. Gerçek Chrome deneyinde 13 saniyede 31 EventSource açıldı; ekran sürekli `Reconnecting` kaldı ve hata/uyarı paneli hiç görünmedi. P4-05'in açık kabul ölçütü ihlal ediliyor.
- **Orta (M-01):** İki sekme “ağ kesintisi” kanıtı tamamen gerçek değil: script, Vite soketi açık tuttuğu için her iki sekmeye **yapay `error` olayı** gönderiyor. Kanıt metni bunu “SIGKILL kesintisi” olarak sunuyor. Ayrıca demo, commit'te olmayan bir proxy yapılandırmasına dayanıyor.
- **Orta (M-02):** P4-06 ve P4-07 kartlarında uygulama commit'i, çalıştırılan kontroller ve kanıt bağlantıları hâlâ “Henüz yok”; kabul kutuları işaretsiz. Bu haliyle kartlar kabul edilemez.
- **Orta (M-03):** Terminal olaydan sonra yapılan final snapshot GET'i başarısız olursa çalıştırma terminal görünürken adımlar `RUNNING`/`PENDING` kalabiliyor. Kanıt dosyası gerçek bir 400 örneği kaydediyor; neden çözülmemiş.
- **Düşük (L-01):** Terminal “backlog yok” 204 yanıtı istemcide temiz terminal kapanışı olarak değil, yeniden denenebilir hata olarak işleniyor.
- **Düşük (L-02):** SSE bağlantı sayısı ve yavaş istemci backpressure'ı için üst sınır yok; her bağlantı 200 ms'de bir sorgu açıyor.

**Aşama sonucu:** H-01 kapatılmadan Phase 4 teknik kabulü yapılmamalıdır. P4-01 teknik olarak geçti; P4-02/03/04/06/07 bulgularla geçti; **P4-05 kabul edilmemelidir**. P4-06/P4-07 ayrıca kanıt kayıtları tamamlanmadan `Accepted` yapılamaz.

## Çalıştırılan kontroller ve gerçek sonuçlar

### Toplu doğrulama (`b14209c` temiz kopya)

```text
$ npm run verify
EXIT: 0
Found 0 warnings and 0 errors.        # apps/api lint
Found 0 warnings and 0 errors.        # apps/web lint
Found 0 warnings and 0 errors.        # diğer workspace
Test Files  16 passed (16)            # apps/api birim
Tests       118 passed (118)
Test Files  27 passed (27)            # apps/web
Tests       253 passed (253)
Application bundle generation complete.   # API ve web build
OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  17 passed (17)
Tests       163 passed (163)
Duration    26.07s
EXIT: 0
```

```text
$ npm run openapi:check
OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
EXIT: 0
```

Paylaşılan checkout'ta ilk `npm run verify` de 21:41'de aynı sonuçlarla geçti; sonraki Phase 5 düzenlemeleri sırasında görülen geçici web testi/OpenAPI hataları bu commit'in ürün koduna ait değildir.

### Gerçek SSE — protokol

`PORT=3110 node apps/api/dist/main.js` (geliştirme DB) üzerinde `scripts/phase-4-sse-check.mjs`:

```text
runId 9d76b5af-...
eventCount 98
firstEvent run.started
lastEvent run.completed
lastSequence 98
snapshotSequence 98
recordedSampleCount 90
replayFrom 49
replayEventCount 49
lastEventIdPrecedence 6
terminalNoBacklogStatus 204
invalidCursorStatus 400
futureCursorStatus 400
```

Ek adversarial kontrol betiğiyle **73/73** kontrol geçti. Doğrulananlar:

- `after=-1`, `abc`, `1.5`, boş, tekrarlı/array biçimi, bilinmeyen parametre, `after=2147483648`, çok büyük sayı ve gelecek sequence → SSE header'ı yazılmadan `400`.
- `Last-Event-ID` query'den öncelikli; `after=0` + header `5` → ilk olay `6`; header `0` + `after=97` → tüm 98 olay; boş/bozuk/negatif/float/gelecek header → `400`.
- Terminal run `after=98` ve `Last-Event-ID: 98` → `204`; `after=97` → yalnız 98 ve bağlantı kapanışı.
- Yetkisiz istek `401`; bilinmeyen UUID `404`; UUID olmayan yol `400`; hata gövdeleri JSON, `text/event-stream` değil.
- `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`; `Content-Length` yok; 98 olay `1..98` boşluksuz; son olay `run.completed`.
- Canlı akışta `: heartbeat` comment'i gözlendi; comment'in `id`/`event`/`data` alanı yok ve sequence tüketmiyor.
- İstemci abort'undan sonra yürütücü durmadı: snapshot `78 → 90` ilerledi ve run terminal oldu.
- İki ayrı oturumla: A oturumu logout edildi; A akışı sonraki heartbeat'te (~13.6 s) kapandı, B akışı terminal `run.completed` dahil 98 olayla kapandı. A terminal olay almadı; yürütücü etkilenmedi.

### Gerçek tarayıcı — iki sekme, route ve kesinti

`APP_URL=http://localhost:4200` ile gerçek Vite dev sunucusu, `scripts/sse-proxy.mjs` ve `RUN_VERSION_ID` kullanılarak `scripts/phase-4-live-check.mjs` çalıştırıldı:

- İki sekme de `Passed`, `90 of 90`, `Connection: Disconnected`, `Run finished`.
- Kesinti sırasında `Reconnecting` etiketi; proxy yeniden açıldıktan sonra iki sekme de terminale ulaştı.
- `Runtime.exceptionThrown`: yok (`exceptions: []`).
- “View run details” bağlantısı doğru `/runs/:id` adresine gitti.
- Kanıttaki terminal sonrası final snapshot `400` anomalisi bu koşuda **yeniden üretilmedi**; doğrudan API ve proxy üzerinden final snapshot `200` döndü.

Gerçek Chrome route teardown deneyi: canlı ekranda 1 açık EventSource varken `#live-run-details-link` tıklandı; detay rotasına geçişte açık kaynak sayısı `1 → 0` oldu ve sunucudaki run ilerlemeye devam etti (`17/19`). Bu, ekrandan ayrılmanın yürütmeyi durdurmadığını ve stream'in kapandığını gösterir. SPA geri dönüşü ayrıca bileşen testinde doğrulanmıştır; gerçek tarayıcıda tam sayfa navigasyonla dönüş denenmiştir.

### Açılıp kapanan SSE akışı — H-01'in gerçek kanıtı

Gerçek Chrome'da, `/api/runs/:id/events` isteğine `200 text/event-stream` dönüp 20 ms sonra bağlantıyı kapatan bir test sunucusu kullanıldı (domain olayı yok). Sonuç:

```text
2. saniye:  10 EventSource, 0 açık, Connection: Reconnecting, warning: yok
5. saniye:  16 EventSource, 0 açık, Connection: Reconnecting, warning: yok
9. saniye:  24 EventSource, 0 açık, Connection: Reconnecting, warning: yok
13. saniye: 31 EventSource, 0 açık, Connection: Reconnecting, warning: yok
final:      31 EventSource, 31 close, exceptions: yok
```

Bu, “denemeler tükenince `disconnected` + görünür hata” sözleşmesinin ihlalidir.

## Verdict tablosu

| Görev | Verdict | Gerekçe |
|---|---|---|
| P4-01 | **PASS** | Cursor önceliği/validasyonu, 400/401/404, replay/live sırası, heartbeat, terminal kapanış, 204, abort cleanup ve oturum iptali gerçek HTTP/SSE ile doğrulandı. DB kesintisi ayrıca zorlanmadı. |
| P4-02 | **PASS with findings** | Envelope doğrulama, tek kaynak/paylaşım, listener temizliği ve terminal kapanışı doğru. H-01 taşımanın sınırlı reconnect iddiasını geçersiz kılıyor. |
| P4-03 | **PASS with findings** | Reducer sıra/duplicate/foreign/gap/terminal davranışı testlerle ve kodla doğru; gerçek T14/T15 yarışı yalnız birim testlerde. M-03 terminal adım durumu kenarı. |
| P4-04 | **PASS with findings** | Backend sayaçları, ilk ihlal, ayrı run/connection etiketi, sunucu onaylı iptal ve detay bağlantısı doğru. Gerçek FORCED_FAILURE canlı UI, gerçek 401/expiry UI ve final snapshot hata yolu bağımsız doğrulanmadı; M-03. |
| P4-05 | **FAIL** | Açık kabul ölçütü “sonsuz reconnect yoktur” H-01 ile ihlal ediliyor; hata/uyarı paneli bu senaryoda hiç görünmüyor. |
| P4-06 | **PASS with findings** | Gerçek SSE replay/cursor/terminal sonuçları ve e2e 163/163 geçti. Ancak kartın dört kabul kutusu işaretsiz, kanıt alanları “Henüz yok”; snapshot sırasında olay ve gerçek duplicate T14/T15 yarışı gerçek akışta gösterilmedi. Bu haliyle kart kabul edilemez. |
| P4-07 | **PASS with findings** | İki sekme aynı 90/90 terminale ulaştı; route leave stream'i kapattı, run devam etti; ayrı oturum logout'u diğer geçerli akışı bozmadı. Ancak M-01 kanıt aşırı iddialı; gerçek tarayıcıda logout/expiry ve SPA geri dönüş turu yapılmadı. |

## Bulgular

### H-01 — High — Açılıp olay üretmeden kapanan akışta sonsuz reconnect

**Gözlenen:**

- `apps/web/src/app/core/runs/run-events.service.ts:277-284`: her `onopen` olayında `this.attempt = 0` yapılıyor.
- `apps/web/src/app/core/runs/run-events.service.ts:368-388`: yeniden bağlanma yalnız `reconnectDelays[attempt]` tanımsız olduğunda bitiyor. Her başarılı açılış sayacı sıfırladığı için “aç → olay gelmeden kapan → yeniden aç” döngüsü hiç tükenmiyor.
- `apps/web/src/app/core/runs/run-events.service.ts:326-342`: hata sonrası `scheduleReconnect()` çağrılıyor; açılış başarılı olduğu için tekrar deneme bütçesi yeniden başlıyor.
- Gerçek Chrome deneyi: 200 SSE açıp 20 ms sonra kapatan sunucuda 13 saniyede 31 EventSource, sürekli `Connection: Reconnecting`, `#live-stream-warning` yok, `unavailable` hatası yok.
- Bu senaryo yalnız yapay değildir: ters proxy'nin header sonrası bağlantıyı kesmesi, kısa idle timeout, veya P4-01'de belgelenen “DB akış ortasında erişilemezse sessizce kapanma” davranışının tekrarlanması aynı yolu tetikler.

**Beklenen:**

- `docs/tasks/P4-05.md:22`: “Oturum kaybı /auth/me kontrolüyle açıklığa kavuşur; **sonsuz reconnect yoktur**.”
- `docs/evidence/phase-4-live-ui.md:23`: “Denemeler tükenirse `disconnected` + görünür hata üretilir; sonsuz döngü yoktur.”
- `docs/frontend.md:62`: bağlantı durumları ayrı; hata durumunda kullanıcı son durumu ve uyarıyı görebilmeli.
- P4-02 kabul ölçütü 2/3 ile birlikte değerlendirilmelidir.

**Etki:** Kullanıcı sürekli “Reconnecting” görür, hata paneli ve “Reconnect live updates” aksiyonu hiç açılmaz; istemci 500 ms'de bir yeni HTTP/SSE isteği üretir. Sunucu ve ağ tarafında gereksiz yük oluşur; kullanıcı çalışmanın durumunu yanlış yorumlayabilir.

**Öneri:** Deneme sayacını yalnız bir domain olayı teslim edildikten veya bağlantı belirli bir süre sağlıklı kaldıktan sonra sıfırla; “açıldı ama olay gelmedi” döngüsü için ayrı bir ardışık hata sayacı ve üst sınır uygula. Sınır aşılınca `unavailable` + `disconnected` üret ve kullanıcıya manuel yeniden bağlanma sun.

### M-01 — Medium — İki sekme kesinti kanıtı kısmen yapay; demo commit'ten yeniden üretilemiyor

**Gözlenen:**

- `scripts/phase-4-live-check.mjs:233-242`: proxy `SIGKILL` edildikten sonra, Vite downstream soketini açık tuttuğu için script her iki sekmede `source.dispatchEvent(new Event('error'))` ile **yapay hata** gönderiyor.
- `docs/evidence/phase-4-demo.md:24-32` ve `docs/tasks/P4-07.md:40` bunu “akış proxy'si SIGKILL edildi… kesinti” olarak sunuyor; `docs/evidence/phase-4-live-ui.md:132-138` yapay sinyali kabul ediyor ama demo tablosu bu ayrımı taşımıyor.
- Yapay hata, gerçek bir yarı-açık soketin istemci tarafından fark edilmesini kanıtlamaz. Heartbeat SSE comment olduğu için tarayıcı API'sinde görünmez; istemci sessiz yarı-açık bağlantıyı tek başına ayırt edemez (`docs/evidence/phase-4-live-ui.md:144`, risk 6).
- `apps/web/proxy.conf.json:3` `/api` hedefi `127.0.0.1:3000`; demo ise API `:3100` + proxy `:3200` kullanıyor. `docs/evidence/phase-4-demo.md:49-53` yeniden üretme komutunda `<proxy-to-3200>.json>` placeholder'ı var; bu yapılandırma commit'te yok. Script kendi proxy'sini 3200'de başlatıyor, ancak Vite'ın 3200'e yönlendirilmesi commit'teki dosyayla sağlanmıyor.

**Beklenen:**

- P4-07 kabul ölçütü 1/4 ve P4-05 ağ kesintisi davranışı gerçek bir kesintiyle veya en azından gerçek `EventSource` hata durumuyla gösterilmeli.
- `docs/evidence/README.md` doğruluk kuralları: çalıştırılmayan/yanıltıcı kontrol “Passed” olmaz; yeniden üretilebilir komut ve ortam verilir.
- Demo proxy hedefi repo içinde (ör. `apps/web/proxy.conf.sse.json`) bulunmalı veya script Vite proxy'sini kendisi yapılandırmalı.

**Etki:** İki sekme terminal sonucu ve reconnect sonrası toparlanma gerçek olarak gözlendi; ancak “ağ kesintisini istemci fark etti” iddiası bu kanıtla desteklenmiyor. Üretimde yarı-açık bağlantı süresiz “Connected” görünebilir.

### M-02 — Medium — P4-06/P4-07 kartları kanıtsız; roadmap hâlâ “canlı SSE yok” diyor

**Gözlenen:**

- `docs/tasks/P4-06.md:21-24`: dört kabul ölçütü de `[ ]`.
- `docs/tasks/P4-06.md:43-49`: “Uygulama commit'i: Henüz yok”, “Çalıştırılan kontroller…: Henüz yok”, “Kanıt bağlantıları: Henüz yok”, “Kritik/yüksek bulgular: Henüz değerlendirilmedi”.
- `docs/tasks/P4-07.md:21-24` ve `:43-49`: aynı durum.
- Oysa `docs/evidence/phase-4-demo.md` gerçek sonuçlar içeriyor; kartların kanıt alanları bu dosyaya bağlanmamış.
- `docs/roadmap.md:3` (`b42fa43` dahil) hâlâ “canlı SSE akışı, geçmiş/grafikler, karşılaştırma ve video henüz yoktur” diyor; Phase 4 SSE kodu ve kanıtı mevcut.
- `AGENTS.md`: görev kartı durumu, kanıt alanları, `docs/tasks/README.md` ve `docs/roadmap.md` aynı commit'te güncellenir; çalıştırılmayan kontrol “Passed” sayılmaz.

**Beklenen:** P4-06/P4-07 için gerçek komutlar, commit, kanıt bağlantıları ve bağımsız inceleme kaydı doldurulmalı; kabul kutuları ancak kanıtla işaretlenmeli; roadmap'teki “canlı SSE yok” ifadesi düzeltilmeli.

**Etki:** Teknik davranışın çoğu bağımsız doğrulandı, ancak görev kartları bu haliyle `Accepted` edilemez ve Phase 4 durumu belgelerle tutarsız.

### M-03 — Medium — Terminal sonrası final snapshot başarısız/stale ise adım durumları yanlış kalıyor

**Gözlenen:**

- Terminal olay payload'ları (`apps/web/src/app/core/runs/run-event.types.ts:124-162`) run durumu/outcome/sayaçları taşır; **adım bazlı** `CANCELLED`/`NOT_RUN`/`INTERRUPTED` durumlarını taşımaz.
- `apps/web/src/app/features/runs/live-run.facade.ts:396-428`: terminal sonrası tek final snapshot GET'i yapılır. GET hata verirse yalnız `streamError` yazılır (`:419-428`); adım listesi son canlı halinde kalır.
- `apps/web/src/app/features/runs/live-run-page.html:178-186` “Run finished” gösterirken, `:264-278` aynı ekranda bir adımı hâlâ “In progress: …” veya “Pending” gösterebilir.
- Kanıt bunu doğruluyor: `docs/evidence/phase-4-demo.md:140` ve `docs/evidence/phase-4-live-ui.md:146` gerçek koşuda final snapshot'ın proxy üzerinden boş gövdeli `400` aldığını, nedeninin çözülmediğini kaydediyor. Bu incelemede aynı `400` Vite/proxy koşusunda yeniden üretilmedi; tek seferlik/ortam bağımlı bir anomali olarak kaldı.
- Run seviyesindeki terminal durum geri alınmıyor; bu nedenle P4-03'ün “terminal geriye dönmez” ölçütü run için sağlanıyor. Sorun adım durumlarının terminal görünümle çelişmesi.

**Beklenen:** P4-04 kabul ölçütü 3 (“terminal durumlarda kontroller doğrudur”) ve P4-03 terminal tutarlılığı; kullanıcı terminal bir çalıştırmada “In progress” görmemeli.

**Öneri:** Final snapshot başarısızsa adımları “Final step state unavailable” olarak işaretle veya terminal payload'daki `cancelledStepCount`/`notRunStepCount` ile tutarlı bir toplu durum göster; en azından `RUNNING` etiketini koruma. Final snapshot için sınırlı retry ve daha açıklayıcı hata metni ekle.

### L-01 — Low — Terminal 204 yanıtı istemcide hata gibi yeniden deneniyor

**Gözlenen:**

- `apps/web/src/app/core/runs/run-events.service.ts:326-342`: `readyState === CLOSED` olan her kapanış `/auth/me` probuna gider; 200 dönerse `scheduleReconnect()` çağrılır.
- 204 terminal/no-backlog yanıtı EventSource'ta `CLOSED` üretir. `/auth/me` 200 ise istemci dört kez yeniden bağlanmayı dener, sonra `unavailable` + `disconnected` gösterir.
- `docs/api.md:125`: “Terminal run'da replay edilecek olay kalmadıysa 204 ile yeniden bağlantı durdurulabilir.”

**Etki:** Normal terminal akışında ekran zaten terminal snapshot'ı yüklediği için pratikte oluşmaz; ancak stale snapshot/read-replica veya beklenmeyen bir 204'te kullanıcıya “Live updates stopped after several reconnect attempts” denir. Düşük olasılıklı, düşük etkili.

**Öneri:** SSE durum kodunu EventSource API'si vermediği için bunu kesin ayırt etmek mümkün değil; en azından `/auth/me` 200 sonrası yeniden deneme yerine terminal snapshot'ı bir kez okuyup run terminal ise sessizce kapat.

### L-02 — Low — SSE bağlantı sayısı ve yavaş istemci backpressure'ı sınırsız

**Gözlenen:**

- `apps/api/src/events/run-events.service.ts:122`: bağlantılar sınırsız bir `Set`'e ekleniyor; kullanıcı/run başına üst sınır yok.
- `apps/api/src/events/run-event-connection.ts:287-303`: `response.write` dönüş değeri (backpressure) yok sayılıyor; yavaş istemcide Node buffer'ı büyüyebilir.
- `apps/api/src/events/run-events.options.ts`: bağlantı başına 200 ms poll; çok sayıda bağlantıda DB yükü doğrusal artar.

**Etki:** Kimliği doğrulanmış bir kullanıcı çok sayıda SSE bağlantısı açarak DB/bağlantı kaynaklarını tüketebilir; yavaş istemci bellek baskısı oluşturabilir. P4-01 kanıtı backpressure riskini kabul ediyor (`docs/evidence/phase-4-sse-api.md:161`), ancak bağlantı üst sınırı ayrıca yok.

**Öneri:** Kullanıcı/run başına eşzamanlı stream sınırı, `write()` false döndüğünde bekleme veya bağlantıyı kapatma, ve poll sıklığı için üst sınır.

## Doğrulanmayan sınırlar

- **Gerçek DB kesintisi:** Akış ortasında PostgreSQL durdurma/pg_terminate deneyi güvenli biçimde yapılmadı. Kod yolu (`run-event-connection.ts:173-181`) bağlantıyı sessizce kapatıyor; istemci snapshot ile uzlaşmalı. Bu davranış gerçek kesintiyle doğrulanmadı.
- **Gerçek süreç kapanışı:** Açık SSE bağlantıları varken SIGTERM/`onModuleDestroy` ile tüm stream'lerin kapandığı ayrıca denenmedi; kod yolu `run-events.service.ts:130-135`.
- **Gerçek 401/expiry UI:** Oturum expiry/revocation sunucu tarafında e2e ve ayrı oturum deneyiyle doğrulandı; tarayıcıda “Signed out” etiketi ve `/login?returnUrl=` yönlendirmesi gerçek oturum sonlandırmayla denenmedi (T16/P7).
- **Gerçek FORCED_FAILURE canlı UI:** Demo yalnız NORMAL run kullandı; ilk ihlal ve FAILED terminali gerçek tarayıcıda forced senaryoyla izlenmedi. Reducer/bileşen testleri var.
- **T14/T15 gerçek yarış:** Snapshot sırasında olay ve gerçek duplicate olay, gerçek backend + istemci akışında zorlanmadı; birim testleri ve `after=49` replay var. P4-06 kartındaki dört kutu bu nedenle işaretsiz.
- **Gerçek SPA geri dönüşü:** Route leave gerçek Chrome'da doğrulandı; aynı SPA oturumunda detaydan Live Run'a geri dönüş tam sayfa navigasyonla yapıldı, SPA geri dönüşü bileşen testinde kaldı.
- **Yük/çoklu istemci:** 100+ eşzamanlı SSE, yavaş istemci, çoklu run ve poll gecikmesi ölçülmedi.
- **Proxy anomalisi:** Kanıttaki terminal sonrası final snapshot `400` bu incelemede Vite/proxy ile yeniden üretilemedi; kök nedeni bilinmiyor.
- **Kurulum:** `npm ci` ve temiz Docker kurulumu çalıştırılmadı; mevcut `node_modules` ve yerel PostgreSQL kullanıldı. Bu inceleme bağımlılık/lockfile tazeliğini doğrulamaz.
- **Test betikleri hermetik değil:** `phase-4-sse-check.mjs` ve `phase-4-live-check.mjs` seed'li geliştirme DB'sine, sabit demo kullanıcısına ve `RUN_VERSION_ID` değişkenine bağımlı; run'ları temizlemiyor. Bu incelemede oluşturulan 7 run ve ilişkili 630 ölçüm/686 olay/21 adım geliştirme DB'sinden silindi; script'lerin kendisi temizlik yapmıyor.

## Temizlik ve kapsam

- Geçici API (`:3110`, `:3100`), Vite (`:4200`), statik test sunucuları (`:4210`), SSE proxy (`:3200`) ve Chrome oturumları kapatıldı.
- Bu incelemede geliştirme DB'sinde oluşturulan 7 test run'ı ve ilişkili satırları silindi; test DB'si e2e testleri tarafından kendi temizliğini yaptı. Geçici bir veritabanı oluşturulmadı.
- `scripts/phase-4-live-check.mjs` çalışırken `docs/evidence/phase-4-live.png` dosyasını yeniden yazdı; dosya `b14209c` sürümüne geri getirildi. Ürün kodu ve diğer kanıt dosyaları değiştirilmedi.
- Paylaşılan checkout'taki Phase 5 değişiklikleri bu incelemenin parçası değildir; commit/push yapılmadı.

## Sonuç

Phase 4'ün sunucu tarafı SSE protokolü ve temel istemci birleştirmesi sağlam; gerçek HTTP/SSE, PostgreSQL ve iki Chrome sekmesiyle önemli davranışlar doğrulandı. Ancak **H-01 (sonsuz reconnect)** P4-05'in açık kabul ölçütünü ihlal ettiği için Phase 4 teknik kabul edilmemelidir. M-01 kanıtın gerçekliğini, M-02 görev kartlarının kabul edilebilirliğini, M-03 terminal adım tutarlılığını etkiler. Bu dosya bir bağımsız teknik incelemedir; ürün kabulü ve görev durumu değişikliği değildir.
