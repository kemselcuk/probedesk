# Faz 5 — Canlı ölçüm grafiği ve gerçek canvas doğrulaması

- Tarih: 2026-11-03
- Görev: P5-06
- Durum: **In Review** — bağımsız teknik inceleme ve nihai kabul bekliyor.
- Kapsam: `apps/web` canlı çalışma ekranı ve grafik katmanı, `scripts/phase-5-chart-check.mjs`, bu kanıt dosyası ve P5-06 görev kartı. `apps/api`, `packages`, kök bağımlılıklar, diğer dokümanlar, `docs/tasks/README.md` ve `docs/roadmap.md` değiştirilmedi.
- Kısıt: Bu worker git komutu çalıştırmadı; commit ve push lead tarafından atılacak.

## Değişen dosyalar

### Canlı grafik ve veri/render ayrımı

- `apps/web/src/app/features/runs/live-chart-scheduler.ts` — `LIVE_CHART_SCHEDULER` injection token'ı; üretimde bir `requestAnimationFrame`, desteklenmeyen ortamda 16 ms'lik kısa zamanlayıcı. Testlerde manuel scheduler ile değiştirilir.
- `apps/web/src/app/features/runs/testing/live-chart-scheduler.fake.ts` — hiçbir şeyi kendiliğinden çalıştırmayan, `flush()` ile deterministik görsel güncelleme sağlayan test scheduler'ı.
- `apps/web/src/app/features/runs/live-run.facade.ts` — otoriter `snapshot` deposu her SSE olayında hemen güncellenir; yalnızca çizim için kullanılan `chartSnapshot` kopyası tek bir görsel güncellemede birleştirilir. İlk yükleme, uzlaştırma, terminal olay, final snapshot ve iptal yanıtı görsel kopyayı hemen tazeler. Route teardown'ında bekleyen görsel timer iptal edilir.
- `apps/web/src/app/features/runs/live-run-page.ts` — `chartSnapshot` ile adım başına grafik, seçim durumu (`selectedSample` / `activeSelection`), grafik tıklamasından ölçüm satırı seçme/odaklama, tablo bağlantısı ve route değişiminde seçim temizliği.
- `apps/web/src/app/features/runs/live-run-page.html` — "Live measurement charts" bölümü; her adım/birim için bir `MeasurementChart`, aynı örnekleri içeren erişilebilir tam ölçüm tablosu, canlı görsel örnek sayısı ve kayıtlı örnek sayısı veri öznitelikleri.
- `apps/web/src/app/features/runs/live-run-page.scss` — grafik kartı yerleşimi ve seçili satır vurgusu; component style bütçesi (6 kB uyarı eşiği) altında kalındı.
- `apps/web/src/app/features/runs/live-run-page.spec.ts` — mevcut ekran testlerine fake chart factory ve manuel scheduler sağlandı (davranış beklentileri değişmedi).
- `apps/web/src/app/features/runs/live-run.facade.spec.ts` — mevcut facade testlerine manuel scheduler sağlandı.
- `apps/web/src/app/features/runs/live-run-chart.spec.ts` — yeni canlı grafik testleri (5 senaryo).

### Gerçek canvas doğrulama altyapısı

- `apps/web/src/app/shared/charts/measurement-chart.types.ts` — isteğe bağlı `MeasurementChartDebug` handle sözleşmesi.
- `apps/web/src/app/shared/charts/measurement-chart.factory.ts` — gerçek Chart.js örneği üzerinden nokta pikseli, X görünüm aralığı, zoom durumu ve tooltip başlık/gövde metnini okuyan tipli debug görünümü.
- `apps/web/src/app/shared/charts/measurement-chart.debug.ts` — yalnızca `window.__probedeskChartDebug === true` iken etkinleşen kayıt defteri; normal ürün kullanımında erişilemez.
- `apps/web/src/app/shared/charts/measurement-chart.ts` / `measurement-chart.html` — debug kaydının chart oluşturma/yok etme yaşam döngüsüne bağlanması ve grafik bölümüne adım kimliği veri öznitelikleri.
- `scripts/phase-5-chart-check.mjs` — gerçek Chrome'u CDP ile süren, gerçek API'de FORCED_FAILURE çalıştıran, tooltip/click/zoom/pan/reset/final sayı/route dönüşü kontrollerini yapan betik.

## Tasarım

### Veri deposu ve görsel güncelleme

- `LiveRunFacade.snapshot` her `measurement.recorded` olayında reducer ile güncellenir. Örnekler `sampleIndex` ile birleştirilir; hiçbir olay görsel throttle nedeniyle atlanmaz.
- `chartSnapshot` yalnızca çizim ve tam tablo için kullanılan gecikmeli kopyadır. Aynı görsel karede birden çok olay gelirse tek scheduler isteği yapılır ve son tam snapshot çizilir. Bu, veri kaybı değil, yalnızca çizim sıklığının sınırlandırılmasıdır.
- Görsel kopya şu durumlarda hemen tazelenir: ilk snapshot, gap uzlaştırması, stream hatası sonrası taze snapshot, terminal olay, terminal sonrası final snapshot ve iptal yanıtı. Böylece terminal ekranda eski bir kare kalmaz.
- Terminal olaydan sonra stream kapanır; bekleyen görsel timer iptal edilir ve final snapshot otoriter kabul edilir. Sonraki `measurement.recorded` olayları reducer tarafından `after-terminal` olarak reddedilir.
- `DestroyRef.onDestroy` bekleyen görsel timer'ı iptal eder; facade bileşen seviyesinde sağlandığı için route ayrılışı HTTP/SSE aboneliklerini ve grafik kaynaklarını kapatır, çalıştırmayı iptal etmez.

### Grafik ve erişilebilir tablo

- Her adım için ayrı `MeasurementChart` kullanılır; X ekseni `elapsedMs`, Y ekseni adımın kayıtlı birimidir. Tolerans bandı ve sınır çizgileri snapshot'taki `minimum`/`maximum` değerlerinden çizilir.
- Nokta rengi/şekli yalnızca backend'in `isWithinTolerance` bayrağından gelir. Değer yalnızca çizim için sayıya çevrilir; tooltip ve tablo özgün ondalık metni gösterir.
- Grafikteki hata listesi, grafik noktası tıklaması ve tam ölçüm tablosundaki satırlar aynı `logicalStepId + sampleIndex` seçimini üretir. Seçilen satır `aria-current="true"` ve `is-selected` ile işaretlenir, render sonrası odaklanır.
- Her grafiğin altında o adımın bütün örneklerini içeren tablo vardır (`#measurements-table-<runStepId>`); grafikteki "View measurements in the table" bağlantısı bu tabloya odaklanır. "Recent measurements" bölümü son 20 örneği gösteren hızlı kuyruk olarak korunur; tam sayı kontrolü grafik tablolarındadır.
- Boş seri, tek örnekli seri ve eşit min/max davranışı ortak grafik bileşeninden gelir; canlı ekran bu davranışı yeniden hesaplamaz.

### Gerçek canvas debug hook

- Chart.js tooltip'i canvas üzerine çizdiği için DOM'dan metin okunamaz. Doğrulama betiği, uygulama açılmadan önce `window.__probedeskChartDebug = true` bayrağını koyar; yalnızca bu durumda grafik bileşeni tipli bir debug kaydı yayınlar.
- Debug API yalnızca okuma sağlar: `pointPixel(sampleIndex)`, `snapshot()` (örnek sayısı, X aralığı, görünür örnek sayısı, zoom durumu, tooltip başlığı/gövdesi/örnek indeksi). Ürün ekranları bu API'yi kullanmaz.
- Betik gerçek CDP fare olayları gönderir (`Input.dispatchMouseEvent`); Chart.js tooltip'ini sentetik bir DOM olayıyla değil, gerçek hover ile açar. Aynı şekilde zoom tekerleği, pan sürüklemesi ve Reset tıklaması da gerçek girdi olaylarıdır.

## Testler

- `live-run-chart.spec.ts` (5 test):
  1. İki adım için iki grafik; beş SSE örneği tek scheduler isteğinde birleşir; veri deposu beş örneği hemen tutar, görsel kopya flush sonrası beş noktayı ve backend tolerans bayrağını gösterir.
  2. Terminal olaydan sonra bekleyen görsel güncelleme kalmaz; final snapshot grafiği ve tabloyu 12 örneğe çıkarır; terminal sonrası olaylar grafiği değiştirmez.
  3. Grafik noktası tıklaması doğru ölçüm satırını seçer, `aria-current` verir ve satırı odaklar.
  4. Route ayrılışında grafik örneği `destroy` edilir; geri dönüşte yeni snapshot ile yeni grafik kurulur ve tam örnek sayısı çizilir.
  5. Route ayrılışında bekleyen görsel güncelleme iptal edilir.
- Mevcut `live-run-page.spec.ts` ve `live-run.facade.spec.ts` davranışları korunur; yalnızca test double sağlayıcıları eklendi.
- Testlerde gerçek canvas kullanılmaz; fake factory config üzerinden nokta/tolerans/seçim doğrular. Gerçek canvas kanıtı aşağıdaki tarayıcı koşusudur.

## Çalıştırılan kontroller ve gerçek sonuçlar

Sıra: repo kökü, 2026-11-03.

| Komut | Gerçek sonuç |
|---|---|
| `npm run lint --workspace apps/web` | `Found 0 warnings and 0 errors.` — `Finished in 50ms on 98 files with 93 rules using 8 threads.` |
| `npm run typecheck --workspace apps/web` | `tsc -p tsconfig.app.json --noEmit` çıkış kodu 0; tanı yok. |
| `npx tsc -p tsconfig.spec.json --noEmit` (apps/web) | Çıkış kodu 0; spec dosyalarında tip hatası yok. |
| `npm run test --workspace apps/web` | `Test Files 32 passed (32)`, `Tests 319 passed (319)`, `Duration 10.84s`. Önceki 314 test korunur; 5 yeni canlı grafik testi eklendi. |
| `npm run build --workspace apps/web` | `Application bundle generation complete. [3.496 seconds]`, `Output location: apps/web/dist/web`. Uyarı/hata yok. `live-run-page.scss` 6 kB uyarı eşiğinin altında. |

### Gerçek Chrome / gerçek API koşusu

Komut:

```text
RUN_VERSION_ID=ad607662-1e62-4a0e-acab-472a87bd8343 node scripts/phase-5-chart-check.mjs
```

Ortam: macOS (arm64), Node.js 22.23.2, Google Chrome headless (`--headless=new`, 1280×1100), API `127.0.0.1:3100`, derlenmiş SPA `scripts/app-server.mjs` üzerinden `127.0.0.1:4300`, `/api` aynı origin'den API'ye aktarıldı. PostgreSQL `127.0.0.1:5434` üzerindeki yerel demo veritabanı ve yayınlanmış plan sürümü kullanıldı. Betik tek aktif çalışma kuralına uyar: 409 yanıtında aynı idempotency anahtarıyla yeniden dener; bu koşuda kendi FORCED_FAILURE çalıştırmasını aldı.

Koşu sonucu (run `0e870806-28fc-48a0-b1eb-c001c3cc39da`, FORCED_FAILURE, seed 15):

- Beklenen/kaydedilen örnek: **90 / 90**. Sonuç: `COMPLETED` / `FAILED`.
- Canlı çalışırken ilk adımın grafiğinde 7 örnek görüldü; diğer iki adım henüz 0 örnekteydi. Bu, grafiklerin SSE ile canlı beslendiğini gösterir.
- Final grafik örnek sayıları: `[30, 30, 30]`; API adım ölçüm sayılarıyla birebir aynı.
- Grafik bölümündeki tam tabloların satır sayıları: `[30, 30, 30]`, toplam **90**; API `recordedSampleCount` ile aynı.
- Failing nokta: 3. adım (`Current Draw`), örnek indeksi **14**, değer `0.600000 A`.
- Gerçek hover sonrası Chart.js tooltip metni:
  `Sample 14 · Current Draw` / `Run: Power Supply Validation (0e870806-…)` / `Step: 3 · Current Draw` / `Sample index: 14` / `Value: 0.600000 A` / `Elapsed: 3,278 ms` / `Recorded (UTC): 3 Nov 2026, 21:32:27 UTC` / `Result: Outside tolerance`.
- Failing noktaya gerçek fare tıklaması: odaklanan öğe `measurement-row-580448bb-b5e1-4d14-a3cf-752430002dad-14`; satırda `is-selected=true`, `aria-current="true"`.
- Zoom: X aralığı `0–7000` → `331.88–6631.88`; görünür örnek 29; toplam örnek sayısı `30` değişmedi.
- Pan: gerçek fare sürüklemesi X aralığını değiştirdi (`0–6299.999`); toplam örnek sayısı `30` kaldı.
- Reset view: `zoomed=false`, X aralığı yeniden `0–7000`; toplam örnek sayısı `30` kaldı.
- Terminal sonrası 1,2 saniye beklemede grafik örnek sayıları `[30, 30, 30]` değişmedi; EventSource `readyState=2` (kapalı).
- Route ayrılışı: "View run details" bağlantısıyla `/runs/:id` sayfasına gidildi; eski üç canvas `isConnected=false`, kayıt defteri yalnızca yeni sayfanın 3 grafiğini tuttu. `history.back()` ile canlı ekrana dönüldü; snapshot yeniden yüklendi, grafikler yeniden kuruldu ve final sayıları korundu. Çalıştırma iptal edilmedi.
- `Runtime.exceptionThrown`: **0**.

Ekran görüntüleri:

- [phase-5-live-chart.png](phase-5-live-chart.png) — gerçek canvas tooltip'i açıkken 3. adımın grafiği, tolerans bandı, hata listesi ve tablo.
- [phase-5-live-chart-selection.png](phase-5-live-chart-selection.png) — failing noktaya tıklandıktan sonra örnek 14'ün tablo satırı seçili ve odaklı.

## Gerçek canvas kontrolünün kanıtladığı / kanıtlamadığı

**Kanıtlandı:**

- Gerçek Chart.js canvas'ında gerçek hover ile tooltip açıldı; başlık ve gövde metni backend değerini, birimi, elapsedMs'i ve tolerans sonucunu içeriyor.
- Gerçek fare tıklaması doğru adım/örnek satırını seçti ve odakladı.
- Gerçek tekerlek zoom'u ve fare sürükleme pan'i yalnızca X görünümünü değiştirdi; toplam veri noktası sayısı değişmedi.
- Gerçek "Reset view" düğmesi tam seriyi geri getirdi.
- Final grafik ve tam tablo örnek sayıları API snapshot'ıyla aynı (90).
- Terminal sonrası grafik değişmedi ve EventSource kapandı.
- Route ayrılışında canvas/grafik kaynakları temizlendi; dönüşte snapshot yeniden yüklendi ve grafik yeniden kuruldu.

**Kanıtlanmadı / sınırlar:**

- Tooltip metni görüntü OCR'ıyla değil, uygulamanın opt-in tipli debug kaydı üzerinden okundu. Bu, gerçek Chart.js tooltip modelinin gerçek hover sonrası içeriğidir; ayrıca ekran görüntüsünde tooltip görsel olarak doğrulandı.
- Klavye-only grafik kullanımı ve ekran okuyucu turu yapılmadı; erişilebilir tablo/satır odaklama DOM üzerinden doğrulandı, tam a11y denetimi P7 kapsamındadır.
- Sadece 3. adımın (Current Draw) grafiği ekran görüntüsünde incelendi; diğer iki grafiğin nokta/tolerans görünümü testler ve API sayılarıyla doğrulandı, ayrı görsel inceleme yapılmadı.
- Gerçek tarayıcıda throttle'ın kaç çizim isteğini birleştirdiği ölçülmedi; birleştirme ve veri kaybetmeme davranışı `live-run-chart.spec.ts` içindeki manuel scheduler testiyle kanıtlandı. Tarayıcı koşusu final sayıların ve canlı ilerlemenin doğruluğunu gösterir.
- Safari/Firefox ve mobil genişlikler denenmedi; yalnızca Chrome headless 1280×1100.
- API/PostgreSQL temiz kurulum yerine mevcut yerel demo veritabanı ve mevcut yayınlanmış plan sürümü kullanıldı. Betik `RUN_VERSION_ID` ve çalışan API gerektirir; tek aktif çalışma kuralı için 409 durumunda aynı idempotency anahtarıyla bekler.
- `scripts/phase-5-chart-check.mjs` Playwright değildir; CDP tabanlı gerçek Chrome kontrolüdür. Playwright E2E paketi P7-01 kapsamındadır.
- Bağımsız teknik inceleme ve nihai kabul yapılmadı; kart `In Review` durumundadır.
