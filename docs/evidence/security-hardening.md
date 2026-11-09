# Güvenlik sertleştirmesi kanıtı (SEC-01)

- Tarih: 2026-11-09
- Branch: `fix/security-hardening`
- Taban commit: `121568b`
- Uygulama commit'leri: `66e73fc` (proxy/başlıklar/Swagger/web CSP), `b2752eb` (SSE/OpenAPI),
  `e7a54f4` (bağımlılıklar/CI)
- Çalışma ortamı: macOS arm64, Node.js `22.23.2`, npm `11.6.2` (npx ile sabitlenmiş sürüm;
  sistem npm `10.9.8`).
- Teslim topolojisi: Docker Compose delivery — gerçek PostgreSQL 18.1, nginx ters proxy, API ve web
  container'ları. Worker C bu turda Docker/e2e çalıştırmadı; delivery ve tam e2e kontrolleri lead
  tarafından aşağıdaki bölümde çalıştırıldı.
- Kapsam: proxy hız sınırı, güvenlik başlıkları, SSE kapasitesi, production Swagger, bağımlılık
  audit'i ve CI audit kapısı. Gerçek token/cookie/parola kaydedilmedi.

## Düzeltme öncesi doğrulanan bulgu

Teslim topolojisinde (nginx → API) login hız sınırı istemci başına ayrışmıyordu:

```text
İstemci A (172.23.0.5): 50 başarısız login → 401
İstemci B (172.23.0.6): geçerli login       → 429
API restart sonrası aynı geçerli login      → 200
```

Kök neden: Express `trust proxy` kapalıydı; `request.ip` nginx container adresini döndürüyordu.
Bu yüzden bütün istemciler tek throttle anahtarını paylaşıyordu ve bir istemcinin hataları
diğerlerini kilitliyordu.

## Düzeltme özeti

- `apps/api/src/config/env.ts`: `TRUST_PROXY` boolean olarak doğrulanıyor ve `AppConfig` içine
  taşınıyor. Geçersiz değer başlangıçta reddediliyor.
- `apps/api/src/main.ts`: `configureApp(app, { trustProxy: config.trustProxy })`;
  `compose.yaml` delivery API ortamında `TRUST_PROXY: "true"` veriyor.
- `apps/api/src/common/bootstrap/configure-app.ts`:
  - `trustProxy` açıkken Express `trust proxy=1` (tam bir proxy hop'u).
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
    `Referrer-Policy: strict-origin-when-cross-origin`,
    `Permissions-Policy: camera=(), microphone=(), geolocation=()` tüm API yanıtlarında.
  - `x-powered-by` kapatıldı.
  - CSP bilinçli olarak delivery proxy'sine bırakıldı (Swagger UI geliştirmede inline stil/kod
    kullanıyor).
- `infra/nginx/default.conf`: `X-Forwarded-For` başlığı `$remote_addr` ile doğrudan istemci
  adresini taşır; statik/SPA yanıtlarında dört güvenlik başlığı, SPA HTML'de ayrıca
  `default-src 'self'` tabanlı CSP vardır. `/api/` altında CSP yoktur; Swagger UI geliştirmede
  inline stil/kod kullanabilsin diye bu bilinçli bir istisnadır. `X-Powered-By` ayrıca
  `proxy_hide_header` ile de gizlenir.
- `apps/web/angular.json`: production build'de `inlineCritical: false`. Angular'ın `index.html`
  içine gömdüğü kritik-CSS script'i kaldırıldı; aksi halde `script-src 'self'` CSP'si bu script'i
  bloklar ve stillerin yüklenmesi bozulurdu. Yeni build'de inline `<script>`/`<style>` yok.
- `apps/api/src/events/run-events.options.ts`: kullanıcı başına 5, süreç toplamı 100 aktif akış.
- `apps/api/src/events/run-events.service.ts`: kapasite kontrolü SSE başlıkları yazılmadan önce;
  sınır aşılırsa `429 TOO_MANY_REQUESTS` JSON gövdesi; bağlantı kapanınca kapasite salınıyor.
- `apps/api/src/common/openapi/openapi.ts`: `NODE_ENV=production` iken `setupSwagger` erken
  dönüyor; `/api/docs` ve `/api/docs-json` yayınlanmıyor.
- Bağımlılıklar: `zod` `4.1.12 → 4.6.7`, `@nestjs/cli` `12.0.11 → 12.0.12`, `concurrently`
  `9.2.1 → 9.2.5`. Tek kök `package-lock.json` güncellendi; nested lockfile oluşturulmadı.
- `.github/workflows/ci.yml`: `api_quality` işinde kurulumdan sonra ve lint'ten önce
  `Audit production dependencies` adımı:
  `npx --yes npm@11.6.2 audit --omit=dev --audit-level=high`.

İlgili otomatik testler (lead tarafından tam e2e ile çalıştırılacak):

- `apps/api/test/auth.e2e-spec.ts` →
  `isolates login throttling per client address when trust proxy is enabled`
  (50 hatalı deneme A'yı 401'de tutar; B geçerli login 200; A geçerli login 429).
- `apps/api/test/common-behaviour.e2e-spec.ts` → güvenlik başlıkları ve `x-powered-by` yokluğu.
- `apps/api/test/sse.e2e-spec.ts` → kullanıcı başına limit, başlık öncesi 429, abort sonrası
  kapasite salınımı.
- `apps/api/test/openapi.e2e-spec.ts` → production'da Swagger UI yok.

## Worker C tarafından çalıştırılan komutlar ve gerçek sonuçlar

### Bağımlılık kurulumu ve sürüm doğrulaması

```text
$ npx --yes npm@11.6.2 install
added 1 package, removed 2 packages, changed 13 packages, and audited 752 packages in 4s
175 packages are looking for funding
found 0 vulnerabilities
```

```text
$ npx --yes npm@11.6.2 ls zod concurrently @nestjs/cli --all
probedesk@0.1.0 /Users/kemalselcuk/.t3/projects/probedesk
├─┬ @probedesk/api@0.0.1 -> ./apps/api
│ ├── @nestjs/cli@12.0.12
│ └── zod@4.6.7
├─┬ @probedesk/web@0.0.0 -> ./apps/web
│ ├─┬ @angular/cli@22.2.5
│ │ ├─┬ @modelcontextprotocol/server@2.3.1
│ │ │ ├─┬ @modelcontextprotocol/core@2.3.1
│ │ │ │ └── zod@4.6.6 deduped
│ │ │ └── zod@4.6.6 deduped
│ │ └── zod@4.6.6
│ └─┬ @angular/forms@22.2.4
│   └── zod@4.6.6 deduped
└── concurrently@9.2.5
EXIT:0
```

### Audit — önce / sonra

Düzeltme öncesi production audit (`--omit=dev`):

```text
zod  <4.6.6
Severity: high
Zod can exhaust memory while validating oversized constrained collections
1 high severity vulnerability
EXIT:1
```

Düzeltme öncesi tam audit (özet):

```text
minimatch 7.0.0 - 11.0.0 — moderate (globparts amplification)
  @nestjs/cli 12.0.0-alpha.0 - 12.0.11
shell-quote <=1.8.4 — critical (newline escape + quadratic parse DoS)
  concurrently 9.2.1
zod <4.6.6 — high
5 vulnerabilities (2 moderate, 1 high, 2 critical)
EXIT:1
```

Düzeltme sonrası:

```text
$ npx --yes npm@11.6.2 audit --omit=dev --audit-level=high
found 0 vulnerabilities
EXIT:0

$ npx --yes npm@11.6.2 audit
found 0 vulnerabilities
EXIT:0
```

### Kod kontrolleri

```text
$ npm run test:api:unit
Test Files  19 passed (19)
     Tests  147 passed (147)
Duration  939ms
EXIT:0
```

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 427ms on 187 files with 107 rules using 8 threads.
EXIT:0
```

```text
$ npm run typecheck --workspace apps/api
tsc --noEmit -p tsconfig.json
EXIT:0
```

## Lead tarafından çalıştırılan son kontroller

- `npm run verify`: **çıkış 0**. Lint + typecheck temiz; API unit **19 dosya / 147 test**;
  web **45 dosya / 496 test**; API ve web production build başarılı; `openapi:check`
  `OpenAPI contract is current` verdi.
- `npm run test:e2e --workspace apps/api`: **29 dosya / 283 test geçti**, 46.53 sn. Auth throttle
  izolasyonu, güvenlik başlıkları, SSE per-user/process limitleri ve production Swagger 404
  testleri dahil.
- `npx vitest run --config ./vitest.config.e2e.ts test/sse.e2e-spec.ts`: **15/15 geçti**
  (per-user cap, process-wide cap ve abort sonrası kapasite salınımı).
- `npx --yes npm@11.6.2 audit --omit=dev --audit-level=high`: `found 0 vulnerabilities`, çıkış 0.
- Docker delivery `--profile delivery up -d --build`: API, web, migrate ve seed imajları
  yenilendi; `api/health/ready` 200, login 200.

### Canlı delivery header kontrolü

`GET /`:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

`GET /api/health/live`: dört güvenlik başlığı var; `Content-Security-Policy` yok;
`X-Powered-By` yok. Statik JS yanıtı `Cache-Control: public, max-age=31536000, immutable` ve dört
güvenlik başlığı taşıyor.

Yerel delivery `NODE_ENV=development` olduğu için `/api/docs` ve `/api/docs-json` bu ortamda 200
döndü. Production kapısı ayrı test app’inde (`NODE_ENV=production`) `/api/docs` → 404 olarak
doğrulandı; delivery ortamında production yapılandırması çalıştırılmadı.

### Canlı proxy/throttle kontrolü

Docker ağında iki ayrı istemci container’ı:

```text
İstemci A (172.23.0.5): 50 hatalı login -> 50 x 401
İstemci B (172.23.0.6): doğru login      -> 200
İstemci C (172.23.0.5): doğru login      -> 429 TOO_MANY_REQUESTS
API restart sonrası doğru login          -> 200
```

Bu, düzeltme öncesindeki “B de 429 alıyor” davranışının kapandığını ve aynı adresin kendi
kilitlenmesini koruduğunu gösterir.

### Gerçek Chrome CSP smoke

Playwright + kurulu Google Chrome ile `/login → /overview → /plans → /runs`:

- CSP violation: **0**
- `pageerror`: **0**
- Beklenen anonim `/api/auth/me` 401 konsol kaydı dışında hata yok
- Stil yüklendi (`body` arka planı `rgb(246, 248, 251)`), Plans tablosu ve Run History başlığı
  görünür
- `Blob` + `URL.createObjectURL` ile CSV indirmesi çalıştı (`probedesk-csp-test.csv`), CSP
  ihlali yok

### Ara koşu notu

Bir tam e2e koşusunda `database.e2e-spec.ts` içindeki batch-index plan testi bir kez düştü
(`test_runs_batchNumberKey_startedAt_id_idx` / `Sort` beklentisi). Test tek başına ve sonraki tam
koşuda geçti; sonuç **29 dosya / 283 test**. Bu, cost-based PostgreSQL plan testinin mevcut
flakiness’i; ürün kodu veya SEC-01 değişikliğiyle ilişkilendirilmedi.

## Sınırlamalar

- Yerel Docker ana makinesinden yayınlanan portta istemciler Docker gateway adresini
  paylaşabilir. Gerçek istemci başına ayrışma, istemci IP'sini koruyan bir L7 proxy arkasında
  anlamlıdır.
- `TRUST_PROXY=true` iken API doğrudan dışarıya açılmamalıdır; aksi halde istemci
  `X-Forwarded-For` başlığını taklit edebilir. Teslim topolojisinde API yalnızca nginx üzerinden
  erişilebilir olmalıdır.
- Süreç toplamı 100 akış limiti kod yolunda mevcut; bu turda ayrı bir toplam-limit testi
  çalıştırılmadı. Kullanıcı başına 5 limiti ve kapasite salınımı e2e testinde kapsanıyor.
- Worker C web testi, tam e2e, build, Docker veya `verify` çalıştırmadı. Bu kontroller lead
  tarafından yürütülecek.
