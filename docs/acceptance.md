# Nihai kabul listesi

Durum: **Henüz ürün kabulü yok.** Tüm kutular uygulama/test kanıtı gelene kadar boş kalır. Ürün gereksinimleri için [requirements.md](requirements.md), kontroller için [testing.md](testing.md).

## Ürün

- [ ] REQ-01: Uygulama ve kullanıcı mesajları İngilizce.
- [ ] REQ-02: Üç hazır hesap ve doğru login/logout/expiry davranışı.
- [ ] REQ-02: Roller UI ve API seviyesinde uygulanıyor (T16, T24).
- [ ] REQ-03–05: Dinamik adımlar ekleniyor, düzenleniyor, siliniyor ve sıralanıyor (T17).
- [ ] REQ-05: Sayısal hassasiyet, sınırlar ve toplam yük limitleri doğrulanıyor (T01–04).
- [ ] REQ-06: Taslak, Publish ve yeni sürüm akışı doğru (T18).
- [ ] REQ-07: Yayımlanmış sürüm ve geçmiş snapshot değişmiyor (T19).
- [ ] REQ-08–09: Üç senaryo ve deterministik değer dizileri çalışıyor (T07–08).
- [ ] REQ-10–11: Backend tolerans/sonuç kaynağı; hatadan sonra sonraki adım çalışıyor (T01–06).
- [ ] REQ-12: İkinci aktif çalışma ve duplicate başlangıç engelleniyor (T09–10).
- [ ] REQ-13: İptal kayıtları koruyor; terminal durumdan sonra örnek gelmiyor (T11).
- [ ] REQ-14: Backend kesintisi Interrupted; tekrar deneme yeni run (T12).
- [ ] REQ-15: Canlı ilerleme, replay, duplicate/gap yönetimi doğru (T13–16).
- [ ] REQ-16: History filtreleri ve Details kayıtlı kuralları gösteriyor.
- [ ] REQ-17–18: Grafikler ve erişilebilir ölçüm tablosu doğru (T25–26).
- [ ] REQ-19–20: İki run, sürüm/kimlik/birim/örnekleme farkları doğru karşılaştırılıyor (T19–23).
- [ ] REQ-21–22: Typed forms, RxJS yaşam döngüsü, klavye ve hata deneyimi doğrulandı.

## Teslim ve kanıt

- [ ] Backend birim ve PostgreSQL entegrasyon testleri geçti.
- [ ] Angular bileşen/servis testleri geçti.
- [ ] Ana Playwright senaryosu gerçek stack üzerinde geçti.
- [ ] Temiz veritabanı migration/seed kontrolü geçti (T27).
- [ ] Compose kapat/aç veri kalıcılığı kontrolü geçti (T28).
- [ ] Temiz checkout kurulum komutları gerçekten uygulandı.
- [ ] Demo hesapları ve örnek veriler belgeli ve kullanılabilir.
- [ ] OpenAPI ile gerçek API ve üretilen istemci uyumlu.
- [ ] GitHub Actions teslim commit'i üzerinde geçti.
- [ ] Test/coverage/süre sayıları gerçek raporlardan alınmış.
- [ ] README çalışan ekran görüntüsü ve gerçek demo bağlantısı içeriyor.
- [ ] Kısa video dosyası açılıyor; ana demo sonuçlarını gösteriyor.
- [ ] Belgeler, CI, görseller ve video aynı teslim sürümüyle ilişkilendirilmiş.
- [ ] Ek altyapı maliyeti hedefi korunmuş; onaysız ücretli hizmet yok.
- [ ] Kritik/yüksek önem inceleme bulgusu yok; diğer açık işler belgeli.
- [ ] Kullanıcı nihai kapsam ve ürün kabulünü verdi.

## Kabul kaydı

Kabul sırasında tarih, teslim commit'i, inceleyen kişi/oturum, kanıt dizini ve açık işler buraya gerçek bilgilerle eklenecek. Şu anda herhangi bir kabul kaydı veya CI bağlantısı yoktur.
