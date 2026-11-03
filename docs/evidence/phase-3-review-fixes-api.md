# Phase 3 inceleme düzeltmeleri — API

- Tarih: 2026-11-03.
- Kapsam: `docs/evidence/phase-3-review.md` içindeki B3, B4, B5, B7, B8, B10, B12 ve B14 bulgularının backend tarafı.
- İnceleme hedefi: `66676b7` ürün kodu; bu düzeltme turunda ürün kodu değişti.
- Ortam: macOS arm64, Node.js `22.23.2`, PostgreSQL 18.1; test DB `127.0.0.1:5433`.
- Bu kayıt ürün kabulü değildir. Görev kartları `In Review` kalır; hiçbir görev `Accepted` yapılmadı.
- Bu worker git komutu çalıştırmadı; commit/push lead tarafından yapılacak.

## Kapatılan bulgular

### B3 — Eşzamanlı başlangıç yarışında 500 yerine 409/202

`RunsService.start` artık create transaction'ını en fazla üç kez dener
(`MAX_START_ATTEMPTS = 3`). Bir unique ihlalinde sırasıyla:

1. Aynı kullanıcı/anahtar kaydı okunur; varsa idempotent replay döner.
2. `RUNNING` satır okunur; varsa `409 RUN_ALREADY_ACTIVE` ve `details.activeRunId` döner.
3. İkisi de yoksa (kazanan terminal olmuş ve index slotu boşalmışsa) create yeniden denenir.
4. Yalnız üç denemede de aktif satır yoksa orijinal beklenmeyen hata yüzeye çıkar.

Deterministik testler `apps/api/test/runs.e2e-spec.ts` içinde:

- `retries a unique loser once when the winning run is already terminal`: ilk `$transaction`
  çağrısı yapay `P2002` ile reddedilir, DB'de `RUNNING` satır yoktur; ikinci deneme gerçek
  transaction'ı çalıştırır ve yanıt `202` olur. İki çağrı doğrulanır ve tek run oluşur.
- `surfaces an unexpected error only after every start retry fails`: üç deneme de `P2002`
  alır ve aktif satır yoktur; yanıt `500 INTERNAL_ERROR` olur, run oluşmaz.
- Mevcut iki eşzamanlı farklı anahtar testi (üç tur, `202` + `409`) korunur.
- Mevcut aynı anahtar/aynı gövde yarışı (`200` + `202`) korunur.

### B4 — DB kesintisi sonrası bayat RUNNING ve cache'lenmiş recovery

`RunRecoveryService` artık bir başarıyı koşulsuz cache'lemiyor:

- `markDirty()` `completed=false`, `dirty=true` yapar ve bir generation sayacını artırır.
- `RunExecutor.recordTechnicalFailure` teknik hata yazımı başarısız olduğunda
  `markDirty()` çağırır.
- `ensureCompleted()` yalnız `completed && !dirty` iken cache'e güvenir; aksi halde recovery
  yeniden çalışır.
- Recovery pass'i sırasında gelen `markDirty()`, pass'in başarıyı cache'lemesini engeller
  (`finishPass(generation)`). Böylece yanlış başarı cache'lenmez.
- Readiness (503 `startup: pending`) ve yeni `POST /runs` (503) recovery başarılana kadar
  reddeder; DB döndüğünde readiness kendisi recovery'yi çalıştırır ve stale run INTERRUPTED olur.

Test `apps/api/test/runs-recovery.e2e-spec.ts`:
`invalidates a cached recovery when the technical failure write fails`.

- İlk örnek commit edildikten sonra `test_runs` UPDATE'leri ve ölçüm insert'i gerçek DB
  trigger'larıyla engellenir.
- Executor ölçüm hatasını ERROR olarak yazamaz; `isDirty=true`, `isComplete=false` doğrulanır.
- Aynı süreçte readiness `503` ve yeni start `503` döner.
- Trigger'lar kaldırılınca readiness `200` olur; run `INTERRUPTED/SERVER_RESTART` olur ve
  yeni start `202` kabul edilir. Süreç yeniden başlatılmaz.

### B5 — Kontrollü kapanışta in-flight COMPLETED commit'i

- `RunExecutor.beginShutdown()` `shuttingDown` bayrağını kalıcı olarak set eder, timer/waiter'ları
  durdurur; `onModuleDestroy()` bunu çağırır.
- `completeRun` transaction'ı kilit alındıktan ve sonuç hesaplandıktan sonra terminal UPDATE'ten
  hemen önce bayrağı yeniden kontrol eder. Kapanış varsa `RunStoppedError` ile transaction
  rollback edilir; run `RUNNING` kalır. Event insert'inden sonra da ikinci bir kontrol vardır.

Test `apps/api/test/runs-execution.e2e-spec.ts`:
`leaves the run RUNNING when shutdown begins inside finalization`.

- Kontrollü scheduler, son örneğin ardından `completeRun` içindeki `now()` çağrısında
  `beginShutdown()` tetikler; yani kapanış terminal UPDATE'ten önce, işlem içinde başlar.
- Run `RUNNING`, `outcome=null`, `finishedAt=null`, `recordedSampleCount=6` kalır; üç adım
  COMPLETED olsa da `run.completed` olayı yazılmaz.
- Mevcut timer bekleme noktasındaki kontrollü kapanış testi korunur.

### B7 — Cancel/recovery `finishedAt` commit sırası

`RunCancellationService.cancel` ve `RunRecoveryService.recoverRun` artık transaction içinde önce
`SELECT ... FOR UPDATE` ile run satırını kilitler, sonra `finishedAt` üretir. Böylece bir adım
tamamlama kilidi önce aldıysa terminal zaman o commit'ten sonra hesaplanır; `run.cancelled` /
`run.interrupted` olay zamanı da aynı değeri kullanır.

Test `apps/api/test/runs-cancel.e2e-spec.ts`:
`computes cancel finishedAt after waiting for the run row lock`.

- Ayrı bir transaction run satırını tutar; cancel isteği `pg_locks` ile beklediği doğrulanır.
- 50 ms sonra kilit bırakılır; cancel `finishedAt` değeri kilit bırakılma zamanından önce olamaz.
  Eski kod `finishedAt`'i kilitten önce hesapladığı için bu testi geçemez.
- `run.cancelled` olayının `occurredAt` değeri run `finishedAt` ile aynıdır.

### B8 — `elapsedMs` adım başlangıcından itibaren

`RunExecutor.execute` monotonik referansı `beginStep` çağrısından **önce**, `startedAt` ile aynı
noktada alır. İlk örneğin `elapsedMs` değeri böylece `step.started` commit süresini de içerir.

Test `apps/api/test/runs-execution.e2e-spec.ts`:
`includes the beginStep commit duration in the first sample elapsedMs`.

- Gerçek monotonik saatli, kontrollü timer'lı scheduler kullanılır.
- `run_events` üzerindeki test trigger'ı `step.started` insert'ini 150 ms geciktirir.
- İlk örneğin `elapsedMs >= 120` olması beklenir; referans commit'ten sonra alınsaydı değer
  kontrollü interval civarında (yaklaşık 0-5 ms) kalırdı.

### B10 — Terminal yazma testi ve cancel-vs-completion yarışı

- Eski `rejects duplicate terminal writes and a stale executor restart` testi
  `rejects duplicate measurement inserts and a stale executor restart after completion` olarak
  yeniden adlandırıldı; artık yalnız duplicate insert ve stale executor restart'ı test ediyor.
- Yeni `rejects new measurements, rule edits and stale step writes after the run is terminal`
  testi COMPLETED bir run üzerinde gerçek DB yoluyla şunları reddeder:
  - yeni `measurement` insert'i (terminal run trigger'ı),
  - COMPLETED adımı yeniden RUNNING yapma (terminal step durumu),
  - adım kural kopyası (`minimum`) değiştirme,
  - run snapshot alanı (`planNameSnapshot`) değiştirme.
- `apps/api/test/runs-cancel.e2e-spec.ts` içindeki
  `keeps exactly one terminal state when cancel races final completion` testi kontrollü
  scheduler ile son örnek sınırında cancel isteği ile completion'ı yarıştırır. Sonuç
  CANCELLED veya COMPLETED olabilir; tam olarak bir terminal olay, tutarlı sayaç/finishedAt,
  terminal olaydan sonra ölçüm olmaması ve cancel yanıtının gerçek terminal durumu döndürmesi
  doğrulanır.

### B12 — DB seviyesinde run history immutability

Yeni migration: `apps/api/prisma/migrations/20261103200000_run_immutability/migration.sql`.
Manifest'e `20261103200000_run_immutability` eklendi (7 migration).

- `test_runs` BEFORE UPDATE trigger'ı snapshot alanlarını (`planId`, `planRevisionId`, plan
  adı/sürüm/profile, requestedBy, scenario/seed/probability/failureStep, simulator/evaluation
  sürümleri, idempotencyKey/requestHash, expectedSampleCount, startedAt) değiştirmeyi reddeder.
- Terminal run durumundan başka duruma geçişi reddeder.
- `run_steps` BEFORE UPDATE trigger'ı kural kopyalarını (runId, logicalStepId, position, ad,
  birim, min/max, sampleCount, intervalMs) değiştirmeyi ve terminal adım durumundan geçişi
  reddeder.
- `measurements` BEFORE INSERT trigger'ı terminal run'a yeni ölçüm eklemeyi reddeder; satırı
  `FOR SHARE` ile kilitleyerek terminal geçişle sıralar.

Testler:

- `runs-schema.e2e-spec.ts` yeni testleri: `keeps the documented check constraints alongside
  the immutability triggers` ve `rejects snapshot and rule-copy changes and new measurements
  on a terminal run`. CHECK kısıtlarının varlığı katalogdan, immutability davranışı gerçek
  UPDATE/INSERT denemeleriyle doğrulanır.
- Eski CHECK testleri, artık immutability trigger'ının önce çalıştığı alanlardan arındırıldı;
  kalan lifecycle/sayaç CHECK'leri gerçek UPDATE ile test edilmeye devam ediyor.
- Terminal run'a ölçüm ekleme ve kural kopyası değiştirme testleri `runs-execution.e2e-spec.ts`
  içinde de servis/DB yolunda doğrulanır.

### B14 — `eventsUrl` yalnız P4'te kullanılabilir

Kod değişikliği yok. `eventsUrl` başlangıç yanıtı sözleşmesinin parçası olarak kalır; SSE ucu
P4 kapsamındadır ve Phase 3'te bu adres 404 döner. P3-04 kanıt kaydına bu kapsam notu eklendi.
P3-10 kartı bu worker'ın sahiplik alanı dışındadır; aynı notun web/lead tarafından P3-10
kanıtına işlenmesi gerekir.

## Değişen dosyalar

- `apps/api/src/runs/runs.service.ts`
- `apps/api/src/runs/run-recovery.service.ts`
- `apps/api/src/runs/run-executor.ts`
- `apps/api/src/runs/run-cancel.service.ts`
- `apps/api/src/prisma/migration-manifest.ts`
- `apps/api/prisma/migrations/20261103200000_run_immutability/migration.sql`
- `apps/api/test/runs.e2e-spec.ts`
- `apps/api/test/runs-execution.e2e-spec.ts`
- `apps/api/test/runs-cancel.e2e-spec.ts`
- `apps/api/test/runs-recovery.e2e-spec.ts`
- `apps/api/test/runs-schema.e2e-spec.ts`
- `docs/tasks/P3-04.md`, `docs/tasks/P3-05.md`, `docs/tasks/P3-07.md`, `docs/tasks/P3-08.md`
- Bu kanıt dosyası

## Çalıştırılan komutlar ve gerçek sonuçlar

Sırayla, son kod üzerinde:

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 351ms on 115 files with 107 rules using 8 threads.
exit=0
```

```text
$ npm run typecheck --workspace apps/api
tsc --noEmit -p tsconfig.json
exit=0 (hata çıktısı yok)
```

```text
$ npm run test --workspace apps/api
Test Files  14 passed (14)
Tests       97 passed (97)
Duration    635ms
exit=0
```

```text
$ npm run db:migrate:test --workspace apps/api
7 migrations found in prisma/migrations
No pending migrations to apply.
exit=0
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  16 passed (16)
Tests       151 passed (151)
Duration    18.08s
exit=0
```

```text
$ npm run build --workspace apps/api
nest build
exit=0
```

```text
$ npm run openapi:emit
Wrote OpenAPI document to .../apps/api/openapi.json
exit=0
```

`openapi:emit` sonrası `apps/api/openapi.json` ve `packages/api-client/src/schema.ts` için diff
yoktur; API yüzeyi değişmedi.

Ek kararlılık turu (aynı beş değişen e2e dosyası, üç kez):

```text
$ npx vitest run --config ./vitest.config.e2e.ts test/runs-execution.e2e-spec.ts test/runs-cancel.e2e-spec.ts test/runs-recovery.e2e-spec.ts test/runs-schema.e2e-spec.ts test/runs.e2e-spec.ts
Test Files  5 passed (5)
Tests       52 passed (52)
(üç turda da aynı sonuç)
exit=0
```

## Kalan riskler / doğrulanamayan sınırlar

- B5: son kontrol ile transaction commit arasında kalan çok dar pencere tamamen kapatılamaz;
  kontrol terminal UPDATE'ten önce ve event insert'inden sonra yapılır. Kapanışın DB commit'i ile
  yarıştığı gerçek SIGTERM penceresi yine gerçek süreç sinyaliyle tetiklenmedi; test işlem içi
  `beginShutdown()` ile deterministik.
- B4: `markDirty()` süreç içi bir sinyaldir. Tek API süreci varsayımı sürer; çok süreçli bir
  kurulumda başka sürecin bıraktığı RUNNING satırı için readiness zamanla tetiklenen bir
  uzlaştırma değildir. DB tamamen kapalıyken readiness zaten 503 döner; testte DB kesintisi
  güvenli biçimde container durdurularak değil, gerçek DB trigger'larıyla simüle edildi.
- B3: üç denemeden sonra hâlâ aktif satır yoksa kod bilinçli olarak orijinal hatayı yüzeye
  çıkarır (500). Bu, index ile görünür satır arasında kalıcı bir tutarsızlık anlamına gelir;
  normal terminalizasyon yarışında ulaşılmaz.
- B7: recovery tarafındaki kilit-sonrası zaman hesabı kod incelemesiyle doğrulandı; ayrı bir
  recovery kilit yarışı testi eklenmedi. Cancel tarafı gerçek satır kilidiyle deterministik test
  edildi.
- B12: Trigger'lar measurement INSERT'ini terminal run'da reddeder; mevcut ölçüm/olay satırlarının
  doğrudan UPDATE/DELETE'i hâlâ yalnız FK/servis kurallarıyla sınırlıdır. Test temizliği silme
  yapabildiği için delete engeli eklenmedi; ürün yolunda silme yoktur.
- B14: `eventsUrl` P4'e kadar 404'tür; P3-10 kartına not işlenmesi bu worker'ın sahiplik alanı
  dışındadır.
