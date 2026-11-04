# Faz 6 — Bağımsız Teknik İnceleme

- İnceleme tarihi: 2026-11-04
- İncelenen commit: `0d0fb52` (`test: record phase 6 unit, sampling and version consistency evidence`)
- İnceleme türü: **Bağımsız teknik inceleme**. Bu belge ürün kabulü, demo kabulü veya
  `Accepted` kaydı değildir. Hiçbir görev bu incelemeyle `Accepted` durumuna taşınmadı.
- Kapsam: P6-01…P6-06, `docs/requirements.md` REQ-19/REQ-20, `docs/api.md`
  (geçmiş/karşılaştırma), `docs/data-model.md` (snapshot ve kimlik), `docs/frontend.md`
  (Compare Runs), `docs/testing.md` T19–T23 ve Faz 6 kanıt dosyaları.
- Ortam: macOS arm64, Node.js 22.23.2, npm 11.6.2, PostgreSQL 18.1. Gerçek API/DB için
  yerel demo veritabanı (`127.0.0.1:5434`) ve gerçek Chrome 157.0.8103.38 (headless,
  1280×1100) kullanıldı.

## Sonuç özeti

| Görev | Teknik sonuç | Gerekçe |
|---|---|---|
| P6-01 | **Teknik olarak geçti** | Terminal/farklı/same-plan/404/409/422/400 sözleşmesi, `logicalStepId` eşleşmesi, eski snapshot, birim/örnekleme ve kısmi veri gerçek API/DB ile doğrulandı. Kanıt sayıları güncel değil (Düşük L-1). |
| P6-02 | **Teknik olarak geçti; bir UX bulgusu var** | Run History seçimi, deep link, yenileme, swap/clear ve hata durumları gerçek Chrome'da çalıştı. Aynı adlı planlarda seçenek kimliği belirsiz (Orta M-3). |
| P6-03 | **Teknik olarak geçti** | Özetler, 7 kural alanı, rename/reorder, eklenen/kaldırılan adımlar ve kısmi veri doğru gösterildi. |
| P6-04 | **Ürün davranışı geçti; kabul kanıtı yetersiz** | Bağımsız gerçek Chrome kontrolünde tooltip/toggle/zoom/reset geçti; ancak commit'teki kanıt gerçek canvas/Playwright kontrolü içermiyor ve kart kriterleri buna rağmen işaretli (Yüksek H-2). |
| P6-05 | **Ürün davranışı geçti; kabul kanıtı yetersiz** | Bağımsız geçici planla birim/örnekleme/rename/reorder gerçek API ve Chrome'da doğrulandı; ancak commit'teki kanıt bunu kapsamıyor (Orta M-1). |
| P6-06 | **Koşullu** | Kimlik ve snapshot değişmezliği doğrulandı; ancak kabul ölçütündeki 0.65 A senaryosu ile kayıtlı kanıt/veri 0.60 A ve FAILED v1 çapraz sürüm kanıtı eksik (Yüksek H-1). |

Kritik veya yüksek öncelikli bir **ürün hatası** bulunmadı. En yüksek bulgular, kabul
ölçütlerinin kanıtla birebir eşleşmemesi ve gerçek canvas kanıtının eksikliğidir. Ürün
davranışı bu incelemede bağımsız olarak gerçek API/DB/Chrome üzerinden ayrıca doğrulandı.

## Yöntem ve gerçek komut sonuçları

Komutlar `0d0fb52` üzerinde, temiz çalışma ağacında çalıştırıldı. `npm run verify`
e2e'yi içermediği için API e2e ayrıca çalıştırıldı.

| Komut | Gerçek sonuç |
|---|---|
| `npm run verify` | **EXIT=0**. Lint: API 138 dosya, web 112, api-client 2 → hepsi `Found 0 warnings and 0 errors.` API unit: 16 dosya / **118 test**. Web: 36 dosya / **367 test**. API ve web build başarılı. `openapi:check`: `OpenAPI contract is current`. |
| `npm run test:e2e --workspace apps/api` | **EXIT=0**. `Test Files 19 passed (19)`, `Tests 185 passed (185)`, süre **35.15 s**. |
| `npm run test:e2e --workspace apps/api -- test/comparisons.e2e-spec.ts` | **EXIT=0**. `Test Files 1 passed (1)`, `Tests 10 passed (10)`, süre **2.96 s**. |
| `npm run openapi:check` | **EXIT=0**. `OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.` |
| `node scripts/phase-6-compare-check.mjs` | **EXIT=0**. Derin bağlantı v1/v2, 3 ortak adım, 1 değişen kural, 3 canvas; Run History seçimi → `/compare?leftRunId=…&rightRunId=…`; `exceptions: []`. Betik, depodaki kanıt PNG'sini ezmemek için geçici kopya ile çalıştırıldı; üretim kodu değişmedi. |

Notlar:

- API e2e gerçek PostgreSQL test veritabanını (`127.0.0.1:5433`) ve gerçek HTTP/Supertest
  kullanıyor; DB kısıtları mock'lanmadı. Web bileşen testleri Chart.js için sahte factory
  kullanıyor. Gerçek canvas davranışı bu incelemede ayrıca gerçek Chrome/CDP ile kontrol
  edildi; **Playwright değildir** ve `docs/frontend.md:80`'deki Playwright şartını tek
  başına karşılamaz.
- Gerçek API olarak önceden çalışan `apps/api/dist/main.js` (`127.0.0.1:3100`, demo DB
  5434) ve Angular dev sunucusu (`127.0.0.1:4200`, `/api` proxy) kullanıldı. Bu süreçler
  inceleme başlamadan önce de çalışıyordu; başka bir çalışana ait olabileceği için
  kapatılmadı.

## Gerçek API doğrulaması

Demo veritabanındaki gerçek run'larla yapılan kontroller:

| Senaryo | Sonuç |
|---|---|
| Aynı sürüm PASSED vs PASSED (`c9ccf15f…` / `4c5bb58c…`) | 200; `sameVersion: true`; 3 eşleşen adım; değişen alan yok; iki run da 90/90, `partial:false`. |
| Aynı sürüm PASSED vs FAILED (`c9ccf15f…` / `28f167a3…`) | 200; sol PASSED, sağ FAILED; kural farkı yok; iki run'un kendi verdict'i korunuyor. |
| Farklı sürüm v1 PASSED vs v2 PASSED (`c9ccf15f…` / `d3fb8417…`) | 200; sürümler 1/2; 3 eşleşen adım; yalnız `Current Draw.maximum` `0.550000 → 0.600000`; 90/90. Gerçek Chrome'da 3 canvas. |
| v1 FAILED vs v2 PASSED (`28f167a3…` / `d3fb8417…`) | 200; sol FAILED, sağ PASSED; eski `maximum` hâlâ `0.550000`; başarısız örnek 14 = `0.600000`, `isWithinTolerance:false`; v2 `maximum` `0.600000`. Eski verdict canlı planla yeniden hesaplanmıyor. |
| CANCELLED 1/90 vs PASSED (`249981a0…` / `c9ccf15f…`) | 200; `outcome:null`, `reasonCode:USER_CANCELLED`, `partial:true`; tüm adımlarda `statistics` üyeleri `null`, ölçümler ilk adımda 1, diğerlerinde 0; tüm delta'lar `null`. `0` doldurma yok. |
| INTERRUPTED 76/90 vs FAILED (`fd3159bb…` / `0e870806…`) | 200; ilk iki adım COMPLETED ve istatistikleri dolu; üçüncü adım INTERRUPTED, 16/30 örnek, `statistics` tümü `null`; sayısal delta `null`. Kısmi adımda bile `outOfToleranceCount:1` ve `firstFailureSampleIndex:14` korunuyor. |
| Farklı planlar (`c9ccf15f…` / `0e870806…`) | **422** `COMPARISON_PLAN_MISMATCH`; `details.leftPlanId` ve `rightPlanId` farklı. |
| Bilinmeyen run | **404** `NOT_FOUND`; eksik taraf açıklanmıyor. |
| Aynı terminal run iki kez | **400** `VALIDATION_ERROR`; `fieldErrors[0].path = rightRunId`, `code = INVALID_VALUE`. |
| RUNNING run ile terminal run | **409** `RUN_NOT_TERMINAL`; `details.leftStatus:RUNNING`, `rightStatus:COMPLETED`. RUNNING run'ın kendisiyle karşılaştırması da 409 (terminal kontrolü önce). |
| Eksik/bozuk/bilinmeyen parametre | **400** `VALIDATION_ERROR`; eksik `rightRunId`, `leftRunId=not-a-uuid`, bilinmeyen `x=1` alan yolları doğrulandı. |
| Viewer rolü | 200; aynı gövde. Oturumsuz istek e2e'de 401 `UNAUTHENTICATED`. |
| Tutarlı okuma | `apps/api/src/comparisons/comparisons.service.ts:34-66` iki run'ı ve tüm adım/ölçümleri tek `REPEATABLE READ` işleminde okuyor; canlı plan/taslak sorgusu yok. Eşzamanlı yazma stresi ayrıca test edilmedi. |

### Geçici birim/örnekleme planı (P6-05 bağımsız kontrolü)

Demo planında v1/v2 yalnızca `maximum` değiştiriyordu; birim/örnekleme farkını bağımsız
olarak doğrulamak için geçici bir plan oluşturuldu (tüm veriler inceleme sonunda silindi):

- `P6 Review Temp Plan` v1: `Temp Voltage` (V, 2 örnek, 100 ms) ve `Temp Current`
  (A, 2 örnek, 100 ms).
- v2: `Temp Voltage` aynı `logicalStepId` ile `Temp Voltage Renamed` olarak yeniden
  adlandırıldı; birim **V → mV**, min/max `0.400000–0.600000 → 400.000000–600.000000`,
  örnek 2 → 3, aralık 100 → 150 ms, sıra 1 → 2. `Temp Current` aynı kimlikle sıra 2 → 1.
  `Temp Legacy` yeni bir kimlikle eklendi.
- Gerçek API sonucu: 2 eşleşen adım + 1 `addedSteps` (`Temp Legacy`, yalnız sağ) +
  0 `removedSteps`. `Temp Voltage` için `changedFields` sabit sırada **name, unit,
  position, minimum, maximum, sampleCount, intervalMs** (7 alan) döndü;
  `numericComparison = { comparable:false, reason:"UNIT_MISMATCH", statistics:null }`.
  Sol seri 2 örnek (`elapsedMs` 110, 229), sağ seri 3 örnek (158, 329, 507) döndü;
  indeks hizalama/pad/interpolasyon yok. `Temp Current` aynı birimde delta'larla döndü.
- Gerçek Chrome: birim değişen kartta **iki ayrı `MeasurementChart` paneli** (V ve mV),
  karşılaştırma grafiği yok; "No shared axis, numeric delta, or index alignment"
  açıklaması görünür; istatistik delta hücreleri "Not calculated — units differ".
  Aynı birimli kartta tek çift-serili grafik, eklenen adımda yalnız sağ taraf tablosu
  vardı. Konsol istisnası yok.

## Gerçek Chrome doğrulaması

Chrome 157 headless, 1280×1100, CDP üzerinden; Angular dev sunucusu 4200 → API 3100.
Sayfa yenileme, deep link, swap/clear, hata durumları ve grafik etkileşimleri gerçek
tarayıcıda çalıştırıldı.

- **Deep link ve özetler:** `/compare?leftRunId=c9ccf15f…&rightRunId=d3fb8417…` açıldı;
  "Version 1"/"Version 2", iki "Passed" özeti, 3 ortak adım, 0 eklenen/kaldırılan,
  1 değişen kural göründü. Sayfa yenilendiğinde URL ve içerik aynı kaldı.
- **Grafikler:** 3 adım kartı, 3 canvas; her çift-serili kartta 2 erişilebilir
  `aria-pressed` seri düğmesi (toplam 6). Sol seri gizlendiğinde `aria-pressed=false`,
  görünür metin "SHOW", özet "Left run … is hidden", sağ seri `true` kaldı; canvas
  içeriği yeniden çizildi. Diğer seri ve backend sonuçları değişmedi.
- **Tooltip:** Gerçek Chart.js tooltip'i (debug hook üzerinden okundu):
  `Sample 3 · Case Temperature`, `Run: Left run · Version 1 · Power Supply Validation`,
  run ID, `Value: 37.846724 °C`, `Elapsed: 865 ms`, `Recorded (UTC): 3 Nov 2026, 20:38:19 UTC`,
  `Result: Within tolerance`.
- **Zoom/reset:** X ekseni `0–7000` → wheel sonrası `331.33–6631.33`, `zoomed=true`;
  "Reset view" sonrası `0–7000`, `zoomed=false`. Sadece görünüm değişti.
- **Kısmi veri:** INTERRUPTED 76/90 run'ında sol özet "Interrupted", "Partial data",
  "76 of 90 … 14 are missing"; `Current Draw` kartı "Partial", "16 of 30 expected samples
  recorded; 14 missing. Missing samples are not zero-filled."; istatistikler
  "Not recorded"; iki ölçüm tablosu; kart metninde `0.000000` yok.
- **Birim değişimi:** Yukarıdaki geçici planla iki ayrı panel; toplam 3 canvas
  (2 birim paneli + 1 çift-serili grafik); eklenen adım tek taraflı tablo.
- **Hata durumları:** 409 "A running run cannot be compared" + request ID;
  422 "The runs belong to different plans"; 404 "One of the runs was not found";
  aynı run ve eksik query için "This comparison link cannot be opened"; hepsi
  `role="alert"`, uygun "Choose different runs" / "Open Run History" aksiyonları.
- **Run History seçimi:** `/runs` ekranında iki terminal run seçildi; Compare düğmesi etkinleşti
  ve `/compare?leftRunId=…&rightRunId=…` adresine gitti. Farklı plan seçildiğinde Compare
  devre dışı kaldı ve "Choose two runs of the same plan" açıklaması göründü.
- **Swap/clear:** Swap URL'deki iki kimliği değiştirdi ve özetleri yer değiştirdi;
  Clear `/compare` adresine döndü.
- **Erişilebilirlik (temel):** Hata bölümleri `role=alert`, tablolarda `caption` ve
  `scope="col"`, grafiklerde `role="img"` + açıklayıcı `aria-label`, seri düğmelerinde
  `aria-pressed`; konsol hatası yok. 1280 px dışı genişlik ve ekran okuyucu denenmedi.

## Bulgular

### Yüksek

#### H-1. P6-06 kabul ölçütü ile kanıt/demo verisi uyuşmuyor: 0.65 A yerine 0.60 A

- Dosya: `docs/tasks/P6-06.md:21`, `docs/evidence/phase-6-integration.md:24,44-45`,
  `docs/demo.md:29`, `scripts/phase-2-demo.mjs:142`
- Sözleşme: `docs/requirements.md:37` (REQ-07), `docs/testing.md:39` (T19),
  P6-06 kabul ölçütü "v1 0.55 A sınırındaki 0.60 A ihlali v2 sınırı 0.65 A olunca da eski
  kayıtta Failed kalır".

**Gözlem:** P6-06 kartı v2 sınırının **0.65 A** olmasını istiyor. Demo betiği
`maximum: '0.6'` yazıyor; gerçek demo planı v2 `0.600000` taşıyor; kanıt dosyası da
`0.550000 → 0.600000` diyor. Kanıt, v1 **PASSED** ile v2 **PASSED** run'larını
karşılaştırıyor (`phase-6-integration.md:30,44-45`); v1 **FAILED** run'ın yeni sürümden
sonra da Failed kaldığını gösteren çapraz sürüm kanıtı yok. Bağımsız incelemede mevcut v1
FAILED run (`28f167a3…`) ile v2 PASSED run karşılaştırıldı: eski `maximum` `0.550000`,
başarısız örnek 14 `0.600000`, sonuç FAILED olarak korunuyor; ancak yeni sınır yine
`0.600000`, 0.65 değil.

**Etki:** Ürün kodu snapshot'ı doğru okuyor; ancak P6-06'nın yazılı kabul senaryosu
(0.65 A) hiçbir test/demo verisinde temsil edilmiyor. Kart, kanıt ve demo arasında üçlü
bir tutarsızlık var; "0.65 A yeni sınırına rağmen eski kayıt Failed" iddiası bu haliyle
kayıtlı kanıtla doğrulanamaz. P6-06 bu haliyle Accepted'a alınmamalı.

**Öneri:** Demo/test planında v2 `maximum` değerini 0.65 A yapıp v1 FAILED run ile v2 run'ı
yeniden karşılaştır; gerçek kanıtı `phase-6-integration.md` ve P6-06 kartına işle.
Alternatif olarak kullanıcı açıkça 0.60 A senaryosunu kabul ederse kart, demo ve kanıt
aynı sayıya çekilmeli; sessizce doküman değiştirilmemeli.

#### H-2. P6-04 gerçek canvas/Playwright kanıtı yokken kabul kriterleri işaretli

- Dosya: `docs/tasks/P6-04.md:20-23` (dört kriter `[x]`), `:43-44` (gerçek canvas
  tooltip/zoom/toggle ve görsel inceleme yapılmadı; testler sahte Chart.js factory
  üzerinden), `docs/evidence/phase-6-integration.md:66` (seri toggle'ları gerçek
  tarayıcıda tıklanmadı), `scripts/phase-6-compare-check.mjs:140`
- Sözleşme: `docs/frontend.md:80` — "Gerçek canvas etkileşimi Playwright ve görsel
  incelemeyle doğrulanır. TestBed içindeki canvas taklidi etkileşim kanıtı sayılmaz."

**Gözlem:** P6-04 kriterleri işaretli olmasına rağmen kartın kendi inceleme notu gerçek
canvas tooltip/zoom/toggle ve görsel incelemenin yapılmadığını söylüyor. Kanıt betiğinin
`seriesToggleCount` seçicisi `button[id*="series"]` arıyor; gerçek düğmelerde `id` yok,
bu yüzden çıktı her zaman `0` oluyor ve toggle hiç doğrulanmıyor. Bu incelemede gerçek
Chrome/CDP ile tooltip, toggle, wheel zoom ve reset doğrulandı; **ancak bu Playwright
değildir** ve depodaki kanıt paketinin yerine geçmez.

**Etki:** Ürün davranışı bağımsız kontrolde geçti; fakat kabul kriteri, sözleşmenin açıkça
yasakladığı sahte canvas kanıtına dayanılarak işaretlenmiş. Bu, kabul kaydının güvenilirliğini
zedeler; P6-04 bu haliyle "kanıt tamam" sayılmamalı.

**Öneri:** P7-01 Playwright kapsamında gerçek canvas tooltip/toggle/zoom/reset ve görsel
kontrolü çalıştırıp kanıtı bağla; o zamana kadar P6-04 kriterlerini `[ ]` yap veya kanıt
notunu "koşullu" olarak işaretle. Kanıt betiğindeki seçiciyi `.series-toggle` ve
`aria-pressed` üzerinden düzelt.

### Orta

#### M-1. P6-05 "kabul" notu, birim/örnekleme farkının gerçek tarayıcıda doğrulandığını ima ediyor; kanıt bunu kapsamıyor

- Dosya: `docs/tasks/P6-05.md:21-24` (dört kriter `[ ]`), `:41` ("P6-05 kabulü …
  gerçek API v1/v2 karşılaştırması ve Chrome ekranı"), `docs/evidence/phase-6-integration.md:64-65`
  ("Birim/örnekleme farkı gerçek tarayıcıda ayrı bir fixture ile çizilmedi; backend e2e ve
  dual-chart bileşen testleri kapsıyor.")
- Sözleşme: `docs/testing.md:42` (T22), `docs/frontend.md:90`, P6-05 kabul ölçütleri.

**Gözlem:** Gerçek API v1/v2 demo karşılaştırmasında birim/örnekleme farkı yok (yalnızca
`maximum` değişiyor). Kanıt dosyası da bunu açıkça kabul ediyor. Buna rağmen kartta
"P6-05 kabulü" ifadesi ve gerçek Chrome atfı var. Bu incelemede geçici planla birim/
örnekleme gerçek API ve Chrome'da doğrulandı; ancak bu, commit'teki kanıt paketinin
parçası değil.

**Etki:** P6-05'in en kritik iki kriteri (ayrı panel, kendi `elapsedMs`) depodaki kanıtla
değil, yalnızca e2e ve bileşen testleriyle destekleniyor. Kart "kabul" derken kriterlerin
`[ ]` kalması da çelişkili.

**Öneri:** Bu incelemedeki geçici plan sonucunu (veya eşdeğer kalıcı bir fixture'ı)
`phase-6-integration.md`/P6-05 kanıtına ekle; kriterleri gerçek kanıtla işaretle.
"Kabul" kelimesini, kriterler ve bağımsız inceleme tamamlanana kadar kullanma.

#### M-2. `partial` alanı History ile Comparison API'de farklı anlam taşıyor

- Dosya: `apps/api/src/runs/dto/run-history.dto.ts:108-114` ve
  `apps/api/src/runs/run-history.service.ts:200-204` (yalnızca `recorded < expected`),
  buna karşılık `apps/api/src/comparisons/comparison-builder.ts:143-145` ve
  `apps/api/src/comparisons/dto/comparison.dto.ts:308-314`
  (`status !== COMPLETED || recorded < expected`).
- İlgili: `apps/web/src/app/features/comparisons/comparison-view.ts:498-508` bu geniş
  anlamı "Stopped after all samples" ile telafi ediyor;
  `docs/evidence/phase-5-review.md:395-402` History/Details için tek sayı-tabanlı tanımı
  kapatmıştı.

**Gözlem:** Aynı adlı `partial` alanı History'de "eksik örnek var", Comparison'da
"COMPLETED değil veya eksik örnek var" anlamına geliyor. Örneğin tüm 90 örneği kaydedip
finalization sırasında CANCELLED olan bir run History'de `partial:false`, Comparison'da
`partial:true` olur. Comparison UI chip metnini ayırdığı için ekran yanlış "Partial data"
demiyor; ancak API tüketicileri ve gelecekteki ekranlar aynı alanı yanlış yorumlayabilir.

**Etki:** Faz 5'te kapatılan "tek partial tanımı" kararı Comparison yüzeyinde geri
alınmış oluyor. Bu, ürün hatasından çok sözleşme tutarsızlığı; yine de aynı isimli alanın
iki anlamı olması API kalitesini düşürür.

**Öneri:** Comparison'da da `partial = recorded < expected` kullan; "stopped" bilgisini
`status`/`outcome` veya ayrı bir `stopped` alanıyla taşı. UI'daki "Stopped after all
samples" metni korunabilir; API alanı tek anlam kazanır.

#### M-3. Aynı adlı planlarda Compare seçenekleri ayırt edilemiyor (Faz 5 düzeltmesi Compare'a taşınmamış)

- Dosya: `apps/web/src/app/features/comparisons/compare-selection.ts:143-150`
  (`runOptionLabel` yalnızca sürüm + plan adı + durum + zaman gösteriyor).
- Karşılaştırma: `apps/web/src/app/features/runs/run-history-page.ts:363-375` aynı adlı
  planlar için yayımlanmış sürüm + kısa plan kimliği ekliyor; Faz 5 incelemesi bu sorunu
  `docs/evidence/phase-5-review.md:155-168`'de kaydetmişti.
- Sözleşme: P6-02 kabul ölçütü "kısıtlar anlaşılırdır" (`docs/tasks/P6-02.md:20`),
  `docs/frontend.md:90` "tek plan şartı UI'da açıklanır".

**Gözlem:** Demo veritabanında iki ayrı plan da "Power Supply Validation" adında. Compare
seçim panelinde iki planın run'ları aynı plan adıyla listeleniyor; ayırt edici tek şey
başlangıç zamanı ve sürüm. Farklı planlardan iki run seçildiğinde Compare devre dışı
kalıyor ve "Choose two runs of the same plan" deniyor, ancak kullanıcı hangi seçeneklerin
aynı plana ait olduğunu ekrandan anlayamıyor. History filtresi bu sorunu kısa plan kimliğiyle
çözmüş; Compare seçimi çözmemiş.

**Etki:** Tek plan kısıtı teknik olarak uygulanıyor ama kullanıcı için anlaşılır değil;
aynı adlı planlarda yanlış seçim ve gereksiz deneme-yanılma oluşur.

**Öneri:** Compare seçenek etiketine kısa `planId` (veya planın yayımlanmış sürüm kimliği)
ekle; aynı adlı iki planla bileşen testi ekle. History filtresindeki `planOptionLabel`
davranışını ortak bir yardımcıya çıkar.

#### M-4. Görev dizini ve yol haritası durumları kartlarla çelişiyor

- Dosya: `docs/tasks/P6-02.md:3`, `docs/tasks/P6-03.md:3`, `docs/tasks/P6-04.md:3`
  (In Review) vs `docs/tasks/README.md:95-97` (Planned).
- `docs/roadmap.md:3` hâlâ "P6 kullanıcı isteğiyle duraklatıldı" ve "karşılaştırma ve video
  henüz yoktur" diyor; oysa Compare Runs ekranı ve API'si çalışıyor.
- `docs/tasks/P6-05.md:43-45` ve `docs/tasks/P6-06.md:43-45` "Uygulama commit'i/Çalıştırılan
  kontroller/Kanıt bağlantıları: Henüz yok" diyor; aynı kartlarda kanıt dosyası ve gerçek
  komutlar var.
- Kural: `AGENTS.md:25-29` görev durumu değişince kart, `docs/tasks/README.md` ve
  `docs/roadmap.md` aynı commit'te güncellenir.

**Etki:** Durum tabloları ve kanıt alanları güvenilir değil; bir sonraki aşama veya kabul
kaydı yanlış duruma bakabilir. Ürün davranışını etkilemez, ama denetlenebilirliği bozar.

**Öneri:** P6-02/03/04'ü README'de In Review'a çek; roadmap'i "P6 In Review / karşılaştırma
var" olarak güncelle; P6-05/06 kanıt alanlarına gerçek commit ve komut sonuçlarını yaz.

### Düşük

#### L-1. Kanıt dosyalarındaki test sayıları ve "geçici tip" ifadeleri güncel değil

- `docs/evidence/phase-6-compare-api.md:147` 183 e2e testi diyor; bu incelemede **185**
  (19 dosya) alındı. Fark, Faz 5 düzeltme commit'indeki ek testlerden kaynaklanıyor.
- `docs/evidence/phase-6-compare-ui.md:78` 359 web testi diyor; bu incelemede **367**
  (36 dosya) alındı.
- `docs/evidence/phase-6-compare-ui.md:13,93` ve `docs/tasks/P6-02.md:44` tiplerin geçici
  ve elle yazıldığını, generated client'ın P6-01 şemasını içermediğini söylüyor; gerçek
  `apps/web/src/app/features/comparisons/comparisons-api.types.ts:1` doğrudan
  `@probedesk/api-client` generated tiplerini kullanıyor; `openapi:check` geçiyor.
- `docs/tasks/P6-01.md:48` api-client'ın yeniden üretilmesi gerektiğini söylüyor; artık
  üretilmiş ve doğrulanmış durumda.

**Etki:** Ürün kodu kanıttan daha iyi durumda; okuyucu yanlış bir eksiklik sanabilir.
Kabul kararını doğrudan engellemez.

**Öneri:** Kanıt dosyalarını son çalıştırılan komut sonuçlarıyla güncelle; geçici tip
notlarını kaldır.

#### L-2. `phase-6-compare-check.mjs` toggle'ı ve aynı-plan seçimini gerçekten doğrulamıyor

- Dosya: `scripts/phase-6-compare-check.mjs:140` (`button[id*="series"]` seçicisi; gerçek
  düğmelerde `id` yok, sonuç her zaman 0), `:147-153` (ilk iki "usable" run seçiliyor;
  farklı planlardan olabilir).
- Gözlem: Geçici run verisi varken betik, ilk iki run farklı planlardan olduğu için
  `/compare` navigasyonunda zaman aşımına uğradı; veri temizlendikten sonra geçti. Betik
  toggle'a hiç tıklamıyor; yalnızca canvas sayısını sayıyor.

**Etki:** Betik "gerçek Chrome" kanıtı olarak kullanılsa da P6-04'ün toggle kriterini
kanıtlamıyor. Bu incelemede ayrı bir CDP betiğiyle toggle/zoom/tooltip doğrulandı.

**Öneri:** Seçicileri `.series-toggle` / `aria-pressed` üzerinden kur; iki run'ı aynı
`planId`e göre seç; toggle, tooltip ve reset için açık assertion ekle.

#### L-3. Birim değişen adımda istatistik tablosu karma birimleri yan yana gösteriyor

- Dosya: `apps/web/src/app/features/comparisons/comparison-view.ts:245-254`,
  `apps/web/src/app/features/comparisons/comparison-step-card.html:161-162`.
- Gözlem: V → mV değişen adımda tablo `Minimum recorded 0.455722 | 501.444493` gösteriyor;
  delta hücresi "Not calculated — units differ" olsa da satırlarda birim etiketi yok.
  Kural tablosundaki Unit satırı ve üstteki "unit changed" notu bağlamı veriyor; yine de
  değerler ilk bakışta karşılaştırılabilir sanılabilir.

**Etki:** Düşük kullanım karışıklığı; yanlış delta üretilmiyor, ortak eksen yok.

**Öneri:** İstatistik satırlarında birimi (`V`, `mV`) veya "left/right" sütun başlığında
birimi göster; ya da birim değişiminde istatistikleri ayrı iki panele böl.

#### L-4. Tolerans etiketleri veriyle/çakışabiliyor

- Dosya: `apps/web/src/app/shared/charts/comparison-chart.config.ts:123-128`.
- Gözlem: İki run'ın min/max'ı aynı veya yakınken "Left tolerance …" ve "Right tolerance …"
  etiketleri grafik alanında veri noktalarıyla üst üste biniyor (1280 px ekran görüntüsü).
  Okunabilirlik düşüyor; işlevsel hata değil.

**Öneri:** Etiketleri grafik dışına taşımak, çakışma durumunda yalnızca birini göstermek
veya kısa "L/R" etiketi + legend kullanmak.

#### L-5. Karşılaştırma özet sayaçları run satırından değil, adım satırlarının toplamından üretiliyor

- Dosya: `apps/api/src/comparisons/comparison-builder.ts:107-118`.
- Gözlem: `expectedSampleCount`, `recordedSampleCount` ve `outOfToleranceCount`
  `RunStep` satırlarından toplanıyor; `TestRun` üzerindeki kopya sayaçlar kullanılmıyor.
  Gerçek veride fark görülmedi ve adım kopyaları snapshot olduğu için normalde eşittir.
- Etki: Bir veri tutarsızlığında özet, run'ın kendi sayacından farklı olabilir; düşük
  olasılıklı savunmacı bulgu.
- Öneri: Run satırındaki sayaçları kullan veya iki kaynağın eşitliğini doğrula.

## Görev bazlı değerlendirme

- **P6-01:** API sözleşmesi ve davranışı geçti. `REPEATABLE READ` tek okuma, canlı plana
  dönmeme, `logicalStepId` eşleşmesi, 7 alanlı `changedFields`, birim koşullu delta,
  kendi `elapsedMs` serileri ve kısmi null davranışı gerçek DB/HTTP ile doğrulandı.
  Kanıt sayıları güncellenmeli (L-1); `partial` semantiği M-2.
- **P6-02:** Deep link/yenileme, Run History seçimi, swap/clear, 404/409/422/400 hata paneli
  gerçek Chrome'da geçti. Aynı adlı planlarda seçenek kimliği belirsiz (M-3).
- **P6-03:** İki run özeti, sürüm farkı, rename/reorder, 7 kural alanı, eklenen/kaldırılan
  tek taraflılık, kısmi outcome ve null istatistikler doğru. `0` ile doldurma görülmedi.
- **P6-04:** Ürün davranışı bağımsız gerçek Chrome'da geçti (iki seri, kendi elapsed,
  iki tolerans, toggle, tooltip, zoom/reset, birim değişiminde iki panel). Kabul kanıtı
  H-2 nedeniyle eksik; Playwright/CI kanıtı P7-01'de tamamlanmalı.
- **P6-05:** Birim/örnekleme/rename/reorder bağımsız geçici planla gerçek API + Chrome'da
  geçti. Commit'teki kanıt bu senaryoyu kapsamıyor ve kart "kabul" diyor (M-1); kriterler
  `[ ]`.
- **P6-06:** Snapshot değişmezliği ve kimlik eşleşmesi doğru; v1 FAILED run'ın eski
  0.55 A sınırı ve 0.60 A ihlali korunuyor. Ancak kabul ölçütündeki 0.65 A senaryosu
  uygulanmamış ve kanıt FAILED v1 çapraz sürümünü göstermiyor (H-1). Koşullu.

## Doğrulanmayan sınırlar

- Gerçek canvas kontrolü **Playwright değil**, Chrome DevTools Protocol ile yapıldı;
  `docs/frontend.md:80`'deki Playwright şartı P7-01'de ayrıca karşılanmalı.
- 768 px genişlik, mobil yerleşim, Safari/Firefox ve ekran okuyucu denenmedi.
- ERROR run'ın kısmi verisi gerçek API'de ayrıca incelenmedi; e2e testi (`comparisons.e2e-spec.ts`)
  ERROR'ı doğrudan terminal DB geçişiyle kapsıyor. CANCELLED ve INTERRUPTED gerçek API'de
  incelendi.
- 500/ağ hatası, 401 ve 403 ekranları gerçek tarayıcıda değil, bileşen testlerinde
  doğrulandı.
- Eşzamanlı yazma sırasında tutarlı okuma stres testi yapılmadı; `REPEATABLE READ` kod
  incelemesiyle doğrulandı.
- 100'den fazla run, 10.000 örnekli run ve büyük yanıt boyutu performansı denenmedi.
- Aynı adlı plan seçenekleri gerçek demo verisinde gözlemlendi; düzeltme sonrası tekrar
  test edilmedi.
- 0.65 A senaryosu için uygun bir v2 planı olmadığından bu sayı gerçek API'de çalıştırılamadı;
  0.60 A ile eski FAILED davranışı doğrulandı.

## Temizlik

- Geçici `P6 Review Temp Plan` (`24abe84c…`), v1/v2 revision'ları ve iki run'ı
  (`65949c80…`, `d5a73986…`) test sonunda silindi.
- İnceleme sırasında 409 kontrolü için oluşturulan iki RUNNING run (`9e16c2fb…`,
  `d7477e60…`) iptal edilip `measurements`, `run_events`, `run_steps` ve `test_runs`
  satırlarıyla birlikte silindi.
- Demo DB run sayısı inceleme öncesi/sonrası **36**; `plan_steps_published_immutable` ve
  `plan_revisions_published_immutable` trigger'ları tekrar etkin (`tgenabled = O`).
- Chrome/CDP süreçleri ve geçici kullanıcı veri dizinleri kapatıldı/silindi. Önceden
  çalışan API (3100) ve Angular (4200) süreçleri başka bir çalışana ait olabileceği için
  kapatılmadı.
- Ürün kodu değiştirilmedi; `git status` temiz. Bu dosya dışında depoya yazılmadı.

## Sonuç

Faz 6'nın ürün davranışı, bağımsız gerçek API/PostgreSQL ve Chrome kontrollerinde büyük
ölçüde doğru: karşılaştırma kimliği, snapshot değişmezliği, birim/örnekleme ayrımı, kısmi
veri ve çift serili grafikler çalışıyor. Ancak teknik kabulden önce:

1. **H-1** için 0.65 A senaryosunu gerçekten uygulayıp FAILED v1 çapraz sürüm kanıtını
   ekle veya kullanıcı onayıyla kabul ölçütünü 0.60 A'ya çek.
2. **H-2** için P6-04'ün gerçek canvas/Playwright kanıtını tamamla; kriterleri o zamana
   kadar koşullu tut.
3. **M-1** için P6-05 birim/örnekleme tarayıcı kanıtını kalıcılaştır.
4. **M-2/M-3** için `partial` semantiğini ve aynı adlı plan seçeneklerini düzelt.
5. **M-4** ve **L-1** için görev/kanıt dosyalarını güncelle.

Bu belge ürün kabulü değildir; nihai kabul kullanıcıdadır.

## Fix re-check — 2026-11-04, commit `77e0bff`

### Ortam notu

İncelenen commit `77e0bff` (`test: prove phase 6 comparison with playwright and real canvas`).
Çalışma ağacı temiz değildi: `apps/api/src/comparisons/comparison-builder.ts` içinde **M-2
düzeltmesi unstaged** duruyordu. Bu düzeltme `77e0bff` commit'inde **yok**; aşağıdaki API
karşılaştırması bu farkı açıkça gösterdi. Ürün kodu değiştirilmedi.

### Çalıştırılan kontroller

| Komut / kontrol | Gerçek sonuç |
|---|---|
| `npx playwright test tests/e2e/compare.spec.ts` | **1 passed (8.2 s)**. Depodaki kanıt PNG'sini ezmemek için aynı test dosyası geçici kopyada, ekran görüntüsü geçici yola yönlendirilerek çalıştırıldı; assertion'lar aynı. Skip/fixme yok. |
| `npm run verify` | **EXIT=0**. Lint 0/0; API unit 16 dosya/118 test; web 36 dosya/367 test; build ve `openapi:check` başarılı. Çalışma ağacındaki M-2 diff'i bu koşuya dahildir. |
| `npm run test:e2e --workspace apps/api` | **EXIT=0**, 19 dosya/**185 test**, 35.31 s. |
| `npm run openapi:check` | **EXIT=0**, `OpenAPI contract is current`. |
| M-3 etiket çıktısı | `Version 2 · Power Supply Validation (plan 8b04c2c1) · Passed · 04/11/2026, 12:00 UTC` — kısa plan kimliği eklendi. |
| M-2 API kontrolü | Aynı DB üzerinde iki API: `77e0bff` kodu (3100) CANCELLED 9/9 run için `partial:true`; working-tree düzeltmesiyle derlenen API (3200) `partial:false`. Sentetik CANCELLED fixture inceleme sonunda silindi. |
| Görsel | `docs/evidence/phase-6-compare-playwright.png` incelendi: Current Draw çift serisi, sol 3 / sağ 4 örnek, iki tolerans bandı, sol 0.60 ve sağ 0.75 hata elmasları. |

### Bulgu durumları

- **H-1 — KAPATILDI.** Playwright testi gerçek API ile v1 `0.55 A` / `0.60 A` FAILED, v2
  `0.65 A` yayımlıyor; eski run `0.550000` ve FAILED kalıyor; karşılaştırma
  `maximum 0.550000→0.650000` ve `sampleCount 3→4` gösteriyor
  (`tests/e2e/compare.spec.ts:120-220`). Test assertion'ları gerçek, skip yok.
- **H-2 — KAPATILDI (çekirdek).** Gerçek Chrome/Playwright'ta seri toggle'ı
  (`aria-pressed` true→false→true), failure noktası tooltip'i (`Current Draw`,
  `0.600000`), wheel zoom (`zoomed:true`) ve Reset view (`zoomed:false`) doğrulandı
  (`tests/e2e/compare.spec.ts:237-299`). Ekran görüntüsü iki seriyi ve iki toleransı
  gösteriyor. **Kalan düşük bulgu:** testte console/pageerror dinleyicisi yok; kanıt
  dosyasındaki "Konsol istisnası yok" iddiası bu testle kanıtlanmıyor.
- **M-1 — KISMEN KAPATILDI.** P6-05 kriterleri `[x]` yapılmış; Playwright "Unit changed",
  "Not calculated — units differ" ve `°F` metinlerini görüyor
  (`tests/e2e/compare.spec.ts:232-235`). Ancak test **ayrı panel sayısını/canvas'ı
  assert etmiyor** ve ekran görüntüsü Current Draw kartını gösteriyor; "°C→°F ayrı
  paneller" iddiası bu kanıtla otomatik doğrulanmış değil. Önceki bağımsız Chrome
  kontrolünde paneller görülmüştü; yine de commit kanıtı için panel/canvas assertion'ı
  veya ikinci ekran görüntüsü gerekli.
- **M-2 — KAPATILMADI (`77e0bff`).** Commit'te comparison `partial` hâlâ
  `status !== COMPLETED || recorded < expected` (`comparison-builder.ts:143-145`).
  Working tree'deki düzeltme `partial = recorded < expected` yapıyor
  (`comparison-builder.ts:142-144`) ve 3200 API'de CANCELLED 9/9 için `false` döndü;
  ancak bu değişiklik commit'e girmemiş. `77e0bff` üzerinden kabul edilemez.
- **M-3 — KAPATILDI.** `runOptionLabel` kısa plan kimliğini içeriyor
  (`compare-selection.ts:149-150`); çıktı doğrulandı. Aynı adlı planlar artık ayırt
  edilebilir. Yeni etiket için ayrı bir birim testi eklenmemiş (düşük).
- **M-4 — KISMEN KAPATILDI.** `docs/tasks/README.md:95-97` P6-02/03/04'ü In Review'a
  çekmiş, `docs/roadmap.md:3` P6 In Review diyor. Ancak aynı roadmap cümlesi hâlâ
  "Phase 5 … sürüyor; karşılaştırma ve video henüz yoktur" diyor; P6-05/06 kartlarının
  "Uygulama commit'i/Çalıştırılan kontroller/Kanıt bağlantıları: Henüz yok" alanları
  güncel değil (`P6-05.md:43-45`, `P6-06.md:43-45`); P6-01…P6-04 kanıt alanları da eski
  commit/test sayılarını taşıyor. Durum tablosu düzeldi; kanıt/roadmap metni tam değil.

### Yeni bulgular

- **N-1 [Yüksek — commit bütünlüğü] M-2 düzeltmesi `77e0bff`'te yok.** Çalışma ağacındaki
  diff commit edilmeden "M-2 fixed" denemez. API'nin 3100/3200 karşılaştırması bunu
  kanıtladı. Düzeltme commit edilip aynı kontrol tekrarlanmalı.
- **N-2 [Orta — test hijyeni] Playwright testi oluşturduğu plan/run'ları silmiyor.**
  `tests/e2e/compare.spec.ts:306-307` yalnızca request context'leri dispose ediyor.
  İnceleme öncesi demo DB'de 6 adet "Version consistency" test planı ve 11 run birikmişti;
  bu çalıştırma 1 plan/2 run daha ekledi. Tekrarlar demo DB'yi ve son 100 run seçimini
  kirletir. Test izole test DB'si kullanmalı veya teardown'da plan/run'ları silmeli.
- **N-3 [Orta — kanıt iddiası] Birim değişimi panel kanıtı zayıf.** Playwright yalnızca
  metin arıyor; `.single-panel`/`app-measurement-chart` sayısını veya iki canvas'ı assert
  etmiyor. P6-05'in "ayrı panel" kriteri için bu kanıt yetersiz.
- **N-4 [Düşük — kanıt iddiası] Console ve veri değişmezliği iddiaları test edilmiyor.**
  Kanıt dosyası "Konsol istisnası yok" ve toggle sonrası "örnek/veri sayısı değişmedi"
  diyor; testte console/pageerror dinleyicisi veya toggle sonrası veri sayısı assertion'ı
  yok (`docs/evidence/phase-6-integration.md:79-82`).
- **N-5 [Düşük — tekrarlanabilirlik] Test, tracked kanıt PNG'sini doğrudan yazıyor**
  (`compare.spec.ts:301-304`) ve kök `npm run test:e2e` hâlâ P7-01 placeholder'ı; test
  `npm run verify` kapsamında değil. P7-06 CI bağlantısına kadar manuel kapı.

### Faz 6 teknik kabul durumu

`77e0bff` itibarıyla **teknik kabul önerilmez**: H-1, H-2 (çekirdek) ve M-3 çözüldü;
M-1/M-4 kısmi; **M-2 commit'te yok**. Working tree'deki M-2 düzeltmesi commit edilir,
Playwright testine panel/canvas ve console assertion'ları eklenir ve test verisi temizlenirse
Faz 6 teknik olarak kabul edilebilir. Hiçbir görev `Accepted` yapılmadı.

### Temizlik

- Bu çalıştırmanın Playwright planı (`65083dd3…`) ve iki run'ı silindi; sentetik
  CANCELLED 9/9 fixture (`99999999…`) silindi.
- İnceleme öncesi birikmiş 6 "Version consistency" test planı ve 11 run'ı da temizlendi.
  Demo DB yeniden **2 plan / 36 run**; RUNNING run yok.
- 3200 API süreci kapatıldı; Chrome/Playwright süreçleri kapandı; published-immutability
  trigger'ları etkin. Ürün kodu değiştirilmedi; çalışma ağacında yalnızca önceden var olan
  M-2 diff'i ve bu inceleme dosyası var.

## Final re-check — 2026-11-04, commit `fdace65`

- **N-1 — KAPATILDI.** `929f9d8` comparison `partial` semantiğini düzeltti; çalışma ağacında
  ürün kodu diff'i yok (`git status` yalnızca bu inceleme dosyasını gösteriyor).
- **M-2 — KAPATILDI.** `npm run verify` sonrası derlenen committed API'de sentetik
  CANCELLED 90/90 fixture `partial:false` döndü; aynı fixture eski `77e0bff` sürecinde
  `partial:true` idi. Fixture silindi. Kalıcı bir comparison e2e testi yok (Düşük).
- **N-2 — KAPATILDI.** `E2E_DATABASE_URL` ile Playwright testi **1 passed (8.6 s)**;
  öncesi/sonrası DB **2 plan / 36 run**, RUNNING yok. Cleanup `pg` ile plan/run'ları siliyor.
  `E2E_DATABASE_URL` yoksa cleanup sessizce çalışmıyor; `.env.example`'da tanımlı değil (Düşük).
- **N-3 — KAPATILDI.** Test, birim değişen adımda `.separate-panels canvas` sayısını **2**
  olarak assert ediyor ve geçiyor.
- **N-4 — KAPATILDI.** `console`/`pageerror` assertion'ı boş dizi bekliyor; sol seri toggle'ı
  sonrası sağ serinin `series-meta` metninin değişmediği assert ediliyor; test geçti.
- **N-5 — KAPATILDI.** Screenshot `test-results/phase-6-compare-playwright.png` altına
  yazılıyor; izlenen `docs/evidence/phase-6-compare-playwright.png` test tarafından
  değiştirilmedi (`git status` yalnızca bu inceleme dosyasını gösteriyor).
- **M-1 — KAPATILDI.** N-3 panel assertion'ı ile P6-05 "ayrı panel" kanıtı tamamlandı.
- **M-3 — KAPATILDI.** Kısa plan kimliği etiketi korunuyor; çıktı doğrulandı.
- **M-4 — KISMEN.** Durum tabloları In Review; ancak şu stale ifadeler kaldı:
  `docs/roadmap.md:3` hâlâ "Phase 5 … sürüyor; karşılaştırma ve video henüz yoktur" diyor;
  `docs/evidence/phase-6-integration.md:64-66` birim panelleri/toggle'ların gerçek tarayıcıda
  yapılmadığını söylüyor (yeni Playwright bölümüyle çelişiyor); `docs/tasks/P6-05.md:43-45`
  ve `P6-06.md:43-45` "Henüz yok" alanlarını taşıyor. Düşük dokümantasyon bulgusu.

**Komutlar:** Playwright `1 passed`; `npm run verify` EXIT=0 (API 118, web 367); API e2e
19 dosya/185 test, 34.83 s; `openapi:check` güncel.

**Yeni Critical/High/Medium yok.** Yalnızca Düşük: (1) M-4 stale metinleri, (2) kalıcı
CANCELLED-all-samples comparison testi yokluğu, (3) `E2E_DATABASE_URL` dokümantasyonu.
**Faz 6 teknik olarak kabul edilebilir.** Kartlar `Accepted` yapılmadı; nihai kabul
kullanıcıdadır.

**Temizlik:** DB 2 plan/36 run; 3200 API kapalı; Playwright/Chrome kapalı; trigger'lar etkin.


