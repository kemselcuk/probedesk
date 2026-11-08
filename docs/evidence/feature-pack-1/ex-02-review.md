# EX-02 — Bağımsız teknik inceleme (Device/kopya şeması ve run metadata)

- Tarih: 2026-11-06
- İnceleme commit'i: `fe1e5fc` (`feat: persist device identities and immutable run metadata`)
- Branch: `feat/analytics-reporting-devices`; HEAD `fe1e5fc0f5da02c7dc228c4dc2457d1a8574d1cf`
- İnceleme türü: **Bağımsız kod/şema/migration incelemesi.** Bu belge ürün kabulü,
  kullanıcı kabulü veya yayın kararı değildir.
- Kapsam: Yalnız `fe1e5fc` commit'indeki `Device`, `PlanCopyRequest`, nullable `TestRun`
  metadata, additive migration, migration manifesti ve yeni gerçek PostgreSQL testleri.
- Kısıt: İnceleme sırasında repository içinde yalnızca bu dosya yazıldı. `git add`,
  `git commit`, `git push`, `git checkout`, `git reset` veya `git stash` çalıştırılmadı;
  uygulama kodu, şema, migration, görev kartı, roadmap veya README değiştirilmedi.
  Subagent başlatılmadı.
- Test iddiası: Lead'in `118/118` unit ve `213/213` integration sonuçları devralınan kayıt
  olarak anılmıştır; reviewer bu iki tam koşuyu yeniden çalıştırmadı. Reviewer yalnızca
  aşağıda "Reviewer tarafından çalıştırılan kontroller" bölümünde yazan hedefli kontrolleri
  gerçekten çalıştırdı. Çalıştırılmayan kontrol çalıştırılmış gibi gösterilmedi.

## Sonuç özeti

| Alan                               | Sonuç                                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Additive migration                 | **Geçti.** Dört yeni `test_runs` kolonu nullable; iki yeni tablo; mevcut satırlara veri yazımı yok. `20261106120000` manifeste eklenmiş.                                                                  |
| FK/unique/check                    | **Geçti.** Device profil/oluşturan FK'leri ve PlanCopyRequest ilişkileri `Restrict`; canonical seri unique; metadata çiftleri ve uzunluk/karakter kontrolleri gerçek PG'de sınanmış.                      |
| SQL NULL semantiği                 | **Geçti.** Eksik JSON anahtarlarının `UNKNOWN` ile CHECK'i atlaması `IS TRUE` ile kapatılmış; dört zorunlu anahtarın her biri için ayrı test var.                                                         |
| Eski/yeni immutability             | **Geçti.** Eski trigger'ın 16 alanı aynen korunmuş; dört yeni metadata alanı eklenmiş. Eski alanların hiçbiri düşmemiş; terminal status kuralı aynı.                                                      |
| Legacy upgrade                     | **Çalışıyor; kanıt kapsamı sınırlı (M-1).** Sentetik pre-feature fixture ile snapshot/tolerans/ölçüm/event/hash korunuyor; gerçek demo seed kopyasının yükseltilmesi literal olarak test edilmiyor.       |
| İzolasyon/temizlik                 | **Geçti (koşullu).** Testler `_test` DB'sinde çalışıyor; migration testleri ayrı şemalar kullanıyor; cleanup prefix/ID tabanlı. Aynı DB'de eşzamanlı koşu yapılmaması operasyonel koşul olarak korunuyor. |
| Canonical kimlik/parti tutarlılığı | **Geçti.** `serialNumberKey = upper(serialNumber)`, `batchNumberKey = upper(batchNumber)`, snapshot `id` = ilişkili `deviceId`; batch cihazsız kullanılabiliyor.                                          |
| Prisma/migration uyumu             | **Geçti.** `prisma validate` başarılı; yeni model/kolon/index/FK'ler migration SQL'i ile eşleşiyor; check/trigger'lar Prisma'da ifade edilemeyen kısımlar olarak migration'da.                            |
| Davranışsal kapsam                 | **EX-02 için yeterli.** Eksik kalan başlıca alanlar sonraki kartların servis/API davranışlarıdır; şema sözleşmesi bunları zorunlu kılmıyor.                                                               |
| Öneri                              | **Teknik kabul önerilir; kritik/yüksek bulgu yok.** M-1 teslim öncesi kapatılmalı; EX-03 ve EX-06 için şema önkoşulları sağlanmıştır.                                                                     |

## Bulgular

### M-1 — Orta: Legacy upgrade testi gerçek seed kopyası değil, izole şema + sentetik fixture

**Konum:**

- `docs/feature-pack-1-plan.md:103` (§4.4.5): “Hem boş DB kurulumu hem mevcut seed/run
  içeren ayrı kopya test DB'sinin yükseltmesi doğrulanır. Yükseltme öncesi/sonrası eski
  snapshot, tolerans, ölçüm, event ve idempotency sonuçları karşılaştırılır.”
- `docs/tasks/EX-02.md:18`: “Verili DB yükseltmesi eski ölçüm/event/hash verisini
  değiştirmez.”
- Test: `apps/api/test/feature-schema.e2e-spec.ts:1052` (`upgrades representative pre-feature
data...`), fixture: `apps/api/test/support/feature-schema-helpers.ts:75`.

**Gerçek durum:** Test yeni bir `feature_upgrade_*` şeması oluşturuyor, önceki migration'ları
uyguluyor, `seedLegacyUpgradeFixture` ile sentetik bir kullanıcı/profil/plan/revision/step/run/
run_step/measurement/event verisi ekliyor, parmak izini alıyor, yeni migration'ı doğrudan
uyguluyor ve parmak izinin değişmediğini doğruluyor. Bu, **veri koruma davranışı için geçerli
bir testtir**; snapshot, tolerans, ölçüm, event ve idempotency/hash kolonlarının tamamı
karşılaştırılıyor.

Ancak bu, planın istediği **mevcut demo seed'ini ve dört run'ı içeren ayrı bir kopya
veritabanının** yükseltilmesi değildir. Test, `prisma migrate deploy`'un mevcut
`_prisma_migrations` geçmişi üzerinden yalnız yeni migration'ı uygulama yolunu ve gerçek seed
satırlarının biçimini değil, migration SQL'ini yeni bir şemada çalıştırmayı doğruluyor.

**Somut başarısızlık:** Gözlenen bir veri kaybı veya migration hatası yok. Migration additive;
yeni CHECK'ler yalnızca yeni ve tamamen NULL kolonlara bakıyor; yeni FK'ler NULL; yeni tablolar
boş. Bu nedenle risk düşük. Yine de plan metnindeki “ayrı kopya, gerçek seed/run” kontrolü
literal olarak kapatılmamıştır.

**Öneri:** Teslim öncesinde (EX-12 veya plan §12.5 kapsamındaki yedekli delivery kontrolü)
mevcut seed'li veritabanının bir kopyasını alıp `prisma migrate deploy` ile yükseltmek; önce/
sonra aynı eski kolon parmak izini, ölçüm/event/hash değerlerini ve dört demo run'ı
karşılaştırmak; gerçek çıktıyı kanıta eklemek. Bu, EX-03/EX-06 şema önkoşullarını engellemez.

### L-1 — Düşük: `deviceSnapshot` için Prisma `DbNull` / JSON null ayrımı

**Konum:** `apps/api/prisma/schema.prisma:263` (`deviceSnapshot Json?`),
`apps/api/prisma/migrations/20261106120000_devices_and_copy_requests/migration.sql:122-126`,
test helper `apps/api/test/support/feature-schema-helpers.ts:182-184`.

**Gerçek durum:** Cihazsız run'da `deviceSnapshot` SQL NULL olmalıdır. Prisma'da nullable
`Json` alanına doğrudan `null` yazmak JSON null üretebilir; bu durumda
`test_runs_device_metadata_check` cihazsız run'ı reddeder. Test helper doğru biçimde
`Prisma.DbNull` kullanıyor ve bu yolu test ediyor. EX-04 servisinde de aynı ayrım
kullanılmalıdır.

**Somut başarısızlık:** EX-02 şemasında hata yok; yalnızca sonraki kart için uygulama tuzağı.
EX-04'te cihazsız run entegrasyon testi bu davranışı açıkça doğrulamalıdır.

### L-2 — Düşük: `devices_deviceProfileId_idx` gereksiz tekrar

**Konum:** `apps/api/prisma/migrations/20261106120000_devices_and_copy_requests/migration.sql:54-60`;
`apps/api/prisma/schema.prisma:84-86`.

**Gerçek durum:** `(deviceProfileId, serialNumberKey)` üzerindeki unique indeks,
`deviceProfileId` tek kolon sorguları için zaten prefix olarak kullanılabilir. Ayrı
`devices_deviceProfileId_idx` doğruluk açısından gerekli değildir; yazma/storage maliyeti
ekler. Planın “rastgele indeks çoğaltılmaz” ilkesiyle de gereksiz bir tekrardır.

**Etki:** Kritik değil; performans/kapasite hijyeni. EX-02 kabulünü engellemez. İstenirse
gelecekteki bir migration'da kaldırılabilir; şimdi zorunlu değildir.

### L-3 — Düşük: Sınır ve JSON tip varyasyonları için isteğe bağlı ek testler

**Konum:** `apps/api/test/feature-schema.e2e-spec.ts:343-423` ve `:759-860`.

Mevcut testler boş/boşluklu ad, 101 karakter, geçersiz karakter, eksik JSON anahtarları,
boşluklu snapshot adı, batch anahtar uyuşmazlığı ve batch çifti ihlallerini kapsıyor. Şu
varyasyonlar açıkça test edilmiyor:

- tam 100/500 karakter sınırının kabulü,
- `deviceSnapshot`'ın obje değil dizi/scalar/null olması,
- `deviceSnapshot.id`'nin geçerli UUID olmaması (bu durum CHECK ihlali yerine PostgreSQL
  `22P02` üretebilir),
- JSON null ile SQL NULL ayrımı (L-1 ile ilişkili).

**Etki:** Kısıtların mantığı doğru; bu testler zorunlu değil. Ancak API hata eşlemesi veya
ileride snapshot üreten servis için bir regresyon testi olarak faydalı olur.

## Sonraki kartlara devredilen ve EX-02 kapsamına alınmayanlar

Aşağıdakiler kasıtlı olarak bu şema görevinde istenmedi; bunların yokluğu EX-02 kusuru
sayılmadı:

- **EX-03:** Device create/edit/archive/restore, `editRevision` optimistic kontrolü, aktif/
  arşiv/tüm listeleme, prefix arama, sayfalama ve eklemeli demo seed. `name`/`description`
  trim normalizasyonu ve `description` boş metin → NULL davranışı servis tarafında
  uygulanmalı ve test edilmelidir; DB check'i yalnızca btrim sonrası uzunluğu ve boşluklu
  değeri doğrular.
- **EX-04:** Start Run'da cihaz aktifliği, plan profiliyle uyum, arşivli cihaz reddi, cihaz
  satırı kilidi/TOCTOU, snapshot üretimi, `deviceId`/`deviceSnapshot` çiftinin servis
  tarafından doldurulması, `Prisma.DbNull` kullanımı, v1/v2 hash uyumu ve `/runs`
  filtreleri. DB yalnızca `deviceId`–snapshot `id` eşleşmesini, FK'yi ve çift null/oluş
  kuralını korur; profil uyumu ve aktiflik bilinçli olarak servis kuralıdır.
- **EX-06:** Published kaynak doğrulaması, idempotency anahtarı/request hash karşılaştırması,
  aynı kullanıcı/key için 200 replay, farklı istek için 409, eşzamanlı kaybeden transaction'ın
  orphan bırakmaması ve hedef planın atomik oluşturulması. DB yalnızca
  `(requestedById, idempotencyKey)` unique'liğini ve `Restrict` ilişkileri sağlar.
- **EX-08/EX-12:** `batchNumberKey` için filtre indeksi ve EXPLAIN kanıtı; gerçek seed'li
  kopya upgrade smoke kontrolü (M-1); yeni tabloların E2E cleanup/baseline kapsamı.
- **Lead:** OpenAPI/client üretimi, Device/Analytics/Reports modül bağlantıları, frontend
  route ve ekranları.

## Güvenlik ve veri koruma değerlendirmesi

- Kritik veya yüksek güvenlik/veri kaybı bulgusu yoktur.
- Migration additive: mevcut run/ölçüm/event/hash satırlarına değer yazılmıyor; yeni
  kolonlar nullable, yeni tablolar boş.
- `Device.deviceProfileId`, `Device.createdById`, `TestRun.deviceId`,
  `PlanCopyRequest.requestedById`, `sourceVersionId` ve `targetPlanId` ilişkileri
  `ON DELETE RESTRICT`; cihaz silme yerine arşivleme modeli veriyle tutarlı.
- Yeni run metadata alanları mevcut snapshot immutability trigger'ına eklenmiş; eski 16 alan
  korunmuş, dört yeni alan da dondurulmuş.
- Canonical seri anahtarı `(deviceProfileId, serialNumberKey)` ile unique; canonical parti
  anahtarı filtre için büyük harf; arşivli cihazın seri numarası yeniden kullanılamıyor.
- Testlerde gerçek secret/token yok; cleanup prefix ve rastgele UUID tabanlı.

## Reviewer tarafından çalıştırılan kontroller

Bu bölümdeki sonuçlar inceleme sırasında gerçekten çalıştırılan komutlardan alınmıştır.
Uygulama/API/browser testi değildir; tam unit/integration suite'i yeniden çalıştırılmadı.

| Kontrol                      | Komut / yöntem                                                                                                                                                       | Gerçek sonuç                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Çalışma ağacı ve HEAD        | `git status --short`; `git branch --show-current`; `git rev-parse HEAD`                                                                                              | Çıktı boş; branch `feat/analytics-reporting-devices`; HEAD `fe1e5fc0f5da02c7dc228c4dc2457d1a8574d1cf`.                                                                                          |
| Commit kapsamı               | `git show --stat --oneline HEAD`                                                                                                                                     | 9 dosya, `+1972/−19`; yalnız şema, migration, manifest, yeni test/helper ve doküman/kanıt dosyaları.                                                                                            |
| Whitespace                   | `git diff --check HEAD^ HEAD`                                                                                                                                        | Çıktı yok; exit 0.                                                                                                                                                                              |
| Eski/yeni trigger alanları   | Node script: iki migration'daki `probedesk_test_runs_snapshot_immutable` gövdelerinden `NEW."..." IS DISTINCT FROM OLD."..."` alanlarını çıkarma                     | Eski 16 alan, yeni 20 alan; **eksik 0**; eklenenler `deviceId`, `deviceSnapshot`, `batchNumber`, `batchNumberKey`.                                                                              |
| Manifest ↔ migration dizini  | Node script: `EXPECTED_MIGRATIONS` ↔ `prisma/migrations` dizinleri                                                                                                   | 9/9 tam eşleşme; yeni migration listede.                                                                                                                                                        |
| Prisma şema doğrulaması      | `./node_modules/.bin/prisma validate --schema apps/api/prisma/schema.prisma`                                                                                         | `The schema ... is valid`, exit 0.                                                                                                                                                              |
| Prisma ↔ migration kolonları | Node script: `Device`, `PlanCopyRequest` scalar alanları ve dört yeni `TestRun` kolonu                                                                               | Yeni modellerin bütün scalar alanları migration'da var; dört yeni run kolonu hem şemada hem `ADD COLUMN` listesinde.                                                                            |
| Biçim                        | `prettier --check` değişen test/helper/manifest/evidence/task dosyaları                                                                                              | Yeni test, helper, manifest, ex-02 evidence, EX-02 kartı ve task README temiz; `docs/roadmap.md` uyarı veriyor. Aynı uyarı parent commit'te de var; bu commit'in getirdiği bir regresyon değil. |
| Canonical `upper` ortamı     | Salt-okunur `SELECT current_database(), datcollate, datctype FROM pg_database WHERE datname = current_database()` ve `SELECT upper('i') = 'I'` (`TEST_DATABASE_URL`) | `probedesk_test`; `en_US.utf8` / `en_US.utf8`; `upper('i') = 'I'`. Test ortamında canonical anahtar davranışı beklenen ASCII sonucu veriyor.                                                    |
| Hedefli gerçek PG testi      | Yeni ve benzersiz `probedesk_ex02_review_1e485d5bbb1f_test` DB'si; `migrate-test-database.ts` + `vitest run test/feature-schema.e2e-spec.ts`                         | Migration 9/9 uygulandı; **Test Files 1 passed, Tests 13 passed**, exit 0; DB `DROP DATABASE ... WITH (FORCE)` ile silindi. Dev/delivery/shared/lead DB'sine yazılmadı.                         |
| Devralınan lead kontrolleri  | Lead kaydı (`docs/evidence/feature-pack-1/ex-02.md`)                                                                                                                 | API unit 118/118, integration 213/213, typecheck/lint exit 0. **Reviewer bu tam koşuları yeniden çalıştırmadı;** yalnızca lead kaydı olarak aktarılmıştır.                                      |

## Kabul önerisi

**EX-02 teknik olarak `Accepted` edilebilir; kritik veya yüksek bulgu yoktur.** Migration
additive, eski snapshot/ölçüm/event/hash korunuyor, yeni metadata immutability kapsamına
alınmış ve FK/unique/check davranışları gerçek PostgreSQL'de doğrulanmıştır. Reviewer'ın
hedefli koşusu 13/13 geçmiştir.

**EX-03 ve EX-06 için şema önkoşulları sağlanmıştır:** `Device` ve `PlanCopyRequest` tabloları,
`Restrict` ilişkiler, canonical unique anahtarlar, nullable run metadata, genişletilmiş
immutability trigger'ı ve readiness manifesti hazırdır.

Kabul için önerilen koşullar:

1. **M-1** için teslim öncesi gerçek seed'li kopya upgrade smoke kontrolü planlanmalı; EX-02
   kabulünü şema tasarımı açısından engellemez, ancak plan §4.4.5 kanıtı tamamlanmalıdır.
2. **L-1** EX-04 kabul notuna eklenmeli: cihazsız run'da `Prisma.DbNull`, JSON null değil.
3. **L-2** isteğe bağlı temizlik olarak takip edilebilir; kabulü engellemez.
4. Lead, bu inceleme kaydını `docs/tasks/EX-02.md` ve gerekli durum/kanıt alanlarına
   bağlamalı; `Accepted` kararını ayrı olarak kendisi vermelidir.

Bu belge ürün kabulü değildir. Kullanıcı görsel/ürün kabulü ayrıca kullanıcıya aittir ve
verilmiş sayılmaz. İnceleme sırasında hiçbir görev kartı durumu değiştirilmedi.
