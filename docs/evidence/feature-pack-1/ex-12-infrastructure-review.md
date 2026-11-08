# EX-12 — İzole E2E altyapısının bağımsız incelemesi

- Tarih: 2026-11-08
- Branch/HEAD: `feat/analytics-reporting-devices` @ `5ccc130`; health fixture düzeltmesi `6d60db5`.
- EX-12 kart durumu: **In Progress**. Bu dosya bir teknik inceleme kaydıdır; görev
  `Accepted` değildir ve bu inceleme ürün/görsel kabul anlamına gelmez.
- İnceleme kapsamı: EX-12 INFRA dilimi — `tests/e2e/support/database.ts`,
  `tests/e2e/support/ex12-support.integration.ts`, `scripts/e2e-isolated.mjs`,
  `apps/api/test/device-seed.e2e-spec.ts`, `apps/api/test/plan-copy.e2e-spec.ts` ve
  `apps/api/test/support/plan-copy-helpers.ts`, CI E2E support adımı ve health fixture
  guard uyumu.
- Kapsam dışı: Başka worker'ın sahibi olduğu yeni
  `tests/e2e/feature-pack-1.spec.ts` ve mevcut üç Playwright spec'indeki navigasyon
  düzeltmeleri; lead frontend'i; gerçek tarayıcı/print/zoom kabulü; EX-13; delivery/8080.
- Yöntem: Kaynak ve sözleşme incelemesi + kendi yeni `_test` veritabanlarımda gerçek
  PostgreSQL doğrulaması. Lead'in aşağıda "devralınan" olarak işaretlenen sonuçları
  yeniden koşulmadı.

## Bulgular

Özet: 3 Orta (O-1, O-2, O-3), 3 Düşük (O-4, O-5, O-6); Critical/High bulgu yok.
O-1, O-2 ve O-3 INFRA kabul kapısı için kapatılması önerilen bulgulardır.

### O-1 — Orta — Baseline digest dosyası yoksa `assert-baseline` sessizce count-only geçiyor

- Konum: `scripts/e2e-isolated.mjs:489-497`; ilgili kimlik normalizasyonu
  `scripts/e2e-isolated.mjs:461-475` ve `508-519`.
- Davranış: `prepare` bir `fixtureDigest` dosyası yazıyor; ancak `assert-baseline`
  bu dosya yoksa hata vermiyor, yalnız uyarı basıp count-only kontrole düşüyor ve
  `exit 0` veriyor. Dosya yolu ham `hostname:port` ile üretiliyor; guard ise
  `127.0.0.1`/`localhost`/`::1` eşdeğerliğini normalize ediyor. Host yazımı değişen
  veya tmp dizini temizlenen bir koşuda kanonik kontrol sessizce devre dışı kalabilir.
- Yeniden üretim (kendi review DB'imde): demo cihazlardan birinin `description`
  alanını değiştirdim (satır sayıları aynı kaldı).
  - Baseline dosyası mevcutken: `assert-baseline` → `exit 1`,
    `Canonical fixture fingerprint changed...`.
  - `E2E_BASELINE_FILE` var olmayan bir yola ayarlanınca: uyarı +
    `seeded baseline unchanged` → `exit 0`. Yani değiştirilmiş fixture, dosya yoksa
    kabul edildi.
- Etki: CI'da `prepare` ve `assert-baseline` aynı job içinde olduğu için normal
  akışta dosya bulunur; fakat bu bir fail-open doğrulama kapısıdır ve kabul
  sözleşmesindeki "canonical fixture fingerprint" güvencesini ortadan kaldırır.
- Öneri: `assert-baseline` için baseline dosyasını zorunlu kıl ve dosya yoksa
  fail-closed davran (`exit 1`); geriye dönük count-only modu yalnız açık bir
  `E2E_ALLOW_COUNT_ONLY_BASELINE=1` gibi operatör override'ı ile mümkün olsun.
  Dosya yolunda ve karşılaştırmada guard ile aynı host normalizasyonunu kullan.

### O-2 — Orta — Support testi canonical Device/PlanCopyRequest digest'lerini hesaplıyor ama karşılaştırmıyor

- Konum: `tests/e2e/support/database.ts:62-63` ve `324-333`;
  `tests/e2e/support/ex12-support.integration.ts:384-393`; kanıt iddiası
  `docs/evidence/feature-pack-1/ex-12.md:7`.
- Davranış: `prepareE2eDatabase` `devicesDigest` ve `planCopyRequestsDigest`
  alanlarını üretiyor; ancak hiçbir test bunları `baseline` ile `after` arasında
  karşılaştırmıyor. `ex12-support` final kontrolünde yalnız `plans`, `runs`,
  `devices`, `demoDevices`, `planCopyRequests` ve `activeRuns` sayılarını assert
  ediyor. Evidence satırı ise baseline'ın canonical digest'leri kapsadığını söylüyor.
- Yeniden üretim: O-1'deki demo cihaz `description` mutasyonundan sonra
  `npx tsx tests/e2e/support/ex12-support.integration.ts` yine `exit 0` verdi ve
  "restored baseline" mesajını bastı; çünkü digest değişikliği hiç okunmadı.
- Etki: Support adımı, demo cihaz satır içeriği değişse bile başarılı görünebilir;
  `planCopyRequestsDigest` da hiçbir yerde karşılaştırılmıyor. O-1 ile birleştiğinde
  (baseline dosyası yoksa) kanonik kontrol hiç çalışmamış olur; yalnız Playwright
  sonrası `assert-baseline` kapısı kalır.
- Öneri: `after.devicesDigest === baseline.devicesDigest` ve
  `after.planCopyRequestsDigest === baseline.planCopyRequestsDigest` karşılaştırmalarını
  `ex12-support` içine ekle; mümkünse digest'lere zaman alanlarını da açıkça dahil
  ettiğini doğrulayan bir negatif test ekle.

### O-3 — Orta — Cleanup support fixture'ı `measurements` ve `run_events` içermiyor

- Konum: `tests/e2e/support/ex12-support.integration.ts:183-196` (run fixture üretimi),
  `234-260` (cleanup assert'leri); silme kodunun kendisi
  `tests/e2e/support/database.ts:503-519`.
- Davranış: Support testi `seedMetadataRun` ile üç `run_steps` satırı olan bir run
  yaratıyor; fakat `measurements` ve `run_events` satırı yaratmıyor. Gerçek çıktı:
  `cleanup ... runSteps=3 measurements=0 runEvents=0`. Dolayısıyla `cleanupE2eData`
  içindeki `measurements` ve `run_events` silme yolları ve bu tablolardan satır
  silinirken trigger etkileşimi PG-only support testinde denenmiyor; trigger'ların
  enabled kalması kontrolü bu tablolarda hiç satır yokken yapılıyor. `plan-copy`
  testi kaynak run'da measurement/event üretiyor; ancak o test `cleanupE2eData`
  yolunu kullanmıyor.
- Etki: Bu iki tablodaki bir silme/FK/trigger regresyonu yalnız gerçek Playwright
  suite'inde (veya üretim benzeri bir run'da) ortaya çıkar; o kapı henüz çalışmadı.
  Ayrıca `expectCleanupFailure` (`112-124`) her hatayı kabul ediyor; yalnız beklenen
  hata mesajını doğrulamıyor.
- Öneri: Terminal bir run'ı gerçek measurement ve event satırlarıyla hazırla; cleanup
  summary'de `measurements > 0` ve `runEvents > 0` assert et; success/forced-failure
  sonrası bu tabloların da trigger durumunu kontrol et. `expectCleanupFailure` en
  azından beklenen hata sınıfını/mesajını doğrulasın.

### O-4 — Düşük — Plan-copy kaynak run'ı non-null `deviceSnapshot`/`batchNumber` ile denenmiyor

- Konum: `apps/api/test/plan-copy.e2e-spec.ts:525-532` (kaynak run cihazsız
  başlatılıyor); fingerprint tanımı
  `apps/api/test/support/plan-copy-helpers.ts:138-155` ve `165-175`.
- Davranış: Fingerprint `testRun` satırlarının tamamını hash'liyor; bu nedenle
  `deviceSnapshot`, `batchNumber` ve `batchNumberKey` alanları yapısal olarak
  kapsanıyor. Ancak yeni testte kaynak run cihaz/parti olmadan başlatıldığı için bu
  alanlar null; copy öncesi/sonrası non-null snapshot/batch korunması gerçek veriyle
  kanıtlanmıyor. Hedef planın boş geçmişi ve bağımsız logical step kimlikleri ise
  ayrıca doğrulanıyor.
- Etki: Copy'nin run metadata'sına dokunmadığı iddiası measurement/event/hash/
  idempotency için güçlü; snapshot/batch için yalnız kod yapısıyla destekleniyor.
- Öneri: Kaynak run'ı cihaz ve parti bilgisiyle başlat (veya ikinci bir fixture ekle)
  ve fingerprint testini bu non-null değerlerle çalıştır. `batchNumber`/snapshot
  alanlarını ayrıca okuyan açık assert'ler eklemek kanıtı güçlendirir.

### O-5 — Düşük — Health geçici DB'sinin drop'u `app.close()` hatasına bağlı

- Konum: `apps/api/test/health.e2e-spec.ts:177-189`.
- Davranış: `afterAll` önce `app.close()` çağırıyor; drop ancak ondan sonra geliyor.
  `app.close()` reject ederse `admin` bloğuna hiç gelinmiyor ve kendi oluşturduğu
  geçici `probedesk_ready_*_test` DB'si kalabiliyor. Yeni `created` bayrağı yalnız
  "CREATE başarısızsa drop etme" koruması sağlıyor; close hatasına karşı korumuyor.
- Etki: Test başarısız olduğunda kendi geçici DB'sini bırakabilir; kabul edilen
  "cleanup başarısız testte de çalışır" kuralı için küçük bir boşluk.
- Öneri: Drop ve `admin.end()` işlemlerini `app.close()` sonucundan bağımsız bir
  `try/finally` içine al; drop hatası app close hatasını maskelemesin.

### O-6 — Düşük — Cleanup'ta demo plan koruması yok; isimle cihaz çözümü tüm eşleşmeleri alıyor

- Konum: `tests/e2e/support/database.ts:381-408` (isimle cihaz çözümü),
  `435-441` ve `559-579` (plan adı/ID ile silme); demo cihaz guard'ı `398-404`.
- Davranış: Demo cihazlar sabit ID ile korunuyor; fakat `planIds`/`planNames` için
  ortak bir demo plan guard'ı yok. Bir çağıran `Power Supply Validation` adını veya
  demo plan ID'sini verirse paylaşılan demo planı, revision'ları, run'ları,
  measurement/event'leri ve step identity'leri silinebilir. Ayrıca `deviceNames`
  aynı ada sahip **tüm** cihazları çözer; test cihazıyla aynı adı taşıyan ilgisiz bir
  cihaz da silinebilir.
- Etki: Mevcut çağıranlar benzersiz ad/kimlik kullanıyor ve support testi geçiyor;
  bu nedenle güncel akışta hata görülmedi. Yine de savunma derinliği açısından
  paylaşılan fixture'ları yanlış parametreyle silmek mümkün.
- Öneri: Demo plan adını/ID'sini reddet; `deviceNames` çözümünü yalnız test
  kullanıcısının oluşturduğu cihazlarla veya yalnız açık ID'lerle sınırla.

## Bağımsız doğrulama — review tarafından gerçekten çalıştırılanlar

Güvenlik/ortam notu: Her review komutundan önce `.env` içindeki
`TEST_DATABASE_URL` ayrıştırıldı ve hedefin tam olarak `127.0.0.1:5433` ile kendi
yeni `_test` veritabanı adı olduğu doğrulandı; maintenance bağlantısı bu doğrulanmış
hedeften türetildi. Credential ve tam URL yazdırılmadı. Maintenance `postgres` yalnız
kendi DB'lerimi oluşturmak ve düşürmek için kullanıldı. `5434/probedesk` ve `5432`
veritabanlarına bağlanılmadı; eski lead/reviewer/E2E DB'leri silinmedi; browser,
preview, CUA, server veya `localhost:8080` kullanılmadı; `openapi:check`
çalıştırılmadı.

1. Kendi DB'm `probedesk_ex12_review_20261108_test` oluşturuldu.
   `node scripts/e2e-isolated.mjs prepare` → `exit 0`; 10 migration uygulandı; seed
   sonrası baseline:
   `plans=1 revisions=2 runs=4 activeRuns=0 sessions=0 demoUsers=3 demoProfiles=1
   devices=2 demoDevices=2 copyRequests=0 demoRuns=4`.
2. `npx tsx tests/e2e/support/ex12-support.integration.ts` → `exit 0`.
   Özet: tracked cleanup `devices=1 copyRequests=1 runs=1 runSteps=3`; ilgisiz
   cihaz/plan/copy provenance korundu; named-device cleanup ve demo cihaz guard'ı
   geçti; trigger'lar success/forced-failure/retry sonrası enabled; baseline
   `plans=1 runs=4 devices=2 copyRequests=0 activeRuns=0`.
   Not: İlk sarmalayıcı denemede zsh'in salt-okunur `status` değişkeni nedeniyle
   kabuk `exit 1` verdi; script çıktısı tamamlanmıştı. Aynı komut `rc=$?` ile
   yeniden koşuldu ve script `exit 0` verdi.
3. `node scripts/e2e-isolated.mjs assert-baseline` → `exit 0`;
   `canonical fixture fingerprint matches the prepare baseline`.
   `node scripts/e2e-isolated.mjs seed-check` → `exit 0`; iki seed sonrası
   "counts and canonical fixture digests unchanged".
4. Hedefli `apps/api/test/plan-copy.e2e-spec.ts`:
   `npx vitest run --config vitest.config.e2e.ts test/plan-copy.e2e-spec.ts` →
   `1 dosya / 7 test passed`, `exit 0`, `2.13s`. Bu, komutun gerçek DB üzerinde
   çalıştığını ve testlerin gerçek HTTP + PG kullandığını doğruladı.
5. O-1/O-2 yeniden üretimi (aynı review DB'si):
   demo cihaz `description` alanı değiştirildi; sayımlar aynı kaldı.
   - Baseline dosyası mevcut: `assert-baseline` → `exit 1`.
   - Baseline dosyası yok: `assert-baseline` → `exit 0` (uyarı + count-only).
   - Mutasyon varken `ex12-support` → `exit 0` ("restored baseline").
   Bu, O-1 ve O-2'yi gerçek davranışla doğruladı.
6. Hedefli `apps/api/test/device-seed.e2e-spec.ts`:
   aynı yöntemle `1 dosya / 5 test passed`, `exit 0`, `1.76s`.
   Not: Bu spec, O-1/O-2 mutasyon denemesinden sonra koşuldu; kendi
   `beforeAll`/`afterAll` demo fixture'ını sıfırladığı için mutasyon kalıntısı testi
   etkilemedi. Spec kendi `afterAll`'ında demo fixture'ı siliyor; bu nedenle
   sonrasında `assert-baseline` koşulmadı, DB hemen drop edildi.
7. CI-only guard fallback (ikinci kendi DB'm
   `probedesk_ex12_review_ci_20261108_test`): `DATABASE_URL` ve `TEST_DATABASE_URL`
   boş, yalnız `E2E_DATABASE_URL` ile `prepare` → `exit 0` (10 migration, seed);
   `assert-baseline` → `exit 0`; `DATABASE_URL/TEST_DATABASE_URL are not set; using
   a derived non-target guard identity` uyarısı görüldü. Ayrıca:
   - `_test` ile bitmeyen hedef → `exit 1` (refusal).
   - CI-only fallback kimliği hedefle aynı olacak şekilde `probedesk_test` hedefi →
     `exit 1` (refusal).
8. Cleanup: `probedesk_ex12_review_20261108_test` ve
   `probedesk_ex12_review_ci_20261108_test` yalnız kendi maintenance oturumumla
   `DROP DATABASE ... WITH (FORCE)` ile düşürüldü; `pg_database` sorgusuyla ikisinin
   de yok olduğu doğrulandı. Review'a ait geçici baseline dosyaları silindi.
   `git status` yalnız başka worker'ın önceden var olan spec değişikliklerini
   gösterdi; review kaynak/generated dosya değiştirmedi. `git add/commit/push/
   checkout/reset/stash` çalıştırılmadı.

## Lead'den devralınan, review'de yeniden koşulmayan sonuçlar

Bunlar `docs/evidence/feature-pack-1/ex-12.md` kaydından devralındı; bağımsız
review koşusu değildir:

- `probedesk_ex12_lead_20261108_test` üzerinde prepare 10 migration; PG support
  success/forced-failure/retry; seed-check x2 ve assert-baseline `exit 0`.
- İlk tam integration suite health fixture'ının `_test` son eki eksikliği nedeniyle
  `276 passed / 2 skipped`, `exit 1`; `6d60db5` sonrası health `10/10`, ardından
  ayrı lead DB'sinde tam integration `29 dosya / 278 passed`, `exit 0`, `45.06s`.
- API unit `19 dosya / 145 passed`, `exit 0`; API lint `187 dosya` temiz;
  typecheck `exit 0`. Root helper `tsc` açık flag'lerle `exit 0`; oxlint 3 dosya
  temiz; prettier/nodecheck/diffcheck temiz.
- Lead yalnız kendi yeni DB'sini düşürdüğünü, `5434`/`5432` bağlantısı olmadığını
  bildirdi. Bu operasyonel iddia review'de ayrıca ölçülmedi.
- GitHub Actions E2E job'ı (support adımı + Playwright + final assert-baseline)
  henüz gerçek CI'da koşmadı; CI kodu okundu, `5432`'ye bağlanılmadı.

Sağlık fixture düzeltmesi (`6d60db5`) incelendi: `_test` son eki ve `created` bayrağı
guard'ı gevşetmeden doğru yönde; `requireIsolatedApplicationDatabase` health
testinde açıkça çağrılıyor. Bu düzeltmede O-5 dışında yeni bir sorun
görülmedi; gerçek health koşusu yukarıdaki lead kaydından devralındı.

## Kalan kapılar ve kapsam sınırı

- EX-12'nin gerçek browser kabulü (Planner→Operator→Viewer, download/print,
  gerçek Chart.js/font/PNG/native print, 390px/200% zoom/klavye, uzun metadata/10k)
  çalışmadı. Yeni `feature-pack-1.spec.ts` başka worker'ın alanıdır ve bu review'de
  değerlendirilmedi.
- GitHub Actions E2E job'ı ve gerçek CI artifact/step sonuçları yok.
- Seed'li mevcut DB copy/upgrade, delivery rollout/8080 ve EX-13 kapsam dışıdır.
- Plan-copy testi gerçek HTTP+PG kullanır; browser değildir. Bu kayıt browser
  senaryosunun veya ürün/görsel kabulün yerine geçmez.
- `cleanupE2eData`'nın RUNNING run görünce 20 saniye bekleyip reddetme yolu kod
  incelemesinde doğru; support çıktısı yalnız `activeRuns=0` sonrasını doğruluyor,
  doğrudan reddetme senaryosu bu review'de ayrıca koşulmadı.

## INFRA dilimi için teknik öneri

Kritik/yüksek bulgu yok; ancak O-1, O-2 ve O-3 kapatılmadan bu altyapı EX-12'nin
E2E kabul kapısı olarak kullanılmamalıdır:

1. O-1: Baseline dosyası yoksa `assert-baseline` fail-closed olsun; host
   normalizasyonu guard ile aynı olsun.
2. O-2: Support testi `devicesDigest` ve `planCopyRequestsDigest` değerlerini
   before/after karşılaştırsın; O-3: support fixture'ı measurement ve run event
   içersin ve cleanup bu satırları silsin.
3. O-4: Plan-copy fingerprint source run'ı non-null device snapshot/batch ile
   çalışsın; O-5: health geçici DB drop'u `app.close` hatasından bağımsız olsun;
   O-6: demo plan ve isimle cihaz çözümü için savunma guard'ı eklensin.

Bu düzeltmelerden sonra INFRA dilimi browser senaryosu yazımını destekleyecek durumda
sayılabilir. EX-12 kartı **In Progress** kalmalıdır; browser/print/zoom ve gerçek CI
kapıları tamamlanmadan `In Review`/`Accepted` iddiası yapılamaz. Ürün/görsel kabul
kullanıcıya aittir.
