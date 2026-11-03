# Doğrulama kanıtları

Bu dizin kanıt düzenini açıklar ve eklenen kanıt kayıtlarını listeler. Uygulama
testi, çalışan UI görüntüsü, coverage, CI sonucu veya demo videosu yalnızca
gerçekten üretildiğinde eklenir.

## Kayıtlar

- [P1-08 — İlk CI kontrolü](p1-08-ci.md): gerçek GitHub Actions koşuları
  kaydedildi; yeşil koşu ve kontrollü başarısız kontrol gösterimi tamamlandı.
- [Phase 1 bağımsız teknik incelemesi](phase-1-review.md): P1-01–P1-07
  verdict'leri ve bulgular; B1 yüksek önemli cookie bulgusu dahil.
- [Phase 1 çalışan uygulama demosu](phase-1-demo.md): gerçek Chrome'da
  klavye turu, login/yenileme/logout ve ekran görüntüsü.
- [Phase 2 plan yaşam döngüsü demosu](phase-2-demo.md): API yaşam döngüsü,
  gerçek Chrome'da salt okunur v1, yeni taslak editörü ve iki sekmeli stale-revision kontrolü.
- [Faz 2 inceleme düzeltmeleri](phase-2-review-fixes-api.md) ve
  [web düzeltmeleri](phase-2-review-fixes-web.md).
- [Phase 3 simülasyon ve yürütme demosu](phase-3-demo.md): NORMAL/FORCED_FAILURE,
  iptal, Run Again, süreç kesintisi recovery ve gerçek Chrome kontrolleri.

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
