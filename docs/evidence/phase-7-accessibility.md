# Faz 7 — Erişilebilirlik ve hata deneyimi kanıtı (P7-04)

- Tarih: 2026-11-04
- Durum: **P7-04 In Review** (kabul değil; bağımsız inceleme bekliyor)
- Başlangıç commit'i: `f40779c` (`fix(api): enforce origin on authenticated mutations and add security race tests`)
- Kapsam: `apps/web/` ekranları, P5 incelemesindeki dört düşük bulgu, klavye/odak,
  1280/768 px yerleşim, API/ağ hatası ve oturum bitişi.
- Ortam: macOS arm64, Node.js 22.23.2, npm 11.6.2, gerçek Chrome (Playwright
  `channel: 'chrome'`, headless), Angular dev server `http://127.0.0.1:4200`,
  gerçek API `http://127.0.0.1:3100` ve yerel demo PostgreSQL (`127.0.0.1:5434`).

Bu belge ürün kabulü değildir. Kart `In Review` durumundadır; `Accepted` için ayrı
teknik inceleme ve lead commit'i gerekir.

## Sonuç özeti

| Alan | Sonuç |
|---|---|
| P5 düşük bulguları | Dördü de kapatıldı; gerçek 401 dahil tarayıcıda doğrulandı. |
| Klavye | Plan adımı sıralama, grafik hata listesi, History sayfalama, Compare seri aç/kapat, Publish/Cancel/Discard dialogları odak + Escape ile geçti. |
| 1280 px | Plans, History, Details, Compare, Live sayfalarında sayfa seviyesinde yatay taşma yok. |
| 768 px | Aynı beş sayfada sayfa seviyesinde yatay taşma yok; History tablosu odaklanabilir yatay kaydırma bölgesi, Details/Live ölçüm tabloları sığıyor. |
| Form hataları | Plan adı, adım adı, seed ve probability hataları görünür metin + `aria-describedby`. |
| Hata UX | Plan kaydetme ve Start Run 503/network yollarında girdi korunuyor, mesaj + `requestId`, odaklanan panel; başarı/terminal durum iddiası yok. |
| Tarayıcı hataları | `pageerror` sayısı **0**. |

## Düzeltilen P5 bulguları

### 1. Gerçek History 401'i

- `auth.interceptor.ts` artık korumalı bir 401'de `/login?returnUrl=...&reason=session-expired`
  adresine yönlendiriyor.
- Login sayfası "Your session ended. Sign in again to return to the page you were
  viewing. Its address and filters were kept." bildirimini gösteriyor ve başlığa odaklanıyor.
- Gerçek tarayıcı: `/runs` üzerinde çerezler temizlenip "Next page" istendiğinde
  `location.pathname + search` = `/login?returnUrl=%2Fruns%3Fpage%3D2&reason=session-expired`.
  `returnUrl=/runs?page=2`, `reason=session-expired`, aktif odak `login-heading`.
  Yeniden girişten sonra `/runs?page=2`, "Page 2 of 2", 16 satır geri geldi.
- History'nin kendi 401 paneli, interceptor'ın yönlendirmediği (oturum zaten
  anonymous işaretlenmiş) yarış durumu için fallback olarak bırakıldı; normal ürün
  yolunda artık görünmüyor.

### 2. Sayfa değişiminde odak

- `goToPage` yükleme tamamlandıktan sonra `H2#history-results-heading` odaklıyor.
- Gerçek tarayıcı: `Next page` düğmesi klavyeyle Enter ile etkinleştirildi; yeni sayfa
  yüklendikten sonra `document.activeElement` = `H2#history-results-heading`,
  metin "Recorded runs"; canlı aralık "Showing 21-36 of 36 runs", sayfa "Page 2 of 2".

### 3. Aynı adlı planlar

- Filtre seçenekleri: `Power Supply Validation — version 2 (plan 8b04c2c1)` ve
  `Power Supply Validation — version 2 (plan b003020c)`.
- History satırındaki plan alt satırı da eşleşen kısa plan kimliğini taşıyor;
  aynı ad + aynı sürüm artık ayırt edilebilir.
- Compare seçenekleri sürüm, plan kısa kimliği ve UTC başlangıç zamanını birlikte
  gösteriyor.

### 4. Geçersiz URL filtreleri

- `/runs?status=BOGUS&page=abc&from=notadate` açıldığında görünür `role="alert"`
  uyarısı çıkıyor: "The address contains filter values that cannot be used, so
  they were ignored: Status \"BOGUS\", From date \"notadate\", Page \"abc\".".
- Form alanları boş, geçerli sayfa 1; "Remove invalid filters" yalnız geçersizleri
  kaldırıyor, geçerli filtreleri koruyor. Sessizce tüm run'lara dönme yok.

## Klavye ve odak

Tümü gerçek Chrome'da, fare kullanılmadan (programatik odak + gerçek `Enter`/`Escape`)
çalıştırıldı.

| Akış | Gerçek sonuç |
|---|---|
| Plan adımı sıralama | İlk adım "Move down" düğmesiyle 2. sıraya taşındı; duyuru "Step moved to position 2 of 3."; odak `step-heading-loaded-d3e4be73-…` üzerinde; önizleme sırası `Output Voltage, Case Temperature, Current Draw` oldu. Geri alma da Enter ile yapıldı. |
| Grafik hata listesi | "Sample 14" hata düğmesi Enter ile seçildi; odak `measurement-row-580448bb-…-14`, `aria-current="true"`, 1 seçili satır; duyuru "Outside tolerance: sample 14 of step 3, Current Draw, value 0.600000 A, elapsed 3278 ms…". |
| Compare seri aç/kapat | İlk `aria-pressed="true"` düğme Enter ile `"false"` oldu; duyuru "Left series hidden. The right series is still shown; recorded data and backend results did not change." |
| Publish dialog | Açılış odağı "Keep editing"; Escape kapattı ve odak `publish-button`'a döndü; publish isteği yok. |
| Discard dialog | Açılış odağı "Keep editing"; Escape editörde kaldı, URL `/plans/8b04c2c1-…/edit`, yerel ad "Accessibility evidence - kept input" korundu. |
| Cancel dialog | Açılış odağı "Keep running"; Escape kapattı, odak `cancel-run-button`'a döndü, durum "Running" kaldı; iptal POST'u gönderilmedi. |
| Form hataları | Geçersiz kaydetmede odak `validation-summary`; plan adı `aria-describedby="plan-name-error"`, adım adı `aria-describedby="step-name-error-loaded-…"`. |
| Start Run alanları | Seed hatası `aria-describedby="start-run-seed-error"`; probability hatası `aria-describedby="start-run-error-probability-error"`. Çift referans yok. |

### Dialog notu

Cancel dialog için o anda aktif bir run yoktu. Terminal FAILED snapshot'ı yalnızca bu
sayfa yüklemesi için `status: "RUNNING"`, `outcome: null`, `finishedAt: null` olarak
servis edildi; iptal POST'u hiç gönderilmedi. Publish ve Discard dialogları gerçek
kayıt/oturum üzerinde, yan etki oluşturmadan doğrulandı.

## 1280 ve 768 px yerleşim

Her ölçümde `document.documentElement.scrollWidth` ve `body.scrollWidth` görünür
genişliği aşmadı; sayfa seviyesinde yatay taşma yok.

| Ekran | 1280 px | 768 px |
|---|---|---|
| Plans | sayfa taşması yok; 4 sütunlu plan tablosu | sayfa taşması yok; tablo 686 px kapsayıcıya sığıyor |
| History | sayfa taşması yok; tablo bölgesi 942 px, içerik 1275 px (yatay kaydırma) | tablo bölgesi 734 px, içerik 1275 px; odaklanabilir `region`, plan sütunu 170 px |
| Details | sayfa taşması yok | ölçüm tablosu 686/686 px, sığıyor |
| Compare | sayfa taşması yok | 9 tablo 684/684 px, sığıyor |
| Live | sayfa taşması yok | 3 grafik tablosu 689/689 px, son ölçümler 734/734 px; sığıyor |

History tablosu 10 sütun olduğu için 1280 px'te de yatay kaydırma gerektiriyor.
Bunun için görünür ipucu, `role="region"`, `tabindex="0"` ve odak halkası var;
klavye kullanıcısı tabloyu odaklayıp ok tuşlarıyla kaydırabiliyor. 768 px'te sağa
kaydırılmış ekran görüntüsü de kaydedildi.

Live grafik adımında grid `min-content` nedeniyle oluşan 897 px taşma, grafik
makalesine `min-width: 0` verilerek giderildi; tablolar artık kapsayıcıya sığıyor.

## Hata deneyimi

### Plan editörü

- **503:** `PUT /api/plans/:id/draft` yanıtı 503 + `requestId=req-p7-save-503`.
  Plan adı "Accessibility evidence - kept input" korundu; panelde
  "The plan service is temporarily unavailable.", request ID ve
  "Your input is still here." göründü; odak `save-error-panel`; URL editörde kaldı.
- **Network:** istek `abort`; "The server could not be reached. Check your connection
  and try again."; ad korundu; `.save-state` "Unsaved changes" (başarı iddiası yok).
- Save sırasında formda yapılan değişikliklerin kaybolmadığı ve 409 çakışmasında
  yerel girdinin korunduğu mevcut testlerde de kapsanıyor.

### Start Run

- **503:** seed `12345`, senaryo `RANDOM`, probability `0.25` korundu; panelde
  "The run service is temporarily unavailable.", "Your settings are still here.",
  request ID; odak `start-run-error-panel`; URL `/runs/new?...` değişmedi.
- **Network:** "The server could not be reached…" ve aynı korunan girdiler.
- Hiçbir durumda run başladı/terminal oldu denmedi; başarı yalnız gerçek 202 yanıtında
  Run Details'e yönlendiriyor.

### Diğer

- History 503: mevcut hata durumu + `requestId` + "Try again".
- Details refresh/cancel hataları: son snapshot korunuyor, "cancelled" denmiyor.
- 401: global login yönlendirmesi + açıklama + `returnUrl` (yukarıda).

## Ekran görüntüleri

Tümü gerçek Chrome, `docs/evidence/phase-7-accessibility-*.png`.

### Zorunlu 1280/768 çiftleri

- Plans: [1280](phase-7-accessibility-plans-1280.png), [768](phase-7-accessibility-plans-768.png)
- History: [1280](phase-7-accessibility-history-1280.png), [768](phase-7-accessibility-history-768.png)
- Details: [1280](phase-7-accessibility-details-1280.png), [768](phase-7-accessibility-details-768.png)
- Compare: [1280](phase-7-accessibility-compare-1280.png), [768](phase-7-accessibility-compare-768.png)
- Live: [1280](phase-7-accessibility-live-1280.png), [768](phase-7-accessibility-live-768.png)

### Ek kanıtlar

- [History tablosu sağa kaydırılmış (768)](phase-7-accessibility-history-table-right-768.png)
- [History geçersiz filtre uyarısı (1280)](phase-7-accessibility-history-invalid-filters-1280.png)
- [Session expired login bildirimi (768)](phase-7-accessibility-session-expired-768.png)
- [Details grafik (768)](phase-7-accessibility-details-chart-768.png)
- [Details ölçüm tablosu (768)](phase-7-accessibility-details-table-768.png)
- [Compare grafik + seri düğmeleri (768)](phase-7-accessibility-compare-chart-768.png)
- [Live grafik + tablo (768)](phase-7-accessibility-live-chart-768.png)
- [Plan editörü (1280)](phase-7-accessibility-plan-editor-1280.png), [(768)](phase-7-accessibility-plan-editor-768.png)
- [Adım sıralama sonrası odak (1280)](phase-7-accessibility-plan-editor-reordered-1280.png)
- [Form doğrulama özeti + alan hataları (768)](phase-7-accessibility-plan-editor-validation-768.png)
- [Plan kaydetme 503 paneli (1280)](phase-7-accessibility-plan-save-error-1280.png)
- [Publish dialog (1280)](phase-7-accessibility-publish-dialog-1280.png)
- [Discard dialog (1280)](phase-7-accessibility-discard-dialog-1280.png)
- [Cancel dialog (1280)](phase-7-accessibility-cancel-dialog-1280.png)
- [Start Run 503 paneli (1280)](phase-7-accessibility-start-run-error-1280.png)

## Çalıştırılan komutlar ve gerçek sonuçlar

```text
$ npm run lint --workspace apps/web
> oxlint src
Found 0 warnings and 0 errors.
Finished in 52ms on 113 files with 93 rules using 8 threads.

$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
(çıkış kodu 0)

$ npm run test --workspace apps/web
> ng test
Test Files  36 passed (36)
     Tests  370 passed (370)
  Duration  20.71s

$ npm run build --workspace apps/web
Application bundle generation complete. [9.373 seconds]
Output location: /Users/kemalselcuk/.t3/projects/probedesk/apps/web/dist/web
(uyarı yok)
```

Değişen altı spec hedefli koşu:

```text
$ npx ng test --include='src/app/core/auth/auth.interceptor.spec.ts' \
  --include='src/app/features/auth/login-page.spec.ts' \
  --include='src/app/features/runs/run-history-page.spec.ts' \
  --include='src/app/features/runs/start-run-page.spec.ts' \
  --include='src/app/features/plans/plan-editor-page.spec.ts' \
  --include='src/app/features/runs/run-details-page.spec.ts' --watch=false
Test Files  6 passed (6)
     Tests  111 passed (111)
  Duration  10.49s
```

Tarayıcı kontrolü:

```text
$ node scripts/p7-accessibility-check.mjs
...
[page-errors]
[]

[summary]
{
  "screenshots": [ ... 26 dosya ... ],
  "resultCount": 31
}

P7-04 accessibility browser check passed.
```

Betik gerçek API/DB verisini okur; plan kaydetmez, publish etmez, run başlatmaz,
run iptal etmez. Hata yanıtları Playwright route ile enjekte edilir. Cancel dialog
için yalnızca snapshot yanıtı RUNNING olarak kopyalanır; POST gönderilmez.

## Test kapsamına eklenenler

- `auth.interceptor.spec.ts`: 401 yönlendirmesinde `reason=session-expired`.
- `login-page.spec.ts`: oturum bitişi bildirimi + `returnUrl` ile geri dönüş; email
  hatasının `aria-describedby` bağlantısı.
- `run-history-page.spec.ts`: tablo `region`/`tabindex`/ipucu; aynı adlı plan
  satırında kısa plan kimliği.
- `start-run-page.spec.ts`: seed/probability hata bağlantıları; "settings are still
  here" güvencesi.
- `plan-editor-page.spec.ts`: plan/adım hata bağlantıları; 503'te girdi koruma,
  requestId ve panele odak.
- `run-details-page.spec.ts`: cancel dialog Escape ile kapanma, odak geri dönüşü,
  istek gönderilmeme.

## Bilinen sınırlar / ertelenen işler

- Yalnız Chrome 1280/768 doğrulandı. Safari, Firefox, mobil genişlikler ve tam ekran
  okuyucu turu denenmedi; destek iddia edilmiyor.
- 401 oturum bitişinde URL/filtreler korunuyor; plan editöründeki kaydedilmemiş form
  değerleri login sonrası geri yüklenmiyor. Bu, oturum güvenliği yönlendirmesinin
  bilinçli sınırıdır; ayrı taslak kurtarma özelliği değildir.
- History tablosu 1280 px'te de yatay kaydırma gerektiriyor (10 sütun). Erişilebilir
  bölge + ipucu + klavye kaydırma ile yönetiliyor; sütun sayısını azaltmak ürün
  kararı gerektirir.
- Cancel dialog gerçek çalışan bir run yerine kopya `RUNNING` snapshot'ıyla
  doğrulandı; iptal sonucu ve gerçek terminal geçişi P7-01/P7-03 kanıtlarına ve
  mevcut API testlerine dayanıyor.
- Bu belge bağımsız teknik inceleme değildir; P7-04 `In Review` kalır.
