# Test, inceleme ve teslim sözleşmesi

Durum: Plan. Aşağıdaki uygulama testleri henüz çalıştırılmadı. Gereksinimler: REQ-23–27.

## Test katmanları

| Katman | Araç yaklaşımı | Doğrulanacak davranış |
|---|---|---|
| Backend birim | Jest; kontrollü saat/PRNG | kesin sayılar, değerlendirme, geçişler, üretim |
| Backend entegrasyon | Supertest + gerçek PostgreSQL | transaction, FK/unique, yarış, auth, snapshot, SSE |
| Angular bileşen/servis | Vitest, TestBed, Material Harnesses | form/sıralama, HTTP hatası, RxJS reducer ve lifecycle |
| Uçtan uca | Playwright, gerçek Angular/API/PG | temel demo, canvas, oturum, reconnect ve route davranışı |
| Teslim | Docker Compose temiz kurulum | migration, seed, kalıcılık, proxy/SSE ve doküman komutları |

Prisma mock'u, veritabanı kısıtı/yarış testinin yerine geçmez. Canvas mock'u, gerçek zoom/tooltip/tıklama kanıtı değildir. Testler uygulama kodunu tekrar etmek yerine dışarıdan görülen davranış ve bağımsız beklenti kullanır. Fixture hazır sonuçları ana E2E'nin çalıştırması yerine koymaz.

## Test matrisi

| Kimlik | Senaryo | Beklenti | Ana görev |
|---|---|---|---|
| T01 | Minimuma eşit ölçüm | Geçer | P3-05 |
| T02 | Maksimuma eşit ölçüm | Geçer | P3-05 |
| T03 | Sınırın bir hassasiyet birimi dışı | Başarısız | P3-05 |
| T04 | Geçersiz/sonlu olmayan veri | Girdi reddi veya yürütmede teknik hata | P1-03, P3-08 |
| T05 | Hatalı örnekten sonra normaller | İhlal bilgisi ve FAILED kararı korunur | P3-05 |
| T06 | İkinci adım başarısız | Üçüncü adım devam eder | P3-05 |
| T07 | Aynı seed/ayarlar | Sabit beklenen değer dizisi | P3-01 |
| T08 | Hata oranı 0 ve 1 | Kesin uç davranışları | P3-02 |
| T09 | Eşzamanlı iki başlangıç | Bir kabul, bir 409 | P3-04, P7-03 |
| T10 | Aynı başlangıcın tekrarı | Aynı run, ikinci kayıt yok | P3-04 |
| T11 | İptal/ölçüm yarışı | Terminal durumdan sonra yazma yok | P3-07, P7-03 |
| T12 | Beklenmedik süreç kapanışı | Veriler korunur, INTERRUPTED | P3-08, P7-03 |
| T13 | SSE kesilip geri gelir | Kayıp/çift örnek yok | P4-06 |
| T14 | Snapshot sırasında olay | Tutarlı cursor ve eksiksiz final | P4-06 |
| T15 | Aynı olay tekrarlanır | İkinci kez uygulanmaz | P4-03 |
| T16 | İzlerken oturum biter | Kontrollü kapanış/login; test devam eder | P4-05, P4-07 |
| T17 | Sıralama ve yeniden yükleme | Form/API/DB sırası aynı | P2-05, P2-08 |
| T18 | Eski taslak revizyonu | 409; sessiz veri ezme yok | P2-02, P2-08 |
| T19 | Yeni sürüm yayımlama | Eski snapshot ve sonuç aynı | P6-06 |
| T20 | Adım adı/sırası değişir | Kimlikle doğru eşleşme | P6-01, P6-06 |
| T21 | Sil ve aynı adla yeniden ekle | Yeni adım olarak görünür | P6-05, P6-06 |
| T22 | Birim/örnekleme farkı | Yanıltıcı eksen veya örnek çıkarma yok | P6-05 |
| T23 | Kısmi sonuç karşılaştırması | Eksikler açık; null sonuç sıfır/Passed olmaz | P6-05 |
| T24 | Rol dışı HTTP işlemi | Backend reddi | P1-06, P7-02 |
| T25 | Zoom/pan/reset | Yalnızca görünüm değişir | P5-05, P5-06 |
| T26 | Hata noktası seçimi | Doğru adım/örnek açılır | P5-05, P5-06 |
| T27 | Boş DB kurulumu | Migration ve seed tamamlanır | P8-03 |
| T28 | Compose yeniden başlama | Plan/geçmiş korunur | P8-03 |

Ek sınırlar: sıfır adımlı draft, tek adımlı/tek örnekli plan, eşit min/max, negatif ölçüm, sayı hassasiyeti, alan/karakter sınırları, en büyük toplam örnek/süre, bozuk UUID/cursor ve yetkisiz taslak erişimi ilgili görevde doğrulanır.

## Test verisi ve zaman

Her test kendi kullanıcı/plan/run fixture'ına sahip olur veya kontrollü seri koşar. Uygulama genelindeki tek aktif çalışma kuralı test paralelliğiyle ihlal edilmez. Farklı DB/schema kullanımı açıkça yapılandırılır. Temizlik yalnızca test/demo olarak doğrulanmış bağlantıda çalışır.

Saf simülasyon ve scheduler testlerinde sahte saat kullanılabilir. Gerçek SSE/HTTP akışı ve Docker proxy en az bir gerçek zamanlı kontrolden geçer. Üretim koduna testleri hızlandırmak için gizli doğrulama/sonuç bypass'ı eklenmez.

P3-01 golden değerleri algoritmadan bağımsız sabit beklentilerle kaydeder. Rastgele testler şansa bağlı yüzdelere göre geçip kalmaz. E2E'ler sabit sleep dizilerine dayanmaz; gözlenebilir durum/örnek/terminal olaylarını bekler.

## Planlanan komutlar

Bu komutlar henüz mevcut değildir. Oluşturulduklarında her biri doğru çıkış kodu vermeli ve README'ye ancak gerçek çalıştırma sonrasında kullanım olarak eklenmelidir.

| Komut | Sözleşme |
|---|---|
| npm ci | Lockfile'dan temiz kurulum |
| npm run dev | Web/API geliştirme; veritabanı ön koşulu açık |
| npm run lint | İki uygulama ve ortak paketler |
| npm run typecheck | İki uygulama ve istemci tipleri |
| npm run build | Production web/API build |
| npm run test:api:unit | Backend saf davranış testleri |
| npm run test:api:integration | Ayrı PostgreSQL üzerinde entegrasyon |
| npm run test:web | Angular non-watch testleri |
| npm run test:e2e | Playwright gerçek uygulama senaryoları |
| npm run openapi:check | Sözleşme ve üretilen istemci farkı |
| npm run db:migrate | Kayıtlı migration'ları uygulama |
| npm run demo:seed | İdempotent demo hazırlığı |
| npm run verify | Lint/typecheck/test/build/sözleşme teslim kontrolleri |

Toplu verify kullanıcı verisini resetlemez. Destructive demo reset ayrı, açık onaylı ve ortam korumalı işlemdir. Compose demo girişi host Node gerektirmez; kesin komutlar P8-03'te doğrulanır.

## CI

1. Lockfile ile kurulum ve sürüm kontrolü.
2. Lint ve iki uygulamanın tip kontrolü.
3. Backend birim ve Angular bileşen testleri.
4. Temiz PostgreSQL üzerinde migrate deploy ve entegrasyon.
5. OpenAPI/istemci güncellik kontrolü.
6. Production build ve gerçek uygulamayla Chromium Playwright.
7. Raporlar; hata durumunda trace/screenshot ve güvenli log.

P1-08 erken kalite kontrollerini kurar. P7-06 gerçek stack pipeline'ını tamamlar. P8-03 release Compose düzenini ayrıca sınar. Kontrolleri yeşil göstermek için continue-on-error veya koşulsuz başarılı adım kullanılmaz. Tekrarla geçen testler sessizce güvenilir kabul edilmez; flaky durum görünür raporlanır.

Standart Linux runner ve ücretsiz kullanım sınırları seçilir. Başlangıç artifact retention hedefi 7 gündür; büyük video ve başarılı koşuların sürekli trace'i tutulmaz. Saklama/kota ayarları hesap koşullarıyla doğrulanır; ücretli hizmet etkinleştirilmez.

## Görev incelemesi

Her görevde ayrı inceleme geçişi yapılır. Paket: gereksinim/kabul ölçütleri, diff, test çıktısı ve varsa çalışan UI/API kanıtı. İnceleme sadece geliştiricinin özetine dayanmaz.

Kritik/yüksek bulgu görevi kapatmayı engeller. Daha düşük bulgular düzeltilir veya kullanıcıya açık gerekçe/takip kaydıyla ertelenir. Kodun mevcut sözleşmeyle uyuşmaması kapsamı sessizce değiştirmek için gerekçe değildir. İnceleme tarihi, kimliği ve bulguları görev kartına kaydedilir; yapılmamış inceleme yapılmış gibi işaretlenmez.

Görev akışı: Planned → In Progress → In Review → Accepted. Düzeltme gerekiyorsa In Progress'e döner. P0 belgeleri mevcut olduğu için In Review'dur; bağımsız teknik/kullanıcı kabulü henüz kaydedilmemiştir.

## Kanıt

Coverage/test sayısı/süre yalnızca üretilen rapordan yazılır. Bir kontrol çalıştırılmadıysa nedeni ve durumu açıkça belirtilir. Görüntü, CI ve video aynı teslim commit'ine bağlanır. Ayrıntılar: [evidence/README.md](evidence/README.md).

Kaynaklar: [Angular typed forms](https://angular.dev/guide/forms/typed-forms), [Angular Vitest](https://angular.dev/guide/testing), [Playwright CI](https://playwright.dev/docs/ci-intro).
