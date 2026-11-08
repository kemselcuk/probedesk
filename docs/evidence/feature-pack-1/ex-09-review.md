# EX-09 — Bağımsız frontend kod incelemesi

- Tarih: 2026-11-08.
- İnceleyen: bağımsız review sub-agent (frontend düzenlemesi yapmadı; yalnız bu dosya yazıldı).
- İnceleme commit'i: `11ba87de93ba12820882cce4f6aa7d3f80ec8f1f` —
  `feat: add filtered analytics overview with history drilldown`.
- Branch/HEAD: `feat/analytics-reporting-devices` / `11ba87d`; inceleme başlangıcında ve sonunda
  HEAD aynı. `git show --stat 11ba87d` 22 dosya, 1651 ekleme / 18 silme gösteriyor.
- İnceleme türü: **Bağımsız frontend kod, URL durumu ve web test incelemesi.** Ürün, görsel veya
  nihai yayın kabulü değildir. EX-08 backend'inin bağımsız kabulü bu dosyanın kapsamı dışındadır.
- Kapsam: `apps/web/src/app/features/overview/**`, root/sidebar/auth fallback değişiklikleri,
  `app.routes.ts`, `app-shell`, paylaşılan chart registration yorumu ve ilgili testler.
- Sözleşme: `docs/feature-pack-1-plan.md` §4.1, §6, §8 (Overview), §11; `docs/tasks/EX-09.md`;
  `docs/evidence/feature-pack-1/ex-09.md`; `AGENTS.md`; `docs/implementation-guide.md`;
  `docs/frontend.md`, `docs/api.md`, `apps/api/openapi.json` ve generated client.

## Kısıt ve çalışma durumu

- Repository içinde yalnızca bu review dosyası yazıldı. Kaynak, generated dosyalar, task kartı,
  diğer kanıtlar ve git geçmişi değiştirilmedi. `git add`, `git commit`, `git push`, `git checkout`,
  `git reset` veya `git stash` çalıştırılmadı; subagent başlatılmadı.
- İnceleme sırasında başka bir reviewer tarafından `docs/evidence/feature-pack-1/ex-08-review.md`
  oluşturuldu ve worktree'de untracked göründü. Bu dosya bu incelemeye ait değildir; EX-08 kabulü
  olarak sayılmadı. EX-08 task kartı hâlâ **In Review**'dur.
- Bu incelemede hiçbir veritabanına bağlanılmadı, migration/seed/reset çalıştırılmadı ve test DB'si
  oluşturulmadı. `127.0.0.1:5434/probedesk`, `127.0.0.1:5432` ve mevcut reviewer DB'lerine
  dokunulmadı. Secret, URL veya kimlik bilgisi yazdırılmadı.
- Browser, gerçek canvas, responsive yerleşim, klavye turu ve %200 zoom çalıştırılmadı; bu nedenle
  bu dosyada görsel/tarayıcı kabulü iddia edilmiyor.

## İncelenen dosyalar

Yeni overview dosyaları:

- `apps/web/src/app/features/overview/analytics-api.ts`
- `apps/web/src/app/features/overview/overview-links.ts`
- `apps/web/src/app/features/overview/overview-page.ts`
- `apps/web/src/app/features/overview/overview-page.html`
- `apps/web/src/app/features/overview/overview-page.scss`
- `apps/web/src/app/features/overview/overview-trend.ts`
- `apps/web/src/app/features/overview/overview.facade.ts`
- `apps/web/src/app/features/overview/overview.spec.ts`
- `apps/web/src/app/features/overview/testing/overview-fixtures.ts`

Değişen dosyalar:

- `apps/web/src/app/app.routes.ts`
- `apps/web/src/app/core/auth/auth.guards.ts` ve `.spec.ts`
- `apps/web/src/app/core/auth/return-url.ts` ve `.spec.ts`
- `apps/web/src/app/features/auth/login-page.spec.ts`
- `apps/web/src/app/layout/app-shell/app-shell.ts` ve `app-shell.html`
- `apps/web/src/app/shared/charts/chart-js.setup.ts`
- `docs/evidence/feature-pack-1/ex-09.md`, `docs/tasks/EX-09.md`, `docs/tasks/README.md`,
  `docs/roadmap.md`

Sözleşme/entegrasyon için read-only okunanlar:

- `apps/api/openapi.json` — `AnalyticsOverviewDto`, filtre/summary/trend/top-step şemaları.
- `packages/api-client/src/schema.ts` — `AnalyticsController_overview` ve generated DTO tipleri.
- `apps/api/src/analytics/analytics.service.ts` ve `analytics-query.ts` — response echo, günlük
  trend tamlığı, decimal formatları.
- `apps/web/src/app/features/plans/plans.facade.ts` ve `plans-api.ts` — plan/version listeleri.
- `apps/web/src/app/features/devices/device-picker.ts`, `device-picker.facade.ts`,
  `devices.facade.ts` — cihaz filtresi ve seçili cihaz doğrulaması.
- `apps/web/src/app/features/runs/run-history-page.ts` — history filtreleri ve exact `from`/`to`
  davranışı.
- `apps/web/src/app/shared/ui/iso-date-adapter.ts`, `_primitives.scss`, `_tokens.scss` —
  datepicker ve tablo/odak stilleri.

## Gerçekten çalıştırılan komutlar ve sonuçlar

Aşağıdakiler bu inceleme sırasında gerçekten çalıştırıldı; hiçbiri çalıştırılmamış gibi
gösterilmedi.

```text
npx ng test --include src/app/features/overview/overview.spec.ts --watch=false
→ 1 dosya / 19 test geçti, 798 ms, exit 0

npx ng test --include src/app/features/auth/login-page.spec.ts \
  --include src/app/core/auth/auth.guards.spec.ts \
  --include src/app/core/auth/return-url.spec.ts --watch=false
→ 3 dosya / 28 test geçti, 1.70 s, exit 0

npm run test:web
→ 43 dosya / 454 test geçti, 6.82 s, exit 0

npm run lint --workspace apps/web
→ 144 dosyada 0 warning / 0 error, exit 0

npm run typecheck --workspace apps/web
→ exit 0

git diff --check f51cb35..11ba87d
→ çıktı yok, exit 0

git status --short
→ inceleme başlangıcında boş; inceleme sırasında yalnız başka bir reviewer'ın
  `docs/evidence/feature-pack-1/ex-08-review.md` untracked dosyası göründü
```

Ayrıca Angular `FormControl.setValue` davranışını doğrulamak için Node ile küçük bir read-only
kontrol yapıldı:

```text
FormControl('') → dirty=false, pristine=true
setValue('x')   → dirty=false, pristine=true
```

Bu sonuç O-4 bulgusunun dayanağıdır; uygulama testi veya browser testi değildir.

## Devralınan ve çalıştırılmayan kontroller

- Lead'in `npm run build --workspace apps/web` exit 0, initial 353.19 kB ve lazy Overview
  32.13 kB kaydı **devralındı**; build `apps/web/dist`/generated çıktı yazacağı için bu incelemede
  yeniden çalıştırılmadı.
- `npm run openapi:check` yeniden çalıştırılmadı; OpenAPI/client dosyaları bu commit'te
  değişmediği için read-only şema okuması ve typecheck yeterli görüldü.
- API unit/integration, guarded migration, `npm run verify`, E2E, CI ve delivery/localhost:8080
  bu incelemede çalıştırılmadı. EX-08 backend'inin gerçek DB/HTTP kabulü ayrı review'un işidir.
- Gerçek Chart.js canvas'ı, 1440/1280/768/390 px yerleşimi, klavye turu, %200 zoom ve production
  browser smoke çalıştırılmadı. `overview.spec.ts` chart factory sınırını kullanır; gerçek canvas
  kanıtı değildir. Bu kontroller EX-12 kapısına aittir.

## Kabul ölçütleri değerlendirmesi

| Ölçüt | Sonuç | Kanıt / not |
| --- | --- | --- |
| Sidebar/root route; URL filtreleri ve datepicker, refresh/asOf | **Kod düzeyinde karşılandı** | `/` → `overview`, Overview sidebar/brand girişi, lazy route ve auth fallback güncel (`app.routes.ts`, `app-shell.ts/html`, `auth.guards.ts`, `return-url.ts`). `overview.spec.ts` root yönlendirmesini, varsayılan 30 UTC gününü, üç rolü ve iki datepicker toggle'ını doğruluyor. Sidebar Overview/brand linki ve gerçek datepicker seçimi için ayrı etkileşim testi yok. |
| Backend KPI, trend chart/erişilebilir tablo, top steps ve doğru history drilldown | **Kod düzeyinde karşılandı** | KPI'lar backend string'leriyle gösteriliyor; null oran/süre `—` ve açıklamayla; trend tablosu günlük tam sayıları ve linkleri taşıyor; top adım linki plan/version + COMPLETED/FAILED kullanıyor ve `logicalStepId` filtresi icat etmiyor (`overview-links.ts`, `overview-page.html:294-362`). Testler üç rolü, null/empty durumunu, top linki ve `logicalStepId` yokluğunu kontrol ediyor. Gerçek Chart.js canvas'ı doğrulanmadı. |
| Responsive/keyboard/null/error ve eski response/chart cleanup | **Kısmen / açık** | Null/empty, HTTP 500 + retry, switchMap iptali, `clear()` ve chart update/destroy testleri var; responsive, klavye ve %200 zoom yok. Task kartındaki üçüncü ölçüt bu nedenle açık kalmalı. |

## Bulgular

### O-1 — Orta — KPI kartlarının erişilebilir adı değerleri ve görünen etiketi dışlıyor

**Konum:** `apps/web/src/app/features/overview/overview-page.html:173-218` (özellikle 177, 185,
200, 208).

**Durum:** Dört KPI bağlantısının her birinde `aria-label` var. `aria-label`, anchor'ın içindeki
görünür metnin ve sayının erişilebilir adını ezer. Örneğin kart görsel olarak "Total runs 5 · All
recorded states" gösterirken erişilebilir ad yalnız "View all runs in this selection" olur.
"Pass rate 75.00%", "Failed runs 1" ve average duration değerleri de aynı nedenle bağlantının
erişilebilir adında yer almaz. Ayrıca görünen etiketler ("Total runs", "Pass rate", "Failed runs")
`aria-label` içinde birebir geçmediği için WCAG 2.5.3 Label in Name açısından da sorun vardır.
Ekran okuyucu ile Tab üzerinden KPI'lara gelen kullanıcı sayıyı duymaz; günlük tablo pass rate ve
average duration özetini doğrudan sağlamaz. Mevcut test yalnız `.kpi` sayısını ve bir linkin
`outcome=FAILED` içerdiğini kontrol ediyor (`overview.spec.ts:148-170`), erişilebilir adı değil.

**Etki:** Orta (erişilebilirlik). Görsel kullanıcı KPI değerlerini görür; ekran okuyucu kullanıcısı
özet KPI değerlerini kaçırabilir. Teknik veri doğruluğu bozulmaz.

**Öneri:** `aria-label` kaldırılıp görünür metin doğal erişilebilir ad olarak bırakılabilir; eylem
ipucu gerekiyorsa `span class="visually-hidden"` ile metin sonuna eklenebilir. Alternatif olarak
`aria-label` görünen etiket + değer + eylemi içerecek şekilde interpolate edilmeli ve testte
erişilebilir adın değeri içerdiği assert edilmelidir.

### O-2 — Düşük — Device filtresi kapalı disclosure'da; uygulanan cihaz ve 404 durumu görünmüyor

**Konum:** `apps/web/src/app/features/overview/overview-page.html:102-111` ve `165-171`;
`apps/web/src/app/features/devices/device-picker.facade.ts:27-39`;
`apps/web/src/app/features/devices/device-picker.ts:83-90`.

**Durum:** Cihaz filtresi varsayılan kapalı `<details>` içinde. Özet metni her zaman "Filter by
device (active or archived)" ve uygulanan cihazın adı/seri numarası özette veya "Updated" satırında
görünmüyor; "Updated" yalnız `from`/`to` aralığını yazıyor. URL'de `deviceId` ile gelen kullanıcı,
sayfayı açtığında hangi cihazın filtrelendiğini görmek için disclosure'ı açmak zorunda. Daha
önemlisi, bilinmeyen bir cihaz UUID'si analytics'te sözleşme gereği boş sonuç üretirken
`DevicePicker` ayrıca `GET /devices/:id` 404'ü alıp `role="alert"` + "Retry device" gösteriyor;
bu alert kapalı disclosure içinde olduğu için dışarıdan görünmüyor. Kullanıcı yalnız "No runs in
this selection" görür, nedenini göremez.

**Etki:** Düşük; analytics sonucu doğru (bilinmeyen filtre boş sonuç), ancak URL kaynaklı cihaz
filtresinin görünürlüğü ve hata açıklaması zayıf.

**Öneri:** Disclosure özetine seçili cihazın adı/seri numarası veya "Unknown device filter"
yazılsın; uygulanan filtre özeti `from`/`to` yanında plan/version/scenario/device/batch için de
gösterilsin. Filter mode'da 404'ü genel hata alert'i yerine "Unknown device filter" olarak
işaretleyip temizleme yolu sunun. URL'de geçerli, arşivli ve bilinmeyen cihaz için test ekleyin.

### O-3 — Düşük — Günlük tabloda null pass rate açıklamasız gösteriliyor

**Konum:** `apps/web/src/app/features/overview/overview-page.html:279`; bölüm notu `235-237`.

**Durum:** Günlük tabloda `passRatePercent === null` olan hücre yalnız `—` gösteriyor. Sözleşme
null oran/sürenin `—` **ve açıklamayla** gösterilmesini istiyor; KPI kartında "No completed results"
açıklaması var, ancak günlük satırlarda yok. Satırda `Completed 0` görünse de ekran okuyucu "Pass
rate —" duyduğunda bunun "completed run yok" anlamına geldiğini bilemez.

**Etki:** Düşük; veri doğru, açıklama eksik.

**Öneri:** Null hücreye `aria-label`/görünmez metin ("No completed runs") veya tablo altında
"Pass rate — means no completed runs that day" notu ekleyin. Top tablosundaki null failure rate
backend'de pratikte oluşmuyorsa aynı kural opsiyonel tutulabilir.

### O-4 — Düşük — Device seçimi formu dirty yapmıyor; Apply uyarısı çıkmıyor

**Konum:** `apps/web/src/app/features/overview/overview-page.html:105-109` ve `120-122`;
`apps/web/src/app/features/overview/overview-page.ts:144-150`.

**Durum:** DevicePicker seçimi `form.controls.deviceId.setValue($event)` ile programa bağlı
olarak yazılıyor. Angular `FormControl.setValue` programatik çağrısı kontrolü dirty yapmaz;
Node kontrolünde başlangıç ve `setValue` sonrası `dirty=false` görüldü. Bu nedenle yalnız cihaz
değiştirildiğinde "Apply filters to update the overview" durum mesajı çıkmaz; kullanıcı seçimin
henüz uygulanmadığını diğer kontrol türlerine göre daha az fark eder. Apply düğmesi görünür olduğu
için veri yanlış uygulanmaz, ancak açık Apply akışıyla tutarsızdır.

**Etki:** Düşük; UX/tutarlılık.

**Öneri:** DevicePicker handler'ında `setValue` sonrası `markAsDirty()` çağırın veya form control
değişimini işaretleyen tek bir metot kullanın; cihaz seçimi + Apply ve cihaz seçimi + Refresh
senaryolarını test edin.

### I-1 — Bilgi — Login spec'inde biçim tutarsızlığı

**Konum:** `apps/web/src/app/features/auth/login-page.spec.ts:301-302`.

**Durum:** `const analytics=http.expectOne(...)` ve uzun `flush(...)` satırı çevresindeki
biçimlendirmeyle uyumlu değil. Davranış veya test sonucu etkilenmiyor; depo genelindeki stil
tutarlılığı için düzeltilmesi önerilir. Bu incelemede Prettier çalıştırılmadı; bir format hatası
iddiası değil, gözlemlenen stil farkıdır.

## Test kapsamı ve doğrulanmamış davranışlar

Mevcut 19 overview testi şunları gerçekten kapsıyor: backend decimal string'lerinin korunması,
dört malformed response türü, switchMap/eski istek iptali, `clear()` sonrası temizlik, 30 UTC
günlük varsayılan, partial ilk/son gün linkleri, `logicalStepId` yokluğu, üç rol, null/empty,
root explicit tarih, `from >= to` ve duplicate query reddi, batch Apply sırasında tam zaman
sınırlarının korunması, HTTP 500 + retry, refresh'te chart destroy ve chart update/destroy.

Kod düzeyinde doğru görünmesine rağmen bu suite'te doğrudan test edilmeyenler:

- Plan/version/device URL filtrelerinin forma ve analytics isteğine round-trip'i; plan değişince
  version seçiminin temizlenmesi; arşivli/bilinmeyen cihaz filtresi.
- Takvimden gerçek tarih seçimi ve değiştirilen sınırın UTC midnight'a dönüşmesi; yalnız batch
  Apply'da exact sınır korunması test ediliyor.
- Bilinmeyen query parametresi ve 366 günden uzun aralığın analytics isteği üretmemesi; mevcut
  testler yalnız `from >= to` ve duplicate senaryolarını kapsıyor.
- Sidebar'daki Overview linki ve ProbeDesk brand linkinin `/overview` hedefi.
- KPI kartlarının erişilebilir adı ve değerleri; günlük tablodaki null pass rate açıklaması.
- Gerçek chart canvas'ı, responsive 1440/1280/768/390, klavye turu ve %200 zoom.

Bu boşluklar kodun yanlış olduğunu kanıtlamaz; ancak EX-09 kanıtındaki "datepickers", plan/version
ve device filtreleri ile responsive/klavye iddialarının bir kısmı yalnız kod okumasına veya
EX-12'ye dayanır. EX-12 ve gerekli hedefli testler tamamlanmadan üçüncü kabul ölçütü kapanmaz.

## Bağımlılık ve kabul kapıları

- **EX-08 In Review:** EX-09 kartının bağımlılığı henüz Accepted değil. İnceleme sırasında başka
  bir reviewer'ın `ex-08-review.md` dosyası oluştu; bu, EX-08 task kartının kabul edildiği anlamına
  gelmez. EX-08 bağımsız kabulü lead tarafından kaydedilmeden EX-09 final kabulü koşulludur.
- **EX-12:** Gerçek browser/canvas, responsive 390 dahil dört genişlik, klavye ve %200 zoom
  doğrulaması yapılmadı; factory tabanlı chart testi gerçek canvas kanıtı değildir. Üçüncü kabul
  ölçütü açık kalmalıdır.
- **Build:** Lead'in web build exit 0 ve lazy chunk boyutları devralındı; bu incelemede build
  yeniden çalıştırılmadı. Typecheck ve lint gerçekten çalıştırıldı ve geçti.
- **Ürün/görsel kabul:** Kullanıcıya aittir; bu dosya ürün, görsel, nihai yayın veya delivery
  kabulü vermez.

## Sonuç ve kabul önerisi

- **Kritik: 0. Yüksek: 0. Orta: 1 (O-1). Düşük: 3 (O-2, O-3, O-4).** I-1 yalnız biçim notudur.
- EX-09'un ana akışı kod düzeyinde sözleşmeye uyuyor: root/sidebar/auth fallback, URL kaynaklı
  UTC aralığı ve varsayılan 30 gün, plan/version/scenario/device/batch filtreleri, typed form,
  strict runtime response parser, backend KPI/decimal gösterimi, null/empty/error, switchMap
  iptali, chart teardown ve partial gün history linkleri doğru görünüyor. Gerçek web suite
  43/454, lint 144/0, typecheck exit 0 ve diffcheck exit 0 ile desteklendi.
- **Teknik kabul önerisi: koşullu olumlu.** Koşullar:
  1. **O-1** düzeltilmeli veya erişilebilirlik riski açıkça kabul edilmeli; KPI değerleri
     ekran okuyucu erişilebilir adında yer almalı ve görünen etiketle uyumlu olmalı.
  2. O-2/O-3/O-4 için en az cihaz filtresi görünürlüğü, null açıklaması ve dirty/Apply tutarlılığı
     düzeltilmeli veya düşük risk olarak kaydedilmeli; ilgili URL/form testleri eklenmeli.
  3. **EX-08 bağımsız kabulü** lead tarafından tamamlanmalı (kart bağımlılığı).
  4. **EX-12** gerçek browser/canvas, responsive 390 dahil, klavye ve %200 zoom kontrollerini
     tamamlamalı; üçüncü kabul ölçütü o zaman kapanabilir.
- Bu inceleme kart durumunu değiştirmedi; EX-09 **In Review** kalır. `Accepted` kararı lead'in ayrı
  işlemidir ve yukarıdaki koşullar kapanmadan verilmemelidir. Ürün/görsel kabul kullanıcıya aittir.
