# EX-03 — Bağımsız teknik inceleme (Device API ve eklemeli demo seed)

- Tarih: 2026-11-06
- İnceleme kapsamı commit: `9efbcb2b30c7891861ab16fb0a057d65c9f4a9c0`
  (`feat: manage device identities and seed demo devices safely`)
- Branch/HEAD: `feat/analytics-reporting-devices` / `db235e1c457f21fef02aa9eb3fe14b4e8c9f9162`
  (`db235e1` yalnız plan kopyalama frontend'i ve bunun kanıtını ekler; Device/seed
  dosyalarında `9efbcb2..HEAD` aralığında değişiklik yoktur.)
- İnceleme türü: **Bağımsız kod/API/seed incelemesi.** Bu belge ürün kabulü, kullanıcı
  kabulü veya yayın kararı değildir.
- Kapsam: `apps/api/src/devices/**`, `apps/api/prisma/seed-devices.ts`,
  `seed-demo.ts`, `seed-demo-cleanup.ts`, `seed-reset.ts`, `seed.ts`, `seed-data.ts`
  Device bölümü, `apps/api/test/devices.e2e-spec.ts`,
  `device-seed.e2e-spec.ts`, `demo-seed.e2e-spec.ts`, `seed-demo-data.e2e-spec.ts`,
  `support/device-helpers.ts`, `apps/api/openapi.json` Device yolları/şemaları ve
  üretilen `packages/api-client/src/schema.ts` Device tipleri.
- Kısıt: Repository içinde yalnızca bu dosya yazıldı; `git add`, `commit`, `push`,
  `checkout`, `reset` ve `stash` çalıştırılmadı. Uygulama kodu, şema, migration,
  görev kartı, roadmap veya README değiştirilmedi. Subagent başlatılmadı.
  **Bununla birlikte** aşağıdaki "Operasyonel istisna" bölümünde kaydedilen hatalı
  ilk Prisma komutu yerel dev `probedesk` veritabanına additive migration uyguladı;
  bu, inceleyenin komut hatasıdır, kod değişikliği değildir.
- Test iddiası: Worker 32/32; lead API unit 118/118, tam integration 246/246,
  cleanup sonrası hedefli 9/9. Reviewer bu tam koşuları yeniden çalıştırmadı;
  aşağıda gerçekten çalıştırdığı hedefli 33/33 koşusu ve diğer kontroller kayıtlıdır.

## Sonuç özeti

| Alan                                                  | Sonuç                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rol ve CSRF                                           | **Geçti.** Sınıf düzeyinde `SessionAuthGuard` + `RolesGuard`, mutasyonlarda ayrıca `CsrfGuard`; `SessionAuthGuard` mutasyonlarda CSRF'i ikinci kez uygular. Üç rol okuma, yalnız Planner mutasyon ve eksik CSRF testleri geçti.                                                                                                                                                    |
| Canonical seri ve hata eşlemesi                       | **Geçti.** Trim + `serialNumberKey = upper(serialNumber)`; unique `(deviceProfileId, serialNumberKey)`; P2002 → 409 `DEVICE_SERIAL_CONFLICT`; stale revision → 409 `DEVICE_CONFLICT` + `details.currentRevision`; tek-kaynak bilinmeyen cihaz UUID'si → 404, liste profil filtresinde bilinmeyen UUID → boş sonuç; bozuk gövde/UUID → 400. Arşivli cihazın serisi rezerve kalıyor. |
| Prefix arama, sayfalama, kararlı okuma                | **Davranış geçti; L-1 kanıt eksiği var.** `%`, `_`, `\` literal kaçışlı; parametreli `ILIKE` prefix; `state` varsayılan `active`; `deviceProfileId`; varsayılan 20 / en fazla 100; `name ASC, id ASC`; count ve satırlar aynı RepeatableRead işleminde. Gerçek sorgu planı/EXPLAIN kanıtı yok ve ad/seri prefix'i için destekleyen indeks yok.                                     |
| Mutasyon kilidi, revision, no-op, arşiv               | **Geçti.** READ COMMITTED içinde `SELECT ... FOR UPDATE`, sonra revision kontrolü; eşzamanlı update yarışı 200/409; no-op güncelleme revision'ı artırmıyor; archive/restore hedef durumdaysa 200 ve değişmemiş revision, değilse +1; stale her durumda 409.                                                                                                                        |
| Immutable profil                                      | **Geçti.** `PATCH` DTO'sunda profil alanı yok; global whitelist `deviceProfileId` gönderimini `UNKNOWN_FIELD` ile 400 yapıyor; servis profili hiç güncellemiyor. Test bunu doğruluyor.                                                                                                                                                                                             |
| Eklemeli seed / kullanıcı düzenlemeleri / no-backfill | **Geçti.** Sabit UUID'ler; mevcut fixture atlanıyor, overwrite yok; advisory lock; canonical seri başka cihazdaysa açık `DemoSeedConflictError` ve cihaz işlemi rollback; dört eski run'ın metadata'sı null kalıyor; testte kullanıcı düzenlemeleri korunuyor.                                                                                                                     |
| Cleanup Restrict / kopya provenance                   | **Geçti (kopya provenance); EX-12 kapısı sürüyor.** `PlanCopyRequest` plan/revision/user silinmeden önce temizleniyor; gerçek PG fixture'lı regresyon testi geçti. Device/kopya E2E baseline ve tam reset bu incelemede çalıştırılmadı; EX-12 kapsamındadır.                                                                                                                       |
| OpenAPI/istemci sözleşmesi                            | **Geçti.** Dört Device yolu ve metotları, `DeviceDto`/liste/create/update/revision şemaları, `session` + mutasyonlarda `csrfToken` güvenliği ve yeni hata kodları committed OpenAPI/client ile uyumlu. OpenAPI path testi güncellenmiş.                                                                                                                                            |
| Test tasarımı                                         | **Geçti; L-2 düşük.** Reviewer'ın temiz `_test` DB'sinde 4 dosya/33 test geçti. Seed testleri dosya içi sıraya ve global sayıma bağlı; tek başına çalıştırma/gelecekteki EX-04 verisi için kırılgan.                                                                                                                                                                               |

## Bulgular

### L-1 — Düşük: Prefix arama için EXPLAIN/indeks kanıtı yok

**Konum:**

- `docs/feature-pack-1-plan.md:76`: arama ad/seri prefix eşleşmesi olacak ve
  "indeks kullanımı gerçek sorgu planıyla kontrol edilir".
- `apps/api/src/devices/devices.service.ts:270-277`: `ILIKE` prefix sorgusu.
- `apps/api/prisma/schema.prisma:84-86`: yalnız `(deviceProfileId,
serialNumberKey)` unique'i ve `deviceProfileId`, `createdById` indeksleri var;
  `name` veya `serialNumber` üzerinde arama indeksi yok.
- `docs/evidence/feature-pack-1/ex-03.md:10-14`: çalıştırılan kontrollerde EXPLAIN
  veya sorgu planı kaydı yok.
- `apps/api/test/devices.e2e-spec.ts:616-689`: `%`, `_`, trim, case-insensitive ve
  100 karakter sınırı test ediliyor; ters bölü (`\`) ve EXPLAIN testi yok.

**Gerçek durum:** Arama davranışı doğru: değer parametreli, `%`/`_`/`\` kaçışlı,
baştan eşleşiyor; testler `%` ve `_` literal davranışını gerçek HTTP üzerinden
doğruluyor. Ancak planın istediği "gerçek sorgu planıyla indeks kullanımı" kanıtı
yok. Şemada `name ILIKE 'prefix%' OR serialNumber ILIKE 'prefix%'` için uygun bir
indeks de bulunmuyor; veri büyüdüğünde sequential scan beklenir.

**Somut başarısızlık:** Gözlenen bir yanlış sonuç yok. Bu bir doğruluk hatası değil,
sözleşmede istenen performans/kanıt adımının eksikliğidir. EX-03 kabulünü tek başına
engellemez; ancak teslim öncesi EXPLAIN çıktısı (veya bilinçli sequential-scan
gerekçesi) eklenmeli, en azından `\` literal araması test edilmelidir.

**Öneri:** Prefix araması için `EXPLAIN (ANALYZE, BUFFERS)` çıktısını gerçek PG
fixture'ıyla kanıta ekle; indeks eklenmeyecekse bunu açıkça gerekçelendir. Test
setine `q` içinde `\` bulunan bir cihazın yalnız o cihazı döndürdüğü negatif/pozitif
vakayı ekle.

### L-2 — Düşük: Seed testleri sıralı duruma bağlı ve global run sayımı kullanıyor

**Konum:**

- `apps/api/test/device-seed.e2e-spec.ts:57-120` (`adds two fixed devices...`):
  ilk test seed'i oluşturuyor.
- `:122-168` (`is idempotent...`): ilk testin bıraktığı demo kullanıcı/plan/run
  durumuna ve `captureDigest`'e bağlı.
- `:170-213` (`fails safely...`): demo cihazlarını silip çakışan cihaz bırakıyor.
- `:215-249` (`cleans copy provenance...`): önceki testlerin bıraktığı state'e ve
  `cleaned.plans === 2` beklentisine bağlı.
- `:117-119`: yalnız demo run'ları değil, **bütün** `test_runs` tablosunda
  `deviceId IS NOT NULL` sayısının 0 olmasını bekliyor.

**Gerçek durum:** Dosya sırayla çalıştırıldığında 33/33 geçti; ancak testler tek
başına çalıştırılabilir değil. `-t` ile ikinci testi tek başına çalıştırmak demo
seed'i olmadığı için `captureDigest` aşamasında düşer. `:117-119` global sayım,
ileride EX-04/EX-12'nin gerçek cihazlı run fixture'ları aynı test DB'sinde kaldığında
yanlış negatif üretebilir. `cleaned.plans === 2` de başka bir demo planı eklendiğinde
kırılır.

**Somut başarısızlık:** Mevcut sıralı koşuda hata yok. Gelecekte test izolasyonu veya
paralel/tek test koşusu için kırılganlık var; ürün davranışı hatası değil.

**Öneri:** Her testi kendi seed/cleanup'ıyla başlat veya `beforeEach` ile demo
fixture'ı sıfırla. Global `count(deviceId not null)` yerine `DEMO_RUNS`
idempotency anahtarlarıyla sınırlı sayım kullan; `plans` beklentisini yalnız bu
testin oluşturduğu planlarla sınırla.

### L-3 — Düşük/koşullu: Canonical anahtarın DB `upper()` ile locale bağımlılığı

**Konum:**

- `apps/api/src/devices/device-domain.ts:20-26`: JS `toUpperCase()`.
- `apps/api/prisma/migrations/20261106120000_devices_and_copy_requests/migration.sql:103-108`:
  DB `serialNumberKey = upper("serialNumber")` check'i.
- `apps/api/prisma/schema.prisma:84`: canonical unique anahtar.
- Plan beklentisi: `docs/feature-pack-1-plan.md:69-70`.

**Gerçek durum:** Mevcut dev ve test veritabanları `en_US.utf8`; `upper('i') = 'I'`
olarak ölçüldü, dolayısıyla mevcut ortamda servis ve DB aynı sonucu veriyor. Ancak
PostgreSQL `upper()` veritabanı locale'ine bağlıdır; `tr_TR.utf8` gibi bir locale'de
`upper('i')` `İ` olur ve ASCII `i` içeren bir seri numarası oluşturulurken JS'in
ürettiği `I` anahtarı DB check'ini ihlal edebilir. Bu, mevcut test/delivery
ortamında gözlenen bir hata değildir; taşınabilirlik riskidir.

**Somut başarısızlık:** Mevcut `en_US.utf8` dev/test DB'lerinde yok. Farklı locale'li
bir PostgreSQL'e taşınırsa `DEVICE` create 500/constraint hatasına dönüşebilir.

**Öneri:** Kanonik anahtarı DB'de üret (örneğin ASCII'ye sabitlenmiş bir SQL
ifadesi/immutable function) veya migration/check'i locale bağımsız hale getir;
en azından delivery DB locale'ini startup'ta doğrula ve test et. EX-03 kabulünü
engellemez; not olarak izlenmeli.

## Devredilen ve bu incelemede doğrulanmayanlar

- **EX-04:** Start Run'da cihaz aktifliği/profil uyumu, `FOR SHARE`/start yarışı,
  snapshot üretimi, `Prisma.DbNull`, v1/v2 hash ve `/runs` filtreleri bu kartın
  kapsamı değildir; EX-03'te aranmadı.
- **EX-12:** Yeni Device/PlanCopyRequest tablolarının gerçek E2E cleanup/baseline
  kapsamı, demo reset ve assert-baseline bu incelemede çalıştırılmadı. Cleanup
  fix'inin kopya provenance regresyonu gerçek PG'de geçti; ancak tam E2E izolasyon
  kapısı EX-12'de açık kalıyor.
- **Cleanup device FK'si:** `seed-demo-cleanup.ts:61-63` cihazları yalnız
  `createdById` ile siliyor. Gelecekte demo olmayan bir kullanıcının run'ı demo
  cihazına bağlanırsa `test_runs.deviceId` Restrict nedeniyle reset düşebilir.
  Mevcut üç demo hesabı/no-registration modelinde bu yol yok; EX-12 fixture
  kapsamında izlenmeli.
- **Frontend/browser/görsel kabul:** Bu incelemede browser açılmadı; ürün/görsel
  kabul kullanıcıya aittir.
- **Tam suite/typecheck/lint/openapi:check:** Lead'in 118/118 unit, 246/246
  integration, typecheck/lint/openapi:check exit0 kayıtları devralınmıştır;
  reviewer bunları yeniden çalıştırmadı. Reviewer yalnızca aşağıdaki hedefli
  kontrolleri gerçekten çalıştırdı.
- **Demo README:** `apps/api/README.md:93-95` hâlâ yalnız üç demo hesabı ve tek
  profili anıyor; iki demo cihazı anmıyor. Teslim dokümanı/EX-13 sırasında
  güncellenmeli; EX-03 kod kabulünü engellemez.

## Reviewer tarafından çalıştırılan kontroller

Bu bölümdeki sonuçlar inceleme sırasında gerçekten çalıştırılan komutlardan alınmıştır.
Tam unit/integration suite'i yeniden çalıştırılmadı.

| Kontrol                      | Komut / yöntem                                                                                                                                                                                                                                        | Gerçek sonuç                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Çalışma ağacı ve HEAD        | `git status --short`; `git branch --show-current`; `git rev-parse HEAD`; `git rev-parse 9efbcb2`                                                                                                                                                      | Çıktı boş; branch `feat/analytics-reporting-devices`; HEAD `db235e1c457f21fef02aa9eb3fe14b4e8c9f9162`; Device commit `9efbcb2b30c7891861ab16fb0a057d65c9f4a9c0`.                                                                                                                                                                          |
| Commit kapsamı               | `git show --stat --oneline 9efbcb2`; `git diff --name-only 9efbcb2..HEAD`                                                                                                                                                                             | `9efbcb2`: 27 dosya, `+4293/−52`; Device/seed/OpenAPI dosyaları bu commit'te. `9efbcb2..HEAD` yalnız `apps/web/src/app/features/plans/**` ve `docs/evidence/feature-pack-1/ex-07.md`; Device/seed dosyalarında değişiklik yok.                                                                                                            |
| Whitespace                   | `git diff --check 7195ad4..9efbcb2`                                                                                                                                                                                                                   | Çıktı yok; exit 0.                                                                                                                                                                                                                                                                                                                        |
| OpenAPI yolları/şemaları     | Node ile `apps/api/openapi.json` parse                                                                                                                                                                                                                | `/api/devices` GET/POST, `/api/devices/{id}` GET/PATCH, `/api/devices/{id}/archive` POST, `/api/devices/{id}/restore` POST; `DeviceDto`, `DeviceListResponseDto`, `CreateDeviceDto`, `UpdateDeviceDto`, `DeviceRevisionDto` mevcut; GET `session`, mutasyonlar `session` + `csrfToken`; `ApiErrorDto` yeni `DEVICE_*` kodlarını içeriyor. |
| Canonical/locale okuması     | Dev `probedesk` ve test `probedesk_test` üzerinde salt-okunur SQL: `datcollate`, `datctype`, `upper('i')`                                                                                                                                             | İkisi de `en_US.utf8`; `upper('i') = 'I'`. L-3'teki taşınabilirlik riski bu ortamda gözlenmedi.                                                                                                                                                                                                                                           |
| Hedefli gerçek PG/HTTP testi | Yeni ve benzersiz `probedesk_ex03_review_8df454b6_test` DB'si; `prisma migrate deploy`; `vitest run --config ./vitest.config.e2e.ts test/devices.e2e-spec.ts test/device-seed.e2e-spec.ts test/demo-seed.e2e-spec.ts test/seed-demo-data.e2e-spec.ts` | 9/9 migration uygulandı; **Test Files 4 passed, Tests 33 passed**, süre 4.10s, exit 0; DB `DROP DATABASE ... WITH (FORCE)` ile silindi. Dev/delivery/shared/lead DB'sine test yazımı yapılmadı.                                                                                                                                           |
| Seed/cleanup kapsamı         | Yukarıdaki 33 testin içinde `device-seed` 4 testi, `demo-seed` 3 testi, `seed-demo-data` 2 testi                                                                                                                                                      | Cihaz seed idempotency/edits/no-backfill/conflict rollback ve `PlanCopyRequest` cleanup regresyonu dahil geçti.                                                                                                                                                                                                                           |
| Devralınan lead kontrolleri  | Lead kayıtları (`docs/evidence/feature-pack-1/ex-03.md`)                                                                                                                                                                                              | Worker 32/32, lead unit 118/118, tam integration 246/246, cleanup sonrası hedefli 9/9, typecheck/lint/openapi:check exit 0. **Reviewer bu tam koşuları yeniden çalıştırmadı.**                                                                                                                                                            |

## Operasyonel istisna (reviewer hatası)

İlk hedefli test denemesinde benzersiz review DB'si
`probedesk_ex03_review_48823b96_test` oluşturuldu, ancak Prisma migrate komutuna
yanlışlıkla `DATABASE_URL` (yerel dev `probedesk`, `127.0.0.1:5434`) verildi.
Sonuç olarak `20261106120000_devices_and_copy_requests` migration'ı review DB'sine
değil, yerel dev `probedesk` veritabanına uygulandı. Migration daha önce dev DB'de
uygulanmamıştı; `_prisma_migrations.finished_at` bu komutun zamanını gösteriyor.
Review DB'si boş kaldığı için o denemedeki dört test dosyası `42P01` (ilişki yok)
hatasıyla düştü; review DB'si `DROP DATABASE ... WITH (FORCE)` ile silindi.

Migration additive olduğu için satır verisi değişmedi; salt-okunur son kontrol:

- `test_runs`: 45 run; `deviceId`/`deviceSnapshot`/`batchNumber` dolu olan 0.
- `devices`: 0; `plan_copy_requests`: 0.
- Uygulanmış migration sayısı: 9.

Bu, inceleyenin komut hatasıdır; EX-03 uygulamasının kusuru değildir. Geri alma
denenmedi, çünkü bu ikinci bir destructive DB değişikliği olurdu. Lead, dev DB'de
bu additive migration'ı tutup tutmayacağına karar vermeli ve gerekirse delivery/
dev durumunu buna göre doğrulamalıdır. Sonraki doğru koşu ayrı review DB'sinde
yapıldı ve dev DB'ye başka yazım yapılmadı.

## Kabul önerisi

**EX-03 teknik olarak `Accepted` edilebilir; kritik veya yüksek bulgu yoktur.**
Üç kabul ölçütü de gerçek PostgreSQL/HTTP testleriyle karşılanmıştır: rol/CSRF,
canonical unique + yarış, revision/archive/restore, eklemeli seed ve kopya
provenance cleanup regresyonu. Reviewer'ın temiz review DB'sindeki hedefli koşusu
4 dosya/33 test geçmiştir.

Kabul için önerilen koşullar:

1. **L-1** teslim öncesi kapatılmalı veya bilinçli olarak izlenmeli: prefix arama
   için EXPLAIN/sorgu planı kanıtı ve `\` literal testi eklenmeli.
2. **L-2** test izolasyonu iyileştirilmeli; global device-run sayımı demo fixture'ına
   daraltılmalı. EX-04/EX-12 testleri aynı DB'ye cihazlı run eklediğinde bu test
   kırılmamalı.
3. **L-3** delivery DB locale'i doğrulanmalı veya canonical anahtar locale'den
   bağımsız hale getirilmeli; mevcut `en_US.utf8` ortamında hata yok.
4. **EX-04** start/snapshot/hash/`FOR SHARE` yarışı ve **EX-12** gerçek E2E
   baseline/device+copy cleanup kapıları açık kalır; bu inceleme onları çözüldü
   saymaz.
5. Lead bu inceleme kaydını `docs/tasks/EX-03.md` ve gerekli durum/kanıt alanlarına
   bağlamalı; `Accepted` kararını ayrı olarak kendisi vermelidir. Reviewer görev
   kartı durumunu değiştirmedi.

Bu belge ürün kabulü değildir. Kullanıcı görsel/ürün kabulü ayrıca kullanıcıya
aittir ve verilmiş sayılmaz.
