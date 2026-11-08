# EX-12 — Bağımsız nihai inceleme (E2E, altyapı ve browser)

- Tarih: 2026-11-08
- Branch/HEAD: `feat/analytics-reporting-devices` @ `49ec0b0c5b9c12be044698f4af3c2cac0e67e367`
  (incelenen baseline). İnceleme sırasında concurrent upgrade (`bb75371`) ve delivery
  (`2393402`) commit'leri eklendi; bunlar bu incelemenin kapsamı dışındadır.
- İnceleme kapsamı: `3d5495c` (izolasyon/baseline düzeltmeleri), `89cd3a5` (AppShell),
  `b79090a` (`feature-pack-1.spec.ts`), `49ec0b0` (CI tetikleyicisi); EX-12 kartı ve
  [altyapı review](ex-12-infrastructure-review.md); gerçek GitHub CI koşusu.
- Yöntem: Kaynak/sözleşme incelemesi + yalnız gerekli dar kontroller. Tam API/web/integration
  suite'leri, gerçek browser E2E ve altı sayfalık PDF görsel incelemesi yeniden çalıştırılmadı.
- Kısıt: Yalnız bu dosya ve [EX-13 CI kaydı](ex-13-ci.md) yazıldı. Git yazma komutları
  (`add`, `commit`, `push`, `checkout`, `reset`, `stash`) çalıştırılmadı; üretim kodu, görev
  kartı durumu veya başka worker dosyası değiştirilmedi. Concurrent upgrade ve edge çalışmaları
  kapsam dışıdır.

## Sonuç

| Alan                   | Sonuç                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Kritik / Yüksek bulgu  | **Yok** (incelenen baseline için)                                                                          |
| Orta bulgu             | **2:** CI E2E paket akışı timeout'u; `main-demo` giriş başlığı hatası                                      |
| Düşük bulgu            | **1:** CI son baseline adımı Playwright hatasında atlanıyor                                                |
| Altyapı O-1/O-2/O-3    | **Kapandı.** Kod incelemesi + kendi izole DB'mde gerçek PG koşusuyla doğrulandı                            |
| O-4/O-5/O-6            | **Düzeltildi (kod/negatif destek testleri).** O-4 ve O-5 tam suite'te yeniden koşulmadı                    |
| AppShell `89cd3a5`     | **Doğru; hedefli 9/9 geçti.** CI E2E hatasının nedeni değildir                                             |
| Browser spec `b79090a` | Gerçek UI/API/DB ve canvas/blob kontrolleri güçlü; ancak rapor responsive/print geçişi ve 7/7 kanıtı eksik |
| Teknik kabul           | **EX-12 bu haliyle kabul edilmemeli; EX-13 de kapanmamalı**                                                |

Bu kayıt EX-12 kartını `In Progress`, EX-13 kartını `Planned` bırakır; durum değişikliği
lead'e aittir. Ürün/görsel kabul verilmemiştir.

## 1. Altyapı bulgularının kapanışı

### O-1 — Kapandı (fail-closed baseline)

`scripts/e2e-isolated.mjs`: baseline dosyası yoksa artık `count-only` uyarısıyla geçmiyor;
`Prepare baseline digest was not found... count-only validation is not accepted` hatası veriyor.
Dosya yolu ve karşılaştırma, guard ile aynı `parseConnection` normalizasyonunu kullanıyor
(`127.0.0.1`/`localhost`/`::1` → `localhost`).

Bağımsız kontrol (kendi `probedesk_ex12_finalreview_20261108_test` DB'm):

- `E2E_BASELINE_FILE` var olmayan yol → `assert-baseline` **exit 1**; beklenen mesaj görüldü.
- Normal baseline, `127.0.0.1` yazımı → **exit 0**; `localhost` yazımı → **exit 0**;
  `canonical fixture fingerprint matches the prepare baseline`.

### O-2 — Kapandı (Device/Copy digest karşılaştırması)

`tests/e2e/support/ex12-support.integration.ts` artık finalde
`after.devicesDigest === baseline.devicesDigest` ve
`after.planCopyRequestsDigest === baseline.planCopyRequestsDigest` karşılaştırmalarını yapıyor.
Kendi koşumda `ex12-support` **exit 0** verdi ve baseline `devices=2`, `copyRequests=0` olarak
geri döndü.

### O-3 — Kapandı (measurement/run event cleanup kapsamı)

Support fixture'ı artık gerçek `measurements` ve `run_events` satırları üretiyor; cleanup
summary'sinde ikisinin de sıfırdan büyük olduğu assert ediliyor. Kendi koşumda:

```text
tracked cleanup: devices=1 copyRequests=1 runs=1 runSteps=3 measurements=6 runEvents=1
```

`expectCleanupFailure` artık beklenen hata mesajını (`shared demo device`, `shared demo plan`,
`Ambiguous device cleanup name`, `ex12 support forced cleanup failure`) doğruluyor.

### O-4/O-5/O-6

- **O-4:** Plan-copy fingerprint source run'ı gerçek cihaz snapshot'ı ve batch/key ile başlatılıyor;
  test cihazı `deletePlanCopyTestData` içinde run'lardan sonra siliniyor. Kod incelemesi doğru;
  hedefli plan-copy suite'i bu incelemede yeniden koşulmadı.
- **O-5:** Health geçici DB drop'u `app.close()` sonucundan bağımsız `try/finally` içinde;
  hatalar `AggregateError` ile korunuyor. Kod incelemesi doğru; health testi yeniden koşulmadı.
- **O-6:** Demo plan guard'ı ve ambiguous device-name reddi eklendi. Kendi support koşumda
  demo plan/device ve ambiguous-name negatif testleri geçti.

## 2. AppShell `89cd3a5`

Değişiklikler: `mat-sidenav-container` backdrop kapanışı, `mobileNavigationOpen` durumunun
medya değişiminde sıfırlanması, Escape'te odağın menü düğmesine dönmesi ve Material düğmesi için
`viewChild(..., { read: ElementRef })` düzeltmesi. `openedChange` yerine tek yönlü `[opened]`
kullanımı backdrop/Escape yollarıyla tutarlı; dialog açıkken Escape'in sidenav'ı kapatmaması
korunuyor.

Bağımsız hedefli koşu:

```text
npx npm@11.6.2 run test --workspace apps/web -- --watch=false \
  --include=src/app/layout/app-shell/app-shell.spec.ts
1 dosya / 9 test passed, exit 0
```

Bu düzeltme kendi kapısı için doğru. CI'daki rapor indirme hatası AppShell durumundan değil,
print-media/PDF sonrası gözlenen yatay kaymadan kaynaklanıyor.

## 3. Browser spec `b79090a` — sadakat ve sınırlar

Güçlü yönler:

- Planner cihaz oluşturma, published plan kopyalama, kısa taslak publish; Operator cihaz+batch
  NORMAL run; Planner rename; Viewer filtreli Overview, history drilldown, report, CSV/JSON.
- Route mock yok; veriler gerçek simulator/API/PostgreSQL yolundan geliyor.
- Chart.js canvas'ında gerçek piksel (`getImageData`) kontrolü; print için data-URL PNG decode
  ve `naturalWidth` kontrolü; CSV byte/BOM/satır/kolon ve JSON şema/ölçüm kontrolleri.
- Cleanup `afterAll` içinde; hata sonrası da çalışıyor; baseline plan/run/device/session ve
  Device/Copy digest karşılaştırması var.
- 390/768/1280/1440, yerel tablo scroll'u, takvim, dropdown kenarı ve klavye kontrolleri
  responsive testinde kapsanıyor.

Eksikler / sadakat sınırları:

- **Rapor sayfası responsive matriste yok.** 390/768/1280/1440 ve yatay taşma kontrolü
  Overview/history için var; `/runs/:id/report` için yok. CI hatası tam olarak rapor sayfasının
  print sonrası yatay kaymasında ortaya çıktı.
- Print akışı `window.print` stub'ı ve `page.pdf` ile sınırlı; OS print dialog/Save PDF ve
  PDF sayfa sayısı/kesilme kontrolü test kodunda yok. Altı A4 sayfasının görsel incelemesi
  devralınan yerel kanıttır; bu incelemede yeniden üretilmedi.
- CSS `zoom: 2` yaklaşımı native browser zoom değildir; 10k ölçüm, failed/partial print ve
  legacy CSV/JSON indirme kapsam dışıdır.
- Yerel `7/7` kaydı bu HEAD'de CI'da **5/7** olarak gerçekleşti; gerekçeleri aşağıdaki
  bulgulardadır. Yerel kayıt hangi commit/ortamla alındığını belirtmediğinden güncel kodu
  kanıtlamaz.

## 4. Orta bulgular

### F-1 — Orta / kabul engeli: CI paket E2E'si CSV indirmede timeout

`feature-pack-1.spec.ts:959` `Download CSV` tıklaması, print-media/PDF geçişinden sonra
sayfanın yatay kaydığı gözlendiği için `mat-sidenav` tarafından kesiliyor; 110 denemeden sonra
240 saniyelik test timeout'u oluşuyor. Böylece CSV/JSON indirme ve legacy rapor adımları gerçek
CI'da doğrulanmıyor. Ayrıntı ve gerçek log: [EX-13 CI kaydı](ex-13-ci.md).

Test veya ürün düzeltmesi gerekir: print dönüşünde scroll sıfırlama, rapor sayfası için
`scrollWidth == innerWidth` kontrolü ve/veya indirmeleri print'ten önce çalıştırma. Düzeltme
sonrası aynı CI E2E yeniden koşulmalıdır.

### F-2 — Orta / kabul engeli: `main-demo` giriş beklentisi yanlış

`main-demo.spec.ts:111-113` girişten sonra `/overview` URL'sini doğruluyor ama H1 olarak
**Test Plans** bekliyor. Gerçek sayfa H1'i **Overview**. Bu, `b79090a` sırasında URL güncellenip
başlık beklentisinin güncellenmemesinden kaynaklanan deterministik bir test hatasıdır. Düzeltme
olmadan "7/7 E2E geçti" kanıtı kullanılamaz.

### Düşük: CI son baseline kapısı atlanıyor

Playwright başarısız olunca `Confirm the E2E database is clean` adımı `skipped` kalıyor.
Testin `afterAll` cleanup'ı çalışmış ve sonraki testler baseline görmüş olsa da, CI'ın son
`assert-baseline` kapısı yeşil koşu olmadan doğrulanmış sayılmaz. Bu adımın hata durumunda da
çalıştırılması (uygun guard ile) değerlendirilmelidir.

## 5. Bağımsız çalıştırılan kontroller

| Kontrol                  | Komut / yöntem                                                                                                       | Gerçek sonuç                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| AppShell hedefli test    | `npx npm@11.6.2 run test --workspace apps/web -- --watch=false --include=.../app-shell.spec.ts`                      | **1 dosya / 9 test passed**, 1.66 s, exit 0                                                 |
| Helper statik kontrol    | `npx tsc --noEmit --module nodenext ... tests/e2e/support/database.ts tests/e2e/support/ex12-support.integration.ts` | exit 0                                                                                      |
| Runner sözdizimi         | `node --check scripts/e2e-isolated.mjs`                                                                              | exit 0                                                                                      |
| Kendi izole DB prepare   | Yalnız `probedesk_ex12_finalreview_20261108_test` (`127.0.0.1:5433`); guarded `db:migrate:test` + seed               | 10 migration; baseline plans1/revisions2/runs4/devices2/demoDevices2/copy0/active0; exit 0  |
| Support cleanup/baseline | `npx tsx tests/e2e/support/ex12-support.integration.ts`                                                              | exit 0; measurements=6, runEvents=1; digest/baseline eşit; demo/ambiguous negatifleri geçti |
| O-1 fail-closed          | Aynı DB; `E2E_BASELINE_FILE` var olmayan yol                                                                         | **exit 1**, `Prepare baseline digest was not found...`                                      |
| O-1 host normalizasyonu  | Aynı DB; `assert-baseline` `127.0.0.1` ve `localhost`                                                                | ikisi de **exit 0**, `canonical fixture fingerprint matches the prepare baseline`           |
| Kendi DB temizliği       | Yalnız kendi DB'sini `DROP DATABASE ... WITH (FORCE)`                                                                | önce 1 satır, sonra 0; başka DB'ye dokunulmadı                                              |
| CI koşusu                | `gh run view 42517322084` + başarısız job logu/artifact                                                              | E2E **failure**; 5 passed / 2 failed; ayrıntı EX-13 CI kaydında                             |

Operasyonel not: ilk `DROP` denemesi geçici bir tırnak hatasıyla `syntax error` verdi ve
zaman aşımına girdi; DB'ye yazmadı. Aynı hedef ayrı bir Node betiğiyle doğrulanıp düşürüldü.
Credential veya tam URL yazdırılmadı.

## 6. Devralınan, yeniden koşulmayan kanıtlar

- API unit **145**, tam integration **278**, web **496**, API/web lint, typecheck ve build
  sonuçları devralındı; hedefli AppShell **9/9** bu incelemede yeniden koşuldu.
- Yerel `node scripts/ci-e2e.mjs --workers=1` **4 dosya / 7 test passed, 59.4 s** kaydı.
  Bu kayıt CI'da **5/7** ile çeliştiği için güncel HEAD'in kabul kanıtı olarak kullanılmadı.
- Altı A4 PDF sayfasının Poppler ile görsel incelemesi (yeni rapor 2 sayfa + legacy 4 sayfa).
- Delivery 8080 smoke, gerçek seed'li DB kopya upgrade ve concurrent edge/upgrade çalışmaları
  bu incelemede çalıştırılmadı; sonuçları adına kabul iddiası yoktur.

## 7. İncelenen baseline'daki açık orta bulgular (EX-13 kapıları)

- **EX-02 M-1 — baseline'da açık:** Gerçek seed/run içeren DB kopyasının önceki migration'lardan
  yükseltilmesi bu incelemede doğrulanmadı. İnceleme sırasında eklenen concurrent `bb75371`
  upgrade kaydı ve `ex-13-upgrade.md` baseline kanıtı değildir; lead tamamlayıp ayrı kanıtla
  kapatmalıdır.
- **EX-03 L-3 — baseline'da açık:** Delivery DB locale/ASCII canonical key uyumu ve README'nin
  iki demo cihazı + yeni akışı kapsaması EX-13 kabulünde hâlâ eksik. Baseline `README.md` eski
  doğrulama sayılarını (118/370/197) ve tek cihaz profilini anıyor; iki demo cihazını anmıyor.
- **EX-01 M-6 — baseline'da açık:** `docs/implementation-guide.md` ve `README.md` güncel iş/sayı
  özetleri eski; teslim öncesi güncellenmeli.
- **EX-04 O-1 / EX-03 L-1 — izleniyor:** Prefix/batch sorgu planı ve gerçek EXPLAIN kanıtı
  bu incelemenin konusu değil; EX-08 kapanışında batch indeks testi var, prefix arama tarafı
  düşük öncelikli açık kalıyor.
- EX-05 M-1, EX-07 B4, EX-09 O-1 ve EX-11 O-1 düzeltmeleri kod üzerinde mevcut; kapanış
  kayıtları önceki review dosyalarındadır. EX-03/04/06/08/10 incelemeleri de yeniden açılmadı;
  bu incelemede bu düzeltmeler yeniden koşulmadı.

## 8. Kabul önerisi

**EX-12 teknik olarak bu haliyle `Accepted` edilmemelidir.** Kritik/yüksek kod bulgusu yoktur
ve altyapı O-1/O-2/O-3 gerçek PG'de kapanmıştır; ancak birleşik browser kabulü CI'da **5/7**'dir
ve CSV/JSON indirme/print sonrası akış doğrulanmamıştır.

Kabul için kapatılması gerekenler:

1. F-1: rapor print geçişi/scroll sorunu düzeltilmeli; rapor sayfası için yatay taşma ve
   indirme görünürlüğü testi eklenmeli; CI E2E yeniden yeşil olmalı.
2. F-2: `main-demo` giriş sonrası beklentisi Overview H1'i veya açık Test Plans navigasyonu
   olacak şekilde düzeltilmeli; tüm E2E 7/7 gerçekten geçmeli.
3. CI'da son `assert-baseline` adımı yeşil koşuda çalışmalı; hata durumunda atlanması kabul
   kanıtı bırakmamalı.
4. EX-12'nin kalan gerçek browser kapıları (native %200 zoom, OS print/Save PDF, 10k ölçüm,
   failed/partial print) ve EX-13 teslim kapıları (seed'li DB upgrade, delivery 8080, README/docs,
   EX-01 M-6, EX-03 L-3) bu baseline'da doğrulanmış değildir; concurrent upgrade/delivery
   commit'leri ayrıca incelenmelidir.
5. Kullanıcı görsel/ürün kabulü ayrıca alınmalıdır; bu kayıt onu vermez.

**EX-13 de bu koşuyla kapanmamalıdır:** CI kırmızıdır ve teslim/upgrade/delivery kanıtları
henüz doğrulanmamıştır.
