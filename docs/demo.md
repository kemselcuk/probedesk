# Hazır veriler ve demo

Görevler: [P8-02](tasks/P8-02.md), [P8-03](tasks/P8-03.md). Durum:
**Hazır örnek veriler ve fixture'lar gerçek seed koduyla üretildi ve doğrulandı; demo videosu
kullanıcı kararıyla kapsam dışıdır.** Bu belge ürün
kabulü değildir; kullanıcı nihai kabulü [acceptance.md](acceptance.md) içinde ayrıca bekleniyor.

## Doğrulanmış demo ortamı

- Delivery profili, boş `probedesk_delivery_check` veritabanında `migrate → seed → api → web`
  zinciriyle açıldı; sonuç: `3` kullanıcı, `1` profil, `1` plan, `2` yayımlanmış sürüm ve `4`
  çalıştırma ([temiz kurulum kanıtı](evidence/phase-8-clean-install.md)).
- Aynı stack `down` + `up` sonrasında planları ve run geçmişini korudu; FAILED run `90/90` örnekle
  `COMPLETED/FAILED` kaldı.
- Yerel geliştirme veritabanında P8-02 öncesinden kalan aynı adlı planlar bulunabilir. Seed mevcut
  planı ezmez; bu nedenle temiz bir demo için delivery veritabanı veya korumalı demo reset
  kullanılmalıdır. Normal `demo:seed` ve `verify` komutları reset içermez.
- Demo yalnızca yerel kullanım içindir. Aşağıdaki parolalar gerçek bir secret değildir; seed
  `NODE_ENV=production` ile çalışmayı reddeder.

## Demo hesapları

| Rol      | E-posta                    | Parola              |
| -------- | -------------------------- | ------------------- |
| Planner  | `planner@probedesk.local`  | `PlannerDemo!2026`  |
| Operator | `operator@probedesk.local` | `OperatorDemo!2026` |
| Viewer   | `viewer@probedesk.local`   | `ViewerDemo!2026`   |

## Plan ve yayımlanmış sürümler

Profil: `DC Power Module` (`DC_POWER_MODULE`). Plan: `Power Supply Validation`.

| Sürüm | Durum     | Adımlar                                                                         | Current Draw aralığı    |
| ----- | --------- | ------------------------------------------------------------------------------- | ----------------------- |
| v1    | PUBLISHED | Output Voltage 4.75–5.25 V; Current Draw 0.45–0.55 A; Case Temperature 20–60 °C | `0.450000 – 0.550000 A` |
| v2    | PUBLISHED | v1 ile aynı üç adım ve aynı `logicalStepId` değerleri                           | `0.450000 – 0.650000 A` |

Her adım 30 örnek ve 200 ms örnekleme aralığı kullanır; bir çalıştırmada 90 örnek beklenir. v2
yalnızca Current Draw üst sınırını değiştirir; yayımlanmış v1 ve geçmiş run snapshot'ları
değişmez.

## Hazır çalıştırmalar

Değerler, sayaçlar, istatistikler ve sonuçlar üretimdeki simülatör ve değerlendirici koduyla
hesaplanır; seed veritabanına sabit `PASSED`/`FAILED` etiketi yazmaz.

| Fixture              | Sürüm | Senaryo / seed      | Durum     | Sonuç  | Beklenen / kaydedilen | Son olay |
| -------------------- | ----- | ------------------- | --------- | ------ | --------------------- | -------- |
| Partial cancelled v1 | v1    | NORMAL / 42         | CANCELLED | —      | 90 / 45               | 50       |
| Forced failure v1    | v1    | FORCED_FAILURE / 42 | COMPLETED | FAILED | 90 / 90               | 98       |
| Normal v1            | v1    | NORMAL / 42         | COMPLETED | PASSED | 90 / 90               | 98       |
| Normal v2            | v2    | NORMAL / 42         | COMPLETED | PASSED | 90 / 90               | 98       |

Gerçek run kimlikleri ortama göre değişir; doğrulanan yerel kimlikler
[phase-8-seed.md](evidence/phase-8-seed.md) içinde kayıtlıdır. Demo adımlarında kimlik yerine run
başlığı, sürüm, senaryo ve sonuç kullanılır.

### Forced failure ayrıntısı

- Current Draw adımında sıfır tabanlı `sampleIndex=14` (kullanıcıya göre 15. örnek) değeri
  `0.600000 A` olur.
- v1 üst sınırı `0.550000 A` olduğu için ölçüm tolerans dışıdır:
  `isWithinTolerance=false`, `outOfToleranceCount=1`, `firstFailureSampleIndex=14`, adım sonucu
  `FAILED`.
- Aynı `0.600000 A` değeri v2'nin `0.650000 A` sınırı içindedir. v2 NORMAL run'ında Current Draw
  örneklerinin 14 tanesi v1'in `0.550000 A` sınırını aşar; v2'de tamamı tolerans içindedir.
- Hata sonrasında Case Temperature adımı çalışmaya devam eder; run bütün adımlar tamamlandıktan
  sonra `COMPLETED/FAILED` olur.

### Kısmi çalıştırma ayrıntısı

Output Voltage `30/30` tamamlanır; Current Draw `15/30` örnekte `CANCELLED` olur; Case Temperature
`NOT_RUN` kalır. Kısmi adımın istatistikleri `null` kalır, tamamlanmış adımın istatistikleri
korunur. Kullanıcıya görünen adım durumları `Completed`, `Cancelled` ve `Not run` olur.

## Ana demo

Önerilen akış, delivery profili (`http://127.0.0.1:8080`) ve temiz demo veritabanı içindir. Her
adım gerçek UI üzerinden yapılır; test/seed sonucu doğrudan yazılmaz.

| Adım | Kullanıcı işlemi                                                                                                                          | Görünmesi gereken sonuç                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Planner ile giriş yap; **Test Plans** ekranını aç                                                                                         | `Power Supply Validation` planı; yayımlanmış v1 ve v2                                                                                              |
| 2    | Plan sürüm listesinden **Version 1**'i aç                                                                                                 | Salt okunur v1: üç adım, 30 örnek, 200 ms, toplam 90 örnek; `Current Draw` maksimumu `0.550000 A`                                                  |
| 3    | Operator ile giriş yap; v1 sürüm sayfasından **Start run** seç                                                                            | Start Run ekranı; `FORCED_FAILURE`, seed `42`, failing step `Current Draw`                                                                         |
| 4    | **Start run** ile çalıştırmayı başlat; **Live Run** ekranını izle                                                                         | Önce `Running`, canlı örnekler ve `Connection: Connected`; run `FAILED` olarak tamamlanır, `90/90` örnek kaydedilir                                |
| 5    | Current Draw adımındaki hatayı ve **View run details** bağlantısını incele                                                                | İlk hata `Sample index 14`; değer `0.600000 A`; adım `Completed`/`Failed`, ihlal sayısı `1`; Case Temperature `Completed`/`Passed`                 |
| 6    | Run Details grafiğinde hata noktasını seç; tooltip ve ölçüm satırını kontrol et                                                           | Grafikte tolerans dışı işaret; tooltip `0.600000`; tabloda aynı satır `Outside tolerance` ve seçili                                                |
| 7    | **Run History** ekranında planı `Power Supply Validation` olarak filtrele; forced-failure v1 ve normal v1 run'larını seçip **Compare** et | `Version 1` vs `Version 1`; sonuçlar `Failed`/`Passed`; ihlal `1`/`0`; ilk hata `Sample index 14`/`None recorded`; 3 ortak adım, değişen kural yok |
| 8    | Aynı ekranda v1 FAILED ile v2 PASSED run'larını karşılaştır                                                                               | Farklı sürüm notu; tek değişen kural Current Draw maksimumu `0.550000 → 0.650000`; v1 run'ının kayıtlı kuralı hâlâ `0.550000`                      |
| 9    | Run History'den partial cancelled v1 run'ını aç                                                                                           | `CANCELLED`; `90` beklenen / `45` kaydedilen örnek; adım durumları `Completed`, `Cancelled`, `Not run`                                             |
| 10   | Viewer ile giriş yap; Test Plans ve Run History'yi aç                                                                                     | Salt okunur görünüm; run başlatma/iptal düğmeleri yok; doğrudan mutasyon API tarafından reddedilir                                                 |

Adım 7 ve 8 için Run History'deki **Compare** seçimi iki terminal run ister. Sürüm farkı
karşılaştırması için v2 run'ı seed ile hazırdır; yalnızca v2 yayımlamak yeni bir run oluşturmaz.

## Kalıcılık ve yeniden başlatma

Delivery stack'i kapatıp açmak planları ve run geçmişini korur:

```bash
docker compose --profile delivery down
docker compose --profile delivery up -d
```

`down` named volume'ü (`probedesk-postgres-data`) silmez. `down -v` volume'ü siler ve yalnızca
bilinçli bir yerel sıfırlama için kullanılmalıdır; normal demo veya seed akışının parçası değildir.
Doğrulanan gerçek sonuç: `down`/`up` sonrası `plans=1`, `runs=4`, `users=3` ve FAILED run
`COMPLETED/FAILED`, `90/90` kaldı ([kanıt](evidence/phase-8-clean-install.md)).

## Seed davranışı

`npm run demo:seed` idempotent ve eklemelidir:

1. Demo idempotency anahtarına sahip planı, yoksa aynı Planner + `Power Supply Validation` adı +
   birebir v1/v2 kurallarıyla eşleşen tek planı bulur.
2. Eşleşen planda yalnızca eksik run'ları ekler; mevcut published sürümü, run'ı, ölçümü veya olayı
   güncellemez/silmez.
3. Birden fazla aday varsa tahmin yürütmez; açık bir çakışma hatasıyla durur.

Gerçek idempotence çıktısı ve tablo özetleri
[phase-8-seed.md](evidence/phase-8-seed.md) içindedir. Yıkıcı demo reset ayrı ve korumalı bir
script'tir; normal seed, `verify` veya delivery başlangıcı tarafından çalıştırılmaz.

## Demo videosu

P8-05 kapsamındaki video **kullanıcı kararıyla kapsam dışı bırakılmıştır**;
dosya ve bağlantı yoktur. Bu, ürünün çalışan demosunun veya diğer kanıtların yerine
geçmez.

## Kanıt bağlantıları

- [Hazır örnek veri kanıtı](evidence/phase-8-seed.md) — hesaplar, plan/sürümler, dört run, tam
  hata indeksi ve idempotence.
- [Temiz kurulum ve kalıcılık](evidence/phase-8-clean-install.md) — boş DB, migration, seed ve
  restart.
- [Compose teslimi](evidence/phase-8-compose.md) — proxy, health, SSE, deep link ve tek API
  süreci.
- [Ana demo E2E](evidence/phase-7-e2e.md) — gerçek UI akışı ve ekran görüntüleri.
- [Erişilebilirlik ve hata deneyimi](evidence/phase-7-accessibility.md) — klavye, odak, 1280/768
  yerleşim.
- [Yetki ve istek güvenliği](evidence/phase-7-security-race.md) — rol matrisi; Viewer/Planner
  mutasyonlarının API tarafından reddi.

## Özellik paketi 1 — yetkilendirilen ek sözleşme (2026-11-06)

Eklemeli seed aynı `DC Power Module` profiline iki aktif cihaz ekler:

| Cihaz                | Seri numarası |
| -------------------- | ------------- |
| Bench Power Module A | PSU-DEMO-0001 |
| Bench Power Module B | PSU-DEMO-0002 |

Eski dört demo run cihazlara sonradan bağlanmaz; cihaz/parti alanları null kalır.
Tekrar seed mevcut kayıtları ve kullanıcı düzenlemelerini korur.

1. Planner Devices ekranından cihaz oluşturur veya hazır aktif cihazı kullanır;
   yayımlanmış planı bağımsız draft'a kopyalar, düzenler ve yayımlar.
2. Operator bu sürümü uyumlu aktif cihaz ve parti numarasıyla başlatır. Run sonrası
   cihaz yeniden adlandırılsa da Details/Report kayıtlı ad/seri snapshot'ını gösterir.
3. Viewer Overview filtreleri ve KPI bağlantılarıyla ilgili History kayıtlarına gider;
   terminal run raporunu açar, CSV/JSON indirir, Print / Save PDF kullanır.
4. Legacy raporda “No device recorded” / “No batch recorded” görünür; eksik ölçümler
   üretilmez. Ham ölçümlerin tamamı CSV/JSON içindedir.

[Gerçek izole Chrome koşusu](evidence/feature-pack-1/ex-12.md) bu zinciri doğruladı.
[Yedekli 8080 rollout](evidence/feature-pack-1/ex-13-delivery.md) mevcut45run,
3136ölçüm ve3462event'i korudu; Viewer dashboard/device/report/indirme smoke geçti.
A4 PDF'ler render edilip incelendi; native OS dialog/zoom ve ürün/görsel kabulü bu
kanıttan otomatik çıkarılmaz. Video kapsam dışıdır.

Birincil ayrıntılı sözleşme: [Özellik paketi 1](feature-pack-1-plan.md). Görev/durum kaynağı: [EX kartları](tasks/README.md). Çelişki halinde yeni davranışlar için paket sözleşmesi, korunacak davranışlar için mevcut temel sözleşme birlikte uygulanır; kapsam sessizce genişletilmez.
