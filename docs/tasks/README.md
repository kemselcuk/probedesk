# Görev dizini

Toplam **62 görev**: P0 için 5 belge inceleme görevi, P1–P8 için 57 uygulama/teslim görevi. P0 belgeleri In Review; P1-01–P1-08 Accepted (teknik kabul, 2026-11-03); P2-01–P2-08 ve P3-01–P3-10 Accepted (teknik kabul, 2026-11-03); P4-01–P4-07 ve P5-01–P5-06 Accepted/In Review; P6–P8 Planned. Nihai ürün kabulü kullanıcıdadır.

Sahiplik alanı işin sorumluluk alanıdır; ek ekip veya otomasyon varsayımı değildir. Nihai ürün/kapsam kabulü kullanıcıdadır. Her görevin ayrı inceleme ve gerçek kanıt kaydı gerekir.

## Durum kuralları

- Planned: uygulama başlamadı.
- In Progress: görev üzerinde çalışılıyor.
- In Review: çıktı hazır, ayrı inceleme/kabul bekliyor.
- Accepted: ölçütler ve kontroller karşılandı; inceleme kaydı var.

P0 belgeleri hazırlanmış olduğundan In Review'dur; uygulama tamamlanması anlamına gelmez. Kartlardaki durum birincil kaynaktır. Değiştiğinde bu dizin ve [yol haritası](../roadmap.md) aynı değişiklikte güncellenir.

## Aşama 0 — Ürün ve teknik sözleşmeler

| Görev | Sahiplik | Durum |
|---|---|---|
| [P0-01 — Gereksinimler ve yetki matrisi](P0-01.md) | Dokümantasyon | In Review |
| [P0-02 — Ölçüm, simülasyon ve durum sözleşmesi](P0-02.md) | Backend | In Review |
| [P0-03 — Veri modeli ve API tasarımı](P0-03.md) | Backend | In Review |
| [P0-04 — Ekran ve durum matrisi](P0-04.md) | Frontend | In Review |
| [P0-05 — Yol haritası ve izlenebilirlik](P0-05.md) | Dokümantasyon | In Review |

## Aşama 1 — İskelet, giriş ve ilk CI

| Görev | Sahiplik | Durum |
|---|---|---|
| [P1-01 — Repository ve sürüm kilidi](P1-01.md) | Entegrasyon | Accepted |
| [P1-02 — PostgreSQL ve migration temeli](P1-02.md) | Backend | Accepted |
| [P1-03 — Ortak API davranışları](P1-03.md) | Backend | Accepted |
| [P1-04 — Angular uygulama kabuğu](P1-04.md) | Frontend | Accepted |
| [P1-05 — OpenAPI istemci tipleri](P1-05.md) | Entegrasyon | Accepted |
| [P1-06 — Backend oturum ve yetkilendirme](P1-06.md) | Backend | Accepted |
| [P1-07 — Angular giriş ve oturum akışı](P1-07.md) | Frontend | Accepted |
| [P1-08 — İlk CI kontrolü](P1-08.md) | Entegrasyon | Accepted |

## Aşama 2 — Plan editörü ve sürümler

| Görev | Sahiplik | Durum |
|---|---|---|
| [P2-01 — Plan ve sürüm veri modeli](P2-01.md) | Backend | Accepted |
| [P2-02 — Taslak oluşturma ve kaydetme API'si](P2-02.md) | Backend | Accepted |
| [P2-03 — Test Plans ekranı](P2-03.md) | Frontend | Accepted |
| [P2-04 — Typed dinamik adım formu](P2-04.md) | Frontend | Accepted |
| [P2-05 — Adım sıralama ve düzenleme güvenliği](P2-05.md) | Frontend | Accepted |
| [P2-06 — Publish ve yeni sürüm taslağı](P2-06.md) | Backend | Accepted |
| [P2-07 — Frontend sürüm akışı](P2-07.md) | Frontend | Accepted |
| [P2-08 — Plan yaşam döngüsü entegrasyonu](P2-08.md) | Entegrasyon | Accepted |

## Aşama 3 — Simülasyon ve yürütme

| Görev | Sahiplik | Durum |
|---|---|---|
| [P3-01 — Deterministik normal simülatör](P3-01.md) | Backend | Accepted |
| [P3-02 — Kesin hata ve rastgele senaryolar](P3-02.md) | Backend | Accepted |
| [P3-03 — Çalıştırma kayıtları ve snapshot](P3-03.md) | Backend | Accepted |
| [P3-04 — Test başlatma ve tek çalışma garantisi](P3-04.md) | Backend | Accepted |
| [P3-05 — Sıralı yürütme ve sonuç hesaplama](P3-05.md) | Backend | Accepted |
| [P3-06 — Çalıştırma snapshot API'si](P3-06.md) | Backend | Accepted |
| [P3-07 — İptal işlemi](P3-07.md) | Backend | Accepted |
| [P3-08 — Kesinti ve teknik hata yönetimi](P3-08.md) | Backend | Accepted |
| [P3-09 — Test başlatma formu](P3-09.md) | Frontend | Accepted |
| [P3-10 — Çalıştırma özeti ve kontrol işlemleri](P3-10.md) | Frontend | Accepted |

## Aşama 4 — Canlı durum ve bağlantı dayanıklılığı

| Görev | Sahiplik | Durum |
|---|---|---|
| [P4-01 — Kalıcı olaylardan SSE yayını](P4-01.md) | Backend | Accepted |
| [P4-02 — Angular SSE taşıma servisi](P4-02.md) | Frontend | Accepted |
| [P4-03 — Snapshot ve canlı durum birleştirme](P4-03.md) | Frontend | Accepted |
| [P4-04 — Live Run ekranı](P4-04.md) | Frontend | Accepted |
| [P4-05 — Yeniden bağlantı ve oturum kaybı](P4-05.md) | Frontend | Accepted |
| [P4-06 — SSE entegrasyon testleri](P4-06.md) | Entegrasyon | Accepted |
| [P4-07 — Çok sekme ve ekran yaşam döngüsü](P4-07.md) | Entegrasyon | Accepted |

## Aşama 5 — Geçmiş ve grafikler

| Görev | Sahiplik | Durum |
|---|---|---|
| [P5-01 — Geçmiş listeleme ve ölçüm özetleri](P5-01.md) | Backend | In Review |
| [P5-02 — Run History ekranı](P5-02.md) | Frontend | In Review |
| [P5-03 — Run Details ekranı](P5-03.md) | Frontend | In Review |
| [P5-04 — Ortak ölçüm grafiği](P5-04.md) | Frontend | In Review |
| [P5-05 — Grafik etkileşimleri](P5-05.md) | Frontend | In Review |
| [P5-06 — Canlı grafik ve tarayıcı doğrulaması](P5-06.md) | Entegrasyon | In Review |

## Aşama 6 — Karşılaştırma ve sürüm tutarlılığı

| Görev | Sahiplik | Durum |
|---|---|---|
| [P6-01 — Karşılaştırma API'si](P6-01.md) | Backend | In Review |
| [P6-02 — Karşılaştırma seçimi ve route](P6-02.md) | Frontend | Planned |
| [P6-03 — Sonuç ve kural farkları](P6-03.md) | Frontend | Planned |
| [P6-04 — İki serili karşılaştırma grafikleri](P6-04.md) | Frontend | Planned |
| [P6-05 — Birim ve örnekleme farkları](P6-05.md) | Entegrasyon | Planned |
| [P6-06 — Sürüm tutarlılığı regresyonu](P6-06.md) | Entegrasyon | Planned |

## Aşama 7 — Bütünleşik kalite ve CI

| Görev | Sahiplik | Durum |
|---|---|---|
| [P7-01 — Ana demo akışının Playwright testi](P7-01.md) | Entegrasyon | Planned |
| [P7-02 — Yetki ve istek güvenliği testleri](P7-02.md) | Entegrasyon | Planned |
| [P7-03 — Yarış ve kesinti testleri](P7-03.md) | Backend | Planned |
| [P7-04 — Erişilebilirlik ve hata deneyimi](P7-04.md) | Frontend | Planned |
| [P7-05 — Test verisi ve izolasyon](P7-05.md) | Entegrasyon | Planned |
| [P7-06 — Tam CI pipeline'ı](P7-06.md) | Entegrasyon | Planned |

## Aşama 8 — Yerel teslim, kanıt ve video

| Görev | Sahiplik | Durum |
|---|---|---|
| [P8-01 — Tam Docker Compose teslimi](P8-01.md) | Entegrasyon | Planned |
| [P8-02 — Hazır örnek veriler](P8-02.md) | Backend | Planned |
| [P8-03 — Temiz kurulum ve kalıcılık kontrolü](P8-03.md) | Entegrasyon | Planned |
| [P8-04 — README ve teknik belgeler](P8-04.md) | Dokümantasyon | Planned |
| [P8-05 — Kısa demo videosu](P8-05.md) | Dokümantasyon | Planned |
| [P8-06 — Sürüm adayı ve nihai kabul paketi](P8-06.md) | Entegrasyon; nihai kabul kullanıcı | Planned |

## Kart ve kapanış standardı

Her kart: amaç/çıktı, değişiklik alanı, bağımlılıklar, REQ bağlantıları, somut kabul maddeleri, doğrulama adımları ve doldurulmamış kanıt/inceleme kaydı içerir. Komutlar henüz planlanmış olabilir; çalıştırılmış gibi yazılmaz.

Ayrıntılar: [başlangıç rehberi](../implementation-guide.md), [test/inceleme sözleşmesi](../testing.md), [nihai kabul](../acceptance.md).

