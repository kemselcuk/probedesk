# Phase 3 — simülasyon ve yürütme demosu

- Tarih: 2026-11-03
- Kapsam: P3-01 … P3-10
- Ortam: macOS, Node.js 22.23.2, Chrome (headless), API `127.0.0.1:3100`,
  Angular dev server `127.0.0.1:4200`, PostgreSQL 18 geliştirme veritabanı.
- Yöntem: gerçek HTTP (`scripts/phase-3-demo.mjs`), süreç öldürme/geri başlatma,
  gerçek Chrome (`scripts/phase-3-ui-check.mjs`).

## API yaşam döngüsü — gerçek sonuçlar

Kullanılan sürüm: `Power Supply Validation` v1 (3 adım: Case Temperature, Output
Voltage, Current Draw; 30 örnek × 200 ms).

| Senaryo | Beklenen | Gerçek sonuç |
|---|---|---|
| NORMAL | PASSED, 90/90 örnek | `COMPLETED/PASSED`, 90 örnek, `lastEventSequence=98` |
| Aynı `Idempotency-Key` ile tekrar | Aynı run | `200`, aynı `runId`, ikinci kayıt yok |
| FORCED_FAILURE (Current Draw) | Tek ihlal, indeks 14, `0.600000`, sonraki adım devam | `FAILED`; Current Draw `firstFailureSampleIndex=14`, değer `0.600000`; üç adım da `COMPLETED` |
| İptal | Kısmi örnek korunur, aktif adım CANCELLED, diğerleri NOT_RUN | `CANCELLED`, 1 örnek korundu, `Case Temperature:CANCELLED`, diğer ikisi `NOT_RUN` |
| Tekrarlanan iptal | Durum değişmez | `200`, yine `CANCELLED` |
| Run Again | Yeni run, eski kayıt korunur | Yeni `runId`; eski run `COMPLETED`, 90 örnek |

## Kesinti ve recovery — gerçek sonuçlar

1. NORMAL run başlatıldı, 5 örnek yazıldıktan sonra API süreci `SIGKILL` ile öldürüldü.
2. API yeniden başlatıldı; bootstrap recovery çalıştı, readiness `200` oldu.
3. Aynı run okundu:

```json
{
  "status": "INTERRUPTED",
  "outcome": null,
  "reasonCode": "SERVER_RESTART",
  "recordedSampleCount": 5,
  "lastEventSequence": 8,
  "steps": [
    { "name": "Case Temperature", "status": "INTERRUPTED", "recordedCount": 5 },
    { "name": "Output Voltage", "status": "NOT_RUN", "recordedCount": 0 },
    { "name": "Current Draw", "status": "NOT_RUN", "recordedCount": 0 }
  ]
}
```

Kaydedilmiş 5 örnek korundu, sürdürme yapılmadı, bekleyen adımlar `NOT_RUN` oldu.

## Gerçek tarayıcı — gerçek sonuçlar

| Kontrol | Beklenen | Gerçek sonuç |
|---|---|---|
| Başarısız run detayı | Failed, tolerans dışı değer görünür | `Failed`; `0.600000` ölçüm tablosunda; 90 satır; Cancel yok; Run Again var |
| Başarılı run detayı | Passed | `Passed`; Run Again var |
| Start Run formu | Sürüm adımları + üç senaryo | 3 adım; NORMAL/FORCED_FAILURE/RANDOM |
| UI’dan run başlatma | Gerçek `runId` ile detay ekranı | Uygulama `56d71d45-…` ile `/runs/:id` detayına yönlendirdi |
| İptal dialogu | Onay ister, iyimser durum yok | “Cancel this run?”; onay sonrası `Cancelled` |
| `/runs/:id/live` placeholder | Detaya bağlantı | “View run details” → `/runs/56d71d45-…` |
| İptal sonrası | Cancel gizli, Run Again var | Cancel yok; Run Again var |
| Konsol | İstisna yok | `exceptions: []` |

Ekran görüntüleri:

- [phase-3-failed-run.png](phase-3-failed-run.png) — FAILED run detayı
- [phase-3-cancelled-run.png](phase-3-cancelled-run.png) — UI’dan iptal edilmiş run

## Kapsam notları

- SSE/canlı akış (P4) henüz yok; “live” rotası P4-04’e kadar placeholder’dır.
- Grafikler (P5), karşılaştırma (P6), Playwright (P7) ve Compose teslimi (P8) açıktır.
- Bu demo ürün kabulü değildir; bağımsız Faz 3 incelemesi ve kullanıcı nihai kabulü
  ayrıca gereklidir.

## Yeniden üretme

Bu demo commit’teki script’lerle yeniden çalıştırılabilir; geliştirme kimlikleri
script içine gömülü değildir.

```bash
# 1. API ve web (web proxy'si /api -> 127.0.0.1:3100 olacak şekilde)
PORT=3100 node apps/api/dist/main.js
cd apps/web && npx ng serve --port 4200 --proxy-config <proxy-to-3100>.json

# 2. API yaşam döngüsü (NORMAL, FORCED_FAILURE, cancel, Run Again)
RUN_VERSION_ID=<published-version-uuid> node scripts/phase-3-demo.mjs

# 3. Gerçek Chrome kontrolü (script çıktısındaki run kimlikleriyle)
VERSION_ID=<published-version-uuid> \
FORCED_RUN=<failed-run-uuid> NORMAL_RUN=<passed-run-uuid> \
  node scripts/phase-3-ui-check.mjs
```

UI script’i start sonrası uygulamanın kendi yönlendirmesini bekler
(`/runs/:runId`); detay ekranına elle gidilmez. `/runs/:runId/live` P4
placeholder’ının “View run details” bağlantısı da kontrol edilir.
