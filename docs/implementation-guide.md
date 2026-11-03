# Uygulamaya başlangıç rehberi

Bu repository bir uygulama sözleşmesi, görev paketi ve Phase 1 iskeletini içerir. npm workspace kurulumu, Angular kabuğu, NestJS API, PostgreSQL/Prisma temeli, oturum/CSRF/rol yetkilendirmesi, OpenAPI istemcisi ve ilk CI pipeline'ı çalışır durumdadır; plan editörü ve sonraki ürün akışları henüz yoktur. Bu belgenin varlığı kendi başına ücretli hizmet kullanma talimatı değildir.

## Önce okunacaklar

1. [Belge dizini ve durum](README.md).
2. [Ürün/roller](requirements.md), [ölçüm kuralları](measurement-rules.md), [simülasyon](simulation.md).
3. [Mimari](architecture.md), [veri modeli](data-model.md), [API](api.md), [frontend](frontend.md).
4. [Yol haritası](roadmap.md), [görev dizini](tasks/README.md), [test sözleşmesi](testing.md).

Uygulama İngilizce, README İngilizce, bu plan belgeleri Türkçedir. Kullanıcıyla Türkçe iletişim kurulur. Öğretici dersler ve mülakat soru listeleri teslim kapsamına dahil değildir.

## Başlangıç noktası

Kullanıcı uygulamayı başlatmanı istediğinde önce P0-01–P0-05 belgelerini mevcut halleri üzerinden incele. Bu görevlerin çıktı taslakları bu belge paketinde vardır; aynı dosyaları sebepsizce yeniden üretme. Açık çelişki varsa çöz; ürün kapsamı değişiyorsa kullanıcıya getir. Kabul edilmemiş işleri yapılmış olarak işaretleme.

P0 kabulünden sonra ilk uygulama görevi [P1-01](tasks/P1-01.md)'dir. Ardından [roadmap.md](roadmap.md) sırası ve görev bağımlılıkları izlenir. Tek seferde bütün projeyi üretme.

## Her görev için çalışma sözleşmesi

1. Görev kartını, bağımlılık durumlarını ve bağlantılı birincil sözleşmeleri oku.
2. Mevcut repository'yi incele; kullanıcının değişikliklerini koru.
3. İşi tek, incelenebilir davranışla sınırla; başka aşamanın ekranını/altyapısını kendiliğinden ekleme.
4. Görevin değişiklik alanını ve gerçek durumunu kartta güncelle.
5. İlgili davranışa anlamlı test yaz; DB/canvas/akış gerçekliğinin gerektiği kontrolleri mock ile ikame etme.
6. İlgili kontrolleri çalıştır; çalışmayanları dürüstçe kaydet. Gerçek çıktıyı commit/ortamla ilişkilendir.
7. İnceleme için diff, kabul maddeleri ve kanıt paketini hazırla. Kritik/yüksek bulguları kapat.
8. Ayrı inceleme kaydı olmadan görevi Accepted yapma. Aşama demosunu ayrıca doğrula.
9. Değişen sözleşme, görev durumu, indeks ve teknik kararları aynı değişiklikte güncelle.

Görev kendi başına incelenemeyecek kadar büyürse alt görevlere böl; bağımlılık ve kabul eşlemesini koru. Teknik rutin kararlar mevcut sözleşme içinde çözülebilir; nihai kapsam ve ürün kabulü kullanıcıdadır.

## Korunacak temel kurallar

- Tek profil, tek simülatör, tek API süreci ve tek aktif çalışma.
- Backend ölçüm doğrulama, durum ve sonuç kaynağı.
- Published planlar ve eski run kuralları immutable.
- Aynı plan içindeki adımlar kalıcı kimlikle eşleşir.
- İptal/kesinti kısmi veriyi korur; tekrar deneme yeni run'dır.
- SSE kopması testi durdurmaz; replay/dedup/gap uzlaştırması gerekir.
- Backend ve Angular görevleri aşamalar boyunca birlikte ilerler.
- Ek altyapı maliyeti €0 hedefi; onaysız ücretli hizmet yok.
- Çalışmayan kurulum, test veya demo tamamlandı diye yazılmaz.

## Sonraki uygulama oturumuna verilebilecek başlangıç metni

> ProbeDesk için docs/implementation-guide.md dosyasını ve gösterdiği sözleşmeleri oku. Önce P0 belgelerinin inceleme durumunu değerlendir. Kabul edilmemiş konuları açıkça belirt. Kullanıcının onayladığı küçük görevlerle ilerle; ilk uygun uygulama görevi P1-01. Tek seferde bütün projeyi üretme. Her görevde kabul ölçütlerini, gerçek test çıktısını ve ayrı inceleme kaydını koru. Uygulama dili İngilizce, benimle iletişim Türkçe olsun. Ücretli hizmet kullanma.

## Teslim

[acceptance.md](acceptance.md) tamamlanmadan ürün bitmiş sayılmaz. Nihai paket çalışan UI/API, hazır veriler, doğrulanmış yerel kurulum, otomatik testler, gerçek README kanıtları ve kısa demo videosunu içerir. Kullanıcıya ait yayın/nihai kabul kararı otomatik verilmez.
