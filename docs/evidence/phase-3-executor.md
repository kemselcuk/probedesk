# Phase 3 — Sıralı yürütme ve sonuç hesaplama (P3-05)

Tarih: 2026-11-03
Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 11.6.2, PostgreSQL 18.1 (`probedesk-postgres-test`, 127.0.0.1:5433).
Kapsam: `POST /api/runs` sonrası otomatik başlayan yürütücü, ölçüm doğrulama/kalıcılık, adım ve run sonuçları, istatistikler, olaylar ve teknik hata güvenliği. Plan şeması, migration, snapshot/SSE iptal ve recovery kapsam dışıdır.

## Sonuç

P3-05 tamamlandı ve In Review'a alındı. Run oluşturulduktan sonra HTTP bağlantısından bağımsız olarak 0 ms gecikmeli scheduler üzerinden yürütme başlıyor. Adımlar sırayla çalışıyor; her örnek kısa bir transaction içinde TestRun satırı kilitlenerek RUNNING kontrolü, Measurement, sayaçlar, ilk ihlal bilgisi ve `measurement.recorded` olayıyla birlikte commit ediliyor. Beklenen bütün örnekler yoksa adım COMPLETED olamıyor. Adım istatistikleri kayıtlı örneklerden tam ondalık aritmetikle hesaplanıyor; run sonucu ancak bütün adımlar COMPLETED ise PASSED/FAILED olarak kesinleşiyor. Beklenmeyen yürütme hataları run'ı ERROR yapıp `run.errored` yayınlıyor; SQL/DSN/secret loglanmıyor.

Migration gerekmedi. P3-03 şeması sayaç/outcome CHECK'lerini, tek RUNNING partial unique index'ini, örnek benzersizliğini ve terminal timestamp kurallarını zaten sağlıyor.

## Eklenen ve değişen dosyalar

- `apps/api/src/runs/run-scheduler.ts`: `RunScheduler`/`RunTimer` arayüzü, `RUN_SCHEDULER` token'ı ve gerçek timer + duvar/monotonik saat uygulaması.
- `apps/api/src/runs/measurement-evaluation.ts`: 6 basamaklı kanonik decimal ayrıştırma, `NUMERIC(18,6)` sınır doğrulaması, dahil (inclusive) tolerans karşılaştırması, ilk ihlal ilerlemesi, adım/run outcome'u ve min/max/ortalama hesabı.
- `apps/api/src/runs/measurement-evaluation.spec.ts`: T01–T05 sınır, negatif, eşit min/max, geçersiz değer, ihlal koruma ve istatistik birim testleri (7 test).
- `apps/api/src/runs/run-executor.ts`: sıralı yürütücü; scheduler beklemesi, kısa transaction'lar, snapshot'tan simülasyon girdisi, savunmacı çıktı doğrulama, örnek/adım/run commit'leri, olay payload'ları, shutdown timer temizliği ve teknik hata yolu.
- `apps/api/src/runs/runs.service.ts`: scheduler saatiyle `startedAt`, snapshot commit'inden sonra `RunExecutor.start()` çağrısı; HTTP yanıtı yürütmeyi beklemiyor.
- `apps/api/src/runs/runs.module.ts`: `RunExecutor` ve `RUN_SCHEDULER` sağlayıcıları.
- `apps/api/test/support/run-schedulers.ts`: deterministik kontrollü scheduler; `auto` modunda gecikmeyi gerçek beklemeden ilerletir, `paused` modunda terminal durum commit edilene kadar timer'ları tutar.
- `apps/api/test/support/create-test-application.ts`: testlerin scheduler gibi provider'ları override etmesine izin veren geriye uyumlu `overrides` seçeneği.
- `apps/api/test/runs-execution.e2e-spec.ts`: gerçek PostgreSQL ve gerçek HTTP ile 7 yürütme testi.
- `apps/api/test/runs.e2e-spec.ts`: başlatma testleri, yürütücüyle yarışmaması için paused scheduler kullanacak şekilde düzenlendi; kapsam ve beklentiler değişmedi.
- `docs/tasks/P3-05.md`: durum ve kanıt alanları.
- Bu kanıt dosyası.

## Yürütme tasarımı

1. `POST /api/runs` snapshot'ı, adımları ve `run.started` olayını tek transaction'da commit eder. Servis yanıtı döndürmeden önce yalnızca `RunExecutor.start(runId)` ile 0 ms'lik bir scheduler timer'ı kurulur; hiçbir veritabanı işi beklenmez.
2. Executor önce simülatörün bütün `(step, sampleIndex, value)` dizisini üretir. Değerler kanonik 6 basamak, sonlu ve `NUMERIC(18,6)` aralığında mı diye doğrulanır. Geçersiz çıktı tolerans hatası değil, `SIMULATOR_OUTPUT_INVALID` teknik hatasıdır. Bu doğrulama ilk yazımdan önce tamamlanır.
3. Her adım için `step.started` ayrı transaction'da yazılır. Her örnek `intervalMs` kadar scheduler üzerinden beklenir; bekleme sırasında açık transaction yoktur.
4. Örnek transaction'ı şu sırayla çalışır: TestRun satırını `UPDATE ... WHERE status='RUNNING'` ile kilitleyip `eventSequence` ve `recordedSampleCount` artırır; RUNNING değilse hiçbir yazı yapmadan döner; RunStep `recordedCount = sampleIndex` koşuluyla güncellenir; Measurement eklenir; `measurement.recorded` aynı transaction'da yazılır. Bu, sıra atlama/tekrarını ve terminal run'a yazmayı engeller.
5. İlk tolerans dışı örnekte `outOfToleranceCount` artar ve `firstFailureSampleIndex` yalnızca null ise atanır. Sonraki normal örnekler bu değeri değiştirmez.
6. Bütün örnekler yazıldıktan sonra adım transaction'ı kayıtlı örnekleri yeniden okur, indekslerin 0..n-1 olduğunu ve ihlal sayısının sayaçlarla uyuştuğunu kontrol eder; min/max/ortalama hesaplar; adımı COMPLETED/outcome ve istatistiklerle kapatıp `step.completed` yayınlar. Eksik sayaçta COMPLETED yazılmaz.
7. Son adımdan sonra run transaction'ı bütün adımların COMPLETED, outcome'larının dolu ve `recordedSampleCount = expectedSampleCount` olduğunu doğrular. Sonuç her adım PASSED ise PASSED, değilse FAILED'dır; status COMPLETED, outcome, finishedAt ve `run.completed` aynı transaction'da commit edilir.
8. Her olay sırası TestRun satırı kilidi altında artırılır; `(runId, sequence)` unique kısıtı ikinci güvencedir. Olaylar `schemaVersion=1` taşır ve istemcinin ihtiyaç duyduğu sayaç/örnek/istatistik alanlarını içerir.
9. Beklenmeyen hata yakalanır; run RUNNING ise ERROR + güvenli `reasonCode` + `finishedAt` yazılır, aktif adım ERROR, başlamamış adımlar NOT_RUN yapılır ve `run.errored` eklenir. Hata kaydı da başarısız olursa yalnızca run kimliği ve güvenli neden kodu loglanır; SQL/DSN yazılmaz.
10. `OnApplicationShutdown` bütün timer'ları iptal eder. Terminal durum gören gecikmiş callback'ler yazı yapmadan çıkar. İşlem sırasında kapanışın yarım transaction bırakması P3-08 recovery kapsamındadır.

## Test edilen davranışlar

- NORMAL run PASSED; 6/6 örnek, üç adım COMPLETED, sayaçlar ve olay dizisi 1..14 boşluksuz. Adım geçişlerinde sonraki `startedAt` önceki `finishedAt`'ten önce değil.
- FORCED_FAILURE: 3 örnekli adımda yalnız `floor((3-1)/2)=1` indeksi ihlal, değer `5.500000`; sonraki örnek ve sonraki adım çalışmaya devam ediyor; genel sonuç FAILED.
- T01/T02: eşit min/max `1.000000` NORMAL run'da bütün örnekler kabul; FORCED_FAILURE aynı adımda `1.000001` üretiyor ve yalnız o örnek reddediliyor.
- İlk ihlal bilgisi sonraki normal örnekte korunuyor; `measurement.recorded` payload'ı `hasOutOfTolerance=true` ve `firstFailureSampleIndex` taşımaya devam ediyor.
- Eksik sayaçla RunStep COMPLETED ve Run COMPLETED doğrudan PostgreSQL'de reddediliyor.
- İstatistikler kayıtlı örneklerden bağımsız Decimal hesabıyla birebir eşleşiyor; boş örnekte null kuralı birim testte doğrulandı.
- Terminal run'dan sonra duplicate `(runStepId, sampleIndex)` unique kısıtla reddediliyor; terminal run'a executor yeniden başlatıldığında ölçüm/olay sayısı değişmiyor.
- Terminal durumdayken serbest bırakılan gecikmiş executor hiçbir ölçüm veya olay yazmıyor.
- Measurement insert'ini zorla bozan gerçek DB trigger'ında run ERROR oluyor, aktif adım ERROR, diğerleri NOT_RUN; `run.errored` yazılıyor ve run RUNNING'de kalmıyor.

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: `apps/api` çalışma alanı, 2026-11-03. Komutlar tek tek, paralel `prisma generate` yarışı olmadan çalıştırıldı.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 320ms on 108 files with 107 rules using 8 threads.
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
Duration    647ms
```

`src/runs/measurement-evaluation.spec.ts` tek başına: `1 passed (1)`, `7 passed (7)`, 128 ms.

```text
$ npm run db:migrate:test --workspace apps/api
6 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npm run test:e2e --workspace apps/api
Test Files  13 passed (13)
Tests       125 passed (125)
Duration    14.55s
```

`test/runs-execution.e2e-spec.ts` tek başına: `1 passed (1)`, `7 passed (7)`, 1.85 sn. `test/runs.e2e-spec.ts` tek başına: `1 passed (1)`, `15 passed (15)`.

```text
$ npm run build --workspace apps/api
> nest build
(çıkış kodu 0)
```

## Kalan riskler ve kapsam dışı

- Tek API süreci varsayımı sürüyor. Süreç beklenmedik şekilde kapanırsa RUNNING satırının INTERRUPTED'a çevrilmesi P3-08 recovery işidir; bu görev yalnızca yakalanabilen çalışma hatalarını ERROR yapar.
- Kontrollü shutdown sırasında devam eden tek bir ölçüm transaction'ı commit edebilir; timer'lar iptal edilir ve sonraki yazılar denenmez. Kesin kapanış semantiği P3-08'de tamamlanacak.
- İptal uç noktası ve iptal/ölçüm yarışının ürün akışı P3-07'de; P3-05 yazma yolu terminal durumu satır kilidi altında kontrol ettiği için iptal commit'inden sonra yazmaz.
- Snapshot/SSE okuma uçları P3-06/P4 kapsamındadır. Bu görevde olay payload'ları ve `eventSequence` üretilir; SSE envelope P4'te kurulur.
- İstatistik JSON alan adları `minimum`, `maximum`, `average`, `sampleCount` olarak seçildi; sözleşmede alan adı düzeyinde ayrı bir şema tanımlanmadığı için P3-06 snapshot DTO'su bunları tüketmeli veya eşlemelidir.
- Ortalama altı basamakta sıfırdan uzağa yuvarlanır; minimum/maksimum tam örnek değerleridir. Bu kural `decimal-v1` değerlendirme sürümüne bağlıdır.
- Terminal run'a doğrudan SQL ile yazmayı engelleyen ayrı bir veritabanı trigger'ı yoktur; ürün yazma yolu executor'dur ve satır kilidi + RUNNING kontrolü uygular. P3-03'te bu risk kaydedilmişti.
- Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı; kart In Review'dadır, Accepted değildir.
