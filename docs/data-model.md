# Veri modeli ve tutarlılık

Görevler: [P0-03](tasks/P0-03.md), [P2-01](tasks/P2-01.md), [P3-03](tasks/P3-03.md). Bu belge model sözleşmesidir; schema/migration henüz oluşturulmadı.

## Ortak kurallar

- Kimlikler UUID; zamanlar UTC ve timezone-aware PostgreSQL timestamp olarak saklanır.
- Sayısal ölçüm ve sınırlar NUMERIC(18,6); API'de ondalık metin.
- Published içerik değişmez; geçmiş çalıştırmalar canlı plan ilişkilerinden yeniden değerlendirilmez.
- FK'lar ve benzersiz kısıtlar uygulanır. Geçmişi yok eden cascade delete kullanılmaz.
- Uygulama ilk sürümde tek API süreci çalıştırır; bu sözleşme çok süreçli recovery garantisi vermez.

## Modeller

| Model           | Temel alanlar                                                                                                                                                                                                                                                                                                                                                                                                 | İlişkiler / kısıtlar                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| User            | id, email, passwordHash, role, createdAt                                                                                                                                                                                                                                                                                                                                                                      | email unique; tek rol                                              |
| Session         | id, tokenHash, userId, csrfTokenHash (nullable), expiresAt, revokedAt                                                                                                                                                                                                                                                                                                                                         | tokenHash unique; kullanıcıya bağlı                                |
| DeviceProfile   | id, code, name, description                                                                                                                                                                                                                                                                                                                                                                                   | tek seed profil; code unique                                       |
| TestPlan        | id, deviceProfileId, createdById, createdAt                                                                                                                                                                                                                                                                                                                                                                   | kalıcı plan kimliği                                                |
| PlanRevision    | id, planId, state, name, versionNumber, editRevision, baseVersionId, publishedById, publishedAt                                                                                                                                                                                                                                                                                                               | DRAFT/PUBLISHED; sürüm unique; tek açık taslak                     |
| StepIdentity    | id, planId, createdAt                                                                                                                                                                                                                                                                                                                                                                                         | logicalStepId'nin plan sahipliği; silinse de geçmiş kimlik korunur |
| PlanStep        | id, revisionId, logicalStepId, position, name, unit, minimum, maximum, sampleCount, intervalMs                                                                                                                                                                                                                                                                                                                | revision+position unique; revision+logicalStepId unique            |
| TestRun         | id, planId, planRevisionId, planNameSnapshot, versionNumberSnapshot, profileSnapshot, deviceId?, deviceSnapshot?, batchNumber?, batchNumberKey?, status, outcome, requestedById, scenario, seed, errorProbability, failureStepId, simulatorVersion, evaluationVersion, idempotencyKey, requestHash, eventSequence, expectedSampleCount, recordedSampleCount, startedAt, finishedAt, cancelledById, reasonCode | kullanıcı+idempotencyKey unique; tek RUNNING                       |
| RunStep         | id, runId, logicalStepId, position, name, unit, minimum, maximum, sampleCount, intervalMs, status, outcome, recordedCount, outOfToleranceCount, firstFailureSampleIndex, startedAt, finishedAt, statistics                                                                                                                                                                                                    | run+position ve run+logicalStepId unique                           |
| Measurement     | id, runId, runStepId, sampleIndex, value, isWithinTolerance, recordedAt, elapsedMs                                                                                                                                                                                                                                                                                                                            | runStep+sampleIndex unique                                         |
| RunEvent        | runId, sequence, type, schemaVersion, occurredAt, payload                                                                                                                                                                                                                                                                                                                                                     | run+sequence unique ve artan                                       |
| Device          | id, deviceProfileId, name, serialNumber, serialNumberKey, description, archivedAt, editRevision, createdById, createdAt, updatedAt                                                                                                                                                                                                                                                                            | profile+serialNumberKey unique; FK Restrict; revision optimistic   |
| PlanCopyRequest | id, requestedById, idempotencyKey, requestHash, sourceVersionId, targetPlanId, createdAt                                                                                                                                                                                                                                                                                                                      | user+key unique; kaynak/target FK Restrict; kopya transaction'ı    |

`csrfTokenHash` yalnızca CSRF öncesi kalıtılan oturumları ifade edebilmek için nullable'dır; login her zaman bir değer yazar ve `GET /auth/me` değeri olmayan canlı oturuma yeni okunabilir token üretir. Değer yokken kimlikli mutasyonlar 403 ile reddedilir.

StepIdentity teknik bir kimlik kaydıdır; ayrı ürün ekranı değildir. Silinmiş adım adıyla yeni adım eklenirse yeni kimlik oluşturulur. Bir plandaki kimlik başka planın revision'ına bağlanamaz.

TestPlan'ın görünen adı, ilgili rolün okuyabildiği revision'dan türetilir. Taslak adı değişikliği Viewer/Operator listesine sızmaz. Run'daki plan adı snapshot'tır.

## Taslak ve yayımlama

Taslakta versionNumber null, editRevision pozitif tamsayıdır. Yayımlamada versionNumber atanır ve içerik PUBLISHED olur. versionNumber plan içinde artar; plan satırı kilitlenerek atanır. Yeni taslak son yayımlanmış sürümden kopyalanır; baseVersionId referansı korunur.

Kaydetme isteği expectedRevision taşır. Mevcut editRevision ile uyuşmazsa hiçbir satır değiştirilmeden DRAFT_CONFLICT döner. Uyuşursa adım listesi tek transaction'da güncellenir ve editRevision artar. Kaydetme, Publish ve yeni taslak işlemleri aynı plan/revision kilit düzenini kullanır.

Yayımlanmış revision ve adım kayıtları API/servis seviyesinde değiştirilemez. P2-06 migration'ı Published içeriğe update/delete veya sonradan step insert yapılmasını engelleyen veritabanı korumasını da kapsar. Prisma şemasının ifade edemediği korumalar incelenen SQL migration ile eklenir. Koruma, Publish ile adım kaydının yarışını da kapsamalıdır.

## Snapshot oluşturma

Başlatmada planın yayımlanmış hali doğrulanır, ardından TestRun ve bütün RunStep kayıtları aynı işlemde oluşturulur. RunStep, adı/birimi/sınırları/örnek ayarlarını kopyalar. Çalıştırma scenario/seed, profile, simulatorVersion ve evaluationVersion saklar.

Version ilişkisi izlenebilirlik içindir; sonuç sayfasının tek veri kaynağı değildir. Run başladığında oluşturulan kurallar daha sonra değiştirilemez. Sonuç ve ölçümler yeni toleransla yeniden hesaplanmaz.

## Tek aktif çalışma

RUNNING TestRun kayıtları üzerinde sabit bir anahtar için PostgreSQL partial UNIQUE index kullanılır. Bellekte bir boolean kontrolü tek garanti olamaz. İki bağımsız veritabanı bağlantısıyla yapılan eşzamanlı başlangıç testinde yalnızca bir işlem başarılı olmalıdır.

Bu index terminal durum commit edildiğinde yeni çalışmaya alan açar. İkinci istek kuyruklanmaz; RUN_ALREADY_ACTIVE ile aktif kimliği döner. Aynı idempotency isteği tekrarında önce mevcut sonuç kontrol edilir.

## Transaction sinirlari

| İşlem        | Atomik içerik                                                              |
| ------------ | -------------------------------------------------------------------------- |
| Taslak kaydı | expectedRevision kontrolü, adım değişiklikleri, editRevision artışı        |
| Publish      | doğrulama, sürüm atama, immutable içerik, yayınlayan ve zaman              |
| Başlatma     | idempotency kontrolü, snapshot kayıtları, RUNNING, ilk olay                |
| Örnek kaydı  | RUNNING kontrolü, ölçüm, sayaç/ihlal bilgisi, RunEvent                     |
| Adım bitişi  | yeterli örnek kontrolü, adım sonucu, sonraki adım veya run sonucu, olaylar |
| İptal        | terminal kontrolü, aktif/pending adımların kapanışı, run durumu, olay      |
| Recovery     | yarım run/adımların kapanışı ve Interrupted olayı                          |

Ölçüm, iptal ve adım bitişi aynı TestRun satırında kilitlenir. Timer bekleme veya SSE bağlantısı boyunca transaction açık kalmaz. Kısa transaction'lar ve gerekiyorsa sınırlı serialization retry kullanılır; aktif çalışma çakışması bekletilip ikinci işe dönüştürülmez.

## Durum kısıtları

- COMPLETED için outcome zorunlu; diğer run durumlarında outcome null.
- COMPLETED için bütün beklenen örnekler ve tamamlanan adımlar bulunmalı.
- Terminal run'a yeni measurement ekleme ve sonucu değiştirme servis seviyesinde engellenir; yazma yolu aynı satır kilidi altında durum kontrolü yapar.
- Bir örnek runStep'in runId'siyle uyuşmalıdır; ilişki/composite FK veya eşdeğer DB koruması kurulur.
- sampleIndex, sampleCount sınırındadır; sırayla ve benzersiz yazılır.
- NUMERIC değerler sonlu ve belirlenen aralıkta olmalıdır.
- İstatistikler kayıtlı örneklerden hesaplanır; örnek yoksa null alanlar kullanılır.

## Olaylar ve snapshot okuma

RunEvent sequence TestRun satırı altında atanır; monoton artar ve çalışma içinde boşluksuzdur. Bir transaction birden çok olay üretebilir; hepsi durumla birlikte commit edilir.

GET run snapshot, run/adımlar/ölçümler ve lastEventSequence değerini tutarlı read transaction'ında okur. Snapshot'ın temsil ettiği ölçümlerden sonraki olaylar replay ile tamamlanabilmelidir. Tek bir sıra numarası farklı içerikle yeniden kullanılamaz.

Geçmiş listesi örnek dizilerini yüklemez. Tek run snapshot'ı ürün sınırları nedeniyle en fazla 10.000 örnektir. Bu sınır derleme dışı gizli bir varsayım değil, API doğrulamasının parçasıdır.

## İndeksler ve yaşam döngüsü

History için planId/startedAt/id, global startedAt/id (azalan) ve durum filtreleri; measurement için runStepId/sampleIndex; events için runId/sequence; session için tokenHash/expiresAt indeksleri planlanır. Gerçek sorgular incelenmeden ek indeksler rastgele çoğaltılmaz. Filtresiz/tarih-only history sırası için `(startedAt DESC, id DESC)` indeksi ayrı, gerekçeli migration ile eklenir; `outcome` iki değerli olduğu için ayrı indeks yalnız ölçülen plan gerektirirse değerlendirilir.

İlk sürümde plan/run silme ürünü yoktur. Süresi dolmuş oturumların temizliği geçmiş çalıştırmaları etkilemez. Demo seed idempotenttir; mevcut yayımlanmış sürümleri değiştirmez. Tam reset yalnızca açıkça seçilmiş demo/test ortamında mümkündür.

Kaynaklar: [Prisma v7 transaction'lar](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions), [PostgreSQL partial index](https://www.postgresql.org/docs/current/indexes-partial.html).

## Özellik paketi 1 — yetkilendirilen ek sözleşme (2026-11-06)

Device, PlanCopyRequest ve TestRun nullable deviceId/deviceSnapshot/batchNumber/batchNumberKey alanları eklenir. Canonical seri uniqueness, Restrict ilişkiler, optimistic revision ve atomik start snapshot/kilitleme gereklidir. Eski snapshot/event/hash değiştirilmez; metadata immutability kapsamına alınır. Tam alan ve migration kuralları ek sözleşmenin 4. ve 5. bölümleridir.

Birincil ayrıntılı sözleşme: [Özellik paketi 1](feature-pack-1-plan.md). Görev/durum kaynağı: [EX kartları](tasks/README.md). Çelişki halinde yeni davranışlar için paket sözleşmesi, korunacak davranışlar için mevcut temel sözleşme birlikte uygulanır; kapsam sessizce genişletilmez.
