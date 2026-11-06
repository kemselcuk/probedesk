# Ölçüm ve yürütme kuralları

Birincil kaynak: REQ-05, REQ-10–14. Görevler: [P0-02](tasks/P0-02.md), [P3-05](tasks/P3-05.md), [P3-07](tasks/P3-07.md), [P3-08](tasks/P3-08.md).

## Girdi sınırları

Bunlar ayrıntılı planın teknik varsayılanlarıdır. Uygulama başlamadan P0 incelemesinde kesinleştirilir.

| Alan | Kural |
|---|---|
| Plan/adım adı | Trim sonrası 1–100 karakter |
| Birim | Trim sonrası 1–16 karakter; V, A, °C önerileri; otomatik dönüşüm yok |
| Taslak | 0–30 adım; kaydedilen mevcut adımlar geçerli olmalı |
| Yayımlama | 1–30 geçerli adım |
| Örnek sayısı | Adım başına 1–1.000 tamsayı |
| Ölçüm aralığı | Adım başına 100–5.000 ms tamsayı |
| Toplam örnek | Plan başına en fazla 10.000 |
| Nominal toplam süre | Σ(sampleCount × intervalMs) en fazla 600.000 ms |
| Tolerans değerleri | En fazla 6 ondalık; -1.000.000.000 ile +1.000.000.000 dahil |
| Tolerans ilişkisi | minimum ≤ maksimum |
| Seed | 0–4.294.967.295 tamsayı |
| Hata oranı | 0–1 dahil; en fazla 6 ondalık |

Formdaki tamamlanmamış satır kaydedilemez; sıfır adımlı bir taslak kaydedilebilir. Yeni boş satır kullanıcı hatasını göstermeden önce uygun touched/submitted davranışı kullanır.

## Sayısal sözleşme

- API, ölçüm ve toleransı ondalık metin olarak taşır: örnek `"0.600000"`.
- Bilimsel gösterim, boş metin, virgüllü API ondalığı, NaN ve Infinity kabul edilmez.
- Başlangıç/sondaki boşluk form sınırında temizlenir; API kanonik biçim doğrular.
- Minimum/maksimum ile ölçümler `NUMERIC(18,6)` olarak saklanır. Girdi tolerans sınırı daha dardır; simülatörün sınır dışına çıkması için alan bırakır.
- Altı basamaktan hassas girdi sessizce yuvarlanmaz, reddedilir.
- Ölçümün resmi sayısal değeri üretildikten sonra tolerans kararı için yuvarlanmaz.
- Karşılaştırma tam ondalık aritmetik veya ölçeklenmiş tamsayılarla yapılır. JavaScript kayan nokta eşitliğine dayanılmaz.
- Frontend çizim için sayı dönüşümü yapabilir. Durum/renk kararı backend'in `isWithinTolerance` alanından alınır.
- Görsel yuvarlama bir ihlali gizlememeli; tablo ve tooltip gerekli hassasiyeti göstermeli.

Kabul koşulu: `minimum ≤ measurement ≤ maximum`. Eşit minimum/maksimum tek bir kabul değeridir. Negatif değerler yukarıdaki aralıkta geçerlidir; fiziksel cihaz modeli kısıtı varsayılmaz.

## Çalıştırma durumu ve sonucu

| status | outcome | UI etiketi | Yeni ölçüm kabulü |
|---|---|---|---|
| RUNNING | null | Running | Evet |
| COMPLETED | PASSED | Passed | Hayır |
| COMPLETED | FAILED | Failed | Hayır |
| CANCELLED | null | Cancelled | Hayır |
| INTERRUPTED | null | Interrupted | Hayır |
| ERROR | null | Error | Hayır |

İzinli geçişler: `RUNNING → COMPLETED/CANCELLED/INTERRUPTED/ERROR`. Terminal durumdan başka duruma geçiş ve sürdürme yoktur. Yeniden çalıştırma yeni TestRun oluşturur.

## Adım durumu

Adım durumları: `PENDING`, `RUNNING`, `COMPLETED`, `CANCELLED`, `INTERRUPTED`, `ERROR`, `NOT_RUN`. `outcome`, yalnızca tamamlanan adım için `PASSED` veya `FAILED` olur; diğer durumlarda null'dır.

- Her adım tamamlanana kadar sıralı çalışır; sonraki adım önce başlamaz.
- Her örnek benzersiz, sıfır tabanlı `sampleIndex` taşır.
- İlk ihlal geldiği anda `hasOutOfTolerance=true` ve `firstFailureSampleIndex` korunur.
- Sonraki normal örnekler bu bilgiyi geri alamaz.
- Adımın bütün beklenen örnekleri kaydedilince sonucu hesaplanır.
- Bütün adımlar tamamlanınca genel sonuç hesaplanır. En az bir başarısız adım genel sonucu FAILED yapar.
- Eksik örnekle COMPLETED/PASSED üretilemez.

## İptal ve yarışlar

İptal isteği ve ölçüm kaydı aynı çalıştırma satırı üzerinde sıralanır. İlk commit edilen terminal durum korunur. İptal commit'inden sonra yeni ölçüm veya sonraki adım yazılamaz; daha önce commit edilmiş örnekler korunur.

İptalde aktif adım CANCELLED, başlamamış adımlar NOT_RUN olur. Tamamlanan adımların sonuçları korunur. İptal tamamlanmış bir teste geç ulaşırsa cevap mevcut terminal snapshot'ı döndürür; sonucu CANCELLED yapmaz. Tekrarlanan iptal güvenli ve idempotenttir.

Frontend iptal tıklamasını gerçek iptal sonucu gibi göstermez; sunucu yanıtı/olayını bekler. İstek başarısızsa kullanıcıya hata verilir ve gerçek duruma dönülür.

## Kesinti ve teknik hata

- Tek API süreci desteklenir. Başlangıçta kalan RUNNING kayıtlar readiness açılmadan INTERRUPTED olarak kapatılır.
- Ölçümler ve tamamlanan adımlar korunur; aktif adım INTERRUPTED, başlamamış adımlar NOT_RUN olur.
- Kontrollü uygulama kapanışında da mevcut çalışma tamamlanmış gibi gösterilmez.
- Geçersiz simülatör çıktısı, yürütme hatası ve kalıcı kayıt hatası tolerans ihlaliyle aynı şey değildir.
- Kayıt mümkünse çalışma ERROR, aktif adım ERROR olur ve teknik neden saklanır.
- Veritabanı erişilemiyorsa başarı/iptal kaydı yazılmış gibi davranılmaz. Yeni çalışma kabulü durur; readiness başarısızdır. Yeniden başlangıç uzlaştırması kalan RUNNING kaydı INTERRUPTED yapar.
- Oturumun sona ermesi, SSE bağlantısının kopması veya ekrandan ayrılma testi durdurmaz.

## İlerleme ve özetler

İlerleme kalıcı örnek sayıları üzerinden hesaplanır. Genel örnek ilerlemesi `recorded / expected` değeridir; durum etiketinin yerine geçmez. İptal edilen çalışma, kaydedilen kısmi yüzdeyi ve Cancelled durumunu birlikte gösterir.

Adım özetleri alınan/beklenen örnek sayısı, tolerans dışı örnek sayısı, ilk ihlal ve mevcutsa minimum/maksimum/ortalama içerir. Örnek yoksa sayısal istatistikler null'dır. Kısmi özetler açıkça işaretlenir; eksik değer sıfırla doldurulmaz.

Tolerans ve sonuç kararı backend'e aittir. Frontend'in kendi tolerans kontrolü yaparak sunucu sonucunu değiştirmesi kabul edilmez.

## Özellik paketi 1 — yetkilendirilen ek sözleşme (2026-11-06)

Cihaz/parti metadata ve analitik özetler resmi ölçüm/tolerans kararını değiştirmez. Dashboard pass rate yalnız COMPLETED outcome üzerinden; iptal/kesinti/error ayrı sayılır. Kayıtlı decimal değerler CSV/JSON/raporda korunur; frontend yeniden verdict hesaplamaz.

Birincil ayrıntılı sözleşme: [Özellik paketi 1](feature-pack-1-plan.md). Görev/durum kaynağı: [EX kartları](tasks/README.md). Çelişki halinde yeni davranışlar için paket sözleşmesi, korunacak davranışlar için mevcut temel sözleşme birlikte uygulanır; kapsam sessizce genişletilmez.
