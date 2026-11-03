# Faz 5 — Bağımsız teknik inceleme

- İnceleme tarihi: 2026-11-03
- İncelenen commit: `f099534` (`docs: accept phase 4 tasks after independent review`)
- İnceleme türü: **Bağımsız teknik inceleme**. Bu belge ürün kabulü, demo kabulü veya
  `Accepted` kaydı değildir.
- Kapsam: P5-01…P5-06, `docs/requirements.md` REQ-16–18, `docs/api.md` (history/snapshot),
  `docs/measurement-rules.md`, `docs/frontend.md` (History/Details/chart), `docs/testing.md`
  T25/T26 ve Phase 5 kanıt dosyaları.
- Ortam: macOS arm64, Node.js 22.23.2, npm 11.6.2, PostgreSQL 18.1. Gerçek API/DB olarak
  yerel demo veritabanı (`127.0.0.1:5434`) ve gerçek Chrome headless kullanıldı.

## Önemli ortam notu

İnceleme sırasında çalışma ağacı `f099534` değildi: başka bir ajanın henüz commit edilmemiş
Phase 6 çalışması (`apps/web/src/app/features/comparisons/` vb.) ve bu çalışmanın
değiştirdiği `run-history-page.ts/html`, `run-snapshot.service.ts` gibi dosyalar çalışma
ağacında duruyordu. Phase 5 kodunu kirli ağaçtan
incelememek için commit, `git archive f099534` ile `/tmp/probedesk-p5-commit` altına alındı;
`npm ci` ve tüm doğrulamalar bu temiz kopyada çalıştırıldı. Ürün kodu değiştirilmedi.

## Sonuç özeti

| Görev | Teknik sonuç | Gerekçe |
|---|---|---|
| P5-01 | **Koşullu kabul / takip kararı gerekli** | History API işlevsel; ancak global `startedAt` indeksi yok ve `partial` semantiği Details ile çelişebiliyor (Bulgu 2, 3). |
| P5-02 | **Koşullu kabul** | Filtre/URL/stale davranışı doğru; sayfa aralığı dışı yanlış empty state, pagination odağı ve 401 kanıtı sorunlu (Bulgu 1, 4, 5, 6, 7). |
| P5-03 | **Kabul edilebilir** | Snapshot kuralları, null istatistikler, UTC zamanlar ve terminal durum ayrımı doğrulandı. Bulgu 2 History tarafındaki etiket/API semantiğinden kaynaklanıyor. |
| P5-04 | **Kabul edilebilir** | Grafik semantiği, boş/tek örnek/eşit sınır ve temizlik doğrulandı. Yalnız savunmacı bir overlay metni düşük bulgu (Bulgu 8). |
| P5-05 | **Kabul edilebilir** | Gerçek canvas tooltip, hata noktası seçimi, klavye alternatifi, zoom/pan/reset doğrulandı. |
| P5-06 | **Kabul edilebilir (kanıt sınırlarıyla)** | Canlı SSE, final sayılar, terminal durma ve route teardown gerçek tarayıcıda geçti; ancak kontrol Playwright/CI değil ve betik kendi run'ını temizlemiyor. |

Kritik veya yüksek öncelikli işlevsel bir hata bulunmadı. Aşağıdaki orta öncelikli bulgular
teknik kabulden önce düzeltilmeli veya kullanıcıya açık bir takip kaydıyla ertelenmelidir.

## Bulgular

### 1. [Orta] Aralık dışı sayfa, gerçekte run varken “No runs recorded yet” gösteriyor

- Dosya: `apps/web/src/app/features/runs/run-history-page.html:112-126`
- İlgili: `apps/web/src/app/features/runs/run-history-page.ts:126-139`,
  `apps/api/src/runs/run-history.service.ts:79-83`
- Sözleşme: `docs/api.md` history bölümü (aralık dışı sayfa `200` ve boş `items`, toplamlar
  değişmez); P5-02 kabul ölçütü “Empty/loading/error ayrıdır”.

**Gerçek gözlem:** `/runs?page=999` isteği `200` ile `page=999, total=36, totalPages=2,
items=[]` döndürdü (UI `limit=20` gönderiyor); ekran “No runs recorded yet” gösterdi ve
tablo/pagination hiç oluşturulmadı. `total > 0` olduğu hâlde kullanıcıya hiç run yok deniyor. Filtreli bir aralık
dışı sayfada ise “No runs match these filters” deniyor; iki durum da gerçeği yansıtmıyor.

**Etki:** Eski bir sayfa bağlantısı veya arada silinen run'lar nedeniyle kullanıcı yanlış
“hiç kayıt yok” mesajı görür; empty state içinde Previous/Next kontrolü olmadığı için
sayfadan çıkmak için URL'i elle değiştirmek gerekir.

**Öneri:** `history.total() > 0 && history.page() > history.totalPages()` durumunu ayrı bir
“page out of range” durumu olarak göster; “Go to last page / page 1” bağlantısı ver veya
API/istemci sayfayı son geçerli sayfaya sıkıştır. `total === 0` ile `items.length === 0`
ayrımını empty state hesabında kullan.

### 2. [Orta] `partial` bayrağı ile Details'in “partial” tanımı çelişiyor

- Dosya: `apps/api/src/runs/run-history.service.ts:200-202`
- İlgili: `apps/web/src/app/features/runs/run-history-page.html:206-210`,
  `apps/web/src/app/features/runs/run-status.ts:161-180`
- Sözleşme: `docs/measurement-rules.md:85-87` (kısmi özetler açık işaretlenir; eksikler
  sıfırla doldurulmaz), `docs/api.md` snapshot/partial açıklamaları.

**Gerçek gözlem:** Geçerli terminal durum olan “cancel during finalization” için
`CANCELLED`, `recorded=1/1` run oluşturuldu. History satırı `1 of 1 Partial` gösterdi;
aynı run'ın Details ekranı “None — every expected sample was recorded” ve “All expected
samples were recorded.” dedi. API `partial` alanı `status !== COMPLETED` olduğu için
`true`; Details `isPartialResult` ise yalnızca `recorded < expected` olduğunda `true`.

**Etki:** Aynı kayıt iki ekranda farklı “eksik veri” mesajı veriyor. Kullanıcı “Partial”
etiketiyle örnek eksik sanabilir; Details doğru şekilde tüm örneklerin kaydedildiğini
söylüyor. Durum (`CANCELLED`) ile örnek bütünlüğü (`1/1`) ayrı kavramlar.

**Öneri:** History'de “Partial” etiketini yalnızca gerçek örnek eksiği için kullan; iptal/
kesinti/teknik hata durumunu ayrı “Stopped / Not completed” etiketiyle göster. Alternatif
olarak API'de `partialSamples` ve `stopped` alanlarını ayır. Hangi yol seçilirse seçilsin
History, Details ve `partial` sözleşmesi aynı tanımı kullanmalı.

### 3. [Orta] Varsayılan history sorgusu için `startedAt` indeksi yok; tüm tablo sıralanıyor

- Dosya: `apps/api/prisma/schema.prisma:238-240`
- İlgili: `apps/api/src/runs/run-history.service.ts:85-93`
- Sözleşme: P5-01 kabul ölçütü “plan/status/outcome/tarih filtreleri ve kararlı sıralama”;
  `docs/api.md` sıra `startedAt DESC, id DESC`.

**Gerçek gözlem:** Mevcut indeksler `(planId, startedAt, id)`, `(status)` ve
`(planRevisionId)`. Filtresiz varsayılan sorgu için `EXPLAIN (ANALYZE, BUFFERS)`:

```text
Limit
  -> Sort  Sort Key: "startedAt" DESC, id DESC
       -> Seq Scan on test_runs
```

Aynı plan filtresi küçük test tablosunda yine Seq Scan seçti; `enable_seqscan=off` ile
`(planId, startedAt, id)` indeksinin kullanılabilir olduğu görüldü. Yalnız tarih veya
yalnız outcome filtresinde de `startedAt` ile başlayan indeks yok. `total` için ayrıca
tüm eşleşen satırlar taranıyor. Kanıt dosyası bu boşluğu zaten kabul ediyor.

**Etki:** Demo ölçeğinde (36 run) önemsiz; history büyüdükçe her sayfa ve her `total`
hesabı büyüyen bir sort/scan maliyeti taşır. 10 saniyelik transaction timeout'u aşılırsa
history 500/503'e dönebilir.

**Öneri:** Ölçümle doğrulandıktan sonra `@@index([startedAt, id])` (PostgreSQL geriye
tarama ile `DESC, DESC` sıralamayı karşılar) ekle. `outcome` için iki değerli düşük
seçicilikli indeks zorunlu değil; gerçek sorgu planına göre karar ver. Bu, P5-01'in
“rastgele indeks eklenmez” kuralına uygun şekilde ayrı bir migration ve EXPLAIN kanıtıyla
yapılmalı.

### 4. [Düşük/Orta] History'nin ayrı 401 paneli gerçek uygulamada görünmüyor

- Dosya: `apps/web/src/app/features/runs/run-history-page.ts:154-156`,
  `apps/web/src/app/features/runs/run-history-page.html:97-108`
- İlgili: `apps/web/src/app/core/auth/auth.interceptor.ts:24-41`
- Kanıt: `docs/evidence/phase-5-history-ui.md` “401 için ayrı session expired paneli”
  diyor.

**Gerçek gözlem:** Oturum çerezi temizlenip `/runs` yeniden yüklendiğinde ekran
“Your session has expired” paneli yerine `/login` sayfasına yönlendirildi
(`location.pathname === '/login'`). Protected bir 401, `authInterceptor` tarafından
`returnUrl` ile login'e çevriliyor. Component'in 401 dalı ve testi bu global
interceptor'ı devre dışı bırakan bir test ortamında çalışıyor; dolayısıyla kanıtlanan
davranış ürün ortamıyla aynı değil.

**Etki:** Davranış hâlâ güvenli ve kullanılabilir (login'e dönüş); ancak “ayrı 401 paneli”
iddiası yanıltıcı. Ekranın kendi 401 mesajı ölü kod olarak kalıyor.

**Öneri:** Ya global login yönlendirmesini tek doğru davranış olarak kabul edip History
panelini/kanıt iddiasını kaldır; ya da bu ekran için interceptor'ı bilinçli olarak atlayan
bir hata gösterimi tanımla ve gerçek 401'i tarayıcıda doğrula.

### 5. [Düşük] Sayfa değişiminde klavye odağı kayboluyor

- Dosya: `apps/web/src/app/features/runs/run-history-page.ts:214-227`
- Sözleşme: P5-02 tablo erişilebilirliği ve `docs/frontend.md` klavye/erişilebilirlik
  beklentileri.

**Gerçek gözlem:** “Next page” düğmesi odaktayken tıklandı; yükleme sırasında tablo ve
pagination DOM'dan kalktı. Yeni sayfa yüklendikten sonra `document.activeElement`
`MAIN#main-content` oldu; odak yeni tabloya veya sayfa başlığına taşınmadı.
`goToPage` içindeki `scrollTarget` navigasyondan **önce** alınıyor; `.then` içinde eski,
artık DOM'a bağlı olmayan elemana `focus()` çağrılıyor.

**Etki:** Klavye ve ekran okuyucu kullanıcısı sayfa değişiminden sonra bağlamını kaybediyor;
tablo `tabindex="-1"` hedefi işlevsiz kalıyor.

**Öneri:** Navigasyon sonrası `afterNextRender`/loaded state içinde tabloyu veya
“Recorded runs” başlığını yeniden sorgulayıp odakla; `aria-live` ile yeni sayfa aralığını
duyur. Mevcut `resultRange` canlı bölgesi bunun için kullanılabilir.

### 6. [Düşük] Aynı adlı planlar filtrede ayırt edilemiyor

- Dosya: `apps/web/src/app/features/runs/run-history-page.ts:237-239`
- Veri: demo veritabanında iki ayrı plan da “Power Supply Validation” adında.

**Gerçek gözlem:** Plan filtresi inceleme sırasında 4 seçenek gösterdi (“All plans” +
iki aynı adlı demo planı + geçici plan); temizlik sonrası 3 seçenek kaldı ve iki demo
planının görünen metni hâlâ birebir aynı. Plan adları için unique kısıtı yoktur.

**Etki:** Kullanıcı hangi planı seçtiğini ayırt edemez; ekran okuyucu da aynı iki seçeneği
okur. Run tablosunda plan adı + sürüm de iki planı ayırmaya yetmez.

**Öneri:** Seçenek etiketine kısa plan kimliği, oluşturulma tarihi veya yayımlanmış sürüm
bilgisi ekle; gerekirse plan adı + `planId` kısaltması kullan.

### 7. [Düşük] Geçersiz URL filtreleri sessizce yok sayılıyor, URL kirli kalıyor

- Dosya: `apps/web/src/app/features/runs/run-history-page.ts:311-367`
- Sözleşme: P5-02 “filtreler URL'de kalır”; P5-01 API doğrulaması.

**Gerçek gözlem:** `/runs?status=BOGUS&page=abc&from=notadate` açıldığında istek
filtresiz `page=1` olarak gitti, 20 satır gösterildi; adres çubuğunda hâlâ
`status=BOGUS&page=abc&from=notadate` yazıyordu. Form alanları boştu.

**Etki:** Kullanıcı URL'in uygulandığını sanabilir; paylaşılan bağlantı aynı yanlış
durumu tekrar üretir. API'nin katı doğrulaması UI'da devre dışı bırakılmış oluyor.

**Öneri:** URL'i kanonik hâle getir (geçersiz parametreleri kaldır) veya geçersiz filtre
için görünür bir doğrulama mesajı göster. Sessizce tüm run'lara dönmek yerine “This filter
is not valid” demek daha dürüst.

### 8. [Düşük/savunmacı] Grafik boş seri overlay'i, “çizilemeyen ama kaydedilmiş” örneği yok sayıyor

- Dosya: `apps/web/src/app/shared/charts/measurement-chart.ts:76-78`,
  `apps/web/src/app/shared/charts/measurement-chart.html:34-38`

**Gözlem:** `hasPoints` yalnızca sayıya çevrilebilen noktalara bakıyor. Ölçüm dizisi dolu
ama değeri sayıya çevrilemiyorsa overlay “No samples were recorded for this step.” diyor;
gizli özet ise “1 recorded sample has a value that could not be plotted” diyerek doğru
bilgi veriyor. API'nin `toMeasurementDto` çıktısı Decimal'i altı ondalık metne çevirdiği
için bu durum normal API verisiyle oluşmaz; yalnız bozuk/legacy veri veya test double'ı
ile görülebilir.

**Etki:** Normal üründe erişilemez; yine de savunmacı hata metni veri varken “hiç örnek
yok” diyerek çelişiyor.

**Öneri:** Overlay koşulunu `step.measurements.length === 0` yap; çizilemeyen örnek varsa
“Some recorded values could not be plotted; see the table” metnini kullan.

### Kanıt/tekrarlanabilirlik notu (ürün hatası değil)

- `scripts/phase-5-chart-check.mjs` commit'te ve gerçek Chrome/CDP ile çalışıyor; ancak
  P5-06 kanıtındaki `RUN_VERSION_ID=ad607662-…` yerel demo veritabanına özgüdür. Temiz
  seed'de bu UUID yoktur; inceleyen kişinin önce yayımlanmış bir sürüm oluşturup ID'sini
  vermesi gerekir. Betik bu durumda açık hata verir.
- Betik kendi oluşturduğu run'ı silmiyor. Bu incelemede oluşturulan run'lar ve geçici plan
  ayrıca temizlendi; tekrar kullanımda demo geçmişi kirlenir.
- Betik Playwright değildir ve `npm run verify`/CI içinde değildir. `docs/frontend.md`
  “Playwright ve görsel inceleme” diyor; P5-06 bunu CDP + ekran görüntüsü + opt-in debug
  hook ile karşılıyor. Gerçek hover/tıklama/zoom kanıtı geçerli, ancak CI'da otomatik
  değil. Playwright paketi P7-01 kapsamında planlanmıştır.
- Tooltip metni OCR ile değil, uygulamanın opt-in tipli debug kaydıyla okundu; kanıt
  dosyası bunu açıkça söylüyor ve ekran görüntüsü tooltip'i görsel olarak doğruluyor.

## Doğrulanan davranışlar ve gerçek komutlar

Tüm komutlar `f099534` commit'inin temiz kopyasında (`/tmp/probedesk-p5-commit`)
çalıştırıldı; `node_modules` `npx npm@11.6.2 ci` ile kuruldu.

### Derleme ve testler

```text
$ npm run verify
lint: 0 warning / 0 error (api 130 dosya, web 98 dosya, api-client 2 dosya)
typecheck: exit 0
test:api:unit: 16 dosya, 118 test geçti
test:web: 32 dosya, 319 test geçti
build: api + web başarılı
openapi:check: OpenAPI contract is current
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  18 passed (18)
Tests       173 passed (173)
Duration    21.21s

$ npm run openapi:check
OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
```

### Gerçek canvas / canlı grafik

```text
$ WEB_DIST=/tmp/probedesk-p5-commit/apps/web/dist/web \
  RUN_VERSION_ID=ad607662-1e62-4a0e-acab-472a87bd8343 \
  node scripts/phase-5-chart-check.mjs
```

Sonuç (run `749b4418-0e53-4945-9b0f-50b27b0bd466`, FORCED_FAILURE, seed 15; inceleme
sonunda silindi):

- API `recordedSampleCount=90`, final grafikler `[30, 30, 30]`, tam tablo satırları
  `[30, 30, 30]`, toplam `90`.
- Gerçek hover tooltip'i: `Sample 14 · Current Draw`, `Value: 0.600000 A`,
  `Elapsed: 3,239 ms`, `Recorded (UTC): 3 Nov 2026, 22:05:44 UTC`,
  `Result: Outside tolerance`.
- Failing noktaya gerçek tıklama: `measurement-row-419be6ff-…-14`, `is-selected=true`,
  `aria-current="true"`, odak doğru satırda.
- Zoom: X `0–7000` → `331.88–6631.88`, görünür 29 örnek; toplam örnek 30 değişmedi.
- Pan: X aralığı değişti; toplam örnek 30 kaldı.
- Reset view: `zoomed=false`, X tekrar `0–7000`; toplam örnek 30 kaldı.
- Terminal sonrası 1.2 s: grafik sayıları `[30,30,30]` değişmedi; `EventSource.readyState=2`.
- Route ayrılışı: eski 3 canvas `isConnected=false`; route dönüşünde snapshot yeniden
  yüklendi, 3 grafik yeniden kuruldu; `Runtime.exceptionThrown=0`.

### History API (gerçek demo DB, 36 run)

```text
# Oturum cookie'si + CSRF ile çalışan geçici Node fetch probe'u (repo dışında).
# Aşağıdaki satırlar gerçek yanıtların alanlarıdır; her istek tek tek çalıştırıldı.
GET /api/runs?limit=3 -> 200, total=36, totalPages=12,
  startedAt DESC, id DESC; ilk satır 0e870806…, 90/90, 1 ihlal,
  firstFailure={stepPosition:3, stepName:"Current Draw", sampleIndex:14}
GET /api/runs?limit=100&status=COMPLETED -> 200, 29 kayıt
GET /api/runs?limit=100&outcome=FAILED -> 200, 4 kayıt
GET /api/runs?limit=2&page=999 -> 200, total=36, totalPages=18, items=[]
GET /api/runs?from=2026-11-03&to=2026-11-04 -> 200, 36 kayıt
GET /api/runs?to=2026-11-03T18:51:23.580Z&status=CANCELLED -> 200, 0 kayıt
  (tam `to` sınırındaki run hariç; [from,to) doğrulandı)
GET /api/runs?limit=101 / 0 / 1.5 -> 400 VALIDATION_ERROR
GET /api/runs?page=0 -> 400 VALIDATION_ERROR
GET /api/runs?status=NOPE / outcome=none / planId=nope / wat=1 -> 400
GET /api/runs?from=2026-11-03T00:00:00 -> 400 (timezone zorunlu)
GET /api/runs?from=2026-11-03 -> 200 (date-only UTC kabul)
Planner/Operator/Viewer -> 200; oturumsuz -> 401 UNAUTHENTICATED
```

Ek olarak `INTERRUPTED` 5/90 ve `CANCELLED` 0/90 snapshot'larında
her adımın `statistics` alanı `{minimum:null,maximum:null,average:null,sampleCount:null}`
ve `measurements:[]` döndü; Details bunları “Not available” gösterdi, sıfıra çevirmedi.

### Gerçek History UI

```text
GET /runs                         -> 20 satır, “Showing 1-20 of 39 runs” (geçici run'lar dahil; temizlik sonrası 36)
?outcome=FAILED                   -> 6 satır (geçici run'larla; temizlik sonrası 4), URL ve form senkron
?status=COMPLETED                 -> 32 kayıt, 2 sayfa (geçici run'larla; temizlik sonrası 29)
?status=COMPLETED&page=2          -> 12 satır, “Page 2 of 2” (geçici run'larla; temizlik sonrası 9)
Back                              -> ?status=COMPLETED, 20 satır, form korunuyor
Reload                            -> aynı filtre ve sayfa
?from=2026-11-01&to=2026-11-04    -> API'ye `...T00:00:00.000Z` gitti; sayfa 1'e döndü
?status=RUNNING&from=…&to=…       -> 0 satır, “No runs match these filters” + Clear
?page=999                         -> “No runs recorded yet” (tablo yok)  ← Bulgu 1
Oturum çerezi temiz + /runs       -> /login                         ← Bulgu 4
```

Details (gerçek Chrome):

- `0e870806…` FAILED: badge “Failed”, toplam ihlal 1, ilk ihlal Step 3 / sample 14 /
  `0.600000 A`, 3 grafik, 3 tablo, 90 satır.
- `56d71d45…` CANCELLED (0 örnek): badge “Cancelled”, Passed/Failed yok, 12 “Not
  available”, 0 sahte istatistik, üç boş grafik overlay'i, 0 ölçüm satırı.
- `8f0e92f8…` INTERRUPTED (5/90): badge “Interrupted”, “85 of 90 (94%) not recorded”,
  5 ölçüm satırı, ilk grafikte noktalar, diğerlerinde boş overlay.
- Tüm zamanlar tek “UTC” ekiyle gösterildi; “UTC UTC” yok.
- Tek örnek / eşit sınır (5.000000 V) run'ı: badge “Passed”, 1 nokta, `Within tolerance`,
  tooltip `Value: 5.000000 V` / `Result: Within tolerance`, failure list yok; 1 tablo
  satırı ve istatistikler 5.000000. Bu geçici plan/run inceleme sonunda silindi.

### Klavye ve pagination odağı

- Failure list düğmesi programatik olarak odaklanıp gerçek Enter tuşuyla seçildi; doğru
  satır `aria-current="true"` ve `document.activeElement.id` oldu. (İlk CDP denemesinde Enter'a `text:"\r"` verilmediği
  için click oluşmadı; doğru gerçek tuş olayıyla geçti.)
- “Next page” tıklandıktan sonra `document.activeElement` `MAIN#main-content` oldu;
  tablo/başlık odaklanmadı (Bulgu 5).

### Indeks / EXPLAIN

```text
$ docker exec probedesk-postgres psql ... EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id FROM test_runs ORDER BY "startedAt" DESC, id DESC LIMIT 20;
Limit
  -> Sort  Sort Key: "startedAt" DESC, id DESC
       -> Seq Scan on test_runs
```

`test_runs (planId, startedAt, id)`, `(status)`, `(planRevisionId)` indeksleri mevcut;
`startedAt` ile başlayan global indeks yok (Bulgu 3). Küçük tabloda plan filtresi de Seq
Scan seçti; `enable_seqscan=off` ile plan indeksinin kullanılabilir olduğu görüldü.

## Temizlik

- İnceleme için oluşturulan iki Chart.js doğrulama run'ı, tek örnek/eşit sınır run'ı ve
  CANCELLED/1-1 fixture'ı; bunlara ait `measurements`, `run_events`, `run_steps`,
  `test_runs` satırları silindi.
- Geçici plan (`698de792-…`), plan revision ve step identity satırları, published
  immutable trigger'ları kontrollü biçimde devre dışı bırakılıp yeniden etkinleştirilerek
  silindi.
- Son durum: `test_runs=36`, `test_plans=2` (inceleme öncesi demo verisi).
- İnceleme için başlatılan Chrome ve `app-server` süreçleri kapatıldı; ürün API/DB
  süreçlerine dokunulmadı.

## Doğrulanmayan sınırlar

- Yalnız Chrome headless (1280/1440 px) kullanıldı; Safari, Firefox ve mobil genişlikler
  denenmedi. Tam ekran okuyucu turu ve yalnız klavye ile tüm akış yapılmadı (bir failure
  seçimi ve Enter doğrulandı).
- Gerçek canvas kontrolü Playwright/CI değil, manuel CDP betiğidir; `RUN_VERSION_ID`
  gerektirir ve kendi run'ını temizlemez.
- Büyük veri hacminde history latency'si ölçülmedi; indeks bulgusu EXPLAIN ve şema
  incelemesine dayanıyor, üretim ölçeğinde ayrıca doğrulanmalı.
- Canlı grafikte zoom yapıldıktan sonra yeni SSE örnekleri gelirken görünümün korunup
  korunmadığı ayrıca test edilmedi; zoom/pan/reset terminal veri üzerinde doğrulandı.
- Birden fazla hata adımı olan gerçek tarayıcı senaryosu ve 403 durumu denenmedi; bunlar
  API/component testlerinde kapsanıyor.

Bu belge bağımsız teknik incelemedir; P5 görevleri `In Review` kalmalıdır. Ürün kabulü,
demo kabulü veya `Accepted` statüsü bu incelemeyle verilmez.
