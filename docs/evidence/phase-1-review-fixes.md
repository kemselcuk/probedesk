# Phase 1 inceleme bulgularının düzeltme kaydı

- Tarih: 2026-11-03
- Kaynak inceleme: [phase-1-review.md](phase-1-review.md)
- Kapsam: B1, B2, B3, B4, B5, B6, B7, B8
- Çalışma ağacı: paylaşımlı checkout; bu worker git komutu çalıştırmadı. Commit'i lead oluşturacak.
- Durum: Düzeltmeler tamamlandı ve gerçek komutlarla doğrulandı. Hiçbir görev `Accepted` yapılmadı.

> Bu dosya uygulayıcı kanıtıdır; bağımsız inceleme veya ürün kabulü değildir. Bağımsız
> inceleme yeniden çalıştırılmadan Phase 1 kabulü verilmemelidir.

## Özet

| Bulgu | Önem | Durum | Kısa sonuç |
|---|---|---|---|
| B1 — production'da `Secure` olmayan session cookie | High | **Kapatıldı** | `NODE_ENV=production` + `SESSION_COOKIE_SECURE!=true` başlangıcı durduruyor; production+true kabul ediliyor. |
| B2 — readiness migration kontrolü yapmıyor | Medium | **Kapatıldı** | `_prisma_migrations` içinde yarım/rolled-back migration veya migration'sız şema 503 döndürüyor; boş gerçek DB ile doğrulandı. |
| B3 — DB erişilemezken login 500 | Medium | **Kapatıldı** | Dar Prisma altyapı-hatası eşlemesi 503 `SERVICE_UNAVAILABLE` döndürüyor; programlama hataları 500 kalmaya devam ediyor. |
| B4 — persistence-check ortam koruması | Medium | **Kapatıldı** | Guard `src/common/database/` içine taşındı; NODE_ENV, açık opt-in, localhost ve ayrı test DB zorunlu; beş ret senaryosu gerçek script ile doğrulandı. |
| B5 — test setup zayıf alias kontrolü | Medium | **Kapatıldı** | `DATABASE_URL` zorunlu ve test URL'inden farklı; setup ve migration helper aynı katı guard'ı kullanıyor; ret senaryoları gerçek komutlarla doğrulandı. |
| B6 — login hız sınırı ve `Retry-After` | Low | **Kapatıldı (global cap hariç)** | IP+e-posta 10/15 dk korunuyor; IP başına 50/15 dk toplu limit eklendi; 429 yanıtı `Retry-After` taşıyor. Süreç-global cap eklenmedi. |
| B7 — login OpenAPI 400/403 | Low | **Kapatıldı** | Login 400 yanıtı belgelendi; 403 yalnızca Origin reddi olarak düzeltildi; `openapi.json` yeniden üretildi. |
| B8 — hata `code` enum değil | Low | **Kapatıldı** | `ApiErrorDto.code` gerçek `API_ERROR_CODES` enum'u olarak belgelendi; test enum'u doğruluyor; `openapi.json` yeniden üretildi. |

Kapsam dışı kalan inceleme bulguları: B9, B10, B11, B13, B14 (apps/web ve lead sahipliğindeki
dokümanlar) ve B12 (CSRF kurtarma akışı). B12 bilinçli olarak uygulanmadı; ayrıntı aşağıda.

## Bulgu bazlı önce/sonra

### B1 — production'da `Secure` session cookie zorunluluğu

**Önce:** `SESSION_COOKIE_SECURE` varsayılanı `false` idi ve `NODE_ENV=production` ile birlikte
`false` değeri kabul ediliyordu. Login yanıtındaki cookie `Secure` içermiyordu. E2E testi de
varsayılan olarak `Secure` yokluğunu doğruluyordu.

**Sonra:**

- `apps/api/src/config/env.ts`: ortam şemasına `superRefine` eklendi. `NODE_ENV=production` ve
  `SESSION_COOKIE_SECURE!==true` ise doğrulama şu mesajla durur:
  `SESSION_COOKIE_SECURE must be "true" when NODE_ENV is "production".`
  Mesaj hiçbir ortam değerini (DSN, parola) yazdırmaz.
- `apps/api/src/config/env.spec.ts`: production+`false` ve production+değer yok reddi;
  production+`true` kabulü test edildi.
- `apps/api/test/startup.e2e-spec.ts`: gerçek süreç `NODE_ENV=production
  SESSION_COOKIE_SECURE=false` ile başlatıldı; exit≠0 ve secret sızmadığı doğrulandı.
- `.env.example`: production'da `true` zorunlu olduğunu belirten yorum eklendi.
- `apps/api/README.md`: cookie ve production koşulu belgelendi.

**Gerçek kontrol:**

```text
$ NODE_ENV=production SESSION_COOKIE_SECURE=false PORT=3601 \
  DATABASE_URL='postgresql://probedesk:supersecret@127.0.0.1:5434/probedesk?schema=public' \
  node apps/api/dist/main.js
Invalid environment configuration:
- SESSION_COOKIE_SECURE: SESSION_COOKIE_SECURE must be "true" when NODE_ENV is "production".
exit=1
```

Çıktıda `supersecret` veya DSN yoktur. Production+`true` kabulü `env.spec.ts` içinde, `Secure`
cookie davranışı ise `auth.e2e-spec.ts` içindeki mevcut testte doğrulanır.

### B2 — readiness migration durumunu doğruluyor

**Önce:** `HealthService.getReadiness()` yalnızca `SELECT 1` çalıştırıyordu. Migration
uygulanmamış boş bir veritabanında 200 dönüyordu.

**Sonra:**

- `apps/api/src/prisma/prisma.service.ts`: `assertMigrationsApplied()` eklendi. Sorgu
  `_prisma_migrations` üzerinde `finished_at` ve `rolled_back_at` durumlarını sayar.
  Tamamlanmış migration yoksa veya yarım/rolled-back kayıt varsa `MigrationsNotAppliedError`
  fırlatır. Tablo yoksa sorgu hatası yukarı akar.
- `apps/api/src/health/health.service.ts`: önce bağlantı, sonra migration durumu kontrol edilir.
  DB erişilemezse `checks.database=unavailable`; migration hazır değilse
  `checks={database:"ok",migrations:"pending"}` ile 503 döner. Loglar sabittir; SQL/DSN yoktur.
- `apps/api/src/health/health.controller.ts`: OpenAPI 200 şemasına `migrations` alanı ve
  migration kontrolü açıklaması eklendi.
- `apps/api/test/health.e2e-spec.ts`: gerçek test PostgreSQL'inde geçici boş bir veritabanı
  oluşturulur; migration tablosu yokken 503, yarım migration varken 503, tamamlanınca 200
  doğrulanır. Geçici DB test sonunda silinir.

**Gerçek boş DB kontrolü:** test konteynerinde `probedesk_manual_empty_final_*` adlı boş DB
oluşturuldu; API `PORT=3598` ile ona bağlandı:

```text
readiness: {"code":"SERVICE_UNAVAILABLE","message":"The service is not ready.","requestId":"23c8de26-82ad-4295-9638-751ce3e7e50d","details":{"checks":{"database":"ok","migrations":"pending"}}} status=503
login: {"code":"SERVICE_UNAVAILABLE","message":"The service is currently unavailable.","requestId":"9e4f8ba8-9647-4a83-a409-4cedd0a94024"} status=503
DROP DATABASE
remaining_db_count: 0
```

Geçici veritabanı silindi; `pg_database` sorgusu 0 döndürdü.

### B3 — DB bağlantı hataları 503'e eşleniyor

**Önce:** `DATABASE_URL` erişilemeyen bir porta işaret ederken `POST /api/auth/login`
500 `INTERNAL_ERROR` dönüyordu.

**Sonra:**

- `apps/api/src/common/database/prisma-error.ts`: yalnızca Prisma'nın
  `PrismaClientInitializationError` sınıfı ve bağlantı/kimlik/pool/şema eksikliği kodları
  (`P1000`, `P1001`, `P1002`, `P1003`, `P1008`, `P1010`, `P1017`, `P2021`, `P2022`, `P2024`,
  `P2037`) altyapı hatası sayılır. `P2002`, `P2003`, `P2025`, validasyon hataları ve sıradan
  `Error` nesneleri 500 olarak kalır; böylece programlama hataları yutulmaz.
- `apps/api/src/common/errors/api-exception.filter.ts`: bu dar eşleme
  `503 SERVICE_UNAVAILABLE` / `The service is currently unavailable.` üretir. Filter mesaj,
  stack, SQL veya DSN kopyalamaz; yalnızca hata sınıfı adını loglar.
- `apps/api/src/common/database/prisma-error.spec.ts`: sınıf/kod eşlemesi ve yanlış-pozitif
  olmaması test edildi.
- `apps/api/test/health.e2e-spec.ts`: erişilemeyen DB ile login 503, gövde alanları ve
  sızıntı kontrolü test edildi.

**Gerçek DB-down kontrolü:** `DATABASE_URL=...:59999`, `PORT=3599`:

```text
readiness: {"code":"SERVICE_UNAVAILABLE","message":"The service is not ready.","requestId":"a71d00fc-edbf-4d5c-8930-c9222d3c52ba","details":{"checks":{"database":"unavailable"}}} status=503
login: {"code":"SERVICE_UNAVAILABLE","message":"The service is currently unavailable.","requestId":"b734994e-d1b2-4b50-ad88-cba4e9d52b86"} status=503
```

Sunucu logunda yalnızca sabit `Readiness check failed: database is unavailable.` ve
`error=PrismaClientKnownRequestError` görülür; DSN, SQL, port veya stack yoktur.

### B4 — persistence-check ortam koruması

**Önce:** Script yalnızca `DATABASE_URL` varlığını ve `TEST_DATABASE_URL` ile farklı olmasını
kontrol ediyordu; production veya uzak bir DB'de çalışabilirdi.

**Sonra:**

- `apps/api/src/common/database/persistence-check-guard.ts`:
  `requirePersistenceCheckEnvironment()` sırasıyla `NODE_ENV=development`,
  `PROBEDESK_ALLOW_PERSISTENCE_CHECK=1`, `DATABASE_URL`, localhost/127.0.0.1/::1 host,
  `TEST_DATABASE_URL` ve farklı veritabanı kimliği koşullarını arar. Ret mesajları URL veya
  parola yazdırmaz.
- `apps/api/src/common/database/persistence-check-guard.spec.ts`: her ret koşulu ve kabul
  durumu test edildi.
- `apps/api/test/scripts/persistence-check.ts`: guard, herhangi bir DB yazımı veya docker
  komutundan önce çağrılır; ret durumunda exit 1.
- `apps/api/README.md`: komut artık açık opt-in ile belgelendi.

**Gerçek script kontrolleri (hiçbiri yazma/container komutuna ulaşmadı):**

```text
NODE_ENV=production ...                       -> Refusing ... NODE_ENV is not "development". (exit 1)
NODE_ENV=development (opt-in yok)             -> Refusing ... PROBEDESK_ALLOW_PERSISTENCE_CHECK=1 is not set. (exit 1)
DATABASE_URL=db.example.test                  -> Refusing ... DATABASE_URL must point at a local database ... (exit 1)
TEST_DATABASE_URL boş                         -> Refusing ... TEST_DATABASE_URL is not set. (exit 1)
DATABASE_URL ve TEST_DATABASE_URL aynı kimlik -> Refusing ... points at the integration-test database. (exit 1)
```

### B5 — test veritabanı guard'ı katılaştırıldı

**Önce:** `requireTestDatabaseUrl` yalnızca `DATABASE_URL` varsa alias kontrolü yapıyordu;
`DATABASE_URL` yokken test setup'ı doğrulanmamış bir veritabanına karşı çalışabiliyordu.

**Sonra:**

- `apps/api/src/common/database/test-database-guard.ts`: `DATABASE_URL` artık zorunlu;
  yoksa `Refusing to use the test database because DATABASE_URL is not set; the development
  database cannot be identified.` ile reddedilir. Test URL'i development kimliğiyle
  karşılaştırılır. `requireSafeTestDatabaseReset` aynı katı kontrolü kullanır.
- `apps/api/test/setup-env.ts` ve `apps/api/test/scripts/migrate-test-database.ts` bu katı
  guard'ı çağırır; `NODE_ENV=test` dışarıdan veya script tarafından doğrulanır, ancak asıl
  koruma iki URL'nin zorunlu ve farklı olmasıdır.
- `apps/api/src/common/database/test-database-guard.spec.ts`: `DATABASE_URL` yokluğu ve alias
  reddi yeni giriş noktası üzerinden test edildi.

**Gerçek kontroller:**

```text
$ DATABASE_URL='' npm run db:migrate:test --workspace apps/api
Refusing to use the test database because DATABASE_URL is not set; the development database cannot be identified.
exit=1
```

```text
$ DATABASE_URL='' npm run test:e2e --workspace apps/api -- test/health.e2e-spec.ts
Error: API end-to-end tests require an isolated test database. Refusing to use the test database because DATABASE_URL is not set; ...
Test Files  1 failed (1)
```

```text
$ DATABASE_URL='postgresql://probedesk:probedesk@127.0.0.1:5434/probedesk' \
  TEST_DATABASE_URL='postgresql://probedesk:probedesk@localhost:5434/probedesk' \
  npm run test:e2e --workspace apps/api -- test/health.e2e-spec.ts
Error: API end-to-end tests require an isolated test database. Refusing to use the test database because TEST_DATABASE_URL points at the development database.
Test Files  1 failed (1)
```

Bu iki negatif çalıştırmada hiçbir test gövdesi çalışmadı; development verisine dokunulmadı.

### B6 — login hız sınırı ve `Retry-After`

**Önce:** Yalnızca IP+e-posta anahtarı vardı; aynı IP'den farklı e-postalarla limit aşılabiliyor
ve 429 yanıtında `Retry-After` başlığı bulunmuyordu.

**Sonra:**

- `apps/api/src/auth/auth.constants.ts`: IP başına 50 başarısız deneme/15 dk toplu limiti
  eklendi; IP+e-posta limiti 10/15 dk olarak korundu.
- `apps/api/src/auth/login-rate-limiter.ts`: `check()` isteğe bağlı limit alır.
- `apps/api/src/auth/auth.service.ts`: hem IP+e-posta hem IP anahtarı kontrol edilir; başarısız
  deneme ikisine de yazılır. Başarılı giriş yalnızca IP+e-posta anahtarını sıfırlar; böylece
  saldırgan kendi hesabıyla IP limitini sıfırlayamaz.
- `apps/api/src/common/errors/api.exception.ts` + `api-exception.filter.ts`: opsiyonel
  `retryAfterSeconds` değeri `Retry-After` başlığına yazılır.
- `apps/api/src/auth/login-rate-limiter.spec.ts`, `apps/api/test/auth.e2e-spec.ts`: toplu limit
  ve başlık test edildi. OpenAPI 429 yanıtına `Retry-After` başlığı eklendi.

**Gerçek kontroller:**

```text
$ 10 hatalı login (aynı IP, aynı e-posta) -> attempt_10_status=401
$ 11. login                               -> attempt_11_status=429
Retry-After: 900
{"code":"TOO_MANY_REQUESTS","message":"Too many login attempts. Try again later.","requestId":"f71028c3-a76c-4030-82a7-05ec6207b0c5"}
```

E2E testi ayrıca tek IP'den 50 farklı e-posta ile deneme yapıp 51. isteğin 429 ve
`Retry-After` döndüğünü doğrular. Süreç-global (tüm IP'ler toplamı) bir cap eklenmedi.

### B7 — login OpenAPI yanıtları

**Önce:** Login için 400 yanıtı belgelenmemişti; 403 açıklaması "The request is not JSON or its
Origin is not same-origin" diyerek JSON olmayan gövdeyi yanlışlıkla 403'e bağlıyordu.

**Sonra:**

- `apps/api/src/auth/auth.controller.ts`: login için
  `400 The body is not JSON, or it contains missing, invalid or unknown fields.` eklendi.
  403 açıklaması `The request Origin is not same-origin.` olarak düzeltildi. Login/me/logout
  için 503 yanıtı da belgelendi.
- `apps/api/test/openapi.e2e-spec.ts`: login 400 ve 403 açıklaması doğrulanır.
- `apps/api/openapi.json` yeniden üretildi.

### B8 — hata kodu enum'u

**Önce:** `ApiErrorDto.code` OpenAPI'de `type: string` idi; üretilen istemci `string` görüyordu.

**Sonra:**

- `apps/api/src/common/openapi/api-error.dto.ts`: `API_ERROR_CODES` dizisi `enum` olarak
  belgelendi; alan tipi `ApiErrorCode` yapıldı.
- `apps/api/test/openapi.e2e-spec.ts`: `components.schemas.ApiErrorDto.properties.code.enum`
  değerinin `API_ERROR_CODES` ile birebir eşleştiği doğrulanır.
- `apps/api/openapi.json` yeniden üretildi.

Üretilen belgedeki değer:

```json
"code": {
  "type": "string",
  "enum": ["VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "DRAFT_CONFLICT", "RUN_ALREADY_ACTIVE", "IDEMPOTENCY_CONFLICT", "RUN_NOT_TERMINAL", "COMPARISON_PLAN_MISMATCH", "TOO_MANY_REQUESTS", "INTERNAL_ERROR", "SERVICE_UNAVAILABLE"],
  "description": "Stable application error code. This list matches the API contract.",
  "example": "VALIDATION_ERROR"
}
```

## Çalıştırılan komutlar ve gerçek sonuçlar (2026-11-03)

Komutlar sırayla, tek tek çalıştırıldı; `prisma generate` yarışı oluşmadı.

| Komut | Gerçek sonuç |
|---|---|
| `npm run lint --workspace apps/api` | `Found 0 warnings and 0 errors.` 62 dosya, 107 kural. Exit 0. |
| `npm run typecheck --workspace apps/api` | `tsc --noEmit -p tsconfig.json` hatasız. Exit 0. |
| `npm run test --workspace apps/api` | 7 test dosyası, **38 test geçti**. Exit 0. |
| `npm run db:migrate:test --workspace apps/api` | 2 migration bulundu; `No pending migrations to apply.` Exit 0. |
| `npm run test:e2e --workspace apps/api` | 7 test dosyası, **42 test geçti** (7.89s). Exit 0. |
| `npm run build --workspace apps/api` | `nest build` başarılı. Exit 0. |
| `npm run openapi:emit --workspace apps/api` | `Wrote OpenAPI document to .../apps/api/openapi.json`. Exit 0. |

Ek doğrulamalar:

| Kontrol | Sonuç |
|---|---|
| Production + `SESSION_COOKIE_SECURE=false` ile `node apps/api/dist/main.js` | Exit 1; `SESSION_COOKIE_SECURE must be "true" when NODE_ENV is "production".` Secret yok. |
| DB kapalı (`:59999`) ile `/api/health/ready` | 503; `details.checks.database=unavailable`. |
| DB kapalı (`:59999`) ile `POST /api/auth/login` | 503; `code=SERVICE_UNAVAILABLE`; DSN/SQL/stack yok. |
| Boş geçici DB ile `/api/health/ready` | 503; `details.checks={database:"ok",migrations:"pending"}`. |
| Boş geçici DB ile `POST /api/auth/login` | 503 `SERVICE_UNAVAILABLE` (P2021 eşlemesi). |
| Geçici DB temizliği | `DROP DATABASE`; `remaining_db_count: 0`. |
| Persistence guard, 5 ret senaryosu | Hepsi exit 1; hiçbiri DB/container komutuna ulaşmadı. |
| Test setup, `DATABASE_URL` yok | Setup aşamasında fail; test gövdesi çalışmadı. |
| Test setup, aynı DB kimliği | Setup aşamasında fail; test gövdesi çalışmadı. |
| 10 hatalı + 11. login | 429; `Retry-After: 900`. |

## Açık kalanlar ve devir notları

1. **`packages/api-client/src/schema.ts` yeniden üretilmedi.** Bu worker'ın sahiplik alanı
   dışındadır. `apps/api/openapi.json` değişti; lead `npm run openapi:generate` ve
   `npm run openapi:check` çalıştırmalıdır. Bu nedenle `openapi:check` bu worker tarafından
   çalıştırılmadı ve "yeşil" iddia edilmiyor.
2. **B12 uygulanmadı.** `/auth/me` yalnızca `csrfTokenHash` null olduğunda CSRF token üretmeye
   devam ediyor. Cookie kaybında token rotasyonu, yalnızca oturum cookie'sine sahip bir
   saldırgana da yeni CSRF token verebileceği için güvenlik değerlendirmesi gerektirir; dar
   kapsamda değiştirilmedi. UI tarafında oturumu yenileme akışı veya ayrı bir sertleştirme
   görevi önerilir.
3. **B6 süreç-global cap yok.** IP başına toplu limit ve `Retry-After` eklendi; tüm IP'lerin
   toplamını sınırlayan global cap eklenmedi. Tek süreçli dağıtım hedefi için IP bazlı limit
   pratik koruma sağlar; farklı bir gereksinim doğarsa ayrıca değerlendirilmelidir.
4. **B9, B10, B11, B13, B14** bu worker'ın sahiplik alanı dışındadır (apps/web ve lead
   dokümanları). Lead/başka worker tarafından ele alınmalıdır.
5. **Tarayıcı tabanlı smoke ve gerçek HTTPS/proxy testi** yapılmadı; cookie `Secure`
   davranışı Supertest ve ortam doğrulaması ile kanıtlandı.
6. **Bağımsız yeniden inceleme** yapılmadı. Bu dosya yalnızca düzeltme kanıtıdır; görev kartları
   `In Review` kalır ve `Accepted` yapılmaz.
