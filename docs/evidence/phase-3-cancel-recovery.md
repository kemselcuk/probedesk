# Phase 3 — İptal, kesinti ve teknik hata yönetimi (P3-07 / P3-08)

Tarih: 2026-11-03
Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 11.6.2, PostgreSQL 18.1 (`probedesk-postgres-test`, 127.0.0.1:5433).
Kapsam: `POST /api/runs/:id/cancel`, executor iptal sinyali, startup recovery, readiness gating, kontrollü kapanış, teknik hata terminal durumları, OpenAPI ve gerçek PostgreSQL + Supertest testleri. SSE, frontend, istemci üretimi ve migration kapsam dışıdır.

## Sonuç

P3-07 ve P3-08 uygulandı ve In Review'a alındı. Çalışan bir run'ı iptal etmek artık tek transaction içinde yarışa dayanıklı biçimde mümkün: TestRun satırı koşullu UPDATE ile kilitlenip RUNNING yeniden kontrol ediliyor; aktif adım CANCELLED, başlamamış adımlar NOT_RUN oluyor ve `run.cancelled` bir sonraki sequence ile ekleniyor. Commit edilmiş ölçümler, tamamlanmış adımlar ve sonuçları korunuyor. Terminal run'a geç gelen cancel yanıtı mevcut snapshot'ı değiştirmeden döndürüyor; tekrarlanan cancel olay üretmiyor. Executor commit sonrası sinyalle timer'ı bırakıyor; her yazma yolu satır kilidi altında RUNNING kontrolünü yeniden yaptığı için terminal commit'inden sonra ölçüm veya yeni adım yazılamıyor.

Uygulama açılışında kalan RUNNING run'lar readiness açılmadan INTERRUPTED kapatılıyor. Aktif adım INTERRUPTED, başlamamış adımlar NOT_RUN, run `reasonCode: "SERVER_RESTART"` ve `finishedAt` alıyor; `run.interrupted` bir sonraki sequence ile ekleniyor. Ölçümler ve tamamlanmış adımlar silinmiyor, run sürdürülmüyor. Readiness; veritabanı, migration ve startup recovery tamamlanmadan 503 dönüyor. Yeni run başlatma da recovery tamamlanmadan 503 ile reddediliyor. Kontrollü kapanış timer'ları durdurup veriyi RUNNING bırakıyor; sonraki süreç recovery ile kapatıyor.

Geçersiz simülatör çıktısı ve kalıcı kayıt hatası terminal ERROR üretiyor; aktif adım ERROR, başlamamış adımlar NOT_RUN oluyor ve `run.errored` güvenli reasonCode ile yazılıyor. Bu yollar tolerans sonucu veya PASSED üretmiyor. DB erişilemezse hata uydurulmuyor; readiness başarısız kalıyor ve run yazımı recovery'ye bırakılıyor. Loglarda yalnızca run kimliği, güvenli reasonCode ve sabit mesajlar var; SQL/DSN/stack yazılmıyor.

Migration gerekmedi. P3-03 şeması `RunStatus`/`RunStepStatus` terminal değerlerini, `reasonCode`, `finishedAt`, `cancelledById` alanlarını ve `run.cancelled`/`run.interrupted`/`run.errored` olay tiplerini zaten içeriyor. Şema veya migration boşluğu bulunmadı.

## Eklenen ve değişen dosyalar

- `apps/api/src/runs/run-cancel.service.ts`: satır kilidi + RUNNING yeniden kontrolü, run/adım terminal geçişleri, `run.cancelled`, commit sonrası executor sinyali, terminal snapshot dönüşü.
- `apps/api/src/runs/run-recovery.service.ts`: startup bootstrap, RUNNING run'ları transaction başına INTERRUPTED kapatma, `run.interrupted`, single-flight retry, readiness için `ensureCompleted()`.
- `apps/api/src/runs/run-executor.ts`: runId anahtarlı in-process iptal kaydı (`cancel`), `OnModuleDestroy` ile kontrollü kapanış, örnek commit'i sonrası ve terminal adım/run öncesi stopped kontrolleri.
- `apps/api/src/runs/run-domain.ts`: `USER_CANCELLED` ve `SERVER_RESTART` güvenli reasonCode sabitleri.
- `apps/api/src/runs/runs.controller.ts`: `POST /api/runs/:id/cancel`, Operator + CSRF, 200 snapshot, 401/403/404 dokümantasyonu.
- `apps/api/src/runs/runs.service.ts`: yeni iş kabulünden önce recovery tamamlanma kontrolü; tamamlanmazsa güvenli 503.
- `apps/api/src/runs/runs.module.ts`: iptal/recovery servisleri ve `RunRecoveryService` export'u.
- `apps/api/src/health/health.service.ts`, `health.module.ts`, `health.controller.ts`: readiness'da startup recovery kontrolü; hata gövdesinde yalnızca güvenli `startup: "pending"` bayrağı.
- `apps/api/test/runs-cancel.e2e-spec.ts`: gerçek PostgreSQL + Supertest ile 4 iptal testi.
- `apps/api/test/runs-recovery.e2e-spec.ts`: gerçek PostgreSQL + Supertest ile 6 recovery/teknik hata/kapanış testi.
- `apps/api/test/openapi.e2e-spec.ts`: yeni cancel yolu ve güvenlik/yanıt kontrolleri. Bu dosya nominal sahiplik listesinde yoktu; sabit OpenAPI yol listesi yeni rota ile kırıldığı için zorunlu asgari düzenleme yapıldı.
- `apps/api/openapi.json`: `npm run openapi:emit` ile yeniden üretildi.
- `apps/api/README.md`: iptal, recovery, readiness gating, teknik hata ve kapanış davranışı belgelendi.
- `docs/tasks/P3-07.md`, `docs/tasks/P3-08.md`: In Review durumu ve gerçek kontrol sonuçları.
- Bu kanıt dosyası.

## İptal tasarımı

1. `POST /api/runs/:id/cancel` Operator oturumu ve CSRF ister. UUID olmayan kimlik 400, bilinmeyen run 404 döner.
2. Servis tek transaction içinde run satırını önce okur. Ardından `UPDATE ... WHERE id = ? AND status = 'RUNNING'` çalıştırır. Bu koşullu UPDATE hem satır kilidi hem terminal durum yeniden kontrolüdür; eşzamanlı tamamlama, hata veya ikinci cancel önce commit ettiyse `count = 0` olur ve hiçbir adım/olay yazılmaz.
3. Geçiş kazanıldığında aynı transaction içinde run CANCELLED, `outcome = null`, `finishedAt`, `cancelledById`, `reasonCode = USER_CANCELLED` ve `eventSequence = eventSequence + 1` yazılır.
4. Aktif (RUNNING) adım CANCELLED + `finishedAt`, PENDING adımlar NOT_RUN yapılır. COMPLETED adımların outcome, sayaç, istatistik ve ölçümleri hiç değiştirilmez.
5. `run.cancelled` aynı transaction'da bir sonraki sequence ile yazılır. Payload yalnızca durum, güvenli reasonCode, iptal eden kullanıcı UUID'si, sayaçlar ve adım sayıları taşır.
6. Commit'ten sonra executor'a runId anahtarlı sinyal gönderilir. Timer iptal edilir, bekleyen wait reddedilir. Sinyalden önce başlamış bir DB yazması satır kilidini cancel transaction'ından önce almışsa commit eder; sonra almışsa `WHERE status = 'RUNNING'` nedeniyle hiç yazmaz. Böylece terminal commit'inden sonra ölçüm oluşmaz.
7. Terminal run'da servis yazma yapmadan mevcut snapshot'ı döndürür. `run.cancelled` eklenmez, `finishedAt`/outcome değişmez. Tekrarlanan cancel aynı snapshot'ı 200 ile döndürür.
8. Yanıt, iptal commit'inden sonra `REPEATABLE READ` snapshot servisinden okunur; istemci tek tutarlı terminal gövde alır.

## Recovery ve kapanış tasarımı

1. `RunRecoveryService` `OnApplicationBootstrap` ile `app.init()` tamamlanmadan recovery'yi çalıştırır ve await eder. Bir sonraki API süreci HTTP trafiği kabul etmeden önce yarım işler kapanır. Readiness ayrıca her istekte `ensureCompleted()` kontrolü yapar.
2. Recovery önce migration durumunu doğrular; migration eksik/DB erişilemez ise tamamlanmış saymaz. Sonra RUNNING run'ları `startedAt ASC` okur. Tek API süreci varsayımı nedeniyle bunlar önceki süreçten kalmıştır.
3. Her run kendi transaction'ında kilitlenir: `UPDATE ... WHERE status = 'RUNNING'` ile INTERRUPTED, `outcome = null`, `finishedAt`, `reasonCode = SERVER_RESTART`, `eventSequence + 1`. Aktif adım INTERRUPTED + `finishedAt`; PENDING adımlar NOT_RUN. COMPLETED adımlar/ölçümler korunur.
4. `run.interrupted` aynı transaction'da bir sonraki sequence ile yazılır. Resume/retry veya yeni ölçüm üretimi yoktur.
5. Recovery başarısız olursa exception dışarı sızmaz; readiness 503 kalır ve sonraki readiness isteği recovery'yi yeniden dener. Başarılı pass cachedir; normal readiness tek boolean kontrolüdür. Recovery tamamlanmadan `POST /api/runs` 503 döner.
6. `RunExecutor.onModuleDestroy()` timer'ları ve bekleyen wait'leri durdurur, execution kayıtlarını temizler; hiçbir terminal durum yazmaz. Kapanış sırasında commit edilmiş son örnek kalabilir; run RUNNING kalır ve sonraki süreçte INTERRUPTED kapatılır. Örnek commit'i sonrası, adım tamamlama öncesi ve run tamamlama öncesi stopped kontrolleri eklendi; kapanış sinyali son adımdan sonra COMPLETED'a geçişi engeller.
7. Teknik hata yolu P3-05'ten korunuyor: hata RUNNING satırını kilitler, run ERROR, aktif adım ERROR, PENDING NOT_RUN, `run.errored` + güvenli reasonCode. `SIMULATOR_OUTPUT_INVALID` ve `EXECUTION_FAILED` test edildi. DB erişilemezse yalnızca sabit güvenli log yazılır; run recovery'ye bırakılır.

## Test edilen davranışlar

- Kontrollü paused scheduler ile bir adım COMPLETED, sonraki adım 1 örnek kaydetmişken cancel edildi. Yanıt 200/CANCELLED, `reasonCode=USER_CANCELLED`, `recordedSampleCount=3`; adımlar `[COMPLETED, CANCELLED, NOT_RUN]`; COMPLETED adımın 2 ölçümü ve PASSED sonucu korundu; PENDING adım `finishedAt=null`.
- İptal sonrası executor 0 aktif yürütmeye indi, scheduler timer'ı 0 kaldı. Serbest bırakılan eski timer ve bekleme sonrası ölçüm/olay sayısı değişmedi. `/api/runs/active` null döndü.
- Aynı run'a ikinci cancel 200 döndü; `lastEventSequence`, `finishedAt` ve tek `run.cancelled` olayı değişmedi.
- COMPLETED/PASSED run'a cancel 200 döndü; status/outcome/finishedAt, ölçümler ve olaylar birebir aynı kaldı; `run.cancelled` yazılmadı.
- Gerçek PostgreSQL satır kilidi ile yarış zorlandı: executor'ın örnek yazması run satırında bekletildi, cancel arkasına sıraya girdi, kilit bırakıldı. Örnek terminal geçişten önce commit edildi; `run.cancelled` olayından sonra ölçüm olayı yok; snapshot sayaçları ölçüm sayısıyla aynı.
- Oturumsuz cancel 401; Planner ve Viewer 403; Operator + eksik CSRF 403; bilinmeyen UUID 404; UUID olmayan yol 400.
- Sentetik RUNNING run (COMPLETED adım + 2 örnek, RUNNING adım + 1 örnek, PENDING adım) yeni test uygulaması oluşturulmadan önce eklendi. Yeni app init sonrası run INTERRUPTED, `SERVER_RESTART`, aktif adım INTERRUPTED, PENDING NOT_RUN; 3 ölçüm ve COMPLETED sonucu korundu; olaylar `run.started` + `run.interrupted`, sequence 1..2 boşluksuz; readiness 200.
- Aynı terminal run üzerinde yeni bir app daha oluşturuldu; `finishedAt`, `eventSequence`, olaylar ve ölçümler değişmedi.
- Recovery'yi bloke eden gerçek DB trigger'ı ile readiness 503 (`checks.startup=pending`) doğrulandı; yanıtta trigger adı, SQL, DSN veya stack yok. Aynı durumda `POST /api/runs` 503 döndü; run RUNNING kaldı. Trigger kaldırıldıktan sonra readiness 200 oldu ve run INTERRUPTED kapandı.
- Simülatör çıktı sözleşmesi bozulduğunda (beklenen örnek sayısı adımlarla uyuşmuyor) run ERROR/`SIMULATOR_OUTPUT_INVALID`, outcome null, bütün adımlar NOT_RUN, ölçüm yok; `run.errored` yazıldı. PASSED/FAILED üretilmedi.
- Measurement insert'ini yalnız `sampleIndex=1` için bozan gerçek DB trigger'ında ilk örnek korundu: run ERROR/`EXECUTION_FAILED`, `recordedSampleCount=1`, aktif adım ERROR, diğerleri NOT_RUN, olaylar `run.started, step.started, measurement.recorded, run.errored` ve sequence boşluksuz.
- Kontrollü kapanış: ayrı app paused scheduler ile bir adım RUNNING ve 1 örnek kaydetmişken kapatıldı. Timer 0; run hâlâ RUNNING, `finishedAt=null`, COMPLETED olayı yok. Yeni app açılışında run INTERRUPTED, adım INTERRUPTED, diğerleri NOT_RUN, ölçüm korunmuş, son olay `run.interrupted`.

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: `apps/api` çalışma alanı, 2026-11-03. Komutlar tek tek, paralel `prisma generate` yarışı olmadan çalıştırıldı. `openapi:emit`, committed doküman kontrolü geçsin diye e2e'den önce ve build sonrasında yeniden çalıştırıldı.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 353ms on 115 files with 107 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/api
> tsc --noEmit -p tsconfig.json
(çıkış kodu 0, hata yok)
```

```text
$ npm run test --workspace apps/api
Test Files  14 passed (14)
Tests       97 passed (97)
Duration    653ms
```

```text
$ npm run db:migrate:test --workspace apps/api
6 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  16 passed (16)
Tests       141 passed (141)
Duration    17.74s
```

Önceki P3-06 tabanı 131 e2e testiydi; 10 yeni testle toplam 141 test geçti. Yeni dosyalar: `runs-cancel.e2e-spec.ts` 4 test, `runs-recovery.e2e-spec.ts` 6 test. Mevcut testlerde kapsam değişikliği yapılmadı; yalnız OpenAPI sabit yol listesi yeni cancel rotasıyla güncellendi.

```text
$ npm run build --workspace apps/api
> nest build
(çıkış kodu 0)
```

```text
$ npm run openapi:emit
Wrote OpenAPI document to /Users/kemalselcuk/.t3/projects/probedesk/apps/api/openapi.json
```

Ek doğrulama:

```text
$ npx vitest run --config ./vitest.config.e2e.ts test/openapi.e2e-spec.ts
Test Files  1 passed (1)
Tests       3 passed (3)
```

```text
$ npm run openapi:check
OpenAPI drift check failed: packages/api-client/src/schema.ts is out of date with apps/api/openapi.json.
Run `npm run openapi:generate` and commit the result.
```

## Kalan riskler ve kapsam dışı

- Startup recovery tek API süreci varsayımına bağlıdır; çok süreçli dağıtım desteklenmiyor ve bu görevde ek kilit/leader election eklenmedi.
- Recovery sırasında DB erişilemezse readiness 503 kalır; süreç yeniden başlatılmadan DB geri gelirse sonraki readiness isteği recovery'yi yeniden dener ve başarılı olursa 200'e döner. Bu retry yolu test edildi; uzun süreli DB kesintisi ve bağlantı havuzu davranışı yük testiyle ölçülmedi.
- Kontrollü kapanışta devam eden tek bir DB transaction'ı commit edebilir (örneğin son örnek veya adım tamamlama). Run'ın COMPLETED'a geçişi stopped kontrolleriyle engellenir; in-flight transaction'ın kendisi iptal edilemez. Kapanış sonrası kalan RUNNING veri recovery ile kapatılır.
- `packages/api-client/src/schema.ts` bu görevde üretilmedi; `openapi:check` bu nedenle drift veriyor. Lead/ilgili görev `npm run openapi:generate` çalıştırıp istemciyi güncellemeli.
- `apps/api/test/openapi.e2e-spec.ts` nominal sahiplik listesi dışında asgari olarak değiştirildi; incelemede bu diff ayrıca kontrol edilmeli.
- `docs/tasks/README.md` ve `docs/roadmap.md` sahiplik alanı dışında olduğu için güncellenmedi; lead aynı commit'te P3-07/P3-08 durumlarını buralara işlemeli.
- Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı; kartlar In Review'dadır, Accepted değildir.
