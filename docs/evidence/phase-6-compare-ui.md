# Faz 6 — Karşılaştırma seçimi, farklar ve iki serili grafikler

- Tarih: 2026-11-03
- Görevler: P6-02 (seçim/route), P6-03 (sonuç ve kural farkları), P6-04 (iki serili grafikler)
- Durum: **In Review** — bağımsız teknik inceleme ve nihai kabul bekliyor.
- Kapsam: `apps/web` yalnızca. `apps/api`, `packages`, kök dosyalar, `docs/tasks/README.md` ve `docs/roadmap.md` bu worker tarafından değiştirilmedi.
- Kısıt: Bu worker git komutu çalıştırmadı ve paket kurmadı; commit/push lead tarafından yapılacak. `GET /api/comparisons` sözleşmesi paralel çalışan P6-01 kodu okunarak hizalandı; gerçek API/DB üzerinden uçtan uca istek bu worker'da çalıştırılmadı.

## Değişen dosyalar

### Karşılaştırma feature'ı

- `apps/web/src/app/features/comparisons/comparisons-api.types.ts` — **geçici** sözleşme dosyası. P6-01 DTO'ları (`RunComparisonDto`, `ComparisonMatchedStepDto`, `ComparisonRunSummaryDto`, `ComparisonNumericComparisonDto`) henüz `@probedesk/api-client` içine üretilmediği için aynı alan adlarıyla tek dosyada izole edildi. Üretilen şemalar geldiğinde bu aliaslar generated `components['schemas'][...]` tipleriyle değiştirilecek; ekranlarda ikinci bir API modeli yok.
- `apps/web/src/app/features/comparisons/comparisons-api.ts` — `GET /api/comparisons?leftRunId=&rightRunId=` istemcisi ve alan alan doğrulama. Eksik/bozuk step, ölçüm, istatistik veya sürüm farkı `MalformedApiResponseError` üretir; hiçbir alan sıfır/varsayılan ile doldurulmaz.
- `apps/web/src/app/features/comparisons/comparisons.facade.ts` — karşılaştırma ve son 100 run seçeneği için sıra korumalı RxJS facade; geç gelen eski yanıt yeni seçimi ezmez.
- `apps/web/src/app/features/comparisons/compare-selection.ts` — iki terminal/farklı/same-plan seçim doğrulaması, deep-link query doğrulaması, seçenek etiketleri.
- `apps/web/src/app/features/comparisons/comparison-view.ts` — sunucunun `logicalStepId` eşleşmelerini görünüm modeline çevirir; tek taraflı adımlar `null` taraf olarak kalır; kural/istatistik/değerlendirme satırları ve sürüm açıklaması.
- `apps/web/src/app/features/comparisons/comparison-step-card.ts|html|scss` — bir eşleşmiş/eklenmiş/kaldırılmış adım kartı: kural tablosu, değişen alan işaretleri, API delta kolonu, çift grafik veya birim değişiminde iki ayrı panel, iki erişilebilir ölçüm tablosu.
- `apps/web/src/app/features/comparisons/compare-runs-page.ts|html|scss` — URL sahipli sayfa, run seçimi, 404/409/422/400/401/403/500 durumları, özet kartları, sürüm/senaryo açıklamaları, swap/clear/reload.
- `apps/web/src/app/features/comparisons/testing/comparison-fixtures.ts` — P6-01 DTO şekline uygun test fixture'ları (farklı sürüm, yeniden adlandırma, sıra değişimi, birim değişimi, eklenen/kaldırılan adım, kısmi run).

### Ortak grafik katmanı

- `apps/web/src/app/shared/charts/comparison-chart.types.ts` — iki run serisi, run kimliği taşıyan nokta, görünürlük ve seçim tipleri.
- `apps/web/src/app/shared/charts/comparison-chart.config.ts` — iki dataset, her serinin kendi `elapsedMs` X değerleri, iki ayrı tolerans bandı/çizgisi, tooltip run/sürüm bilgisi, erişilebilir özet, zoom ayarları.
- `apps/web/src/app/shared/charts/comparison-chart.ts|html|scss` — tek Chart.js instance'ı, seri başına `aria-pressed` aç/kapat, yalnızca görünürlük değiştiren güncelleme, reset, boş/tek taraflı seri açıklaması.
- Mevcut `MeasurementChart`, aynı `MEASUREMENT_CHART_FACTORY` sınırı ve saf yardımcıları (`buildMeasurementChartPoints`, `toPlotNumber`, `formatUtcTimestamp`) yeniden kullanıldı. Birim değişen eşleşmeler iki ayrı `MeasurementChart` paneli olarak çizilir.

### Run History seçim kancaları

- `apps/web/src/app/features/runs/run-history-page.ts|html|scss` — en fazla iki seçim, RUNNING satırlarının devre dışı bırakılması, aynı plan/farklı plan açıklaması, `Compare` eylemi ve `/compare?leftRunId=&rightRunId=` navigasyonu.
- `apps/web/src/app/features/runs/run-history-page.spec.ts` — seçim, farklı plan engeli ve compare route testleri güncellendi/eklendi.
- `apps/web/src/app/features/routes.spec.ts` — `/compare` placeholder görev etiketi beklentisi kaldırıldı; gerçek ekran h1/title smoke testi korunur.

### Testler

- `apps/web/src/app/features/comparisons/comparisons-api.spec.ts`
- `apps/web/src/app/features/comparisons/compare-selection.spec.ts`
- `apps/web/src/app/features/comparisons/compare-runs-page.spec.ts`
- `apps/web/src/app/shared/charts/comparison-chart.spec.ts`

## Davranış

### Seçim ve route

- Run History'de satırlar `RunHistoryItem` olarak tutulur; en fazla iki farklı kayıt seçilir. RUNNING satırı devre dışıdır ve erişilebilir adı nedenini söyler.
- `Compare` yalnızca iki terminal, farklı ve aynı planlı run için etkindir. Farklı plan seçimi engellenir ve "Choose two runs of the same plan" açıklaması görünür; yine de API 422/409/404 yanıtları Compare ekranında işlenir.
- Karşılaştırma sayfası `leftRunId`/`rightRunId` query'sini tek doğruluk kaynağı olarak kullanır; yenileme ve deep link aynı isteği üretir. Eksik, bozuk veya aynı kimlikli query istek göndermeden açıklanır.
- Sayfadaki "Change runs" paneli son 100 run'ı `GET /api/runs?page=1&limit=100` ile getirir; RUNNING ve farklı plan seçenekleri devre dışıdır, seçim `Compare selected runs` ile yeni query'ye yazılır. `Swap sides`, `Clear comparison` ve `Reload comparison` vardır.
- 409 `RUN_NOT_TERMINAL`, 422 `COMPARISON_PLAN_MISMATCH`, 404 `NOT_FOUND`, 400 doğrulama, 401 oturum, 403 rol ve 500/ağ hataları ayrı başlık/mesaj/requestId ve uygun aksiyonlarla gösterilir.

### Sonuç ve kural farkları

- İki run özeti plan/sürüm, durum/sonuç, senaryo/seed, başlangıç/bitiş UTC, beklenen/kaydedilen örnek, adım sayısı ve tolerans dışı örnek sayısıyla yan yana gösterilir.
- `versionDifference` aynı/farklı plan sürümünü açıklar; eşleşmenin isim/sıra değil `logicalStepId` ile yapıldığı belirtilir. Senaryo veya seed farkı ayrıca neden olarak gösterilir.
- Eşleşen adımlarda ad, birim, sıra, minimum, maksimum, örnek sayısı ve aralık iki snapshot'tan yan yana gösterilir; API `changedFields` alanları `Changed` etiketiyle vurgulanır.
- Yeniden adlandırma `A → B` başlığı ve "Renamed from A to B" notuyla, sıra değişimi `Position 2 → 3` ile aynı kartta kalır.
- `numericComparison.statistics` aynı birimde delta kolonunu doldurur; `UNIT_MISMATCH` durumunda istatistik nesnesi yoktur ve delta hücresi "Not calculated — units differ" yazar. Hiçbir delta istemcide hesaplanmaz.
- Eklenen adım yalnızca sağ run, kaldırılan adım yalnızca sol run tablosuyla gösterilir; eksik taraf sütunu/sıfırı yoktur. Aynı ada sahip silinip yeniden eklenen iki adım farklı `logicalStepId` taşıdığında iki ayrı tek taraflı kart olarak kalır.
- Kısmi run `partial` bayrağıyla "Partial data" veya tüm örnekler kaydedilmişse "Stopped after all samples" olarak işaretlenir; adım bazında `recordedCount/sampleCount` ve eksik örnek sayısı açıkça yazılır. Null istatistik "Not recorded" olur, sıfır olmaz.

### Grafikler ve etkileşim

- Aynı birimli eşleşen adımlarda tek chart üzerinde iki dataset vardır. Sol seri düz teal, sağ seri kesikli mor çizgi; her nokta kendi run'ının `elapsedMs` X değerini kullanır. İndeks hizalama, interpolasyon veya örnek çıkarma yoktur.
- Her run'ın kendi `minimum`/`maximum` değerleri ayrı annotation bandı/çizgisi olarak çizilir ve "Left tolerance …", "Right tolerance …" etiketlenir. Seri gizlendiğinde yalnızca o run'ın dataset'i ve tolerans annotation'ları gizlenir; diğer veri, ölçek ve sonuç değişmez.
- Tooltip başlığı örnek + adım, gövde run tarafı + sürüm + plan, run id, adım, örnek indeksi, değer/birim, elapsed ms, UTC kayıt zamanı ve stored tolerance sonucunu gösterir.
- Birim değişen eşleşmelerde iki ayrı `MeasurementChart` paneli vardır; "No shared axis, numeric delta, or index alignment" açıklaması görünür.
- Her iki run için ayrı erişilebilir ölçüm tablosu vardır: caption, `scope="col"`, örnek indeksi, elapsed, değer/birim, UTC zaman ve backend `isWithinTolerance` sonucu. Tek taraflı adımlarda yalnızca var olan run'ın tablosu bulunur.
- Grafiklerdeki `Reset view` yalnızca zoom'u sıfırlar; seri aç/kapat düğmeleri native `button`, `aria-pressed` ve canlı duyuru üretir. Tekil grafik panelindeki "View measurements in the table" bağlantısı ilgili karşılaştırma tablosuna odaklanır.
- Canvas `role="img"`, açıklayıcı `aria-label` ve görsel olarak gizli özetle desteklenir; chart çizilemezse tablolar ve özet kalır.

## Çalıştırılan kontroller ve gerçek sonuçlar

| Komut | Gerçek sonuç |
|---|---|
| `npm run lint --workspace apps/web` | `Found 0 warnings and 0 errors.` — 112 dosya, 93 kural. |
| `npm run typecheck --workspace apps/web` | Exit 0; tanı yok. |
| `npm run test --workspace apps/web` | `Test Files 36 passed (36)`, `Tests 359 passed (359)`. |
| `npm run build --workspace apps/web` | `Application bundle generation complete.` Çıktı: `apps/web/dist/web`. `compare-runs-page` lazy chunk: 86.74 kB ham / 19.41 kB transfer. Style bütçesi uyarısı yok. |

### Test kapsamı

- API istemcisi: doğru query, tam response parse, tekrarlanan `logicalStepId`, aynı run, farklı plan ve eksik ölçüm değerinin reddi.
- Seçim: iki terminal aynı plan kabulü, RUNNING/farklı plan/eksik çift reddi, query empty/missing/malformed/self durumları, seçenek etiketi.
- Run History: RUNNING checkbox'ının kapalı olması, en fazla iki seçim, farklı plan engeli, `/compare?...` navigasyonu ve API'ye giden query.
- Sayfa: deep link, run özetleri, aynı/farklı sürüm açıklaması, değişen 6 alan, rename/reorder, eklenen/kaldırılan tek taraflılık, aynı adlı silinip eklenen adımın ayrı kalması, 409/422/404/401/500, retry, seçim paneli, URL değişiminde yeni istek ve eski yanıtın yok sayılması, clear/swap, boş adım durumu, focus bağlantısı.
- Grafik: iki dataset, iki farklı X dizisi, iki tolerans bandı/çizgisi ve etiketleri, seri toggle'ının diğer veriyi değiştirmemesi, boş seri notu, reset/destroy, canvas açıklaması, tooltip run/sürüm/örnek/değer/elapsed/UTC satırları, erişilebilir özet.
- Kısmi veri: CANCELLED/null outcome, `partial` chip'i, eksik örnek sayısı, iki satırlı ölçüm tablosu ve sıfır doldurulmaması.

## Ertelenen / kapsam dışı

- Gerçek API + PostgreSQL + tarayıcı üzerinden uçtan uca karşılaştırma ve gerçek canvas hover/zoom/toggle görsel kontrolü yapılmadı; P6-06/P7 kapsamına bırakıldı. Bu nedenle kartlar `In Review`, `Accepted` değil.
- `@probedesk/api-client` henüz P6-01 şemasını içermiyor. `comparisons-api.types.ts` geçici ve açıkça işaretli; generated tipler üretilince aliaslar değiştirilmeli ve parser'ın alanları aynı kaldığı için ekranlar korunmalı.
- Karşılaştırma seçim paneli son 100 run'ı listeler (API limiti). Daha eski bir çift, iki kimlik doğrudan girilerek/URL ile açılabilir; sunucu yine doğrular. Tüm geçmişi sayfalamalı seçim P6-05/P6-06 kapsamında değerlendirilebilir.
- Aynı run'ı iki kez gönderme API'de 400 `VALIDATION_ERROR` döner; bu ekran aynı kimliği istek göndermeden yerel olarak reddeder. API hatası yine işlenir.
- `docs/tasks/README.md` ve `docs/roadmap.md` bu worker'ın sahiplik alanı dışında; lead aynı commit'te güncelleyecek.
- Bağımsız teknik inceleme ve nihai kabul yapılmadı.
