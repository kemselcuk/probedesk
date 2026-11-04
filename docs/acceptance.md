# Nihai kabul listesi

Durum: **Henüz ürün kabulü yok.** Ürün gereksinimleri için
[requirements.md](requirements.md), kontroller için [testing.md](testing.md).

2026-11-04 notu: Aşağıdaki **teslim ve kanıt** bölümünde işaretli maddeler yalnızca doğrudan,
gerçek çıktıya bağlanmış teknik kontrollerdir. Ürün gereksinim kutuları, video ve kullanıcı nihai
kabulü açıktır; işaretli bir teknik kontrol ürün kabulü anlamına gelmez.

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

- [x] Backend birim ve PostgreSQL entegrasyon testleri geçti. — 2026-11-04: 16 dosya/118 test ve
  22 dosya/197 test ([kanıt](evidence/phase-8-docs.md)).
- [x] Angular bileşen/servis testleri geçti. — 2026-11-04: 36 dosya/370 test
  ([kanıt](evidence/phase-8-docs.md)).
- [x] Ana Playwright senaryosu gerçek stack üzerinde geçti. — 2 senaryo, gerçek Chrome/API/PG
  ([P7-01](evidence/phase-7-e2e.md)); CI E2E işi de geçti ([P7-06](evidence/phase-7-ci.md)).
- [x] Temiz veritabanı migration/seed kontrolü geçti (T27). — Boş `probedesk_delivery_check`
  veritabanında `migrate → seed → api → web` zinciri
  ([P8-03](evidence/phase-8-clean-install.md)).
- [x] Compose kapat/aç veri kalıcılığı kontrolü geçti (T28). — `down`/`up` sonrası 1 plan, 4 run,
  3 kullanıcı ve FAILED run 90/90 korundu ([P8-03](evidence/phase-8-clean-install.md)).
- [ ] Temiz checkout kurulum komutları gerçekten uygulandı. — CI temiz checkout'ta `npm ci`
  çalıştı; README'deki geliştirme akışı tek parça temiz bir makinede yeniden denenmedi.
- [x] Demo hesapları ve örnek veriler belgeli ve kullanılabilir. — Üç hesap, iki sürüm ve dört run
  seed/API ile doğrulandı ([P8-02](evidence/phase-8-seed.md), [demo](demo.md)).
- [x] OpenAPI ile gerçek API ve üretilen istemci uyumlu. — `npm run openapi:check` güncel;
  CI `contract` işi geçti ([verify](evidence/phase-8-docs.md), [CI](evidence/phase-7-ci.md)).
- [ ] GitHub Actions teslim commit'i üzerinde geçti. — `3d27f2f` için altı işin tamamı geçti, ancak
  docs/P8 değişikliklerini içeren nihai teslim commit'i henüz oluşmadı.
- [ ] Test/coverage/süre sayıları gerçek raporlardan alınmış. — Test sayıları ve süreler gerçek
  raporlardan; coverage yüzdesi iddia edilmiyor. Nihai paket P8-06'da kapatılacak.
- [ ] README çalışan ekran görüntüsü ve gerçek demo bağlantısı içeriyor. — Ekran görüntüleri var;
  demo videosu kullanıcı kararıyla kapsam dışıdır.
- [ ] Kısa video dosyası açılıyor; ana demo sonuçlarını gösteriyor. — Kullanıcı kararıyla kapsam dışı (video yok).
- [ ] Belgeler, CI, görseller ve video aynı teslim sürümüyle ilişkilendirilmiş. — P8-06 nihai
  commit bağlantısı bekliyor.
- [ ] Ek altyapı maliyeti hedefi korunmuş; onaysız ücretli hizmet yok. — Yerel Compose ve ücretsiz
  standart runner kullanılıyor; ücretli servis/secret yok. Hesap faturalama durumu ayrıca
  doğrulanmadı.
- [ ] Kritik/yüksek önem inceleme bulgusu yok; diğer açık işler belgeli. — P7/P8 bağımsız
  incelemeleri bekliyor.
- [ ] Kullanıcı nihai kapsam ve ürün kabulünü verdi.

## Kabul kaydı

Kabul sırasında tarih, teslim commit'i, inceleyen kişi/oturum, kanıt dizini ve açık işler buraya
gerçek bilgilerle eklenecek. Şu anda kullanıcı ürün kabulü, nihai teslim commit'i veya video kaydı
yoktur. Teknik doğrulama kayıtları [kanıt dizininde](evidence/README.md) listelenir; bunlar nihai
kabul yerine geçmez.
