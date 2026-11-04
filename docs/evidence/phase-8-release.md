# Phase 8 — sürüm adayı ve teslim paketi

- Tarih: 2026-11-04
- Aday sürüm: `v0.1.0-rc.2` → commit `10798fa`
- Kapsam: P8-01–P8-04 teknik kabulü, P8-05 kullanıcı waiver'ı, P8-06 sürüm adayı.
- Nihai ürün kabulü: **Kullanıcıda açık.** Bu belge ürün kabulü değildir.

## Doğrulanan taban

Sürüm adayı commit'i `10798fa` üzerinde; önceki doğrulanmış taban `81a7f2c` idi:

```text
GitHub Actions run 41916047120 (10798fa, release candidate v0.1.0-rc.2)
API quality            success
API integration        success
OpenAPI contract       success
Web quality            success
Playwright E2E         success
CI required            success

Önceki aday 270a399 / run 41900767940: 6/6 success
Önceki taban 81a7f2c / run 41899919132: 6/6 success
```

Yerel doğrulama (aynı ağaç):

```text
npm run verify
→ exit 0; API 16 dosya/118 test; web 36 dosya/384 test; build; OpenAPI current

npm run test:e2e --workspace apps/api
→ 22 dosya / 200 test geçti (33.00 s)

E2E_DATABASE_URL=...probedesk_e2e_test E2E_BASE_URL=http://127.0.0.1:4300 \
E2E_API_URL=http://127.0.0.1:3101 npm run test:e2e
→ 2 passed (37.9 s): compare + main demo (doğal Start→Live navigasyonu)

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

Bağlantı kontrolü: README + `docs/` kapsamındaki 141 dosyada 1098 göreli bağlantı/görsel,
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
4. **P8-01 Low (kapandı)** — `PROBEDESK_DELIVERY_PORT` özel portunda nginx `/api` yönlendirmesi
   artık göreli `Location: /api/` üretiyor; `18080` portunda doğrulandı.

## Etiket

`v0.1.0-rc.1` etiketi `270a399` commit'ine atıldı ve `origin`e push edildi. Bu commit'in CI koşusu
`41900767940` altı işin tamamında yeşildir. Genel inceleme düzeltmeleri sonrasında `v0.1.0-rc.2`
etiketi `10798fa` commit'ine atandı ve `origin`e push edildi; CI koşusu `41916047120` altı işin
tamamında yeşildir. Güncel sürüm adayı rc.2'dir.

## Genel inceleme sonrası düzeltmeler ve rc.2

`v0.1.0-rc.1` sonrasında yapılan genel kod incelemesi altı doğrulanmış bulgu ortaya çıkardı; düzeltmeler
`3f15ab9`, `76b2b6f`, `c2e3660`, `44de016` ve `6f889a8` commit'lerinde, kanıtları
[general-review-fixes.md](general-review-fixes.md) içindedir. Bunlar yalnız doküman değil çalışma
zamanı davranışı değiştirdiği için `v0.1.0-rc.1` süperseded olur. Yeni sürüm adayı
**`v0.1.0-rc.2`**, bu kanıtı içeren `10798fa` commit'ine atandı; CI koşusu `41916047120` altı işin
tamamında yeşildir. Nihai etiket hedefi ve koşu bağlantısı P8-06 kartında kayıtlıdır.
