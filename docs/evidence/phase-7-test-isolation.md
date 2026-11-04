# Phase 7 — test verisi ve izolasyon kanıtı (P7-05)

- Tarih: 2026-11-04
- Görev: [P7-05](../tasks/P7-05.md) — test verisi ve izolasyon
- Kapsam: Playwright fixture/temizlik desteği, ayrı E2E veritabanı runner'ı,
  seed idempotency ve reset/verify ortam korumaları
- Ortam: macOS Darwin arm64, Node.js `22.23.2`, gerçek PostgreSQL 18
  (`probedesk-postgres-test`, `127.0.0.1:5433`), Chrome (Playwright
  `channel: 'chrome'`, headless)
- Ayrı E2E veritabanı: `probedesk_e2e_test` (`127.0.0.1:5433`)
- Geliştirme veritabanı: `probedesk` (`127.0.0.1:5434`)
- Entegrasyon veritabanı: `probedesk_test` (`127.0.0.1:5433`)
- Başlangıç commit'i: Bu worker commit oluşturmadı; commit/push lead'in
  sorumluluğunda.

## Değişen dosyalar

- `tests/e2e/support/database.ts` — yeni ortak baseline/temizlik/guard modülü.
- `tests/e2e/compare.spec.ts` — yerel `pg` temizliği kaldırıldı; ortak modül,
  benzersiz plan adı ve seri worker kontrolü kullanılıyor.
- `tests/e2e/main-demo.spec.ts` — aynı geçiş; plan adı timestamp + rastgele
  sonek ile her koşuda benzersiz.
- `scripts/e2e-isolated.mjs` — ayrı E2E veritabanını oluşturan/kullanan,
  migration + demo seed uygulayan ve API/web başlatma komutlarını yazdıran
  runner (`prepare`, `seed-check`, `status`).
- `tests/e2e/README.md` — izole veritabanı, API/web başlatma, guard ve seed
  kontrolü dokümantasyonu.
- `docs/evidence/phase-7-test-isolation.md` — bu kanıt dosyası.
- `docs/tasks/P7-05.md` — durum ve kanıt alanları.

`apps/web`, `apps/api/src`, `packages`, kök `package.json`, `compose.yaml`,
`compose.test.yaml`, `docs/tasks/README.md` ve `docs/roadmap.md`
değiştirilmedi.

## İzolasyon tasarımı

### Veritabanı

Playwright testleri `E2E_DATABASE_URL` olmadan başlamaz. Önerilen akış
`TEST_DATABASE_URL` ile aynı PostgreSQL sunucusunda ayrı bir
`probedesk_e2e_test` veritabanı kullanır:

```sh
set -a
source .env
set +a
export E2E_DATABASE_URL="${TEST_DATABASE_URL%/*}/probedesk_e2e_test"
node scripts/e2e-isolated.mjs prepare
```

`prepare`:

1. Veritabanı yoksa `CREATE DATABASE` ile oluşturur; var olanı **drop etmez**.
2. `prisma migrate deploy` ile 8 migration'ı uygular.
3. Mevcut `demo:seed` komutunu çalıştırır (3 kullanıcı, 1 profil).
4. Baseline plan/run/session/aktif run sayılarını yazar.
5. API ve web için ayrı portlarla başlatma komutlarını yazar.

Çalıştırılan hazırlık:

```text
$ node scripts/e2e-isolated.mjs prepare
[e2e-isolated] creating database probedesk_e2e_test
[e2e-isolated] applying migrations with prisma migrate deploy
8 migrations found in prisma/migrations
All migrations have been successfully applied.
[e2e-isolated] running additive demo seed
Demo users ready: 3 accounts (3 created, 0 already present).
Demo device profiles ready: 1 profiles (1 created, 0 already present).
[e2e-isolated] baseline: plans=0 revisions=0 runs=0 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1
```

### API/web

API ayrı süreçte ve ayrı portta çalıştırıldı:

```sh
DATABASE_URL="$E2E_DATABASE_URL" PORT=3101 NODE_ENV=development \
  node apps/api/dist/main.js
```

`GET http://127.0.0.1:3101/api/health/ready`:

```json
{"status":"ok","checks":{"database":"ok","migrations":"ok"}}
```

Web, mevcut `apps/web` kaynaklarına dokunmadan geçici bir proxy dosyasıyla
`4300` portunda çalıştırıldı; proxy `/api` isteklerini `3101`'e yönlendirdi.
Geliştirme API/web (`3100`/`4200`) bu koşuda kullanılmadı.

### Playwright fixture ve temizlik

- Her spec kendi planını benzersiz adla oluşturur
  (`E2E Main Demo <timestamp>-<random>`, `Version consistency <timestamp>-<random>`).
  Testler arasında paylaşılan plan/run durumu yoktur.
- `prepareE2eDatabase()` her spec için:
  - `E2E_DATABASE_URL` yokluğunu hata olarak reddeder (sessiz no-op yok),
  - veritabanı adının `_test` ile bitmesini veya açık
    `E2E_ALLOW_DATABASE_CLEANUP=1` onayını arar,
  - `DATABASE_URL` ile aynı veritabanını reddeder,
  - bağlanılan veritabanı adını URL ile karşılaştırır,
  - demo seed eksikse veya `RUNNING` run varsa açık hata verir,
  - mevcut session id'lerini baseline olarak kaydeder.
- `cleanupE2eData()` yalnızca testin topladığı plan id'lerini ve testin ürettiği
  plan adlarını hedefler. Run olayları, ölçümler, run adımları, run'lar, plan
  adımları, revision'lar, step identity'leri ve planlar bu id'ler üzerinden
  silinir. Session temizliği yalnızca demo kullanıcılarının baseline sonrası
  oluşturduğu satırları siler.
- Silme işlemi tek transaction içinde yapılır; immutable/append-only
  trigger'ları `DISABLE TRIGGER USER` ile kapatılır ve aynı transaction içinde
  yeniden açılır. Hata/rollback trigger durumunu geri getirir.
- Test planına ait `RUNNING` run varsa temizlik en fazla 20 saniye bekler;
  hâlâ aktifse veri silmeyi reddeder.
- Temizlik sonunda kalan plan/run/aktif run/session sayıları doğrulanır; sıfır
  değilse test hata verir.
- Playwright `workers: 1` ile çalışır. `assertE2eSerialExecution` iki veya daha
  fazla worker'ı açık hatayla reddeder; paylaşılan demo oturumları ve tek aktif
  run kuralı böylece çakışmaz.

## Çalıştırılan kontroller ve gerçek sonuçlar

### Test listesi

```text
$ npx playwright test --list
Listing tests:
  compare.spec.ts:111:5 › compares a failed v1 run with v2 after the tolerance changed to 0.65 A
  main-demo.spec.ts:360:5 › runs the main demo flow through plans, live execution, history, compare and v2
Total: 2 tests in 2 files
```

### Tam suite — normal sıra

```text
$ E2E_DATABASE_URL=...probedesk_e2e_test E2E_API_URL=http://127.0.0.1:3101 \
  E2E_BASE_URL=http://127.0.0.1:4300 npm run test:e2e

Running 2 tests using 1 worker

[e2e-db] baseline 127.0.0.1:5433/probedesk_e2e_test: plans=0 runs=0 sessions=0 activeRuns=0
[e2e-db] cleanup ...: plans=1 revisions=2 planSteps=6 stepIdentities=3 runs=2 runSteps=6
  measurements=19 runEvents=35 sessions=3 activeRuns=0
  ✓  1 tests/e2e/compare.spec.ts:111:5 › compares a failed v1 run with v2 after the tolerance changed to 0.65 A (8.3s)
[e2e-db] baseline 127.0.0.1:5433/probedesk_e2e_test: plans=0 runs=0 sessions=0 activeRuns=0
[e2e-db] cleanup ...: plans=1 revisions=2 planSteps=6 stepIdentities=3 runs=3 runSteps=9
  measurements=72 runEvents=96 sessions=2 activeRuns=0
  ✓  2 tests/e2e/main-demo.spec.ts:360:5 › runs the main demo flow through plans, live execution, history, compare and v2 (56.7s)

  2 passed (1.1m)
```

### Tam suite — farklı sıra

`--shuffle=705` ile dosya sırası değiştirildi; `main-demo` önce, `compare`
sonra çalıştı:

```text
$ npx playwright test --shuffle=705
Running 2 tests using 1 worker, shuffle seed 705

  ✓  1 tests/e2e/main-demo.spec.ts:360:5 › runs the main demo flow through plans, live execution, history, compare and v2 (34.3s)
  ✓  2 tests/e2e/compare.spec.ts:111:5 › compares a failed v1 run with v2 after the tolerance changed to 0.65 A (7.7s)

  2 passed (43.7s)
```

İki spec normal sırada ve `--shuffle=705` ile ters sırada geçti; her spec kendi
benzersiz planını oluşturup kendi verisini temizliyor. Her iki sırada da temizlik
sonrası `status` çıktısı sıfır plan/run/session gösterdi.

### Suite sonrası veritabanı durumu

```text
$ node scripts/e2e-isolated.mjs status
[e2e-isolated] 127.0.0.1:5433/probedesk_e2e_test
[e2e-isolated] status: plans=0 revisions=0 runs=0 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1
```

### Seed idempotency

İzole E2E veritabanında `seed-check` iki kez `demo:seed` çalıştırdı:

```text
$ node scripts/e2e-isolated.mjs seed-check
[e2e-isolated] before seed: plans=0 revisions=0 runs=0 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1
Demo users ready: 3 accounts (0 created, 3 already present).
Demo device profiles ready: 1 profiles (0 created, 1 already present).
[e2e-isolated] after first seed : plans=0 revisions=0 runs=0 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1
[e2e-isolated] first seed: history and demo fixture digests unchanged
Demo users ready: 3 accounts (0 created, 3 already present).
Demo device profiles ready: 1 profiles (0 created, 1 already present).
[e2e-isolated] after second seed: plans=0 revisions=0 runs=0 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1
[e2e-isolated] second seed: history and demo fixture digests unchanged
```

Kullanıcı geçmişi olan geliştirme veritabanında (`2 plan, 36 run`) doğrudan
`npm run demo:seed` iki kez çalıştırıldı:

```text
önce:  2 plans, 36 runs, 271 sessions
1. seed: Demo users ready: 3 accounts (0 created, 3 already present).
         Demo device profiles ready: 1 profiles (0 created, 1 already present).
sonra: 2 plans, 36 runs, 271 sessions
2. seed: Demo users ready: 3 accounts (0 created, 3 already present).
         Demo device profiles ready: 1 profiles (0 created, 1 already present).
sonra: 2 plans, 36 runs, 271 sessions
```

Plan ve run sayıları ile kullanıcı geçmişi değişmedi. Seed yalnızca eksik demo
kullanıcısını/profilini ekler; mevcut satırları güncellemez.

### Guard reddi kontrolleri

```text
# E2E_DATABASE_URL yok
REFUSED: E2E_DATABASE_URL is required for the Playwright suite.

# _test ile bitmeyen veritabanı adı
REFUSED: Refusing destructive E2E cleanup: E2E_DATABASE_URL points at "probedesk_e2e",
which does not end with "_test".

# Geliştirme veritabanı
REFUSED: Refusing destructive E2E cleanup: E2E_DATABASE_URL points at "probedesk",
which does not end with "_test".

# Açık override + geliştirme veritabanı
REFUSED: Refusing destructive E2E cleanup: E2E_DATABASE_URL points at the development
database (localhost:5434/probedesk).
```

Reset helper'ları da yanlış ortamı reddetti:

```text
$ NODE_ENV=development npm run db:reset:test --workspace apps/api
Refusing to use the test database because NODE_ENV is not "test".
exit=1

$ NODE_ENV=test TEST_DATABASE_URL="$DATABASE_URL" npm run db:reset:test --workspace apps/api
Refusing to use the test database because TEST_DATABASE_URL points at the development database.
exit=1
```

### Seri worker guard'ı

Negatif kontrol olarak `--workers=2` çalıştırıldı; test verisi oluşturmadan
açık hata verdi:

```text
$ npx playwright test tests/e2e/compare.spec.ts --workers=2
1 failed
Error: The shared E2E database requires exactly one Playwright worker; received 2.
Run with "--workers=1" or give each worker its own database.
```

### API entegrasyon suite'i

```text
$ npm run test:e2e --workspace apps/api
Test Files  21 passed (21)
     Tests  195 passed (195)
  Duration  51.72s
```

### verify

İlk `npm run verify` çağrısı `test:web` aşamasında iki mevcut web testinde
`el.scrollTo is not a function` nedeniyle 5 sn timeout ile durdu:

```text
Test Files  2 failed | 34 passed (36)
     Tests  2 failed | 365 passed (367)
```

Bu iki test `apps/web` sahiplik alanındadır ve bu worker tarafından
değiştirilmedi; aynı hata P7-02/P7-03 kanıtında da raporlanmıştı. Hemen ardından
`npm run test:web` tek başına geçti (36 dosya, 367 test). İkinci tam `verify`
koşusu uçtan uca geçti:

```text
$ npm run verify
lint:       0 warning, 0 error (API 143 dosya, web 113 dosya, client 2 dosya)
typecheck:  çıkış kodu 0
test:api:unit: 16 dosya, 118 test geçti
test:web:      36 dosya, 367 test geçti
build:         API nest build + web production build başarılı
openapi:check: OpenAPI contract is current
```

`verify` betiği reset/seed içermez. Koşu öncesi ve sonrası geliştirme
veritabanında plan/run sayıları `2/36` kaldı; yalnızca başka çalışan geliştirme
süreçlerinin açtığı session sayısı değişti (`271 → 286`). `verify` kullanıcı
plan/run geçmişini sıfırlamadı.

## Kabul ölçütleri eşlemesi

| Ölçüt | Kanıt |
|---|---|
| Test sonucu yürütme sırasına bağlı değildir. | İki spec normal sırada (compare → main) ve `--shuffle=705` ile ters sırada (main → compare) geçti; her spec kendi benzersiz planını oluşturup kendi verisini temizliyor. |
| Tek aktif run kuralı nedeniyle ortak DB kullanan testler kontrollüdür. | Playwright `workers: 1`; `assertE2eSerialExecution` 2 worker'ı reddetti. `prepareE2eDatabase` başlangıçta aktif run varsa durur; temizlik kendi planının run'ı bitene kadar bekler, sonra siler. Suite sonrası `activeRuns=0`. |
| Demo seed tekrarında kullanıcı geçmişi ezilmez. | İzole DB'de `seed-check` iki kez; geliştirme DB'sinde `demo:seed` iki kez. Plan/run sayıları ve digest'ler değişmedi. |
| Reset yanlış ortamı reddeder; verify kullanıcı DB'sini sıfırlamaz. | `db:reset:test` NODE_ENV=development ve TEST_DATABASE_URL=dev için exit 1 verdi. `verify` reset içermiyor; önce/sonra plan=2, run=36. |

## Riskler, sınırlar ve ertelenen işler

- **Web test flakiness:** İlk `verify` koşusundaki iki `scrollTo` timeout'u
  `apps/web` kaynaklı ve bu worker'ın kapsamı dışında. İkinci koşu geçti; yine
  de flaky davranış P7-06 CI'da görünür izlenmeli.
- **Paylaşılan demo hesapları:** Paralel worker desteği yoktur. Her worker'a
  ayrı veritabanı/schema veya ayrı kullanıcı vermek ayrı bir tasarım işidir;
  mevcut sözleşme seri çalışmayı açıkça zorunlu kılar.
- **Çökme sonrası artıklar:** Normal test hatası `afterAll` ile temizlenir.
  Süreç SIGKILL/çökme ile ölürse plan/run kalabilir; sonraki `status` bunu
  gösterir ancak runner otomatik silmez. Bu, kullanıcı verisini yanlışlıkla
  silmeme tercihinin bilinçli sonucudur. API yeniden başlatıldığında recovery
  RUNNING run'ı INTERRUPTED yapar; `prepare` yine de aktif run görürse açık hata
  verir.
- **`.env.example`:** Kök dosyadaki `E2E_DATABASE_URL` örneği hâlâ
  `probedesk_test`'i gösteriyor; kök config bu worker'ın sahiplik alanı dışında.
  README'deki `${TEST_DATABASE_URL%/*}/probedesk_e2e_test` türetmesi kullanılmalı
  veya lead `.env.example`'ı ayrı bir değişiklikle güncellemeli.
- **Kanıt ekran görüntüleri:** `main-demo.spec.ts` koşarken
  `docs/evidence/phase-7-live-running.png` ve diğer P7-01 ekran görüntülerini
  yeniden yazar. Bu worker yalnızca bu kanıt dosyasını ve P7-05 kartını
  düzenledi; ikili ekran görüntüsü değişiklikleri testin doğal çıktısıdır.
- **İnceleme:** Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı. Kart
  `In Review`; `Accepted` değil. `docs/tasks/README.md` ve `docs/roadmap.md` bu
  worker'ın sahiplik alanı dışında olduğu için güncellenmedi; lead'in aynı
  commit'te güncellemesi gerekir.
