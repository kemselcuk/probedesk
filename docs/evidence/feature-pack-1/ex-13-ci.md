# EX-13 — GitHub Actions CI kanıtı (feature branch)

- Tarih: 2026-11-08
- Branch/HEAD: `feat/analytics-reporting-devices` @ `49ec0b0c5b9c12be044698f4af3c2cac0e67e367`
  (incelenen baseline). İnceleme sırasında concurrent upgrade (`bb75371`) ve delivery
  (`2393402`) commit'leri eklendi; bu inceleme ve aşağıdaki CI koşusu onları kapsamaz.
- İncelenen koşu: [CI run 42517322084](https://github.com/kemselcuk/probedesk/actions/runs/42517322084)
- Sonuç: **failure**. Dört iş `success`, Playwright E2E `failure`; `CI required` bu nedenle `failure`.
- Kapsam: yalnız gerçek CI iş/durum ve hata kök nedenleri. Bu kayıt ürün/görsel kabul veya
  `Accepted` kararı değildir.

## İş sonuçları

| İş                              | Sonuç       | Not                                                         |
| ------------------------------- | ----------- | ----------------------------------------------------------- |
| API quality                     | success     | Lint, typecheck, unit ve API build adımları geçti           |
| API integration (PostgreSQL 18) | success     | Migration + integration/process testleri geçti              |
| Web quality                     | success     | Web lint, typecheck, unit ve build adımları geçti           |
| OpenAPI contract                | success     | Emit/drift/check adımları geçti                             |
| Playwright E2E (PostgreSQL 18)  | **failure** | Adım 11 `Run Playwright against the built app` başarısız    |
| CI required                     | **failure** | E2E `failure` olduğu için birleşik kapı doğru şekilde düştü |

E2E işinin ilgili adımları:

| Adım                                             | Sonuç       |
| ------------------------------------------------ | ----------- |
| 9 — Create, migrate and seed the E2E database    | success     |
| 10 — Verify E2E cleanup and fixture preservation | success     |
| 11 — Run Playwright against the built app        | **failure** |
| 12 — Confirm the E2E database is clean           | skipped     |
| 13 — Upload Playwright failure artifacts         | success     |

Adım 10 çıktısı gerçek koşuda:

```text
[ex12-support] tracked cleanup: devices=1 copyRequests=1 runs=1 runSteps=3 measurements=6 runEvents=1
[ex12-support] unrelated device, plan and copy provenance were preserved
[ex12-support] named-device cleanup worked and the shared demo device was protected
[ex12-support] cleanup triggers restored after success, forced failure and retry
[ex12-support] restored baseline: plans=1 runs=4 devices=2 demoDevices=2 copyRequests=0 activeRuns=0
```

Bu, EX-12 altyapı düzeltmelerinin CI PostgreSQL 18 üzerinde çalıştığını gösterir. Ancak
Playwright başarısız olduğu için adım 12 (son `assert-baseline`) çalışmadı; koşu sonrası
canonical baseline kapısı CI'da doğrulanmış sayılmaz.

## E2E sonucu

`Running 7 tests using 1 worker` → **5 passed, 2 failed, 4.7m**, Playwright exit 1.

### CI-E2E F-1 — `feature-pack-1.spec.ts` 240 saniye zaman aşımı (paket akışı)

- Hata: `Test timeout of 240000ms exceeded` ve
  `page.waitForEvent: Target page, context or browser has been closed`.
- Konum: `tests/e2e/feature-pack-1.spec.ts:959` — `Download CSV` tıklamasından önce
  `waitForEvent("download")`.
- Playwright tıklama günlüğü: `Download CSV` düğmesi görünür/etkin olmasına rağmen tıklama
  110 kez yeniden denendi; `<mat-sidenav ... mat-drawer-side>` alt ağacı pointer olaylarını
  kesti. Hata anındaki artifact ekran görüntüsünde rapor içeriği yatay olarak kaymış ve sol
  kenarı sidebar'ın altında kalmıştır.
- Test bu noktaya kadar Planner cihaz/kopya/publish, Operator cihaz+batch NORMAL run, Planner
  rename, Viewer filtreli Overview/history/rapor, gerçek Chart.js canvas ve print PNG hazırlığı
  ve `run-report.pdf` üretimini geçmiştir. CSV/JSON indirme ve legacy rapor adımları
  **doğrulanmamıştır**.
- Kök neden (gözlenen): print-media/PDF geçişinden sonra rapor sayfası yatay kaydırılmış
  durumda kalıyor; sonraki indirme eylemi sidebar'ın altında kalıyor. Testte bu geçişten sonra
  scroll sıfırlama veya rapor sayfası için yatay taşma kontrolü yok. Ürün mü test mi düzeltilecek
  lead kararıdır; bu kayıt yalnız gerçek davranışı kaydeder.
- Etki: EX-12'nin "gerçek Planner→Operator→Viewer paket akışı/download" kabulü bu koşuda
  tamamlanmadı; yerel `7/7` iddiası bu HEAD için CI'da yeniden üretilemedi.

### CI-E2E F-2 — `main-demo.spec.ts` giriş sonrası yanlış başlık beklentisi

- Hata: `getByRole('heading', { name: 'Test Plans', level: 1 })` 15 saniye içinde bulunamadı.
- Konum: `tests/e2e/main-demo.spec.ts:111-113` (`login` yardımcısı).
- Gerçek durum: giriş `/overview` adresine yönleniyor ve sayfadaki H1 **Overview**. Test ise
  `/overview` URL'sini doğruladıktan sonra hâlâ **Test Plans** H1'ini bekliyor.
- Bu deterministik bir test hatasıdır; `b79090a` içindeki URL güncellemesi sırasında başlık
  beklentisi güncellenmemiştir. Testin giriş sonrası Test Plans'a geçmesi veya Overview H1'ini
  beklemesi gerekir.
- Etki: 7 testin 1'i bu nedenle düştü; "tüm E2E yeşil" kanıtı geçersizdir.

## Artifact ve yorum

- Playwright artifact'ı `playwright-e2e-1` (artifact 13632365969) başarıyla yüklendi;
  `feature-pack-1` hata ekran görüntüleri, `error-context.md`, trace ve `run-report.pdf`
  içindedir. Ham artifact bu belgeye kopyalanmadı.
- Koşu, `49ec0b0` ile eklenen feature-branch CI tetikleyicisinin çalıştığını doğrular; sorun
  workflow tetiklemesi değil, E2E test/ürün davranışıdır.
- `CI required` işinin düşmesi doğrudur; workflow gevşetilmemelidir. E2E düzeltilip yeniden
  koşulmadan EX-13 CI kapısı kapanmaz.
- Bu kayıt yalnız baseline `49ec0b0` içindir. Concurrent `bb75371` upgrade ve `2393402`
  delivery commit'leri ile `feature-pack-1-edge` çalışmaları bu incelemede değerlendirilmedi ve
  gelecekteki sonuçları adına kabul iddiası üretmez.
