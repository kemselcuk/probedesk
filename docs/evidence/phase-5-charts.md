# Faz 5 — Ölçüm grafiği ve grafik etkileşimleri

- Tarih: 2026-11-03
- Görevler: P5-04 (ortak ölçüm grafiği), P5-05 (grafik etkileşimleri)
- Durum: **In Review** — bağımsız teknik inceleme ve nihai kabul bekliyor.
- Kapsam: `apps/web` yalnızca. `apps/api`, `packages`, kök bağımlılıklar, `docs/tasks/README.md` ve `docs/roadmap.md` bu çalışmada değiştirilmedi.
- Kısıt: Bu worker git komutu çalıştırmadı; commit ve push lead tarafından atılacak.

## Değişen dosyalar

### Ortak grafik katmanı

- `apps/web/src/app/shared/charts/chart-js.setup.ts` — uygulama genelindeki tek Chart.js kayıt noktası; `LineController`, `LineElement`, `PointElement`, `LinearScale`, `Tooltip`, annotation ve zoom eklentileri bir kez kaydedilir.
- `apps/web/src/app/shared/charts/measurement-chart.types.ts` — üretilen `RunSnapshotStepDto`/`RunMeasurementDto` şemalarından türetilen grafik görünüm tipleri, seçim kimliği, Chart.js handle ve factory sözleşmesi.
- `apps/web/src/app/shared/charts/measurement-chart.config.ts` — saf eşleme/config üreticileri: eksenler, nokta stilleri, tolerans annotation'ları, değer aralığı, tooltip metinleri, erişilebilir özet, zoom/pan ayarları.
- `apps/web/src/app/shared/charts/measurement-chart.factory.ts` — `ChartJsMeasurementChartFactory` ve `MEASUREMENT_CHART_FACTORY` injection token'ı; gerçek `Chart` yalnızca burada oluşturulur.
- `apps/web/src/app/shared/charts/measurement-chart.ts` — standalone, OnPush, signal input/output `MeasurementChart` bileşeni.
- `apps/web/src/app/shared/charts/measurement-chart.html`
- `apps/web/src/app/shared/charts/measurement-chart.scss`
- `apps/web/src/app/shared/charts/testing/fake-measurement-chart.ts` — testlerde canvas kullanmadan config ve seçim doğrulayan fake factory/handle.

### Run Details entegrasyonu

- `apps/web/src/app/features/runs/run-details-page.ts` — seçim durumu, ilk ihlal aksiyonu, satır/tablo odaklama, bayat seçim temizliği.
- `apps/web/src/app/features/runs/run-details-page.html` — adım başına grafik, grafik olay bağlantıları, seçilebilir ölçüm satırları, tablo hedef kimlikleri.
- `apps/web/src/app/features/runs/run-details-page.scss` — seçili satır vurgusu; sayfa stil bütçesi aşılmadı.
- `apps/web/src/app/features/runs/run-details-chart.ts` — saf seçim/başarısızlık satırı yardımcıları.
- `apps/web/src/app/features/runs/run-details-chart.spec.ts`

### Testler

- `apps/web/src/app/shared/charts/measurement-chart.config.spec.ts`
- `apps/web/src/app/shared/charts/measurement-chart.spec.ts`
- `apps/web/src/app/features/runs/run-details-page.spec.ts` — mevcut testlere ek olarak grafik entegrasyonu ve etkileşim testleri; gerçek canvas yerine fake factory sağlanır.

## Grafik tasarımı

- Her adım için tek `MeasurementChart` vardır. X ekseni adımın kayıtlı `elapsedMs` değeri, Y ekseni adımın kayıtlı birimidir.
- Grafik noktaları doğrudan snapshot ölçümlerinden üretilir. `value` yalnızca çizim için sayıya çevrilir; tooltip ve tablo özgün ondalık metni gösterir.
- Nokta durumu yalnızca backend'in `isWithinTolerance` alanından gelir. Değer karşılaştırması, ortalama veya yeniden tolerans hesabı yoktur. Testlerde değeri aralık içinde olup bayrağı `false` olan örnek kırmızı elmas, değeri aralık dışında olup bayrağı `true` olan örnek yeşil daire olarak doğrulanır.
- Normal örnek daire, tolerans dışı örnek elmas (`rectRot`) ve daha büyük işaretle çizilir. HTML lejant şekilleri metinle açıklar; renk tek gösterge değildir.
- Tolerans, snapshot'taki `minimum`/`maximum` metinlerinden annotation olarak çizilir: aralıkta dolgulu bant + iki sınır çizgisi, `minimum === maximum` olduğunda tek tolerans çizgisi. Y ekseni aralığı toleransı her zaman kapsar; tek örnek ve eşit sınırlarda da görünür kalır.
- Boş seri: grafik eksenleri ve toleransı gösterir, üzerine "No samples were recorded" açıklaması gelir; değer uydurulmaz. Tek örnek ve eşit sınır test edilir.
- Görsel olarak gizli özet, örnek sayısını, toleransı, ihlal sayısını, ilk ihlal indeksini ve şekil anlamını metne döker. Kullanıcıya görünen "View measurements in the table" bağlantısı ölçüm tablosuna odaklanır.
- Her adımın grafiğinde, o adımın tolerans dışı örneklerini klavyeyle seçilebilen düğmeler olarak listeleyen bir hata listesi bulunur; ilk ihlal "First failure" etiketiyle işaretlenir.

## Etkileşim tasarımı

- Tooltip; çalışma planı + run id, adım, örnek indeksi, özgün değer + birim, `elapsedMs` ve UTC kayıt zamanını gösterir. UTC biçimlendirme sabit `en-GB` + `timeZone: 'UTC'` ile yapılır.
- Grafik noktasına tıklama `logicalStepId + sampleIndex` seçimi üretir. Run Details seçimi signal olarak tutar, hedef ölçüm satırına `aria-current="true"` ve vurgu sınıfı verir, render sonrası satırı odaklar; odak tarayıcıda adım kartını görünür alana getirir.
- Aynı seçime üç klavye/dokunmatik yol vardır: grafikteki hata listesi düğmeleri, tolerans dışı ölçüm tablosu satırları (`tabindex="0"`, Enter/Space) ve ilk ihlal özetindeki "Show sample in measurements" düğmesi.
- Seçim kimliği adım + örnek indeksidir. Başka adım seçildiğinde önceki grafikte vurgu kalkar, yeni adım/satır seçilir; yeniden render seçimi korur. Refresh sonrası örnek snapshot'ta yoksa seçim etkisiyle temizlenir; route ile başka run'a geçişte seçim sıfırlanır.
- Zoom/pan yalnızca X ekseninde etkindir ve `limits: original` ile ilk seriye sınırlıdır. "Reset view" `resetZoom()` çağırır, tam seriyi geri getirir ve görünümün veriyi/sonucu değiştirmediğini duyurur. Veri ve tolerans bayrakları zoom sırasında değişmez.
- Grafik örneği bileşen başına bir kez oluşturulur; veri/seçim değişimi mevcut örneği `update` eder. Bileşen yok edilirken `ResizeObserver` bağlantısı kesilir ve `chart.destroy()` çağrılır. Chart.js `responsive` modu ve container `ResizeObserver` birlikte yeniden boyutlandırmayı yönetir.

## Çalıştırılan kontroller ve gerçek sonuçlar

| Komut | Gerçek sonuç |
|---|---|
| `npm run lint --workspace apps/web` | `Found 0 warnings and 0 errors.` (94 dosya, 93 kural) |
| `npm run typecheck --workspace apps/web` | Exit 0; tanı yok. |
| `npm run test --workspace apps/web` | `Test Files 31 passed (31)`, `Tests 313 passed (313)`. |
| `npm run build --workspace apps/web` | `Application bundle generation complete.` Çıktı: `apps/web/dist/web`. `run-details-page.scss` bütçe uyarısı yok. Tek uyarı: `Module 'hammerjs' used by chartjs-plugin-zoom... is not ESM` (üçüncü taraf eklenti bağımlılığı; build exit 0). |

### Test kapsamı

- Saf config: X/Y eksenleri ve birim, `elapsedMs` eşlemesi, tolerans bandı/çizgileri, eşit min/max tek çizgi, değer aralığının toleransı kapsaması, boş/tek örnek, nokta şekli ve renkleri, seçili nokta, tooltip başlığı/satırları ve UTC biçimi, zoom/pan limitleri, tooltip callback kablolaması, sayısal olmayan değerin çizilmemesi.
- Bileşen: tek chart örneği ve yerinde update, nokta tıklamasında doğru `logicalStepId + sampleIndex`, hata listesi düğmeleri ve `aria-pressed`, tablo bağlantısı, Reset View, boş/tek/eşit sınır görünümü, erişilebilir canvas etiketi + gizli özet, container yeniden boyutlandırması ve destroy temizliği (observer disconnect + chart destroy).
- Run Details: adım başına bir grafik ve yeniden render'da çoğalmama, grafik ile tablonun aynı değer/bayrağı kullanması, grafik tıklamasından satır seçimi/odaklama, hata listesinden seçim, adım değişiminde seçimin taşınması, tolerans dışı satırın Enter ile seçilmesi, tablo bağlantısı ve ilk ihlal aksiyonu, refresh sonrası kaybolan örneğin seçiminin temizlenmesi.
- Saf yardımcılar: tablo/satır kimlikleri, adım ve örnek çözümlemesi, adıma göre seçim, yalnızca backend bayrağına dayalı hata listesi.

### Canvas kanıtı hakkında

Testbed içinde gerçek canvas çizilmez. Chart.js `MEASUREMENT_CHART_FACTORY` token'ı arkasına alınmıştır; testler fake factory ile üretilen `ChartConfiguration` üzerinden eksen/annotation/nokta/tooltip/zoom ayarlarını ve seçim olaylarını doğrular. Gerçek canvas hover/click/zoom/reset ve görsel doğrulama P5-06 kapsamındadır; bu görevde iddia edilmez.

## Ertelenen / kapsam dışı

- Gerçek tarayıcıda canvas hover/click/zoom/reset ve görsel inceleme yapılmadı; P5-06'ya bırakıldı. Bu nedenle kartlar `In Review`, `Accepted` değil.
- `chartjs-plugin-zoom` içindeki `hammerjs` CommonJS olduğu için build uyarısı veriyor. Uyarıyı susturmak için `angular.json` `allowedCommonJsDependencies` değişikliği bu worker'ın sahiplik alanı dışında bırakıldı; build başarılı.
- Chart.js + annotation + zoom, `run-details-page` lazy chunk'ını yaklaşık 41,6 kB'tan 293,2 kB ham boyuta çıkardı (83,5 kB transfer). Rota lazy olduğu için başlangıç paketi etkilenmedi; ileride P7'de ölçülmeli.
- Canlı grafik güncellemesi (Live Run) bu görevde eklenmedi; P5-06 kapsamındadır.
- Bağımsız teknik inceleme ve nihai kabul yapılmadı.
