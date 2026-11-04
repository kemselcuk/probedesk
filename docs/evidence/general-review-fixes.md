# Genel kod incelemesi düzeltmeleri

- Tarih: 2026-11-04
- İnceleme tabanı: `67a6738` (`GENERAL-REVIEW.local.md`, yerel/ignore).
- Düzeltme commit'leri: `3f15ab9`, `76b2b6f`, `c2e3660`, `44de016`, `6f889a8`; kanıt commit'i
  `10798fa` (`v0.1.0-rc.2`, CI `41916047120`).
- Kapsam: auth oturum yaşam döngüsü, CSRF kurtarma, UUID kanonikleştirme, Start/Run Again
  navigasyonu, nginx özel port yönlendirmesi ve eski doküman/CI bağlantıları.
- Video kullanıcı kararıyla kapsam dışıdır; bu turda video çalışması yapılmadı.

## Bulgu durumları

### 1. Geçici `/auth/me` hatası kalıcı önbelleğe alınıyordu — KAPANDI

`AuthFacade.loadSession()` artık yalnızca 401 sonucunu anonim oturum olarak saklıyor. Diğer
hatalarda hata görünür kalıyor, paylaşılan istek temizleniyor ve sonraki çağrı yeni bir HTTP
isteği üretiyor. Paralel çağrılar hâlâ tek isteği paylaşıyor.

Kalıcı test: `apps/web/src/app/core/auth/auth.facade.spec.ts` →
`retries session discovery after a transient failure`.

### 2. Eski oturum yanıtı yeni login/logout durumunu ezebiliyordu — KAPANDI

`AuthFacade` bir `sessionGeneration` sayacı tutuyor. Login başarısı, logout başlangıcı ve oturum
temizliği sayacı artırıyor; geç gelen `/auth/me` yanıtı yalnızca hâlâ güncel generation'a aitse
state yazıyor. Aksi halde mevcut otoritatif kullanıcı döndürülüyor.

Kalıcı testler:
- `does not let a stale session response erase a later login`
- `does not let a stale session response re-authenticate after logout`

### 3. UUID büyük/küçük harf tutarsızlığı — KAPANDI

- `ComparisonsService` her iki run id'sini Map aramasından ve aynı-run kontrolünden önce
  lowercase'e çeviriyor.
- `RunEventsService.prepare()` run id'sini DB sorgusundan önce kanonikleştiriyor.
- Frontend `RunEventsService.connect()` session anahtarını ve envelope eşleştirmesini lowercase
  UUID ile yapıyor; `LiveRunFacade` route id'sini kanonikleştirip snapshot id'sini otorite olarak
  kullanıyor.

Kalıcı testler:
- API: `comparisons.e2e-spec.ts` → `treats uppercase and lowercase UUIDs as the same runs`
  (mixed-case aynı run 400 `VALIDATION_ERROR`).
- API: `sse.e2e-spec.ts` → `replays the same stream when the run id is uppercase`.
- Web: `run-events.service.spec.ts` → `canonicalises an uppercase run id for the URL and event
  matching`.
- Web: `live-run.facade.spec.ts` → `canonicalises an uppercase route id and streams with the
  snapshot id`.

Gerçek delivery HTTP kontrolü:

```text
comparison lower:200 upper:200
uppercase-run-id-event-frames:98
```

### 4. Start Run / Run Again yanlış ekrana gidiyordu — KAPANDI

Yeni bir `RUNNING` başlangıç artık `/runs/:id/live` ekranına, terminal idempotent replay ise
`/runs/:id` detayına gidiyor. Run Again aynı sözleşmeyi kullanıyor.

Kalıcı testler: `start-run-page.spec.ts` (16 test) ve `run-details-page.spec.ts` (39 test).
Playwright `main-demo.spec.ts` artık test-only `page.goto('/runs/:id/live')` kullanmıyor; doğal
Start→Live navigasyonunu doğruluyor.

### 5. Kaybolan XSRF cookie'si kurtarılamıyordu — KAPANDI

- `GET /auth/me` artık CSRF cookie'si yoksa **veya** cookie sunucudaki hash ile eşleşmiyorsa yeni
  token üretip `Set-Cookie` ile döndürüyor. Token yalnız hash olarak saklanıyor.
- Frontend interceptor, belgelenmiş CSRF 403 mesajında `/auth/me` ile cookie'yi yenileyip aynı
  isteği **bir kez** tekrar ediyor. Rol/origin 403'leri tekrar edilmiyor. Eşzamanlı kurtarmalar
  tek `/auth/me` isteğini paylaşıyor; retry, API state değiştirmeden reddettiği için güvenli.

Kalıcı testler:
- API: `auth.e2e-spec.ts` → `restores a lost or mismatched CSRF cookie for an existing session`
  (eski token 403, yeni token 200, sonraki `/me` Set-Cookie üretmiyor).
- Web: `auth.interceptor.spec.ts` → CSRF retry, refresh/retry hataları ve rol/origin 403'ünde
  retry yok testleri.

Gerçek delivery HTTP kontrolü:

```text
login:200
me-without-csrf:200 refreshed:yes rotated:yes
logout-with-refreshed-csrf:204
```

### R7 — recovery/retry hatası ilk CSRF 403'üne dönüşüyordu — KAPANDI

İnceleme tabanı `0ec57d6` üzerinde iki hedefli regresyon, iç `catchError`'ın `/auth/me` veya retry
hatasını yutup ilk 403'ü yaydığını gösterdi. Bu sarmalayıcı kaldırıldı; artık:

- `/auth/me` 401 → dışarı 401; oturum anonimleşiyor, `returnUrl` ve `reason=session-expired` ile
  login yönlendirmesi çalışıyor.
- Retry 401 → dışarı 401; aynı session-expired yolu çalışıyor.
- `/auth/me` 503 → dışarı 503, kendi `requestId`'siyle; retry yapılmıyor.
- Retry 503 → dışarı 503, retry'nin kendi `requestId`'siyle; ilk 403 maskelenmiyor.
- Retry tekrar CSRF 403 → dışarı ikinci 403; üçüncü istek/ikinci refresh yok.
- Başarılı recovery, rol 403, origin 403 ve auth endpoint muafiyeti korunuyor.

Kalıcı testler: `apps/web/src/app/core/auth/auth.interceptor.spec.ts` (11 test), özellikle
`propagates a 401 from the csrf refresh...`, `propagates a 401 from the retried request...`,
`propagates a 503 from the csrf refresh...`, `propagates a 503 from the retried request...`,
`stops after one retry...`, `does not recover a csrf failure on an exempt auth endpoint`,
`does not refresh or retry a same-origin 403`.

Doğrulama:

```text
npm run test:web
→ 36 dosya / 384 test geçti

npm run verify
→ exit 0; API 118, web 384 test; build; OpenAPI current

npm run test:e2e --workspace apps/api
→ 22 dosya / 200 test geçti (41.58 s)
```

### 6. Özel port nginx yönlendirmesi ve eski doküman/CI bağlantıları — KAPANDI

- `infra/nginx/default.conf` içine `absolute_redirect off;` eklendi. `18080` portunda çalışan
  gerçek nginx konteynerinde `GET /api` → `308`, `Location: /api/` (iç 8080'e mutlak yönlendirme
  yok).
- `kemalselcuk/probedesk` biçimindeki yanlış GitHub kullanıcı adı `kemselcuk/probedesk` olarak
  düzeltildi; README/testing/implementation-guide eski “CI yok / nihai commit bekliyor”
  ifadeleri güncel sürüm adayı kaydıyla değiştirildi.

## Çalıştırılan kontroller ve gerçek sonuçlar

```text
npm run verify
→ exit 0; API 16 dosya/118 test; web 36 dosya/384 test; build; OpenAPI current

npm run test:e2e --workspace apps/api
→ 22 dosya / 200 test geçti (33.00 s)

E2E_DATABASE_URL=...probedesk_e2e_test E2E_BASE_URL=http://127.0.0.1:4300 \
E2E_API_URL=http://127.0.0.1:3101 npm run test:e2e
→ 2 passed (37.9 s): compare + main demo (doğal Start→Live navigasyonu)

docker compose --profile delivery up -d --build
→ migrate/seed Exited(0), api/web healthy, /api/health/ready 200

nginx özel port (18080)
→ GET /api: 308, Location: /api/
```

## Değerlendirilen ancak ertelenen öneriler

- **SSE backpressure:** `response.write()` dönüşü hâlâ yok sayılıyor. Bu turda yük/bellek testi
  yapılmadı ve doğrulanmış bir kullanıcı hatası yok. Gelecekte drain bekleme, yavaş istemci
  sınırı ve kapanış timeout'u ayrı bir performans görevi olarak ele alınmalı. Bu değişiklik
  bug fix kapsamına zorlanmadı.
- **Büyük davranış birimleri:** `run-executor.ts`, `plan-editor-page.ts`,
  `run-details-page.html` parçalama refactor'ı davranış değişikliği olmadan ayrı bir bakım
  görevi olarak bırakıldı.
- **Hata gözlemlenebilirliği:** Mevcut filtre hassas veri sızdırmıyor; yapılandırılmış hata
  kodu/requestId genişletmesi opsiyonel ve bu turda gerekli görülmedi.

## Sınırlar

- Chrome/Playwright ve gerçek PostgreSQL/HTTP kullanıldı; Safari/Firefox/mobil test edilmedi.
- Tamamen boş işletim sistemi kurulumu bu turda tekrarlanmadı.
- SSE backpressure için yük testi yapılmadı; ertelenen öneri olarak kayıtlıdır.
- Nihai ürün kapsamı ve kullanıcı kabulü değişmedi.
