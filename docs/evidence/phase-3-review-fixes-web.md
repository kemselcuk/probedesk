# Phase 3 — Frontend inceleme bulgularının düzeltme kanıtı (B1, B2, B9)

- Tarih: 2026-11-03
- Kapsam: [phase-3-review.md](phase-3-review.md) içindeki **B1 (High)**, **B2 (Medium)** ve **B9 (Low)** bulgularının `apps/web` tarafı. B6'nın yalnız bu worker'a ait doküman kısmı (`phase-3-run-summary.md` durum notu) ele alındı.
- Ortam: macOS arm64, Node.js `22.23.2`, Angular 22.2.4, ortak checkout. API kodu, `packages/`, kök dosyalar, `scripts/` ve başka worker'ın dosyaları değiştirilmedi. Kurulum ve git komutu çalıştırılmadı.
- Bu belge bir düzeltme kanıtıdır, ürün kabulü değildir. P3-09 ve P3-10 `In Review` durumunda bırakılmıştır; `Accepted` değildir.

## Kapatılan bulgular

### B1 — Başlatma, Run Again ve aktif çalışma bağlantıları gerçek çalıştırma detayına gidiyor

**Önce:** Başarılı `POST /api/runs`, Run Again ve `RUN_ALREADY_ACTIVE` bağlantıları `/runs/:runId/live` P4-04 placeholder'ına gidiyordu. Kullanıcı "This screen is not available yet" görüyor, detay/iptal/Run Again ekranına ancak URL elle değiştirilerek ulaşılabiliyordu.

**Sonra:**

- `apps/web/src/app/features/runs/start-run-page.ts`: başarılı başlatmada `router.navigate(['/runs', result.runId])`; hedef artık gerçek Run Details rotası.
- `apps/web/src/app/features/runs/run-details-page.ts`: Run Again başarısında aynı hedef; yeni çalıştırmanın detay ekranı yükleniyor.
- `start-run-page.html` ve `run-details-page.html`: `RUN_ALREADY_ACTIVE` panelindeki "Open active run" bağlantısı `/runs/:activeRunId` adresine gidiyor. `activeRunId` yoksa mevcut Run History yönlendirmesi korunuyor.
- `apps/web/src/app/features/runs/live-run-page.ts`: `/runs/:runId/live` placeholder'ı artık rota parametresinden `runId` okuyor (`toSignal(route.paramMap...)`) ve açık bir **"View run details"** bağlantısıyla `/runs/:runId` adresine gidiyor. Parametre yoksa Run History bağlantısı gösteriliyor. P4-04 canlı ekranı geldiğinde bu placeholder değiştirilebilir; detay erişimi rotaya bağlı kalmaz.
- `apps/web/src/app/shared/ui/placeholder-page/placeholder-page.ts`: placeholder paneline isteğe bağlı eylem içeriği için `<ng-content>` eklendi; diğer placeholder'lar aynı görünümü koruyor.
- Testler:
  - `start-run-page.spec.ts`: NORMAL ve replay başarılarında rota `/runs/:createdRunId`; hedef ekranın `GET /api/runs/:id` isteği yanıtlanıyor ve `h1` "Run Details" doğrulanıyor. `RUN_ALREADY_ACTIVE` bağlantısı `/runs/:activeRunId`.
  - `run-details-page.spec.ts`: Run Again sonrası rota `/runs/:newRunId`; yeni detay ekranının snapshot isteği yanıtlanıyor. Aktif çalışma bağlantısı `/runs/:activeRunId`.
  - `live-run-page.spec.ts` (yeni): placeholder metni ve "View run details" bağlantısı; tıklamada `/runs/:runId` rotasına geçiş ve detay ekranının snapshot isteği; rota parametresi değişince bağlantının yeni kimliği kullanması.

**Akış:** Başlat → gerçek `runId` ile detay → sonuç → iptal → Run Again adımları uygulama içi bağlantılarla erişilebilir. Bu turda akış gerçek tarayıcıda uçtan uca tıklanmadı; aşağıdaki "Doğrulanamayanlar" bölümüne bakın.

### B2 — Tam örnekli terminal çalıştırma "eksik örnek" gibi açıklanmıyor

**Önce:** `isPartialResult` `RUNNING` dışındaki her terminal durumda `true` dönüyordu. `recordedSampleCount == expectedSampleCount` olan `CANCELLED`/`ERROR`/`INTERRUPTED` çalıştırmada %100 ilerleme ile "Partial results — stopped before every expected sample" metni birlikte gösteriliyordu.

**Sonra:**

- `apps/web/src/app/features/runs/run-status.ts`:
  - `isPartialResult` yalnız `status !== 'RUNNING' && recordedSampleCount < expectedSampleCount` olduğunda `true`.
  - Yeni `isStoppedAfterAllSamples`: `CANCELLED`, `INTERRUPTED` veya `ERROR` ve `recordedSampleCount >= expectedSampleCount` ise `true`.
- `apps/web/src/app/features/runs/run-details-page.ts` / `.html`: kısmi sonuç notu yalnız gerçekten eksik örnek varsa gösteriliyor. Tüm örnekler kaydedilmiş terminal durumda şu metin gösteriliyor:
  > **All expected samples were recorded.** The run stopped during finalization or because of a technical error, so it is not presented as a completed result.
- `COMPLETED` + tüm örnekler mevcut "Passed/Failed/Completed" açıklamalarını koruyor; `COMPLETED` + eksik örnek artık kısmi olarak işaretleniyor. Eksik örnekler hiçbir durumda sıfır olarak gösterilmiyor.
- Testler:
  - `run-details-page.spec.ts`: tam örnekli `CANCELLED` ve `ERROR` snapshot'larında `4 of 4 samples recorded (100%)`, "All expected samples were recorded..." ve **"Partial results." yokluğu**; mevcut kısmi `CANCELLED`/`INTERRUPTED`/`ERROR` testleri "Partial results." beklemeye devam ediyor.
  - `run-status.spec.ts` (yeni): `isPartialResult` ve `isStoppedAfterAllSamples` için RUNNING, tam/eksik CANCELLED/INTERRUPTED/ERROR ve COMPLETED kenar durumları.

### B9 — Boş RANDOM olasılığı artık payload'a dönüşmüyor

- `apps/web/src/app/features/runs/run-start-form.ts`: `buildStartRunRequest` RANDOM senaryosunda `errorProbability.trim().length === 0` ise de hata fırlatıyor; boş veya yalnız boşluk içeren değer `{ errorProbability: '' }` olarak döndürülmüyor.
- `apps/web/src/app/features/runs/run-start-form.spec.ts`: boş (`''`) ve yalnız boşluk (`'   '`) RANDOM olasılığının `toThrow()` ürettiği doğrulanıyor.

## Değişen dosyalar

Ürün kodu:

- `apps/web/src/app/features/runs/start-run-page.ts`
- `apps/web/src/app/features/runs/start-run-page.html`
- `apps/web/src/app/features/runs/run-details-page.ts`
- `apps/web/src/app/features/runs/run-details-page.html`
- `apps/web/src/app/features/runs/run-status.ts`
- `apps/web/src/app/features/runs/run-start-form.ts`
- `apps/web/src/app/features/runs/live-run-page.ts`
- `apps/web/src/app/shared/ui/placeholder-page/placeholder-page.ts`
- `apps/web/src/app/shared/ui/placeholder-page/placeholder-page.scss`

Testler:

- `apps/web/src/app/features/runs/start-run-page.spec.ts`
- `apps/web/src/app/features/runs/run-details-page.spec.ts`
- `apps/web/src/app/features/runs/run-start-form.spec.ts`
- `apps/web/src/app/features/runs/live-run-page.spec.ts` (yeni)
- `apps/web/src/app/features/runs/run-status.spec.ts` (yeni)

Dokümanlar:

- `docs/tasks/P3-09.md`
- `docs/tasks/P3-10.md`
- `docs/evidence/phase-3-run-summary.md` (durum notu ve güncel olmayan smoke/navigasyon ifadeleri düzeltildi)
- `docs/evidence/phase-3-review-fixes-web.md` (bu dosya)

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: repo kökü, 2026-11-03.

```text
$ npm run lint --workspace apps/web
> oxlint src
Found 0 warnings and 0 errors.
Finished in 41ms on 71 files with 93 rules using 8 threads.
EXIT: 0
```

```text
$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
EXIT: 0
```

```text
$ npm run test --workspace apps/web
> ng test
Test Files  23 passed (23)
     Tests  199 passed (199)
  Duration  4.56s
EXIT: 0
```

```text
$ npm run build --workspace apps/web
> ng build
Application bundle generation complete. [2.294 seconds]
Initial total: 326.26 kB | 91.13 kB
(warning/error yok)
EXIT: 0
```

Test sayısı önceki 186'dan 199'a çıktı; mevcut testler korunup B1/B2/B9 için yeni kapsam eklendi.

## Doğrulanamayanlar / sınırlar

- **Gerçek API ve tarayıcı akışı bu düzeltme turunda çalıştırılmadı.** B1 kapanışı Angular TestBed/`RouterTestingHarness` ve `HttpTestingController` ile; B2/B9 saf fonksiyon ve bileşen testleriyle doğrulandı. Gerçek Chrome'da başlat → detay → iptal → Run Again turu, görsel yerleşim ve klavye/ekran okuyucu kontrolü yapılmadı.
- **`GET /api/runs/:id` yanıtı testlerde sözleşme biçiminde beslendi.** Navigasyon sonrası hedef ekranın isteği gerçekten oluşturduğu doğrulandı; gerçek API yanıtı bu turda okunmadı.
- **P4-04 canlı ekranı yok.** `/runs/:runId/live` placeholder olarak kaldı; yalnız detay erişimi eklendi. SSE, reconnect ve canlı grafik P4 kapsamındadır.
- **B6'nın diğer dosyaları bu worker'ın sahiplik alanı dışında.** `phase-3-demo.md`, `docs/roadmap.md`, `docs/testing.md`, `docs/tasks/README.md` ve `docs/evidence/phase-3-executor.md` düzeltilmedi; `phase-3-run-summary.md` yalnız bu worker'a ait olduğu için durum notuyla güncellendi.
- **Bağımsız yeniden inceleme ve kullanıcı kabulü yapılmadı.** P3-09 ve P3-10 `In Review`; `Accepted` değil. B1/B2/B9 düzeltmelerinin review tarafından yeniden değerlendirilmesi gerekir.
- **Git komutu çalıştırılmadı.** Commit/push lead tarafından yapılacak.
