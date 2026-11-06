# EX-01 — Bağımsız inceleme (paket sözleşmeleri ve görev izlenebilirliği)

- Tarih: 2026-11-06
- İnceleme commit'i: `c169654` (`docs: define feature pack contracts and execution tasks`)
- Branch: `feat/analytics-reporting-devices` (`origin/feat/analytics-reporting-devices` ile aynı)
- İnceleme türü: **Bağımsız doküman/sözleşme incelemesi.** Bu belge ürün kabulü, kullanıcı kabulü
  veya yayın kararı değildir.
- Kapsam: Yalnız `c169654` içindeki doküman değişiklikleri. Kod/migration/DB/tarayıcı
  davranışı değişikliği yok; mevcut API/veri sözleşmeleriyle karşılaştırma için salt-okunur
  kod okuması yapıldı.
- Kısıt: İnceleme sırasında yalnızca bu dosya yazıldı. `git add/commit/push/checkout/reset/stash`
  çalıştırılmadı; hiçbir görev kartının durumu değiştirilmedi. Subagent başlatılmadı.
- Uygulama testi iddiası yoktur: EX-01 doküman görevi olduğu için API/web/DB/browser testi
  çalıştırılmadı. Planın 11. bölümündeki gerçek kontroller EX-02 ve sonrasında yürütülmelidir.

## Sonuç özeti

| Alan                                 | Sonuç                                                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kart sayısı ve durumlar              | **85 kart** doğrulandı: 62 P + 10 UI + 13 EX. EX-01 `In Review`, EX-02–EX-13 `Planned`; kart ve görev dizini durumları tutarlı. Eski kart satırları değişmemiş (diff yalnızca ekleme).                                                           |
| Bağlantılar                          | Değişen 29 dokümanda **362 relative link**, 0 kırık. 13 EX kartında **31 relative link** (14 farklı hedef), 0 kırık.                                                                                                                             |
| Sözleşme aktarımı                    | **Eksik.** İzin matrisi tablo olarak, REQ-28–31 kayıtları, kabul kutuları ve test kontrolleri ana sözleşme tablolarına aktarılmamış (H-1). Diğer özet tabloları da eski (M-1).                                                                   |
| 13 kartın kapsam/bağımlılık kontrolü | Kartların zorunlu bölümleri tam; bağımlılıkların çoğu planla aynı. EX-05 ve EX-13 plan önkoşullarını eksik yazıyor (M-3, L-1).                                                                                                                   |
| Güvenlik / veri koruma               | **Kritik/Yüksek güvenlik veya veri kaybı bulgusu yok.** Additive migration, Restrict FK, snapshot immutability, CSV formül enjeksiyonu ve hassas alan dışlama sözleşmede açıkça ele alınmış. Küçük batch anahtar tutarlılığı açıklığı var (L-2). |
| Biçim/kanıt doğruluğu                | Yeni plan ve kartlar Prettier ile uyumlu; değişen `docs/tasks/README.md` uyumlu değil. Kanıttaki 30 link sayısı 31 olarak sayıldı (L-3).                                                                                                         |
| Öneri                                | **EX-01 bu haliyle `Accepted` edilmemeli.** H-1 kapatılmalı; M-1–M-5 düzeltilmeli veya gerekçeli takip kaydına bağlanmalı; sonra yeni bağımsız inceleme yapılmalı.                                                                               |

## Bulgular

### H-1 — Yüksek: İzin matrisi tablo olarak, REQ-28–31 kayıtları ve kabul/test izlenebilirliği ana sözleşmelere aktarılmamış

Plan, bu aktarımı EX-01'in işi olarak açıkça tanımlıyor:

- `docs/feature-pack-1-plan.md:49`: “Bu matris yeni davranışların tasarım önerisidir;
  **EX-01'de ana sözleşmelere aktarılır**.”
- `docs/feature-pack-1-plan.md:282`: EX-01'in çıktısı “requirements/API/model/frontend/testing
  sözleşmelerine aktarma; kartlar ve izin matrisi”.

Buna karşılık birincil kayıtlar hâlâ eski paketi anlatıyor:

- `docs/requirements.md:15-23` rol tablosu yalnız eski plan/run/compare işlemlerini içeriyor.
  Cihaz oluşturma/düzenleme/arşivleme, plan kopyalama ve cihazlı Start Run satırları yok.
  `docs/requirements.md:83` bunları yalnızca üç cümlelik prose olarak özetliyor; planın 3.
  bölümündeki matris tablo olarak aktarılmamış.
- `docs/requirements.md:29-57` “Gereksinim kaydı” tablosu **REQ-01–REQ-27** ile bitiyor.
  REQ-28–31 yalnız `:83` satırında anılıyor; “Ana görevler” ve “Kontroller” kolonları yok.
  Oysa 13 EX kartının tamamı `Gereksinimler: REQ-28–31` diyor (`docs/tasks/EX-01.md:7` vb.).
- `docs/acceptance.md:12-28` ürün kabul listesi REQ-21–22'de bitiyor; REQ-28–31 için kutu yok.
  `:77` “Yeni kabul maddeleri REQ-28–31 ve EX-01–13 kartlarıdır” diyor, fakat checklist'e
  eklenmemiş.
- `docs/testing.md:7` başlığı hâlâ “Gereksinimler: REQ-23–27”; `:33-62` test matrisi
  **T01–T28** ile bitiyor. `:170` yeni kontrollerin zorunlu olduğunu söylüyor, ancak yeni T
  kimlikleri veya REQ-28–31 → kontrol eşlemesi yok.

**Etki:** Görev izlenebilirliği tek yönlü kalmış durumda: kartlar REQ-28–31'e atıf yapıyor,
fakat bu gereksinimlerin resmî kaydı, kabul kutuları ve test kontrolleri ana sözleşmede yok.
EX-01 kabul ölçütü 1'deki “yetkiler açık” yalnız prose özetine dayanıyor; birincil rol tablosu
ve gereksinim kaydı yeni yetkileri göstermiyor. Görev adındaki “görev izlenebilirliği” de
birincil tablolardan doğrulanamıyor. Plan §14'teki “EX-01 başlatıldı” kaydı bu eksiği
kapatmıyor.

**Öneri:** `requirements.md` rol tablosuna yeni satırları ekle; REQ-28–31 için “Ana görevler”
ve “Kontroller” (T kimlikleri veya plan §11 kontrol adları) içeren kayıtlar ekle. Örnek eşleme:
REQ-28 → EX-08/09/12; REQ-29 → EX-10/11/12; REQ-30 → EX-02–05/12; REQ-31 → EX-02/06/07/12.
`acceptance.md` ürün listesine dört kutu ekle; `testing.md` matrisine yeni T kimliklerini veya
açık bir REQ → plan §11 eşlemesini ekle. Düzeltme sonrası yeni bağımsız inceleme gerekir.

### M-1 — Orta: Veri modeli/API/frontend/mimari özet tabloları eski kalmış

Yeni bölümler eklenmiş, ancak `docs/README.md:23-38` tarafından “birincil kaynak” olarak
tanımlanan özet tablolar güncellenmemiş:

- `docs/data-model.md:15-27` “Modeller” tablosunda `Device` ve `PlanCopyRequest` yok; `TestRun`
  satırında `deviceId`, `deviceSnapshot`, `batchNumber`, `batchNumberKey` yok. Yeni alanlar
  yalnız `:97` paragrafında anılıyor.
- `docs/api.md:19-42` HTTP uçları tablosunda `/devices`, `/analytics/overview`,
  `/plan-versions/:id/copy`, `/runs/:id/report` ve `/runs/:id/export` yok; `:89-102` hata
  tablosunda `DEVICE_SERIAL_CONFLICT`, `DEVICE_CONFLICT`, `DEVICE_ARCHIVED`,
  `DEVICE_PROFILE_MISMATCH` yok. Yeni uçlar yalnız `:137` paragrafında özetleniyor.
- `docs/frontend.md:19-29` route tablosunda `/overview`, `/devices`, `/devices/:deviceId`,
  `/runs/:runId/report` yok; yeni route'lar yalnız `:108` paragrafında anılıyor.
- `docs/architecture.md:30-41` backend modül tablosunda `Devices`, `Analytics`, `Reports` yok;
  yeni modüller yalnız `:147` paragrafında anılıyor.

**Etki:** Tablolar hâlâ paket öncesi yüzeyi anlatıyor. Yeni paragraflar plana bağlandığı için
doğrudan çelişki değil; ancak hızlı başvuru veya tablo üzerinden çalışan bir uygulayıcı yeni
modeli/uçları/route'ları kaçırabilir. Özellikle `docs/README.md` bu dosyaları “birincil kaynak”
olarak tanımladığı için tablo ile paragraf arasındaki boşluk sözleşme kalitesini düşürüyor.

**Öneri:** İlgili tablolara yeni satırları ekle veya tablonun hemen altına “bu tablo aşağıdaki
Özellik paketi 1 bölümüyle genişletilir” şeklinde görünür bir not koy. Tam ayrıntıyı plana
bırakmak yeterlidir; en azından tablo okuyucusu yeni yüzeyi fark etmelidir.

### M-2 — Orta: Görev dizini “dört özellik paketinin” diyerek kapsamı belirsizleştiriyor

`docs/tasks/README.md:150`: “Kullanıcı **dört özellik paketinin** uygulanmasını yetkilendirdi.”

Bu ifade aynı commit'teki diğer kayıtlarla çelişiyor:

- `docs/feature-pack-1-plan.md:5`: “Seçilen paket: analiz dashboard'u, dışa aktarma/rapor,
  cihaz-seri numarası takibi ve plan kopyalama.” Yani tek paket içinde dört özellik var.
- `docs/README.md:69`: “analiz/raporlama/cihaz/kopyalama paketinin uygulanmasını yetkilendirdi.”
- `docs/feature-pack-1-plan.md:354`: “Dört özellik gerçek UI/API üzerinden birlikte çalışır.”

**Etki:** “Dört özellik paketi” okuması, yetkilendirilmiş kapsamın dört ayrı paket olduğu
izlenimini verebilir ve sessiz kapsam genişlemesine zemin hazırlar. Muhtemelen “dört özelliğin”
yazılmalıydı; yine de sözleşme metni düzeltilmelidir.

**Öneri:** İfadeyi “Kullanıcı özellik paketi 1'in (dört özellik) uygulanmasını yetkilendirdi”
veya “dört özelliğin” olarak düzelt.

### M-3 — Orta: EX-13 bağımlılığı “kart bazlı incelemeler”i içermiyor

- `docs/tasks/EX-13.md:5`: `Bağımlılıklar: EX-12`
- `docs/feature-pack-1-plan.md:294`: EX-13 önkoşulu **“EX-12 ve kart bazlı incelemeler”**.
- `docs/tasks/EX-13.md:16`: kabul ölçütü “Her kart ayrı inceleme kaydına sahip; kritik/yüksek
  bulgu yok.”

**Etki:** Kart yalnız EX-12'yi beklediği için EX-13, kart bazlı incelemeler tamamlanmadan
başlatılabilir; ilk kabul ölçütü ancak sonradan sağlanır. Bu, planın açık önkoşuluyla çelişir
ve entegre incelemenin erken başlamasına yol açar.

**Öneri:** Bağımlılık satırına “EX-12 ve EX-01–EX-12 kart bazlı inceleme kayıtları” ekle veya
EX-13'ün kapanışının bu kayıtlara bağlı olduğunu kabul ölçütünde açıkça yaz.

### M-4 — Orta: Analytics “en sık başarısız adımlar” yanıtı drilldown için kalıcı kimlikleri içermiyor

Plan §6, satır alanlarını şöyle sayıyor:

- `docs/feature-pack-1-plan.md:169`: gruplama anahtarı `planId + planVersionId +
logicalStepId + unit`; satırda “snapshot plan/adım adı, sürüm, birim, completedStepRuns,
  failedStepRuns ve backend failureRatePercent” olur.
- `docs/feature-pack-1-plan.md:171`: “satır ilgili plan/sürümün Failed run listesine gider.”

Satır alanlarında `planId`, `planVersionId` ve `logicalStepId` açıkça yok. Drilldown'ın mevcut
`/runs` filtresiyle (`planId`, `planVersionId`, `outcome=FAILED`) kurulabilmesi için bu
kimlikler yanıtta bulunmalıdır; plan adı + sürüm numarası benzersiz değildir ve plan yeniden
adlandırılabilir.

**Etki:** EX-09'un “doğru history drilldown” kabulü, API yanıtı bu kimlikleri içermezse
güvenilir biçimde uygulanamaz. Bu bir alan eksikliği; grouping anahtarı zaten kimlikleri
kullandığı için düzeltmesi kolaydır.

**Öneri:** Yanıt satırına `planId`, `planVersionId`, `logicalStepId` (ve varsa sabit
`unit`) ekle; API testinde bu kimliklerle üretilen history URL'sini doğrula.

### M-5 — Orta: `failureRatePercent` için tip/ondalık/rounding tanımı yok

Plan KPI tablosunda iki oran için açık kural var:

- `docs/feature-pack-1-plan.md:162`: `passRatePercent` → 2 hane half-up ondalık metin,
  `completed=0` ise null.
- `docs/feature-pack-1-plan.md:163`: `averageDurationMs` → 3 hane half-up ondalık metin,
  örnek yoksa null.
- `docs/feature-pack-1-plan.md:169`: yalnızca “backend failureRatePercent” deniyor; tip,
  ondalık hane, half-up yönü ve `completedStepRuns=0` durumu tanımlı değil.

**Etki:** API, UI ve testler aynı oranı farklı biçimde (number/string, 1/2/3 hane, null/0)
üretebilir. Analytics kabul testlerinde beklenen değer tartışmalı olur.

**Öneri:** `failureRatePercent` için `passRatePercent` ile aynı sözleşmeyi (decimal string,
2 hane half-up, payda 0 ise null) veya bilinçli seçilen farklı kuralı açıkça yaz.

### L-1 — Düşük: EX-05 bağımlılığı “üretilen tipler”i içermiyor

- `docs/tasks/EX-05.md:5`: yalnız `EX-03`, `EX-04`.
- `docs/feature-pack-1-plan.md:286`: önkoşul “EX-03/04 API sözleşmesi **ve üretilen tipler**”.

EX-05 Lead sahipliğinde olduğu ve OpenAPI/client üretimi de Lead'de olduğu için pratik etkisi
düşük; ancak kart, UI'nin generated tipler hazır olmadan başlayabileceği izlenimini veriyor.

**Öneri:** Bağımlılık satırına “EX-03/04 sözleşmesi ve üretilen API tipleri” notu ekle.

### L-2 — Düşük: Açıklığa kavuşturulması gereken sözleşme ayrıntıları

Aşağıdakiler EX-01 kabulünü tek başına engellemez; EX-02/03/06/10 uygulanmadan önce
netleştirilmelidir:

- `batchNumber` / `batchNumberKey` çiftinin birlikte null veya birlikte dolu olması açıkça
  DB/servis korumasına bağlanmamış (`docs/feature-pack-1-plan.md:82-83`). `deviceId` /
  `deviceSnapshot` için bu tutarlılık açıkça istenmiş (`:87`); batch çifti için eşdeğer bir
  cümle yok.
- `GET /devices` için varsayılan `state` değeri belirtilmemiş (`:76`, `:110`).
- Arşivli cihazı yeniden arşivleme veya aktif cihazı yeniden açma davranışı (idempotent 200 / 409) belirtilmemiş (`:114-115`).
- Plan kopyalamada hedef adın doğrulaması (trim/1–100) ve yayımlanmamış kaynak sürüm için
  dönüş kodu (404/409) belirtilmemiş (`:136-142`).
- CSV'de `isWithinTolerance` alanının `true/false`, `1/0` veya başka bir temsille yazılacağı
  belirtilmemiş (`:184`).
- `GET /runs?deviceId=<bilinmeyen>` için 404 mi boş liste mi döneceği belirtilmemiş; genel
  “bilinmeyen UUID 404” kuralı (`:123`) filtre parametreleri için de geçerli mi açık değil.

**Öneri:** İlgili kartların kabul ölçütlerine veya planın 4–7. bölümlerine kısa netleştirmeler
ekle. Özellikle batch çifti için DB check veya servis invariant'ı yazılmalı.

### L-3 — Düşük: Kanıt/format doğruluğu

- `./node_modules/.bin/prettier --check` yeni plan, EX kartları ve evidence üzerinde geçiyor;
  ancak değişen `docs/tasks/README.md` uyarı veriyor. Bu dosyanın parent hali Prettier-clean
  idi; commit sonrası dosya Prettier-clean değil. Kanıttaki “Yeni plan/kartlar Prettier ile
  biçimlendirildi” ifadesi plan/kartlar için doğru, task index için eksik.
- `docs/evidence/feature-pack-1/ex-01.md:10` “30 valid relative links” diyor. Bağımsız
  sayımım 13 EX kartında **31 relative link** (14 farklı hedef) buldu; 0 kırık. Fark, sayım
  yönteminden (örneğin evidence linkinin hariç tutulması) kaynaklanabilir; yine de kanıtta
  kullanılan script/komut ve tam sayım kaydı yok.
- `docs/README.md:6` “Son güncelleme: 2026-11-04” diyor; aynı dosyada 2026-11-06 tarihli yeni
  bölüm var.

**Etki:** İşlevsel değil; kanıt ve biçim hijyeni. EX-01 kabulünü tek başına engellemez.

**Öneri:** Task index'i Prettier ile uyumlu hale getir (eski tabloların yeniden biçimlenmesi
kabul edilecekse) veya bu dosyanın neden kapsam dışı olduğunu kanıta yaz; link sayısını gerçek
komut çıktısıyla güncelle; README tarihini 2026-11-06 yap.

## Güvenlik ve veri koruma değerlendirmesi

Kritik veya yüksek güvenlik/veri kaybı bulgusu yoktur. Planın şu korumaları olumlu ve açıktır:

- Additive migration; eski run/ölçüm/event/hash içeriği değişmiyor
  (`docs/feature-pack-1-plan.md:97-101`).
- `Device.deviceProfileId` ve `TestRun.deviceId` için `Restrict`; cihaz silme yok
  (`:67`, `:72`, `:80`).
- Cihaz yeniden adlandırılsa bile eski run snapshot'ı korunuyor; `deviceId` ile snapshot
  tutarlılığı DB/servis korumasına bağlanmış (`:81`, `:87`).
- Yeni metadata alanları mevcut run immutability kapsamına alınıyor (`:98`).
- Plan kopyalama kaynağı değiştirmiyor; kaynak geçmişi/run'ları kopyalanmıyor (`:138`).
- Rapor `requestedBy` için yalnız public kullanıcı özeti kullanıyor; session, CSRF,
  passwordHash, requestHash, idempotencyKey ve iç event payload'ları dışlanıyor (`:179`).
- CSV'de UTF-8 BOM, RFC 4180 quoting, formül enjeksiyonu koruması ve resmi negatif decimal
  değerlerin korunması tanımlı (`:183-187`).
- Export'ta public/geçici download link'i yok; dosya adı yalnız run UUID'sinden üretiliyor
  (`:193-194`).
- Cihaz aramasında parametreli sorgu, literal SQL wildcard ve 100 karakter sınırı var (`:76`).
- Roller ve CSRF/origin koruması yeni mutasyonlar için korunuyor (`:59`, `:212`).

Tek küçük veri tutarlılığı açığı `batchNumber`/`batchNumberKey` çiftidir (L-2). Bu, ölçüm
sonucunu bozmaz; ancak filtrelerin tutarlılığı için servis invariant'ı veya DB check olarak
açıkça yazılmalıdır.

## Doğrulanan gerçek kontroller

Bu bölümdeki sonuçlar inceleme sırasında gerçekten çalıştırılan salt-okunur komutlardan
alınmıştır. Uygulama/API/DB/browser testi değildir.

| Kontrol                            | Komut                                                                                                                                            | Gerçek sonuç                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Çalışma ağacı ve branch            | `git status --short`; `git branch --show-current`                                                                                                | Çıktı boş; branch `feat/analytics-reporting-devices`; HEAD `c169654`.                                                                                                                                                                                                         |
| Commit kapsamı                     | `git show --stat --oneline c169654`                                                                                                              | 29 dosya, +481/−6; tamamı `docs/` altında.                                                                                                                                                                                                                                    |
| Yalnız doküman kontrolü            | `git show --format= --name-only c169654 \| grep -v '^docs/'`                                                                                     | Çıktı yok; kod/DB/config değişikliği yok.                                                                                                                                                                                                                                     |
| Whitespace                         | `git diff --check c169654^ c169654`                                                                                                              | Çıktı yok; exit 0.                                                                                                                                                                                                                                                            |
| Link kontrolü                      | Node script: değişen 29 dokümandaki relative Markdown linkleri                                                                                   | `checked 362 relative links in 29 files; broken=0`.                                                                                                                                                                                                                           |
| EX kart/bağlantı kontrolü          | Node script: 13 `EX-*.md` kartı                                                                                                                  | 13 kart; 31 relative link, 14 farklı hedef, 0 kırık; zorunlu bölümlerin tamamı mevcut.                                                                                                                                                                                        |
| Kart sayısı/durum                  | Node script: `docs/tasks/README.md` tablo satırları                                                                                              | 85 kart: 62 P + 10 UI + 13 EX; EX-01 `In Review`, diğer 12 EX `Planned`; kart durumları dizinle aynı.                                                                                                                                                                         |
| Bağımlılık karşılaştırması         | Node script: kart `Bağımlılıklar` satırı ↔ plan §10 tablosu                                                                                      | EX-05 ve EX-13 plan önkoşullarından eksik; diğer 11 kart eşleşiyor.                                                                                                                                                                                                           |
| İzlenebilirlik                     | Node script: requirements/API/data-model/frontend/acceptance/testing tabloları                                                                   | Requirements kaydı 27 satır (son REQ-27); REQ-28–31 tabloda yok. API tablosu 21 satır; yeni uçlar yok. Data model 17 satır; `Device`/`PlanCopyRequest` yok. Frontend route tablosunda yeni route yok. Acceptance checklist'te REQ-28–31 yok. Test matrisi 28 satır (T01–T28). |
| Prettier (değişen dokümanlar)      | `./node_modules/.bin/prettier --check <29 değişen doküman>`                                                                                      | exit 1; 14 dosya uyarı. Yeni plan/kartlar temiz; `docs/tasks/README.md` uyarı veriyor. Eski sözleşmelerin commit öncesi durumu ayrıca doğrulanmadı.                                                                                                                           |
| Prettier (yeni plan/kart/evidence) | `./node_modules/.bin/prettier --check docs/feature-pack-1-plan.md docs/evidence/feature-pack-1/ex-01.md docs/tasks/README.md docs/tasks/EX-*.md` | Plan, 13 kart ve evidence temiz; yalnız `docs/tasks/README.md` uyarı veriyor.                                                                                                                                                                                                 |
| Uygulama testleri                  | —                                                                                                                                                | **Çalıştırılmadı.** EX-01 doküman görevi; API/web/DB/browser testi bu incelemede yok ve çalıştırılmış gibi iddia edilmiyor.                                                                                                                                                   |

## Kabul önerisi

**EX-01 bu haliyle `Accepted` edilmemelidir.**

Gerekçe: H-1 doğrudan EX-01'in çıktısı olan izin matrisi, gereksinim kaydı, kabul listesi ve
test izlenebilirliğini eksik bırakıyor. 13 kartın tamamı REQ-28–31'e atıf yaparken bu
gereksinimlerin resmî kaydı ve kabul kutuları yok; bu durumda “görev izlenebilirliği” ve
“yetkiler açık” kabul ölçütleri kanıtlanamaz.

Kabul için minimum koşullar:

1. H-1 kapatılmalı: rol matrisi + REQ-28–31 kayıtları + acceptance kutuları + test
   kontrolleri ana sözleşmelere eklenmeli.
2. M-1–M-5 düzeltilmeli veya gerekçeli, sahipli ve tarihli bir takip kaydına bağlanmalı.
3. L-1–L-3 düzeltilmeli; en azından kanıt/format notları gerçek çıktıyla uyumlu hale
   getirilmeli.
4. Düzeltme sonrası **yeni bir bağımsız inceleme** yapılmalı; aynı inceleme kaydıyla
   `Accepted` verilmemeli.

Bu belge ürün kabulü değildir. Kullanıcı görsel/ürün kabulü ayrıca kullanıcıya aittir ve
verilmiş sayılmaz. İnceleme sırasında hiçbir görev kartı durumu değiştirilmedi.
