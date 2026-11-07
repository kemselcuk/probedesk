# Ayrıntılı uygulama yol haritası

Bu dosya önceki ayrıntılı planın aşama ve görev dizinidir; her görevin tam kapsamı ayrı kartındadır. **Geliştirme başladı.** P0 belgeleri In Review; P1–P7 ve P8-01–P8-04 Accepted; P8-05 kapsam dışı; P8-06 sürüm adayı In Review (kullanıcı ürün kabulü bekliyor). Phase 1–7 çalışır durumda; teslim paketi tamamlanıyor.

## Sıra ve sahiplik

Backend, Frontend, Entegrasyon ve Dokümantasyon sorumluluk alanları görev kartlarında belirtilir. Her görevin ayrı teknik incelemesi, her uygulama aşamasının çalışan demo kontrolü vardır. Nihai kapsam/ürün onayı kullanıcıya aittir. Backend ve Angular görevleri aşamalar boyunca birlikte ilerler.

Aşamalar sırayla kabul edilir; bir görev ayrıca kartındaki bağımlılıkları bekler. Her adımda yeniden kullanıcı izni istemek gerekmez: uygulama yetkilendirmesi varsa onaylanan kapsam içinde ilerlenir; ürün kapsamı/maliyet değişikliği kullanıcıya getirilir. P0 mevcut belgeleri incelemeyi içerir, yeniden sıfırdan yazmayı gerektirmez.

## Aşama özeti

| Aşama | Konu                                  | Görev sayısı | İlk paket durumu |
| ----- | ------------------------------------- | ------------ | ---------------- |
| 0     | Ürün ve teknik sözleşmeler            | 5            | In Review        |
| 1     | İskelet, giriş ve ilk CI              | 8            | Accepted         |
| 2     | Plan editörü ve sürümler              | 8            | Accepted         |
| 3     | Simülasyon ve yürütme                 | 10           | Accepted         |
| 4     | Canlı durum ve bağlantı dayanıklılığı | 7            | Accepted         |
| 5     | Geçmiş ve grafikler                   | 6            | Accepted         |
| 6     | Karşılaştırma ve sürüm tutarlılığı    | 6            | Accepted         |
| 7     | Bütünleşik kalite ve CI               | 6            | Accepted         |
| 8     | Yerel teslim ve kanıt                 | 6            | In Review        |

İlk ürün paketi 62 görevdir; 10 UI ve 13 EX ek kartıyla güncel toplam **85 görev**. Bütün görevler için ek altyapı maliyeti €0 hedefidir. Maliyet koşulları [mimaride](architecture.md#maliyet-ve-teslim-sinirlari) tanımlıdır.

## Aşama 0 — Ürün ve teknik sözleşmeler

Giriş: Onaylanan yaklaşım ve mevcut belge paketi.

- [P0-01 — Gereksinimler ve yetki matrisi](tasks/P0-01.md) — Dokümantasyon.
- [P0-02 — Ölçüm, simülasyon ve durum sözleşmesi](tasks/P0-02.md) — Backend.
- [P0-03 — Veri modeli ve API tasarımı](tasks/P0-03.md) — Backend.
- [P0-04 — Ekran ve durum matrisi](tasks/P0-04.md) — Frontend.
- [P0-05 — Yol haritası ve izlenebilirlik](tasks/P0-05.md) — Dokümantasyon.

Çıkış/kabul: Gereksinim, sayısal/durum kuralları, veri/API ve ekran sözleşmeleri tutarlı; görev/REQ/test eşlemesi eksiksiz.

Demo/inceleme: Çalışan uygulama demosu beklenmez. Mevcut belgeler, roller ve ana senaryo üzerinden inceleme yapılır.

## Aşama 1 — İskelet, giriş ve ilk CI

Giriş: P0 inceleme bulguları kapatılmış olmalı.

- [P1-01 — Repository ve sürüm kilidi](tasks/P1-01.md) — Entegrasyon.
- [P1-02 — PostgreSQL ve migration temeli](tasks/P1-02.md) — Backend.
- [P1-03 — Ortak API davranışları](tasks/P1-03.md) — Backend.
- [P1-04 — Angular uygulama kabuğu](tasks/P1-04.md) — Frontend.
- [P1-05 — OpenAPI istemci tipleri](tasks/P1-05.md) — Entegrasyon.
- [P1-06 — Backend oturum ve yetkilendirme](tasks/P1-06.md) — Backend.
- [P1-07 — Angular giriş ve oturum akışı](tasks/P1-07.md) — Frontend.
- [P1-08 — İlk CI kontrolü](tasks/P1-08.md) — Entegrasyon.

Çıkış/kabul: İki uygulama derlenir; gerçek DB bağlantısı, üç rolün oturum akışı ve ilk kalite kontrolleri çalışır.

Demo/inceleme: Üç hesapla giriş/çıkış, rol navigasyonu ve yetkisiz doğrudan HTTP isteğinin reddi.

## Aşama 2 — Plan editörü ve sürümler

Giriş: Aşama 1 teknik kabulü ve ilgili görev bağımlılıkları.

- [P2-01 — Plan ve sürüm veri modeli](tasks/P2-01.md) — Backend.
- [P2-02 — Taslak oluşturma ve kaydetme API'si](tasks/P2-02.md) — Backend.
- [P2-03 — Test Plans ekranı](tasks/P2-03.md) — Frontend.
- [P2-04 — Typed dinamik adım formu](tasks/P2-04.md) — Frontend.
- [P2-05 — Adım sıralama ve düzenleme güvenliği](tasks/P2-05.md) — Frontend.
- [P2-06 — Publish ve yeni sürüm taslağı](tasks/P2-06.md) — Backend.
- [P2-07 — Frontend sürüm akışı](tasks/P2-07.md) — Frontend.
- [P2-08 — Plan yaşam döngüsü entegrasyonu](tasks/P2-08.md) — Entegrasyon.

Çıkış/kabul: Plan create/edit/reorder/save/Publish/new draft uçtan uca çalışır; yayımlanmış sürüm korunur.

Demo/inceleme: Üç adımlı v1 oluştur; sırala/kaydet/yayımla; yeni taslağı değiştir; v1'i yeniden aç.

## Aşama 3 — Simülasyon ve yürütme

Giriş: Aşama 2 kabulü; kayıt/kimlik sözleşmesi korunur.

- [P3-01 — Deterministik normal simülatör](tasks/P3-01.md) — Backend.
- [P3-02 — Kesin hata ve rastgele senaryolar](tasks/P3-02.md) — Backend.
- [P3-03 — Çalıştırma kayıtları ve snapshot](tasks/P3-03.md) — Backend.
- [P3-04 — Test başlatma ve tek çalışma garantisi](tasks/P3-04.md) — Backend.
- [P3-05 — Sıralı yürütme ve sonuç hesaplama](tasks/P3-05.md) — Backend.
- [P3-06 — Çalıştırma snapshot API'si](tasks/P3-06.md) — Backend.
- [P3-07 — İptal işlemi](tasks/P3-07.md) — Backend.
- [P3-08 — Kesinti ve teknik hata yönetimi](tasks/P3-08.md) — Backend.
- [P3-09 — Test başlatma formu](tasks/P3-09.md) — Frontend.
- [P3-10 — Çalıştırma özeti ve kontrol işlemleri](tasks/P3-10.md) — Frontend.

Çıkış/kabul: Üç senaryo, sıralı executor, snapshot, tek aktif çalışma, iptal ve recovery; UI'dan başlatma/sonuç okuma çalışır.

Demo/inceleme: Operator forced failure başlatır; üçüncü adım devam eder; Failed, Cancelled ve Interrupted kayıtları incelenir.

## Aşama 4 — Canlı durum ve bağlantı dayanıklılığı

Giriş: Aşama 3 kalıcı veri ve olay yazma yolu.

- [P4-01 — Kalıcı olaylardan SSE yayını](tasks/P4-01.md) — Backend.
- [P4-02 — Angular SSE taşıma servisi](tasks/P4-02.md) — Frontend.
- [P4-03 — Snapshot ve canlı durum birleştirme](tasks/P4-03.md) — Frontend.
- [P4-04 — Live Run ekranı](tasks/P4-04.md) — Frontend.
- [P4-05 — Yeniden bağlantı ve oturum kaybı](tasks/P4-05.md) — Frontend.
- [P4-06 — SSE entegrasyon testleri](tasks/P4-06.md) — Entegrasyon.
- [P4-07 — Çok sekme ve ekran yaşam döngüsü](tasks/P4-07.md) — Entegrasyon.

Çıkış/kabul: Snapshot/SSE replay/dedup/gap uzlaştırması; route/session cleanup ve çok sekme doğrulanır.

Demo/inceleme: Canlı çalışma sırasında ağı kes/geri aç; final örnek sayısı ve sonuç backend ile aynı olsun.

## Aşama 5 — Geçmiş ve grafikler

Giriş: Aşama 4 canlı durum ve cleanup kabulü.

- [P5-01 — Geçmiş listeleme ve ölçüm özetleri](tasks/P5-01.md) — Backend.
- [P5-02 — Run History ekranı](tasks/P5-02.md) — Frontend.
- [P5-03 — Run Details ekranı](tasks/P5-03.md) — Frontend.
- [P5-04 — Ortak ölçüm grafiği](tasks/P5-04.md) — Frontend.
- [P5-05 — Grafik etkileşimleri](tasks/P5-05.md) — Frontend.
- [P5-06 — Canlı grafik ve tarayıcı doğrulaması](tasks/P5-06.md) — Entegrasyon.

Çıkış/kabul: Filtreli history, immutable details, tolerans grafikleri ve gerçek canvas etkileşimleri çalışır.

Demo/inceleme: 0.60 A hata noktasını seç; adım ve tablo satırını incele; zoom/pan/reset kullan.

## Aşama 6 — Karşılaştırma ve sürüm tutarlılığı

Giriş: History/details/grafik temelinin kabulü.

- [P6-01 — Karşılaştırma API'si](tasks/P6-01.md) — Backend.
- [P6-02 — Karşılaştırma seçimi ve route](tasks/P6-02.md) — Frontend.
- [P6-03 — Sonuç ve kural farkları](tasks/P6-03.md) — Frontend.
- [P6-04 — İki serili karşılaştırma grafikleri](tasks/P6-04.md) — Frontend.
- [P6-05 — Birim ve örnekleme farkları](tasks/P6-05.md) — Entegrasyon.
- [P6-06 — Sürüm tutarlılığı regresyonu](tasks/P6-06.md) — Entegrasyon.

Çıkış/kabul: İki terminal run, sürüm/kimlik/birim/örnekleme farkları ve eski sonuç değişmezliği kanıtlı.

Demo/inceleme: v1 fail/pass karşılaştır; v2 yayımla ve v2 normal run oluştur; v1'in eski sınır/sonucunu ve v1-v2 karşılaştırmasını göster.

## Aşama 7 — Bütünleşik kalite ve CI

Giriş: Ürün akışları tamamlanmış; önceki inceleme bulguları kapalı.

- [P7-01 — Ana demo akışının Playwright testi](tasks/P7-01.md) — Entegrasyon.
- [P7-02 — Yetki ve istek güvenliği testleri](tasks/P7-02.md) — Entegrasyon.
- [P7-03 — Yarış ve kesinti testleri](tasks/P7-03.md) — Backend.
- [P7-04 — Erişilebilirlik ve hata deneyimi](tasks/P7-04.md) — Frontend.
- [P7-05 — Test verisi ve izolasyon](tasks/P7-05.md) — Entegrasyon.
- [P7-06 — Tam CI pipeline'ı](tasks/P7-06.md) — Entegrasyon.

Çıkış/kabul: Ana gerçek-stack E2E, auth/race/recovery/erişilebilirlik/izolasyon kontrolleri ve tam CI geçer.

Demo/inceleme: Ana akış ve tamamlayıcı hata senaryoları gerçek test raporlarıyla gözden geçirilir.

## Aşama 8 — Yerel teslim ve kanıt

Giriş: Aşama 7 teknik kabulü.

- [P8-01 — Tam Docker Compose teslimi](tasks/P8-01.md) — Entegrasyon.
- [P8-02 — Hazır örnek veriler](tasks/P8-02.md) — Backend.
- [P8-03 — Temiz kurulum ve kalıcılık kontrolü](tasks/P8-03.md) — Entegrasyon.
- [P8-04 — README ve teknik belgeler](tasks/P8-04.md) — Dokümantasyon.
- [P8-05 — Kısa demo videosu](tasks/P8-05.md) — Dokümantasyon; kullanıcı kararıyla kapsam dışı.
- [P8-06 — Sürüm adayı ve nihai kabul paketi](tasks/P8-06.md) — Entegrasyon; nihai kabul kullanıcı.

Çıkış/kabul: Temiz Compose kurulumu, seed, kalıcılık, gerçek README/CI kanıtları ve kullanıcı nihai kabul paketi. Demo videosu kullanıcı kararıyla kapsam dışıdır.

Demo/inceleme: Temiz checkout kurulumu açılır; hazır veri ve ana demo uygulanır; bütün kanıtlar aynı commit'e bağlanır.

## Doğrulama ve teslim

- [Gereksinim eşlemesi](requirements.md) her REQ için görev/kontrol gösterir.
- [Test matrisi](testing.md) T01–T39'u ve komut/CI sözleşmesini tanımlar.
- [Demo](demo.md) üç run dahil gerçek v1/v2 kanıt akışını verir.
- [Nihai kabul](acceptance.md) ürünün kapanış şartıdır.
- [Kanıt dizini](evidence/README.md) gerçek çıktılar gelene kadar boş tutulur.

Bir aşama yalnızca kartlar kapandı diye kabul edilmez; birleşen davranışların demosu ve incelemesi de başarılı olmalıdır. Test, CI veya ekran kanıtı olmadan tamamlanma iddiası eklenmez.

## UI yenileme ek kampanyası — kullanıcı talebi 2026-11-04

[UI yenileme planı](ui-modernization-plan.md), ilk 62 görevden ayrı 8 kart ekler. Sıra UI-01 token/Material → UI-02 shell/login → UI-03 plans/version → UI-04 editor → UI-05 start/live → UI-06 history/details → UI-07 compare/charts → UI-08 responsive/görsel QA. **UI-01–UI-08 In Review; kullanıcı görsel kabulü bekleniyor**; bu kayıt uygulama veya görsel kabul değildir. Kart durumları [görev dizininde](tasks/README.md) tutulur. Eski ürün sözleşmesi/rol/ölçüm ve kabul geçmişi korunur; video kapsam dışıdır.

UI-09: kullanıcı geri bildirimi üzerine dropdown/takvim/tablo/form boşluk düzeltmeleri — **In Review**; gerçek kontroller ve 8080 teslimi [UI-09 kanıtında](evidence/ui-refresh/ui-09.md).

UI-10: Grafana tablo referansına göre içerik genişliği, veri hizası ve panel boşluk ritmi — **In Review**; [gerçek ölçüm ve teslim kanıtı](evidence/ui-refresh/ui-10.md).

## Özellik paketi 1 — 2026-11-06

Kullanıcı `feat/analytics-reporting-devices` branchinde uygulamayı başlattı. [Paket sözleşmesi](feature-pack-1-plan.md), [kartlar](tasks/README.md#özellik-paketi-1--2026-11-06). EX-01/EX-02/EX-03/EX-04/EX-06 Accepted; EX-05/EX-08/EX-10 In Progress; EX-07 In Review; diğer EX kartları Planned. Sıra: sözleşme → şema → cihaz/run metadata ve plan copy → analytics/report → frontend entegrasyonu → gerçek E2E ve bağımsız inceleme/teslim. Ayrı dosya sahiplerinde bağımsız kartlar paralel; her worker tek kart. Main merge bu yetkinin parçası değil.
