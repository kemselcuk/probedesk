# REST, hata ve SSE sözleşmesi

Görevler: [P0-03](tasks/P0-03.md), [P1-03](tasks/P1-03.md), [P1-05](tasks/P1-05.md), [P4-01](tasks/P4-01.md). Bu bir tasarım sözleşmesidir; OpenAPI çıktısı henüz yoktur.

## Ortak biçimler

- Base path: `/api`; uygulama aynı origin'den göreli URL kullanır.
- JSON alanları camelCase; enum değerleri aşağıdaki büyük harfli biçimdedir.
- UUID kimlikler; UTC ISO-8601 tarihleri; ms tamsayıları.
- Ölçüm, min/max ve hata oranı ondalık metin; seed ve sayaçlar tamsayı.
- Sonuç içermeyen alanlar null; `0`, boş metin veya PASSED ile temsil edilmez.
- Bilinmeyen yazılabilir alanlar reddedilir. Kullanıcı status, outcome veya verdict gönderemez.
- Kimlik doğrulama session cookie; mutasyonlarda CSRF koruması. Login origin/JSON kontrolü uygular.

## HTTP uçları

P=Planner, O=Operator, V=Viewer. Public yalnızca oturumsuz temel uçları belirtir.

| Yöntem | Yol                                   | İzin   | Başarı  | Davranış                                                                      |
| ------ | ------------------------------------- | ------ | ------- | ----------------------------------------------------------------------------- |
| POST   | /auth/login                           | Public | 200     | oturum cookie ve CSRF düzeni; kullanıcı özeti                                 |
| POST   | /auth/logout                          | P/O/V  | 204     | oturum revocation ve cookie temizliği; oturum zaten yoksa da 204 (idempotent) |
| GET    | /auth/me                              | P/O/V  | 200     | id, email, role; CSRF cookie yenileme gerekiyorsa sağlar                      |
| GET    | /device-profiles                      | P/O/V  | 200     | tek profil                                                                    |
| GET    | /plans                                | P/O/V  | 200     | role uygun liste; P dışına taslak içerik sızmaz                               |
| POST   | /plans                                | P      | 201     | name/profileId ile ilk boş taslak                                             |
| GET    | /plans/:id                            | P/O/V  | 200     | role uygun plan özeti; P için açık taslak                                     |
| POST   | /plans/:id/drafts                     | P      | 201     | son yayımlanmış sürümden yeni taslak                                          |
| PUT    | /plans/:id/draft                      | P      | 200     | expectedRevision ve tam adım listesiyle atomik kayıt                          |
| POST   | /plans/:id/draft/publish              | P      | 201     | expectedRevision ile yayımlanmış sürüm                                        |
| GET    | /plans/:id/versions                   | P/O/V  | 200     | yayımlanmış sürümler                                                          |
| GET    | /plan-versions/:id                    | P/O/V  | 200     | immutable sürüm/adımlar                                                       |
| POST   | /runs                                 | O      | 202     | yayımlanmış sürümün snapshot'ı ve yeni çalışma                                |
| GET    | /runs                                 | P/O/V  | 200     | sayfalı geçmiş; örnek dizileri yok                                            |
| GET    | /runs/active                          | P/O/V  | 200     | aktif run özeti veya null                                                     |
| GET    | /runs/:id                             | P/O/V  | 200     | tam snapshot + lastEventSequence                                              |
| POST   | /runs/:id/cancel                      | O      | 200     | mevcut terminal durum korunarak snapshot                                      |
| GET    | /runs/:id/events                      | P/O/V  | 200     | text/event-stream; replay ve canlı takip                                      |
| GET    | /comparisons                          | P/O/V  | 200     | leftRunId/rightRunId karşılaştırması                                          |
| GET    | /health/live                          | Public | 200     | süreç yaşıyor                                                                 |
| GET    | /health/ready                         | Public | 200/503 | DB + migration/startup recovery hazır                                         |
| GET    | /devices                              | P/O/V  | 200     | prefix arama; state varsayılan active; sayfalama                              |
| POST   | /devices                              | P      | 201     | profile/name/serial/description; canonical seri unique                        |
| GET    | /devices/:id                          | P/O/V  | 200     | güncel cihaz/revision/arşiv                                                   |
| PATCH  | /devices/:id                          | P      | 200     | expectedRevision ve name/serial/description; profil sabit                     |
| POST   | /devices/:id/archive                  | P      | 200     | expectedRevision; arşiv; geçmiş korunur                                       |
| POST   | /devices/:id/restore                  | P      | 200     | expectedRevision; tekrar aktif                                                |
| POST   | /plan-versions/:id/copy               | P      | 201/200 | Published sürüm; name ve Idempotency-Key; yeni draft/replay                   |
| GET    | /analytics/overview                   | P/O/V  | 200     | UTC aralık/plan/version/device/batch/scenario; KPI/trend/top10                |
| GET    | /runs/:id/report                      | P/O/V  | 200     | terminal immutable snapshot projection; schemaVersion=1                       |
| GET    | /runs/:id/export?format=csv veya json | P/O/V  | 200     | terminal attachment; no-store                                                 |

P dışındaki kullanıcıya yalnızca taslağı bulunan plan için 404 dönebilir; taslak varlığı/içeriği açığa çıkarılmaz. İlgili statik route'lar `:id` route'larıyla çakışmayacak şekilde kaydedilir.

## Taslak isteği

`PUT /plans/:id/draft`: name, expectedRevision, steps. Her adım logicalStepId (yeni adımda boş), name, unit, minimum, maximum, sampleCount ve intervalMs taşır. Dizi sırası otoritedir; position sunucu tarafından bu sıradan atanır. Yeni kimlikler sunucuda oluşturulur ve kayıttan sonra forma döner.

Var olan logicalStepId başka planın kimliğiyse veya aynı listede iki kez kullanıldıysa istek reddedilir. expectedRevision uyumsuzsa hiçbir değişiklik yapılmaz. Publish kaydedilmemiş form verisini kendiliğinden kaydetmez; UI önce açıkça kaydeder.

## Test başlatma

Başlık: `Idempotency-Key` zorunlu. İstek alanları:

| Alan             | Tip / kural                                              |
| ---------------- | -------------------------------------------------------- |
| planVersionId    | Yayımlanmış revision UUID                                |
| scenario         | NORMAL, FORCED_FAILURE veya RANDOM                       |
| seed             | uint32                                                   |
| failureStepId    | Yalnızca FORCED_FAILURE; ilgili sürümün logicalStepId'si |
| errorProbability | Yalnızca RANDOM; `"0.050000"` gibi 0–1 ondalık metin     |

Başarı yanıtı runId, status, outcome ve bağlantı kurulabilecek snapshot/events adreslerini içerir. Yürütme HTTP bağlantısının ömrüne bağlı değildir.

Idempotency anahtarı kullanıcı kapsamında benzersizdir. Sunucu kanonik istek gövdesinin hash'ini saklar. Aynı anahtar/aynı istek, çalışma tamamlanmış olsa da mevcut kaydı döndürür (200 replay yanıtı). Aynı anahtar/farklı istek 409'dur. Farklı anahtarın aktif çalışmaya çarpması 409 RUN_ALREADY_ACTIVE'dir. Yeniden çalıştırma yeni anahtar ve yeni run oluşturur; başarısız HTTP yanıtı sonrası körlemesine yeni anahtar üretilmez.

## Snapshot

Run snapshot: id, planId, planVersionId, planName, versionNumber, profile, scenario/settings, simulatorVersion, evaluationVersion, status, outcome, timestamps, requestedBy, reasonCode, expectedSampleCount, recordedSampleCount, lastEventSequence ve steps.

Step snapshot: runStepId, logicalStepId, position, kayıtlı ad/birim/sınırlar/örnek ayarları, status/outcome, sayılar/istatistikler ve measurements. Ölçüm: sampleIndex, value, isWithinTolerance, recordedAt, elapsedMs. Hassas kullanıcı/session alanları yoktur.

Snapshot ve lastEventSequence aynı tutarlı okumaya aittir. Ortalama/min/max null olabilir; outcome null olmasına karşın hasOutOfTolerance bilgisi görülebilir. Tamamlanmış önceki adımların sonuçları kısmi çalıştırmada korunur.

## Geçmiş ve karşılaştırma

History sorguları: planId, planVersionId, deviceId, batchNumber, scenario, status, outcome, from, to, page (1 tabanlı), limit (varsayılan 20, en fazla 100). Tarih aralığı `[from, to)` ve UTC'dir. Sıra `startedAt DESC, id DESC`; toplam kayıt/sayfa bilgisi döner.

Comparison iki farklı terminal run gerektirir; aynı planın farklı sürümleri geçerlidir. Yanıt her run'ın kendi snapshot özetini, logicalStepId eşleşmelerini ve eklenen/kaldırılan/değişen alanları içerir. Kural farkları ad/birim/sıra/min/max/sampleCount/intervalMs alanlarını kapsar. Değerlendirme eski sınırlarla korunur.

Birim aynıysa ölçüm özetleri yan yana gösterilebilir. Farklı birimde sayısal delta üretilmez. Zaman dizileri her serinin elapsedMs'iyle çizilir; interpolasyon veya indeks bazlı örnek çıkarma yapılmaz. CANCELLED/INTERRUPTED/ERROR karşılaştırılabilir ancak eksik veriler açık işaretlenir; RUNNING karşılaştırılamaz.

## Hatalar

Hata gövdesi: `code`, İngilizce `message`, `requestId`, gerektiğinde `fieldErrors` ve güvenli `details`.

fieldErrors girdisi path, code ve message taşır; örnek path `steps.1.maximum`. Sunucu hataları kaydedilen istek revizyonuna bağlıdır; UI sıralaması değişmişse hata yanlış satıra bağlanmaz.

| HTTP | Kod                      | Kullanım                                           |
| ---- | ------------------------ | -------------------------------------------------- |
| 400  | VALIDATION_ERROR         | Parametre/gövde/sayısal alan hatası                |
| 401  | UNAUTHENTICATED          | Eksik, süresi dolmuş veya iptal edilmiş oturum     |
| 403  | FORBIDDEN                | Rol veya CSRF/origin reddi                         |
| 404  | NOT_FOUND                | Bulunamayan/erişilemeyen kaynak                    |
| 409  | DRAFT_CONFLICT           | Eski revision, açık taslak veya Publish çakışması  |
| 409  | RUN_ALREADY_ACTIVE       | details.activeRunId ile mevcut çalışma             |
| 409  | IDEMPOTENCY_CONFLICT     | Anahtar farklı istekle kullanılmış                 |
| 409  | RUN_NOT_TERMINAL         | Karşılaştırma/rapor/export için devam eden çalışma |
| 422  | COMPARISON_PLAN_MISMATCH | İki farklı plan                                    |
| 429  | TOO_MANY_REQUESTS        | Login hız sınırı                                   |
| 500  | INTERNAL_ERROR           | Güvenli genel teknik hata                          |
| 503  | SERVICE_UNAVAILABLE      | DB/readiness veya iş kabulü hazır değil            |
| 409  | DEVICE_SERIAL_CONFLICT   | Profilde canonical seri numarası zaten kayıtlı     |
| 409  | DEVICE_CONFLICT          | Eski editRevision                                  |
| 409  | DEVICE_ARCHIVED          | Yeni run için arşivlenmiş cihaz                    |
| 422  | DEVICE_PROFILE_MISMATCH  | Cihaz ve plan profili farklı                       |

Stack trace, SQL, cookie, parola veya hassas token yanıtta yer almaz. Asenkron yürütme hatası çalıştırmada ERROR ve reasonCode ile görünür; başlamış HTTP isteğine sonradan hata yanıtı gönderiliyormuş gibi tasarlanmaz.

## SSE protokolü

`GET /runs/:id/events?after=<sequence>` kullanılır. İlk after değeri snapshot'tan gelir. Otomatik reconnect'te `Last-Event-ID` başlığı varsa query'den önceliklidir. Cursor negatif, bozuk veya çalışma dizisinin ilerisindeyse akış başlamadan 400 verilir.

SSE `id`, run içindeki sequence değerinin metnidir. `event`, aşağıdaki tiplerden biridir. `data`, schemaVersion=1, runId, sequence, occurredAt ve payload içerir. Protokol kimliği NestJS'nin bağlantı başına otomatik sayaç varsayımına bırakılmaz.

| Olay                 | Anlam                                           |
| -------------------- | ----------------------------------------------- |
| run.started          | Başlangıç snapshot'ı oluşturuldu                |
| step.started         | Sıradaki adım başladı                           |
| measurement.recorded | Ölçüm ve ilgili sayaç/ihlal özeti commit edildi |
| step.completed       | Adım sonucu ve özeti kesinleşti                 |
| run.completed        | Genel PASSED/FAILED sonucu kesinleşti           |
| run.cancelled        | İptal ve kısmi durumlar kaydedildi              |
| run.interrupted      | Recovery yarım çalışmayı kapattı                |
| run.errored          | Teknik hata kaydedildi                          |

Replay RunEvent tablosundan cursor sonrası sırayla okunur. Canlı takip de aynı kaynağı kullanır; replay/live geçişinde kayıp aralık oluşmaz. İstemci sequence ≤ son işlenen değeri tekrar uygulamaz; ileri boşlukta snapshot ile uzlaştırır.

Heartbeat SSE comment olarak 15 saniyede bir gönderilir ve domain sequence tüketmez. Bağlantı kapanınca DB takip döngüsü/timer kapanır. Bu cleanup test yürütücüsünü iptal etmez. Oturum expiry/revocation en geç sonraki yetki heartbeat kontrolünde akışı kapatır; frontend hata üzerine /auth/me ile oturumunu doğrular.

Terminal olayı alan frontend EventSource'u kapatır. Terminal snapshot için yeni akış açılmaz. Terminal run'da replay edilecek olay kalmadıysa 204 ile yeniden bağlantı durdurulabilir; backlog varsa önce eksik terminal olayına kadar aktarılır.

## OpenAPI ve istemci

REST DTO'ları, enum'lar, cookie/CSRF güvenlik düzeni ve hata biçimleri OpenAPI'ye yazılır. SSE envelope/payload şemaları da açıkça belgelenir; üretici desteği yoksa tiplerin kaynağı ayrıca belirlenir. Frontend'de elle farklı bir API iş modeli tutulmaz.

P1-05 oluşturulacak istemci üretimini, P7-06 güncel sözleşme kontrolünü, P8-04 gerçek OpenAPI çıktısını kapsar. Belgelenen uçların gerçek davranışıyla eşleşmesi test edilir.

## Özellik paketi 1 — yetkilendirilen ek sözleşme (2026-11-06)

Ek uçlar: GET/POST /devices, GET/PATCH /devices/:id, POST archive/restore; POST /plan-versions/:id/copy; GET /analytics/overview; GET /runs/:id/report ve /export?format=csv|json. /runs başlangıç/okuma/filtrelerine cihaz-parti-sürüm-senaryo sözleşmesi eklenir. Rol, DTO, idempotency v1/v2, decimal KPI, terminal-only export ve HTTP header kuralları ek sözleşmenin 3–7. bölümleridir.

Birincil ayrıntılı sözleşme: [Özellik paketi 1](feature-pack-1-plan.md). Görev/durum kaynağı: [EX kartları](tasks/README.md). Çelişki halinde yeni davranışlar için paket sözleşmesi, korunacak davranışlar için mevcut temel sözleşme birlikte uygulanır; kapsam sessizce genişletilmez.
