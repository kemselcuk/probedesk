# ProbeDesk UI yenileme uygulama planı

- Tarih: 2026-11-04.
- Yetki: Kullanıcı mevcut görünümü beğenmediğini; padding, font ve bileşen ölçeklerinin olgun bir panel referansıyla yeniden tasarlanmasını ve yeni uygulama thread'inde uygulanmasını istedi.
- Durum: **UI-01–UI-08 uygulandı ve In Review; ayrı teknik inceleme ve kullanıcı görsel kabulü bekliyor.** Bu belge tek başına görsel kabul iddiası değildir; gerçek ölçüm ve ekran kanıtları [UI-08 kanıtındadır](evidence/ui-refresh/ui-08.md).
- Kullanıcı revizyonu (2026-11-05): [UI-10](tasks/UI-10.md) önceki tablo yoğunluğu kararını günceller: ölçüm tabloları içerik genişliğinde, 14/22 px metin ve 36 px veri satırı; Value sütunu kullanıcı takip talebiyle ortada; diğer sayılar sağda, tarih/durum solda. Genel “son kolon sağda” kuralı kullanılmaz. Panel/ilişkili kontrol/alt bölüm/ana bölüm ritmi 16/8/12/24 px. Önceki tablolar için 13/20 px ve 44 px ölçüler bu revizyonla değişmiştir.
- Başlangıç: Güncel `main`; R7 dahil son auth düzeltmelerini koru. Plan yazılırken son görülen commit `16b31e3` idi. İlk işlem `git status` ve `git log` ile güncel tabanı kaydetmektir.
- Birincil görsel sözleşme: Bu belge; davranış sözleşmesi [frontend.md](frontend.md) ve diğer mevcut ürün belgeleridir. Yeni görsel kararlar kullanıcı talebinin yetkilendirdiği kapsamdır.
- Sonuç hedefi: **Grafana'nın yoğun veri arayüzündeki disiplin + sade, açık renkli, modern bir ölçüm çalışma alanı.** Daha küçük ama okunabilir; daha az dekorasyon, daha güçlü hiyerarşi.

## 1. Okuma ve çalışma sırası

1. `AGENTS.md` ve [implementation-guide.md](implementation-guide.md).
2. [requirements.md](requirements.md), [measurement-rules.md](measurement-rules.md), [simulation.md](simulation.md).
3. [architecture.md](architecture.md), [data-model.md](data-model.md), [api.md](api.md), [frontend.md](frontend.md).
4. Bu planın tamamı ve [UI başlangıç kanıtı](evidence/ui-refresh/baseline.md).
5. UI-01–UI-08 kartları; bir kartı bir kerede uygula, kontrol et ve incelemeye hazırla.
6. [testing.md](testing.md), [demo.md](demo.md), [acceptance.md](acceptance.md). Önceki kabul edilen ürün davranışlarını görsel revizyonda bozma.

Bu çalışma sadece bir rapor yazmak veya öneri vermek değildir: yeni thread planı çalışan Angular uygulamasına uygulamalıdır. Teknik rutin kararlar için tekrar kullanıcı izni bekleme. Ürün kapsamı, ücretli hizmet veya backend davranışı değişikliği gerekirse ayrı ele al.

## 2. Gerçek başlangıç incelemesi ve referans

2026-11-04'te gerçek browser preview ile localhost delivery incelendi: Login, Test Plans, Run History, Failed Run Details ve v1/v2 Compare. History ayrıca 768×1024'te incelendi. Plan Editor ve aktif Live Run bu planlama turunda tarayıcıda çalıştırılmadı; SCSS/template sözleşmesi okundu, uygulayıcı gerçek fixture ile ayrıca kontrol edecek.

Olgun panel referansı: [Grafana Play](https://play.grafana.org/), o sırada açılan rota `https://play.grafana.org/d/to6j8mh/grafana-play-home`. Kamuya açık gerçek DOM/computed-style ölçümleri: Inter 14 px / 22 px; navigasyon satırı 32 px; üst araç çubuğu 48 px; araç eylemleri 28 px. Bunlar tek sayfa/sürüm gözlemidir, Grafana'nın evrensel tasarım token'ları değildir. Referansın marka, CSS, kaynak kod veya dark temasını kopyalama. ProbeDesk için aşağıdaki uyarlanmış ölçüler geçerlidir; özellikle kritik eylemleri Grafana'nın 28 px araç eylemleri kadar küçültme.

ProbeDesk gerçek 1280×800 başlangıç ölçümleri:

| Alan | Mevcut gözlem | Yeni hedef |
|---|---|---|
| Toolbar | 64 px | 52 px |
| Sidebar | 272 px | 224 px |
| Navigasyon satırı | iki satır, 64 px | tek satır, 36 px |
| Ana alan boşluğu | 32 px | 24 px, tablet 16 px |
| h1 | 28/36 px | 24/32 px, 600 |
| Sayfa açıklaması | 16/24 px, uzun teknik metin | 14/20 px, kısa görev açıklaması |
| Varsayılan alan | 56 px + alt rezerv | 40 px görsel kontrol; hata/hint gerektiği kadar |
| Düğme | 40 px ve tam pill | ana 36 px, toolbar 32 px; radius 6 px |
| Plans tablo başlığı | 49 px | 36 px |
| Plans çift satırlı kayıt | 68 px | 52–56 px |
| History | tablo üst kenarı y≈717, ilk kayıt y≈787 | ilk kayıt üst kenarı y≤400 |
| History 768×1024 | tablo üst kenarı y≈818 | ilk kayıt üst kenarı y≤560 |
| Details | 679 px özet kartı, sayfa yüksekliği ≈7930 px | kısa özet, adım/grafik önce; teknik bilgiler açılır |

History'nin 1266 px geniş tablosu 929 px içerikte yatay taşıyor. Amaç yazıyı okunmaz küçültmek değil: kolonları anlamlı gruplayarak ana bilgiyi ekrana sığdırmaktır. Sıfır seçimin kırmızı hata gibi görünmesi ve her sayfadaki uzun backend açıklamaları da kaldırılacak.

## 3. Kapsam ve değişmeyecek davranışlar

### Yapılacaklar

- Ortak tasarım token'ları, tipografi, Material yoğunluğu ve semantik renkler.
- Shell/sidebar/header, login, liste/editör/sürüm, start/live, history/details, compare, grafikler, dialog ve hata/boş/yükleniyor durumları.
- Bilgi hiyerarşisi ve aşamalı ayrıntı: önemli bilgi ilk görünümde; teknik açıklama ve ikincil metadata gerektiğinde açılır.
- 1440×900, 1280×800 ve 768×1024 düzenleri; ayrıca 390 px taşma kontrolü ve yüzde 200 zoom erişimi.
- Gerçek browser ölçümleri, önce/sonra ekran görüntüleri, mevcut davranışların regresyonu.

### Korunacaklar

- NestJS/PostgreSQL ölçüm kararı; decimal string hassasiyeti; snapshot immutability; run durumları; partial/cancel/recovery; üç rol; idempotency; CSRF; SSE replay/dedup/gap/session cleanup.
- Standalone Angular, Material/CDK, typed Reactive Forms, RxJS facade, Chart.js. UI framework'ü değiştirme; Tailwind/başka component paketi ekleme.
- Gerçek veri ve gerçek API. Mock metrik, sahte trend, yeni dashboard sayfası, kullanıcı yönetimi, global arama, export veya yeni endpoint üretme.
- İngilizce UI ve README; Türkçe plan/kanıt belgeleri. Video kapsam dışı; video üretme.
- Kullanıcı veritabanına fixture/reset uygulama; görsel demo için kullanıcının planlarını değiştirme.

## 4. Tasarım sistemi — tek kaynak

`apps/web/src/styles/` altında `_tokens.scss`, `_material-theme.scss`, `_primitives.scss` gibi küçük dosyalar önerilir; `styles.scss` bunları birleştirir. Adlar değişebilir, tek kaynak ilkesi değişmez. Layout, renk ve tipografi aynı token'ı kullanmalı; ekran başına yeni bir ölçek icat edilmemeli.

### 4.1 Tipografi

- Aile: yerel Inter tercih edilir, fallback mevcut system UI stack. Uygulama çalışma zamanında Google Fonts/CDN çağrısı yapma. Inter eklenirse resmi dağıtımdan yerel WOFF2, lisans dosyası ve kaynak kaydı; yeni npm paketi gerekmez. Font edinilemezse mevcut system UI ile devam et ve kanıta yaz; ücretli font kullanma.
- Global root 16 px kalsın; tasarım ölçüleri rem ile tanımlansın. `html {font-size: 12px}` gibi toptan küçültme ve `zoom/transform: scale` yasak.
- Normal metin 14/20 px, weight 400. Uzun açıklamalar 14/22 px olabilir.
- Tablo 13/20 px; alan etiketi/düğme/nav 13–14/20 px, weight 500.
- Metadata ve helper 12/16 px; kritik değer/alan/hata 12 px altına düşmez. Uzun metni 11 px'e sıkıştırma.
- h1 24/32 px 600; bölüm başlığı 16/24 px 600; alt bölüm 14/20 px 600; büyük sayısal özet en fazla 24/32 px.
- Satır aralığı/letter-spacing bilinçli: gövdede normal tracking; küçük bölüm etiketinde en fazla .04em. Her şeyi uppercase veya semibold yapma.
- Sayılar `font-variant-numeric: tabular-nums`; yalnız run id/seed gibi teknik alanlarda mono. Grafik tooltip ve tablo tam hassasiyeti gösterir; `0.600000` değerini ihlali gizleyen bir görsel yuvarlamayla değiştirme.

### 4.2 Boşluk, geometri, renk

- Boşluk ölçeği 4, 8, 12, 16, 20, 24, 32 px. 2 px yalnız border/ikon mikro hizası. Art arda 24+24+24 padding/margin birikmesine izin verme.
- Sayfa 24 px, kart içi 16 px, yoğun toolbar içi 12 px; bölüm arası 20–24 px; ilgili kontroller arası 8–12 px.
- Radius: kontroller 6 px, kart/dialog 8 px; sadece badge 999 px. Büyük pill sidebar ve tam yuvarlak düğmeleri kaldır.
- Zemin `#f6f8fb`, yüzey `#ffffff`, nav `#f8fafc`, border `#e2e8f0`, güçlü metin `#172033`, ikincil `#526074`.
- Primary `#2563eb`, hover `#1d4ed8`, seçim zemini `#eff6ff`; odak primary 2 px + 2 px offset.
- Passed `#166534` / `#f0fdf4`, Failed/Error `#b91c1c` / `#fef2f2`, Running `#1d4ed8` / `#eff6ff`, Interrupted `#92400e` / `#fffbeb`, Cancelled nötr slate. Her durumda metin/ikon da var.
- Renkler tasarım hedefidir; gerçek foreground/background kontrastını ölç. Normal metin 4.5:1, büyük metin ve gerekli kontrol sınırları 3:1. Gerekirse tonu düzeltip kanıta yaz.
- Kalıcı büyük gölgeler, gradient, glassmorphism, mor Material yüzeyleri, dekoratif KPI kartları yok. Kartlar 1 px border; gölge yalnız menu/dialog gibi gerçek katmanda hafif.
- Açık tema teslim et. Bu işe dark-mode toggle veya tema tercih altyapısı ekleme.

### 4.3 Material ve ortak component kontratı

- Angular Material 22'nin belgelenmiş Sass density/override API'lerini kullan. Global yaklaşık density -1; input için 40 px sağlayan component yoğunluğunu ayrıca ayarla; gerçek DOM'da doğrula. Sayı token'ını tahmin edip testi geçirmiş sayma.
- Ana düğme 36 px, yatay padding 12–16; ikincil/toolbar 32 px, padding 10–12. Touch/coarse pointer ve dar ekranda kritik hedef 44 px. Desktop 32–36 px görsel kontrolün en az 24×24 erişilebilir hedefi ve yeterli komşuluk boşluğu olmalı.
- İkon 16–18 px; ikon düğmesi 32–36 px. Tek ikonun erişilebilir adı zorunlu. Inline SVG veya mevcut ikon altyapısı; yeni ikon/CDN bağımlılığı yok.
- Input/select görsel kontrol 40 px, satır metni 14 px. Etiket kalıcı ve erişilebilir; placeholder tek etiket olmaz. Hint/error kırpılmaz; 40 px hedefi için `.mat-mdc-form-field-subscript-wrapper` gibi private DOM'u saklama.
- Standart boş alt alanları azaltmak için desteklenen dynamic subscript yaklaşımını kullan; validasyon geldiğinde komşu alan kaymasını grid hizasıyla yönet.
- Tek sayfa başlığı: title + kısa subtitle + sağda eylemler, altta 16 px boşluk. h1'i kart içinde tekrar yazma. Çok sayıda eşit primary düğme yok; bir ana eylem.
- Ortak badge 22–24 px, 12/16 px, border/ikon+metin. Büyük 34 px sonuç pill'lerini küçült.
- Kart başlığı 40–44 px bandında; kart içinde tekrar kart koyma. Metadata `dl` ile hizalı label/value, rastgele paragraf grubu değil.
- Dialog 440–560 px, viewport'tan en az 16 px güvenli pay; başlık 18/24, içerik 14/20; primary sağda, iptal yanında; başlangıç/focus trap/Escape/geri odak korunur.
- Loading sakin skeleton veya mevcut spinner+metin; ağır animasyon yok. Empty/error görünümü 160–240 px alan, kısa mesaj ve tek recovery eylemi. RequestId ve teknik açıklama ikincil açıklanabilir içerikte erişilebilir.
- `::ng-deep`, geniş `.mdc-*` private selector zincirleri, yaygın `!important`, inline style yamaları ve tüm uygulamayı CSS scale ile küçültmek kabul edilmez.

## 5. Ekran bazında kesin uygulama yönü

### 5.1 Shell ve navigasyon

- 52 px toolbar; solda logo/ürün adı 18/24 ve gerektiğinde breadcrumb, sağda kısa kullanıcı/rol ve hesap/çıkış. Sahte avatar veya bildirim sayacı ekleme.
- Desktop ≥1024 px: 224 px sidebar. Nav tek satır 36 px; 18 px ikon + 12 px gap + 14 px label. Açıklama satırlarını kalıcı görünümden çıkar; gerekiyorsa tooltip/erişilebilir açıklama.
- Test Plans / Run History / Compare Runs mevcut rotaları aynen korur. Aktif öğe 6 px radius, ince renkli işaret ve hafif seçim zemini.
- Sidebar'daki uzun 'Planner action…' açıklamaları kaldırılır; rol etiketi + eylem görünürlüğü yeterli. Mevcut New plan/Start run kısayolları korunabilir ama ana sayfa eylemiyle yarışan büyük pill olmaz. Sign out aşağıda net bir text action olur; unsaved guard korunur.
- <1024 px: sidebar kapalı overlay; hamburger 44 px hedef; açıldığında focus trap/Escape ve seçimde kapanma. Kontentin üstüne kalıcı olarak binme.
- Ana çalışma alanı tam kullanılabilir genişlik; en fazla 1600 px iç genişlik. Tek form sayfası için 960–1120 px okunabilir sınır, listeler/grafikler için tam alan. Birden çok iç içe max-width daraltması yok.
- Tek ana scroll sahibi; body ve shell-main'de aynı içerik için çift dikey scrollbar oluşturma.

### 5.2 Login ve ortak durumlar

- Nötr açık zemin; gradient yok. 400–420 px kart; 24 px iç boşluk; başlık 24/32; form alanları 40–44 px; ana buton 40 px, radius 6.
- Demo hesapları ayrı kompakt disclosure/section; e-posta ve parola kopyalanabilir metin; demo kimlik bilgilerini gerçek secret gibi başka yere taşıma. Mevcut İngilizce açıklama kısa kalır.
- Loading, invalid credentials, 429, network ve session-expired görünümü tasarımla uyumlu; hata sadece toast değildir, formda erişilebilir kalır.
- Not authorized / Not found / unsaved confirmation da ortak kontrol ölçülerini kullanır.

### 5.3 Test Plans ve Published Plan

- Kısa title/subtitle; New plan primary, Refresh secondary. Teknik 'API decides…' açıklamasını ürün yüzeyinden kaldır.
- Liste beyaz, 1 px border, 8 px radius. Başlık 36 px; tek satır 44 px, plan+profil çift satır 52–56 px. Sayısal alanlar sağ hizalı; eylemler kompakt; hover hafif.
- Sürüm ve draft badge'leri küçük, durum metni açık. Planner/Operator/Viewer farklı içerik hakları aynen korunur.
- Create form varsayılan açık dev kart değildir: mevcut New plan aksiyonuyla açılan kontrollü kompakt panel/dialog. Kapanırken form kaybı davranışını koru.
- Published görünümde plan adı + sürüm + salt-okunur etiketi ve yetkili eylemler üstte. Adımlar kompakt tablo; sürüm geçmişi aynı görsel dil. Yayınlayan/zaman ve sürüm bilgileri erişilebilir kalır.

### 5.4 Plan Editor

- Save draft / Publish ayrı kalır; dirty ve saving state küçük metin/badge. Mevcut 0 adım Publish engeli, error mapping, 409 ve unsaved guard korunur.
- Plan adı/profil üstte 2 kolon. Sürüm/örnek/süre özeti dört dev kart yerine tek kompakt metadata şeridi.
- Adım başlığı sıra+ad+unit+actions. Desktop'ta alanları 12 kolon mantığıyla iki mantıksal satıra yerleştir: ad/birim; min/max/count/interval. Label ve birim okunaklı; tüm adımı bir yatay taşan input masasına sıkıştırma.
- CDK drag handle ve klavyeyle yukarı/aşağı korunsun; yeni/invalid adım açık kalır. Dar ekranda 2 kolon, sonra 1 kolon. Min/max yan yana kalabiliyorsa kalsın.
- Silme ikonu erişilebilir ad alır; yanlışlıkla silinmeye karşı mevcut davranış korunur. Hata eski revision veya eski sıralamadan başka satıra bağlanmaz.
- Sticky eylem şeridi kullanılırsa içerik/focus örtülmez; kısa sayfada gereksiz ikinci toolbar oluşmaz.

### 5.5 Start Run ve Live Run

- Start: sol ana form (senaryo/seed/ilgili ayar), sağ plan sürüm/adım özeti; ≥1100 px yaklaşık 2:1. Daha darda alt alta. Üç senaryoya uymayan alanlar gizlenip payload'dan çıkarılmaya devam eder.
- Start primary 36 px; version ve beklenen süre/örnek sayısı kısa, canlı takip hedefi açık. Idempotency retry ve activeRun bağlantısı bozulmaz.
- Live: üstte plan/sürüm, küçük Running/terminal badge, connection state; ana içerik sırayla progress şeridi → adım listesi/aktif adım grafiği → son örnekler.
- Status, outcome ve bağlantı birbirine karıştırılmaz. SSE reconnect ve session loss ayrı görünür. Cancel destructive secondary; tıklamada iyimser terminal durum yazılmaz.
- Aynı anda üç uzun açıklama kartı yok. İş devam ettiği için kararsız layout zıplaması, aria-live spam veya her örnekte scroll reset olmaz.
- Terminal snapshot ayrıntısı yüklenemiyorsa mevcut unavailable uyarısı korunur; yeni tema hatayı gizlemez.

### 5.6 Run History

- Header yaklaşık 64 px. Filtre alanı kompakt iki satırı aşmasın: plan, status, outcome ilk satır; from/to + gerekli kısa UTC açıklaması ikinci satır. Büyük Filters başlığı ve URL davranışını anlatan paragraf kaldırılır veya help disclosure'a gider.
- Default boş seçim normal durumdur: gri 'Select two runs to compare' ipucu; kırmızı validasyon değildir. Gerçek farklı plan/running seçimi hatası belirgin olur.
- Karşılaştırma seçimi tek 40–44 px toolbar; seçilen kayıt sayısı ve Compare düğmesi. Büyük boş seçim kartı yok.
- Desktop kolonları: seçim, Result, Plan+version, Scenario+seed, Started UTC, Samples+out-of-tolerance, Details. Finished ve first-failure ayrıntıları mevcut detay sayfasında veya row disclosure'da hâlâ erişilebilir; alanları kaybetme. Başlıklarda 'Out of tolerance' okunur kısaltma kullanılırsa tam açıklama erişilebilir.
- Timestamp 2 satır olabilir; her hücreye uzun 'Nov 4, 2026, 5:52:29 PM UTC' tekrarı yerine kısa tutarlı UTC formatı. Tam timestamp tooltip/erişilebilir açıklamada mevcut.
- Çift satırlı history satırı 56–64 px; tablo başlığı 36 px. İlk kayıt üst kenarı 1280×800'de y≤400, 768×1024'te y≤560. Bunlar seeded normal 4 run durumunda ölçülür; gerçek hata banner'ı için daha uzun boy kabul edilir ve not edilir.
- 1280 px'de ana kolonlar için yatay scroll gerekmesin. 768'de sadece tablo kapsayıcısı gerekirse scroll olur, sayfa değil; 390'da kontrol şeridi sarılır. Semantik table/caption, klavye scroll erişimi ve seçim korunur.
- Filtre queryparam/page/back davranışı, eski yanıtı reddetme ve disabled compare kuralları değişmez.

### 5.7 Run Details

- Önce sonuç: plan/sürüm/status, örnek sayısı, ihlal sayısı, süre ve first failure. 679 px özet yerine yaklaşık 160–220 px özet alanı.
- Backend/simülatör sürümleri, seed, profile ve tam run id 'Run metadata' disclosure'unda erişilebilir. Profil/senaryo gereksiz yere iki kez yazılmaz. Sadece ilgili rol eylemleri gösterilir; büyük rol öğretici banner'ı normal durumda yok.
- Başarısız kayıtta ilk hatalı adım varsayılan seçilir; geçer kayıtta ilk adım. Seçili adım kural özeti + grafik + measurements tablosu. Diğer adımlar tab/listeden erişilir; tüm veriler saklanır, backend'i yeniden hesaplama.
- 1280×800'de ilk grafik alanı üst kenarı y≤520; kullanıcı 7–8 ekran metadata kaydırmadan ölçüme ulaşabilsin.
- 90 örnek ve üç adımın hepsini ilk render'da arka arkaya uzun açık tablolara dökme. Seçili adım veya açılır bölümler kullan; sample point→adım→satır yönlendirmesinde hedef bölüm otomatik açılır ve focus/scroll doğru yere gider.
- Tam altı ondalık, kendi toleransı, elapsedMs, partial-null istatistikler ve terminal durum açıklaması korunur.

### 5.8 Compare Runs ve grafikler

- Selection boş durumda iki eşit picker + kısa şart metni; seçim sonrasında kompakt left/right özet bantları. Her run için aynı bilgiyi içeren uzun 400 px kartlar yok.
- Swap sides / Change runs / Clear / Reload eylemleri tek sakin toolbar; hepsi outlined pill değil. Mevcut eylemler erişilebilir kalır; overflow menu kullanılırsa klavye ve label test edilir.
- 'Changed rules' özeti ve adım eşlemesi grafiklerden önce kısa şekilde görünür. Seçili adımın karşılaştırma grafiği öne alınır; metadata disclosure'a gider.
- Aynı birimde iki seri, ayrı etiket/renk/dash ve her run'ın kendi toleransı. Farklı birimler iki ayrı panel; ortak Y ekseni veya numeric delta üretme. Eklenen/silinen adımlarda boş taraf sıfırla doldurulmaz.
- Grafik yüksekliği desktop 280–320 px, 768'de 240–280 px; mobil en az 220 px. Chart parent `min-width:0`, responsive resize doğru; canvas için sabit pixel CSS ölçekleme yok, DPR destekli gerçek render.
- Eksen 11–12 px (gerekirse legend 12), tooltip 12–13 px; olay/ölçüm tablo metni en az12. Renk chart palette'sinde primary mavi ve karşı seri teal/amber gibi ayrışır; başarısız nokta kırmızı ve farklı işaret, tolerans bandı düşük opaklık.
- Zoom/pan/reset, tooltip, nokta seçimi ve klavye alternatifleri gerçek canvas ile kontrol edilir. Görsel sadeleştirme bu işlevleri silme gerekçesi değildir.

## 6. Uygulama sırası ve dosya sahipliği

Her kart ayrı coherent değişikliktir. Sonraki karta geçmeden ilgili kontrol/kanıt hazırlanır. Kartların tamamlanması kullanıcı görsel kabulü değildir; ayrı inceleme kaydı olmadan Accepted yapma. Bir görev In Review iken, aşağıdaki teknik çıktı bağımlılığı sağlandıysa sonraki kartın uygulamasına geçilebilir; Accepted kararı verilmez. Bu ek kampanyanın çalışma sırası, eski P1–P8'in geçmiş kabulünü değiştirmez.

| Kart | Kapsam | Ana yollar | Bağımlılık |
|---|---|---|---|
| [UI-01](tasks/UI-01.md) | Token, tipografi, Material ölçeği | styles.scss, styles/, shared/ui/ | Bu plan |
| [UI-02](tasks/UI-02.md) | Shell, login, ortak durum/dialog | layout/, auth sayfaları, shared/ui/ | UI-01 |
| [UI-03](tasks/UI-03.md) | Plans ve Published | features/plans liste/sürüm | UI-01,02 |
| [UI-04](tasks/UI-04.md) | Plan Editor | features/plans editör/form/dialog | UI-03 |
| [UI-05](tasks/UI-05.md) | Start Run ve Live | features/runs start/live, shared/charts | UI-02,04 |
| [UI-06](tasks/UI-06.md) | History ve Details | features/runs history/details | UI-05 |
| [UI-07](tasks/UI-07.md) | Compare ve ortak grafik cilası | features/comparisons, shared/charts | UI-06 |
| [UI-08](tasks/UI-08.md) | Responsive, erişilebilirlik, bütünleşik QA/teslim | web testleri, tests/e2e, docs/evidence | UI-01–07 |

Backend değişikliği normal olarak gerekmemeli. Bir UI ihtiyacı veri kontratı değişikliği istiyorsa önce mevcut verinin kullanılıp kullanılamadığını değerlendir; bu işe gizli backend kapsamı ekleme. Unit test fixture'ları/DOM selector güncellemeleri ilgili ekran commit'inde yapılır; tüm testleri sona bırakma.

## 7. Görsel ve işlevsel kabul matrisi

Her ekran: 1440×900, 1280×800, 768×1024. 390×844: shell/login/form taşma smoke. Gerçek browser ölçülerini `window.innerWidth/innerHeight` ile kaydet; resize tool dönüşünde eski viewport görünürse yeni snapshot/ölçüm bekle. Browser zoom/CSS zoom ile ekran görüntüsü ölçeğini taklit etme.

Kontrol edilen ekran/durumlar:
- Login default + invalid/network error; Test Plans Planner ve Viewer; Published Planner/Operator.
- Editor 0/3/30 adım, dirty/save, validation, 409, keyboard reorder ve CDK drag.
- Start NORMAL/FORCED_FAILURE/RANDOM, active run409, network retry aynı anahtar.
- Live RUNNING, failed terminal, reconnect, cancel ve partial/final-snapshot unavailable.
- History default4run, filtre, boş sonuç, 1/2 seçim, yanlış plan seçimi, eski yanıt yarışı.
- Details PASSED/FAILED/CANCELLED/INTERRUPTED/ERROR; sıfır örnek/null istatistik.
- Compare aynı sürüm, farklı sürüm, farklı birim, eklenen/silinen adım, eksik taraf.

Somut kriterler:
1. body/page düzeyinde yatay taşma yok (`scrollWidth <= clientWidth + 1`); gerçek tablolarda yalnız kendi wrapper scroll'u olabilir.
2. Düğme metni, input etiketi/değeri ve validation kırpılmıyor; 100 karakter plan/adım adı, uzun UUID/email, negatif ve büyük decimal ile sınanıyor.
3. Belirlenen ölçüler computed-style/rect ile kontrol ediliyor; ekran görüntüsü tek başına pixel ölçümü sayılmıyor. Metin wrap nedeniyle tablo satırı artabilir; nominal hedefi zorlamak için içerik saklanmaz.
4. 200% zoom'da kritik eylemler erişilebilir, overlay kapanır, sticky toolbar focus'u örtmez. Reduced-motion tercihi gözetilir.
5. 1280'de history ilk kayıt ve details ilk grafik üst kenarı belirtilen hedeflerde; diğer alanları saklamak yerine doğru disclosure kullanılır.
6. Tab order mantıklı, focus-visible belirgin; aria-live gereksiz tekrarlamaz; label/description bağları sağlam. Disabled, hover, focus, selected ve destructive durumları aynı dilde.
7. Sidebar/page/card başlıkları ve button/icon ölçüleri ekranlar arasında aynı token'ı kullanıyor; farklı kartlara özgü keyfi 18/22/26 px padding kalmıyor.
8. Chart örneği 0.600000 A / 0.550000 A ihlali tabloda/tooltip'te aynı; yeni görünüm sonucu değiştirmiyor.
9. Gerçek ölçüm hiçbir zaman tasarımın ihtiyacı için değişmiyor; fake '3.2% improvement' gibi metrikler yok.

## 8. Test, kanıt ve teslim

- UI-01–07: ilgili Angular testleri + typecheck + lint; paylaşılan theme/template etkisinde web build. Sadece token değişimi için implementation'ı kopyalayan anlamsız test yazma; ölçü/taşma/gerçek davranışı sınayan az ve anlamlı kontrol ekle.
- UI-08: `npm run verify`; `npm run test:api:integration`; izole E2E DB ile gerçek Playwright ana demo+compare. Önce package.json/testing'deki gerçek komutları oku; olmayan komutu varmış gibi belgeleme.
- Node `.nvmrc`, npm11.6.2; install gerekiyorsa pinned npm. Mevcut lockfile'ı gereksiz değiştirme. Font dışında dependency artışı beklenmiyor.
- İzole E2E hazırlığı ve baseline/cleanup kontrolleri mevcut `scripts/e2e-isolated.mjs`, `scripts/ci-e2e.mjs` ile; kullanıcı delivery DB'sinde test/reset yok.
- Gerçek browser görsel kontrolü gerekir. Kullanıcının açık UI talebi nedeniyle T3 preview araçları kullanılabilir; `preview_status` önce. Araç mevcut değilse doğru fallback'i ve hatayı kaydet; görsel doğrulama yapmadan 'looks good' deme.
- Her ekran için önce/sonra aynı viewport ve aynı seeded veriler; `docs/evidence/ui-refresh/` altında okunabilir gerçek PNG ve ölçüm JSON/Markdown. Kullanıcıya ait özel veri veya cookie/token kaydetme.
- Referans görüntüsü baseline belgesinde açıklanmıştır; Grafana screenshot'ını ProbeDesk sonucu diye kullanma. Taslak/mockup da çalışan uygulama kanıtı değildir.
- Kanıt kaydı: tarih, commit, süreç/URL/viewport, rol, komut ve exit code, test sayısı, ekran ölçüleri, açık bulgular, son kontrol edilen görünüm. Eski test sayısını yeni çalıştırma gibi kopyalama.
- Tasarım görsel kabulü otomatik test yeşilinden türetilmez. Ayrı teknik inceleme kaydı olmadan UI kartlarını Accepted yapma; tüm işler In Review olarak kullanıcıya sunulabilir.
- Her coherent adımda ilgili kontrollerden sonra commit ve hemen origin/main push; force/rewrite/tag taşıma yok. Yeni sürüm etiketi oluşturma görevi bu kampanyaya otomatik dahil değildir.
- Son mesaj: değişen ekranlar, referanstan uyarlanan ölçekler, gerçek testler/PNG bağlantıları, ertelenenler ve kullanıcı görsel kabulü bekleyenler. Sadece 'fontları küçülttüm' özeti yeterli değildir.

## 9. Uygulayıcı için bitiş kontrolü

- [x] UI-01–UI-08 ölçütleri uygulandı, her görev için gerçek kanıt var.
- [x] Tasarım tüm ekranlara taşındı; eski dev pill düğme/kart/rol öğretici blokları birkaç ekranda kalmadı.
- [x] History ve Details bilgi yoğunluğu hedefleri gerçek browser'da ölçüldü.
- [x] Form, rol, kaydetme/sürüm, CSRF/idempotency/SSE ve ölçüm/grafik etkileşimleri korunuyor.
- [x] Aktif run kullanıcı ekranından başlıyor, canlı izleniyor, failed örnek seçiliyor, normal run ve v1/v2 compare çalışıyor.
- [x] Yeni görünüm desktop/tablet ve keyboard ile tutarlı; okunurluk küçük font karşılığında feda edilmedi.
- [x] Mevcut user DB/volume korunuyor; video yok; ücretli servis yok.
- [x] Task kartları, indeks, roadmap ve frontend görsel sözleşmesi son gerçek durumu gösteriyor.
- [x] İşlev testleri ve görsel inceleme ayrı kayıtlı; kullanıcı nihai görünüm kabulü bekliyor.
