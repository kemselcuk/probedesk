# Özellik paketi 1 — Analiz, raporlama ve cihaz izlenebilirliği

- Tarih: 2026-11-06.
- Durum: **Plan hazırlandı; kullanıcı incelemesi ve sonraki uygulama talimatı bekleniyor.**
- Seçilen paket: analiz dashboard'u, dışa aktarma/rapor, cihaz-seri numarası takibi ve plan kopyalama.
- Branch: `feat/analytics-reporting-devices`.
- Başlangıç commit'i: `e46b740c6ba5fd35326a95326b0427d6a5bf43db`.
- Bu belge tasarım önerisidir. Mevcut ürün sözleşmelerinin yerine henüz geçmez; uygulama veya kabul kanıtı değildir.
- Bu tur yalnızca plan ve git hazırlığı yapılır. Kod, migration, uygulama görevleri, subagent çalışmaları ve delivery güncellemesi sonraki talimata kadar başlatılmaz.

## 1. Amaç ve sınırlar

Hedef kullanıcı akışı: Planner bir yayımlanmış planı kopyalar, cihaz kaydını hazırlar; Operator cihaz/parti bilgisiyle testi çalıştırır; bütün roller dashboard'dan sonucu inceler ve kayıtlı kuralları içeren raporu indirir/yazdırır.

Bu paket mevcut NestJS, Angular, PostgreSQL, Material/CDK ve Chart.js yapısını kullanır. Ek altyapı maliyeti hedefi €0'dır. Yeni ücretli servis, veri ambarı, kuyruk sunucusu veya PDF sunucusu gerekmez.

Korunacak davranışlar:

- Tek cihaz profili (`DC Power Module`), tek simülatör, tek API süreci ve aynı anda tek aktif run devam eder. Yeni cihaz kayıtları bu profile bağlı test nesneleridir; fiziksel cihaz bağlantısı değildir.
- Ölçüm değerleri/toleranslar ondalık metindir; resmi karar backend'e aittir.
- Published planlar, terminal run'lar, ölçümler ve geçmiş snapshot'lar değişmez.
- Üç rol ve mevcut plan/run yetkileri korunur; yeni yetkiler aşağıdaki matriste açıkça tanımlanır.
- SSE replay, iptal/kesinti, kısmi veriler ve retry'ın yeni run olması korunur.
- UI/API/README İngilizce; plan ve kullanıcı iletişimi Türkçe kalır.
- Ölçüm tablolarının bütün sütunlarındaki merkez hizası dahil son kullanıcı UI tercihleri korunur.

Bu pakete dahil olmayanlar: toplu çalıştırma, zamanlama, paralel test, yeni simülasyon senaryosu/profil türü, regresyon motoru, yorum/inceleme iş akışı, kullanıcı yönetimi, tenant ayrımı, fiziksel donanım, e-posta/webhook, otomatik sunucu PDF üretimi ve video.

“Şablon” bu sürümde yayımlanmış bir planın yeni bağımsız plan için başlangıç olarak kullanılmasıdır. Ayrı bir şablon yönetim sistemi veya adım kütüphanesi eklenmez.

## 2. Başlangıç incelemesi ve kod girişleri

Okuma sırası [uygulama rehberi](implementation-guide.md) ve [belge dizini](README.md) üzerinden izlendi. [Gereksinimler](requirements.md), ölçüm/simülasyon, mimari, veri/API/frontend, [test](testing.md)/demo/kabul, roadmap ve görev dizini incelendi. Tarihsel belgelerde bazı girişler hâlâ “planlandı” diyor; çalışan kod ve gerçek kanıtlar ayrıca dikkate alınır.

| Alan               | Mevcut girişler                                                           | Yeni işin etkisi                                                    |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Veri               | `apps/api/prisma/schema.prisma`, `migrations/`                            | Device ve kopyalama idempotency kaydı; run'a nullable metadata      |
| Başlatma           | `runs.service.ts`, `run-start.ts`, `run-snapshot.ts`                      | Cihaz/parti doğrulaması, hash uyumluluğu, atomik snapshot           |
| Okuma              | `run-history.service.ts`, `run-snapshot-read.ts`, `runs/dto/`             | Metadata ve yeni filtreler; eski kayıtların null desteği            |
| Plan               | `apps/api/src/plans/`                                                     | Published sürümden bağımsız taslak kopyalama                        |
| Modüller           | `apps/api/src/app.module.ts`                                              | Devices, Analytics, Reports modüllerinin lead tarafından bağlanması |
| İstemci sözleşmesi | `apps/api/openapi.json`, `packages/api-client/src/schema.ts`              | Yalnızca üretim komutuyla güncelleme                                |
| Angular            | `app.routes.ts`, `layout/app-shell/`, `features/plans/`, `features/runs/` | Yeni route'lar ve mevcut akışlara metadata/kopyalama                |
| Tasarım            | `styles/_tokens.scss`, `_primitives.scss`, `_data-tables.scss`            | Mevcut ölçek ve tablolara uyum; ikinci tasarım sistemi yok          |
| Kalite             | `apps/api/test/`, web spec'leri, `tests/e2e/`, `scripts/e2e-isolated.mjs` | Gerçek DB/HTTP/browser, yeni tabloların cleanup ve baseline kapsamı |

## 3. Yetki matrisi ve kullanıcı davranışları

P = Planner, O = Operator, V = Viewer. Bu matris yeni davranışların tasarım önerisidir; EX-01'de ana sözleşmelere aktarılır.

| İşlem                                           | P     | O     | V     |
| ----------------------------------------------- | ----- | ----- | ----- |
| Dashboard, cihaz listesi/ayrıntısı/geçmişi      | Evet  | Evet  | Evet  |
| Cihaz oluşturma, düzenleme, arşivleme/geri açma | Evet  | Hayır | Hayır |
| Published sürümden bağımsız plan kopyalama      | Evet  | Hayır | Hayır |
| Start Run'da cihaz ve parti seçimi              | Hayır | Evet  | Hayır |
| Terminal run raporu, CSV ve JSON                | Evet  | Evet  | Evet  |

Yeni mutasyonlar aynı session/CSRF/origin korumasını ve backend rol guard'larını kullanır. Draft plan bilgisi Operator/Viewer'a yeni API'ler üzerinden de sızmaz. Cihazlar mevcut kayıtlar gibi ortak çalışma alanındadır; kullanıcıya özel sahiplik yetkisi türetilmez.

## 4. Veri modeli, migration ve geçmiş uyumluluğu

### 4.1 Device

Önerilen alanlar:

- `id`: UUID; `deviceProfileId`: mevcut profile FK, `onDelete: Restrict`.
- `name`: trim sonrası 1–100 karakter.
- `serialNumber`: trim sonrası 1–100 karakter; ASCII harf/rakam ve `._:/-` karakterleri; görüntülenen harf büyüklüğü korunur.
- `serialNumberKey`: serialNumber'ın büyük harfe çevrilmiş canonical anahtarı; `(deviceProfileId, serialNumberKey)` unique. Arşivleme aynı seri numarasını tekrar kullanılabilir yapmaz.
- `description`: nullable, trim sonrası en çok 500 karakter; boş metin null.
- `archivedAt`: nullable UTC zaman; ayrı silme API'si yok.
- `editRevision`: pozitif tamsayı; düzenleme ve arşiv/geri açma eski revision ile 409 döner.
- `createdById`, `createdAt`, `updatedAt`: mevcut user ilişkisi ve UTC zamanlar.

Liste aktif/arşivli/tümü filtresi, ad/seri numarası araması ve sayfalama sunar. `name ASC, id ASC` kararlı sıralama; varsayılan limit 20, en fazla 100. Arama en çok 100 karakterdir, SQL wildcard'ları literal ele alınır ve bütün sorgular parametrelidir. İlk sürümde arama ad/seri numarası prefix eşleşmesidir; indeks kullanımı gerçek sorgu planıyla kontrol edilir. Arama için ayrı extension/arama servisi eklenmez.

### 4.2 TestRun ekleri

- `deviceId`: nullable UUID FK, Restrict. Eski ve cihaz seçilmeden başlayan run'larda null.
- `deviceSnapshot`: nullable JSON; `{id, name, serialNumber, deviceProfileId}`. Yeni run başladığında cihazın o andaki bilgileri kopyalanır.
- `batchNumber`: nullable metin, trim sonrası 1–100 karakter; ASCII harf/rakam ve `._:/-`; görüntülenen değer korunur.
- `batchNumberKey`: nullable canonical büyük harf anahtarı; filtreler büyük/küçük harfe duyarsız exact eşleşir.

Cihaz seçimi ve parti bilgisi isteğe bağlıdır; parti cihaz seçmeden de yazılabilir. Bunlar ölçüm üretimini/sonucunu değiştirmez. Cihaz profili yayımlanmış planın profiliyle aynı olmak zorundadır.

Geçmiş ekranında snapshot gösterilir; cihaz yeniden adlandırılırsa eski run'ın adı/seri numarası değişmez. Cihaz ayrıntısı güncel kaydı gösterir; geçmiş satırlarında o günün snapshot'ı korunur. Eski run'lar `No device recorded` ve `No batch recorded` ile gösterilir; geriye dönük tahmini eşleştirme yapılmaz. Nullable ilişki ile snapshot'ın birlikte dolu/boş olması ve snapshot kimliğinin ilişkiyle eşleşmesi DB/servis korumasıyla doğrulanır.

Start Run UI aktif cihazları seçtirir. Arşivlenmiş cihaz yeni run'a bağlanamaz; eski run/history/report erişimi sürer. Run Again eski snapshot'ı gösterir, aynı cihaz hâlâ aktifse seçer; arşivliyse kullanıcı yeni cihaz seçer veya cihaz seçimini açıkça kaldırır. Yeni run'da güncel cihaz snapshot'ı alınır.

### 4.3 Kopyalama idempotency kaydı

`PlanCopyRequest`: UUID, `requestedById`, `idempotencyKey`, `requestHash`, `sourceVersionId`, `targetPlanId`, `createdAt`. `(requestedById, idempotencyKey)` unique; plan/sürüm/user ilişkileri Restrict. Bu kayıt yeni planın kalıcı kopyalama kaynağıdır; revision `baseVersionId` başka plana bağlanmaz. Ölçüm snapshot'ları gibi bir olay günlüğü veya genel audit sistemi oluşturulmaz.

### 4.4 Migration stratejisi

1. Yeni tablolar ve nullable run alanları eklenir; mevcut run/ölçüm/event içeriği değiştirilmez.
2. Mevcut tek RUNNING index'i, published/terminal immutability ve append-only korumaları incelenir. Yeni run metadata alanları da aynı immutability kapsamına açıkça alınır; korumalar gevşetilmez.
3. FK, unique, revision/uzunluk ve metadata tutarlılığı kısıtları gerçek PostgreSQL'de sınanır.
4. Cihaz geçmişi için `(deviceId, startedAt DESC, id DESC)`; parti filtreleri için sorgu planına göre `(batchNumberKey, startedAt DESC, id DESC)` değerlendirilir. Rastgele indeks çoğaltılmaz; analytics EXPLAIN çıktıları kanıta eklenir.
5. Hem boş DB kurulumu hem mevcut seed/run içeren ayrı kopya test DB'sinin yükseltmesi doğrulanır. Yükseltme öncesi/sonrası eski snapshot, tolerans, ölçüm, event ve idempotency sonuçları karşılaştırılır.
6. İki cihazlık eklemeli demo seed tasarlanır. Sabit fixture UUID'leriyle yeniden çalıştırmada çoğaltma/overwrite yapılmaz; başka kayda ait seri numarası çakışmasında işlem açık hata verir. Eski dört demo run cihazlara sonradan bağlanmaz. Başlangıç seed'ine yeni run eklenmez.

## 5. HTTP sözleşmesi

Yollar `/api` altındadır. Aşağıdakiler henüz uygulanmamış sözleşme önerileridir. DTO/OpenAPI üretimi frontend entegrasyonundan önce yapılır.

| Method | Yol                                 | İzin  | Başarı ve içerik                                                                         |
| ------ | ----------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| GET    | `/devices`                          | P/O/V | 200; `q`, `state=active\|archived\|all`, `page`, `limit`, isteğe bağlı `deviceProfileId` |
| POST   | `/devices`                          | P     | 201; profil, ad, seri numarası, açıklama                                                 |
| GET    | `/devices/:id`                      | P/O/V | 200; güncel cihaz, revision ve arşiv bilgisi                                             |
| PATCH  | `/devices/:id`                      | P     | 200; `expectedRevision` ve değişen ad/seri/açıklama; profil değiştirilemez               |
| POST   | `/devices/:id/archive`              | P     | 200; `expectedRevision`; geçmişe zarar vermeyen arşivleme                                |
| POST   | `/devices/:id/restore`              | P     | 200; `expectedRevision`; tekrar seçilebilir hale getirme                                 |
| POST   | `/runs`                             | O     | Mevcut 202/200; ek `deviceId?`, `batchNumber?`                                           |
| GET    | `/runs`                             | P/O/V | Mevcut sayfalama; ek `deviceId`, `batchNumber`, `planVersionId`, `scenario` filtreleri   |
| POST   | `/plan-versions/:id/copy`           | P     | 201 yeni bağımsız draft; aynı idempotent istek replay'ında 200                           |
| GET    | `/analytics/overview`               | P/O/V | 200; KPI, günlük trend ve en sık başarısız adımlar                                       |
| GET    | `/runs/:id/report`                  | P/O/V | 200; terminal run için tipli rapor verisi                                                |
| GET    | `/runs/:id/export?format=csv\|json` | P/O/V | 200; terminal run için attachment                                                        |

Ortak hatalara ek olarak `DEVICE_SERIAL_CONFLICT` (409), `DEVICE_CONFLICT` (409), `DEVICE_ARCHIVED` (409), `DEVICE_PROFILE_MISMATCH` (422) tanımlanır. Bilinmeyen UUID 404, bozuk girdi 400, yetkisiz rol 403 olur. Kopyalama mevcut `IDEMPOTENCY_CONFLICT` ve report/export mevcut `RUN_NOT_TERMINAL` kodunu kullanır. Hata gövdesinde güvenli `requestId` ve İngilizce mesaj korunur. Yeni kodlar ortak enum/OpenAPI kapsamına lead tarafından eklenir.

### 5.1 Start Run'ın kritik uyumluluk kuralları

- `run-start.ts` bugün `probedesk-run-start-v1` marker'ıyla hash üretiyor. Metadata yoksa veya null/boş normalize edilmişse eski v1 hash aynen korunur. Metadata varsa ayrı v2 marker ve canonical `deviceId`/`batchNumberKey` kullanılır.
- Eski idempotency key tekrarında önce kayıt/hash kontrol edilir; cihazın bugün arşivli olması veya adının değişmesi başarılı replay'ı bozmaz. Güncel cihaz adları request hash'e girmez.
- Aynı key ile farklı cihaz/parti 409 üretir. Parti harfi büyüklüğü/boşluk ve UUID harfi büyüklüğü gibi canonical eşdeğer girdiler aynı istek sayılır.
- Yeni başlangıçta cihaz aktifliği/profil uyumu ve snapshot okuması run transaction'ında doğrulanır. Cihaz güncelleme/arşivleme ile başlangıç aynı cihaz satırı üzerinde kilitlenerek sıralanır; TOCTOU boşluğu bırakılmaz. Plan immutable sürümünden okunur.
- Run, adım snapshot'ları ve `run.started` aynı transaction'da kalır. Metadata snapshot okuma API'sinden gelir; mevcut event payload'larına zorunlu alan veya geriye dönük event değişikliği eklenmez.
- History filtrelerinde `planVersionId` ile `planId` verilmişse aynı plana ait olma şartı vardır. Senaryo ve cihaz/parti filtreleri bütün sayfalama/count sorgularında aynı uygulanır.

### 5.2 Plan kopyalama

İstek: `{name}` ve zorunlu `Idempotency-Key`. Kaynak yalnızca URL'deki **yayımlanmış** sürümdür; kaydedilmemiş editor içeriği sessizce kopyalanmaz.

Tek transaction yeni TestPlan, ilk DRAFT revision, yeni StepIdentity/PlanStep kayıtları ve PlanCopyRequest oluşturur. Sıra, ad, birim, toleranslar, sampleCount ve intervalMs aynen korunur; bütün plan/revision/logicalStepId kimlikleri yenilenir. Draft `versionNumber=null`, `baseVersionId=null`, `editRevision=1` olur. Kaynak planın geçmişi/run'ları kopyalanmaz; kaynak değişmez.

Yanıt `{planId, draftRevisionId, sourceVersionId, replayed}` alanlarını sunar. Aynı kullanıcı/key/istek aynı hedef planı döndürür; farklı ad veya kaynak sürümde 409. Eşzamanlı aynı key tek hedef oluşturur; kaybeden transaction orphan plan bırakmaz. İstek başarıyla gönderilip yanıt kaybolursa UI aynı key ile retry yapar; form değişirse yeni kullanıcı aksiyonuyla yeni key oluşturur.

UI varsayılan adı `<source name> (copy)` olarak önerir; 100 karakter sınırına uygun keser ve kullanıcı düzenleyebilir. Kaynak draft-only ise eylem yoktur; versiyon sayfasında seçili sürüm, listede latest published açıkça belirtilir. Bağımsız kopya, mevcut “Create new version” eyleminden ayrı sunulur. İki planı karşılaştırma yasağı devam eder.

## 6. Dashboard hesaplama sözleşmesi

### Filtre ve tutarlı okuma

- `from`, `to`: zorunlu UTC ISO zaman; `[from,to)`, `from < to`, en çok 366 gün. UI başlangıcı bugün dahil son 30 UTC takvim günüdür; URL'ye açık tarihler yazılır.
- İsteğe bağlı `planId`, `planVersionId`, `deviceId`, `batchNumber`, `scenario`. Versiyon filtresi UI'da plan seçimine bağlıdır; plan değişince eski versiyon temizlenir. API'de versiyon tek başına da kullanılabilir; plan da verilirse eşleşmesi doğrulanır.
- Filtre zamanı bütün veri kümelerinde `run.startedAt` olur. Üst filtrelerde status/outcome yoktur; bunlar kart/grafikten history'ye geçişte eklenir.
- Tek response `asOf` ve çözümlenmiş filtrelerle gelir. Summary/trend/top-step sorguları aynı kısa repeatable-read snapshot'ını kullanır; aktif test sürerken yanıt içindeki toplamlar birbirini tutar.
- Backend parametreli SQL/Prisma aggregate kullanır; Angular'a bütün geçmiş/ölçümler indirilip hesap yapılmaz. Ölçüm tablosu taraması bu KPI'lar için gerekmez.

### KPI tanımları

| Alan                                    | Tanım                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| totalRuns                               | Filtrelere uyan bütün status'ların toplamı                                                            |
| completedRuns                           | Yalnızca `COMPLETED`; passed + failed ile aynı                                                        |
| passedRuns / failedRuns                 | COMPLETED içindeki kayıtlı outcome sayıları                                                           |
| running/cancelled/interrupted/errorRuns | Her durumun ayrı sayısı; failure içine karıştırılmaz                                                  |
| passRatePercent                         | `100 × passed / completed`, backend decimal hesap, 2 hane half-up ondalık metin; completed=0 ise null |
| averageDurationMs                       | COMPLETED run'ların `finishedAt-startedAt` ortalaması; 3 hane half-up ondalık metin; örnek yoksa null |

UI null oran/süreyi `—` ve açıklamayla gösterir; boş veri %0 başarılı diye sunulmaz. Chart çizimi için numeric dönüşüm yapılabilir; KPI/sonuç yeniden hesaplanmaz. Simüle edilmiş veri bağlamı sayfada görünür; rastgele/forced failure koşuları gerçek üretim kalite metriği gibi etiketlenmez.

Günlük trend UTC günlerine gruplanır; ilk/son gün yalnız seçilen zaman dilimini kapsar. Eksik günlerin sayıları 0, başarı oranı null olur. Her gün status sayıları ve completed passed/failed ayrımı içerir; sayılar seçilen summary ile toplanabilir.

En sık başarısız adımlar en çok 10 satırdır. Yalnız COMPLETED run'ların COMPLETED adımları kullanılır. Gruplama `planId + planVersionId + logicalStepId + unit`; farklı sürüm/birim/toleranslar tek performans grubunda karıştırılmaz. Satırda snapshot plan/adım adı, sürüm, birim, completedStepRuns, failedStepRuns ve backend failureRatePercent olur. Sıra failedStepRuns DESC, completedStepRuns DESC ve kalıcı kimliklerle deterministiktir.

Kart/gün tıklaması aynı filtrelerle `/runs` ekranına gider. Belirli adım için bu pakette history'nin desteklemediği adım filtresi varmış gibi davranılmaz: satır ilgili plan/sürümün Failed run listesine gider ve bağlantı bunu açıkça söyler. Gün bağlantısı mevcut aralıkla UTC gününün kesişimini taşır.

İlk sürüm otomatik polling yapmaz; Refresh düğmesi ve son güncelleme zamanı vardır. Hızlı filtre değişiminde `switchMap` eski yanıtın yeniyi ezmesini önler; backend hatasında eski veri açıkça stale gösterilir veya hata paneline geçilir.

## 7. Rapor ve dışa aktarma

Rapor/export ilk sürümde sadece terminal run içindir. RUNNING için 409 ve UI'da açık açıklama olur. CANCELLED/INTERRUPTED/ERROR dahil bütün terminal durumlar desteklenir; eksik veri başarıya çevrilmez.

`GET /runs/:id/report` tutarlı snapshot'tan bir projection döndürür: `schemaVersion=1`, `generatedAt`, run kimliği, snapshot plan/sürüm/profil/cihaz/parti, scenario/seed ve sürüm bilgileri, başlangıç/bitiş, status/outcome/reasonCode, expected/recorded ve her adımın kayıtlı kuralları/durumu/istatistikleri/ölçümleri. Rapor `requestedBy` için yalnız mevcut public kullanıcı özetini kullanabilir; session, CSRF, passwordHash, requestHash, idempotencyKey ve iç event payload'ları alınmaz.

### CSV

- UTF-8 BOM, virgül ayraç, CRLF ve RFC 4180 quoting. Excel uyumu için seçilen BOM byte testine bağlanır.
- Her **kaydedilmiş ölçüm** bir satırdır. Kolonlar: runId, planName, versionNumber, deviceName, serialNumber, batchNumber, scenario, runStatus, runOutcome, stepPosition, stepName, unit, minimum, maximum, sampleIndex, value, elapsedMs, recordedAt, isWithinTolerance.
- Sıra stepPosition ASC, sampleIndex ASC. Değer/tolerans 6 hane decimal metin, zaman tam UTC ISO/milisaniye; frontend biçimi CSV'ye taşınmaz.
- Null metadata boş hücredir; ölçüm yoksa header-only CSV oluşur. Kaydedilmemiş örnek için uydurma satır yoktur; kısmi adımların ayrıntılı özeti JSON/raporda yer alır.
- Kullanıcı metni olan hücrelerde formül enjeksiyonu önlenir; `=`, `+`, `-`, `@` ve baştaki kontrol karakterleri ayrıca ele alınır. Resmi numeric kolonlardaki negatif ölçüm/tolerans metni değiştirilmez. Virgül, tırnak, satır sonu ve Türkçe/Unicode metin byte düzeyinde test edilir.

### JSON ve HTTP

- JSON export aynı rapor projection'ının versiyonlu, belgeli çıktısıdır; ondalık metinler korunur. Bu bir içe aktarma/yedek geri yükleme formatı değildir.
- Content-Type: `text/csv; charset=utf-8` veya `application/json; charset=utf-8`; `Content-Disposition: attachment` ve `Cache-Control: no-store`.
- Dosya adı yalnız güvenli run UUID'sinden üretilir: `probedesk-run-<uuid>.csv/json`; plan/cihaz adları header'a yazılmaz.
- Mevcut run başına 10.000 örnek sınırı korunur; tüm geçmiş export'u, arka plan işi veya geçici public download link'i eklenmez.
- Frontend aynı-origin HttpClient ile blob indirir, gerçek HTTP hatasını gösterir ve object URL'yi temizler. Auth 401/403 davranışı diğer ekranlarla aynıdır.

### Yazdırılabilir görünüm / PDF

`/runs/:runId/report` Angular route'u özet, metadata, adım sonuç/kuralları ve her adımın ölçüm grafiğini gösterir. Ham 10.000 satır rapora otomatik basılmaz; tamamı CSV/JSON'dadır. Kısmi durum/eksik örnekler ve “Simulated test results” görünür kalır.

`Print / Save PDF` native browser print dialog'unu açar; sunucuda PDF motoru ve otomatik imzalı sertifika yoktur. A4 portrait, 12 mm kenar önerilir; navigation ve eylemler basılmaz. Uzun ad/seri numarası sarılır; tablo başlıkları gerektiğinde tekrar eder. Grafikler font/veri/canvas hazır olduktan sonra baskıya hazırlanır; boş canvas veya kırpılmış grafik kabul edilmez. Grafik çizimi başarısızsa veri özeti korunur ve Print sessizce eksik rapor üretmez.

## 8. Frontend uygulama planı — lead sahipliği

Bütün `apps/web/**` dosyaları ve web component/facade testleri bende olacak. Delegeler frontend dosyalarına kod yazmayacak. Standalone lazy routes, typed Reactive Forms, RxJS facade ve generated API tipleri kullanılacak.

### Navigasyon ve route'lar

- Sidebar'a `Overview` ve `Devices` eklenir; mevcut Test Plans/Run History/Compare korunur. `/` yönlendirmesi Overview olur; mevcut deep link'ler çalışır.
- `/overview`: dashboard. `/devices`: liste. `/devices/:deviceId`: güncel metadata ve cihaz geçmişi. `/runs/:runId/report`: rapor. Statik route'lar parametrik route'lardan önce yerleştirilir.
- Cihaz oluşturma/düzenleme ve plan kopyalama için Material dialog; create/update state, API fieldErrors, klavye/Escape ve odak geri dönüşü tanımlanır.
- Üst route authGuard, mutasyonlar roleGuard/API yetkileri kullanır. Yetki olmayan eylem sadece disabled olarak değil uygun şekilde kaldırılır.

### Overview

1. Başlık + simülasyon açıklaması + Refresh ve güncelleme zamanı.
2. Datepicker'lı tarih aralığı, plan/sürüm, senaryo, cihaz araması/seçimi ve parti filtresi. URL kaynak durumdur; geri/ileri/yenileme aynı görünümü getirir.
3. Öncelikli 4 KPI: total, pass rate, failed, average duration; diğer status'lar kompakt etiketler ve sayılarıyla ayrı gösterilir.
4. Günlük test sonucu grafiği ve aynı verinin erişilebilir tablosu. Gösterge sadece renge dayanmaz; klavye kullanıcısı history bağlantısına tablodan ulaşır.
5. En sık başarısız adımlar tablosu; sürüm/birim açık, uzun metin sarılır, row action ayrı ve açık.
6. Loading/empty/error ve filtreye uymayan sonuç ayrı durumlar; eski yanıt ve subscription/chart leak testleri.

### Devices ve mevcut run ekranları

- Devices tablosu: Name, Serial number, Profile, State, Actions. Prefix arama, aktif/arşiv filtresi ve sayfalama URL'dedir.
- Planner create/edit/archive/restore; Operator/Viewer salt okunur. Arşivleme dialog'u mevcut geçmişin korunacağını ve yeni run seçimine kapanacağını açıklar.
- Ayrıntı sayfası metadata + `/runs?deviceId=...` ile aynı history verisini kullanır; run listesi ve filtre bileşenleri kopyalanmaz, gerektiğinde lead ortak view çıkarır.
- Start Run: isteğe bağlı Device seçimi (arama + sayfalı yükleme), Batch number ve seçilen seri numarası/profil özeti. Seçim kontrolünün sağ kenarı dahil tüm tıklama alanı çalışır.
- Device URL'sinden Start Run'a geçilirse `deviceId` önseçimi yalnız aktif/profil uyumlu olduğunda uygulanır.
- Live/Details: snapshot cihaz/parti metadata'sı. History: cihaz/parti/sürüm/senaryo filtreleri; tabloya gereksiz her alanı ayrı kolon ekleyip genişletmek yerine plan alt satırında cihaz/parti gösterimi. Compare başlığında iki run'ın cihaz/parti bilgisi; cihaz farkı mevcut aynı-plan kuralını bozmaz.
- Details terminal action grubunda CSV, JSON ve View report; tekrar tıklama/pending/hata kontrollü. Rapor ekranı tam sayfa yenileme ve doğrudan URL ile açılır.

### Plan kopyalama

Test Plans ve Published Version ekranında Planner'a `Copy as new plan`; dialog kaynak adı/sürümü, yeni ad ve bağımsız taslak açıklamasını gösterir. Başarıda yeni editor'a geçilir. Kaynakta draft varsa kaynak seçimi Published sürümü gösterir; taslaktan sessiz kopya yoktur. Retry aynı idempotency key'i korur, sunucu hatasında ad alanı silinmez.

### Tasarım ve görsel kabul

Mevcut 52 px toolbar, 224 px sidebar, 24/16 px sayfa/panel, 8/12/24 px grup ritmi; 40 px form, 36/32 px düğme ve 14/22 px tablo metni kullanılır. Gerekmedikçe global token değişmez. Yeni her tablo kendi içerik genişliğine göre tanımlanır; kolonlar boş alanı doldurmak için eşit yayılmaz. Ölçüm tablolarında bütün başlık/değerler ortada kalır.

Kontroller 1440, 1280, 768 ve 390 px'de incelenir. Sayfa yatay taşmaz; geniş veri tablosu yalnız kendi kapsayıcısında kayar. Uzun UUID/seri numarası, 100 karakter ad, null metadata, çok sayıda filtre, boş tarih aralığı, %200 zoom ve klavye yolu ayrıca kontrol edilir. Yeni dashboard chart'ı için mevcut Chart.js setup ve teardown düzeni kullanılır; grafik kütüphanesi eklenmez.

## 9. Subagent iş bölümü ve çakışma yönetimi

Kullanıcı isteğiyle yalnız T3 `delegate_task` üzerinden uygulama delegasyonu yapılacak; yeni top-level thread açılmayacak. 2026-11-06 capability kontrolünde şu hedef kullanılabilir bulundu:

```json
{
  "providerInstanceId": "opencode",
  "driverKind": "opencode",
  "model": "opencode-go/deepseek-v4.1-flash",
  "options": { "variant": "max" }
}
```

Bir sonraki uygulama oturumunda katalog değişirse önce doğrulanır; model/sağlayıcı sessizce değiştirilmez. **Aynı anda en fazla 4 subagent** çalışır; ihtiyaç yoksa daha az kullanılır. Bu planlama turunda subagent başlatılmaz.

| İş akışı                   | Görev                                                                  | Münhasır dosya sahipliği                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead — ben                 | Frontend, sözleşme koordinasyonu, üretimler, git, teslim               | `apps/web/**`, `packages/api-client/**`, `apps/api/openapi.json`, `app.module.ts`, ortak error enum/DTO, root config/lock/workflows ve ana docs/görev kartları |
| A — Devices / run metadata | Şema, migration, Device API, run başlangıç/snapshot/history uyarlaması | `apps/api/prisma/**`, `apps/api/src/devices/**`, `apps/api/src/runs/**`, bu alanların API unit/integration testleri                                            |
| B — Analytics              | Dashboard sorguları, DTO ve API testleri                               | `apps/api/src/analytics/**`, `apps/api/test/analytics.e2e-spec.ts` ve analytics'e özel yeni testler                                                            |
| C — Copy / reports         | Önce plan kopyalama, sonra report/export servisi                       | `apps/api/src/plans/**`, `apps/api/src/reports/**`, copy/report/export'e özel yeni API testleri                                                                |
| D — QA / bağımsız review   | Sırası geldiğinde E2E/cleanup, ayrı görevlerle bağımsız inceleme       | QA sırasında `tests/e2e/**`, `scripts/e2e-isolated.mjs` ve ilgili fixture cleanup/baseline; review sırasında yalnız kendisine ayrılan yeni kanıt kaydı         |

A/B/C/D birer çalışma rolüdür, zorunlu dört sürekli agent değildir. Her delegate **bir görev kartı** alır. Aynı agent'a bütün paketi tek iş olarak verip paralel kontrolsüz uygulama yaptırılmaz. Bir inceleme veya tekrar inceleme ayrı `delegate_task` olur; implementer özeti tek başına kabul kaydı sayılmaz. Aynı kaynak kodunu yazan agent kendi bağımsız reviewer'ı olmaz.

Delegate geçmiş konuşmayı otomatik almadığından her brief kendi başına yeterli olur: görev kartı ve bu planın tam yolu, okunacak AGENTS/ana sözleşmeler, kesin izinli/yasak dosyalar, API girdi/çıktıları, bağımlılıkların gerçek durumu, atanmış test DB'si/komutlar ve kabul maddeleri açıkça verilir. Git işlemi ve yeni agent başlatma yasaktır. Son rapor değişen dosyaları, çalıştırılan komut/exit/gerçek sonuçları, eksik kontrolleri ve açık bulguları içerir. Paylaşılan dosya veya kapsam kararı gerektiğinde lead'e bildirilir; yetki varsayımıyla genişletilmez.

Paylaşılan checkout, aynı feature branch üzerinde disjoint dosya sahipliğiyle kullanılır. Worker'lar git add/commit/push/checkout/reset/stash çalıştırmaz; git yalnız lead'dedir. Bu görevde kullanıcının feature branch talimatı repository'nin rutin origin/main talimatına göre önceliklidir: her incelenebilir commit **origin/feat/analytics-reporting-devices** üzerine push edilir; main'e merge/push bu planın parçası değildir.

Ortak dosya değişikliği worker tarafından lead'e diff/istek olarak iletilir; sahiplik açıkça devredilmeden başka worker'ın alanı düzenlenmez. Üretilen Prisma client/OpenAPI/istemci dosyalarını yalnız lead belirli noktalarda yeniler. Root package/lock değişikliği gereksinimi lead'e gelir; ilk hedef yeni dependency eklememektir.

Test çalıştırmaları da paylaşılan kaynaktır: aynı DB'yi reset eden iki integration/E2E koşusu eşzamanlı çalışmaz. Lead ayrı `_test` DB'leri veya sırayla tek koşu tahsis eder. Worker'lar gerçek komut/exit/çıktıyı raporlar; çalıştıramadığı kontrolleri açık yazar. Tek bir test DB üzerinde yarışarak alınan yeşil çıktı kabul kanıtı değildir.

## 10. Görev kartları ve bağımlılıklar

Aşağıdakiler **önerilen kartlardır**, tamamı Planned'dır; henüz `docs/tasks/` altında oluşturulmadılar ve mevcut toplam 72 kartın durumları değiştirilmedi. Uygulamaya başlama talimatından sonra EX-01 ilk kart olarak açılır; ana sözleşme/roadmap/görev dizini o aşamada eşgüdümlü güncellenir. Her worker aynı anda tek kart yürütür. Kullanıcının paralel çalışma talimatı doğrultusunda bağımsız kartlar farklı sahiplerde eşzamanlı olabilir.

| Kart  | İş / çıktı                                                                                          | Sorumlu                     | Önkoşul                                    |
| ----- | --------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------ |
| EX-01 | Bu tasarımı requirements/API/model/frontend/testing sözleşmelerine aktarma; kartlar ve izin matrisi | Lead                        | Kullanıcının sonraki başlama talimatı      |
| EX-02 | Device/PlanCopyRequest ve run metadata migration; upgrade/immutability testleri                     | A                           | EX-01                                      |
| EX-03 | Device CRUD/archive/restore, unique/revision, eklemeli seed                                         | A                           | EX-02                                      |
| EX-04 | Start/hash/snapshot/history/SSE metadata uyumu ve yarış testleri                                    | A                           | EX-03                                      |
| EX-05 | Devices UI ve Start/Live/History/Details/Compare metadata entegrasyonu                              | Lead                        | EX-03/04 API sözleşmesi ve üretilen tipler |
| EX-06 | Published plan kopyalama ve idempotency API/testleri                                                | C                           | EX-02                                      |
| EX-07 | Plan kopyalama UI, retry ve editor'a geçiş                                                          | Lead                        | EX-06                                      |
| EX-08 | Analytics overview API, tanımlı sayılar/tarih/filtre ve query planları                              | B                           | EX-04                                      |
| EX-09 | Overview UI, yeni navigation, grafik/tablo/drilldown                                                | Lead                        | EX-08                                      |
| EX-10 | Report projection, güvenli CSV/JSON export ve HTTP testleri                                         | C                           | EX-04; EX-06 bitmiş olmalı                 |
| EX-11 | Download ve print report UI; gerçek canvas/print hazırlığı                                          | Lead                        | EX-10                                      |
| EX-12 | Gerçek bütünleşik E2E, yeni tablolar/session cleanup ve CI baseline                                 | D                           | EX-05/07/09/11                             |
| EX-13 | Bütünleşik bağımsız inceleme, bulgu kapatma, teslim/kanıt/README                                    | Yeni review delegate + lead | EX-12 ve kart bazlı incelemeler            |

EX-02'den sonra C EX-06'yı yürütürken A EX-03/04'ü bitirebilir. EX-04'ten sonra B analytics, C reports, lead ilgili UI ve gerektiğinde D biten kartın bağımsız incelemesini aynı anda yürütebilir. Dört delegate sınırı hiçbir dalgada aşılmaz. Lead ekranları EX-05/07/09/11 sırasıyla birer kart halinde tamamlar; gerekli sözleşmeler gelmeden frontend'de uydurma API davranışı oluşturmaz.

Her kartın gerçek açılışında amaç/REQ, dosya sahipliği, bağımlılık, kabul maddeleri, komutlar, worker kanıtı ve ayrı review kaydı yazılır. Durum `Planned → In Progress → In Review → Accepted`; ilgili docs/tasks/README ve roadmap aynı commit'te güncellenir. Uygulama bitişi önce In Review'dur. Kritik/yüksek bulgu veya eksik gerçek kontrol varken Accepted yazılmaz. Kullanıcı görsel/ürün kabulü teknik incelemeden ayrıdır.

## 11. Test ve kabul matrisi

Bu bölüm **çalıştırılacak** kontrollerdir; bu planlama turunda uygulama testleri çalıştırılmadı.

| Alan      | Zorunlu davranış kanıtı                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration | Boş kurulum ve mevcut verili DB upgrade; eski snapshot/ölçüm/event/hash aynı; yeni immutable alanlar korumalı                                                                                         |
| Devices   | Üç rol; CSRF; trim/limit/serial normalization; iki bağlantıyla duplicate serial yarışı; stale revision; archive/restore; Restrict FK                                                                  |
| Başlangıç | Cihazsız eski istek; null metadata; aktif/arşiv/profil uyuşmazlığı; cihaz update/archive vs start yarışı; v1 retry; v2 retry/conflict; tek RUNNING garantisi                                          |
| Run okuma | Snapshot/SSE reconnect eski ve yeni metadata; device/batch/version/scenario filtreleri, toplamlar, tarih sınırı, aynı startedAt sırası                                                                |
| Kopyalama | Bütün scalar değer/sıra birebir; bütün kimlikler yeni; kaynak unchanged; unpublished/403; duplicate/eşzamanlı key tek hedef; transaction rollback orphan yok                                          |
| Analytics | Bilinen fixture ile bütün status'lar; completed=0; gerçek 0%/100%; decimal rounding; günlük boşluklar; kısmi ilk/son gün; filtre kesişimleri; version/unit ayrımı; top10/tie; no measurement payload  |
| Export    | Gerçek HTTP headers, CSV byte/escaping/formula güvenliği ve negatif decimal; null/Unicode; header-only; 10.000 örnek; RUNNING=409; terminal kısmi/null istatistik; JSON şema/tipleri; hassas alan yok |
| Frontend  | Typed form ve fieldErrors; eski yanıt yarışı; deep link/URL/back; retry key; backend KPI/verdict aynen; auth/empty/error; object URL/chart cleanup                                                    |
| Browser   | Planner create/edit/copy → Operator cihazlı run → Viewer dashboard/drilldown/report/download; klavye, dropdown tüm alanı, takvim, 1440/1280/768/390 ve 200% zoom                                      |
| Print     | Terminal passed/failed/cancelled; uzun metadata; bütün grafikler görünür; navigation yok; sayfa kırıkları ve ondalık/UTC bilgisi korunur                                                              |
| İzolasyon | Başarılı/başarısız senaryodan sonra yeni devices/copy requests/plan/run/session temizliği; başlangıç fixture'ları aynı; CI assert-baseline sıfır artık                                                |

Analytics fixture'ları gerçek PostgreSQL kayıtları ve geçerli durum geçişleriyle hazırlanır; testin kendisi beklenen sayıları bağımsız sabit örneklerden doğrular. Canvas/browser ve DB constraint davranışı mock ile ikame edilmez. Birim testleri canonical/hash/CSV gibi saf davranışlara odaklanır.

Mevcut komutlar, uygulama başladığında uygun kapsamla kullanılacak:

```text
npx npm@11.6.2 ci
npm run lint
npm run typecheck
npm run test:api:unit
npm run test:web
npm run build
npm run openapi:emit
npm run openapi:generate
npm run openapi:check
npm run test:api:integration
npm run test:e2e
npm run verify
node scripts/e2e-isolated.mjs prepare
node scripts/e2e-isolated.mjs seed-check
node scripts/e2e-isolated.mjs assert-baseline
```

Bu liste yürütme sırası değildir. `ci` yalnız temiz kurulum/lock değişikliği kontrolünde; generated artifacts güncellemesi DTO değişikliklerinden sonra; targeted kontroller ilgili kartta kullanılır. Son `verify` integration/E2E'yi içermez, onlar ayrıca koşulur. Aynı kontroller yeni değişiklik/bulgu yokken sırf sayı artırmak için tekrar edilmez. Node 22.23.2 ve npm 11.6.2 kullanılır.

## 12. Entegrasyon ve delivery

1. Lead her biten backend diliminde shared module/error değişikliklerini bağlar, Prisma/OpenAPI/client üretir ve ilgili kontrolleri çalıştırır.
2. Bağımsız inceleme diff/komut/çıktı/kabul maddeleri üzerinden yapılır; küçük bulguları ilgili sahip veya lead düzeltir, yeni review gerekiyorsa yeni delegate açılır.
3. CI workflow'nun feature branch push/PR kapsamı kontrol edilir; gerekli uyarlama lead'dedir. Mevcut E2E veritabanı temizliği kaldırılmaz veya beklenen artıklar sessizce artırılmaz.
4. Mevcut delivery hemen değiştirilmez. Önce feature branch'ten ayrı `_test` DB ve portlarla gerçek stack doğrulanır; kullanıcı veritabanına test/reset uygulanmaz.
5. Sonraki uygulama yetkisi kapsamında teslim zamanı geldiğinde yeni schema gerektiği için API/web birlikte planlı güncellenir. Mevcut verinin yedeği ve migration öncesi kaydı alınır; additive migration uygulanır; named volume korunur. `down -v`, demo reset veya destructive rollback kullanılmaz.
6. `localhost:8080` smoke kontrolünde yeni navigation, API contract, cihazlı run, dashboard, export/report ve eski run açılışı doğrulanır. Hangi commit/image'ın sunulduğu kaydedilir; yalnız dev server'da çalışan UI teslim edilmiş sayılmaz.
7. Kod main'e otomatik merge edilmez. Feature branch'teki sonuç ve kanıtlar kullanıcıya sunulur; main'e alma ayrı sonraki talimattır.

## 13. Bitiş ölçütleri ve kullanıcıya teslim

- Dört özellik gerçek UI/API üzerinden birlikte çalışır; yeni temel kullanıcı yolunda placeholder/fake veri yoktur.
- Eski run'lar, Published planlar, tek aktif test, SSE ve decimal/verdict sözleşmeleri için regresyon kanıtı vardır.
- Her kartın gerçek komut çıktısı ve ayrı inceleme kaydı bulunur; açık kritik/yüksek bulgu yoktur.
- Yeni sayfalarda ortak UI ölçeği ve kullanıcının tablo hizası/boşluk tercihleri korunur; gerçek görsel kontrol kayıtları vardır.
- CSV/JSON indirilebilir, browser print/PDF akışı çalışır; rapor snapshot'tan üretilir.
- README İngilizce, ürün/API/veri/frontend/testing/demo/roadmap/task/evidence kayıtları günceldir; video üretilmez.
- Commit'ler feature branch'e push edilmiştir; CI sonucu gerçekten okunup bildirilmiştir. Çalıştırılmamış kontrol/safari/physical mobile gibi sınırlar açıkça belirtilir.
- Teknik tamamlanma kullanıcı görsel/ürün kabulü yerine geçmez.

## 14. Bu planlama turunun gerçek durumu

- Repository başlangıcı temiz `main...origin/main`, HEAD `e46b740` olarak okundu.
- `feat/analytics-reporting-devices` branch'i oluşturuldu.
- OpenCode sağlayıcısı, DeepSeek V4.1 Flash modeli ve `variant=max` capability kataloğunda doğrulandı; herhangi bir delegate başlatılmadı.
- Yalnız bu plan belgesi eklendi. Ana ürün sözleşmeleri, task durumları, uygulama kodu, DB, container ve localhost delivery değiştirilmedi.
- Belge yapısı Node ile kontrol edildi: `Plan structure OK: 13 unique proposed tasks; model/max, base commit and implementation hold present.` Sonuç exit 0; dört yerel belge bağlantısı ve planlanan 11 kök npm script'i doğrulandı.
- `./node_modules/.bin/prettier --check docs/feature-pack-1-plan.md`: `All matched files use Prettier code style!`, exit 0. `git diff --cached --check`: çıktı yok, exit 0. Staged değişiklik yalnız bu plan belgesidir.
- Uygulama testleri, bağımsız teknik inceleme ve ürün kabulü bu tur yapılmadı.

**Bekleme noktası:** Plan kullanıcıya sunulur. Yeni uygulama talimatı gelmeden EX-01 veya diğer uygulama/delege işleri başlatılmaz.
