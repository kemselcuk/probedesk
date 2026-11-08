# EX-08 — Bağımsız teknik inceleme (Analytics overview backend)

- Tarih: 2026-11-08
- İnceleme commit'i: `5b7e4232b9909e8e72ef444f8da9d169c7d8fb0e` (`feat: aggregate dashboard analytics with indexed filters`)
- İnceleme başlangıcındaki ve sonundaki HEAD: `11ba87de93ba12820882cce4f6aa7d3f80ec8f1f` (`feat: add filtered analytics overview with history drilldown`)
- Branch: `feat/analytics-reporting-devices`; `origin/feat/analytics-reporting-devices` aynı commit'te.
- İnceleme türü: **Bağımsız backend kod/API/DB/test incelemesi.** Ürün, görsel veya nihai yayın kabulü değildir.
- Kapsam: EX-08 analytics domain/query/service/controller/DTO, migration
  `20261107120000_analytics_query_indexes`, Prisma şeması, migration manifest/AppModule/generated
  artifact entegrasyonu, test-database guard ve analytics test bootstrap'ı. `11ba87d` yalnız EX-09
  frontend değişikliğidir; bu incelemede frontend kodu, browser ve görsel kabul incelenmedi.
- Kısıt: Repository içinde yalnızca bu review dosyası yazıldı. Kaynak, şema, migration, generated
  artifact, görev kartı ve diğer kanıtlar değiştirilmedi. `git add`, `git commit`, `git push`,
  `git checkout`, `git reset`, `git stash` çalıştırılmadı; subagent başlatılmadı.
- Dev/delivery veritabanları: `127.0.0.1:5434/probedesk` ve `5432` bu incelemede **hiç
  kullanılmadı**. Yalnız yeni ve benzersiz `probedesk_ex08_review_20261108b_test` veritabanı
  `127.0.0.1:5433` üzerinde oluşturuldu; test sonunda yalnız bu DB silindi. Önceki reviewer
  veritabanı `probedesk_ex08_review_rev20261108a_test` okunmadı, değiştirilmedi ve silinmedi.

## Sonuç özeti

| Alan                                                         | Sonuç                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTC `[from,to)`, 366 gün, offset canonicalizasyonu           | **Geçti.** Domain ve HTTP testleri sınır günlerini, tam `to` dışlamasını, 366 günü ve 366+1 ms reddini doğruluyor.                                                                                          |
| Plan/version/device/batch/scenario filtre kesişimleri        | **Geçti.** E2E fixture'ı her çeldiriciyi tek boyutta ayırıyor; bilinmeyen filtreler boş sonuç, plan/version uyuşmazlığı 400, draft version filtresi boş sonuç veriyor.                                      |
| KPI status ayrımı ve null/decimal davranışı                  | **Geçti.** `COMPLETED = PASSED + FAILED`; running/cancelled/interrupted/error ayrı; completed=0'da oran/süre null; 0%, 100%, 96.88 ve 1000.063 gerçek PG `numeric` ile doğrulandı.                          |
| Günlük UTC trend ve eksik günler                             | **Geçti.** İlk/son kısmi günler, boş günlerde 0/null ve trend toplamlarının summary ile eşitliği test edildi.                                                                                               |
| Top10 başarısız adım, sürüm/birim ayrımı, deterministik sıra | **Geçti.** COMPLETED run/step filtresi, planId+version+logicalStep+unit gruplaması, failed/completed DESC + kalıcı kimlik sırası, 12'li tie'dan 10 satır ve iki istekte aynı sonuç test edildi.             |
| Tek repeatable-read snapshot                                 | **Kod düzeyinde geçti.** `RepeatableRead` transaction'ında `asOf`, summary, trend ve top10 aynı oturumdan okunuyor. Eşzamanlı yazma ile ayrı yarış testi yok; bu sınır aşağıda I-2 olarak kaydedildi.       |
| `no-store`, üç rol, oturum zorunluluğu                       | **Geçti.** E2E 401 + üç rol 200; reviewer HTTP probe'unda viewer 200 `cache-control: no-store`, anonim 401 `UNAUTHENTICATED`.                                                                               |
| Ölçüm tablosu taranmaması / client'a dump edilmemesi         | **Geçti.** Summary/trend yalnız `test_runs`; top10 yalnız `test_runs`+`run_steps` okuyor. E2E response anahtarları ve `EXPLAIN` metni `measurements` içermiyor.                                             |
| Migration ve indeks durumu                                   | **Geçti.** Guarded migration ile 10/10 migration uygulandı; `test_runs_batchNumberKey_startedAt_id_idx` mevcut, `devices_deviceProfileId_idx` kaldırılmış, composite unique prefix korunmuş.                |
| OpenAPI/client entegrasyonu                                  | **Geçti.** Committed OpenAPI'de analytics path'i ve yedi zorunlu/opsiyonel query parametresi var; OpenAPI e2e committed belge eşitliği testi geçti; client şeması committed OpenAPI'den birebir üretiliyor. |
| Test DB guard                                                | **Analytics/report bootstrap'larında geçti; paylaşılan bootstrap'ta boşluk var.** Aşağıda L-2.                                                                                                              |
| Performans/EXPLAIN kanıtı                                    | **Devralınan sayılar tutarlı ancak bağımsız yeniden üretilebilir değil.** Aşağıda L-1.                                                                                                                      |
| Öneri                                                        | **Teknik kabul önerilir; kritik/yüksek/orta açık bulgu yok.** L-1 ve L-2 düşük; süreç ihlali ve dev veri bütünlüğü boşluğu kabul kaydında açıkça yazılmalıdır.                                              |

## Bulgular

### L-1 — Düşük: İndeks/performans kanıtı bağımsız yeniden üretilebilir değil, otomatik plan assertion'ı yok

**Konum:**

- `apps/api/test/analytics.e2e-spec.ts:1337-1385`: `EXPLAIN (COSTS OFF)` yalnız üç sorgunun metninde
  `measurements` olmadığını assert ediyor; yeni batch indeksinin kullanıldığını veya indeks
  kolonlarını doğrulamıyor.
- `apps/api/prisma/migrations/20261107120000_analytics_query_indexes/migration.sql:1-20`: yeni indeks
  ve `devices_deviceProfileId_idx` kaldırması yorumda 60.000 run/180.000 step ve 10.051 device
  ölçümlerine dayandırılıyor; ölçüm harness'ı repository'de yok.
- `apps/api/test/database.e2e-spec.ts:74-106`: yalnız eski `test_runs_startedAt_id_idx` için index-plan
  assertion'ı var; yeni `test_runs_batchNumberKey_startedAt_id_idx` için yok.
- `docs/evidence/feature-pack-1/ex-08.md:17-32`: worker EXPLAIN tablosu ve "harness commit edilmedi"
  notu; lead bu sayıları yeniden çalıştırmadı.

**Gerçek durum:** Reviewer, izole review DB'sinde migration sonrası indeksin gerçekten oluştuğunu ve
eski device indeksinin kalktığını `pg_indexes` ile doğruladı. Boş DB'de `enable_seqscan=off` ile
yapılan salt-okuma plan denemesinde summary ve trend sorguları yeni batch indeksini kullandı; top10
sorgusu `test_runs_planId_startedAt_id_idx` + `run_steps` indeksiyle çalıştı. Bu, indeksin sorgu
şekline uygun olduğunu gösterir; ancak 60.000 satırlık gerçek performans iddiasını veya plan
seçiminin veri hacmindeki kararlılığını kanıtlamaz.

**Etki:** Düşük. Ürün davranışı ve migration doğru; eksik olan, gelecekte indeksin sessizce
kaldırılması/bozulması durumunda testlerin bunu yakalamaması ve performans iddiasının commit'li bir
komutla yeniden üretilememesi. EX-08 kabulünü tek başına engellemez.

**Öneri:** `database.e2e-spec.ts` içine yeni indeksin adı/kolon sırası için assertion eklenmeli;
mümkünse `enable_seqscan=off` ile summary/trend planının yeni indeksi kullandığı test edilmeli.
60.000 satırlık benchmark isteniyorsa harness commit edilmeli veya kanıt "worker ölçümü, lead
tarafından yeniden üretilmedi" sınırıyla kalmalıdır.

### L-2 — Düşük: Paylaşılan `createTestApplication` hâlâ `requireIsolatedApplicationDatabase` çağırmıyor

**Konum:**

- `apps/api/test/support/create-test-application.ts:28-59`: `loadEnv(process.env)` ve `AppModule`
  doğrudan kuruluyor; `requireIsolatedApplicationDatabase` çağrısı yok.
- `apps/api/test/support/analytics-helpers.ts:391-393` ve
  `apps/api/test/support/report-test-application.ts:9-12`: bu iki bootstrap guard'ı çağırıyor.
- `apps/api/test/setup-env.ts:10-23`: Vitest setup'ı `TEST_DATABASE_URL`den `DATABASE_URL`e map ediyor;
  guard yalnız setup yüklendiğinde dolaylı olarak devreye giriyor.

**Gerçek durum:** EX-08 analytics suite'i guarded helper kullanıyor; bu nedenle incelenen suite için
risk yok. Ancak ex-08 kanıtındaki "test bootstrap'larına `requireIsolatedApplicationDatabase`
eklendi" ifadesi tüm bootstrap'lar için doğru değil. `createTestApplication` 15'ten fazla e2e suite'i
tarafından kullanılıyor; setup-env yüklenmeden çağrılırsa eski davranışla dev URL'e açılabilir. Bu,
geçmiş dev-write olayının doğrudan tekrarı değildir (o olay AppConfig'i doğrudan kuruyordu), fakat
savunma derinliği iddiasını sınırlar.

**Etki:** Düşük. Ürün kodu ve EX-08 testleri etkilenmiyor; test altyapısında gelecekteki bir kaza için
koruma boşluğu.

**Öneri:** `createTestApplication` başında da `requireIsolatedApplicationDatabase(process.env)`
çağrılmalı. OpenAPI testi process env'i setup-env ile map edilmiş kullandığı için bu değişiklikle
uyumlu olmalı; yine de placeholder `databaseUrl` override'ı nedeniyle testin kırılmadığı doğrulanmalı.

### I-1 — Bilgi: Başarılı analytics yanıtındaki `no-store` için commit'li test assertion'ı yok

**Konum:**

- `apps/api/src/analytics/analytics.controller.ts:29`: `@Header('Cache-Control', 'no-store')`.
- `apps/api/test/analytics.e2e-spec.ts:379-391`: 401 ve üç rol 200 test ediliyor; header assert
  edilmiyor. Diğer endpoint'lerde (ör. `report-export.e2e-spec.ts:369`) bu assertion var.

**Gerçek durum:** Reviewer'ın geçici Vitest HTTP probe'u viewer isteğinde 200 ve
`cache-control: no-store` gördü; anonim istek 401 `UNAUTHENTICATED` döndü. Yani davranış doğru.
Eksik olan yalnız kalıcı test assertion'ı.

**Öneri:** Analytics e2e rol testine `expect(response.headers['cache-control']).toBe('no-store')`
eklenmeli. Ürün davranışı değişikliği gerektirmez.

### I-2 — Bilgi: Repeatable-read eşzamanlı yazma yarışı ayrı testle zorlanmadı

**Konum:**

- `apps/api/src/analytics/analytics.service.ts:29-33,87-124`: `RepeatableRead` transaction'ında
  `now()`, summary, trend ve top10 aynı `tx` üzerinden okunuyor.
- `apps/api/test/analytics.e2e-spec.ts:731-762`: aynı response içindeki trend toplamlarının summary
  ile eşitliği doğrulanıyor; ayrı bir bağlantıdan eşzamanlı run ekleme/bitirme yarışı yok.

**Gerçek durum:** Kod düzeyinde snapshot tutarlılığı doğru kurulmuş. Sözleşmenin istediği "aktif test
sürerken yanıt içindeki toplamlar birbirini tutar" davranışı için tek response tutarlılığı test
edilmiş; ancak eşzamanlı commit'in summary/trend/top10 arasına girmemesi ayrı bir testle
kanıtlanmamıştır. Prisma/PostgreSQL `RepeatableRead` semantiği gereği risk düşüktür.

**Öneri:** İstenirse iki bağlantılı deterministik bir test eklenebilir: analytics transaction'ı
başladıktan sonra başka bağlantıdan run insert/commit edilip yanıtın eski snapshot'ı koruduğu
doğrulanır. Zorunlu kabul engeli değildir.

## Süreç ihlali ve veri bütünlüğü

`docs/evidence/feature-pack-1/ex-08.md:34-40` açıkça kaydediyor: worker'ın ilk geçici prefix
probe'u Vitest setup-env'i yüklemeden AppConfig'i dev `5434` üzerinden kurmuş; 1 analytics user,
1 profil, 6 device ve 1 session oluşturulmuş, ardından `finally` cleanup ile silinmiş. Bu bir
**dev veritabanına yazma ihlalidir**; "yalnız test DB kullanıldı" iddiası bu olay için doğru değildir.

Lead'in read-only kontrolü dev'de 45 run, 9 migration, `analytics-e2e` kullanıcı 0/profil 0, batch
indeksi yok ve eski device-profile indeksi mevcut olduğunu göstermiş. Bu agregalar tam bir
önce/sonra fingerprint değildir; diğer satırların/içeriklerin birebir değişmediğini kanıtlamaz.
Reviewer bu incelemede `5434` veya `5432`'ye bağlanmadı; ihlalin kapsamını bağımsız olarak
doğrulayamaz. **Dev/delivery veri bütünlüğü kanıtlanmış sayılmamalıdır.** Otomatik reset/rollback
yapılmadı; bu doğru karardır.

Yeni `requireIsolatedApplicationDatabase` guard'ı analytics/report bootstrap'larında tekrarı
zorlaştırıyor; ancak L-2'deki paylaşılan bootstrap boşluğu nedeniyle "tamamen önlendi" denemez.
Görev kartı ve roadmap'te bu ihlalin sınırı açıkça yazılmalı; kullanıcı/lead dev verisinin ayrıca
fingerprint/backup ile doğrulanmasını isteyip istemediğine karar vermelidir.

## Reviewer tarafından gerçekten çalıştırılan kontroller

Aşağıdaki sonuçlar bu inceleme sırasında çalıştırılan komutlardan alınmıştır.

| Kontrol                      | Komut / yöntem                                                                                                                                                                                                                               | Gerçek sonuç                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HEAD/branch/working tree     | `git rev-parse HEAD`; `git rev-parse origin/feat/analytics-reporting-devices`; `git status --short`                                                                                                                                          | HEAD ve origin `11ba87de93ba12820882cce4f6aa7d3f80ec8f1f`; working tree temiz.                                                                                                                       |
| EX-08 commit kapsamı         | `git show --stat --oneline 5b7e423`                                                                                                                                                                                                          | 28 dosya; analytics kaynak/DTO/test, yeni migration, manifest/AppModule, OpenAPI/client, EX-08 kanıt/görev kaydı.                                                                                    |
| Review DB hedef assert'i     | Node/pg ile `.env`'den yalnız host/port/DB adı okundu; hedef `127.0.0.1:5433/probedesk_ex08_review_20261108b_test` olarak assert edildi                                                                                                      | Yeni DB oluşturulmadan önce host/port/ad doğrulandı; DB yoktu.                                                                                                                                       |
| Guarded migration            | `npm run db:migrate:test --workspace apps/api` (yalnız review DB'sine yönlendirilmiş `TEST_DATABASE_URL`)                                                                                                                                    | **10 migration başarıyla uygulandı**, exit 0.                                                                                                                                                        |
| Migration/indeks doğrulaması | `pg_indexes`/`information_schema` salt-okuma                                                                                                                                                                                                 | 10 migration applied=true; 14 public tablo; `test_runs_batchNumberKey_startedAt_id_idx` mevcut; `devices_deviceProfileId_idx` yok; `devices_deviceProfileId_serialNumberKey_key` mevcut.             |
| Analytics unit               | `vitest run src/analytics/analytics-domain.spec.ts` (apps/api)                                                                                                                                                                               | **1 dosya / 9 test geçti**, exit 0.                                                                                                                                                                  |
| Guard/manifest unit          | `vitest run` ile analytics-domain + test-database-guard + test-application-guard + migration-manifest                                                                                                                                        | **4 dosya / 28 test geçti**, exit 0. (Analytics 9; guard 11+7; manifest 1.)                                                                                                                          |
| Analytics + OpenAPI e2e      | `npm run test:e2e --workspace apps/api -- test/analytics.e2e-spec.ts test/openapi.e2e-spec.ts`                                                                                                                                               | **2 dosya / 13 test geçti**, 5.04 s, exit 0. (Analytics 10 + OpenAPI 3; OpenAPI committed belge eşitliği dahil.)                                                                                     |
| HTTP `no-store`/rol probe    | Geçici Vitest config + supertest; guarded analytics app, viewer login, 3 günlük boş aralık, anonim istek                                                                                                                                     | **1/1 geçti**: viewer 200 `cache-control=no-store`; body anahtarları `asOf,filters,summary,topFailedSteps,trend`; trend 3 gün; anonim 401 `UNAUTHENTICATED`.                                         |
| Hedefli lint                 | `oxlint --type-aware apps/api/src/analytics apps/api/test/analytics.e2e-spec.ts apps/api/test/support/analytics-helpers.ts apps/api/src/common/database/test-database-guard*.ts apps/api/src/common/database/test-application-guard.spec.ts` | **0 warning / 0 error**, 13 dosya, exit 0.                                                                                                                                                           |
| Hedefli format               | `prettier --check` aynı dosyalar                                                                                                                                                                                                             | `All matched files use Prettier code style!`, exit 0.                                                                                                                                                |
| API typecheck                | `tsc --noEmit -p apps/api/tsconfig.json`                                                                                                                                                                                                     | **Exit 0.**                                                                                                                                                                                          |
| OpenAPI client eşleşmesi     | `openapi-typescript apps/api/openapi.json -o <temp>` + `diff`                                                                                                                                                                                | `CLIENT_SCHEMA_MATCH=yes`; committed client, committed OpenAPI'den birebir üretiliyor.                                                                                                               |
| Salt-okuma plan denemesi     | Review DB'sinde `BEGIN; SET LOCAL enable_seqscan=off; EXPLAIN (COSTS OFF) ...; ROLLBACK`                                                                                                                                                     | Summary/trend yeni batch indeksini, top10 `planId/startedAt` + `run_steps` indekslerini kullandı; hiçbir planda `measurements` yok. Boş DB olduğu için süre/plan seçimi performans kanıtı sayılmadı. |
| DB temizliği                 | Test sonrası tablo sayımları; exact ad/host/port assert'i ve yalnız yeni DB'yi `DROP DATABASE`                                                                                                                                               | Tüm tablolar 0; yeni DB silindi. `probedesk_ex08_review_rev20261108a_test` hâlâ mevcut ve dokunulmadı; `5434`/`5432` kullanılmadı.                                                                   |

Not: `npm run test`/`npm run test:e2e` pre-script'leri `prisma generate` çalıştırdı; `git status
--short` her iki koşudan sonra da boş kaldı, yani generated artifact içeriği değişmedi.

### Devralınan kanıtlar (reviewer tarafından yeniden çalıştırılmadı)

- Lead: `npm run test:api:unit` 19 dosya/145 test; tam API integration 29 dosya/275 test; API lint
  187 dosya 0 warning/error; typecheck/build/`openapi:check` exit 0. Bunlar bu incelemede yeniden
  çalıştırılmadı; yalnız hedefli analytics/OpenAPI/guard/typecheck kontrolleri yeniden üretildi.
- Worker: analytics unit 9/9; analytics PG/HTTP 10/10; komşu devices/database/schema 43/43; API lint
  186 dosya 0 warning/error; dedicated test DB'de guarded 10 migration.
- Worker EXPLAIN tablosu (`ex-08.md:19-32`): 60.000 run/180.000 step, 10.051 device; sparse batch
  summary 13.298 ms → 0.214 ms, dense 13.526 ms → 3.901 ms, trend 13.326 ms → 0.211 ms, top10
  83.483 ms → 1.294 ms, history count 10.973 ms → 0.032 ms, history page 13.990 ms → 0.025 ms.
  Harness commit edilmedi; bu sayılar worker raporundan devralınmıştır, lead'in bağımsız ölçümü
  değildir ve bu incelemede yeniden üretilmemiştir.
- Lead dev read-only kontrolü: 45 run, 9 migration, analytics-e2e kullanıcı/profil 0, batch indeksi
  yok, eski device-profile indeksi mevcut. Tam fingerprint olmadığı için veri bütünlüğü kanıtı
  sayılmaz.

## DB güvenliği ve izolasyon

- Yeni DB adı `probedesk_ex08_review_20261108b_test`; host `127.0.0.1`, port `5433` ve tam ad her
  create/migrate/test/cleanup öncesi kodda assert edildi. DB'yi oluşturmak için aynı `5433`
  sunucusundaki `postgres` maintenance DB'sine yalnız `CREATE/DROP DATABASE` ve catalog sorgusu için
  bağlanıldı; mevcut `probedesk_test` yalnız `pg_database` ad listesini okumak için kullanıldı, içeriği
  değiştirilmedi.
- Migration yalnız `npm run db:migrate:test --workspace apps/api` guarded komutuyla uygulandı;
  doğrudan `prisma migrate deploy` çalıştırılmadı.
- Uygulama testleri `NODE_ENV=test` ve `DATABASE_URL=TEST_DATABASE_URL` aynı izole URL olacak şekilde
  çalıştırıldı; analytics bootstrap `requireIsolatedApplicationDatabase` kullandı.
- `127.0.0.1:5434/probedesk`, `127.0.0.1:5432`, şablon `probedesk_test`, lead/worker DB'leri ve önceki
  reviewer DB'si kullanılmadı. Review DB'si dışında hiçbir DB'ye migration/test/write yapılmadı.
- Test sonunda review DB'sindeki bütün tablolar 0 doğrulandı; yalnız bu DB exact assertion ve
  `DROP DATABASE` ile silindi. URL/credential çıktısı yazdırılmadı.

## Çalıştırılmayan kontroller ve sınırlar

- Tam API unit/integration suite, tam `npm run verify`, web testleri, build, CI, Playwright/browser,
  görsel/print/PDF, delivery profili ve `localhost:8080` smoke bu incelemede çalıştırılmadı.
  Frontend ve browser kabulü lead'e aittir; bu belge görsel kabul vermez.
- `npm run openapi:check` çalıştırılmadı; komut `apps/api/openapi.json` dosyasını yeniden yazar.
  Yerine OpenAPI e2e committed belge eşitliği testi (3/3) ve temp client diff'i çalıştırıldı.
- Mevcut seed/run içeren bir DB'nin 9→10 migration upgrade'i bu incelemede ayrı kopyada denenmedi.
  Yalnız boş DB'de 10 migration'lık taze kurulum doğrulandı; EX-08 migration'ı yalnız indeks ekleme/
  kaldırma olduğu için risk düşüktür, ancak upgrade kanıtı devralınmıştır.
- 60.000 satırlık EXPLAIN benchmark'ı maliyet nedeniyle yeniden çalıştırılmadı; yalnız indeks varlığı
  ve boş DB plan şekli doğrulandı.
- Eşzamanlı yazma ile repeatable-read yarışı ayrı testle zorlanmadı (I-2).
- Dev/delivery veri bütünlüğü, geçmiş dev-write ihlali nedeniyle kanıtlanmış sayılmaz; bu incelemede
  `5434`/`5432`'ye bağlanılmadı.

## Kabul önerisi

**EX-08 teknik olarak `Accepted` edilebilir; kritik, yüksek veya orta açık bulgu yoktur.** UTC
`[from,to)`/366 gün, filtre kesişimleri, status KPI'ları, null/decimal yuvarlama, UTC gün trendi,
sürüm/birim ayrımlı deterministik top10, `no-store`/rol davranışı, ölçüm tablosu taranmaması,
migration/indeks durumu ve OpenAPI/client entegrasyonu gerçek PostgreSQL ve gerçek HTTP üzerinden
doğrulandı. Reviewer'ın izole DB'sinde hedefli koşu **4 dosya/28 unit + 2 dosya/13 e2e** geçti;
hedefli lint/format ve API typecheck exit 0 verdi.

Kabul için önerilen koşullar:

1. **L-1** düşük bulgusu için yeni batch indeksinin adı/kolonları en az bir kalıcı DB testinde
   assert edilmeli; performans iddiası harness'sız kalacaksa kanıtta bu sınır korunmalı.
2. **L-2** düşük bulgusu için paylaşılan `createTestApplication` de `requireIsolatedApplicationDatabase`
   çağırmalı; en azından "tüm bootstrap'lar korumalı" iddiası düzeltilmeli.
3. **I-1** için analytics e2e'ye `Cache-Control: no-store` assertion'ı eklenmeli; davranış zaten doğru.
4. **Süreç ihlali** görev kartı/roadmap/teslim kaydında açıkça yer almalı; dev/delivery veri
   bütünlüğü kanıtlanmış gibi yazılmamalı. Kullanıcı/lead gerekli görürse dev verisi için ayrı
   fingerprint/backup kontrolü yapmalı; otomatik reset/rollback yapılmamalı.
5. Kart durumu, `docs/tasks/README.md` ve `docs/roadmap.md` güncellemesi lead tarafından ayrı
   commit'te yapılmalıdır; bu review kaydı görev statüsünü değiştirmez.
6. Ürün/görsel kabul, nihai teslim ve yayın kararı kullanıcıya aittir; bu belge onları vermez.
