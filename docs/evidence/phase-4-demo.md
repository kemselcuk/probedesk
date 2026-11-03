# Phase 4 — SSE canlı akış demosu

- Tarih: 2026-11-03
- Kapsam: P4-01 … P4-07
- Ortam: macOS (arm64), Node.js 22.23.2, npm 11.6.2, Chrome (headless), API
  `127.0.0.1:3100`, derlenmiş SPA'yı sunan `scripts/app-server.mjs`
  `127.0.0.1:4300`, arada kesilebilir akış proxy'si `127.0.0.1:3200`,
  PostgreSQL 18 geliştirme veritabanı.
- Kapsam dışı: P5 geçmiş/grafik çalışması, P7 Playwright/erişilebilirlik,
  bağımsız yeniden inceleme ve ürün kabulü. Ortak checkout'ta P5 dosyaları
  üzerinde eşzamanlı çalışma vardı; bu demo o dosyaları kapsamaz.
- Uygulama commit'i: Phase 4 web uygulaması ve H-01/M-03 düzeltmeleri `b9134d6` (`feat(web): add measurement charts…`) içinde; kanıt/script/doküman `8f06f33` içinde. İlk SSE demosu `b14209c`. Geçmiş yeniden yazılmadı; `8f06f33` tek başına H-01/M-03 ürün kodunu içermez.

## SSE protokolü — gerçek sonuçlar

`scripts/phase-4-sse-check.mjs` ile NORMAL run (3 adım × 30 örnek × 200 ms),
run `13964223-6829-4a42-8ca4-8656c8907852`:

| Kontrol | Sonuç |
|---|---|
| Canlı akış | 98 olay, `run.started` → `run.completed`, boşluksuz sequence |
| Snapshot eşleşmesi | `lastEventSequence=98`, `recordedSampleCount=90` |
| Replay `after=49` | 49 olay, 50…98 aralığı |
| `Last-Event-ID: 5` | İlk olay 6 (header, query'den öncelikli) |
| Terminal + backlog yok (`after=98`) | **204** |
| Geçersiz cursor (`after=-1`, `after=99999`) | **400 VALIDATION_ERROR** |

## Gerçek tarayıcı — iki sekme ve gerçek kesinti

`scripts/phase-4-live-check.mjs` iki Chrome sekmesini aynı run'da izler.
Script, derlenmiş SPA'yı `scripts/app-server.mjs` (4300) üzerinden sunar ve
`/api` isteklerini `scripts/sse-proxy.mjs` (3200) üzerinden API'ye aktarır.
Akış proxy'si `SIGKILL` ile öldürülüp ~1.5 saniye sonra yeniden başlatılır.
Script hiçbir yapay `Event('error')` göndermez; app-server upstream kapanışını
downstream SSE yanıtına yansıtır ve iki sekme de gerçek `EventSource` hatasını
kendisi görür.

Son koşu (run `e50636ea-6f8f-487c-85a6-822801dd9855`):

| Kontrol | Sonuç |
|---|---|
| Başlangıç | İki sekme de `Connection: Connected` ve canlı sayaçları aldı (ilk ilerleme 14/90) |
| Kesinti algılama | `SIGKILL` sonrası `154 ms` içinde iki sekme de `Reconnecting` |
| Kesinti anındaki kaynak | Sekme A'da eski EventSource `readyState=2` (kapalı), yeni kaynak henüz açılmamış |
| Yeniden bağlanma | Proxy yeniden açıldıktan sonra iki sekme de kaldığı yerden devam etti |
| Terminal | Sekme A: `Passed`, 90/90, `Disconnected`, `Run finished`; sekme B: `Passed`, 90/90 |
| Konsol | Yakalanmamış istisna yok (`exceptions: []`) |
| Hata yanıtları | Kesinti sırasında 7 adet `502 UPSTREAM_UNAVAILABLE`; kesinti dışında hata yok |
| Detay bağlantısı | “View run details” doğru `/runs/:id` adresine gidiyor |

Ekran görüntüsü: [phase-4-live.png](phase-4-live.png).

Bu turda iki gerçek hata daha bulundu ve düzeltildi:

1. Transport, facade'ın uygulamadığı bir olayda cursor'ı ilerletiyordu; gap
   sonrası akış ileri bir noktadan açılıp olay atlayabiliyordu. Artık istenen
   cursor otoritedir ve oturum gerekirse yeniden başlatılır (`df9e7b3`).
2. Test proxy'si keep-alive soketini yeniden kullanarak iptal edilmiş SSE
   yanıtının artıklarını sonraki isteğe taşıyordu; `agent: false` ve abort'ta
   upstream destroy ile düzeltildi.

## İnceleme düzeltmeleri

Phase 4 bağımsız incelemesindeki bulgular bu turda kapatıldı; ayrıntılar
[phase-4-review-fixes-web.md](phase-4-review-fixes-web.md):

- **H-01:** Olaysız açılıp kapanan `200 text/event-stream` artık reconnect
  deneme bütçesini sıfırlamaz; bütçe yalnız teslim edilen bir domain olayından
  sonra tazelenir. Bütçe tükenince `unavailable` + `disconnected` ve görünür
  uyarı paneli gösterilir. Sonsuz reconnect yoktur.
- **M-01:** Kesinti kanıtı artık Vite'a ve yapay `error` olayına dayanmaz.
  `scripts/app-server.mjs` gerçek upstream kapanışını tarayıcıya taşır;
  `apps/web/proxy.conf.json` değişmeden `127.0.0.1:3000` hedefinde kalır.
- **M-03:** Terminal sonrası final snapshot üç kez denenir. Üçü de başarısız
  olursa terminal run durumu korunur, “Final step detail could not be loaded”
  uyarısı gösterilir ve `RUNNING`/`PENDING` kalan adımlar “Unavailable” olarak
  işaretlenir; stale “In progress” metni gösterilmez.
- **M-02:** Görev kartları, yol haritası ve kanıt bağlantıları gerçek
  komut/çıktılarla güncellendi.

## Yeniden üretme

```bash
PORT=3100 node apps/api/dist/main.js
npm run build --workspace apps/web
RUN_VERSION_ID=<published-plan-version-uuid> node scripts/phase-4-sse-check.mjs
RUN_VERSION_ID=<published-plan-version-uuid> node scripts/phase-4-live-check.mjs
```

`phase-4-live-check.mjs`, `scripts/app-server.mjs` (4300) ve
`scripts/sse-proxy.mjs` (3200) süreçlerini kendisi başlatır ve kapatır. Chrome
yolu sabittir; API adresi `PROBEDESK_API_URL`, uygulama portu `APP_PORT` ile
değiştirilebilir. Derleme yoksa script `npm run build --workspace apps/web`
çalıştırır; önceden derlenmiş çıktı için `WEB_DIST` verilebilir. Normal Angular
geliştirme sunucusu (`npm run start --workspace apps/web`) hâlâ
`apps/web/proxy.conf.json` üzerinden `/api` isteklerini `127.0.0.1:3000`'e
gönderir; bu dosya Phase 4 kontrolü için değiştirilmedi.

## Kapsam notları

- Bu turdaki canlı koşuda terminal sonrası final snapshot `200` döndü;
  incelemede kaydedilen tek seferlik boş gövdeli `400` yeniden üretilmedi.
  Kök nedeni bilinmiyor; M-03 düzeltmesi herhangi bir final snapshot hatasında
  stale adım durumlarının gösterilmesini engeller.
- Kalp atışı (heartbeat) ve oturum iptali, P4-01 backend e2e testlerinde kısa
  aralıklarla doğrulandı; gerçek 401 oturum sona ermesi P7/T16 kapsamındadır.
- Grafikler, geçmiş ve karşılaştırma P5/P6 kapsamındadır; bu demo P5 grafik
  çalışmasını doğrulamaz.
- Bu demo ürün kabulü değildir; bağımsız Faz 4 incelemesi ve kullanıcı nihai
  kabulü ayrıca gereklidir.
