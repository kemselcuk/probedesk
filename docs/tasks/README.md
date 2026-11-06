# Görev dizini

İlk ürün paketi **62 görev**: P0 için 5 belge inceleme görevi, P1–P8 için 57 uygulama/teslim görevi. P0 belgeleri In Review; P1-01–P1-08 Accepted (teknik kabul, 2026-11-03); P2-01–P2-08 ve P3-01–P3-10 Accepted (teknik kabul, 2026-11-03); P4-01–P4-07 ve P5-01–P5-06 Accepted (teknik kabul, 2026-11-03); P6-01–P6-06 Accepted (teknik kabul, 2026-11-04); P7-01–P7-06 Accepted (teknik kabul, 2026-11-04); P8-01–P8-04 Accepted (teknik kabul, 2026-11-04); P8-05 kullanıcı kararıyla kapsam dışı; P8-06 In Review (kullanıcı ürün kabulü bekliyor). Nihai ürün kabulü kullanıcıdadır.

Sahiplik alanı işin sorumluluk alanıdır; ek ekip veya otomasyon varsayımı değildir. Nihai ürün/kapsam kabulü kullanıcıdadır. Her görevin ayrı inceleme ve gerçek kanıt kaydı gerekir.

## Durum kuralları

- Planned: uygulama başlamadı.
- In Progress: görev üzerinde çalışılıyor.
- In Review: çıktı hazır, ayrı inceleme/kabul bekliyor.
- Accepted: ölçütler ve kontroller karşılandı; inceleme kaydı var.

P0 belgeleri hazırlanmış olduğundan In Review'dur; uygulama tamamlanması anlamına gelmez. Kartlardaki durum birincil kaynaktır. Değiştiğinde bu dizin ve [yol haritası](../roadmap.md) aynı değişiklikte güncellenir.

## Aşama 0 — Ürün ve teknik sözleşmeler

| Görev                                                     | Sahiplik      | Durum     |
| --------------------------------------------------------- | ------------- | --------- |
| [P0-01 — Gereksinimler ve yetki matrisi](P0-01.md)        | Dokümantasyon | In Review |
| [P0-02 — Ölçüm, simülasyon ve durum sözleşmesi](P0-02.md) | Backend       | In Review |
| [P0-03 — Veri modeli ve API tasarımı](P0-03.md)           | Backend       | In Review |
| [P0-04 — Ekran ve durum matrisi](P0-04.md)                | Frontend      | In Review |
| [P0-05 — Yol haritası ve izlenebilirlik](P0-05.md)        | Dokümantasyon | In Review |

## Aşama 1 — İskelet, giriş ve ilk CI

| Görev                                               | Sahiplik    | Durum    |
| --------------------------------------------------- | ----------- | -------- |
| [P1-01 — Repository ve sürüm kilidi](P1-01.md)      | Entegrasyon | Accepted |
| [P1-02 — PostgreSQL ve migration temeli](P1-02.md)  | Backend     | Accepted |
| [P1-03 — Ortak API davranışları](P1-03.md)          | Backend     | Accepted |
| [P1-04 — Angular uygulama kabuğu](P1-04.md)         | Frontend    | Accepted |
| [P1-05 — OpenAPI istemci tipleri](P1-05.md)         | Entegrasyon | Accepted |
| [P1-06 — Backend oturum ve yetkilendirme](P1-06.md) | Backend     | Accepted |
| [P1-07 — Angular giriş ve oturum akışı](P1-07.md)   | Frontend    | Accepted |
| [P1-08 — İlk CI kontrolü](P1-08.md)                 | Entegrasyon | Accepted |

## Aşama 2 — Plan editörü ve sürümler

| Görev                                                    | Sahiplik    | Durum    |
| -------------------------------------------------------- | ----------- | -------- |
| [P2-01 — Plan ve sürüm veri modeli](P2-01.md)            | Backend     | Accepted |
| [P2-02 — Taslak oluşturma ve kaydetme API'si](P2-02.md)  | Backend     | Accepted |
| [P2-03 — Test Plans ekranı](P2-03.md)                    | Frontend    | Accepted |
| [P2-04 — Typed dinamik adım formu](P2-04.md)             | Frontend    | Accepted |
| [P2-05 — Adım sıralama ve düzenleme güvenliği](P2-05.md) | Frontend    | Accepted |
| [P2-06 — Publish ve yeni sürüm taslağı](P2-06.md)        | Backend     | Accepted |
| [P2-07 — Frontend sürüm akışı](P2-07.md)                 | Frontend    | Accepted |
| [P2-08 — Plan yaşam döngüsü entegrasyonu](P2-08.md)      | Entegrasyon | Accepted |

## Aşama 3 — Simülasyon ve yürütme

| Görev                                                      | Sahiplik | Durum    |
| ---------------------------------------------------------- | -------- | -------- |
| [P3-01 — Deterministik normal simülatör](P3-01.md)         | Backend  | Accepted |
| [P3-02 — Kesin hata ve rastgele senaryolar](P3-02.md)      | Backend  | Accepted |
| [P3-03 — Çalıştırma kayıtları ve snapshot](P3-03.md)       | Backend  | Accepted |
| [P3-04 — Test başlatma ve tek çalışma garantisi](P3-04.md) | Backend  | Accepted |
| [P3-05 — Sıralı yürütme ve sonuç hesaplama](P3-05.md)      | Backend  | Accepted |
| [P3-06 — Çalıştırma snapshot API'si](P3-06.md)             | Backend  | Accepted |
| [P3-07 — İptal işlemi](P3-07.md)                           | Backend  | Accepted |
| [P3-08 — Kesinti ve teknik hata yönetimi](P3-08.md)        | Backend  | Accepted |
| [P3-09 — Test başlatma formu](P3-09.md)                    | Frontend | Accepted |
| [P3-10 — Çalıştırma özeti ve kontrol işlemleri](P3-10.md)  | Frontend | Accepted |

## Aşama 4 — Canlı durum ve bağlantı dayanıklılığı

| Görev                                                   | Sahiplik    | Durum    |
| ------------------------------------------------------- | ----------- | -------- |
| [P4-01 — Kalıcı olaylardan SSE yayını](P4-01.md)        | Backend     | Accepted |
| [P4-02 — Angular SSE taşıma servisi](P4-02.md)          | Frontend    | Accepted |
| [P4-03 — Snapshot ve canlı durum birleştirme](P4-03.md) | Frontend    | Accepted |
| [P4-04 — Live Run ekranı](P4-04.md)                     | Frontend    | Accepted |
| [P4-05 — Yeniden bağlantı ve oturum kaybı](P4-05.md)    | Frontend    | Accepted |
| [P4-06 — SSE entegrasyon testleri](P4-06.md)            | Entegrasyon | Accepted |
| [P4-07 — Çok sekme ve ekran yaşam döngüsü](P4-07.md)    | Entegrasyon | Accepted |

## Aşama 5 — Geçmiş ve grafikler

| Görev                                                    | Sahiplik    | Durum    |
| -------------------------------------------------------- | ----------- | -------- |
| [P5-01 — Geçmiş listeleme ve ölçüm özetleri](P5-01.md)   | Backend     | Accepted |
| [P5-02 — Run History ekranı](P5-02.md)                   | Frontend    | Accepted |
| [P5-03 — Run Details ekranı](P5-03.md)                   | Frontend    | Accepted |
| [P5-04 — Ortak ölçüm grafiği](P5-04.md)                  | Frontend    | Accepted |
| [P5-05 — Grafik etkileşimleri](P5-05.md)                 | Frontend    | Accepted |
| [P5-06 — Canlı grafik ve tarayıcı doğrulaması](P5-06.md) | Entegrasyon | Accepted |

## Aşama 6 — Karşılaştırma ve sürüm tutarlılığı

| Görev                                                   | Sahiplik    | Durum    |
| ------------------------------------------------------- | ----------- | -------- |
| [P6-01 — Karşılaştırma API'si](P6-01.md)                | Backend     | Accepted |
| [P6-02 — Karşılaştırma seçimi ve route](P6-02.md)       | Frontend    | Accepted |
| [P6-03 — Sonuç ve kural farkları](P6-03.md)             | Frontend    | Accepted |
| [P6-04 — İki serili karşılaştırma grafikleri](P6-04.md) | Frontend    | Accepted |
| [P6-05 — Birim ve örnekleme farkları](P6-05.md)         | Entegrasyon | Accepted |
| [P6-06 — Sürüm tutarlılığı regresyonu](P6-06.md)        | Entegrasyon | Accepted |

## Aşama 7 — Bütünleşik kalite ve CI

| Görev                                                  | Sahiplik    | Durum    |
| ------------------------------------------------------ | ----------- | -------- |
| [P7-01 — Ana demo akışının Playwright testi](P7-01.md) | Entegrasyon | Accepted |
| [P7-02 — Yetki ve istek güvenliği testleri](P7-02.md)  | Entegrasyon | Accepted |
| [P7-03 — Yarış ve kesinti testleri](P7-03.md)          | Backend     | Accepted |
| [P7-04 — Erişilebilirlik ve hata deneyimi](P7-04.md)   | Frontend    | Accepted |
| [P7-05 — Test verisi ve izolasyon](P7-05.md)           | Entegrasyon | Accepted |
| [P7-06 — Tam CI pipeline'ı](P7-06.md)                  | Entegrasyon | Accepted |

## Aşama 8 — Yerel teslim, kanıt ve video

| Görev                                                   | Sahiplik                           | Durum                    |
| ------------------------------------------------------- | ---------------------------------- | ------------------------ |
| [P8-01 — Tam Docker Compose teslimi](P8-01.md)          | Entegrasyon                        | Accepted                 |
| [P8-02 — Hazır örnek veriler](P8-02.md)                 | Backend                            | Accepted                 |
| [P8-03 — Temiz kurulum ve kalıcılık kontrolü](P8-03.md) | Entegrasyon                        | Accepted                 |
| [P8-04 — README ve teknik belgeler](P8-04.md)           | Dokümantasyon                      | Accepted                 |
| [P8-05 — Kısa demo videosu](P8-05.md)                   | Dokümantasyon                      | Deferred (user decision) |
| [P8-06 — Sürüm adayı ve nihai kabul paketi](P8-06.md)   | Entegrasyon; nihai kabul kullanıcı | In Review                |

## Kart ve kapanış standardı

Her kart: amaç/çıktı, değişiklik alanı, bağımlılıklar, REQ bağlantıları, somut kabul maddeleri, doğrulama adımları ve doldurulmamış kanıt/inceleme kaydı içerir. Komutlar henüz planlanmış olabilir; çalıştırılmış gibi yazılmaz.

Ayrıntılar: [başlangıç rehberi](../implementation-guide.md), [test/inceleme sözleşmesi](../testing.md), [nihai kabul](../acceptance.md).

## UI yenileme kampanyası — 2026-11-04

İlk ürün paketinin 62 kartına ek **10 UI görevi** vardır; toplam kart sayısı 72 olur. UI-09 kullanıcı geri bildiriminden doğan düzeltme kartıdır. Bu kampanya eski P1–P8 kabul kayıtlarını yeniden açmaz. Kullanıcı yeni görünümün uygulanmasını yetkilendirdi; uygulama kayıtları In Review durumundadır; kullanıcı görsel kabulü verilmiş değildir. Ana sözleşme: [ayrıntılı UI planı](../ui-modernization-plan.md).

| Görev             | Kapsam                                                  | Durum     |
| ----------------- | ------------------------------------------------------- | --------- |
| [UI-01](UI-01.md) | Ortak tasarım tokenları ve Material ölçeği              | In Review |
| [UI-02](UI-02.md) | Shell, Login ve ortak durumlar                          | In Review |
| [UI-03](UI-03.md) | Test Plans ve Published Version                         | In Review |
| [UI-04](UI-04.md) | Plan Editor bilgi hiyerarşisi                           | In Review |
| [UI-05](UI-05.md) | Start Run ve Live Run görünümü                          | In Review |
| [UI-06](UI-06.md) | Run History ve Run Details yoğunluğu                    | In Review |
| [UI-07](UI-07.md) | Compare Runs ve ortak grafik tasarımı                   | In Review |
| [UI-08](UI-08.md) | Responsive, erişilebilirlik ve bütünleşik görsel teslim | In Review |
| [UI-09](UI-09.md) | Seçim kontrolleri, takvim ve ortak boşluk düzeltmeleri  | In Review |
| [UI-10](UI-10.md) | İçerik odaklı tablolar ve panel boşluk ritmi            | In Review |

## Özellik paketi 1 — 2026-11-06

Kullanıcı özellik paketi 1’in (dört özellik) uygulanmasını yetkilendirdi. [Ayrıntılı ek sözleşme](../feature-pack-1-plan.md). Önceki 72 karta 13 EX kartı eklendi; toplam **85 kart**.

| Görev                                                           | Sahiplik               | Durum     |
| --------------------------------------------------------------- | ---------------------- | --------- |
| [EX-01 — Paket sözleşmeleri ve görev izlenebilirliği](EX-01.md) | Lead                   | Accepted  |
| [EX-02 — Device ve kopyalama veri modeli](EX-02.md)             | A                      | Accepted  |
| [EX-03 — Cihaz API ve eklemeli demo seed](EX-03.md)             | A                      | In Review |
| [EX-04 — Run cihaz metadata ve geçmiş filtreleri](EX-04.md)     | A                      | Planned   |
| [EX-05 — Cihaz ve run metadata frontend](EX-05.md)              | Lead                   | Planned   |
| [EX-06 — Yayımlanmış plandan bağımsız kopya API](EX-06.md)      | C                      | In Review |
| [EX-07 — Plan kopyalama frontend](EX-07.md)                     | Lead                   | In Review |
| [EX-08 — Analytics overview backend](EX-08.md)                  | B                      | Planned   |
| [EX-09 — Overview dashboard frontend](EX-09.md)                 | Lead                   | Planned   |
| [EX-10 — Rapor projection ve güvenli export backend](EX-10.md)  | C                      | Planned   |
| [EX-11 — Download ve yazdırılabilir rapor frontend](EX-11.md)   | Lead                   | Planned   |
| [EX-12 — Paket gerçek E2E ve veritabanı izolasyonu](EX-12.md)   | D                      | Planned   |
| [EX-13 — Bağımsız review ve teslim paketi](EX-13.md)            | Review delegate + Lead | Planned   |
