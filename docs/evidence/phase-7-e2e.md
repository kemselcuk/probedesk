# Phase 7 — ana demo E2E kanıtı (P7-01)

- Tarih: 2026-11-04
- Görev: [P7-01](../tasks/P7-01.md) — ana demo akışının Playwright testi
- Kapsam: gerçek Angular uygulaması, gerçek API, gerçek PostgreSQL ve gerçek yürütücü
- Test: [`tests/e2e/main-demo.spec.ts`](../../tests/e2e/main-demo.spec.ts)
- Ortam: API `http://127.0.0.1:3100` (`node apps/api/dist/main.js`), web
  `http://127.0.0.1:4200` (`ng serve`, `/api` proxy → 3100), PostgreSQL 18
  geliştirme veritabanı (`127.0.0.1:5434`), Chrome (Playwright `channel: 'chrome'`,
  headless).
- Demo hesapları: `planner@probedesk.local`, `operator@probedesk.local`.
- Son koşu plan adı: `E2E Main Demo <Date.now()>` (her koşuda yeni, önceden seed edilmiş
  run sonucu yok).

## Kapsanan senaryo

Test tek bir Playwright testi içinde iki rol oturumu açar. Plan, adımlar ve run'lar
yalnızca UI üzerinden oluşturulur; test hiçbir run sonucu yazmaz.

Sabit demo ayarları: 8 örnek × 300 ms, toplam 24 örnek. `FORCED_FAILURE` hata indeksi
`floor((8 - 1) / 2) = 3`; Current Draw için üretilen değer `0.600000 A`
(`0.55 + (0.55 - 0.45) / 2`). Bu indeks hem Live Run'da hem Run Details'te hem de
karşılaştırmada `Sample 3` olarak doğrulanır.

| Adım | UI işlemi | Testin doğruladığı gözlenebilir durum |
|---|---|---|
| 1 | Planner `/login` formuyla giriş yapar, Test Plans'ta plan oluşturur | `/plans/:planId/edit`, plan adı, `DC Power Module (DC_POWER_MODULE)` profili |
| 2 | Üç adım eklenir: Output Voltage 4.75–5.25 V, Current Draw 0.45–0.55 A, Case Temperature 20–60 °C; 8 örnek / 300 ms | Adım alanları; ilk sıra |
| 3 | Current Draw klavyeyle aşağı (Space) ve yukarı (Enter) taşınır | Kart sırası Step 2 → Step 3 → Step 2; her taşımadan sonra alanlar aynı |
| 4 | `Save draft`, sayfa yenileme, `Publish` + onay | `All changes saved`; yenilemeden sonra sıra/alanlar kalıcı; `Version 1 published`, salt okunur sürüm ekranı, 3 adım |
| 5 | Operator sürüm sayfasından `Start run`; FORCED_FAILURE, seed 42, Current Draw | Live Run ekranı önce `Running` ve artan ilerleme, sonra `Failed`; 24/24 örnek |
| 6 | Hata noktası ve devam eden adım | Current Draw: `First failing sample: 3`, `Completed`, `Failed`, 8/8 örnek, 1 ihlal; Case Temperature: `Completed`, `Passed` |
| 7 | `View run details` | İlk hata özeti: `Step 2: Current Draw`, `Sample index 3`, `0.600000 A`; ölçüm satırı `Outside tolerance` ve seçili; gerçek canvas tooltip'i `0.600000` |
| 8 | Aynı v1 ile NORMAL run | Live Run `Passed`; üç adım da `Passed`; terminal özeti tüm adımların geçtiğini söyler |
| 9 | Run History'de plan filtresi | FAILED ve PASSED iki koşu görünür; FAILED satırında `Sample index 3`, PASSED satırında `None` |
| 10 | History'de iki koşu seçilip `Compare` | `/compare?leftRunId=…&rightRunId=…`; aynı sürüm notu, 3 ortak adım, 0 eklenen/kaldırılan/değişen kural; Current Draw maksimumu iki tarafta da `0.550000`, kural deltası `—`; sonuçlar Failed/Passed; ihlal 1/0; ilk hata `Sample 3`/`None recorded` |
| 11 | Planner v1'den yeni taslak açar, yalnız Current Draw maksimumunu `0.65` yapar, v2 yayımlar | `Version 2 published`; v2 sürüm tablosunda Current Draw maksimumu `0.650000` |
| 12 | Eski FAILED run yeniden açılır | Hâlâ `Version 1`, `Failed`, snapshot kuralı `0.550000 A` |
| 13 | Operator v2 ile NORMAL run başlatır | `/runs/new?versionId=…` ekranında maksimum `0.650000`; run `Passed` |
| 14 | v1 FAILED ile v2 PASSED karşılaştırılır | Farklı sürüm notu; 1 değişen kural; Current Draw `0.550000 → 0.650000`, `Changed` işareti, kural deltası `—`; sonuçlar Failed/Passed; senaryo farkı notu |

Birim değişimi senaryosu P7-01 ana akışında tekrarlanmadı; aynı tam suite içinde çalışan
[`tests/e2e/compare.spec.ts`](../../tests/e2e/compare.spec.ts) `°C → °F` değişimini, iki ayrı
paneli ve `Not calculated — units differ` metnini doğruluyor. Bu test de aşağıdaki tam
suite koşusunda geçti.

## Çalıştırılan komutlar ve gerçek sonuçlar

```text
$ npx playwright test --list
Listing tests:
  compare.spec.ts:161:5 › compares a failed v1 run with v2 after the tolerance changed to 0.65 A
  main-demo.spec.ts:467:5 › runs the main demo flow through plans, live execution, history, compare and v2
Total: 2 tests in 2 files
```

```text
$ set -a; source .env; set +a
$ E2E_DATABASE_URL="$DATABASE_URL" npm run test:e2e
> probedesk@0.1.0 test:e2e
> playwright test

Running 2 tests using 1 worker

  ✓  1 tests/e2e/compare.spec.ts:161:5 › compares a failed v1 run with v2 after the tolerance changed to 0.65 A (6.6s)
  ✓  2 tests/e2e/main-demo.spec.ts:467:5 › runs the main demo flow through plans, live execution, history, compare and v2 (32.7s)

  2 passed (41.2s)
```

```text
$ E2E_DATABASE_URL="$DATABASE_URL" npm run test:e2e -- tests/e2e/main-demo.spec.ts
Running 1 test using 1 worker

  ✓  1 tests/e2e/main-demo.spec.ts:467:5 › runs the main demo flow through plans, live execution, history, compare and v2 (51.4s)

  1 passed (53.5s)
```

Son iki koşu yukarıdaki komutlardır. Ana testte sabit `waitForTimeout` zinciri yoktur;
durumlar URL, başlık, durum etiketi, satır metni ve `expect.poll` ile beklenir. Tek
beklemeli döngü, hata durumunda temizlik öncesi aktif run'ın bitmesini bekleyen
veritabanı poll'üdür.

## Veritabanı temizliği

Test, oluşturduğu planı ve tüm run'ları `E2E_DATABASE_URL` üzerinden
`compare.spec.ts` ile aynı `pg` deseniyle siler; ek olarak kendi açtığı oturumları geri
alır. Tam suite sonunda ölçülen değerler:

```text
BEFORE  plans=2  runs=36  sessions=268
AFTER   plans=2  runs=36  sessions=268
AFTER   active runs=0
AFTER   plans named "E2E Main Demo%" = 0
```

`npm run test:e2e` tam suite'i de aynı baseline'ı bırakır. Bunun için
`compare.spec.ts`'in kendi açtığı API/tarayıcı oturumları da temizlik kapsamına alındı.

## Kanıt dosyaları

- [phase-7-live-running.png](phase-7-live-running.png) — Live Run `Running`,
  `Connection: Connected`, 5/24 örnek, henüz terminal değil.
- [phase-7-live-failed.png](phase-7-live-failed.png) — Live Run `Failed`, 24/24;
  Current Draw `Completed`/`Failed`, `First failing sample: 3`, 1 ihlal.
- [phase-7-failed-details.png](phase-7-failed-details.png) — Run Details, seçili
  `Sample 3`, `0.600000 A`, `Outside tolerance`; gerçek chart tooltip'i.
- [phase-7-compare-v1-runs.png](phase-7-compare-v1-runs.png) — v1 FAILED vs v1 PASSED
  özeti, aynı sürüm notu ve senaryo farkı.
- [phase-7-compare-v1-v2.png](phase-7-compare-v1-v2.png) — v1 FAILED vs v2 PASSED
  özeti, farklı sürüm notu.
- [phase-7-compare-v1-v2-rules.png](phase-7-compare-v1-v2-rules.png) — Current Draw
  maksimum `0.550000 → 0.650000`, `Changed`, kural deltası `—`; gerçek istatistik
  deltaları ayrı satırlarda.

## Sınırlar ve notlar

- Start Run başarılı olduğunda uygulama `/runs/:runId` (Run Details) ekranına gidiyor;
  Run Details'ten Live Run'a doğrudan bağlantı yok. Test, ürünün belgelenmiş canlı rota
  deep link'ini (`/runs/:runId/live`) kullanarak canlı ilerlemeyi gerçek SSE akışıyla
  gözler. Bu bir test hilesi değildir; ancak başlangıç sonrası otomatik Live Run
  yönlendirmesi ürün tarafında ayrı bir UX iyileştirmesi olarak değerlendirilebilir.
- Playwright config'i `trace: 'retain-on-failure'` kullanır. Son geçen koşuda trace
  üretilmedi; geliştirme sırasındaki başarısız denemelerde `test-results/` altında trace
  oluştu (gitignored). Kalıcı kanıt olarak liste raporu ve ekran görüntüleri kaydedildi.
- Bu çalışma commit edilmedi; commit/push lead'in sorumluluğunda. Görev kartındaki
  uygulama commit'i alanı bu nedenle boş bırakıldı.
- Ürün kodu değiştirilmedi. Değişen dosyalar: `tests/e2e/main-demo.spec.ts`,
  `tests/e2e/compare.spec.ts` (yalnız oturum temizliği), `tests/e2e/README.md`,
  `package.json` (`test:e2e` fallback'i gerçek Playwright komutuna bağlandı), bu kanıt
  dosyası ve P7-01 kartı. `playwright.config.ts` değişmedi.
