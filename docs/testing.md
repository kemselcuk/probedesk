# Test, inceleme ve teslim sözleşmesi

Durum: **Uygulandı ve yerelde doğrulandı; nihai ürün kabulü yok.** Backend birim/entegrasyon,
Angular TestBed, gerçek Chrome/Playwright ve Docker Compose teslim katmanları çalışır durumdadır.
P8-05 demo videosu kullanıcı kararıyla kapsam dışıdır; P8-06 sürüm adayı hazırlanmaktadır. Bu belge kapsam sözleşmesini ve gerçekten
çalıştırılan komutları kaydeder; çalıştırılmamış bir kontrolü geçmiş saymaz. Gereksinimler:
REQ-23–27.

## Test katmanları

| Katman | Araç yaklaşımı | Doğrulanacak davranış | Durum ve kanıt |
|---|---|---|---|
| Backend birim | Vitest; kontrollü saat/PRNG | kesin sayılar, değerlendirme, geçişler, üretim | **Uygulandı.** Son koşu: 16 dosya / 118 test ([verify](evidence/phase-8-docs.md)) |
| Backend entegrasyon | Vitest + Supertest + gerçek PostgreSQL | transaction, FK/unique, yarış, auth, snapshot, SSE | **Uygulandı.** Son koşu: 22 dosya / 197 test ([verify](evidence/phase-8-docs.md)) |
| Angular bileşen/servis | Vitest, TestBed, Material Harnesses | form/sıralama, HTTP hatası, RxJS reducer ve lifecycle | **Uygulandı.** Son koşu: 36 dosya / 370 test ([verify](evidence/phase-8-docs.md)) |
| Uçtan uca | Playwright, gerçek Angular/API/PG, gerçek Chrome | ana demo, canvas, oturum, reconnect ve route davranışı | **Uygulandı.** 2 senaryo geçti ([P7-01](evidence/phase-7-e2e.md), [P7-06](evidence/phase-7-ci.md)) |
| Teslim | Docker Compose temiz kurulum | migration, seed, kalıcılık, proxy/SSE ve doküman komutları | **Uygulandı.** Boş DB + `down`/`up` ([P8-03](evidence/phase-8-clean-install.md)) |

Prisma mock'u, veritabanı kısıtı/yarış testinin yerine geçmez. Canvas mock'u, gerçek
zoom/tooltip/tıklama kanıtı değildir. Testler uygulama kodunu tekrar etmek yerine dışarıdan görülen
davranış ve bağımsız beklenti kullanır. Fixture hazır sonuçları ana E2E'nin çalıştırması yerine
koymaz.

Kapsam dışı bırakılan doğrulamalar açıkça belirtilir: Safari/Firefox ve fiziksel mobil cihaz
tarayıcı testi yapılmadı; responsive kontroller gerçek Chrome'da 1280 px ve 768 px yerleşimlerle
sınırlıdır. Coverage yüzdesi, performans benchmark'ı veya kapasite ölçümü iddia edilmez.

## Test matrisi

Aşağıdaki matris tasarım sözleşmesidir; bir satırın kapsandığını gösteren gerçek kayıt ilgili görev
kartı ve `docs/evidence/` dosyasıdır. T27/T28 özellikle P8-03 teslim kanıtıyla eşleşir.

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

Ek sınırlar: sıfır adımlı draft, tek adımlı/tek örnekli plan, eşit min/max, negatif ölçüm, sayı
hassasiyeti, alan/karakter sınırları, en büyük toplam örnek/süre, bozuk UUID/cursor ve yetkisiz
taslak erişimi ilgili görevde doğrulanır.

## Test verisi ve zaman

Her test kendi kullanıcı/plan/run fixture'ına sahip olur veya kontrollü seri koşar. Uygulama
genelindeki tek aktif çalışma kuralı test paralelliğiyle ihlal edilmez. Farklı DB/schema kullanımı
açıkça yapılandırılır; `TEST_DATABASE_URL` veritabanı adı `_test` ile biter ve geliştirme
veritabanından farklı olmak zorundadır. Temizlik yalnızca test/demo olarak doğrulanmış bağlantıda
çalışır.

Saf simülasyon ve scheduler testlerinde sahte saat kullanılabilir. Gerçek SSE/HTTP akışı ve Docker
proxy en az bir gerçek zamanlı kontrolden geçer. Üretim koduna testleri hızlandırmak için gizli
doğrulama/sonuç bypass'ı eklenmez.

P3-01 golden değerleri algoritmadan bağımsız sabit beklentilerle kaydeder. Rastgele testler şansa
bağlı yüzdelere göre geçip kalmaz. E2E'ler sabit sleep dizilerine dayanmaz; gözlenebilir
durum/örnek/terminal olaylarını bekler. Playwright tek worker kullanır ve kendi benzersiz planını
oluşturup temizler; paylaşılan E2E veritabanı koruması ayrı veritabanı adı ister.

## Komutlar ve doğrulanma durumu

<a id="planlanan-komutlar"></a>

Aşağıdaki giriş noktaları kök `package.json` içinde tanımlıdır. "Doğrulandı" satırları gerçekten
çalıştırılmış ve çıktısı kanıta bağlanmış komutlardır; kısmi/çalıştırılmamış olanlar açıkça
işaretlidir. Son tam yerel doğrulama 2026-11-04 tarihinde bu çalışma ağacında yapıldı.

| Komut | Durum | Kanıt / not |
|---|---|---|
| `npm ci` | Doğrulandı (CI temiz checkout) | GitHub Actions `0d76dcf` (`v0.1.0-rc.3`, run `41918727810`); temiz checkout'ta doğrulandı ([P7-06](evidence/phase-7-ci.md#gerçek-github-actions-koşusu-2026-11-04)) |
| `npm run dev` | Script mevcut; kök komut yeniden çalıştırılmadı | P7 çalışmalarında Angular `ng serve` (:4200) ve API ayrı süreçlerde çalıştı; P8-04'te portlar başka süreçlerce kullanıldığı için kök komut tek parça çalıştırılmadı |
| `npm run lint` | Doğrulandı | API 144, web 113, api-client 2 dosya; 0 uyarı, 0 hata ([verify](evidence/phase-8-docs.md)) |
| `npm run typecheck` | Doğrulandı | API, web ve api-client temiz ([verify](evidence/phase-8-docs.md)) |
| `npm run build` | Doğrulandı | API `nest build`; web production build başarılı ([verify](evidence/phase-8-docs.md)) |
| `npm run test:api:unit` | Doğrulandı | 16 dosya / 118 test ([verify](evidence/phase-8-docs.md)) |
| `npm run test:web` | Doğrulandı | 36 dosya / 370 test ([verify](evidence/phase-8-docs.md)) |
| `npm run test:api:integration` | Doğrulandı | Gerçek `probedesk_test`; 22 dosya / 197 test ([verify](evidence/phase-8-docs.md)) |
| `npm run test:e2e` | Doğrulandı | Gerçek Chrome/API/PG; 2 senaryo ([P7-01](evidence/phase-7-e2e.md)) |
| `npm run openapi:check` | Doğrulandı | `OpenAPI contract is current` ([verify](evidence/phase-8-docs.md)) |
| `npm run db:migrate` | Doğrulandı | Development DB'de kök komut ([Phase 2](evidence/phase-2-plans-api.md)); delivery migration logu ([P8-01](evidence/phase-8-compose.md)) |
| `npm run demo:seed` | Doğrulandı | İki kez çalıştırıldı; ikinci kez 0 yeni kayıt ([P8-02](evidence/phase-8-seed.md)) |
| `npm run verify` | Doğrulandı | Lint + typecheck + birim + web + build + OpenAPI; çıkış 0 ([verify](evidence/phase-8-docs.md)) |

Toplu `verify` kullanıcı verisini resetlemez. Destructive demo reset ayrı, açık onaylı ve ortam
korumalı bir işlemdir; normal seed/verify/delivery akışının parçası değildir ve bu doğrulama turunda
paylaşılan geliştirme veritabanında çalıştırılmadı.

## CI

1. Lockfile ile kurulum ve sürüm kontrolü.
2. Lint ve iki uygulamanın tip kontrolü.
3. Backend birim ve Angular bileşen testleri.
4. Temiz PostgreSQL üzerinde migrate deploy ve entegrasyon.
5. OpenAPI/istemci güncellik kontrolü.
6. Production build ve gerçek uygulamayla Chromium Playwright.
7. Raporlar; hata durumunda trace/screenshot ve güvenli log.

İş akışı [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) altı iş içerir: `api_quality`,
`api_integration`, `web_quality`, `contract`, `e2e` ve `ci_required`. `ci_required` beş işin
sonucunu `success` ile karşılaştırır; `continue-on-error`, `|| true` veya koşulsuz başarılı adım
yoktur. Başarısız E2E/kalite işleri artifact üretir; retention 7 gündür.

**Gerçek koşu (2026-11-04):** sürüm adayı commit `0d76dcf`, tag `v0.1.0-rc.3`, `main` push,
[run 41918727810](https://github.com/kemselcuk/probedesk/actions/runs/41918727810) — API quality,
API integration, web quality, OpenAPI contract, Playwright E2E ve CI required işlerinin tamamı
başarılı. Bu koşu temiz checkout'ta `npm ci`, `.nvmrc` Node kurulumu, PostgreSQL servis health
check'i ve Chrome/Playwright başlatmasını kapsar ([kanıt](evidence/phase-7-ci.md#gerçek-github-actions-koşusu-2026-11-04)).

Standart Linux runner ve ücretsiz kullanım sınırları seçilir. Repository secret'ı veya ücretli
hizmet yoktur. Başlangıç artifact retention hedefi 7 gündür; büyük video ve başarılı koşuların
sürekli trace'i tutulmaz. Bu turda ölçülmemiş dakika, depolama veya kota sayısı yazılmamıştır;
hesap ayarlarındaki faturalama durumu ayrıca doğrulanmamıştır.

Sürüm adayı `v0.1.0-rc.3` etiketi `0d76dcf` commit'ine atanmıştır; etiket sonrası docs-only
commit'in CI koşusu da yeşildir. Mevcut yeşil koşu nihai ürün kabulü değildir; ürün kapsamı ve
yayın kararı kullanıcıdadır.

## Görev incelemesi

Her görevde ayrı inceleme geçişi yapılır. Paket: gereksinim/kabul ölçütleri, diff, test çıktısı ve
varsa çalışan UI/API kanıtı. İnceleme sadece geliştiricinin özetine dayanmaz.

Kritik/yüksek bulgu görevi kapatmayı engeller. Daha düşük bulgular düzeltilir veya kullanıcıya açık
gerekçe/takip kaydıyla ertelenir. Kodun mevcut sözleşmeyle uyuşmaması kapsamı sessizce değiştirmek
için gerekçe değildir. İnceleme tarihi, kimliği ve bulguları görev kartına kaydedilir; yapılmamış
inceleme yapılmış gibi işaretlenmez.

Görev akışı: `Planned → In Progress → In Review → Accepted`. Düzeltme gerekiyorsa `In Progress`e
döner. P1–P7 ve P8-01–P8-04 `Accepted`; P8-05 `Deferred (user decision)`; P8-06 `In Review` (kullanıcı ürün kabulü bekliyor).
P0 belgeleri `In Review` durumundadır ve bağımsız kullanıcı kabulü henüz kaydedilmemiştir.

## Kanıt

Test sayısı/süre yalnızca üretilen rapordan yazılır. Bir kontrol çalıştırılmadıysa nedeni ve durumu
açıkça belirtilir. Görüntü ve CI aynı teslim commit'ine bağlanır; video kapsam dışıdır. Bu doküman güncellemesinin
komut çıktıları [phase-8-docs.md](evidence/phase-8-docs.md) içinde; ekran görüntüleri, seed,
Compose ve CI kayıtları [kanıt dizininde](evidence/README.md) listelenir. Ayrıntılar:
[evidence/README.md](evidence/README.md).

Kaynaklar: [Angular typed forms](https://angular.dev/guide/forms/typed-forms), [Angular
Vitest](https://angular.dev/guide/testing), [Playwright CI](https://playwright.dev/docs/ci-intro).
