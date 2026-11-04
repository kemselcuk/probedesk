# Phase 7 — Bağımsız teknik inceleme (P7-01…P7-06)

- Tarih: 2026-11-04
- İnceleme başlangıç commit'i: `ca447312747d10a7138a95a4a056d2711a7304a5`
  (`feat(api): add idempotent demo plan and run fixtures`). İnceleme sırasında
  P8 teslim commit'leri (`518f278`, `739e72a`, `9a9d198`) eklendi; bu commit'ler
  P7 kapsamındaki uygulama/test dosyalarını değiştirmedi.
- İnceleme türü: **Bağımsız teknik inceleme.** Bu belge ürün kabulü değildir;
  kullanıcı kabulü ve görev kartlarının `Accepted` durumuna alınması ayrı bir
  adımdır.
- Ortam: macOS arm64, Node.js `22.23.2`, npm `11.6.2`, Chrome `157.0.8103.38`,
  gerçek PostgreSQL 18 (`127.0.0.1:5433` test/E2E, `127.0.0.1:5434` geliştirme).
- Çalışma ağacında bu inceleme sırasında P8'e ait ilgisiz değişiklikler vardı
  (`compose.yaml`, `package.json`, `infra/`, `docs/tasks/P8-01.md` vb.). Ürün
  kodu değiştirilmedi. Testlerin doğal çıktısı olarak değişen kanıt PNG'leri
  HEAD sürümüne geri alındı; yalnızca bu inceleme dosyası yazıldı.

## Sonuç özeti

| Görev | Teknik sonuç | Kısa gerekçe |
|---|---|---|
| P7-01 | **Geçti (koşullu)** | Ana demo gerçek UI/API/PG üzerinden çalıştı; plan create/reorder/save/publish, FAILED ve PASSED run, history seçimi, compare, v2 ve eski run korunması gerçek değerlerle doğrulandı. Test verisi temizlendi. Düşük: canlı ekran doğrudan `/runs/:id/live` deep link'i ile açılıyor. |
| P7-02 | **Geçti** | Rol matrisi, eksik/yanlış CSRF, yabancı Origin, sunucu alanı reddi ve hassas veri sızıntısı testleri geçti. Origin düzeltmesi doğru yerde ve login/health akışını bozmuyor. Düşük: proxy/Host varyasyonu ve alt süreç stdout taraması kapsam dışı. |
| P7-03 | **Geçti (koşullu)** | Yeni süreç testleri 3/3 geçti; iki API süreciyle yarış, SIGKILL/SIGTERM ve retry yeni run doğrulandı. Ancak tam API paketi ilk bağımsız koşuda ilgisiz bir sabit-sleep testinde 1/197 düştü; ikinci koşu geçti (bkz. F1). |
| P7-04 | **Geçti** | Klavye/odak, gerçek 401 yönlendirmesi, 1280/768 taşma kontrolleri ve 503/network hata girdisi koruma tarayıcı betiğiyle geçti; `pageerror` 0. Düşük: betik geliştirme DB'sindeki belirli verilere bağımlı. |
| P7-05 | **Geçti (koşullu)** | `_test` guard'ı, sıralı worker, yalnız test verisini silme ve seed idempotency doğrulandı. Ancak HEAD'de demo seed artık 1 plan/4 run oluşturuyor; "suite sonrası plans=0 runs=0" kanıtı ve CI'daki "clean" adımı bu yeni duruma göre güncel değil (bkz. F2). |
| P7-06 | **Geçti (koşullu)** | Gerçek CI koşuları 6/6 yeşil; iş ayrımı, build-before-e2e, PostgreSQL/E2E DB, Chrome ve hata artifact'ı doğrulandı. Başarısız bir koşuda `ci_required` gerçekten düştü. Düşük/orta: kanıt bağlantısı ve kart durumları güncel değil (bkz. F3). |

**Genel verdict:** Phase 7 ürün davranışı ve CI açısından **teknik olarak kabul
edilebilir**, ancak F1–F3 kapatılmadan veya açık gerekçeyle ertelenmeden
`Accepted` önerilmez. Critical/High ürün bulgusu tespit edilmedi.

## Çalıştırılan komutlar ve gerçek sonuçlar

### Yerel kalite ve sözleşme

```text
$ npm run verify
lint:       0 warning, 0 error (API 144 dosya, web 113, client 2)
typecheck:  çıkış kodu 0
test:api:unit: 16 dosya, 118 test geçti
test:web:      36 dosya, 370 test geçti
build:         API + web başarılı
openapi:check: OpenAPI contract is current...
EXIT=0
```

```text
$ npm run openapi:check
OpenAPI contract is current: apps/api/openapi.json and
packages/api-client/src/schema.ts match the application.
EXIT=0
```

### API entegrasyon/süreç paketi

İlk tam koşu:

```text
$ npm run test:e2e --workspace apps/api
Test Files  1 failed | 21 passed (22)
     Tests  1 failed | 196 passed (197)
Duration  122.84s
EXIT=1

FAIL test/runs-execution.e2e-spec.ts > sequential run execution (e2e)
     > leaves the run RUNNING when shutdown begins inside finalization
AssertionError: expected [ 'COMPLETED', 'COMPLETED', 'RUNNING' ]
                to deeply equal [ 'COMPLETED', 'COMPLETED', 'COMPLETED' ]
```

Aynı testin hedefli tekrarı ve tam paketin ikinci koşusu:

```text
$ npx vitest run --config ./vitest.config.e2e.ts \
    test/runs-execution.e2e-spec.ts \
    -t "leaves the run RUNNING when shutdown begins inside finalization"
Test Files  1 passed (1)
     Tests  1 passed | 9 skipped (10)
EXIT=0

$ npm run test:e2e --workspace apps/api
Test Files  22 passed (22)
     Tests  197 passed (197)
Duration  70.81s
EXIT=0
```

P7-02/P7-03 hedefli yeni testler:

```text
$ npx vitest run --config ./vitest.config.e2e.ts \
    test/security.e2e-spec.ts test/runs-process.e2e-spec.ts
Test Files  2 passed (2)
     Tests  10 passed (10)
Duration  11.25s
EXIT=0
```

### İzole E2E veritabanı ve Playwright

```text
$ node scripts/e2e-isolated.mjs prepare
8 migration uygulandı; demo seed 3 kullanıcı/1 profil
Demo plan ready: Power Supply Validation (created),
  2 published versions, 4 runs (4 created)
baseline: plans=1 revisions=2 runs=4 activeRuns=0 sessions=0
EXIT=0

$ node scripts/e2e-isolated.mjs seed-check
birinci ve ikinci seed sonrası:
plans=1 revisions=2 runs=4 activeRuns=0 sessions=0
history and demo fixture digests unchanged
EXIT=0
```

```text
$ E2E_API_PORT=3101 E2E_WEB_PORT=4300 E2E_LOG_DIR=/tmp/probedesk-ci-e2e \
    node scripts/ci-e2e.mjs --reporter=list
[ci-e2e] api ready at http://127.0.0.1:3101/api/health/ready (200)
[ci-e2e] web ready at http://127.0.0.1:4300/ (200)
[e2e-db] baseline 127.0.0.1:5433/probedesk_e2e_test:
  plans=1 runs=4 sessions=0 activeRuns=0
[e2e-db] cleanup ... plans=1 ... runs=2 ... sessions=3 activeRuns=0
[e2e-db] cleanup ... plans=1 ... runs=3 ... sessions=2 activeRuns=0
  2 passed (48.6s)
[ci-e2e] Playwright passed
EXIT=0
```

Koşu sonrası bağımsız DB kontrolü:

```text
[e2e-isolated] status: plans=1 revisions=2 runs=4 activeRuns=0 sessions=0
test plan/revision query: E2E Main Demo% / Version consistency% = 0
```

Buradaki `plans=1 runs=4` P8 demo fixture'ıdır; P7 testlerinin oluşturduğu
plan/run kalmamıştır. `cleanupE2eData` kendi plan kimlikleri için sıfırı
doğrulamaktadır.

### Guard ve reset negatif kontrolleri

```text
$ E2E_DATABASE_URL='.../probedesk_e2e' node scripts/e2e-isolated.mjs prepare
Refusing to prepare E2E database "probedesk_e2e": its name must end with "_test".
exit=1

$ npx playwright test tests/e2e/compare.spec.ts   # E2E_DATABASE_URL yok
Error: E2E_DATABASE_URL is required for the Playwright suite...
exit=1

$ NODE_ENV=development npm run db:reset:test --workspace apps/api
Refusing to use the test database because NODE_ENV is not "test".
exit=1
```

### Erişilebilirlik tarayıcı kontrolü

```text
$ E2E_BASE_URL=http://127.0.0.1:4200 node scripts/p7-accessibility-check.mjs
resultCount: 31
screenshots: 26
[page-errors] []
P7-04 accessibility browser check passed.
EXIT=0
```

Gerçek 401 sonucu bu koşuda da doğrulandı:

```json
{
  "url": "/login?returnUrl=%2Fruns%3Fpage%3D2&reason=session-expired",
  "returnUrl": "/runs?page=2",
  "reason": "session-expired",
  "activeId": "login-heading"
}
```

Not: 4200/3100 portlarında zaten çalışan geliştirme API/web süreçleri
kullanıldı; bu inceleme sırasında yeni süreç başlatma denemeleri
`EADDRINUSE` ile durdu. Tarayıcı betiği gerçek Angular/API/PG üzerinde çalıştı.

### Gerçek GitHub Actions koşuları

| Koşu | Commit | Sonuç |
|---|---|---|
| [41885922086](https://github.com/kemselcuk/probedesk/actions/runs/41885922086) | `3d27f2f` | 6/6 success; Playwright 2 passed (39.8 s) |
| [41889479163](https://github.com/kemselcuk/probedesk/actions/runs/41889479163) | `ca44731` | 6/6 success; Playwright 2 passed (41.9 s) |
| [41884253326](https://github.com/kemselcuk/probedesk/actions/runs/41884253326) | `86edb0d` | API integration failure; `ci_required` failure |

`41889479163` E2E logunda baseline `plans=1 runs=4`, "Confirm the E2E database
is clean" adımında `plans=1 revisions=2 runs=4 activeRuns=0 sessions=0` görüldü.
`41884253326` koşusunda üç `runs-process` testi `dist/main.js` yokluğu nedeniyle
düştü; `ci_required` işi `API integration: failure` ile exit 1 verdi ve
`api-integration-junit` artifact'ı 8.466 bayt / 7 gün saklama ile yüklendi.
Bu, hem hata yayılımını hem de artifact mekanizmasını gerçek koşuda kanıtlar.

## Bulgular

### Critical

Yok.

### High

Yok.

### Medium

#### F1 — Tam API paketinde sabit-sleep kaynaklı flaky test

- Dosya: `apps/api/test/runs-execution.e2e-spec.ts:947`.
- İlk tam koşuda 1/197 test düştü; aynı testin hedefli 10 tekrarı ve tam
  paketin ikinci koşusu geçti. Bu, testin sonucunun makine yüküne duyarlı
  olduğunu gösterir.
- Test, finalization sırasında shutdown'ı tetikledikten sonra `setTimeout(100)`
  ile bekleyip adım durumlarını okuyor. Yük altında üçüncü adım henüz
  `RUNNING` kalabiliyor; oysa test `COMPLETED` bekliyor.
- `docs/testing.md` "E2E'ler sabit sleep dizilerine dayanmaz" diyor; P7-06'da
  retry yok. Bu flake, aksi yeşil bir pipeline'ı nedensiz düşürebilir.
- Öneri: sabit 100 ms yerine gözlenebilir koşul (üçüncü adım `COMPLETED` +
  run hâlâ `RUNNING` + `RUN_COMPLETED` yok) `waitFor` ile beklenmeli; üst sınır
  korunmalı. Test P7'de eklenmedi, ancak Phase 7 tam paketinin parçası.

#### F2 — P7-05/CI "clean" kanıtı HEAD'de güncel değil

- HEAD'de `demo:seed` artık `Power Supply Validation` planını, 2 yayımlanmış
  sürümü ve 4 run'ı oluşturuyor. `prepare` baseline'ı `plans=1 runs=4`.
- Buna karşın `docs/evidence/phase-7-test-isolation.md` ve P7-05 kartı suite
  sonrası `plans=0 runs=0 sessions=0` diyor. Gerçek HEAD CI koşusunda
  `node scripts/e2e-isolated.mjs status` `plans=1 runs=4` ile **başarılı**
  oldu; çünkü `status` yalnızca `activeRuns > 0` durumunda hata veriyor.
- Testlerin kendi oluşturduğu veri gerçekten siliniyor (ayrıca doğruladım:
  `E2E Main Demo%` / `Version consistency%` revision sayısı 0). Sorun, CI
  adımının ve kanıtın "temiz" kelimesini yalnız aktif run kontrolüyle
  kullanması; demo fixture'ı ile test artığını ayırt etmiyor.
- Öneri: adımı "no active E2E runs" olarak yeniden adlandırıp baseline/demo
  fixture'ı raporlamak veya test öncesi/sonrası yalnız test kimliklerini
  karşılaştıran bir kontrol eklemek; P7-05 kanıtını HEAD'e göre güncellemek.

#### F3 — Görev kartı/indeks/kanıt tutarsızlıkları

- `docs/tasks/P7-06.md` üstünde `In Review`, altında "Kart `In Progress`";
  `docs/tasks/README.md` ise P7-06'yı **Planned** gösteriyor.
- P7-01…P7-06 kartlarında "uygulama commit'i yok" alanları duruyor; oysa
  `e109229`, `f40779c`, `86edb0d`, `18a0363`, `3d27f2f` commit'leri mevcut.
- P7-06 kanıtındaki koşu bağlantısı `kemalselcuk` yazımıyla 404 veriyor;
  gerçek repo `kemselcuk/probedesk`. Belgenin başında "gerçek koşu bekliyor"
  denirken sonunda gerçek koşu kaydedilmiş.
- P7-05 kanıtı `.env.example`'ın hâlâ `probedesk_test` gösterdiğini söylüyor;
  dosya artık `probedesk_e2e_test` içeriyor. Test sayıları da (195/367) HEAD'de
  197/370.
- REQ-26 ve AGENTS gereği kart, indeks ve kanıt aynı commit'te tutarlı
  olmalı. Bunlar ürün davranışı değil, kabul kaydı/süreç bulgularıdır.

### Low

#### F4 — P7-01 canlı ekran doğrudan deep link ile açılıyor

- Start Run başarısı `/runs/:runId` (Run Details) ekranına gidiyor; Run
  Details'ten Live Run'a bağlantı yok. Test, canlı ilerlemeyi görmek için
  `/runs/:runId/live` adresine doğrudan gidiyor.
- Test gerçek SSE/UI'yi sürüyor ve bu hile değil; ancak normal kullanıcı
  yolunda "canlı izleme"ye geçiş yok. P7-01 kanıtında belirtilmiş; UX işi
  olarak ayrı ele alınmalı.
- Ayrıca console error dinleyicisi login sonrasında bağlanıyor; login
  sırasındaki console hataları `browserErrors` kapsamına girmiyor (pageerror
  tüm akışta dinleniyor).

#### F5 — P7-03 "ölçüm birebir aynı" iddiası testte tam karşılanmıyor

- `runs-process.e2e-spec.ts` eski run için status, `recordedSampleCount`,
  `finishedAt`, `eventSequence` ve olay kümesini karşılaştırıyor; measurement
  satırlarının değer/ID/zaman içeriğini birebir karşılaştırmıyor (yalnız sayı).
- DB trigger'ları terminal run yazılarını engelliyor; yine de "ölçümler
  birebir aynı" ifadesi için measurement satırlarının da deep-equal
  karşılaştırılması veya yazma denemesinin reddinin gösterilmesi daha güçlü
  olur.
- SIGKILL testinde kill sonrası ölçüm sayısının `beforeMeasurements`'a eşit
  olması, ölçümün kill'den hemen önce commit edilmesine bağlı; 1.5 s aralık
  nedeniyle pratikte düşük risk, ancak teorik bir yarış.

#### F6 — P7-02 Origin/proxy ve log kapsamı

- Testler yabancı `Origin: https://evil.example` ve `null`/bozuk login
  origin'lerini kapsıyor; gerçek ters proxy senaryosu (`Host` yeniden yazımı,
  `X-Forwarded-Proto`) ve meşru proxy arkasında same-origin kabulü ayrı test
  edilmemiş. Kod doğru görünüyor; kanıt sınırı.
- `MemoryLogger` yalnız Nest logger'ını tarıyor; `dist/main.js` alt süreç
  stdout/stderr'i P7-02 sızıntı taramasına dahil değil (P7-03 süreç testleri
  çıktıyı topluyor ama token/DSN taraması yapmıyor). Kanıtta belirtilmiş.

#### F7 — P7-04 betiği tekrar üretilebilir değil

- `scripts/p7-accessibility-check.mjs` geliştirme DB'sinde en az bir FAILED
  run, aynı adlı iki plan, 20+ run ve belirli bir plan editörü bekliyor.
  Temiz bir DB'de veya CI'da çalışmaz; P7-04 kanıtı bu veri setine bağlı.
- Betikte 42 `waitForTimeout` var; gerçek tarayıcı kontrolü için kabul
  edilebilir, ancak "gözlenebilir durum bekleme" standardının dışında.
- Cancel dialog gerçek çalışan run yerine kopya `RUNNING` snapshot'ıyla
  doğrulanıyor; iptal POST'u gönderilmiyor. Kanıtta açıkça belirtilmiş.
- "Faresiz" akışlarda login `page.click` ile yapılıyor; ana klavye akışları
  odak + Enter/Escape ile gerçekten denenmiş.

#### F8 — P7-06 coverage ve Playwright failure artifact'ı gerçek koşuda denenmedi

- Workflow'da coverage adımı/artifact'ı yok; P7-06 kartının "coverage kaydı"
  ifadesi karşılanmıyor.
- Başarısız E2E koşusu üretilmediği için `playwright-e2e-<attempt>` artifact'ı
  (trace/screenshot/HTML/log) gerçek bir hata üzerinde çalıştırılmadı. Aynı
  `upload-artifact` mekanizması API integration JUnit artifact'ında 7 gün
  retention ile doğrulandı; Playwright yolu yalnız YAML/config incelemesiyle
  doğrulandı.
- Başarılı koşularda artifact üretilmemesi tasarım gereği; `if: failure()` ve
  `retention-days: 7` doğru.

## Görev bazında ayrıntılı verdict

### P7-01 — Ana demo Playwright testi

- Test gerçek Angular, gerçek API ve gerçek PostgreSQL kullanıyor; plan, üç
  adım, sıralama, kaydetme, publish, FAILED/PASSED run, history seçimi,
  compare ve v2 akışı UI üzerinden yürütülüyor.
- Gerçek değerler doğrulandı: `0.600000`, `First failing sample: 3`,
  `Sample index 3`, `24/24`, adım durumları, `Version 1/2`, `0.550000 →
  0.650000`, delta `—`, FAILED/PASSED sonuçları.
- Testte run sonucu önceden yazılmıyor; `compare.spec.ts` API fixture'ları
  ayrı dosyada ve ana demo kapsamı dışında.
- Sabit `waitForTimeout` zinciri yok; `expect`, `expect.poll`, URL ve görünür
  durum beklemeleri kullanılıyor (tek DB poll'ü temizlik öncesi aktif run
  beklemesi).
- Cleanup sonrası test planı/revision'ı kalmadı; `plans=1 runs=4` yalnız demo
  seed fixture'ı.
- **Verdict: Geçti.** F4 düşük UX/kanıt sınırı.

### P7-02 — Yetki ve istek güvenliği

- `security.e2e-spec.ts` gerçek HTTP + PostgreSQL üzerinde 7 test çalıştırıyor.
- Viewer/Planner run başlatamıyor, Operator plan değiştiremiyor; eksik oturum
  401, yanlış rol 403; reddedilen yanıtlarda `Set-Cookie` yok.
- `status/outcome/verdict/createdBy/publishedBy/timestamp/requestedBy` ve
  nested adım alanları `UNKNOWN_FIELD` ile reddediliyor; DB'de yazma yok.
- Yedi mutasyon için eksik/yanlış CSRF ve yabancı Origin ayrı ayrı 403;
  doğru imzalı istek geçiyor; logout session'ı korunuyor.
- Login JSON-only, aynı origin, geçersiz origin ve bilinmeyen `role` reddi
  doğrulandı.
- Hassas veri (parola, hash, cookie, CSRF, tokenHash, idempotencyKey,
  requestHash, DSN, SQL/stack) yanıt/log taramasında bulunmadı.
- Origin kontrolü `SessionAuthGuard` + `CsrfGuard` üzerinden tüm mutation'lara
  uygulanıyor; login guard'ı aynı yardımcıyı kullanıyor; health GET etkilenmiyor.
- **Verdict: Geçti.** F6 düşük kapsam sınırı.

### P7-03 — Yarış ve kesinti

- Yeni `runs-process.e2e-spec.ts` 3 testi gerçek `dist/main.js`, gerçek HTTP ve
  gerçek DB ile geçti (hedefli koşu 10/10; tam paket ikinci koşu 197/197).
- İki ayrı API süreci, 5 tur, her turda tam `[202, 409]`, tek RUNNING run,
  `RUN_ALREADY_ACTIVE` + doğru `activeRunId`; kabul edilen run iptal edilince
  aktif run 0.
- SIGKILL: süreç gerçekten `SIGKILL` ile öldü; ölçüm/olaylar korundu; yeni
  süreç readiness 200 verdiğinde run `INTERRUPTED`, `SERVER_RESTART`, resume
  yok; retry yeni run ID'si aldı, eski run değişmedi.
- SIGTERM: run RUNNING kaldı, `finishedAt=null`, `run.completed` yok; sonraki
  süreç INTERRUPTED yaptı.
- Mevcut `runs-cancel` testi cancel/final yarışında tek terminal olay,
  `finishedAt` eşleşmesi, terminal sonrası yazma yok ve kısmi veri korunmasını
  kapsıyor.
- **Verdict: Geçti (koşullu).** F1 tam pakette flaky; F5 ölçüm karşılaştırması
  sınırlı.

### P7-04 — Erişilebilirlik ve hata deneyimi

- Gerçek Chrome'da 31 sonuç grubu/26 ekran görüntüsü üretildi; `pageerror` 0.
- Klavye: adım taşıma (Space/Enter + odak/duyuru), grafik hata listesi, History
  sayfalama ve odak, Compare seri toggle, Publish/Discard/Cancel Escape ve
  odak dönüşü doğrulandı.
- Gerçek 401: `/login?returnUrl=%2Fruns%3Fpage%3D2&reason=session-expired`,
  açıklama ve `login-heading` odağı; yeniden giriş sonrası sayfa döndü.
- 1280/768: sayfa seviyesinde yatay taşma yok; History tablosu odaklanabilir
  yatay bölge; Details/Live/Compare tabloları 768'de sığıyor.
- Plan editörü ve Start Run 503/network yollarında girdi korunuyor, requestId
  ve odaklı hata paneli var; başarı iddiası yok.
- **Verdict: Geçti.** F7 düşük tekrar-üretilebilirlik sınırı.

### P7-05 — Test verisi ve izolasyon

- `E2E_DATABASE_URL` zorunlu; `_test` olmayan ad ve geliştirme DB'si reddedildi.
- Playwright `workers: 1`; iki worker guard'ı kod ve kanıtta açık hata veriyor.
- Cleanup yalnız toplanan plan ID'leri, test plan adları ve baseline sonrası
  demo kullanıcı session'larını siliyor; kendi test verisi için sıfırı doğruluyor.
- Seed iki kez çalıştırıldı; plan/run/revision/demo digest'leri değişmedi.
- `db:reset:test` yanlış `NODE_ENV` ile exit 1 verdi.
- **Verdict: Geçti (koşullu).** F2 nedeniyle "plans=0 runs=0" kanıtı HEAD'de
  yanlış; test verisi temizliği doğru.
- Ek sınır: guard aynı DB'ye karşı çalışan iki ayrı Playwright sürecini
  engellemiyor (yalnız tek süreçteki worker sayısını kontrol ediyor). CI tek
  süreç olduğu için mevcut kabulü etkilemez; yerel eşzamanlı koşularda risk.

### P7-06 — Tam CI pipeline

- `41885922086` (`3d27f2f`) ve `41889479163` (`ca44731`) gerçek koşuları 6/6
  success: API quality, API integration, web quality, contract, Playwright E2E,
  CI required.
- Workflow'da `continue-on-error`, `|| true` veya koşulsuz başarılı adım yok;
  `ci_required if: always()` beş sonucu `success` ile karşılaştırıyor.
- E2E job'ı PostgreSQL service, migration/seed, API/web build, Chrome kontrolü
  ve gerçek Playwright çalıştırıyor; build e2e'den önce.
- `41884253326` gerçek hata koşusunda `ci_required` düştü; API integration
  JUnit artifact'ı 7 gün saklama ile yüklendi. Playwright failure artifact'ı
  gerçek hata üzerinde denenmedi.
- E2E artifact yalnız `if: failure()`; retention 7 gün; başarılı koşuda yok.
- Public repo/ubuntu-latest; ücretli servis yok. Runner süresi/kotası için
  ölçülmemiş sayı yazılmadı.
- **Verdict: Geçti (koşullu).** F3/F8 belge/kanıt eksikleri.

## Doğrulanmayan sınırlar

- Safari, Firefox, mobil genişlikler ve tam ekran okuyucu turu denenmedi;
  P7-04 yalnız Chrome 1280/768 iddia ediyor.
- Gerçek bir Playwright hata koşusunda trace/screenshot/HTML artifact'ı
  yüklenmesi denenmedi; yalnız YAML ve API JUnit artifact'ı doğrulandı.
- Ters proxy `Host`/`X-Forwarded-Proto` yapılandırma varyasyonları test
  edilmedi.
- P7-02 alt süreç stdout/stderr gizli veri taraması yapılmadı.
- P7-04 betiği temiz/izole DB'de çalıştırılmadı; mevcut geliştirme verisiyle
  çalıştı.
- Coverage raporu üretilmedi.
- GitHub branch protection kuralları (özellikle `CI required` zorunluluğu)
  hesap ayarlarından doğrulanmadı; workflow'un kendisi hata koşusunda düştü.

## Sonuç

Phase 7'nin altı görevi de gerçek kod, gerçek PostgreSQL, gerçek Chrome ve
gerçek CI koşularıyla teknik olarak doğrulandı. **Critical/High ürün bulgusu
yoktur.** Medium bulgular F1 (flaky test), F2 (P7-05/CI clean kanıtı) ve F3
(kart/indeks/kanıt tutarlılığı) kapatılmadan veya açık takip kaydıyla
ertelenmeden görevlerin `Accepted` yapılması önerilmez. Bu, bağımsız bir
teknik incelemedir; ürün kabulü değildir.
