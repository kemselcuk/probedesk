# EX-12 — 10k, failed ve partial rapor kenar kontrolleri

Tarih: 2026-11-08. Branch `feat/analytics-reporting-devices`, baseline `49ec0b0`.
Durum: **In Progress** (EX-12 kartı bu kayıtla kapanmaz). Bu dosya yalnız yeni edge
senaryolarının gerçek koşu kanıtıdır; ürün/görsel kabul veya EX-13 incelemesi değildir.

## Kapsam ve sahiplik

- Yeni dosyalar: `tests/e2e/feature-pack-1-edge.spec.ts`,
  `tests/e2e/support/ex12-edge-fixtures.ts`, bu kanıt dosyası.
- Mevcut spec, ortak helper, üretim kodu, docs/task kartı ve git geçmişi değiştirilmedi.
- Gerçek PostgreSQL, gerçek HTTP/API, gerçek Angular build, gerçek Chrome ve gerçek
  Chart.js canvas kullanıldı. API/DB mock'u yoktur.
- İzole hedef yalnız `127.0.0.1:5433/probedesk_ex12_edges_20261108_test`; API `3121`,
  web `4321`. Dev `5434` ve delivery `5432` kullanılmadı; credential/URL loglanmadı.

## Fixture notu (dürüst sınır)

10.000 ölçümlük terminal run, ürün plan yayımlama yolundan üretilemez: plan limiti
`MAX_TOTAL_DURATION_MS = 600000` ve minimum `intervalMs = 100` birlikte en fazla 6.000
örnek sağlar. Bu nedenle 10k senaryosu, görev brief'indeki "constraint-valid fixture"
izniyle yalnız test DB'sine doğrudan seed edildi. Fixture, executor'ın yazma sırasını
izler: önce DRAFT revision + adımlar + kimlikler, sonra izinli DRAFT→PUBLISHED geçişi,
sonra RUNNING run altında adımlar/ölçümler, en son terminal durum. DB check'leri ve
immutability trigger'ları açık kaldı. Bu bir üretim akışı iddiası değildir.

## Gerçekten çalıştırılan komutlar ve sonuçlar

1. DB yalnız maintenance oturumuyla oluşturuldu; hedef ad/host/port doğrulandı.
2. `node scripts/e2e-isolated.mjs prepare` → **exit 0**; guarded `db:migrate:test` ile
   10 migration uygulandı. Baseline:

   ```text
   plans=1 revisions=2 runs=4 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1
   devices=2 demoDevices=2 copyRequests=0 demoRuns=4
   ```

3. `npx playwright test tests/e2e/feature-pack-1-edge.spec.ts --workers=1 --reporter=list`
   (Chrome, `E2E_DATABASE_URL` yalnız yukarıdaki DB; `DATABASE_URL`/`TEST_DATABASE_URL`
   Playwright alt sürecinden kaldırıldı) → **3 test passed, exit 0, 23.3s**:
   - `real 10,000 measurements render, print and export through the report stack` (19.0s)
   - `failed report preserves the backend verdict, negative decimal and printed failure evidence` (1.1s)
   - `cancelled partial report shows missing samples honestly in DOM, CSV, JSON and print` (1.1s)
   - İlk yazımda iki test-kodu kusuru görüldü ve düzeltildi: senaryo etiketi
     `.report-heading` yerine metadata grid'de; PDF/print sonrası kompakt sidebar
     açık kalabildiği için indirmeler print'ten öne alındı. Ürün kodu değişmedi.
4. Test `afterAll` cleanup özeti:

   ```text
   plans=3 revisions=3 planSteps=15 stepIdentities=15 planCopyRequests=0 devices=3
   runs=3 runSteps=15 measurements=10014 runEvents=3 sessions=3 activeRuns=0
   ```

   Ardından `prepareE2eDatabase()` ile baseline sayı/digest eşitliği assert edildi.

5. `node scripts/e2e-isolated.mjs seed-check` → **exit 0**; iki seed sonrası
   "counts and canonical fixture digests unchanged".
6. `node scripts/e2e-isolated.mjs assert-baseline` → **exit 0**;
   "canonical fixture fingerprint matches the prepare baseline".
   `status` → `plans=1 runs=4 activeRuns=0 devices=2 demoDevices=2 copyRequests=0`.
7. Hedefli statik kontroller:

   ```sh
   npx tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 \
     --esModuleInterop --strict --skipLibCheck \
     tests/e2e/support/ex12-edge-fixtures.ts tests/e2e/feature-pack-1-edge.spec.ts
   npx prettier --check docs/evidence/feature-pack-1/ex-12-edge-checks.md \
     tests/e2e/feature-pack-1-edge.spec.ts tests/e2e/support/ex12-edge-fixtures.ts
   ```

   İkisi de **exit 0**.

## 10k senaryosunda doğrulananlar

- Gerçek API yanıtı ve Angular raporu 10 adım × 1.000 ölçüm = **10.000** kayıtla açıldı;
  başlık, uzun plan/cihaz/seri/parti metinleri ve 10 adım bölümü göründü.
- 10 Chart.js canvas'ının her biri gerçek piksel üretti; boyanan yatay aralık canvas
  genişliğinin >%80'i. Chart özetleri "1000 recorded samples" içeriyor.
- `Print / Save PDF` native `window.print()` çağrısını **1** kez tetikledi; 10 adet
  data-URL PNG hazırlandı, hepsi decode edildi; print uyarısı yok; navigation/actions
  print medyasında gizli.
- CSV: UTF-8 BOM, tek header, **10.000 veri satırı**, 19 kolon, stepPosition 1→10,
  sampleIndex 0→999, altı haneli decimal, `true` tolerans bayrağı; ilk/son satır
  fixture değerleriyle birebir.
- JSON: `schemaVersion=1`, 10 adım, toplam 10.000 ölçüm, uzun snapshot metadata,
  yasak anahtarlar (session/passwordHash/requestHash/idempotencyKey/event payload) yok.
- 390 px'de sayfa yatay taşmadı; yalnız rapor kural tablosu kendi bölgesinde kaydı.

## Failed ve partial senaryolarında doğrulananlar

- Failed: `COMPLETED/FAILED`, 2 adım, negatif tolerans (-1.000000..1.000000), index 1'de
  `-1.500000` değeri. DOM'da "Failed", out-of-tolerance 1, first failure index 1,
  istatistikler -1.500000 / 0.458000 / -0.234000; canvas'ta kırmızı hata noktası gerçek
  piksellerle görüldü. CSV'de negatif değer bozulmadan `false` olarak yer aldı; JSON
  verdict/statistics aynı.
- Partial: `CANCELLED`, expected 12 / recorded 6. "Partial result: CANCELLED..." uyarısı,
  Completed/Passed 4/4, Cancelled 2/4, Not run 0/4 adımları; partial istatistikler
  "Not available"; üçüncü adımda "No samples recorded." ve yalnız tolerans bandı çizildi.
  CSV'de 6 gerçek satır (uydurma satır yok), step 3 için satır yok; JSON'da status
  CANCELLED, outcome null, reasonCode USER_CANCELLED, ölçüm sayıları 4/2/0.

## PDF görsel incelemesi

Chromium print pipeline ile A4/12 mm üretilen dosyalar:

- 10k raporu: `11` sayfa, A4 (595.92 × 842.88 pt), 1.86 MB.
- Failed raporu: `3` sayfa, A4, 266 KB.
- Partial raporu: `4` sayfa, A4, 294 KB.

`pdfinfo` ile sayfa sayısı/boyutu doğrulandı; `pdftoppm -png -r 100` ile **18 sayfanın
tamamı** ayrı ayrı görsel incelendi. Bulgular: navigasyon/eylem basılmıyor; boş veya
kırpılmış grafik yok; uzun başlık/metaveri satırları sarıyor; her adım kendi bölümünde;
failed sayfasında kırmızı hata noktası ve negatif değerler okunuyor; partial sayfasında
"Not available" ve boş grafik mesajı doğru; footer görünür. PDF üretimi `page.pdf()`
ile yapıldı; **OS print dialog / Save PDF etkileşimi otomatikleştirilmedi**.

## Native zoom / OS print sınırı (gerçek deneme)

Gerçek Chrome (headless) üzerinde `/login` sayfasında Ctrl/Cmd + `=` altı kez denendi.
Ölçüm: `devicePixelRatio=1`, `visualViewport.scale=1`, `innerWidth=1280`,
`outerWidth=1280`, `body.zoom=1` — **native browser zoom değişmedi**.
CDP `Emulation.setPageScaleFactor=2` yalnız `visualViewport.scale=2` yaptı;
`devicePixelRatio` 1 kaldı, yani bu pinch/page-scale'dir ve native browser zoom yerine
geçmez. Bu nedenle 200% native zoom **doğrulanmış sayılmaz**. CSS zoom ve
`deviceScaleFactor` bilinçli olarak kullanılmadı.

Headless Chrome `window.print()` OS diyaloğu açmaz; Playwright'ın OS print dialog'unu
kabul/izleme API'si yoktur. Bu nedenle OS print dialog ve Save PDF etkileşimi
**doğrulanmamıştır**; yalnız `window.print()` çağrısı ve Chromium PDF/print CSS çıktısı
kanıtlanmıştır.

## Kapanış / açık kapılar

- Yalnız kendi yeni DB'si `DROP DATABASE ... WITH (FORCE)` ile düşürüldü; `pg_database`
  sorgusu 0 satır döndürdü. Kendi baseline tmp dosyası silindi. API/web süreçleri
  durduruldu; 3121/4321 dinlemiyor. Dev/delivery DB'lerine bağlanılmadı.
- `git status` yalnız iki yeni untracked dosyayı gösterir; commit/push yapılmadı
  (lead sahipliği).
- 10k plan yolunun ürün limitleriyle ulaşılamaması (600 s / 100 ms → 6.000 örnek) bu
  testin fixture kullanma gerekçesidir; sözleşme yorumu lead/EX-13 kararıdır.
- Native 200% zoom, OS print dialog, GitHub CI, seed'li eski DB upgrade, delivery
  8080 ve EX-13 açıktır. Bu dosya ürün/görsel kabul iddiası taşımaz.

## Lead incelemesi

Fixture explicit E2E URL/cleanup guard kullanır; tracker ID sahipliği, transaction/rollback
ve trigger etkinliği kodda incelendi. Gerçek canvas/CSV/JSON kontrolleri ve fixture kökeni
açık; 10k export üst sınırı, süre limitiyle bugün oluşturulabilen6000örnekten bağımsız
bir okuma dayanıklılığı kontrolüdür; ürün limiti değiştirilmedi. Hedefli type-aware
oxlint2dosya0warning/error; yeni3/3 koşu worker kanıtı olarak devralındı.
Lead native UI denemesi: preview kısayolları native zoom değiştirmedi; masaüstü
Chrome erişimi araç tarafından `Computer Use was not approved to use Google Chrome`
ile reddedildi. Bu nedenle native200%/OS dialog doğrulanmış veya Accepted sayılmaz.
