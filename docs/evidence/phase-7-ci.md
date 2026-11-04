# Phase 7 — CI pipeline kanıtı (P7-06)

Durum: **Tamamlandı.** Gerçek GitHub Actions koşuları altı işle yeşil; kontrollü hata
koşusunda `ci_required` düştü. Aşağıdaki yerel çıktıların bir kısmı demo seed öncesine aittir;
güncel E2E baseline'ı 1 plan / 4 run'dır.

- Tarih: 2026-11-04
- Görev: [P7-06](../tasks/P7-06.md)
- İş akışı: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- Yerel E2E orkestrasyonu: [`scripts/ci-e2e.mjs`](../../scripts/ci-e2e.mjs)
- Ortam: macOS (darwin, arm64), Node.js `v22.23.2`, npm `11.6.2`,
  `@playwright/test` `1.64.1`, Google Chrome `157.0.8103.38`
- Yerel PostgreSQL: `postgres:18.1-alpine` test konteyneri
  (`127.0.0.1:5433`); E2E için `probedesk_e2e_test`
- Commit SHA: `3d27f2f` (workflow), `ea08fb3` (baseline/flaky düzeltmeleri).
- Gerçek koşular: [41885922086](https://github.com/kemselcuk/probedesk/actions/runs/41885922086) 6/6 success; [41892312186](https://github.com/kemselcuk/probedesk/actions/runs/41892312186) E2E baseline/Playwright 2/2; [41884253326](https://github.com/kemselcuk/probedesk/actions/runs/41884253326) kontrollü hatada `ci_required` failure.

## İş haritası

| İş | Adımlar | Bağımlılık | Zaman aşımı | Başarısızlık artifact'ı |
|---|---|---|---|---|
| `api_quality` | npm ci (11.6.2), API lint/typecheck/unit/build | Yok, paralel | 15 dk | `api-quality-junit` (7 gün) |
| `api_integration` | PostgreSQL servisi, boş test DB migration, API build, 195 entegrasyon/süreç testi | Yok, paralel | 30 dk | `api-integration-junit` (7 gün) |
| `web_quality` | npm ci, web lint/typecheck/unit/build | Yok, paralel | 20 dk | `web-quality-junit` (7 gün) |
| `contract` | OpenAPI emit, izlenen belge drift kontrolü, `openapi:check` | Yok, paralel | 15 dk | Yok; hata logu |
| `e2e` | PostgreSQL servisi, API/web build, `prepare`, gerçek API + `app-server.mjs` + Playwright | Yok, paralel | 35 dk | `playwright-e2e-<attempt>`: trace/screenshot/HTML/log (7 gün) |
| `ci_required` | Beş işin sonucunu denetler; `success` olmayan varsa düşer | Beş iş | 5 dk | Yok |

`ci_required` `if: always()` ile çalışır ve `needs` sonuçlarını tek tek
`success` ile karşılaştırır; `continue-on-error`, `|| true` veya koşulsuz
başarılı adım yoktur. Kalite işleri birbirinden bağımsız çalışır. E2E işi
API ve web build'lerini kendi içinde tekrarlar; böylece kalite işlerini
beklemeden paralel kalır. Ek runner süresi bu tercihin bilinçli maliyetidir.

Tetikleyiciler `main` push ve tüm pull request'lerdir. Aynı ref için eski PR
koşuları `concurrency` ile iptal edilir; `main` koşuları tamamlanır. İzinler
yalnızca `contents: read`; repository secret'ı veya ücretli servis yoktur.

## E2E ortam sınırı

CI'da tek PostgreSQL servisi `POSTGRES_DB=probedesk_test` ile başlar. E2E işi
`scripts/e2e-isolated.mjs prepare` ile ayrı `probedesk_e2e_test` veritabanını
oluşturur, 8 migration'ı `prisma migrate deploy` ile uygular ve idempotent demo
seed'i çalıştırır. Bu adım veritabanı düşürmez veya kullanıcı verisini sıfırlamaz.

Ortam değişkenleri bilinçli olarak ikiye ayrılır:

- İş seviyesinde `DATABASE_URL` **yoktur**; yalnızca `E2E_DATABASE_URL` vardır.
- `scripts/ci-e2e.mjs`, API alt sürecine `DATABASE_URL=$E2E_DATABASE_URL`,
  `PORT=3100`, `NODE_ENV=development`, `SESSION_COOKIE_SECURE=false` verir.
- Playwright alt sürecinden `DATABASE_URL`, `TEST_DATABASE_URL` ve
  `E2E_ALLOW_DATABASE_CLEANUP` kaldırılır. Testler yalnızca
  `E2E_DATABASE_URL` görür. Böylece `tests/e2e/support/database.ts` temizlik
  koruması E2E veritabanını "geliştirme veritabanı" sanıp reddetmez.
- Web, `scripts/app-server.mjs` ile 4300 portunda servis edilir;
  `PROXY_URL=http://127.0.0.1:3100` ile `/api` gerçek API'ye gider.

Hazırlık sabit uykuya dayanmaz: API `/api/health/ready` yanıtı en fazla 90 sn,
web `index.html` yanıtı en fazla 30 sn, 500 ms aralıkla yoklanır. API yanıtında
`status=ok`, `checks.database=ok` ve `checks.migrations=ok` aranır. Alt süreç
hazırlıktan önce ölürse bekleme döngüsü hatayı hemen bildirir.

Tarayıcı varsayımı açıkça doğrulanır: ubuntu-latest imajındaki Google Chrome
`google-chrome --version` adımıyla kontrol edilir; Playwright
`channel: 'chrome'` kullanır. Trace `retain-on-failure`, screenshot
`only-on-failure` olarak kalır; başarılı koşuda trace/screenshot üretilmez.
Yükleme yalnızca `if: failure()` ile yapılır ve retention 7 gündür.

## Yerel olarak çalıştırılan kontroller

Aşağıdaki komutlar bu çalışma ağacında gerçekten çalıştırıldı. `npm ci` bu
turda yeniden çalıştırılmadı; mevcut `node_modules` kullanıldı. Temiz kurulum
gerçek Actions koşusunda doğrulanacaktır.

### 1. İş akışı ve script doğrulaması

```text
$ go run github.com/rhysd/actionlint/cmd/actionlint@latest -version
v1.7.12
installed by building from source
built with go1.27.2 compiler for darwin/arm64

$ go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/ci.yml
(çıktı yok, çıkış kodu 0)

$ npx prettier --check .github/workflows/ci.yml
Checking formatting...
All matched files use Prettier code style!

$ node --check scripts/ci-e2e.mjs
(çıktı yok, çıkış kodu 0)
```

İlk actionlint denemesinde iş seviyesindeki `E2E_LOG_DIR` için `runner` context
hatası alındı. Değişken Playwright adımının `env` bloğuna taşındı; ardından
actionlint çıkış kodu 0 oldu.

### 2. Boş veritabanında migration

Geçici `probedesk_ci_check_test` veritabanı test konteynerinde oluşturuldu:

```text
$ DATABASE_URL='postgresql://probedesk:probedesk@127.0.0.1:5433/probedesk_dev_sentinel?schema=public' \
  TEST_DATABASE_URL='postgresql://probedesk:probedesk@127.0.0.1:5433/probedesk_ci_check_test?schema=public' \
  npx --yes npm@11.6.2 run db:migrate:test --workspace apps/api
Applying migrations to the isolated test database.
8 migrations found in prisma/migrations

Applying migration `20261103120000_init`
Applying migration `20261103130000_session_csrf_token_optional`
Applying migration `20261103160000_plans`
Applying migration `20261103170000_published_immutability`
Applying migration `20261103180000_plan_revision_integrity`
Applying migration `20261103190000_runs`
Applying migration `20261103200000_run_immutability`
Applying migration `20261103210000_run_history_index`

All migrations have been successfully applied.
```

Aynı geçici veritabanında tam API entegrasyon/süreç paketi:

```text
$ DATABASE_URL='...probedesk_dev_sentinel...' \
  TEST_DATABASE_URL='...probedesk_ci_check_test...' \
  npx --yes npm@11.6.2 run test:e2e --workspace apps/api
Test Files  21 passed (21)
     Tests  195 passed (195)
  Duration  48.42s
```

Geçici veritabanı doğrulama sonunda düşürüldü. Bu, CI'daki boş
`probedesk_test` servisine karşı migration ve süreç testlerini yerelde
doğrular. Production build'ler bu turda migration'dan önce çalıştırıldı;
`api_integration` işindeki migration → build → test sırası bağımsız adımlardan
oluşur ve gerçek servis konteyneri davranışı Actions koşusunda ayrıca görülecektir.

### 3. Production build'ler

```text
$ npx --yes npm@11.6.2 run build --workspace apps/api
> @probedesk/api@0.0.1 prebuild
> npm run db:generate
✔ Generated Prisma Client (7.10.1)
> nest build
(çıkış kodu 0)

$ npx --yes npm@11.6.2 run build --workspace apps/web
Application bundle generation complete. [4.996 seconds]
Initial total 327.17 kB raw / 90.04 kB estimated transfer
(çıkış kodu 0)
```

### 4. Yeni E2E veritabanı oluşturma, migration ve seed

Test konteynerinde daha önce var olmayan `probedesk_e2e_ci_check_test`
veritabanıyla `prepare` çalıştırıldı:

```text
$ E2E_DATABASE_URL='postgresql://probedesk:probedesk@127.0.0.1:5433/probedesk_e2e_ci_check_test?schema=public' \
  node scripts/e2e-isolated.mjs prepare
[e2e-isolated] creating database probedesk_e2e_ci_check_test
[e2e-isolated] applying migrations with prisma migrate deploy
8 migrations found in prisma/migrations
... (8 migration uygulandı)
[e2e-isolated] running additive demo seed
Demo users ready: 3 accounts (3 created, 0 already present).
Demo device profiles ready: 1 profiles (1 created, 0 already present).
[e2e-isolated] baseline: plans=1 revisions=2 runs=4 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1  # P8-02 seed sonrası güncel baseline
[e2e-isolated] E2E database ready: 127.0.0.1:5433/probedesk_e2e_ci_check_test
```

Bu geçici veritabanı da doğrulama sonunda düşürüldü.

### 5. Gerçek API + built Angular + Playwright

Mevcut `probedesk_e2e_test` veritabanı `prepare` ile doğrulandıktan sonra CI
komutunun aynısı yerelde çalıştırıldı. Portlar yerelde dolu olduğu için API
3101'e alındı; CI'da 3100 kullanılır.

```text
$ E2E_DATABASE_URL='postgresql://probedesk:probedesk@127.0.0.1:5433/probedesk_e2e_test?schema=public' \
  E2E_API_PORT=3101 E2E_WEB_PORT=4300 \
  E2E_LOG_DIR=/private/var/folders/.../probedesk-ci-e2e \
  PW_CHANNEL=chrome \
  node scripts/ci-e2e.mjs --reporter=list --reporter=html
[ci-e2e] started api (pid ...)
[ci-e2e] api ready at http://127.0.0.1:3101/api/health/ready (200)
[ci-e2e] started web (pid ...)
app server listening on 4300; static=.../apps/web/dist/web/browser; api=http://127.0.0.1:3101
[ci-e2e] web ready at http://127.0.0.1:4300/ (200)
[ci-e2e] starting Playwright

Running 2 tests using 1 worker

  ✓  1 tests/e2e/compare.spec.ts:111:5 › compares a failed v1 run with v2 after the tolerance changed to 0.65 A
  ✓  2 tests/e2e/main-demo.spec.ts:360:5 › runs the main demo flow through plans, live execution, history, compare and v2

  2 passed (40.3s)
[ci-e2e] Playwright passed
```

Testlerin kendi temizlik çıktısı: compare için `plans=1 revisions=2 runs=2
sessions=3 activeRuns=0`, main demo için `plans=1 revisions=2 runs=3
sessions=2 activeRuns=0`. Koşu sonrası bağımsız durum kontrolü:

```text
$ E2E_DATABASE_URL='...probedesk_e2e_test...' node scripts/e2e-isolated.mjs status
[e2e-isolated] 127.0.0.1:5433/probedesk_e2e_test
[e2e-isolated] status: plans=1 revisions=2 runs=4 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1
```

`node scripts/ci-e2e.mjs` çıkışında API ve web süreçleri kapatıldı; 3101 ve
4300 portlarında dinleyen süreç kalmadı.

## Gerçek koşuda lead'in doğrulayacakları

Bu belge aşağıdakileri **yapılmış** saymaz:

1. GitHub Actions koşusunun kendisi, koşu URL'si ve commit SHA'sı. Push sonrası
   altı işin (`api_quality`, `api_integration`, `web_quality`, `contract`,
   `e2e`, `ci_required`) sonucu ayrı ayrı kaydedilmeli.
2. Temiz checkout'ta `npm ci` (npm 11.6.2) ve `.nvmrc` Node kurulumu.
3. ubuntu-latest üzerindeki `google-chrome --version` ön kontrolü ve
   Playwright'ın `channel: 'chrome'` ile gerçekten açılması.
4. Servis konteynerinin health check'i; `prepare` adımının
   `probedesk_e2e_test` veritabanını **creating** olarak oluşturması;
   migration/seed ve readiness yoklamaları.
5. Kontrollü bir başarısız E2E veya kalite hatasıyla `ci_required` işinin
   düştüğünün ve `playwright-e2e-<attempt>` artifact'ının trace/screenshot/
   HTML/log ile 7 gün saklandığının gösterilmesi. Başarılı koşuda trace
   yüklenmemeli.
6. Ücretsiz runner/artifact kota ve faturalama durumunun hesap ayarlarından
   doğrulanması. Public repository standart Linux runner'ı hedeflenir; ücretli
   kullanım açılmaz. Bu belge ölçülmemiş dakika, depolama veya kota sayısı
   yazmaz.

## Sınırlar ve notlar

- E2E işi kalite işlerinden bağımsız kalsın diye API/web build'lerini tekrar
  eder. Bu, toplam runner süresini artırır; artifact paylaşımıyla işleri
  serileştirmemek için bilinçli tercihtir.
- Playwright tek worker ile çalışır; paylaşılan demo hesapları ve tek aktif run
  kuralı nedeniyle bu tasarım korunur. Başarısız testler otomatik yeniden
  denenmez; flaky davranış görünür kalır.
- `prepare` ve `status` destructive reset yapmaz. CI'daki servis konteyneri
  volume kullanmaz; iş bitince veri kaybolur.
- Yerel E2E koşusu, spec'lerdeki açık `page.screenshot` çağrıları nedeniyle
  `docs/evidence/phase-7-live-*.png`, `phase-7-failed-details.png` ve
  `phase-7-compare-v1-*.png` dosyalarını yeniden üretti. Bu altı görüntü P7-01
  kanıtıdır; lead teslim commit'inde bunları gözden geçirmeli veya P7-01
  kapsamında yeniden üretmelidir. P7-06'nın kendi kanıtı bu dosya ve iş akışı
  çıktılarıdır.
- Yerel doğrulamada `npm ci` yeniden çalıştırılmadı. Bu nedenle temiz kurulum
  iddiası yalnızca önceki P1-08 CI kanıtına ve bu iş akışının gerçek koşusuna
  dayanabilir.

## Gerçek GitHub Actions koşusu (2026-11-04)

- Koşu: [41885922086](https://github.com/kemselcuk/probedesk/actions/runs/41885922086), commit `3d27f2f`, `main` push.
- Sonuç: **API quality success · API integration success · Web quality success · OpenAPI contract success · Playwright E2E success · CI required success** (6/6).
- E2E işi gerçek PostgreSQL service, migration/seed, API readiness ve Chrome/Playwright ile iki senaryoyu çalıştırdı; artifact yalnız hata durumunda 7 gün.
- Bu koşu, temiz checkout'ta `npm ci` (npm 11.6.2), `.nvmrc` Node kurulumu, servis health check'i ve Playwright Chrome başlatmasını kapsar.
- Süre ve artifact boyutu için ölçülmemiş sayı yazılmadı; ayrıntı run sayfasındadır.
