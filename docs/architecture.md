# Mimari

Durum: Uygulama için planlanan mimari; henüz kurulup doğrulanmadı. İlgili görev: [P0-03](tasks/P0-03.md). Ürün kapsamı için [gereksinimler](requirements.md).

## Bileşenler ve akış

```text
Browser / Angular
  ├─ REST requests ───────────┐
  └─ EventSource / SSE ───────┤
                             ▼
                 Same-origin web proxy
                    ├─ Angular assets
                    └─ /api → NestJS
                                ├─ Auth / role guards
                                ├─ Plans / versions
                                ├─ Runs / executor / evaluator
                                ├─ Simulator
                                ├─ Events / replay
                                └─ Comparisons
                                      │
                                      ▼
                                  PostgreSQL
```

Tek repository, modüler NestJS uygulaması, Angular SPA ve PostgreSQL kullanılacak. Simülatör aynı API sürecinde çalışacak. Desteklenen dağıtım tek API sürecidir. Yeniden başlatmada yarım işler devam ettirilmez; INTERRUPTED olarak uzlaştırılır.

REST mutasyon/okuma işlemlerini, SSE sunucudan istemciye olay aktarımını taşır. Bir izleyicinin bağlantısı çalışma yürütücüsünün yaşam süresini belirlemez.

## Backend modülleri

| Modül | Sorumluluk |
|---|---|
| Auth | Login/logout/me, parola doğrulama, oturum, CSRF, rol guard'ları |
| Plans | Taslak kaydı, optimistic concurrency, Publish, sürüm okuma |
| Runs | Başlatma, snapshot, sıralı yürütme, iptal, kesinti, sonuç ve özetler |
| Simulator | Seed tabanlı saf ölçüm üretimi; senaryo uygulama |
| Events | Kalıcı olayları sıralı okuma; SSE, replay, heartbeat ve cleanup |
| Comparisons | Aynı planın terminal çalıştırmalarını kayıtlı verilerle eşleştirme |
| Common | DTO doğrulama, hata biçimi, request ID, zaman/sayı yardımcıları |
| Health | Liveness, veritabanı ve başlangıç uzlaştırmasını içeren readiness |

Controller HTTP sınırını yönetir; durum geçişleri ve transaction'lar servislerde uygulanır. Saf değerlendirme/üretim kodu HTTP'den ve Prisma'dan ayrılır. Genel amaçlı bir repository katmanı yalnızca arayüz çoğaltmak için eklenmez; gerçek test veya sınır ihtiyacı olduğunda kullanılır.

Backend ölçüm doğrulama, tolerans ve sonuç kararının kaynağıdır. İstemci sonucu seçemez; simülatör çıktısına da doğrulama uygulanır.

## Frontend sınırları

- Standalone, özellik bazlı lazy route'lar.
- `core`: auth, HTTP hata dönüşümü, ortak bağlantı altyapısı.
- `features/plans`: liste, typed FormArray editörü, sürüm akışı.
- `features/runs`: başlatma, Live Run, History ve Details.
- `features/comparisons`: seçim, fark tablosu ve iki serili grafikler.
- `shared`: tekrar kullanılan grafik, durum etiketi, boş/hata görünümü.
- RxJS facade/service katmanı görünüm durumunu yönetir. Bileşenlerde ikinci bir sonuç hesaplama motoru kurulmaz.
- OpenAPI istemci tipleri ayrı pakette üretilir; Prisma/Nest DTO'ları frontend'e import edilmez.

Ayrıntılar: [frontend.md](frontend.md).

## Surum adaylari

Araştırma tarihi 2026-11-03. Bu tablo proje içinde başarılı kurulum kanıtı değildir. P1-01 kurulum/derleme/test araçlarını doğrulayıp kesin patch sürümlerini lockfile'a sabitler.

| Bileşen | Başlangıç adayı |
|---|---|
| Node.js | 24 LTS; en az 24.15.0 ve seçilen paketlerle uyumlu güncel patch |
| TypeScript | 6.0.x; Angular compiler'ın izin verdiği aralık |
| Angular | 22.2.x; core/compiler/compiler-cli eşleşmeli |
| Material / CDK | 22.2.x; kendi aralarında uyumlu patch |
| RxJS | 7.8.x |
| NestJS | 12.x; common/core/platform/testing uyumlu |
| Prisma | CLI ve client 7.10.1; uyumlu adapter-pg ve pg |
| PostgreSQL | 18, sabitlenmiş konteyner sürümü |
| Chart.js | 4.x; araştırmada 4.6.1 |
| Annotation / zoom | Araştırmada 3.1.0 / 2.2.0; peer aralıkları doğrulanacak |
| Playwright | 1.64.x adayı; test paketi/tarayıcı sürümleri eşleşecek |

Workspace için npm workspaces ve tek lockfile kullanılacak. Derleyici/runtime modül ayarları NestJS ve Prisma adapter'ıyla birlikte P1-01'de doğrulanacak. Preview/RC sürüm kendiliğinden seçilmeyecek. Prisma'nın sürümsüz belgeleri farklı ana sürüme yönlenebildiği için v7 belgeleri kullanılacak.

Kaynaklar: [Node LTS](https://nodejs.org/en/about/previous-releases), [Angular uyumluluğu](https://angular.dev/reference/versions), [Angular compiler paket bilgisi](https://registry.npmjs.org/@angular%2fcompiler-cli/22.2.4), [Prisma CLI 7.10.1](https://registry.npmjs.org/prisma/7.10.1), [Prisma client 7.10.1](https://registry.npmjs.org/@prisma%2fclient/7.10.1).

## Kimlik doğrulama ve güvenlik

- Aynı origin altında session cookie kullanılır; URL'ye veya localStorage'a bearer token yazılmaz.
- Opaque, güçlü rastgele oturum anahtarının yalnızca hash'i Session tablosunda saklanır.
- Session cookie HttpOnly, SameSite=Lax ve Path=/ olur. Secure, HTTPS ortamında zorunludur; yalnızca belgelenmiş localhost demosunda kapalı olabilir.
- Başlangıç oturum süresi 8 saattir; otomatik süresiz uzatma yoktur.
- Parolalar Argon2id ile hash'lenir; kütüphane/parametreler P1-06'da doğrulanıp kaydedilir.
- Login JSON kabul eder, origin kontrolü uygular ve oturum kimliğini döndürmez.
- Kimlik doğrulanmış mutasyonlarda session'a bağlı CSRF token doğrulanır; Angular'ın XSRF cookie/header düzeniyle eşleştirilir.
- Logout oturumu sunucuda iptal eder ve cookie'yi temizler. Aktif SSE bağlantıları oturum kontrolünde kapanır; frontend kendi logout'unda hemen kapatır.
- Login denemelerine tek süreç kapsamına uygun hız sınırı uygulanır; yanlış kullanıcı/parola mesajları hesap keşfine izin verecek şekilde ayrıştırılmaz.
- Rol guard'ları bütün ilgili HTTP uçlarında uygulanır. UI guard'ı güvenlik sınırı sayılmaz.
- Loglar cookie, parola, CSRF token veya oturum anahtarı içermez.
- State değiştiren istekler ve snapshot query'leri DTO/parametre doğrulamasından geçer; sunucu alanlarının istemciden yazılması engellenir.

## Veri ve işlem sınırları

Ölçüm kaydı, adım/çalıştırma özeti ve RunEvent aynı transaction'da commit edilir. Simülasyon süresince açık transaction tutulmaz. Her örnek kısa bir işlemle yazılır.

Başlatma, adım ilerletme ve iptal gibi çakışabilen işlemler aynı çalıştırma satırında sıralanır. Aktif çalışma kuralı veritabanı benzersiz kısıtıyla korunur. Taslak kaydı optimistic revision kontrolü kullanır. Ayrıntılar: [data-model.md](data-model.md).

## Canlı akış

SSE dağıtımı için başlangıç yaklaşımı, RunEvent tablosunu cursor sonrası sıralı okuyup kısa aralıklarla takip etmektir. Bir HTTP stream'i için paralel ve üst üste binen sorgular açılmaz. Başlangıç takip aralığı 200 ms, heartbeat 15 saniyedir; bunlar ölçülmüş gecikme garantisi değildir.

Kalıcı olay dizisi replay kaynağıdır. Bellekte tek başına tutulan yayın kanalı, kaçırılmış olayların tek kaynağı olamaz. Proxy SSE tamponlamasını kapatır. Oturum süresi/revocation düzenli kontrol edilir. Snapshot ve cursor tutarlı okunur. Protokol: [api.md](api.md).

## Yerel teslim

Compose servisleri: PostgreSQL, tek seferlik migration/başlangıç işi, API ve Angular dosyalarını/proxy'yi sunan web servisi. API readiness, migration ve yarım iş uzlaştırması tamamlanmadan başarılı olmaz. Veritabanı named volume kullanır. Demo portu varsayılan `127.0.0.1:8080` olur.

Geliştirmede Angular dev proxy aynı `/api` sözleşmesini korur. Test veritabanı ayrıdır. Demo/test reset işlemleri geliştirme veritabanını kendiliğinden silmez.

## Maliyet ve teslim sinirlari

Ek altyapı maliyeti hedefi €0'dır. Yerel PostgreSQL ve simülatör kullanılır. İlk teslim sürekli bulut sunucusu veya alan adı gerektirmez. Kütüphane lisansları bağımlılık seçimi sırasında kontrol edilir.

GitHub Actions için standart Linux runner ve uygun ücretsiz kullanım koşulları kullanılır. Public repository standard runner hesaplaması ücretsizdir; artifact/cache koşulları ayrıca izlenir. Ücretli kullanım açılmaz; ücretsiz sınır yetersizse maliyet/kapsam kararı kullanıcıya getirilir. Büyük video ve sürekli başarılı test kayıtları CI artifact'ı olarak biriktirilmez. [GitHub Actions ücretlendirmesi](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

Docker Desktop kişisel kullanım koşulları kapsamında ücretsiz olabilir; kurulum belgesi lisans ön koşulunu belirtir. [Docker lisansı](https://docs.docker.com/subscription/desktop-license/)

## Teknik kararlar

[Karar dizini](decisions/README.md), bu mimarinin kısa karar kayıtlarını içerir. Mimari değişikliği ilgili karar, veri/API sözleşmesi, test ve görevlerle birlikte güncellenir.
