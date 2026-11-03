# Phase 3 — bağımsız teknik inceleme

- İnceleme hedefi: ürün kodu `66676b7` (`test: record phase 3 API, recovery and browser demo evidence`).
- İnceleme sırasında HEAD `8618388` oldu; bu commit yalnızca `README.md`, `docs/README.md`, `docs/roadmap.md` ve `docs/tasks/README.md` durum metinlerini değiştirir, ürün kodunu değiştirmez. İnceleme `66676b7` ürün kodu üzerinden yapıldı.
- Tarih: 2026-11-03.
- Ortam: macOS arm64, Node.js `22.23.2`, npm `10.9.8`, Angular 22.2.4, PostgreSQL 18.1; geliştirme DB `127.0.0.1:5434`, test DB `127.0.0.1:5433`.
- Bu bir **bağımsız teknik incelemedir; ürün kabulü değildir**. Hiçbir görev `Accepted` yapılmadı. Ürün kodu, testler, migration ve kök yapılandırma değiştirilmedi; yalnızca bu kanıt dosyası eklendi.

## Kısa sonuç

Simülatör, yürütücü, snapshot, iptal/recovery ve tek aktif çalışma çekirdeği büyük ölçüde sözleşmeye uyuyor. Critical seviyede bulgu yok. Ancak Phase 3 teknik kabul için hazır değil:

- **Yüksek (B1):** Başlatma, Run Again ve `RUN_ALREADY_ACTIVE` bağlantıları `/runs/:id/live` placeholder'ına gidiyor; uygulamada çalıştırma detayına (`/runs/:id`) giden işlevsel bir yol yok. Kullanıcı start sonrası "This screen is not available yet" görüyor; detay/iptal/Run Again ancak URL elle değiştirilerek erişilebiliyor.
- **Orta (B2):** Kaydedilen örnek sayısı beklenene eşit olsa bile terminal `ERROR`/`CANCELLED`/`INTERRUPTED` çalıştırmalarda ekran "Partial results — stopped before every expected sample was recorded" diyor. Gerçek API'de 6/6 örnekli, üç adımı `COMPLETED/PASSED` bir `ERROR` çalıştırması üretildi; metin yanlış.
- **Orta (B3):** Farklı anahtarlı eşzamanlı başlangıçta, aktif çalıştırma unique ihlâlinden sonra terminal olursa `RunsService.start` 500 üretebilir; sözleşme 409 `RUN_ALREADY_ACTIVE` bekler. Kod yolu açık; yarış dar olduğu için gerçek ortamda tetiklenemedi.
- **Orta (B4):** DB, teknik hata kaydı sırasında erişilemezse çalıştırma `RUNNING` kalır; recovery başarısı cache'lendiği için DB geri geldiğinde readiness 200 olur ve yeni başlangıçlar sürekli 409 alır. Süreç yeniden başlatılmadan otomatik uzlaştırma yok.
- **Orta (B5):** Kontrollü kapanış `completeRun` transaction'ı zaten uçtaysa `COMPLETED` commit'ini engellemiyor; sözleşme kontrollü kapanışta mevcut çalıştırmayı tamamlanmış göstermemeyi söyler. Dar yarış; gerçek ortamda tetiklenemedi.

## Verdict tablosu

| Görev | Verdict | Gerekçe |
|---|---|---|
| P3-01 | **PASS** | Golden fixture'lar bağımsız referansla doğrulandı; negatif aralık, seed 0/uint32 max, eşit sınır, saflık ve `mulberry32-v1` sürümü doğru. |
| P3-02 | **PASS** | Demo Current Draw indeks 14 tam `0.600000`; p=0/p=1 uçları, karar-yön-değer sırası ve senaryo dışı alan reddi doğru. |
| P3-03 | **PASS with findings** | Gerçek PG constraint/composite FK/partial index/truncate trigger'ları doğrulandı. B12: run snapshot ve terminal yazma immutability'si yalnız servis seviyesinde. |
| P3-04 | **PASS with findings** | Gerçek eşzamanlı iki başlangıçta tek kabul; aynı anahtar/aynı gövde replay; farklı gövde 409; aktif çakışma `activeRunId`. B3: terminalizasyon yarışında 500 yolu. |
| P3-05 | **PASS with findings** | Sıralı yürütme, inclusive tolerans, ilk ihlal, sonraki adımın devamı, tüm örnek zorunluluğu, sonuç toplama, boşluksuz olay dizisi ve istatistikler doğru. B5/B8. |
| P3-06 | **PASS** | Snapshot tutarlı okuma, kanonik decimal, null istatistik, active null/object, 404/401, secret/draft sızıntısı yok. |
| P3-07 | **PASS with findings** | Kısmi veri korunuyor; aktif adım CANCELLED, pending NOT_RUN; terminal cancel idempotent; ilk terminal kazanıyor. B7 timestamp kenarı. |
| P3-08 | **PASS with findings** | Gerçek SIGKILL ve SIGTERM sonrası INTERRUPTED, `run.interrupted`, readiness kapısı ve teknik ERROR yolu doğrulandı. B4/B5 operasyonel sınırlar. |
| P3-09 | **FAIL** | Form/payload/idempotency/rol doğru; ancak başarı ve `RUN_ALREADY_ACTIVE` bağlantıları mevcut kaydı göstermeyen `/live` placeholder'ına gidiyor. B1. |
| P3-10 | **FAIL** | Detay, iptal ve Run Again çekirdeği çalışıyor; B1 nedeniyle bu ekranlara uygulama içinden erişilemiyor, B2 ile kısmi veri metni yanlış, B6 ile demo kanıtı çelişkili. |

**Aşama sonucu:** P3-01/02/03/06 teknik olarak geçti; P3-04/05/07/08 bulgularla geçti; **P3-09 ve P3-10 kabul edilmemeli**. B1 kapatılmadan Phase 3 teknik kabulü yapılmamalıdır. B2–B6 için düzeltme veya açık kullanıcı kararı gerekir.

## Bulgular

### B1 — High — Start/Run Again/aktif bağlantı çalıştırma detayına değil placeholder'a gidiyor

**Gözlenen:**
- Gerçek Chrome'da `/runs/new?versionId=...` formundan NORMAL run başlatıldı; rota `/runs/<runId>/live` oldu ve ekranda "This screen is not available yet", "No run is loaded on this screen yet" görüldü.
- `apps/web/src/app/features/runs/start-run-page.ts:201` ve `apps/web/src/app/features/runs/run-details-page.ts:367` başarıda `/runs/:id/live` adresine gidiyor.
- `apps/web/src/app/features/runs/start-run-page.html:290` ve `apps/web/src/app/features/runs/run-details-page.html:414` "Open active run" bağlantısı da `/runs/:id/live` adresine gidiyor.
- `apps/web/src/app/features/runs/live-run-page.ts:11-12` bu rotanın P4-04 placeholder'ı olduğunu, hiçbir run yüklemediğini söylüyor. `apps/web/src/app/features/runs/run-history-page.ts:11-12` de P5-02 placeholder'ı.
- `scripts/phase-3-ui-check.mjs:179` başlatma sonrası detay ekranına **doğrudan `navigate`** ediyor; yani kanıt, uygulamanın kendi yönlendirmesini değil elle URL değiştirmeyi doğruluyor.

**Beklenen:**
- P3-09 kabul ölçütü 3: "Aktif çalışma hatası mevcut kayda bağlantı verir."
- P3-09 kabul ölçütü 4: "Başarıda gerçek runId ile izleme ekranına geçilir."
- P3-10: Run Details/Run Again akışı kullanıcı tarafından erişilebilir olmalı.
- SSE/canlı akışın P4-04 olduğu doğrudur; ancak `/runs/:id` detay rotası bu aşamada zaten var. En azından start/Run Again/aktif bağlantı detay sayfasına yönlendirilmeli veya `/live` placeholder'ından detaya bağlantı vermelidir.

**Etki:** Phase 3'ün ana kullanıcı akışı (başlat → sonucu gör → iptal et → Run Again) uygulama içinde tamamlanamıyor; demo elle URL değiştirmeye dayanıyor.

### B2 — Medium — Tüm örnekler kaydedilmiş terminal çalıştırma "eksik örnek" gibi açıklanıyor

**Gözlenen:**
- `apps/web/src/app/features/runs/run-status.ts:160-168`: `isPartialResult`, `RUNNING` dışındaki **her** terminal durum için `true`; örnek sayısı eşit olsa bile.
- `apps/web/src/app/features/runs/run-details-page.html:203-207`: bu durumda "Partial results. The run stopped before every expected sample was recorded. Missing samples..." gösteriliyor.
- Gerçek API'de `run.completed` olayını DB trigger'ıyla bozarak `ERROR` üretildi: `recordedSampleCount=6`, `expectedSampleCount=6`, üç adım da `COMPLETED/PASSED`, 14 olayın tamamı mevcut. UI bu çalıştırmada %100 ilerleme ile "eksik örnek" metnini birlikte gösterir.
- Aynı durum, son örnekten sonra fakat `completeRun` öncesinde iptal edilen `CANCELLED` çalıştırmada da oluşabilir.

**Beklenen:**
- `measurement-rules.md:85-87`: kısmi yüzde ve durum birlikte gösterilir; eksik veri sıfırla doldurulmaz. "Partial" yalnız gerçekten eksik örnek varsa söylenmeli.
- P3-10 kabul ölçütü 3: "Cancelled/Interrupted/Error ve kısmi adımlar doğru açıklanır."
- Öneri: `isPartialResult` yalnız `recordedSampleCount < expectedSampleCount` için `true` olsun; tüm örnekler kaydedilmiş terminal çalıştırmada "all samples recorded; the run stopped during finalization/technical error" gibi doğru bir metin kullanılsın.

### B3 — Medium — Eşzamanlı başlangıç yarışında 409 yerine 500 olasılığı

**Gözlenen:**
- `apps/api/src/runs/runs.service.ts:152-174`: unique ihlâlinde önce aynı anahtar aranıyor, sonra `findFirst({ status: RUNNING })` yapılıyor. Aktif satır bulunamazsa orijinal `P2002` yeniden fırlatılıyor; global filtre bunu 500 `INTERNAL_ERROR` yapar.
- Senaryo: iki farklı anahtarlı istek yarışır; kazanan `test_runs_single_running_key` ihlâlini üretir; kaybeden `findFirst`'e gelmeden kazanan terminal olur (tamamlanır/iptal edilir). O anda aktif satır yoktur; kaybeden 500 alır.
- P3-04 kanıtı bu riski kendisi kabul ediyor: "Bir terminalizasyon yarışı, ihlal sonrası aktif satır bulunamazsa 500 üretebilir; P3-07 iptal yarışları geldiğinde bu yol yeniden değerlendirilmelidir." P3-07 uygulandı, ancak bu yol değişmedi.

**Beklenen:**
- `api.md:96-97`: farklı anahtarın aktif çalışmaya çarpması 409 `RUN_ALREADY_ACTIVE` ve `details.activeRunId`.
- 500 yalnız gerçek beklenmeyen hata içindir; terminalizasyon yarışı 409 veya idempotent replay'e çözülmelidir.

**Doğrulama sınırı:** Üç tur gerçek eşzamanlı farklı anahtar denemesinde her turda 202/409 alındı; 500 yarışı dar olduğu için tetiklenemedi. Kod yolu ve P3-04'ün kendi kaydı açıktır.

### B4 — Medium — DB kesintisi sonrası stale RUNNING ve cache'lenmiş recovery

**Gözlenen:**
- `apps/api/src/runs/run-executor.ts:918-1004`: `recordTechnicalFailure` DB'ye yazamazsa yalnız loglar; çalıştırma `RUNNING` kalır.
- `apps/api/src/runs/run-recovery.service.ts:62-80,109-114`: başarılı recovery `completed=true` olarak cache'lenir; sonraki çağrılar DB'ye bakmaz.
- `apps/api/src/health/health.service.ts:75-83` ve `apps/api/src/runs/runs.service.ts:87-89` bu cache'e güvenir. DB geri geldiğinde readiness 200 olur; yeni `POST /runs` stale RUNNING satırı nedeniyle 409 `RUN_ALREADY_ACTIVE` alır. Çalıştırma artık yürütülmemektedir; otomatik uzlaştırma yoktur.
- Kurtarma yolu, operatörün stale run'ı elle iptal etmesi veya sürecin yeniden başlatılmasıdır.

**Beklenen:**
- `measurement-rules.md:75-80`: başlangıçta kalan RUNNING kayıtlar readiness açılmadan INTERRUPTED kapatılır; DB erişilemiyorsa yeni iş kabulü ve readiness durur; yeniden başlangıç uzlaştırması kalan RUNNING'i kapatır.
- Bu incelemede gerçek DB kesintisi (container/pg durdurma) güvenli biçimde uygulanamadı; bulgu kod yolu ve cache davranışına dayanır, gerçek ortamda tetiklenmedi.
- Öneri: recovery cache'ini yalnız "bu süreçte ilk başarılı pass" olarak değil, terminal olmayan çalıştırma varlığında readiness/start öncesi yeniden doğrulama ile kullanmak; veya executor kaybını tespit edip stale run'ı kapatmak.

### B5 — Medium — Kontrollü kapanışta in-flight `completeRun` COMPLETED commit edebilir

**Gözlenen:**
- `apps/api/src/runs/run-executor.ts:278-282` son adımdan sonra `state.stopped` kontrolü yapıp `completeRun` çağırıyor. `completeRun` (`:817-912`) transaction içinde tekrar `state.stopped` kontrolü yapmıyor; `onModuleDestroy` (`:187-192`) yalnız timer/waiter'ı durduruyor.
- SIGTERM, `completeRun` transaction'ı başladıktan sonra gelirse transaction commit edebilir ve çalıştırma `COMPLETED` olur.
- P3-08 kanıtı "Run'ın COMPLETED'a geçişi stopped kontrolleriyle engellenir" diyor; bu, in-flight `completeRun` için doğru değil.

**Beklenen:**
- `measurement-rules.md:77`: "Kontrollü uygulama kapanışında da mevcut çalışma tamamlanmış gibi gösterilmez."
- Dar yarış; gerçek SIGTERM testi timer bekleme noktasında yapıldı ve RUNNING kaldı; `completeRun` in-flight penceresi tetiklenemedi.

### B6 — Medium — Demo kanıtı çelişkili ve commit'teki haliyle yeniden üretilemiyor

**Gözlenen:**
- `docs/evidence/phase-3-demo.md:5-8` gerçek Chrome demosu ve API `127.0.0.1:3100` diyor; ancak `apps/web/proxy.conf.json:3` `/api` hedefi `127.0.0.1:3000`. `scripts/phase-3-ui-check.mjs` proxy override etmiyor, `VERSION_ID`/`FORCED_RUN`/`NORMAL_RUN` geliştirme DB'sine ait sabit kimlikler (`:10-13`).
- Aynı script, start sonrası `/live` rotasını bekledikten sonra detay ekranına **doğrudan** `navigate` ediyor (`:179`); uygulamanın kendi yönlendirmesini test etmiyor.
- `docs/tasks/P3-10.md:27` demo maddesini işaretlenmemiş bırakıyor; `docs/evidence/phase-3-run-summary.md:126` gerçek API/tarayıcı smoke yapılmadığını söylüyor; `phase-3-demo.md` ise gerçek Chrome sonuçları iddia ediyor.
- `docs/roadmap.md:3` hâlâ "simülasyon ... henüz yoktur" diyor; `docs/testing.md:3` "P2–P8 davranış testleri henüz yazılmadı" diyor; `docs/evidence/phase-3-executor.md:39` `OnApplicationShutdown` diyor, kod `OnModuleDestroy` kullanıyor.

**Beklenen:**
- `docs/evidence/README.md` kanıt biçimi: commit, ortam, tam komut, gerçek çıktı, çalıştırılmayan kontrol açıkça.
- Demo, commit'teki script ve yapılandırmayla yeniden çalıştırılabilir olmalı; sabit geliştirme kimlikleri ve elle URL atlama yerine geçici fixture/parametre kullanılmalı.
- P3-10 demo maddesi gerçekten çalıştırıldıysa işaretlenmeli ve çelişen kanıt dosyası düzeltilmeli; çalıştırılmadıysa `phase-3-demo.md` iddiası geri çekilmeli.

### B7 — Low — Cancel/recovery `finishedAt` satır kilidinden önce ve gerçek saatle hesaplanıyor

- `apps/api/src/runs/run-cancel.service.ts:53-64` ve `run-recovery.service.ts:127-139` `finishedAt`'i koşullu UPDATE'ten ve satır kilidini beklemekten **önce** `new Date()` ile hesaplıyor.
- Bir adım tamamlama transaction'ı kilidi daha önce almışsa, cancel bekler ve run `finishedAt`'i adımın `finishedAt`'inden önce kalabilir; `run.cancelled` olayının `occurredAt`'i `step.completed` olayından önce görünebilir.
- Beklenen: terminal zaman/olay zamanı terminal commit sırasıyla tutarlı olmalı; en azından kilit sonrası hesaplanmalı. Dar yarış; gerçek ortamda tetiklenemedi.
- Ek: cancel/recovery `RunScheduler` yerine gerçek saati kullanır; test saatiyle üretim davranışı arasında gereksiz bir arayüz farkı vardır (davranışı bozmuyor).

### B8 — Low — `elapsedMs` adım `startedAt`'inden değil, `beginStep` commit'inden sonra başlıyor

- `apps/api/src/runs/run-executor.ts:230-248`: `startedAt` alınıyor, `beginStep` await ediliyor, monotonik referans ancak ondan sonra (`stepStartedMonotonic`) alınıyor; ilk örneğin `elapsedMs` değeri `step.started` transaction süresini içermiyor.
- Beklenen `simulation.md:60`: "adım başlangıcına göre monoton `elapsedMs`". Gerçek çalıştırmada fark küçük; yavaş DB'de ilk örnek elapsed'i olduğundan az görünür.

### B9 — Low — `buildStartRunRequest` boş RANDOM olasılığını kabul ediyor

- `apps/web/src/app/features/runs/run-start-form.ts:60-76`: `validateProbability('')` `null` döndürüyor; `:137-143` bu nedenle boş string'i `{ errorProbability: '' }` olarak döndürebiliyor.
- Formdaki `Validators.required` normal UI'da engelliyor; ancak yardımcı fonksiyonun "invalid input throws" sözleşmesi ve test kapsamı eksik. Düşük önem; gerçek kullanıcı akışında gözlenmedi.

### B10 — Low — Terminal yazma testi adı ile içeriği uyuşmuyor

- `apps/api/test/runs-execution.e2e-spec.ts:833-890` "rejects duplicate terminal writes and a stale executor restart" testi terminal run'a yazma denemesi yapmıyor; duplicate measurement unique kısıtını ve terminal run'da `executor.start`'ın yazmamasını test ediyor.
- Terminal run'a yeni measurement/adım yazılmaması servis kodunda koşullu UPDATE ile sağlanıyor; doğrudan servis yazma yoluyla bu senaryo test edilmiyor. Ayrıca cancel-vs-completion yarışı otomatik testte yok (bu incelemede DB trigger'ıyla elle doğrulandı).

### B11 — Low — Doküman/kanıt durumu bayat

- `docs/roadmap.md:3`, `docs/testing.md:3`, `docs/evidence/phase-3-executor.md:39` ve görev kartlarındaki "commit yok" alanları son durumla uyuşmuyor.
- `docs/evidence/phase-3-run-summary.md` ile `docs/evidence/phase-3-demo.md` aynı aşama için çelişen gerçek tarayıcı iddiaları taşıyor.
- Bu maddeler ürün davranışını değiştirmez; kanıt güvenilirliğini etkiler.

### B12 — Low — Run snapshot/terminal immutability yalnız servis seviyesinde

- `apps/api/prisma/migrations/20261103190000_runs/migration.sql` yalnız TRUNCATE trigger'ları içerir; `test_runs` snapshot alanları, `run_steps` kural kopyaları ve terminal run'a measurement ekleme DB seviyesinde korunmuyor.
- `docs/data-model.md:9,47,73` kuralların çalıştırma başladıktan sonra değiştirilememesini ve terminal run'a yazma yasağını söyler. Servis yolları koşullu UPDATE ile koruyor; doğrudan SQL/schema owner veya gelecekteki bir yazma yolu korunmuyor. P3-03 kartı bunu sonraki görevlere bırakmıştır; kabul için açık karar gerekir.

### B13 — Low / doğrulanamayan — Çok geniş aralıkta üst sınır değeri üretilemiyor

- `apps/api/src/simulator/simulator.ts:298-300`: `span + 1 > 2^32` olduğunda `uniformOffset` bazı mikro değerleri (ve geniş aralıkta tam `maximum`'u) üretemez. Örnek: ±1.000.000.000 aralığı.
- Üretilen değerler aralık içinde ve determinist; `simulation.md` "inclusive" ifadesi ve `docs/evidence/phase-3-simulator.md:134` bu 32-bit sınırını kabul ediyor. Kesin üst sınırın her aralıkta üretilebilmesi gerekiyorsa bu bir eksikliktir; aksi halde yalnız dağılım sınırıdır. Testler yalnız küçük span'de min/max üretimini doğruluyor.

### B14 — Low / kapsam — `eventsUrl` SSE olmadan dönüyor

- `apps/api/src/runs/dto/run-start-response.dto.ts` ve `RunsService.toResponse` `eventsUrl` döndürüyor; SSE ucu P4 kapsamında olduğu için bu adres şu an 404'tür. `api.md:63` "bağlantı kurulabilecek snapshot/events adresleri" der. P4'e ertelenmiş bilinen kapsam; Phase 3 kabulünde açıkça belirtilmelidir.

## Bağımsız doğrulama: komutlar ve gerçek sonuçlar

### Depo kontrolleri

```text
$ npm run verify
exit=0
lint: 3 kez "Found 0 warnings and 0 errors."
api unit: Test Files 14 passed (14), Tests 97 passed (97)
web: Test Files 21 passed (21), Tests 186 passed (186)
build: Initial total 325.65 kB | 90.90 kB
openapi: "OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application."
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  16 passed (16)
Tests       141 passed (141)
Duration    17.89s
exit=0
```

```text
$ npm run openapi:check
OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
exit=0
```

### Gerçek API (spare port 3101, izole geçici DB)

Geliştirme DB'sine yazmamak için `probedesk_review` adlı geçici bir PostgreSQL veritabanı oluşturuldu; altı migration uygulandı, üç demo kullanıcı ve profil seed edildi. API `127.0.0.1:3101` üzerinde çalıştırıldı. Geçici planlar/sürümler:

- `Review Temp Plan` v1 (3 adım × 2 örnek, 100 ms), v2 (3 adım × 30 örnek, 200 ms).
- `Review Negative` v1 (negatif aralık `-1.25..1.25`, 3 örnek).

Gerçek sonuçlar:

| Kontrol | Sonuç |
|---|---|
| NORMAL, seed 0 | `COMPLETED/PASSED`, 6/6, `lastEventSequence=14`; değerler bağımsız Python mulberry32 referansıyla aynı. |
| FORCED_FAILURE Current Draw, seed 20261103 | `COMPLETED/FAILED`, 90/90, `lastEventSequence=98`; yalnız indeks 14 `0.600000`, `outOfToleranceCount=1`, `firstFailureSampleIndex=14`; üç adım da COMPLETED. |
| RANDOM p=0 | 3 adım, 6/6, PASSED, hiç ihlal yok. |
| RANDOM p=1 | 6/6, FAILED, her örnek ihlal. |
| Negatif aralık FORCED_FAILURE | ihlal indeksi 1, değer `2.500000`; diğerleri içeride, FAILED. |
| Aynı anahtar/aynı gövde | `202` + `200`, aynı `runId`, tek kayıt. |
| Aynı anahtar/farklı gövde | `409 IDEMPOTENCY_CONFLICT`, ilk kayıt korunuyor. |
| Terminal sonrası aynı anahtar | `200`, aynı run, yeni kayıt yok. |
| 3 tur eşzamanlı farklı anahtar | her turda tam bir `202`, bir `409`; 409 gövdesinde doğru `activeRunId`. |
| Kısmi iptal | 13/90; aktif adım CANCELLED, sonraki adımlar NOT_RUN; ölçümler korunuyor. |
| Cancel vs completion (DB trigger ile complete geciktirildi) | COMPLETED kazandı; `run.cancelled` olayı yok; 14 olay boşluksuz. |
| SIGKILL + yeniden başlatma | önce RUNNING 9 örnek, sonra INTERRUPTED 10 örnek, `SERVER_RESTART`, 13 olay boşluksuz; `run.interrupted` sonrası ölçüm yok. |
| SIGTERM (kontrollü kapanış) | RUNNING 8/90 kaldı, `finishedAt=null`, `run.completed` yok; yeniden başlatmada INTERRUPTED. |
| Snapshot tutarlılığı | 935 ardışık GET sırasında `recordedSampleCount == Σ recordedCount == Σ measurements` hiç bozulmadı; final 90/98. |
| All-samples ERROR | `run.completed` event insert'i trigger ile bozuldu: `ERROR`, 6/6, üç adım COMPLETED/PASSED, `EXECUTION_FAILED`; B2 UI metnini doğrulayan gerçek run. |

### Gerçek tarayıcı

`ng serve` `localhost:4200`, geçici proxy ile API `127.0.0.1:3101`; gerçek Chrome (CDP) ile:

- FORCED_FAILURE run detayı: `Failed`, `0.600000` görünür, 90 satır, Cancel yok, Run Again var.
- NORMAL run detayı: `Passed`, Run Again var.
- Start formu: 3 adım, NORMAL/FORCED_FAILURE/RANDOM.
- UI'dan NORMAL run: gerçek `runId` ile `/runs/:id/live`; snapshot API'sinde `NORMAL`, `seed=321`, 90 beklenen örnek.
- İptal dialogu: "Cancel this run?"; onay sonrası `Cancelled`, Cancel gizli, Run Again var; konsol istisnası yok.
- **Ancak** detay ekranı ancak `/runs/:id` adresi elle açılarak görüldü; start/Run Again/aktif bağlantı `/live` placeholder'ına gidiyor (B1).

### Test gerçekliği

- Güçlü yönler: backend e2e gerçek PostgreSQL ve gerçek HTTP kullanıyor; DB constraint/trigger/race testleri mock değil; simülatör fixture'ları sabit; cancel yarışı gerçek satır kilidiyle; recovery gerçek app init ve bizim ek olarak gerçek SIGKILL/SIGTERM ile; snapshot tutarlılığı gerçek okumalarla.
- Zayıf yönler: tarayıcı testleri ağırlıklı `HttpTestingController` mock'u; Run Again gerçek Chrome'da tıklanmadı (unit test var); concurrent start aynı Nest app/pool üzerinden (DB unique yine de gerçek); gerçek DB kesintisi ve `completeRun` in-flight shutdown yarışı test edilmedi; "terminal writes" testi adıyla içeriği uyuşmuyor.
- Kanıt dürüstlüğü: P3-10 demo maddesi açık bırakılmış (doğru), ancak `phase-3-demo.md` tamamlandı iddiası ve `phase-3-run-summary.md` "gerçek smoke yok" ifadesi çelişiyor; UI script'i commit haliyle yeniden üretilemiyor (B6).

## Doğrulanamayan sınırlar

- Gerçek DB kesintisi sırasında `recordTechnicalFailure` davranışı ve DB dönüşü sonrası stale RUNNING/readiness (B4); container durdurma güvenli biçimde yapılmadı.
- B3'teki 500 yarışının gerçek istekle tetiklenmesi; kod yolu ve P3-04 kaydı var, ampirik tekrar yok.
- B5'teki `completeRun` in-flight SIGTERM yarışı; timer bekleme noktasındaki SIGTERM doğrulandı, final transaction penceresi değil.
- Gerçek Chrome'da Run Again tıklaması, FORCED_FAILURE/RANDOM form gönderimi ve tam klavye/ekran okuyucu turu; detay/iptal/normal start gerçek, diğerleri unit test.
- 10.000 örneklik maksimum snapshot ve 30 adımlı planın gerçek tarayıcı performansı.
- Çok geniş span'de tam `maximum` üretimi (B13); yalnız aralık içinde kalma doğrulandı.
- SSE/replay/cursor (P4) ve `eventsUrl`'in gerçekten bağlanabilir olması; bu aşamada yok.

## Temizlik

- Geçici `probedesk_review` veritabanı `DROP DATABASE ... WITH (FORCE)` ile silindi.
- Geçici API (3101) ve `ng serve` (4200) kapatıldı; dinleyen süreç kalmadı.
- Geliştirme DB'si yalnız okundu: `plans=2`, `revisions=5`, `runs=6`; dev trigger'larında `tgenabled<>'O'` sayısı `0/11`.
- Test DB'si: `runs=0`; trigger'lar `0/11`; e2e temizliği sonrası kalıntı yok.
- Ürün kodunda değişiklik yapılmadı; `git status --short` inceleme dosyası dışında temizdir.

## Sonuç

Bu inceleme, görev kartlarındaki "tamamlandı" ifadelerine güvenmeden yapılmıştır. Çekirdek ölçüm/simülasyon/snapshot/cancel/recovery davranışı büyük ölçüde sağlamdır; ancak B1 (High) Phase 3'ün kullanıcı akışını ve P3-09/P3-10 kabulünü bloke eder. B2–B6 kapatılmadan veya açık bir kullanıcı kararıyla ertelenmeden Phase 3 teknik kabulü önerilmez. Bu belge ürün kabulü değildir; nihai kabul kullanıcıya aittir.
