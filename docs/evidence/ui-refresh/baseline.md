# UI yenileme — gerçek başlangıç incelemesi

Tarih: 2026-11-04. İnceleyen: bu planlama oturumu. Ürün kodu değiştirilmedi.
Plan tabanı: `0d76dcf`; plan yazımı sırasında `16b31e3` doküman commit'i geldi. Delivery'nin görünümü mevcut CSS ile gözlendi; container image SHA bu tur ayrıca eşleştirilmedi.

## Yöntem ve kanıt

T3 browser preview ile `http://127.0.0.1:8080` Login, Test Plans, Run History, FAILED Run Details ve v1/v2 Compare incelendi. Planner demo hesabı kullanıldı. Plan/run oluşturulmadı, kullanıcı verisi/reset değiştirilmedi. Ayrı kamuya açık Grafana Play sekmesi yalnızca okundu. Her iki inceleme sekmesi kapatıldı; Sign out tıklaması timeout verdiği için sign-out gerçekleştiği iddia edilmez.

- [Plans 1280×800](plans-before-1280.png)
- [History 1280×800](history-before-1280.png)
- [Details 1280×800](details-before-1280.png)
- [Compare 1280×800](compare-before-1280.png)
- [Grafana referansı 1280×800](grafana-reference-1280.png)

History 768×1024'te ayrıca incelendi; DOM ölçümü `innerWidth=768`, `innerHeight=1024`, `document.scrollWidth=768`, tablo genişliği1266 ve üst kenarı y818 idi. 768 ekranının PNG'si bu dizine aktarılmadı; bu ölçümün yerel browser çıktısı alındı.

## Ölçümler

Browser computed-style / boundingClientRect çıktıları:

- ProbeDesk body14/20 px, h1 28/36, subtitle16/24.
- Toolbar64, sidenav272, navrow64, pagepadding32 px.
- Plans table header49 px, iki satırlı bodyrow68 px; hücre padding14×16 px.
- History 1280'de tabletop≈717 ve firstrowtop≈787; filtre kartı tek başına≈251 px.
- Details özet bölgesi≈679 px; ana içerik yüksekliği≈7930 px; grafik ilk görünümde yok.
- Grafana Play (`https://play.grafana.org/d/to6j8mh/grafana-play-home`): body Inter14/22, navrow32, topbar48, araç düğmeleri28 px.

Grafana screenshot'ı çalışan ProbeDesk çıktısı değildir; sadece tasarım referansıdır. Grafana'nın 320 px sidebar'ı kopyalanmayacak; az navigasyon öğesi olan ProbeDesk için224 px önerildi. Yeni plandaki hedef ölçüler henüz uygulanmadı veya test edilmedi.

## İnceleme sınırları

- Plan Editor ve aktif Live Run tarayıcıda bu tur çalıştırılmadı; SCSS/template sözleşmesi okundu. UI uygulayıcısı gerçek izole fixture ile ayrıca doğrulayacak.
- Kontrast,200%zoom,390px ve Firefox/Safari bu tur test edilmedi.
- Screenshot dosyaları gerçek browser snapshot'ıdır; resim düzenleme veya sahte veri ekleme yapılmadı.
- Uygulama build/test komutları bu planlama turunda çalıştırılmadı; sadece doküman/bağlantı/diff kontrolleri yapılacak.

## Plan paketinin doğrulaması

- Göreli Markdown bağlantı kontrolü (README + docs): **151 dosya, 1163 göreli bağlantı, 0 kırık**.
- Görev envanteri: **62 ilk paket + 8 UI = 70 kart**; UI-01–UI-08 durumları Planned.
- `git diff --check`: exit 0, whitespace hatası yok.
- Bu komutlar uygulama/UX kabulü değildir; plan paketinin dosya ve bağlantı tutarlılığını kontrol eder.
