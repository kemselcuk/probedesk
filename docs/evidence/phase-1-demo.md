# Phase 1 — çalışan uygulama demosu

- Tarih: 2026-11-03
- Commit: `d1020be` (bağımsız inceleme düzeltmeleri dahil)
- Ortam: macOS, Node.js 22.23.2, Chrome (headless, 1280×900), Angular dev server
  `127.0.0.1:4200`, API `127.0.0.1:3100`, PostgreSQL 18 geliştirme veritabanı
  (host portu 5434), `npm run demo:seed` ile oluşturulmuş üç demo hesap.
- Yöntem: Chrome DevTools Protocol üzerinden gerçek tarayıcı; klavye `Tab`
  olayları `Input.dispatchKeyEvent` ile gönderildi. Sayfa metni/durumu
  `Runtime.evaluate` ile okundu.

## Sonuçlar

| Adım | Beklenen | Gerçek sonuç |
|---|---|---|
| `/login` üstünden 6 kez Tab | Mantıklı odak sırası, tuzağa düşmeme | `#email → #password → Show password → Sign in → body → #email` |
| Yanlış parola | `role="alert"` hata, e-posta korunur | `"The email or password is incorrect. Please try again."`; `#email` değeri `planner@probedesk.local` kaldı |
| Planner girişi | `/plans`, rol görünür | `/plans`, `Role: Planner` |
| Sayfa yenileme | Oturum `/auth/me` ile geri yüklenir | `/plans`, `Role: Planner`, üç navigasyon bağlantısı |
| Çıkış | `/login`, oturum sunucuda geçersiz | `/login`; `/api/auth/me` → `401` |
| Konsol | Yakalanmamış istisna yok | `exceptions: []` |

Ekran görüntüsü: [phase-1-plans.png](phase-1-plans.png).

## Kapsam notları

- Üç hesabın API üzerinden login/logout doğrulaması P1-06/P1-07 e2e testlerinde ve
  önceki curl smoke'unda yapıldı; bu tarayıcı turu Planner rolünü uçtan uca kapsar.
- Operator/Viewer için tarayıcı matrisi, ekran okuyucu turu ve Safari/Firefox
  doğrulaması yapılmadı; bunlar P7-04/P7-01 kapsamındadır.
- Bu demo bir ürün kabulü değildir; yalnızca Phase 1 davranışının gerçek
  tarayıcıda çalıştığını gösterir.
