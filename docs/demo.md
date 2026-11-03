# Hazır veriler ve demo

Görevler: [P8-02](tasks/P8-02.md), [P8-05](tasks/P8-05.md). Durum: Plan; seed veya video henüz üretilmedi.

## Örnek veri sözleşmesi

- Roller: Planner, Operator, Viewer; üç hazır hesap. E-posta/parola değerleri P1-06/P8-02'de yalnızca yerel demo kimlik bilgileri olarak belgelenecek; şu anda gerçek hesap yoktur.
- Tek profil: DC Power Module.
- Üç adımlı plan: [simulation.md](simulation.md) tablosu.
- Seed başlangıç örneği: 42.
- Hazır geçmiş: normal Passed, kesin hata Failed, farklı toleranslı yeni sürüm ve en az bir kısmi kayıt.
- Hazır ölçümler aynı değerlendirme koduyla oluşturulmalı; veritabanına rastgele Passed/Failed etiketleri yazılmamalı.
- Seed idempotent olmalı: mevcut kullanıcı planını, yayımlanmış revision'ı veya eski run'ı değiştirmemeli. Çakışan fixture sessizce ezilmez.
- Demo reset yalnızca açıkça seçilmiş demo ortamını sıfırlar; genel başlangıç veya verify komutu reset içermez.

## Ana demo

| Adım | Kullanıcı işlemi | Görünmesi gereken sonuç |
|---|---|---|
| 1 | Planner giriş yapar | Plan oluşturma ve edit yetkileri |
| 2 | Yeni üç adımlı plan oluşturur; bir adımı taşıyıp son sırayı kaydeder | Sıra ve bütün alanlar yeniden açıldığında aynı |
| 3 | v1'i Publish eder | Immutable v1 ve salt okunur görünüm |
| 4 | Operator giriş yapar; FORCED_FAILURE, seed 42, Current Draw seçer | Live Run açılır |
| 5 | İkinci adımın 15. örneği gelir | 0.60 A, 0.55 A üst sınırı dışında işaretlenir |
| 6 | Üçüncü adım tamamlanır | Çalıştırma COMPLETED/FAILED |
| 7 | Hata noktası seçilir; zoom/reset kullanılır | Doğru adım ve ölçüm satırı açılır |
| 8 | Aynı v1 NORMAL ile yeni run olarak başlatılır | COMPLETED/PASSED |
| 9 | İki v1 run karşılaştırılır | İki seri ve sonuç farkı |
| 10 | Planner yeni taslakta Current Draw üst sınırını 0.65 A yapıp v2 yayımlar | v1 değişmez, adım kimliği korunur |
| 11 | Operator v2 ile NORMAL çalıştırır | Karşılaştırılabilir üçüncü terminal run oluşur |
| 12 | Eski v1 hatalı run tekrar açılır | Üst sınır hâlâ 0.55 A; 0.60 A hâlâ ihlal; sonuç Failed |
| 13 | v1 hatalı run ile v2 normal run karşılaştırılır | İki sürümün kendi toleransları ve farkları görünür |

Sürümler arası karşılaştırma için v2 run oluşturmak zorunludur; yalnızca v2 yayımlamak iki çalıştırma sağlamaz.

## Tamamlayıcı kabul demoları

Ana videoya sığması zorunlu değildir; test/inceleme kanıtı gerekir.

- Devam eden çalışma iptal edilir: yeni ölçüm gelmez, eski örnekler kalır.
- İkinci başlangıç reddedilir ve mevcut çalışmaya bağlantı sunulur.
- Ağ geçici kesilir; SSE geri gelince son örnek sayısı aynı olur.
- API zorla kapanıp açılır: Interrupted ve kayıtlı ölçümler görülür.
- Viewer doğrudan API mutasyon isteği gönderir: reddedilir.
- Sürüm değişiminde adım rename/reorder, ekleme/silme ve birim farkı doğru görünür.

## Video kabulü

Yaklaşık 3–5 dakikalık kısa video hedeflenir. İngilizce UI görünür; ses zorunlu değildir, gerekiyorsa kısa İngilizce açıklamalar kullanılabilir. Video bütün ana sonuçları görünür kılmalı; kesme/hızlandırma hatanın ardından devam eden adımı veya sürüm korunmasını gizlememelidir.

Dosya yerelde açılmalı; başlangıç/bitiş oynatılmalı, metinler okunmalı, kullanılan commit ve ortam kanıt kaydında belirtilmelidir. README'ye yalnızca gerçek dosya/link eklenecek. Hosting gerekiyorsa ücretsiz seçenek ve kullanıcı yayın kararı esas alınacak; büyük dosya/ücretli depolama varsayılmayacak.
