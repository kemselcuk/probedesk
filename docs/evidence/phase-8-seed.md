# Phase 8 — hazır örnek veri kanıtı (P8-02)

- Tarih: 2026-11-04
- Görev: [P8-02](../tasks/P8-02.md) — hazır örnek veriler
- Kapsam: üç demo hesap, `DC Power Module` profili, iki yayımlanmış sürümlü
  `Power Supply Validation` planı ve gerçek simülatör/değerlendiriciyle üretilmiş
  dört geçmiş çalıştırma
- Ortam: yerel PostgreSQL, API `http://127.0.0.1:3100`, test veritabanı
  `probedesk_test` (`127.0.0.1:5433`)

## Demo hesapları

Bu parolalar yalnızca yerel demo içindir; üretimde kullanılmaz. Seed mevcut bir
hesabın rolünü veya parolasını hiçbir zaman güncellemez.

| Rol | E-posta | Parola |
|---|---|---|
| Planner | `planner@probedesk.local` | `PlannerDemo!2026` |
| Operator | `operator@probedesk.local` | `OperatorDemo!2026` |
| Viewer | `viewer@probedesk.local` | `ViewerDemo!2026` |

## Üretilen plan ve sürümler

Profil: `DC Power Module` (`DC_POWER_MODULE`). Plan adı:
`Power Supply Validation`.

| Sürüm | Durum | Adımlar | Current Draw maksimumu |
|---|---|---|---|
| v1 | PUBLISHED | Output Voltage 4.75–5.25 V; Current Draw 0.45–0.55 A; Case Temperature 20–60 °C; 30 örnek × 200 ms | `0.550000` |
| v2 | PUBLISHED | v1 ile aynı üç adım ve aynı `logicalStepId` değerleri | `0.650000` |

v2 yalnızca Current Draw üst sınırını değiştirir. Adım kimlikleri iki sürümde de
korunur. Yayımlanmış sürümler ve adımları sonraki seed çalıştırmalarında
güncellenmez veya silinmez.

## Hazır çalıştırmalar

Değerler, sayaçlar, istatistikler ve sonuçlar doğrudan şu üretim koduyla
hesaplanır:

- `src/simulator` → `simulate(...)`
- `src/runs/measurement-evaluation.ts` → `evaluateMeasurementValue`,
  `advanceFailureProgress`, `calculateStatistics`, `stepOutcome`, `runOutcome`
- `src/runs/run-snapshot.ts` → `buildRunSnapshot`
- `src/runs/run-start.ts` → `hashRunStartRequest`

Bu nedenle seed içinde sabit `PASSED`/`FAILED` etiketi, sabit ölçüm değeri veya
sabit sayaç yoktur.

| Fixture | Sürüm | Senaryo / seed | Durum | Sonuç | Beklenen / kaydedilen | Son olay |
|---|---|---|---|---|---|---|
| Partial cancelled v1 | v1 | NORMAL / 42 | CANCELLED | — | 90 / 45 | 50 |
| Forced failure v1 | v1 | FORCED_FAILURE / 42 | COMPLETED | FAILED | 90 / 90 | 98 |
| Normal v1 | v1 | NORMAL / 42 | COMPLETED | PASSED | 90 / 90 | 98 |
| Normal v2 | v2 | NORMAL / 42 | COMPLETED | PASSED | 90 / 90 | 98 |

Yerel geliştirme veritabanındaki gerçek kimlikler:

| Fixture | Run id | Plan id |
|---|---|---|
| Partial cancelled v1 | `94f1c52b-ed83-4acd-b00d-f825a6882985` | `64f096b1-8fdf-4c59-966f-c1af663699c8` |
| Forced failure v1 | `20e8fcf4-5f15-4296-ba39-3a2b5c8df21a` | `64f096b1-8fdf-4c59-966f-c1af663699c8` |
| Normal v1 | `b0231f27-9b59-4446-be68-f1fd5eced0d5` | `64f096b1-8fdf-4c59-966f-c1af663699c8` |
| Normal v2 | `46e6388d-8d28-449d-85f2-5739e9fe82ac` | `64f096b1-8fdf-4c59-966f-c1af663699c8` |

Forced failure ayrıntısı: Current Draw adımı, sıfır tabanlı `sampleIndex=14`
(kullanıcıya göre 15. örnek) değerinde `0.600000 A` üretir; üst sınır
`0.550000 A` olduğu için `isWithinTolerance=false`, `outOfToleranceCount=1`,
`firstFailureSampleIndex=14` ve adım sonucu `FAILED` olur. Aynı `0.600000 A`
değeri v2'nin `0.650000 A` sınırı içindedir. v2 NORMAL çalıştırmasında Current
Draw örneklerinin 14 tanesi v1'in `0.550000 A` sınırını aşar; v2'de hepsi
tolerans içindedir.

Kısmi çalıştırma: Output Voltage 30/30 tamamlanır; Current Draw 15/30 örnekte
`CANCELLED` olur; Case Temperature `NOT_RUN` kalır. Kısmi adımın istatistikleri
`null` kalır; tamamlanmış adımın istatistikleri korunur.

## Idempotence

`npm run demo:seed` planı şu sırayla tanır:

1. Demo run idempotency anahtarlarından birine sahip plan (en güçlü marker).
2. Aynı Planner, `Power Supply Validation` adı ve birebir v1/v2 kurallarıyla
   eşleşen tek plan.
3. Hiçbiri yoksa yeni plan.

Eşleşen plan varsa yalnızca eksik run'lar eklenir. Var olan published sürüm,
run, ölçüm veya olay satırı güncellenmez/silinmez. Birden fazla aday varsa seed
tahmin yürütmez ve açık bir çakışma hatasıyla durur.

İlk çalıştırma (yerel geliştirme veritabanında hesaplar zaten vardı; uygun plan yoktu):

```text
$ npm run demo:seed
Demo users ready: 3 accounts (0 created, 3 already present).
Demo device profiles ready: 1 profiles (0 created, 1 already present).
Demo plan ready: Power Supply Validation (created), 2 published versions, 4 runs (4 created, 0 already present).
  - Partial cancelled v1: CANCELLED/- (created)
  - Forced failure v1: COMPLETED/FAILED (created)
  - Normal v1: COMPLETED/PASSED (created)
  - Normal v2: COMPLETED/PASSED (created)
```

Sonraki çalıştırmalar (ikisi de aynı çıktıyı verdi):

```text
$ npm run demo:seed
Demo users ready: 3 accounts (0 created, 3 already present).
Demo device profiles ready: 1 profiles (0 created, 1 already present).
Demo plan ready: Power Supply Validation (existing), 2 published versions, 4 runs (0 created, 4 already present).
  - Partial cancelled v1: CANCELLED/- (existing)
  - Forced failure v1: COMPLETED/FAILED (existing)
  - Normal v1: COMPLETED/PASSED (existing)
  - Normal v2: COMPLETED/PASSED (existing)
```

Yerel geliştirme veritabanında P8-02 öncesinden kalan, aynı adlı fakat farklı
kurallı iki plan bulunuyordu. Seed bunları değiştirmedi veya silmedi; kendi
fixture'ını ayrı bir plan olarak oluşturdu. Bu nedenle bu ortamda Planner plan
listesinde aynı adlı birden fazla plan görünebilir. Temiz bir veritabanında tek
plan oluşur. Bu davranış, "çakışan fixture sessizce ezilmez" kuralının gereğidir.

## Test veritabanı doğrulaması

Test dosyası: [`apps/api/test/seed-demo-data.e2e-spec.ts`](../../apps/api/test/seed-demo-data.e2e-spec.ts)

Testin doğruladıkları:

- Üç hesap, doğru roller ve Argon2id parola doğrulaması.
- Tek `DC Power Module` profili.
- İki published sürüm, birebir adım kuralları, v1/v2 Current Draw farkı ve
  korunmuş `logicalStepId` değerleri.
- Dört run'ın durum/sonuçları, 90/90 ve 90/45 sayaçları, 98/98/98/50 olay
  dizileri ve gap-free `1..N` sequence değerleri.
- FAILED Current Draw `sampleIndex=14` değerinin `0.600000` olması.
- Kısmi run'da adım durumlarının `COMPLETED`, `CANCELLED`, `NOT_RUN` olması.
- İkinci seed öncesi/sonrası tablo sayıları ve SHA-256 satır özetleri:
  `3` kullanıcı, `1` profil, `1` plan, `2` revision, `6` plan adımı,
  `3` step identity, `4` run, `12` run adımı, `315` ölçüm, `344` olay.
  İkinci çalıştırmada bütün özetler ve sayılar aynı kaldı; `created` sayıları
  sıfırdı.

```text
$ npx vitest run test/seed-demo-data.e2e-spec.ts --config ./vitest.config.e2e.ts
 RUN  v4.1.12 /Users/kemalselcuk/.t3/projects/probedesk/apps/api

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  19:38:01
   Duration  1.63s (transform 136ms, setup 173ms, import 176ms, tests 1.11s, environment 0ms)
```

## API üzerinden inceleme

`operator@probedesk.local` ile giriş yapılıp yayımlanmış run snapshot'ları
okundu. Forced failure API yanıtı (özet):

```json
{
  "planName": "Power Supply Validation",
  "versionNumber": 1,
  "status": "COMPLETED",
  "outcome": "FAILED",
  "scenario": "FORCED_FAILURE",
  "seed": 42,
  "expectedSampleCount": 90,
  "recordedSampleCount": 90,
  "lastEventSequence": 98,
  "steps": [
    { "name": "Output Voltage", "status": "COMPLETED", "outcome": "PASSED" },
    {
      "name": "Current Draw",
      "maximum": "0.550000",
      "status": "COMPLETED",
      "outcome": "FAILED",
      "outOfToleranceCount": 1,
      "firstFailureSampleIndex": 14,
      "sample14": "0.600000"
    },
    { "name": "Case Temperature", "status": "COMPLETED", "outcome": "PASSED" }
  ]
}
```

v2 API yanıtı: `COMPLETED/PASSED`, Current Draw maksimumu `0.650000`, 14 örnek
v1'in `0.550000` sınırının üzerinde. Kısmi run API yanıtı:
`CANCELLED`, 90 beklenen / 45 kaydedilen örnek, `lastEventSequence=50`, adım
durumları `COMPLETED/CANCELLED/NOT_RUN`.

## Çalıştırılan kontroller

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 644ms on 144 files with 107 rules using 8 threads.
```

```text
$ npm run typecheck
@probedesk/api typecheck: tsc --noEmit -p tsconfig.json
@probedesk/web typecheck: tsc -p tsconfig.app.json --noEmit
@probedesk/api-client typecheck: tsc --noEmit -p tsconfig.json
(üçü de hatasız tamamlandı)
```

```text
$ npm run test --workspace apps/api
 Test Files  16 passed (16)
      Tests  118 passed (118)
   Start at  19:33:13
   Duration  2.51s
```

```text
$ npm run db:migrate:test --workspace apps/api
Applying migrations to the isolated test database.
Datasource "db": PostgreSQL database "probedesk_test", schema "public" at "127.0.0.1:5433"
8 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npm run test:e2e --workspace apps/api
 Test Files  22 passed (22)
      Tests  197 passed (197)
   Start at  19:38:07
   Duration  82.09s (transform 1.68s, setup 4.27s, import 10.50s, tests 62.32s, environment 2ms)
```

```text
$ npm run build
> @probedesk/api build: nest build
> @probedesk/web build: ng build
Application bundle generation complete. [4.622 seconds]
Output location: /Users/kemalselcuk/.t3/projects/probedesk/apps/web/dist/web
```

## Korunan demo reset

`npm run demo:seed` asla reset içermez. Ayrı script yalnızca açık onay ve demo
veritabanı adıyla çalışır; script `apps/api` dizininden şu şekilde çağrılır:

```text
$ cd apps/api
$ PROBEDESK_DEMO_RESET=confirm npx tsx prisma/seed-reset.ts
```

Onay olmadan ve demo olmayan veritabanında gerçek çıktılar:

```text
$ npx tsx prisma/seed-reset.ts
Refusing to reset demo data without PROBEDESK_DEMO_RESET=confirm.
(exit 1)

$ DATABASE_URL='postgresql://demo:demo@127.0.0.1:5432/postgres' PROBEDESK_DEMO_RESET=confirm npx tsx prisma/seed-reset.ts
Refusing to reset database "postgres". Use the local demo database "probedesk" or a name ending in "_demo".
(exit 1)
```

Reset işlemi `NODE_ENV=production` değerini, `PROBEDESK_DEMO_RESET=confirm`
onayını ve veritabanı adının `probedesk` veya `_demo` ile bitmesini ister.
Silme yolu testlerde `deleteDemoSeedFixture` üzerinden çalıştırılır; yerel
geliştirme veritabanında yıkıcı reset çalıştırılmadı.

## Kalan riskler

- `npm run demo:reset` paket script'i eklendi ve guard'lı `prisma/seed-reset.ts`
  dosyasına bağlandı; yıkıcı reset yerel kullanıcı verisinde çalıştırılmadı.
- Yerel geliştirme veritabanındaki eski, aynı adlı planlar silinmedi; temiz demo
  sunumu için korumalı reset veya yeni bir veritabanı kullanılmalı.
- `docs/demo.md`, `docs/tasks/README.md` ve `docs/roadmap.md` durum/bağlantı
  güncellemeleri tamamlandı.
- Bu görev `Accepted`; bağımsız inceleme kaydı `docs/evidence/phase-8-review.md`.
