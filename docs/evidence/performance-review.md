# Performans incelemesi — okuma uçları ve analytics indeksleri

Tarih: 2026-11-09. Durum: uygulandı ve yerelde ölçüldü; bağımsız inceleme/ürün kabulü yoktur.
Çalışma tabanı `89b9ffb`; bu kayıt, migration, benchmark harness'ı ve düzeltmelerle aynı commit'tedir.

## Kapsam ve yöntem

Kullanıcı isteğiyle `performance-optimization` skill'inin akışı uygulandı: ölç → darboğazı bul →
düzelt → aynı yöntemle yeniden ölç → bütçeyle koru. Skill ilk olarak
`npx skills add https://github.com/addyosmani/agent-skills --skill performance-optimization` ile
kuruldu (`.agents/skills/performance-optimization`, `skills-lock.json`).

Ölçüm ortamı:

- macOS Darwin arm64; Node `v22.23.2`; API `nest build` çıktısı yerel süreç olarak `:3100`.
- PostgreSQL `18.1` (Docker `probedesk-postgres`, `127.0.0.1:5434`), ayrı `probedesk_perf` veritabanı.
- Geliştirme/delivery veritabanı `probedesk` yalnızca `pg_dump` ile okundu; üzerine yazılmadı.
- Test veritabanı `probedesk_test` korumalı script ile 11. migration'a yükseltildi.

Sentetik hacim: demo veritabanının kopyası üzerine 20.000 tamamlanmış run, 60.000 run step,
1.800.000 ölçüm ve 160.000 olay eklendi; toplam 20.047 run / 60.195 step / 1.823.116 ölçüm,
~860 MB. Ayrıca sözleşmedeki en büyük okuma için 30 adım × 333 örnek = 9.990 ölçümlü iki run
üretildi. Fixture SQL'i yalnızca yerel perf veritabanında kullanıldı (demo seed kimliklerine bağlı
olduğu için commit edilmedi).

HTTP ölçümü: giriş + bir kez ısınma + `50` istek; üç turda baseline ve düzeltme dönüşümlü
çalıştırıldı; p50/p95/ortalama ve tam gövde boyutu kaydedildi. Aynı ölçüm
`npm run perf:benchmark` ile tekrar edilebilir (smoke bütçesi aşılırsa çıkış 1).

## Darboğaz

Varsayılan dashboard aralığı son 30 gün; UI `to = yarın UTC 00:00`, `from = to - 30 gün` gönderir.
`GET /api/analytics/overview` dört sorgu çalıştırır: `asOf`, summary, trend, top-failed-step.

| Sorgu (baseline plan) | Süre    | Arabellek | Neden                                                   |
| --------------------- | ------- | --------- | ------------------------------------------------------- |
| top-failed 30 gün     | 31,5 ms | 5.325     | `run_steps` tamamı Seq Scan (60.114 satır, 3.605 sayfa) |
| summary 30 gün        | 3,5 ms  | 1.723     | geniş `test_runs` heap okuması (JSON snapshot)          |
| summary 360 gün       | 36,7 ms | 3.337     | aynı heap taraması, tüm satırlar                        |
| trend 360 gün         | 21,3 ms | 472 okuma | yalnız `startedAt` taşıyan geniş olmayan indeks         |

`run_steps` üzerinde aggregate kolonlarını taşıyan dar bir erişim yolu yoktu; planlayıcı 30 günde
bile tüm step tablosunu tarıyordu. `test_runs` satırları JSON snapshot yüzünden geniş; summary ve
trend aynı `startedAt` aralığını heap'ten okuyordu.

## Uygulanan düzeltme

Migration: `apps/api/prisma/migrations/20261109120000_analytics_covering_indexes/migration.sql`.

1. `run_steps_completed_analytics_idx`: `(runId, logicalStepId, unit) INCLUDE (name, outcome)
WHERE status = 'COMPLETED'`. Yalnız tamamlanmış adımları indeksler; top-failed aggregate'in
   per-run Index Only Scan ile okunmasını sağlar.
2. `test_runs_startedAt_id_idx` aynı anahtar kolonlarıyla (`startedAt DESC, id DESC`) yeniden
   oluşturuldu ve `INCLUDE (status, outcome, finishedAt)` eklendi. Yeni bir ikinci indeks değil;
   history sıralaması aynı erişim yolunu korur, summary/trend heap'e dokunmadan okunur.

Prisma `INCLUDE` ve partial `WHERE` ifade edemediği için iki değişiklik de migration-only'dir;
`RunStep` modelinde yorumla işaretlendi. `migration-manifest.ts` listesine yeni migration eklendi.
`database.e2e-spec.ts` indeks tanımlarını ve özet sorgusunun indeks yolunu korur.

## Sonuç (gerçek ölçüm)

Aynı fixture, aynı komut, üç dönüşümlü tur, 50 istek:

| Uç                | Baseline p50 / p95       | Düzeltme sonrası p50 / p95 | Değişim                         |
| ----------------- | ------------------------ | -------------------------- | ------------------------------- |
| analytics 30 gün  | 16,4–19,4 / 21,7–24,2 ms | 10,9–13,6 / 14,6–19,3 ms   | p50 ~%28 iyi                    |
| analytics 365 gün | 48,6–49,8 / 51,3–55,6 ms | 44,1–45,1 / 54,5–61,5 ms   | p50 ~%9 iyi; p95 gürültü içinde |

Sorgu düzeyinde:

| Sorgu             | Önce                           | Sonra                                   |
| ----------------- | ------------------------------ | --------------------------------------- |
| top-failed 30 gün | 31,5 ms (Seq Scan + Hash Join) | 15,6 ms (Index Only Scan + nested loop) |
| summary 30 gün    | 3,5 ms / 1.723 arabellek       | 0,8 ms / 16 arabellek                   |
| summary 360 gün   | 36,7 ms / 3.337 arabellek      | 7,0 ms / 145 arabellek                  |
| trend 360 gün     | 21,3 ms / 472 okuma            | 5,1 ms / 145 arabellek                  |

Son doğrulama koşusu (40 istek, perf DB, nihai indeks durumu):
history default `7,1/10,2 ms`, analytics 30 gün `11,6/17,1 ms`, analytics 365 gün
`43,6/50,1 ms`, analytics plan filtresi `37,9/42,8 ms`; history derin sayfa `25,1/31,0 ms`
(değişmedi), snapshot/report/comparison normal run'da `~6 ms`.

## En büyük run (sözleşme sınırı)

30 adım × 333 örnek (9.990 ölçüm), iki terminal run:

| Uç           | p50 / p95        | Gövde      |
| ------------ | ---------------- | ---------- |
| run snapshot | 55,7 / 67,5 ms   | 1.198,4 kB |
| run report   | 55,4 / 63,3 ms   | 1.198,4 kB |
| comparison   | 109,2 / 133,2 ms | 2.407,9 kB |

Bu yollar değiştirilmedi: süre 400 ms smoke bütçesinin altında ve gövde boyutu API
sözleşmesinin (tüm ölçümler) doğal sonucu; sayfalama/decimation sözleşme değişikliği olurdu.
Prisma ilişki okumaları satır başına değil ilişki başına toplu sorgu üretir; per-row N+1
gözlenmedi. History uçları sayfalı (`limit` en fazla 100) ve ölçüm dizilerini hiç yüklemiyor.

## Denenen ve alınmayanlar (ledger)

| Fikir                                                        | Ölçüm                                            | Karar          | Neden                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test_runs` top satırları için geniş INCLUDE indeksi         | 365 gün p50 43,6 → 43,7 ms                       | alınmadı       | Planlayıcı Seq Scan'i korudu; uçta ölçülebilir kazanç yok, yazma maliyeti var                                                                          |
| `LATERAL` ile run başına zorunlu index join                  | 30 gün sorgu 31,5 → 8,4 ms; 360 gün 60 → 45 ms   | alınmadı       | Join şeklini sabitler; tablo büyüdüğünde planlayıcının Seq Scan'e dönme esnekliğini kaldırır. Partial indeks aynı planı uyarlanabilir biçimde sağlıyor |
| Summary + trend'i tek GROUPING SETS taramasında birleştirmek | ölçülmedi                                        | alınmadı       | INCLUDE indeksten sonra iki tarama toplam ~12 ms; sorgu karmaşıklığı kazancı karşılamıyor                                                              |
| Frontend bundle / Chart.js initial'a taşıma                  | initial 354,16 kB raw, ~89 kB JS transfer        | değişiklik yok | Skill'in 200 kB transfer bütçesinin altında; grafikler lazy chunk                                                                                      |
| Live run `OnPush` / chart scheduler                          | kod incelemesi                                   | değişiklik yok | 40/40 üretim bileşeni OnPush; canlı grafik tek animation frame'de bir kez çiziliyor                                                                    |
| SSE polling                                                  | plan: `run_events_runId_sequence_key` Index Scan | değişiklik yok | Bağlantı başına tek uçuşta sorgu; 200 ms poll + batch zaten sınırlı                                                                                    |

## Frontend ve diğer bulgular

- Production web build: initial `354,16 kB` raw / `94,61 kB` tahmini transfer; JS kısmı ~89 kB.
  Sayfa chunk'ları lazy (`plan-editor`, `compare-runs`, `live-run`, `run-details`, `overview` vb.).
- Tüm üretim bileşenleri `ChangeDetectionStrategy.OnPush`; canlı ölçüm grafiği
  `LIVE_CHART_SCHEDULER` ile frame başına bir kez çiziliyor.
- Analytics response'u 30 günde 8,7 kB, 365 günde 67,4 kB; trend 360 günü tek response'ta
  dolduruyor, ayrı N+1 istek yok.
- History'de derin sayfa `OFFSET` maliyeti 20.000 run'da ~25 ms; sözleşme offset tabanlı
  olduğu için keyset'e çevrilmedi. Ölçüm bu eşikte kabul edilebilir; hacim büyürse ayrı iş.

## Sınırlar

- Tek makine, yerel Docker PostgreSQL, ağ gecikmesi yok; sonuçlar üretim kapasitesi veya SLA
  değildir. Eşzamanlı kullanıcı/yük testi yapılmadı.
- RUM/Core Web Vitals (LCP/INP/CLS) alan verisi veya Lighthouse koşusu yok; frontend bulguları
  build çıktısı ve kod incelemesidir.
- 365 gün top-failed sorgusu hâlâ `test_runs` üzerinde Seq Scan yapar (ölçülen 46,9 ms). Büyük
  hacimde materyalize görünüm/rollup gerekir; bu değişiklikte kapsam dışı bırakıldı.
- Benchmark `probedesk_perf` fixture'ında çalıştırıldı; delivery stack (`:8080`, 45 run, eski
  image) yalnız harness'ın seeded demo üzerinde çalıştığını doğrulamak için ölçüldü.
- CI'da performans kapısı yok; `npm run perf:benchmark` manuel/isteğe bağlı smoke kontrolüdür.

## Komutlar ve gerçek çıktılar

```
npx skills add https://github.com/addyosmani/agent-skills --skill performance-optimization
  -> Installed 1 skill: performance-optimization (Security: Safe, 0 alerts)

npm run db:migrate:test --workspace apps/api
  -> 11 migrations found; applied 20261109120000_analytics_covering_indexes; exit 0

npx vitest run --config ./vitest.config.e2e.ts test/database.e2e-spec.ts test/analytics.e2e-spec.ts
  -> 2 dosya / 18 test passed; exit 0

cd apps/api && TEST_DATABASE_URL='postgresql://probedesk:probedesk@127.0.0.1:5433/probedesk_test?schema=public' \
npx vitest run --config ./vitest.config.e2e.ts
  -> 29 dosya / 284 test passed; 49,39 s; exit 0

npm run test:api:unit
  -> 19 dosya / 147 test passed; exit 0

npm run test:web
  -> 45 dosya / 496 test passed; exit 0

npm run verify
  -> lint + typecheck + birim (19/147) + web (45/496) + build + openapi:check; exit 0

npm run lint
  -> 0 warning, 0 error (API, web, api-client); exit 0

npm run typecheck
  -> API, web, api-client temiz; exit 0

npm run build
  -> API nest build + web production build; initial 354,16 kB raw; exit 0

npm run openapi:check
  -> "OpenAPI contract is current"; exit 0

PROBEDESK_BENCH_URL=http://127.0.0.1:3100/api PROBEDESK_BENCH_ITERATIONS=40 \
PROBEDESK_BENCH_ENFORCE=1 npm run perf:benchmark
  -> 10 vaka; en yavaş p95 analytics 365 gün 51,8 ms; tümü bütçe içinde; exit 0

PROBEDESK_BENCH_URL=http://127.0.0.1:8080/api PROBEDESK_BENCH_ITERATIONS=20 \
PROBEDESK_BENCH_ENFORCE=1 npm run perf:benchmark
  -> 9 vaka (karşılaştırma dahil); en yavaş p95 16,3 ms; exit 0
```

Çalıştırılmayanlar: yeni Web E2E/Playwright turu (web değişmedi), Docker image yeniden build,
CI koşusu, yük/eşzamanlılık testi. Bunlar başarılmış sayılmaz.
