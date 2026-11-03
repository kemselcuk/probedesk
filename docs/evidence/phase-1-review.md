# Phase 1 bağımsız teknik incelemesi

- Tarih: 2026-11-03
- İnceleme kapsamı: P1-01 … P1-07. P1-08 kapsam dışıdır (hâlâ In Progress).
- İnceleme commit'i: `413f938` (`docs: record green CI run and controlled failure setup`).
- İnceleme yöntemi: Görev kartlarındaki kanıt bölümleri esas alınmadan kaynak kod, migration'lar ve testler okundu; komutlar yeniden çalıştırıldı; gerçek API'ye karşı geçici bir portta saldırgan/negatif HTTP kontrolleri yapıldı.
- Ürün kodu değiştirilmedi. Yalnızca bu dosya (`docs/evidence/phase-1-review.md`) yazıldı. Geçici oturumlar dışında veri oluşturulmadı/değiştirilmedi; oluşturulan oturumlar silindi.

> **Bu belge bağımsız bir teknik incelemedir; ürün sahibinin/kullanıcının ürün kabulü değildir.** Hiçbir görev bu inceleme nedeniyle `Accepted` yapılmamıştır. Phase 1 kabulü, aşağıdaki yüksek/orta bulgular kapatılmadan verilmemelidir.

## Özet verdict

| Görev | Verdict | Kısa gerekçe |
|---|---|---|
| P1-01 | **PASS with findings** | Workspace, sürüm kilidi, lint/typecheck/build/testler çalışıyor. `npm ci` inceleme talimatı gereği yeniden koşulmadı. Karttaki Prisma maddesi hâlâ işaretsiz; P1-02 bunu fiilen kapsıyor. |
| P1-02 | **PASS with findings** | Boş geçici DB'ye iki migration da uygulandı; UUID/timestamptz/unique/FK doğru; reset guard'ı var. Ancak persistence-check ve test setup guard'ında ciddi ortam koruması boşlukları var (B4, B5). |
| P1-03 | **PASS with findings** | Ortak hata/validation/health davranışı testlerden geçiyor. Readiness migration kontrolü yapmıyor (B2); DB yokken login 500 dönüyor, sözleşmedeki 503 değil (B3). |
| P1-04 | **PASS with findings** | Route'lar, deep link testleri, build ve Ingilizce metinler iyi. Klavye kabul kriteri kartta açık (`[ ]`); tam klavye/ekran okuyucu doğrulaması yapılmadı. Bu haliyle `Accepted` olamaz (B13). |
| P1-05 | **PASS with findings** | `openapi:check` yeşil; deterministik üretim ve drift mantığı doğru. Hata `code` alanı OpenAPI'de enum değil, üretilen istemcide `string` (B8). |
| P1-06 | **FAIL** | Yüksek önemli cookie güvenliği bulgusu: production modunda `Secure` olmayan session cookie kabul ediliyor (B1). Ayrıca rol matrisi yalnızca test fixture'ında doğrulanıyor; ürün endpoint'i yok. |
| P1-07 | **PASS with findings** | Login/guard/CSRF/tek gönderim akışı testlerden geçiyor; gerçek API'de login/logout 200/204. Tarayıcı tabanlı form/yenileme smoke'u yapılmadı; elle tutulan auth modeli ve ölü 401 dalı var (B9, B10). |

**En yüksek önem:** B1 (High). **Critical** bulgu bulunmadı. B1 kapatılmadan P1-06 ve dolayısıyla Phase 1 kabul edilemez.

## Bulgular

### B1 — High — Production'da session cookie `Secure` olmadan gönderilebiliyor

- Dosyalar: `apps/api/src/config/env.ts:21-26`, `apps/api/src/auth/cookie.ts:29-45`, `apps/api/test/auth.e2e-spec.ts:137`, `.env.example:8`
- Gözlenen: `NODE_ENV=production SESSION_COOKIE_SECURE=false` ile API başlatıldı; login yanıtındaki cookie:
  `probedesk_session=…; Max-Age=28800; Path=/; Expires=…; HttpOnly; SameSite=Lax`
  — `Secure` yok. `SESSION_COOKIE_SECURE` şeması yalnızca `"true"|"false"` kabul ediyor ve varsayılanı `"false"`; production'da `false` olmasını engelleyen bir kontrol yok. E2E testi de varsayılan olarak `Secure` **yokluğunu** doğruluyor.
- Beklenen: `docs/architecture.md:104` — "Secure, HTTPS ortamında zorunludur; yalnızca belgelenmiş localhost demosunda kapalı olabilir." P1-06 kartı `docs/tasks/P1-06.md:21` cookie ayarlarının sözleşmeye uyduğunu iddia ediyor.
- Etki: HTTPS sonlandıran bir proxy arkasında yanlışlıkla `SESSION_COOKIE_SECURE=false` bırakılırsa oturum cookie'si HTTP üzerinden taşınabilir; session ele geçirme riski. Mevcut yerel demo HTTP olduğu için geliştirme varsayılanı makul, ancak production'da sessizce kabul edilmesi güvenlik açığıdır.
- Öneri: `NODE_ENV=production` ve `SESSION_COOKIE_SECURE!==true` ise `loadEnv` başlangıcı durdursun; testte production+false reddi ve production+true `Secure` davranışı doğrulansın. `.env.example` yalnızca localhost notuyla `false` kalsın.

### B2 — Medium — Readiness, migration/startup recovery hazır olmadan 200 dönüyor

- Dosya: `apps/api/src/health/health.service.ts:26-30`
- Gözlenen: Test konteynerinde migration uygulanmamış boş bir veritabanı oluşturuldu; API bu DB'ye bağlandığında `GET /api/health/ready` **200** `{"status":"ok","checks":{"database":"ok"}}` döndü. Tek kontrol `SELECT 1`.
- Beklenen: `docs/api.md:41` — readiness "DB + migration/startup recovery hazır" olmalı, 200/503. Migration'lar uygulanmamışken readiness'in yeşil olması, orchestration'ın hazır olmayan API'ye trafik göndermesine yol açar; login/plan uçları 500 verir.
- Öneri: Readiness'te `_prisma_migrations` içinde başarısız/yarım migration olmadığını ve gerekli tabloların varlığını kontrol et; migration uygulanmamışsa 503 dön. P3-08 recovery tamamlanana kadar en azından migration kontrolü eklenmeli. Boş DB ile test eklenmeli.

### B3 — Medium — DB erişilemezken login 500 `INTERNAL_ERROR`, sözleşmedeki 503 değil

- Dosyalar: `apps/api/src/common/errors/api-exception.filter.ts:100-107`, `apps/api/src/auth/auth.service.ts:46`
- Gözlenen: `DATABASE_URL=postgresql://…:59999/probedesk` ile API çalışırken `POST /api/auth/login` → **500** `{"code":"INTERNAL_ERROR","message":"An unexpected error occurred."}`. Aynı anda `/api/health/ready` doğru şekilde 503 dönüyor.
- Beklenen: `docs/api.md:102` — 503 `SERVICE_UNAVAILABLE` "DB/readiness veya iş kabulü hazır değil". DB'ye ulaşılamaması beklenen bir altyapı hatasıdır; 500, istemciye "uygulama hatası" sinyali verir ve retry/circuit-breaker davranışını zorlaştırır.
- Öneri: Auth servisinde Prisma bağlantı/initialization hatalarını yakalayıp güvenli 503 `SERVICE_UNAVAILABLE`'a eşle; filtrede genel bir Prisma altyapı-hatası eşlemesi düşünülebilir. Hata mesajında SQL/DSN sızdırılmamalı (mevcut filtre bunu koruyor).

### B4 — Medium — `persistence-check` tehlikeli veri mutasyonunu production/rastgele DB'de reddetmiyor

- Dosya: `apps/api/test/scripts/persistence-check.ts:35-49`, `:55`, `:114`
- Gözlenen: Script yalnızca `DATABASE_URL` varlığını ve `TEST_DATABASE_URL` ile aynı olmamasını kontrol ediyor. `NODE_ENV`, localhost/allowlist veya production reddi yok. `DATABASE_URL` production'ı gösteriyorsa `device_profiles` tablosunda `__persistence_check__` kodlu satırı silip yeniden oluşturuyor; ayrıca yerel `compose.yaml` postgres container'ını `--force-recreate` ediyor.
- Beklenen: P1-02 kabul ölçütü `docs/tasks/P1-02.md:24` — "Tehlikeli reset/cleanup yanlış ortamda reddedilir." Reset script'i (`reset-test-database.ts`) bu korumaya sahip; persistence-check sahip değil.
- Öneri: `NODE_ENV==='development'` (veya açık bir `PROBEDESK_ALLOW_PERSISTENCE_CHECK=1`) ve yalnızca localhost/allowlist DB host'u zorunlu olsun; production'da ve `DATABASE_URL` belirsizse reddet. `TEST_DATABASE_URL` zorunlu olsun. Koruma için negatif test ekle.

### B5 — Medium — Test setup, `DATABASE_URL` yokken test dışı DB'ye karşı çalışabilir

- Dosyalar: `apps/api/test/setup-env.ts:10-14`, `apps/api/src/common/database/test-database-guard.ts:84-92`, `apps/api/test/scripts/migrate-test-database.ts:15`
- Gözlenen: `requireTestDatabaseUrl` yalnızca `DATABASE_URL` varsa alias kontrolü yapıyor. `setup-env.ts` `NODE_ENV`'i kendisi `test` yapıyor ve yalnızca bu zayıf guard'ı kullanıyor; yalnızca `TEST_DATABASE_URL` verilip bu URL development DB'yi gösterirse e2e temizlik kodu (`deleteAuthTestUsers`, demo seed cleanup) development verisini silebilir. `migrate-test-database.ts` de `NODE_ENV=test`'i kendisi atadığı için NODE_ENV kontrolünü anlamsızlaştırıyor.
- Beklenen: P1-02 kabul ölçütü `docs/tasks/P1-02.md:23-24`; test/demo temizliği yalnızca doğrulanmış test ortamında çalışmalı (`docs/testing.md:54`).
- Öneri: Test setup ve migration helper'ı `requireSafeTestDatabaseReset` benzeri katı guard kullansın: `DATABASE_URL` zorunlu, test URL'i development URL'inden farklı, `NODE_ENV` dışarıdan doğrulanmış olsun. Ek olarak test DB adı/host'u için açık allowlist veya `_test` suffix kontrolü düşünülebilir.

### B6 — Low — Rate limit yalnızca IP+e-posta; toplu denemeler ve `Retry-After` eksik

- Dosyalar: `apps/api/src/auth/login-rate-limiter.ts:20-43`, `apps/api/src/auth/auth.service.ts:36-43`, `docs/tasks/P1-06.md:45`
- Gözlenen: Aynı IP'den farklı e-postalarla sınırsız sayıda 10'ar deneme yapılabilir; global/per-IP limit yok. 10 hatalı denemeden sonra 11. istek 429 dönüyor, ancak `retryAfterSeconds` hesaplanmasına rağmen yanıtta `Retry-After` başlığı yok.
- Beklenen: Kartta tanımlanan "IP+e-posta başına 10/15 dk" karşılanıyor; sözleşmede daha geniş bir limit yok. Bu nedenle sözleşme ihlali değil, güvenlik sertleştirmesi.
- Öneri: Per-IP/global ikinci bir limit ve 429'da `Retry-After` ekle; testte farklı e-postalarla tek IP senaryosunu doğrula.

### B7 — Low — Login non-JSON davranışı OpenAPI/API dokümanıyla çelişiyor

- Dosyalar: `apps/api/src/auth/login-origin.guard.ts:33-42`, `apps/api/src/auth/auth.controller.ts:66-69`, `apps/api/openapi.json:39-40`
- Gözlenen: `Content-Type: text/plain` login isteği **400** `VALIDATION_ERROR` dönüyor; OpenAPI'de login 403 açıklaması "The request is not JSON or its Origin is not same-origin" diyor ve 400 yanıtı hiç belgelenmemiş.
- Beklenen: `docs/api.md:91` 400 `VALIDATION_ERROR` (gövde/parametre hatası), `docs/api.md:93` 403 `FORBIDDEN` (rol veya CSRF/origin reddi). Non-JSON gövde 400 olarak kalabilir; doküman ve OpenAPI buna göre düzeltilmeli.
- Öneri: `@ApiResponse({ status: 400, type: ApiErrorDto })` ekle; 403 açıklamasını yalnızca Origin/CSRF reddi olarak düzelt; `openapi:emit`/`generate` sonrası `openapi:check`.

### B8 — Low — Hata `code` alanı OpenAPI'de enum değil, üretilen istemcide `string`

- Dosyalar: `apps/api/src/common/openapi/api-error.dto.ts:21-23`, `apps/api/src/common/errors/api-error-code.ts:6-19`, `docs/api.md:131`
- Gözlenen: `ApiErrorCode` bir union olsa da `ApiErrorDto.code` `type: String` olarak belgeleniyor; `packages/api-client/src/schema.ts` içinde `code: string` üretiliyor. Sözleşme "enum'lar OpenAPI'ye yazılır" diyor.
- Öneri: `@ApiProperty({ enum: API_ERROR_CODES })` kullan veya ayrı bir enum tanımla; istemci tiplerini yeniden üret. Bu, frontend'in hata kodlarını string karşılaştırmasıyla ele almasını da azaltır.

### B9 — Low — Frontend'de elle tutulan ikinci auth API modeli var

- Dosyalar: `apps/web/src/app/core/auth/auth.types.ts:1-12`, `apps/web/src/app/core/auth/auth-api.ts:7-8`, `:42-47`
- Gözlenen: Üretilen `AuthUserDto` ve rol enum'u, elle yazılmış `AuthenticatedUser`/`Role` tiplerine map ediliyor. `docs/api.md:131` "Frontend'de elle farklı bir API iş modeli tutulmaz" diyor; `docs/architecture.md:56` de üretilen istemci tiplerinin ayrı pakette olmasını istiyor.
- Etki: Alansal olarak aynı olsa da şema değişince iki modelin ayrışma riski var; `Role` listesi iki yerde güncellenmeli.
- Öneri: `AuthenticatedUser`'ı `components['schemas']['AuthUserDto']` üzerinden türet (`type AuthenticatedUser = AuthUserDto`) veya doğrudan üretilen tipi kullan; `ROLE_LABELS` gibi UI-yardımcılarını ayrı tut.

### B10 — Low — Login sayfasındaki 401 özel dalı ölü kod; test mock'u gerçek mesajla uyuşmuyor

- Dosyalar: `apps/web/src/app/features/auth/login-page.ts:64`, `apps/web/src/app/features/auth/login-page.spec.ts:28-32`, `:179-182`
- Gözlenen: API 401 gövdesinde `code: "UNAUTHENTICATED"` döndürüyor; UI koşulu `error.status === 401 && error.code === 'HTTP_ERROR'`. Bu dal hiç çalışmıyor; ekranda sunucunun "Invalid email or password." mesajı görünüyor (işlevsel olarak kabul edilebilir). Test ise mock gövdesinde "The email or password is incorrect." kullanıyor ve bu metni doğruluyor; gerçek sözleşme mesajını test etmiyor.
- Öneri: Koşulu `error.code === 'UNAUTHENTICATED'` yap veya özel dalı kaldırıp sunucu mesajını kullan; test fixture'ını gerçek API mesajıyla hizala.

### B11 — Low — Oturumsuz logout 204, `api.md` hata tablosundaki 401 ile çelişiyor

- Dosyalar: `apps/api/src/auth/auth.controller.ts:129-156`, `apps/api/src/auth/auth.service.ts:143-156`, `docs/api.md:22`, `docs/api.md:92`
- Gözlenen: Session cookie'si olmayan `POST /api/auth/logout` **204** dönüyor ve cookie'leri temizliyor. `api.md` logout'u P/O/V olarak listeliyor; genel hata tablosu eksik oturumu 401 olarak tanımlıyor. OpenAPI ise "or was already absent" 204 diyor.
- Değerlendirme: Idempotent logout güvenli ve kullanışlı bir tercih; güvenlik açığı değil. Ancak sözleşme metniyle çelişiyor ve istemciler 401 bekleyebilir.
- Öneri: Tercih edilen davranışı `api.md`'de açıkça "oturum yoksa da 204" olarak belgeleyip OpenAPI ile hizala; alternatif olarak SessionAuthGuard ile 401 zorunlu kıl.

### B12 — Low — CSRF cookie'si kaybolursa canlı oturum mutasyon yapamıyor

- Dosyalar: `apps/api/src/auth/auth.controller.ts:108-124`, `apps/api/src/auth/auth.service.ts:120-136`, `docs/data-model.md:29`
- Gözlenen (kod incelemesi): `/auth/me` yalnızca `Session.csrfTokenHash` null ise yeni CSRF cookie'si üretiyor. Session hash'i dururken tarayıcıdaki okunabilir `XSRF-TOKEN` cookie'si silinir/bozulursa `/auth/me` 200 döner ama yeni cookie set etmez; sonraki logout/mutasyon 403 olur ve UI'de kurtarma akışı yoktur.
- Değerlendirme: `data-model.md` yalnızca DB değeri olmayan oturum için yenileme tanımlıyor; bu nedenle dar anlamda sözleşme ihlali değil. Yine de operasyonel dayanıklılık ve CSRF kurulumu açısından not edilmelidir.
- Öneri: `/auth/me` isteğinde `XSRF-TOKEN` cookie'si yoksa/geçersizse token rotate etmeyi değerlendir (diğer sekmelerin token'ını geçersiz kılma etkisini test ederek) veya UI'de "oturumu yenile / cookie'leri temizle" akışı sağla.

### B13 — Low — P1-04 klavye kabul kriteri açık; P1-01 Prisma maddesi işaretsiz

- Dosyalar: `docs/tasks/P1-04.md:22`, `docs/tasks/P1-01.md:24`
- Gözlenen: P1-04'te "Navigasyon klavyeyle kullanılabilir…" maddesi `[ ]`; yalnızca skip link, landmark ve odak testi var; tam tab sırası/ekran okuyucu turu P7-04'e ertelenmiş. P1-01'de Angular/Nest/Prisma ortak doğrulama maddesi `[ ]`; P1-02 Prisma adapter'ını fiilen doğruladı.
- Etki: P1-04 bu haliyle `Accepted` olamaz; P1-01 kanıtı güncellenmeli. P1-08 kapsam dışı olduğu için bu incelemede CI kabulü değerlendirilmedi.
- Öneri: P1-04 için gerçek klavye turu yapıp maddeyi kapat veya açıkça ayrı bir takip görevine bağla ve kartı buna göre güncelle. P1-01'de Prisma maddesini P1-02 kanıtıyla işaretle.

### B14 — Low — Doküman/komut durumu ve `verify` kapsamı eski

- Dosyalar: `docs/roadmap.md:3`, `docs/tasks/README.md:3`, `docs/testing.md:3`, `docs/testing.md:62`, `docs/testing.md:78`, `docs/implementation-guide.md:3`, `package.json:28`
- Gözlenen: Roadmap "P1-01 In Review; diğer görevler Planned" diyor; oysa P1-02…P1-07 In Review. Görev dizini "diğerleri Planned" diyor. `testing.md` testlerin/komutların henüz olmadığını söylüyor; komutlar var ve çalışıyor. `implementation-guide.md` çalışan uygulama/test kanıtı olmadığını söylüyor. Kök `verify` script'i `openapi:check`'i içermiyor; `testing.md:78` verify'ın sözleşme kontrollerini içerdiğini belirtiyor. Kök `lint` `packages/api-client` için lint çalıştırmıyor (pakette lint script'i yok).
- Etki: Kabul sırasında hangi kontrolün gerçekten `verify` kapsamında olduğu belirsizleşir; durum tabloları görev kartlarıyla çelişir.
- Öneri: Görev durumlarını tek commit'te kartlar, `docs/tasks/README.md` ve `roadmap.md` ile hizala; `verify`'a `openapi:check` ekle veya `testing.md`'yi düzelt; api-client için lint/typecheck kapsamını netleştir.

## Yeniden çalıştırılan komutlar ve gerçek sonuçlar

Tüm komutlar bu çalışma ağacında, mevcut `node_modules` ile çalıştırıldı. `npm ci` inceleme talimatı gereği **çalıştırılmadı**.

| Komut | Gerçek sonuç |
|---|---|
| `node --version` | `v22.23.2` |
| `npm --version` | `10.9.8` |
| `npx npm@11.6.2 --version` | `11.6.2` |
| `npm run lint` | API: 58 dosya, 0 uyarı/0 hata. Web: 42 dosya, 0 uyarı/0 hata. Çıkış 0. |
| `npm run typecheck` | API, web ve api-client `tsc --noEmit`; çıkış 0. |
| `npm run test:api:unit` | 5 dosya, 22 test geçti; çıkış 0. |
| `npm run test:web` | 11 dosya, 58 test geçti (2.07s); çıkış 0. |
| `npm run build` | `nest build` başarılı; `ng build` başarılı; initial `304.60 kB` raw / `83.22 kB` transfer; çıkış 0. |
| `npm run verify` | Çıkış 0 (lint + typecheck + unit + web + build). Not: `openapi:check` ve integration bu script'in içinde değil. |
| `npm run test:e2e --workspace apps/api` | 7 dosya, 37 test geçti (4.99s); çıkış 0. |
| `npm run openapi:check` | `OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.` Çıkış 0. |
| `npm ls prisma @prisma/client @prisma/adapter-pg pg --workspace apps/api` | Prisma CLI/client/adapter `7.10.1`, `pg 8.16.3`; çıkış 0. |
| Geçici boş DB'ye `prisma migrate deploy` | `20261103120000_init` ve `20261103130000_session_csrf_token_optional` uygulandı; "All migrations have been successfully applied." |
| Geçici DB şema sorgusu | `users/sessions/device_profiles` kolonları UUID/timestamptz doğru; `csrfTokenHash` nullable. Constraint sorgusu `operator is not unique: text \|\| "char"` hatasıyla düştü (sorgu yazımı); migration hatası değil. Geçici DB trap ile silindi. |

### Gerçek API'ye karşı negatif kontroller

API `PORT=3599 node apps/api/dist/main.js` ile yerel development DB'ye karşı çalıştırıldı; geçici cookie jar kullanıldı.

| Kontrol | Sonuç |
|---|---|
| `GET /api/health/ready` | 200 `{"status":"ok","checks":{"database":"ok"}}` |
| Anonim `GET /api/auth/me` | 401 `UNAUTHENTICATED` |
| Login, yanlış `Origin: http://evil.example` | 403 `FORBIDDEN` |
| Login, `Origin: null` | 403 `FORBIDDEN` |
| Login, farklı portlu Origin | 403 `FORBIDDEN` |
| Login, `Content-Type: text/plain` | 400 `VALIDATION_ERROR` |
| Login, bozuk JSON gövdesi | 400 `VALIDATION_ERROR` ("The request is invalid.") |
| `GET /api/auth/logout` | 404 |
| Doğru origin + doğru parola login | 200, yalnızca `{id,email,role}`; cookie'ler `HttpOnly`/`SameSite=Lax`/`Path=/`; `Secure` yok (B1) |
| Aynı cookie ile `GET /api/auth/me` | 200 |
| Değiştirilmiş session cookie | 401 |
| CSRF başlığı olmadan logout | 403 |
| Yanlış CSRF başlığıyla logout | 403 |
| Doğru CSRF cookie değeriyle logout | 204 |
| Logout sonrası `GET /api/auth/me` | 401 |
| 10 hatalı deneme + 11. deneme | 429 `TOO_MANY_REQUESTS`; `Retry-After` başlığı yok (B6) |
| Preflight `OPTIONS /api/auth/login` (evil Origin) | 404; `Access-Control-Allow-Origin` yok |
| `Origin: https://…` + `X-Forwarded-Proto: https` | 401 (Origin kabul edildi; yanlış parola) |
| `/api/plans`, `/api/device-profiles`, `/api/runs` | 404 (Phase 1 kapsamı; beklenen) |

Ek olarak:

- `NODE_ENV=production PORT=3600 SESSION_COOKIE_SECURE=false` ile login: `probedesk_session` cookie'sinde `Secure` **yok** (B1).
- `DATABASE_URL=…:59999` (DB kapalı) ile `/api/health/ready` 503; aynı süreçte login **500** (B3).
- Migration uygulanmamış boş geçici DB ile `/api/health/ready` **200** (B2).
- Oluşturulan 2 geçici session `tokenHash` ile silindi; mevcut diğer session'lara dokunulmadı. Geçici DB'ler silindi.

### Komut/ortam hataları (ürün hatası değil)

- Geçici DB constraint sorgusu `text || "char"` operatör belirsizliği nedeniyle hata verdi; migration ve kolon doğrulaması başarılıydı.
- İlk adversarial script'te bash `printf '->'` biçim hatası oluştu; 429 yanıtı ayrı bir curl ile tekrar alındı.
- `npm run verify` sarmalayıcısında zsh'in salt-okunur `status` değişkeni kullanıldığı için ilk deneme düştü; `rc` ile tekrarlandı ve çıkış 0 alındı.

## Doğrulanamayanlar ve nedenleri

1. **`npm ci` / temiz checkout kurulumu**: İnceleme talimatı mevcut `node_modules` kullanılmasını ve kurulum yapılmamasını istedi. P1-01'in "temiz npm ci" iddiası bağımsız olarak yeniden üretilmedi; CI'da `npm ci` çalışıyor (P1-08 kanıtı, kapsam dışı).
2. **`db:reset:test` ve persistence-check**: Reset destructive olduğu ve persistence-check development container'ını yeniden oluşturduğu için çalıştırılmadı; bunun yerine boş geçici DB'ye migration uygulandı. Reset guard'ı kod ve unit testlerle, persistence riski kod incelemesiyle değerlendirildi.
3. **Gerçek tarayıcı UI smoke'u**: Bu oturumda masaüstü tarayıcı bağlı değildi. Login formu, sayfa yenileme ve deep link davranışı Angular Vitest/TestBed ve gerçek API curl smoke'u ile değerlendirildi; gerçek tarayıcı etkileşimi P7-01/P7-04 kapsamında ayrıca yapılmalı.
4. **Tam klavye/tab sırası ve ekran okuyucu**: P1-04 kartı bunu açıkça P7-04'e bırakıyor; yalnızca skip link, landmark, aktif nav ve odak testleri var.
5. **Rol matrisinin ürün endpoint'lerinde doğrulanması**: Phase 1'de rol gerektiren gerçek ürün endpoint'i yok; `/auth/me` ve logout tüm roller için. Planner/Operator/Viewer 401/403 matrisi yalnızca test fixture'ında (`apps/api/test/fixtures/auth-probe.controller.ts`) doğrulanıyor. P2/P3 gerçek plan/run uçları eklendiğinde T24 yeniden çalıştırılmalı.
6. **OpenAPI drift'inin kasıtlı bozulması**: Ürün dosyalarını geçici olarak değiştirmemek için drift testi tetiklenmedi; `openapi:check` mantığı ve yeşil sonucu incelendi. P1-05'teki iki drift denemesi uygulayıcı kanıtıdır; bağımsız olarak yeniden üretilmedi.
7. **Gerçek GitHub Actions koşusu**: P1-08 kapsam dışı; bu incelemede CI sonucu değerlendirilmedi. Yerel komutlar yeşil.
8. **HTTPS/proxy altında gerçek cookie davranışı**: TLS sonlandıran gerçek proxy ile test edilmedi; yalnızca `NODE_ENV=production` + HTTP üzerinde `Secure` eksikliği gösterildi.
9. **P1-05 schema SHA-1'inin karttaki değerle aynı olması**: Kartta `cae4c15c…` yazıyor; auth eklendikten sonra güncel dosya farklı. Bu, kartın yazıldığı andaki kanıtın tarihsel olmasından kaynaklanıyor; bağımsız drift kontrolü yeşil.

## Kanıt dürüstlüğü notları

- Kartların tamamı `In Review`; hiçbiri `Accepted` değil. Bu doğru ve kabul edilebilir bir durumdur.
- Ancak P1-06 kartındaki "cookie ayarları sözleşmeye uyar" ifadesi B1 nedeniyle doğru değildir. P1-02'nin "tehlikeli cleanup reddedilir" maddesi B4/B5 nedeniyle kısmen karşılanmıştır. P1-04'te klavye maddesi açıktır.
- P1-01/P1-04 kartlarındaki test sayıları (1/2, 7/17) kartın yazıldığı andaki sayılardır; güncel ağaçta 5/22 ve 11/58'dir. Bu bir yanlışlık iddiası değil, kanıtın tarihsel kaldığının göstergesidir; kabul öncesi güncel sayılarla yenilenmeli.
- `docs/roadmap.md`, `docs/tasks/README.md`, `docs/testing.md` ve `docs/implementation-guide.md` durum/komut bilgisi bakımından güncel değildir (B14).
- Bu incelemede ürün kodu, test fixture'ları veya task kartları değiştirilmedi; yalnızca bu rapor yazıldı. Geçici oturumlar temizlendi.
