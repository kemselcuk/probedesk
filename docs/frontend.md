# Angular ekranları ve durum yönetimi

Birincil gereksinimler: REQ-03–06, REQ-15–22. Görev: [P0-04](tasks/P0-04.md). Backend eşit ağırlıktaki ürün parçasıdır; frontend geliştirmesi aşamalara dağıtılır.

## Yapı ve route'lar

Standalone bileşenler, feature route'ları ve Angular Material/CDK kullanılır. Typed Reactive Forms açık tercihidir; farklı form sistemiyle kendiliğinden değiştirilmez.

| Route adayı | Ekran | Ana davranış |
|---|---|---|
| /login | Login | hazır hesaplarla giriş |
| /plans | Test Plans | role uygun plan/sürüm listesi |
| /plans/:planId/edit | Plan Editor | Planner için mevcut taslak |
| /plans/:planId/versions/:versionId | Published Plan | sürümün salt okunur içeriği |
| /runs/new?versionId=... | Start Run | Operator senaryo/seed seçimi |
| /runs/:runId/live | Live Run | canlı ilerleme ve grafik |
| /runs | Run History | filtreler, sayfalama, iki kayıt seçimi |
| /runs/:runId | Run Details | kayıtlı kurallar ve ölçümler |
| /compare?leftRunId=...&rightRunId=... | Compare Runs | iki terminal çalıştırma |

Route kimlikleri backend'de doğrulanır. Guard'lar yalnızca kullanıcı deneyimi sağlar. Deep link ve yenileme aynı ekranı açar.

## Ortak ekran durumları

Her veri ekranında loading, empty, loaded, recoverable error, 401 ve 403/404 davranışı tanımlanır. Gönderim sırasında düğme durumu ve tekrar gönderim kontrolü bulunur. Kullanıcıya İngilizce, somut ve yapılabilir mesaj gösterilir; requestId ayrıntı olarak sunulabilir.

API hatası formu temizlemez. 409 taslak çakışması mevcut veriyi ezmez; kullanıcıya kaydın güncellendiği ve yeniden yüklemenin yerel değişikliklere etkisi açıklanır. Renk, durumun tek göstergesi değildir; etiket/ikon/metin de kullanılır.

## Plan Editor

- Non-nullable typed FormGroup ve typed FormArray; değer tiplerinde gerekçesiz any yok.
- Plan adı ve her adımın adı/birimi/min/max/sampleCount/intervalMs alanları.
- Ondalık alanlar girişte metindir; sunucu ondalık sözleşmesine uyarlanır.
- Alan ve grup seviyesinde doğrulama; adım bazında hata özeti.
- Ekle, sil, yukarı/aşağı taşı ve CDK drag-drop.
- FormArray'nin gerçek kontrol sırası taşınır; yalnızca görsel dizi değiştirilmez.
- Kimlikli track kullanılır; sıralamada touched/dirty/hata bilgisi başka adıma geçmez.
- Yeni kaydedilen adımların backend kimlikleri forma geri bağlanır.
- Save ve Publish ayrı işlemlerdir. Publish öncesi formun kaydedildiği açıktır.
- Kaydedilmemiş değişiklikte route ayrılma uyarısı; başarısız kayıtta girdiler korunur.
- Nominal toplam örnek ve süre özeti gösterilir; backend sınırları ayrıca uygular.
- Yayımlanmış sürümde edit kontrolleri yoktur; yeni taslak eylemi Planner'a sunulur.

## Start Run

Plan adı/sürüm ve adım özeti görünür. NORMAL için seed; FORCED_FAILURE için seed ve hata adımı; RANDOM için seed ve hata oranı bulunur. Yeni bir kullanıcı aksiyonu için idempotency anahtarı bir kez üretilir; aynı isteğin retry'ında korunur.

RUN_ALREADY_ACTIVE mevcut çalışmaya bağlantı sunar. Gönderim sonunda gerçek runId üzerinden Live Run'a geçilir. Başlatma veya iptal isteğinin başarı durumu tahmin edilmez.

## RxJS durumu ve canlı akış

Çalıştırma facade'ı HTTP snapshot ve SSE olaylarını birleştirir. Bileşen ağ protokolünü doğrudan yönetmez. Model; run snapshot, selectedStepId, selectedSampleIndex, connectionState ve request/error durumlarını içerir.

1. Snapshot ve cursor yüklenir.
2. Run terminal değilse cursor sonrasından EventSource açılır.
3. Olaylar sequence sırasıyla uygulanır; duplicate yok sayılır.
4. Sıra boşluğu/uzlaştırma gereği yeni snapshot okumasına yol açar.
5. Terminal durumda final snapshot gerekirse doğrulanır ve bağlantı kapanır.

Backend outcome ve örnek tolerans bayrakları kullanılır. Frontend ortalamadan sonuç veya yeniden tolerans kararı üretmez. Sayfa geçişinde takeUntilDestroyed/teardown uygulanır. Birden çok async aboneliği aynı run için birden çok EventSource üretmez. Ekrandan ayrılmak testi iptal etmez.

Bağlantı durumları: connecting, connected, reconnecting, disconnected, unauthenticated. Ağ kesilmesi ile oturum kaybı ayrılır. /auth/me kontrolü 401'i açıklığa kavuşturur; yeniden giriş gereğinde stream kapanır.

## Grafik bileşeni

Chart.js doğrudan bir Angular bileşen sınırının arkasında kullanılır. Annotation tolerans bandı/çizgilerini, zoom eklentisi yakınlaştırma/kaydırmayı sağlar. Uygulama genelinde tek bir kayıt/kurulum noktası bulunur.

- X ekseni ilgili adımın elapsedMs'i; Y ekseni kayıtlı ölçüm birimi.
- Her adım/birim ayrı grafik.
- Normal noktalar ile tolerans dışı noktalar farklı işaret/renk ve metin açıklamasıyla ayırt edilir.
- Tooltip: çalışma, adım, örnek sırası, değer/birim, elapsed ve gerekirse UTC zamanı.
- Başarısız noktaya seçim ilgili adımı ve tablo satırını açar.
- Klavye kullanıcıları için başarısız örnek listesi/bağlantısı aynı seçime ulaşır.
- Zoom, pan ve Reset View yalnızca görünümü değiştirir.
- Canlı çizim güncellemeleri gruplanabilir; durum deposuna örnekler eksiksiz alınır. Görsel güncelleme yavaşlatılırken veri düşürülmez.
- Bileşen kaldırılınca chart instance ve event listener'lar temizlenir.
- Boş/tek örnekli seri ve eşit min/max anlamlı gösterilir.
- Grafik yanında erişilebilir ölçüm tablosu bulunur.

Gerçek canvas etkileşimi Playwright ve görsel incelemeyle doğrulanır. TestBed içindeki canvas taklidi etkileşim kanıtı sayılmaz.

## History ve Details

Filtreler URL'de tutulur; filtre değişimi sayfayı birinciye getirir. Hızlı değişikliklerde eski HTTP yanıtı yeni seçimi ezmez. Liste ölçüm dizileri taşımaz. Details kayıtlı plan adı, sürüm, kurallar, seed/senaryo, zamanlar ve kısmi/nihai özetleri gösterir.

Cancelled/Interrupted/Error için eksik örnekler ve neden açıklanır; tamamlanan önceki adımların sonucu görünür. Run Again yalnızca Operator'a açıktır ve yeni kayıt oluşturur; eski seed/sürüm/ayarlar açıkça gösterilip senaryo değiştirilebilir.

## Compare Runs

İki farklı terminal kayıt ve tek plan şartı UI'da açıklanır; API tekrar doğrular. İki serinin ayrı etiketleri, toleransları ve aç/kapat düğmeleri vardır. Değişen alanlar işaretlenir. Birimi değişen adım iki ayrı panelde görünür; farklı örnekleme için indeks bazlı delta/interpolasyon yapılmaz. Eklenen/kaldırılan adımlar tek taraflı içerikle gösterilir; eksik taraf sıfırla doldurulmaz.

## Erişilebilirlik ve görünüm

Masaüstü odaklı; en az 1280 ve 768 px genişlikte temel iş akışı incelenir. Login, formlar ve adım taşıma klavyeyle kullanılabilir. Dialog açılış/kapanışında odak yönetilir. Hata metinleri alanlarla ilişkilendirilir. Responsive ve tarayıcı desteği yalnızca gerçekten kontrol edilen ortamlarla belgelenir; Safari/Firefox desteği kanıtsız iddia edilmez.
