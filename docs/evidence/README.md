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
- [Phase 4 SSE canlı akış demosu](phase-4-demo.md): replay/cursor protokolü,
  iki sekmeli canlı akış, gerçek upstream kesintisi ve yeniden bağlanma.
- [Faz 4 inceleme düzeltmeleri — web](phase-4-review-fixes-web.md): H-01
  sonsuz reconnect, M-03 final snapshot, M-01 gerçek kesinti kanıtı ve M-02
  görev/kanıt güncellemeleri.
- [Phase 4 kalan yeniden inceleme maddeleri](phase-4-remaining-checks.md): N-01
  commit izlenebilirliği, P4-06 gerçek snapshot/olay yarışı ve P4-07 gerçek
  SPA dönüşü, Sign out ve sunucu tarafı expiry kanıtı.
- [Phase 5 geçmiş ve grafikler](phase-5-history-api.md), [karşılaştırma API](phase-6-compare-api.md),
  [karşılaştırma UI](phase-6-compare-ui.md) ve [entegrasyon](phase-6-integration.md): History,
  Details, grafikler ve sürüm karşılaştırması.
- [Phase 6 incelemesi](phase-6-review.md) ve [Phase 7 incelemesi](phase-7-review.md): bağımsız
  teknik incelemeler ve düzeltme kontrolleri.
- [Phase 7 E2E](phase-7-e2e.md), [güvenlik/yarış](phase-7-security-race.md),
  [erişilebilirlik](phase-7-accessibility.md), [test izolasyonu](phase-7-test-isolation.md) ve
  [CI](phase-7-ci.md): ana demo, güvenlik, erişilebilirlik, izolasyon ve gerçek Actions koşuları.
- [Phase 8 Compose](phase-8-compose.md), [seed](phase-8-seed.md), [temiz kurulum](phase-8-clean-install.md),
  [dokümanlar](phase-8-docs.md), [inceleme](phase-8-review.md) ve [sürüm adayı](phase-8-release.md):
  yerel teslim, demo verisi, kalıcılık, doküman doğrulaması ve RC paketi.
- [Genel kod incelemesi düzeltmeleri](general-review-fixes.md): auth oturum yarışları, CSRF
  kurtarma, UUID kanonikleştirme, Start→Live navigasyonu ve nginx özel port yönlendirmesi.

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

## UI yenileme başlangıcı

[Gerçek başlangıç UI incelemesi](ui-refresh/baseline.md): localhost Plans/History/Details/Compare ekranları ve Grafana Play referans ölçüleri. Uygulama ve son ölçümler [UI-08 kanıtında](ui-refresh/ui-08.md); UI-01–UI-08 In Review ve kullanıcı görsel kabulü bekliyor.

[UI-09 kullanıcı geri bildirimi düzeltmeleri](ui-refresh/ui-09.md): tam yüzey dropdown, takvim, tablo kenarları, rozet ve metin aralıkları; gerçek web/Playwright/8080 kanıtı.

[UI-10 içerik odaklı tablolar ve panel ritmi](ui-refresh/ui-10.md): gerçek Grafana Table Panel Showcase referansı, 28 responsive ölçüm, tam hassasiyet ve 4 gerçek E2E kontrolü.
