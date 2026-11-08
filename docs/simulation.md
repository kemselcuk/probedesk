# Simülatör ve demo cihazı

Gereksinimler: REQ-08, REQ-09. Görevler: [P3-01](tasks/P3-01.md), [P3-02](tasks/P3-02.md), [P8-02](tasks/P8-02.md).

## Tek cihaz profili

Profil: `DC Power Module`. Bu profil fiziksel cihazla iletişim kurmaz; sayısal ölçüm planları için örnek bağlam sağlar. Ayrı cihaz profili yönetim ekranı yoktur.

| Sıra | Adım adı | Birim | Minimum | Maksimum | Örnek sayısı | Aralık |
|---|---|---|---|---|---|---|
| 1 | Output Voltage | V | 4.75 | 5.25 | 30 | 200 ms |
| 2 | Current Draw | A | 0.45 | 0.55 | 30 | 200 ms |
| 3 | Case Temperature | °C | 20 | 60 | 30 | 200 ms |

Bu ayarlar nominal 18 saniyelik ölçüm süresi tanımlar; gerçek çalışma süresi ölçülmemiştir ve zamanlayıcı/veritabanı gecikmelerini içerir.

## Simülatör sınırı

Backend, simülatörden gelen değerleri de doğrular. Simülatör plan sonucunu veya yetkiyi belirlemez. Üretici seed ve immutable adım ayarlarını alır; örnek değerini üretir. Zamanlama ve kalıcı kayıt yürütücünün sorumluluğudur. Üretim modülü saat, HTTP, UI ve veritabanına bağımlı olmamalıdır.

## Senaryolar

| API scenario | UI adı | Ayarlar | Beklenti |
|---|---|---|---|
| NORMAL | Normal | Seed | Bütün örnekler kendi toleransları içinde |
| FORCED_FAILURE | Forced failure | Seed, failureStepId | Seçilen adımda kesin bir ihlal |
| RANDOM | Random | Seed, errorProbability | Her örnekte belirtilen olasılıkla ihlal |

NORMAL ve FORCED_FAILURE için hata oranı gönderilmez. RANDOM için hata adımı gönderilmez. Bilinmeyen veya senaryoya uymayan alanlar reddedilir. `failureStepId`, çalıştırılacak sürümün `logicalStepId` değerlerinden biri olmalıdır.

## Determinizm

- PRNG başlangıç tercihi `mulberry32-v1`'dir; kesin algoritma ve dönüşüm P3-01'de test fixture'larıyla kilitlenir.
- Global `Math.random()` veya dış API kullanılmaz.
- Aynı seed, aynı sıralı immutable adım tanımları, aynı senaryo/ayarlar ve aynı `simulatorVersion` aynı `(step, sampleIndex, value)` dizisini üretir.
- `recordedAt`, gerçek çalışma süresi ve ağ geliş zamanları eşitlik kapsamına girmez.
- Normal üretim altı ondalıklı değer uzayında yapılır; sınır dışına taşan yuvarlama oluşmamalıdır.
- Eşit min/max için normal üretim bu sabit değeri döndürür.
- Alt/üst sınıra eşit örnekler geçerlidir.

PRNG algoritması veya değer eşleme kuralı değişirse `simulatorVersion` artırılır. Geçmiş ölçümler yeniden üretilip üzerine yazılmaz.

## Kesin hata

Hata örneğinin indeksi `floor((sampleCount - 1) / 2)` olur. 30 örnekte bu, `sampleIndex=14`, yani kullanıcıya göre 15. örnektir.

Üst sınırın dışına çıkma mesafesi `max((maximum - minimum) / 2, 0.000001)` olarak altı ondalık hassasiyete uyarlanır. Demo akım adımında bu kural `0.60 A` üretir. Diğer örnekler ve diğer adımlar tolerans içinde kalır. Bir örnekli adımda tek örnek hata üretir.

## Rastgele hata

Her örnekte bağımsız PRNG kararı verilir. Hata oranı 0 bütün değerleri içeride, 1 bütün değerleri dışarıda üretir. Ara oranlarda kısa bir çalıştırmanın kesin hata içereceği söylenmez. Demo için garantili hata gerektiğinde FORCED_FAILURE kullanılır.

Hata kararı, yön ve değer üretiminin PRNG çağrı sırası sabitlenir. Olasılık karşılaştırması ve sayıya eşleme testlerde kontrol edilebilir olmalıdır. Testler rastgele örneklerin belli yüzdesinin mutlaka hatalı çıkmasına dayanmaz; kontrollü PRNG girdileri ve sabit beklenen diziler kullanır.

## Zamanlama

- İlk örnek, adımın `intervalMs` süresi sonunda planlanır; nominal süre `sampleCount × intervalMs` olarak hesaplanır.
- Bir adımda paralel ölçüm callback'leri veritabanına yarışarak yazılmaz.
- İşlem gecikirse örnek indeksi atlanmaz veya iki kez üretilmez.
- Her örnek gerçek UTC `recordedAt` ve adım başlangıcına göre monoton `elapsedMs` taşır.
- Karşılaştırma grafikleri her serinin kendi elapsedMs değerini kullanır; farklı aralıkları indeks eşitliğiyle eşleştirmez.
- İptal sinyali zamanlayıcıları durdurur; terminal durum kontrolü geç kalan callback'e karşı ayrıca uygulanır.

## Test kabulü

Sabit beklenen dizi, sınırlar, negatif değerler, eşit sınırlar, tek örnek, seed 0 ve en büyük seed doğrulanır. Demo hata noktası tam `0.600000` olmalıdır. Değer üretimi testlerinde gerçek zaman beklemek yerine kontrollü saat kullanılabilir; gerçek zamanlı davranış ayrıca entegrasyon/tarayıcı kontrolünde sınanır.

Henüz PRNG golden fixture'ı veya üretilmiş örnek verisi yoktur. Bunlar uygulama görevlerinin çıktısıdır.

## Özellik paketi 1 — yetkilendirilen ek sözleşme (2026-11-06)

Yeni Device kayıtları mevcut DC Power Module profiline bağlı izlenebilirlik nesneleridir. deviceId/batchNumber simülatör girdisi veya seed hesaplama kaynağı değildir; örnek dizisini/verdicti değiştirmez. Yeni profil/senaryo veya fiziksel cihaz bağlantısı eklenmez.

Birincil ayrıntılı sözleşme: [Özellik paketi 1](feature-pack-1-plan.md). Görev/durum kaynağı: [EX kartları](tasks/README.md). Çelişki halinde yeni davranışlar için paket sözleşmesi, korunacak davranışlar için mevcut temel sözleşme birlikte uygulanır; kapsam sessizce genişletilmez.
