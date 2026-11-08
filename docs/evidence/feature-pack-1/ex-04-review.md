# EX-04 — Bağımsız teknik inceleme (Run cihaz metadata ve geçmiş filtreleri)

- Tarih: 2026-11-07
- İnceleme kapsamı commit: `e48a84011f78085da0bb5ef8e513b2428746b3ba`
  (`feat: snapshot run devices and filter traceable history`)
- Branch/HEAD: `feat/analytics-reporting-devices` / `e48a840`; yerel HEAD ile
  `origin/feat/analytics-reporting-devices` aynı commit'tir.
- Kapsam dışı: `e9e0589` (`fix: recover plan copies across route changes`) EX-07
  plan kopyalama/route düzeltmesidir; ayrı kapsamdır ve bu incelemede
  değerlendirilmemiştir. `e48a840` içinde `apps/web/src/app/features/plans/**`
  veya plan kopyalama davranışı değişikliği yoktur.
- İnceleme türü: Bağımsız kod, API, PostgreSQL ve frontend sınır incelemesi.
  Bu belge ürün kabulü, kullanıcı kabulü veya yayın kararı değildir.
- Kısıt: Repository içinde yalnızca bu dosya yazıldı. `git add`, `commit`, `push`,
  `checkout`, `reset` ve `stash` çalıştırılmadı. Uygulama kodu, şema, migration,
  görev kartı, README veya roadmap değiştirilmedi. Subagent başlatılmadı.
- Test iddiası: Lead'in tam unit/integration/web kontrolleri aşağıda **devralınan
  kanıt** olarak ayrılmıştır. Reviewer bunları yeniden çalıştırmadı; yalnız aşağıda
  listelenen hedefli gerçek PostgreSQL/HTTP ve web kontrollerini çalıştırdı.

## Değişen dosyalar (e48a840)

`git show --stat e48a840`: **36 dosya, +2309 / −87**. Başlıca alanlar:

- API start/hash: `apps/api/src/runs/run-start.ts`, `run-metadata.ts`,
  `runs.service.ts`, `run-start.spec.ts`.
- API okuma/filtre: `run-history.service.ts`, `run-snapshot-read.ts`,
  `runs.controller.ts`, `dto/start-run.dto.ts`, `dto/list-runs-query.dto.ts`,
  `dto/run-history.dto.ts`, `dto/run-snapshot.dto.ts`.
- Karşılaştırma: `apps/api/src/comparisons/comparison-builder.ts`,
  `dto/comparison.dto.ts`.
- API testleri: yeni `apps/api/test/run-metadata.e2e-spec.ts`,
  `support/run-metadata-helpers.ts`; ayrıca `runs-history`, `runs-snapshot`,
  `comparisons` ve `run-start` testlerinin metadata alanları.
- Sözleşme/istemci: `apps/api/openapi.json`, `packages/api-client/src/schema.ts`.
- Web: `apps/web/src/app/features/runs/run-metadata.ts` ve spec'i,
  `runs-api.ts`/spec'i, run fixture'ları; comparison parser'ı ve fixture/spec'leri.
- Belgeler: `docs/evidence/feature-pack-1/ex-04.md`, `docs/tasks/EX-04.md`,
  `docs/tasks/README.md`, `docs/roadmap.md`.

`e48a840` şema veya migration eklemez; Device/run metadata tabloları ve DB
kısıtları önceki EX-02/EX-03 commit'lerinden gelir. Bu commit onları kullanır.

## Sonuç özeti

| Alan                                 | Sonuç                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1 hash uyumluluğu                   | **Geçti.** Metadata yokken `probedesk-run-start-v1` marker'ı ve eski altı elemanlı canonical dizi birebir korunuyor; explicit null ve boş/whitespace batch aynı v1 hash'i veriyor. Unit golden değeri bağımsız Node SHA-256 hesabıyla doğrulandı.                                                                            |
| v2 canonical metadata                | **Geçti.** `probedesk-run-start-v2`, küçük harfli canonical `deviceId` ve büyük harfli `batchNumberKey` kullanıyor; cihaz adı/seri numarası hash girdisi değil. Eşdeğer büyük/küçük harf girdileri aynı hash'i üretiyor.                                                                                                     |
| SQL NULL / pair check                | **Geçti.** Cihazsız run `deviceSnapshot` alanı `Prisma.DbNull` ile SQL NULL oluyor; ham SQL `IS NULL` testi ve DB pair/metadata check'leri geçti. Batch-only run geçerli; JSON null pair check'i bozmuyor.                                                                                                                   |
| Start doğrulama ve atomiklik         | **Geçti.** Bilinmeyen cihaz 404, arşivli cihaz 409 `DEVICE_ARCHIVED`, profil uyuşmazlığı 422 `DEVICE_PROFILE_MISMATCH`, bozuk batch/device 400; hata durumunda run yazılmıyor. Run, adımlar, ilk event ve snapshot aynı transaction'da.                                                                                      |
| `FOR SHARE` / `FOR UPDATE` yarışı    | **Geçti; L-2 düşük test eksiği.** Start cihaz satırını `FOR SHARE`, Device update/archive/restore `FOR UPDATE` ile kilitliyor. Gerçek iki bağlantılı archive-vs-start yarışı 202/200 ve snapshot'ın eski değerleri koruduğunu doğruladı. Update-vs-start için aynı kilit yolu kod incelemesiyle doğru; ayrı yarış testi yok. |
| Snapshot/history/comparison metadata | **Geçti.** Snapshot, history ve comparison required nullable `deviceId`/`deviceSnapshot`/`batchNumber` döndürüyor; canlı cihaz join edilmiyor. Cihaz yeniden adlandırıldıktan sonra eski run snapshot'ı değişmiyor. Legacy/cihazsız kayıtlar null dönüyor.                                                                   |
| History filtreleri                   | **Geçti.** `deviceId`, `batchNumber` (canonical büyük harf exact), `planVersionId`, `scenario`; count ve sayfa aynı `where`; `[from,to)` UTC; `startedAt DESC, id DESC`; plan/version uyuşmazlığı 400 field error; bilinmeyen filtre UUID'si boş sonuç.                                                                      |
| JSON runtime parser                  | **Geçti; L-1 düşük bulgu.** Eksik/null/id tutarsızlığı hata veriyor; legacy null ve batch-only kabul ediliyor. Cihaz adı uzunluğu için JS UTF-16 `.length` kullanımı, astral karakterli geçerli bir adı yanlışlıkla reddedebilir.                                                                                            |
| Eski SSE uyumu                       | **Geçti.** `run.started` payload'ına yeni zorunlu alan eklenmedi; event sözleşmesi değişmedi. Hedefli `sse` + `runs` koşusu 30/30 geçti.                                                                                                                                                                                     |
| OpenAPI/istemci                      | **Geçti.** `npm run openapi:check`: application/document/generated client eşleşiyor, exit 0. Yeni alanlar required nullable; history query parametreleri üretilmiş istemcide mevcut.                                                                                                                                         |
| Belgeler/durum                       | **Tutarlı.** Kart `In Review`, ayrı inceleme bekliyor; evidence lead/worker kontrollerini ve açık takipleri ayırıyor. Reviewer kart durumunu değiştirmedi.                                                                                                                                                                   |

## Bulgular

Kritik: **yok**. Yüksek: **yok**. Orta: **yok**. Düşük: **L-1, L-2**.

### L-1 — Düşük: Frontend metadata parser cihaz adında UTF-16 code unit sayıyor

**Dosya/satır:**

- `apps/web/src/app/features/runs/run-metadata.ts:42-44`:
  `device['name'].length < 1 || device['name'].length > 100`.
- Backend kabulü: `apps/api/src/devices/dto/create-device.dto.ts:31-38`
  (`@Length(1, 100)`); DB kontrolü:
  `apps/api/prisma/migrations/20261106120000_devices_and_copy_requests/migration.sql:95-97`
  (`char_length(btrim(name)) BETWEEN 1 AND 100`).

**Gerçek durum:** class-validator'ın `Length` kontrolü surrogate pair'i tek karakter
sayar; PostgreSQL `char_length` de code point sayar. JavaScript `.length` ise UTF-16
code unit sayar. Örneğin 60 emoji içeren 60 karakterlik bir cihaz adı API ve DB
tarafından kabul edilir (60 ≤ 100), fakat parser'da `.length === 120` olduğu için
`MalformedApiResponseError` fırlatılır. Bu durumda geçerli bir run'ın Details,
History veya Compare ekranı veriyi gösteremez. Test fixture'ları ASCII olduğu için
mevcut testlerde görünmedi.

**Öneri:** Uzunluğu `Array.from(name).length` / `[...name].length` ile code point
olarak ölç veya backend/DB zaten garantilediği için parser'daki bu ikinci uzunluk
kontrolünü kaldır. Astral karakterli (ör. emoji) 1–100 karakterlik cihaz adı için
bir parser testi ekle.

**Kabul etkisi:** Düşük; dar bir Unicode kenar durumu. EX-04 kabulünü tek başına
engellemez, ancak EX-05 veya küçük bir takip commit'inde kapatılmalıdır.

### L-2 — Düşük: Update-vs-start yarışı doğrudan test edilmiyor; archive-vs-start test ediliyor

**Dosya/satır:**

- `apps/api/test/run-metadata.e2e-spec.ts:843-911`: gerçek iki bağlantılı
  archive-vs-start yarışı; start `FOR SHARE`, archive `FOR UPDATE` sırası ve
  snapshot doğrulanıyor.
- `apps/api/src/runs/runs.service.ts:165-175,346-395`: start cihazı transaction
  içinde `FOR SHARE` kilitliyor.
- `apps/api/src/devices/devices.service.ts:151-210` (`update`) ve `:212-251`
  (`archive/restore`) aynı `lockDevice` (`FOR UPDATE`, `:286-299`) yolunu
  kullanıyor.

**Gerçek durum:** Kilit protokolü doğru ve update/archive aynı satırda sıralanıyor.
Ancak kabul ölçütündeki “update/archive yarışı”nın yalnız archive ayağı gerçek
eşzamanlı HTTP testiyle kanıtlanmış. `PATCH /devices/:id` ile ad/seri değişikliği
start beklerken commit edildiğinde snapshot'ın eski veya yeni değerlerden birini
bütün olarak alması kod incelemesiyle doğrulanıyor; ayrı bir iki-bağlantı testi
yok.

**Öneri:** Start bir `FOR SHARE` beklerken `PATCH` isteğinin `FOR UPDATE` ile
sırada tutulduğu ve snapshot'ın karışık değer üretmediği bir yarış testi ekle.
Test maliyeti yüksekse, bu kod düzeyi gerekçeyi EX-04 kanıtına açıkça yaz.

**Kabul etkisi:** Düşük; fonksiyonel hata gözlenmedi, test kapsamı eksiği.

## Açık takipler

### O-1 — Batch filtresi büyük veri kümesinde sequential scan (EX-08)

Worker EXPLAIN'i (devralınan): 30.000 run içinde 50 seyrek cihaz için count/history
page `Index Only Scan using test_runs_deviceId_startedAt_id_idx`; batch filtresi
30k/60k satırda sequential scan. Yeni bir batch indeksi bu commit'te eklenmedi.
Planın 4.4 maddesi parti filtreleri için `(batchNumberKey, startedAt DESC, id DESC)`
indeksini sorgu planına göre değerlendirmeyi istiyor; bu değerlendirme EX-08
query-plan çalışmasına bırakılmış. Reviewer EXPLAIN'i **tekrar çalıştırmadı**;
bu satır worker kanıtından devralınmıştır. EX-04 doğruluk kabulü için engel değil,
teslim öncesi performans takibi olarak açık kalmalıdır.

### O-2 — Browser/CI/delivery ve tam suite kapsamı

Bu incelemede tam API integration (255), tam web suite (399), API/web
lint/typecheck/build, Playwright/browser, localhost:8080 delivery ve CI
çalıştırılmadı. Bunlar lead'in devralınan kayıtlarına dayanır; bağımsız doğrulama
değildir. Devices UI ve yeni filtre formu EX-05; gerçek bütünleşik E2E ve cleanup
EX-12 kapsamındadır.

## Reviewer tarafından çalıştırılan kontroller

Bu bölümdeki komutlar inceleme sırasında gerçekten çalıştırılmıştır. URL veya
credential yazdırılmamıştır; veritabanı hedefi yalnız güvenli ad/port ile
belirtilmiştir.

| Kontrol                   | Komut / yöntem                                                                                                                                                                                             | Gerçek sonuç                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Çalışma ağacı ve push     | `git status --short`; `git rev-parse HEAD origin/feat/analytics-reporting-devices`                                                                                                                         | Çıktı boş; HEAD ve origin `e48a84011f78085da0bb5ef8e513b2428746b3ba`.                                                                                                                                                                                                                                                             |
| Commit kapsamı            | `git show --stat e48a840`; `git show --name-only e48a840`                                                                                                                                                  | 36 dosya, +2309/−87; `e9e0589` kapsamı dışı; `apps/web/src/app/features/plans/**` değişmiyor.                                                                                                                                                                                                                                     |
| Migration hedefi          | `.env` içindeki `TEST_DATABASE_URL` Node `URL` ile okundu; host `127.0.0.1`, port `5433`, ad `probedesk_ex04_review_a7c41f_test`, `_test` suffix assertion'ları                                            | Yalnız bu ad/port ile çalışıldı; URL/credential yazdırılmadı. Önceden `probedesk_ex04_review_%` DB'si yoktu.                                                                                                                                                                                                                      |
| Guarded migration         | `TEST_DATABASE_URL=<dedicated review DB> npm run db:migrate:test --workspace apps/api`                                                                                                                     | 9 migration uygulandı; ikinci koşu `No pending migrations to apply`, **exit 0**. İlk koşuda Prisma 9 migration'ı başarıyla uyguladı; komutu saran zsh betiğim `status` salt-okunur değişkenine atadığı için sarmalayıcı exit 1 gösterdi. Uygulama hatası değildir; `_prisma_migrations` 9/9 `finished_at` dolu olarak doğrulandı. |
| Hedefli API/PG/HTTP       | `TEST_DATABASE_URL=<dedicated review DB> npm run test:e2e --workspace apps/api -- test/run-metadata.e2e-spec.ts test/runs-history.e2e-spec.ts test/runs-snapshot.e2e-spec.ts test/comparisons.e2e-spec.ts` | **4 dosya / 36 test passed**, 5.80s, **exit 0**.                                                                                                                                                                                                                                                                                  |
| DB kısıt/immutability     | Aynı ortamda `test/feature-schema.e2e-spec.ts`                                                                                                                                                             | **1 dosya / 13 test passed**, 3.16s, **exit 0**. Metadata pair check, snapshot immutability, upgrade ve copy constraint'leri dahil.                                                                                                                                                                                               |
| SSE/eski start regresyonu | Aynı ortamda `test/sse.e2e-spec.ts` + `test/runs.e2e-spec.ts`                                                                                                                                              | **2 dosya / 30 test passed**, 3.94s, **exit 0**.                                                                                                                                                                                                                                                                                  |
| API unit (hash)           | `npm run test --workspace apps/api -- src/runs/run-start.spec.ts`                                                                                                                                          | **1 dosya / 7 test passed**, 319ms, **exit 0**.                                                                                                                                                                                                                                                                                   |
| Hash bağımsız doğrulama   | Node `crypto.createHash('sha256')` ile v1/v2 canonical dizileri                                                                                                                                            | v1 `036a5e1b…e6df2`, v2 `f3593cc2…a162`; unit golden değerleriyle aynı.                                                                                                                                                                                                                                                           |
| Web parser/query          | `npm run test --workspace apps/web -- --watch=false --include=src/app/features/runs/run-metadata.spec.ts --include=src/app/features/runs/runs-api.spec.ts`                                                 | **2 dosya / 21 test passed**, 896ms, **exit 0**.                                                                                                                                                                                                                                                                                  |
| Web comparison            | Aynı komutla `comparisons-api.spec.ts`, `compare-runs-page.spec.ts`, `compare-selection.spec.ts`                                                                                                           | **3 dosya / 33 test passed**, 2.41s, **exit 0**.                                                                                                                                                                                                                                                                                  |
| OpenAPI güncelliği        | `npm run openapi:check`                                                                                                                                                                                    | `OpenAPI contract is current…`, **exit 0**.                                                                                                                                                                                                                                                                                       |
| Whitespace                | `git diff --check`                                                                                                                                                                                         | Çıktı yok, **exit 0**.                                                                                                                                                                                                                                                                                                            |
| DB temizliği              | Kendi review DB'sinde yalnız `DROP DATABASE "probedesk_ex04_review_a7c41f_test" WITH (FORCE)`; öncesinde exact ad/host/port assertion'ı                                                                    | Drop sonrası `pg_database` sayımı **0**. Test sonrası: `test_runs=0`, `run-metadata-e2e-%` kullanıcı=0, `%Bench%` cihaz=0, `feature_%` schema=0; migration 9/9 finished.                                                                                                                                                          |

## Devralınan lead/worker kanıtları

Aşağıdaki satırlar **reviewer tarafından yeniden çalıştırılmadı**; lead/worker
kayıtlarından devralınmıştır ve bağımsız doğrulama sayılmaz.

- Lead `npm run test:api:unit`: 16 dosya / **121 passed**, exit 0.
- Lead tam integration: ilk koşu 254/1 (stale committed OpenAPI); `openapi:emit` +
  `openapi:generate` sonrası dedicated `probedesk_pack1_lead_test` üzerinde 27
  dosya / **255 passed**, 47.71s, exit 0. Dev/delivery DB kullanılmadı.
- Lead API lint (166 dosya, 0 warning/error), API typecheck/build, `openapi:check`:
  exit 0.
- Lead `npm run test:web`: 38 dosya / **399 passed**, exit 0; ardından route-reuse +
  metadata parser hedefli 2 dosya / 19 passed; `runs-api` + metadata parser 2 dosya
  / 21 passed; web lint (124 dosya, 0 warning/error)/typecheck/build exit 0.
- Worker: dedicated `probedesk_pack1_runmeta_test` DB'sinde guarded migration 9,
  unit 121, hedefli 11 dosya / 104 test ve refactor sonrası 5 dosya / 53 test
  geçtiğini bildirdi. Reviewer bu sayıları yeniden üretmedi.
- Worker EXPLAIN: 30.000 run / 50 seyrek cihaz için cihaz indeksi `Index Only Scan
using test_runs_deviceId_startedAt_id_idx`; batch filtresi 30k/60k satırda
  sequential scan; yeni batch indeksi EX-08 takibinde. Reviewer EXPLAIN'i tekrar
  çalıştırmadı.

## Test edilmeyenler ve sınırlar

- Tam API integration suite'i (255 test) ve tam web suite'i (399 test) yeniden
  çalıştırılmadı; yalnız yukarıdaki hedefli kümeler çalıştırıldı.
- API/web lint, typecheck ve production build yeniden çalıştırılmadı; lead
  kayıtları devralındı.
- Playwright, gerçek Chrome, responsive/görsel kontrol, klavye/zoom ve
  `localhost:8080` delivery smoke testi yapılmadı. Devices UI, Start/Live/History/
  Details/Compare metadata gösterimi ve yeni filtre formu EX-05 kapsamındadır.
- Gerçek CI workflow ve delivery/Compose yeniden çalıştırılmadı; imaj/sürüm
  adayı bu incelemenin kapsamı dışındadır.
- Update-vs-start yarışı için ayrı iki-bağlantı testi yoktur (L-2); archive-vs-start
  gerçek testi ve paylaşılan `FOR UPDATE` kodu incelendi.
- EXPLAIN/query-plan ve yük/performans ölçümü yeniden yapılmadı; O-1 devralınan
  worker kanıtıdır.
- Fiziksel cihaz/hardware doğrulaması yoktur; tek profil/simülatör kuralı
  korunmuştur.
- Ürün ve görsel kabul kullanıcıya aittir; bu inceleme onu vermez.

## Kabul önerisi

**EX-04 teknik olarak `Accepted` edilebilir; kritik, yüksek veya orta bulgu
yoktur.** Dört kabul ölçütü gerçek PostgreSQL/HTTP ve frontend parser testleriyle
özünde karşılanmıştır: SQL NULL/pair check, atomik start ve kilit sırası, v1/v2
hash-retry uyumu, snapshot/history/comparison metadata ve filtreleri, eski SSE
uyumu. Reviewer'ın temiz review DB'sinde 7 dosya / 79 API/PG e2e testi, 5 dosya /
54 web testi ve 7 hedefli unit testi geçmiştir.

Kabul için önerilen koşullar:

1. **L-1** düşük parser bulgusu EX-05 veya küçük bir takip commit'inde düzeltilmeli
   (code point uzunluğu veya gereksiz kontrolün kaldırılması) ve astral karakterli
   ad testi eklenmeli.
2. **L-2** için update-vs-start yarış testi eklenmeli veya kod düzeyi gerekçe
   EX-04 kanıtına açıkça yazılmalı.
3. **O-1** batch filtre indeksi/query planı EX-08'de kapatılmalı; EX-04 doğruluk
   kabulü buna bağlı değildir.
4. **O-2** kapsamındaki browser/E2E/CI/delivery kontrolleri EX-05/EX-12 ve teslim
   aşamasında ayrıca yapılmalıdır; bu inceleme onları yapılmış saymaz.
5. Lead bu inceleme kaydını `docs/tasks/EX-04.md` ve gerekli durum/kanıt alanlarına
   bağlamalı; `Accepted` kararını ayrı olarak kendisi vermelidir. Reviewer görev
   kartı durumunu değiştirmedi.

Bu belge ürün kabulü değildir. Kullanıcı görsel/ürün kabulü ayrıca kullanıcıya
aittir ve verilmiş sayılmaz.
