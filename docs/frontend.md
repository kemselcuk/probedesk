# Angular ekranları ve durum yönetimi

Birincil gereksinimler: REQ-03–06, REQ-15–22. Görev: [P0-04](tasks/P0-04.md). Backend eşit ağırlıktaki ürün parçasıdır; frontend geliştirmesi aşamalara dağıtılır.

## Kullanıcı tarafından yetkilendirilen görsel yenileme

2026-11-04 UI yenilemesi için ölçü, tipografi, renk, bileşen ve ekran düzeninin ayrıntılı hedefi [UI yenileme planıdır](ui-modernization-plan.md). UI-01–UI-08 uygulandı ve ayrı teknik inceleme/kullanıcı görsel kabulü için In Review durumundadır; mevcut ekran davranışları aşağıdaki sözleşmede kalır. Yeni plan görsel yerleşimi ve açıklama hiyerarşisini değiştirdi; backend/verdict/rol/API davranışı değişmedi.

Uygulanan görsel sistem: `styles/_tokens.scss`, `_material-theme.scss` ve `_primitives.scss`; 52 px toolbar, 224 px sidebar, 36 px nav satırı, 24 px sayfa / 16 px kart boşluğu, 40 px form kontrolü, 36 px primary / 32 px araç düğmesi, 6–8 px radius ve 14/20 gövde tipografisi. Ölçümler ve ekran bazlı sonuçlar [UI-08 kanıtındadır](evidence/ui-refresh/ui-08.md).

2026-11-05 kullanıcı geri bildirimi düzeltmeleri [UI-09](tasks/UI-09.md): native dropdown'lar yerine Material select; tüm container tıklanabilir, uzun seçeneklerde8px dikey boşluk. History'de ISO tarih girişini ve UTC [from,to) sözleşmesini koruyan Material datepicker vardır. Ortak tablolarda iki dış kenar16px, son kolon sağ hizalı; rozet24px ve floating label görünür12px. Compare seçim panelinde açıklama→kontrol16px, kontrol→not12px; helper metinlerde20px line-height ve4px üst boşluk. Gerçek doğrulama ve8080 teslimi [kanıttadır](evidence/ui-refresh/ui-09.md).

2026-11-05 ikinci kullanıcı revizyonu [UI-10](tasks/UI-10.md), tablo düzenini veri türüne göre tanımlar. `_data-tables.scss` ölçüm (720 px), karşılaştırma kuralı (768 px), tek taraflı kural (416 px), Published adımları (768 px) ve karışık adım verisi (984 px) varyantlarını içerir. Genişlikler seed veri için nominaldir; uzun içerik kırpılmak yerine yerel kaydırma alanında kalır. Ölçüm birimi başlıkta; sayısal başlık/değerler sağda, tarih ve durum soldadır. UTC zaman `yyyy-MM-dd HH:mm:ss.SSS`, tam ISO `datetime/title` ile korunur. Metin 14/22 px ve tek satır veri 36 px; çok satırlı liste/eylemler gerektiği kadar büyür. UI-09'daki genel son kolon sağ hizası bu veri türüne dayalı kuralla değiştirilmiştir. Ortak panel/ilgili kontrol/alt bölüm/ana bölüm boşluk ritmi 16/8/12/24 px; metadata label/value 4 px. [Doğrulama](evidence/ui-refresh/ui-10.md).

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

Masaüstü, 1440×900, 1280×800, 768×1024 ve 390×844 smoke gerçek Chrome ile kontrol edildi; 200% zoom 640×400 layout karşılığıyla sınandı. Login, formlar, adım taşıma, adım sekmeleri, grafik seri kontrolleri ve dialog akışları klavyeyle kullanılabilir. Dialog açılış/kapanışında ve overlay navigasyonda odak yönetilir; Escape overlay'i kapatır ve odağı toggle'a döndürür. Hata metinleri alanlarla ilişkilendirilir. Responsive ve tarayıcı desteği yalnızca gerçekten kontrol edilen ortamlarla belgelenir; Safari/Firefox ve fiziksel mobil cihaz desteği kanıtsız iddia edilmez.
