# Phase 8 — sürüm adayı ve teslim paketi

- Tarih: 2026-11-04
- Aday sürüm: `v0.1.0-rc.1` → commit `270a399`
- Kapsam: P8-01–P8-04 teknik kabulü, P8-05 kullanıcı waiver'ı, P8-06 sürüm adayı.
- Nihai ürün kabulü: **Kullanıcıda açık.** Bu belge ürün kabulü değildir.

## Doğrulanan taban

Sürüm adayından önceki doküman/kabul commit'i `81a7f2c` üzerinde:

```text
GitHub Actions run 41900767940 (270a399, release candidate)
API quality            success
API integration        success
OpenAPI contract       success
Web quality            success
Playwright E2E         success
CI required            success

Önceki taban 81a7f2c / run 41899919132: 6/6 success
```

Yerel doğrulama (aynı ağaç):

```text
npm run verify
→ exit 0; API 16 dosya/118 test; web 36 dosya/370 test; build; OpenAPI current

npm run test:e2e --workspace apps/api
→ 22 dosya / 197 test geçti (33.96 s)

E2E_DATABASE_URL=...probedesk_e2e_test E2E_BASE_URL=http://127.0.0.1:4300 \
E2E_API_URL=http://127.0.0.1:3101 npm run test:e2e
→ 2 passed (36.6 s): compare + main demo

npm run openapi:check
→ OpenAPI contract is current
```

Delivery stack son kontrolü:

```text
docker compose --profile delivery ps -a
→ api healthy, web healthy, postgres healthy, migrate Exited(0), seed Exited(0)

GET http://127.0.0.1:8080/api/health/ready
→ 200 {"status":"ok","checks":{"database":"ok","migrations":"ok"}}

probedesk_delivery_check
→ 1 plan, 4 runs, 3 users
```

Bağlantı kontrolü: README + `docs/` kapsamındaki 16 dosyada 349 göreli bağlantı/görsel,
0 kırık. Video dosyası/bağlantısı yoktur.

## Paket içeriği

- Çalışan Angular SPA + NestJS API + PostgreSQL/Prisma, Docker Compose delivery profili.
- Migration + idempotent demo seed + API + nginx same-origin proxy.
- Üç demo hesabı, `Power Supply Validation` v1/v2 ve dört run
  (`FAILED`, iki `PASSED`, kısmi `CANCELLED`).
- API birim/entegrasyon, Angular bileşen, gerçek PostgreSQL/HTTP, süreç yarışı/recovery,
  Playwright ana demo + karşılaştırma ve erişilebilirlik kontrolleri.
- Gerçek GitHub Actions pipeline'ı: kalite, entegrasyon, contract, Playwright E2E ve
  `ci_required`.
- README, mimari/API/veri modeli/test/demo/kabul belgeleri ve kanıt dizini.

## Açık işler

1. **Kullanıcı ürün kabulü** — [acceptance.md](../acceptance.md) ürün kutuları ve nihai
   kapsam/yayın kararı kullanıcıdadır.
2. **P8-05 demo videosu** — kullanıcı kararıyla kapsam dışı; dosya ve bağlantı yoktur.
3. **Ortam sınırları** — boş işletim sistemi kurulumu test edilmedi (host Node/PostgreSQL
   PATH'ten çıkarılarak doğrulandı); tarayıcı doğrulaması Chrome 1280/768 px ile sınırlıdır.
4. **P8-01 Low** — `PROBEDESK_DELIVERY_PORT` özel portundayken nginx `/api` yönlendirmesi iç
   `8080`'e gider; varsayılan 8080 kurulumu etkilenmez.

## Etiket

`v0.1.0-rc.1` etiketi `270a399` commit'ine atıldı ve `origin`e push edildi. Bu commit'in CI koşusu
`41900767940` altı işin tamamında yeşildir. Etiketin hedefi ve koşu bağlantısı P8-06 kartında da
kayıtlıdır.
