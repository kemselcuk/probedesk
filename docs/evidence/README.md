# Doğrulama kanıtları

Bu dizin kanıt düzenini açıklar ve eklenen kanıt kayıtlarını listeler. Uygulama
testi, çalışan UI görüntüsü, coverage, CI sonucu veya demo videosu yalnızca
gerçekten üretildiğinde eklenir.

## Kayıtlar

- [P1-08 — İlk CI kontrolü](p1-08-ci.md): yerel doğrulama tamamlandı; gerçek
  GitHub Actions koşusu ve kontrollü başarısız kontrol gösterimi bekliyor.

## Kayıt biçimi

Gerçek kanıt eklendiğinde teslim commit'iyle ilişkilendirilir. Uygun bir alt dizin veya indeks kaydı şu bilgileri içerir:

- Commit SHA ve çalışma ağacında ek değişiklik olup olmadığı.
- Tarih, işletim sistemi/mimari ve ilgili sürümler.
- Görev/gereksinim/test kimlikleri.
- Çalıştırılan tam komut veya manuel kontrol adımları.
- Gerçek çıkış kodu ve sonuç.
- Ham rapor/log veya CI çalıştırması bağlantısı.
- Başarısız/atlanmış kontroller ve nedenleri.
- Görsel/video için temsil edilen commit ve manuel görüntüleme sonucu.

Örnek dizin tasarımı (henüz oluşturulmamıştır): `docs/evidence/<commit>/verification.md`. Büyük raporlar veya videolar için erişilebilir artifact/dosya bağlantısı kullanılabilir; retention ve ücretsiz depolama koşulları dikkate alınır.

## Doğruluk kuralları

Gerçek token/parola/cookie kaydedilmez. Başarısız çıktı gizlenmez. Çalıştırılmayan kontrol `Passed` olmaz. Coverage ve hız ölçümü uydurulmaz. Örnek ekran tasarımı çalışan uygulama kanıtı diye sunulmaz.

Doküman bağlantı kontrolü gibi kontroller uygulamanın çalıştığını kanıtlamaz. Her kontrol kendi kapsamıyla raporlanır.
