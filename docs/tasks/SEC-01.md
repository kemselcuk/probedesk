# SEC-01 — Güvenlik sertleştirmesi: proxy hız sınırı, başlıklar, SSE ve bağımlılıklar

- Durum: **In Review**
- Sahiplik: Entegrasyon
- Bağımlılıklar: [P1-06](P1-06.md), [P7-02](P7-02.md)
- Gereksinimler: REQ-02, REQ-23
- Ek altyapı maliyeti: €0 hedefi; ücretli hizmet veya yeni dış servis yok.

## Amaç ve çıktı

Teslim topolojisinde (nginx → API) güvenlik davranışını sertleştir: login hız sınırının gerçek
istemci adresine göre ayrışması, API/statik yanıtlarda güvenlik başlıkları ve SPA HTML'de CSP,
SSE akış kapasitesi sınırları, production'da kapalı Swagger ve production bağımlılıklarında
açık high/critical audit bulgusu bırakmayan sürüm seti.

## Değişiklik alanı

- `apps/api/src/config/env.ts`, `apps/api/src/main.ts`
- `apps/api/src/common/bootstrap/configure-app.ts`
- `apps/api/src/events/run-events.options.ts`, `apps/api/src/events/run-events.service.ts`
- `apps/api/src/common/openapi/openapi.ts`
- `infra/nginx/default.conf`, `compose.yaml`
- `apps/web/angular.json` (CSP ile uyum için `inlineCritical: false`)
- `apps/api/test/` (auth, common behaviour, SSE, OpenAPI)
- `package.json`, `apps/api/package.json`, `package-lock.json`
- `.github/workflows/ci.yml`
- `docs/tasks/`, `docs/evidence/`

## Kabul ölçütleri

- [x] Ters proxy arkasında login throttle gerçek istemci adresine göre ayrışır; bir istemcinin
      50 hatası başka istemciyi 429'a düşürmez. — `TRUST_PROXY=true` iken Express
      `trust proxy=1`; nginx `X-Forwarded-For $remote_addr` ile doğrudan istemci adresini yazar.
      Otomatik test: `apps/api/test/auth.e2e-spec.ts` →
      `isolates login throttling per client address when trust proxy is enabled`. Tam e2e geçti;
      canlı delivery kontrolünde A (`172.23.0.5`) 50×401 sonrası B (`172.23.0.6`) 200, A aynı
      adresten 429 aldı.
- [x] API/statik yanıtlarda `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
      `Permissions-Policy`; SPA HTML'de CSP; `X-Powered-By` yok. — API başlıkları
      `configure-app.ts`, SPA/statik başlıkları `infra/nginx/default.conf`. `apps/web/angular.json`
      içinde `inlineCritical: false` yapıldı; Angular'ın inline kritik-CSS script'i CSP ile
      çakışmıyor. Otomatik test: `apps/api/test/common-behaviour.e2e-spec.ts`; canlı başlıklar ve
      gerçek Chrome CSP smoke testi geçti.
- [x] SSE kullanıcı başına 5 / süreç toplam 100; sınır aşıldığında header yazılmadan 429;
      kapanan akış kapasiteyi serbest bırakır. — Limitler `run-events.options.ts`, kapasite
      kontrolü `run-events.service.ts` içinde SSE başlıklarından önce. Otomatik test:
      `apps/api/test/sse.e2e-spec.ts` → per-user cap, toplam/process cap ve abort sonrası kapasite
      salınımı (15/15).
- [x] `NODE_ENV=production` iken `/api/docs` ve `/api/docs-json` yok. — `openapi.ts`
      `setupSwagger` production'da erken dönüyor. Otomatik test:
      `apps/api/test/openapi.e2e-spec.ts` geçti. Yerel delivery development modunda olduğu için
      orada dokümanlar açık kalır; production kapısı e2e ile doğrulandı.
- [x] Runtime bağımlılıklarında high/critical audit bulgusu yok; CI production audit adımı var. —
      `zod@4.6.7`, `@nestjs/cli@12.0.12`, `concurrently@9.2.5`; `api_quality` işine
      `Audit production dependencies` adımı eklendi. `npm audit` ve `npm audit --omit=dev`
      sıfır bulgu verdi.
- [x] Kanıt komutları ve gerçek sonuçları kayıtlı. — [security-hardening.md](../evidence/security-hardening.md).

## Doğrulama

Gerçekten çalıştırılanlar (2026-11-09):

- `npx --yes npm@11.6.2 install`: 1 paket eklendi, 2 kaldırıldı, 13 değişti; 752 paket denetlendi;
  `found 0 vulnerabilities`.
- `npx --yes npm@11.6.2 ls zod concurrently @nestjs/cli --all`: API'de `zod@4.6.7`,
  `@nestjs/cli@12.0.12`; kökte `concurrently@9.2.5`; çıkış 0.
- `npx --yes npm@11.6.2 audit --omit=dev --audit-level=high`: `found 0 vulnerabilities`, çıkış 0.
- `npx --yes npm@11.6.2 audit`: `found 0 vulnerabilities`, çıkış 0.
- `npm run test:api:unit`: 19 dosya / 147 test geçti, çıkış 0.
- `npm run lint --workspace apps/api`: 187 dosyada 0 uyarı, 0 hata, çıkış 0.
- `npm run typecheck --workspace apps/api`: çıkış 0.
- `npm run verify`: çıkış 0 (lint + typecheck + API unit 19/147 + web 45/496 + build +
  `openapi:check`).
- `npm run test:e2e --workspace apps/api`: **29 dosya / 283 test geçti**, 46.53 sn.
- `npx vitest run --config ./vitest.config.e2e.ts test/sse.e2e-spec.ts`: **15/15 geçti**
  (per-user cap, process-wide cap, abort sonrası kapasite).
- Docker delivery `--profile delivery up -d --build`: API/web/migrate/seed imajları yenilendi;
  readiness 200, login 200.
- Canlı header kontrolü: `/` ve `/api/health/live` üzerinde dört güvenlik başlığı var;
  `/` üzerinde CSP var; `/api/` üzerinde CSP yok; `X-Powered-By` yok.
- Canlı proxy izolasyonu: A (`172.23.0.5`) 50 hatalı login → 50×401; B (`172.23.0.6`) doğru
  login → 200; aynı A adresinden doğru login → 429; API restart sonrası login → 200.
- Gerçek Chrome CSP smoke: `/login → /overview → /plans → /runs`; CSP violation yok, sayfa
  hataları yok (anonim `/auth/me` 401'i beklenen), stil yüklendi; blob CSV indirmesi çalıştı.
- Ara koşu notu: bir tam e2e koşusunda `database.e2e-spec.ts` batch-index plan testi bir kez
  düştü; tek başına ve sonraki tam koşu (283/283) geçti. Bu, cost-based plan testinin mevcut
  flakiness'i; ürün değişikliği değil. Kanıtta korunur.
- PR CI ilk koşusunda Playwright feature-pack overview response body'sini SPA navigasyonu sonrası
  okuduğu için düştü; test `page.request` ile düzeltildi ve tam Playwright paketi yerelde
  **10/10** geçti. `CI required` aynı kök nedene bağlıydı.

## Okunacak sözleşmeler

- [requirements.md](../requirements.md)
- [architecture.md](../architecture.md)
- [api.md](../api.md)
- [testing.md](../testing.md)

## İnceleme ve kanıt kaydı

- Branch: `fix/security-hardening`; taban commit `121568b`.
- Uygulama commit'leri: `66e73fc` (proxy/başlıklar/Swagger/web CSP), `b2752eb` (SSE/OpenAPI),
  `e7a54f4` (bağımlılıklar/CI).
- Düzeltme kapsamı: `TRUST_PROXY` + Express `trust proxy=1` + nginx `X-Forwarded-For` başlığında
  `$remote_addr`; ortak güvenlik başlıkları ve `x-powered-by` kapatma; SPA CSP; SSE 5/100
  kapasitesi ve başlık öncesi 429; production Swagger kapatma; bağımlılık yükseltmeleri;
  CI production audit kapısı.
- Düzeltme öncesi doğrulanan bulgu: 50 başarısız login (istemci A, `172.23.0.5`) 401 dönerken
  geçerli login (istemci B, `172.23.0.6`) 429 dönüyordu; API yeniden başlatılınca 200'e döndü.
  Kök neden: Express `trust proxy` kapalı olduğu için `request.ip` nginx container adresiydi.
- Worker C komutları, lead `verify`/e2e ve canlı delivery/browser sonuçları:
  [security-hardening.md](../evidence/security-hardening.md).
- Ayrı teknik inceleme: henüz yapılmadı; kart In Review.
- Nihai görev/aşama kabulü ve ürün kabulü: kullanıcıda; verilmiş sayılmaz.
