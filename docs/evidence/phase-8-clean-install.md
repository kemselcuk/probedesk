# P8-03 — temiz kurulum ve kalıcılık kanıtı

- Tarih: 2026-11-04
- Ortam: Docker Compose delivery profili, PostgreSQL 18.1, gerçek Chrome.
- Amaç: boş veritabanında migration + demo seed + API + web zinciri ve yeniden
  başlatmada veri kalıcılığı.

## Temiz veritabanı

`probedesk_delivery_check` boş veritabanı oluşturuldu; delivery stack
`PROBEDESK_DATABASE_URL` bu veritabanına yönlendirildi.

```text
docker compose --profile delivery up -d --build
migrate-1  Exited (0)
seed-1     Exited (0)
api-1      Up (healthy)
web-1      Up (healthy)
GET /api/health/ready → 200 {"status":"ok","checks":{"database":"ok","migrations":"ok"}}
```

Seed sonrası:

```text
plans=1  runs=4  users=3  publishedRevisions=2
CANCELLED 45/90
COMPLETED FAILED 90/90
COMPLETED PASSED 90/90
COMPLETED PASSED 90/90
```

Plan: `Power Supply Validation` v1 (Current Draw 0.45–0.55 A) ve v2
(0.65 A). Forced failure run'ında Current Draw `sampleIndex=14`,
değer `0.600000`, sonuç `FAILED`.

## Yeniden başlatma / kalıcılık

```text
docker compose --profile delivery down    # volume korunur
docker compose up -d postgres
PROBEDESK_DATABASE_URL=...probedesk_delivery_check docker compose --profile delivery up -d
GET /api/health/ready → 200
plans=1  runs=4  users=3
FAILED run f13a3106-... → COMPLETED/FAILED, 90/90
```

Container'lar yeniden oluşturuldu; named volume (`probedesk-postgres-data`)
korundu ve plan/run geçmişi değişmedi.

## Kapsam notları

- Delivery stack son doğrulamada `probedesk_delivery_check` veritabanı ile çalıştı;
  varsayılan `probedesk` veritabanı da aynı migration/seed zincirini kullanır.
- `docker compose down -v` volume'ü siler; normal `down` silmez. Reset ayrı ve
  korumalıdır.
- Gerçek Chrome deep-link/SSE kontrolü P8-01 kanıtında (`phase-8-compose.md`)
  kayıtlıdır; bu görev migration/seed/persistence zincirini doğrular.
- Compose komutları host `node`/`postgresql` ikilileri PATH dışındayken de
  çalıştırıldı (`env -i PATH=/usr/local/bin:/usr/bin:/bin docker compose ...`);
  tamamen boş bir işletim sistemi ayrıca denenmedi.
