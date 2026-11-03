# Phase 4 — SSE canlı akış demosu

- Tarih: 2026-11-03
- Kapsam: P4-01 … P4-07
- Ortam: macOS, Node.js 22.23.2, Chrome (headless), API `127.0.0.1:3100`,
  Angular dev server `127.0.0.1:4200`, arada kesilebilir akış proxy'si
  `127.0.0.1:3200`, PostgreSQL 18 geliştirme veritabanı.

## SSE protokolü — gerçek sonuçlar

`scripts/phase-4-sse-check.mjs` ile NORMAL run (3 adım × 30 örnek × 200 ms):

| Kontrol | Sonuç |
|---|---|
| Canlı akış | 98 olay, `run.started` → `run.completed`, boşluksuz sequence |
| Snapshot eşleşmesi | `lastEventSequence=98`, `recordedSampleCount=90`, `COMPLETED/PASSED` |
| Replay `after=49` | 49 olay, 50…98 aralığı |
| `Last-Event-ID: 5` | İlk olay 6 (header, query'den öncelikli) |
| Terminal + backlog yok (`after=98`) | **204** |
| Geçersiz cursor (`after=-1`, `after=99999`) | **400 VALIDATION_ERROR** |

## Gerçek tarayıcı — iki sekme ve kesinti

`scripts/phase-4-live-check.mjs` ile iki Chrome sekmesi aynı run'ı izledi; akış
proxy'si `SIGKILL` ile öldürülüp ~2 saniye sonra yeniden başlatıldı.

| Kontrol | Sonuç |
|---|---|
| Başlangıç | İki sekme de canlı sayaçları aldı |
| Kesinti | Bağlantı `Reconnecting` olarak etiketlendi; run sunucuda devam etti |
| Yeniden bağlanma | İki sekme de kaldığı yerden tamamlandı |
| Terminal | Sekme A: `Passed`, 90/90, `Disconnected`; sekme B: `Passed`, 90/90 |
| Konsol | Yakalanmamış istisna yok (`exceptions: []`) |
| Detay bağlantısı | “View run details” doğru `/runs/:id` adresine gidiyor |

Ekran görüntüsü: [phase-4-live.png](phase-4-live.png).

Test sırasında iki gerçek hata bulundu ve düzeltildi:

1. Transport, facade'ın uygulamadığı bir olayda cursor'ı ilerletiyordu; gap
   sonrası akış ileri bir noktadan açılıp olay atlayabiliyordu. Artık istenen
   cursor otoritedir ve oturum gerekirse yeniden başlatılır (`df9e7b3`).
2. Test proxy'si keep-alive soketini yeniden kullanarak iptal edilmiş SSE
   yanıtının artıklarını sonraki isteğe taşıyordu; `agent: false` ve abort'ta
   upstream destroy ile düzeltildi.

## Yeniden üretme

```bash
PORT=3100 node apps/api/dist/main.js
cd apps/web && npx ng serve --port 4200 --proxy-config <proxy-to-3200>.json
RUN_VERSION_ID=<published-version-uuid> node scripts/phase-4-sse-check.mjs
RUN_VERSION_ID=<published-version-uuid> node scripts/phase-4-live-check.mjs
```

`phase-4-live-check.mjs`, `scripts/sse-proxy.mjs` proxy'sini kendisi başlatır ve
kesinti için öldürüp yeniden açar. Chrome yolları `APP_URL` ile değiştirilebilir.

## Kapsam notları

- Kalp atışı (heartbeat) ve oturum iptali, P4-01 backend e2e testlerinde kısa
  aralıklarla doğrulandı; gerçek 401 oturum sona ermesi P7/T16 kapsamındadır.
- Grafikler, geçmiş ve karşılaştırma P5/P6 kapsamındadır.
- Bu demo ürün kabulü değildir; bağımsız Faz 4 incelemesi ve kullanıcı nihai
  kabulü ayrıca gereklidir.
