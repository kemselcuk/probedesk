# P8-05 — kısa demo videosu

- Dosya: [probedesk-demo.mp4](probedesk-demo.mp4)
- Süre: **35.36 sn**, boyut ~703 KB, 1280×800, H.264 (yuv420p), ses yok.
- Kaynak: Docker Compose delivery stack (`http://127.0.0.1:8080`), temiz demo
  veritabanı (1 plan, v1/v2, FAILED/PASSED/partial run'lar).
- Kayıt: Playwright Chromium video + `ffmpeg` (libx264, CRF 24).

## Gösterilen akış

1. Operator girişi; seed edilmiş roller ve Test Plans.
2. Run History: backend sayaçları, ilk hata, kısmi sonuç.
3. FAILED v1 run detayı: kayıtlı `0.55 A` kuralı, `Current Draw` örnek 14
   `0.600000 A`, tolerans dışı işareti.
4. Grafikte gerçek hover tooltip'i (hata noktası).
5. v1 FAILED vs v2 PASSED karşılaştırması: değişen kural vurgusu, uydurma delta yok.
6. v2 PASSED run detayı: yeni `0.65 A` sınırı, eski kayıtların korunması.

## Sınırlar

- Video yerel demo verisiyle kaydedildi; anlatım sesi yoktur, ekran üstü İngilizce
  caption kullanılır.
- Yalnız Chrome/1280×800 kaydıdır; Safari/Firefox veya mobil iddiası yoktur.
- Canlı run başlatma videosu bu kayıtta yoktur; canlı akış P4 kanıtlarında ve
  gerçek tarayıcı testlerinde doğrulanmıştır.
- Video, ürün kullanıcı kabulü değildir.

## Yeniden üretme

```bash
docker compose --profile delivery up -d --build   # http://127.0.0.1:8080
node scripts/record-demo-video.mjs
```
