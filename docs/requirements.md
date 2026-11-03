# Ürün gereksinimleri

Durum: Onaylanan yaklaşımın uygulama sözleşmesi. İlgili görevler: [P0-01](tasks/P0-01.md), [P0-05](tasks/P0-05.md).

## Amaç

ProbeDesk, elektronik cihazlar için sıralı ölçüm planları oluşturma, yazılımsal simülatörle bu planları çalıştırma, sonuçları inceleme ve iki çalıştırmayı karşılaştırma uygulamasıdır. Backend ve Angular frontend portföyde eşit ağırlıkta gösterilmelidir.

İlk teslim tek `DC Power Module` cihaz profili, tek simülatör, sıralı sayısal ölçümler ve aynı anda tek aktif test içerir. Fiziksel cihaz ve ücretli API gerekmez. Ek altyapı maliyeti hedefi €0'dır.

## Roller

Üç hazır hesap ve hesap başına tek rol bulunur. Kayıt olma, parola sıfırlama ve kullanıcı yönetimi ilk kapsamda yoktur.

| İşlem | Planner | Operator | Viewer |
|---|---|---|---|
| Taslak oluşturma, okuma, düzenleme | Evet | Hayır | Hayır |
| Publish ve yeni sürüm taslağı | Evet | Hayır | Hayır |
| Yayımlanmış planı inceleme | Evet | Evet | Evet |
| Test başlatma | Hayır | Evet | Hayır |
| Aktif testi iptal etme | Hayır | Evet | Hayır |
| Canlı durumu ve geçmişi okuma | Evet | Evet | Evet |
| Çalıştırmaları karşılaştırma | Evet | Evet | Evet |

Bütün hazır kullanıcılar aynı cihaz profilinin kayıtlarını görür; kullanıcıya özel plan sahipliği/tenant ayrımı yoktur. Yetkiler API tarafından uygulanır. Taslak içeriği yetkisiz rollere yanıtta sızdırılmaz. Plan listesinde bu rollere yalnızca yayımlanmış plan bilgileri gösterilir.

## Gereksinim kaydı

| Kimlik | Gereksinim | Ana görevler | Kontroller |
|---|---|---|---|
| REQ-01 | İngilizce uygulama ve kullanıcı mesajları; İngilizce README | P1-04, P8-04 | P7-04, P8-04 |
| REQ-02 | Giriş, çıkış ve üç ayrı rol | P1-06, P1-07 | T16, T24 |
| REQ-03 | Plan oluşturma; sıralı adım ekleme, düzenleme, silme | P2-02, P2-04 | T17, P2-08 |
| REQ-04 | Fare ve klavyeyle adım sıralama | P2-05 | T17, P7-04 |
| REQ-05 | Adım adı, birim, min/max, örnek sayısı, ölçüm aralığı | P2-02, P2-04 | T01–04, P2-08 |
| REQ-06 | Taslak/Publish/yeni sürüm akışı | P2-06, P2-07 | T18, T19 |
| REQ-07 | Yayımlanmış sürümün ve eski çalıştırmanın korunması | P2-06, P3-03 | T19, P6-06 |
| REQ-08 | Normal, kesin hata ve rastgele simülasyon | P3-01, P3-02 | T07, T08 |
| REQ-09 | Seed ve ayarlarla tekrarlanabilir ölçüm dizisi | P3-01, P3-03 | T07 |
| REQ-10 | Backend kaynaklı doğrulama ve tolerans kararı | P3-05 | T01–06 |
| REQ-11 | Tek hatalı örnek adımı başarısız yapar; sonraki adımlar devam eder | P3-05 | T05, T06 |
| REQ-12 | Uygulama genelinde tek aktif test | P3-04 | T09, T10 |
| REQ-13 | Kullanıcı iptali; kısmi kayıtlar korunur; sürdürme yok | P3-07, P3-10 | T11 |
| REQ-14 | Kesintide Interrupted; tekrar deneme yeni kayıt | P3-08, P3-10 | T12, T28 |
| REQ-15 | SSE ile canlı ilerleme ve yeniden bağlantı | P4-01–07 | T13–16 |
| REQ-16 | Geçmiş, filtreler, ayrıntılar ve kayıtlı kurallar | P5-01–03 | P5-01–03 |
| REQ-17 | Tolerans bantları ve başarısız ölçümlerin grafikte görünmesi | P5-04 | T01–03, T26 |
| REQ-18 | Tooltip, zoom/pan, sıfırlama, hatadan adım ayrıntısına geçiş | P5-05, P5-06 | T25, T26 |
| REQ-19 | Aynı planın iki terminal çalıştırmasını karşılaştırma | P6-01–04 | P6-01, P7-01 |
| REQ-20 | Sürüm farkları, kalıcı adım eşleşmesi, eklenen/silinen adımlar | P6-03, P6-05, P6-06 | T19–23 |
| REQ-21 | Typed Reactive Forms, RxJS ve Material/CDK kullanımı | P2-04, P2-05, P4-03 | Bileşen ve durum testleri |
| REQ-22 | Açık hata/boş/yükleniyor/yetkisiz durumları ve klavye erişimi | P0-04, P7-04 | T16, T24, P7-04 |
| REQ-23 | Backend, Angular ve gerçek tarayıcı testleri | P1-08, P7-01–06 | Test raporları |
| REQ-24 | Hazır örnek veriler ve kolay Docker Compose kurulumu | P8-01–03 | T27, T28 |
| REQ-25 | Kısa demo videosu ve gerçek kanıtlarla README | P8-04, P8-05 | P8-06 |
| REQ-26 | Görev başına ayrı inceleme, aşama başına demo kabulü | P0-05, bütün görevler | İnceleme kayıtları |
| REQ-27 | Yerel altyapı ve uygun ücretsiz CI ile €0 ek maliyet hedefi | P1-08, P7-06, P8-01 | Mimari maliyet kaydı |

Kontrol kimlikleri [testing.md](testing.md) içinde tanımlıdır. Bir görevin kabulü yalnızca bu özet tabloya bakılarak verilmez; görev kartı ve ilgili ayrıntılı sözleşme de okunur.

## Ekran kapsamı

- Login.
- Test Plans.
- Plan Editor; yayımlanmış sürümler için salt okunur görünüm ve sürüm listesi.
- Live Run.
- Run History.
- Run Details.
- Compare Runs.

Ekran ayrıntıları için [frontend.md](frontend.md).

## Başarı senaryosu

Üç adımlı plan oluşturulur ve v1 yayımlanır. Operator kesin hata senaryosunu çalıştırır; ikinci adım hata verir, üçüncü adım devam eder, sonuç Failed olur. Hata grafikten ve adım ayrıntısından incelenir. Normal senaryo yeni bir çalıştırma olarak başlatılır; Passed sonucu alınır. İki kayıt karşılaştırılır. Yeni plan sürümü yayımlandıktan sonra eski çalıştırmanın sınırları ve sonucu aynı kalır.

## Kapsam değişikliği

Ürün kapsamını, rol yetkisini veya kabul davranışını değiştiren işler kullanıcı onayı gerektirir. Uygulama ayrıntıları bu sözleşme ve kabul ölçütleri içinde çözülebilir. Hedef dışı yeni ekran, ücretli servis veya çok süreçli dağıtım kendiliğinden eklenmez.
