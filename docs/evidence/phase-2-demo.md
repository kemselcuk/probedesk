# Phase 2 — plan yaşam döngüsü demosu

- Tarih: 2026-11-03
- Kapsam: P2-01 … P2-08
- Ortam: macOS, Node.js 22.23.2, Chrome (headless, 1280×900), API `127.0.0.1:3100`,
  Angular dev server `127.0.0.1:4200`, PostgreSQL 18 geliştirme veritabanı,
  `planner@probedesk.local` / `PlannerDemo!2026` ve
  `viewer@probedesk.local` / `ViewerDemo!2026`.
- Yöntem: (1) gerçek HTTP üzerinden üç adımlı plan yaşam döngüsü
  (`scripts/phase-2-demo.mjs`), (2) gerçek Chrome'da liste, yayımlanmış sürüm
  ve yeni taslak editörü (`scripts/phase-2-ui-check.mjs`).

## API yaşam döngüsü — gerçek sonuçlar

| Adım | Beklenen | Gerçek sonuç |
|---|---|---|
| Plan oluşturma | 201, boş draft rev 1 | 201, `editRevision=1` |
| Üç adımlı taslak kaydı | 200, sunucu kimlikleri, kanonik ondalık | 200, rev 2, üç benzersiz `logicalStepId`, `"4.750000"` |
| Sıralamayı değiştirip kaydetme | 200, dizi sırası otorite | 200, sıra `Case Temperature → Output Voltage → Current Draw` |
| v1 publish | 201, `versionNumber=1` | 201, v1, üç adım |
| Yeni taslak | 201, `editRevision=1`, `baseVersionId=v1` | 201, kimlikler v1 ile aynı |
| İkinci adımın maksimumunu 0.55 → 0.60 yapıp v2 publish | 201, `versionNumber=2` | 201, v2 |
| v1'i tekrar okuma | Değişmemiş | `Current Draw` maksimumu `"0.550000"`, sıra aynı |
| v2'yi okuma | Yeni sınır | `"0.600000"` |
| Eski `expectedRevision` ile kayıt | 409, veri değişmez | 409 `DRAFT_CONFLICT`; draft rev 2 kaldı |
| Viewer save/publish/create | 403 | 403 `FORBIDDEN`; draft bilgisi sızmadı |
| Sürüm listesi | Yeni→eski | `2,1` |

## Gerçek tarayıcı — gerçek sonuçlar

| Kontrol | Beklenen | Gerçek sonuç |
|---|---|---|
| Test Plans listesi | Plan ve yayımlanmış sürüm görünür | `Power Supply Validation` listelendi |
| `/plans/:id/versions/:v1Id` | Salt okunur, kayıtlı değerler | Üç satır doğru sırada; `0.550000`; **0 input**, düzenleme düğmesi yok |
| Editörde “Start new draft” | Yeni taslak açılır | Tıklandı; 3 adım yüklendi |
| Klonlanan adımlar | Sıra ve değerler korunur | İsimler doğru sırada; `Current Draw` maksimumu `0.600000` |
| Sürüm bağlantıları | v1/v2 erişilebilir | “View version 2”, “Version 2”, “Version 1” |
| Konsol | Yakalanmamış istisna yok | `exceptions: []` |

Ekran görüntüleri:

- [phase-2-plans.png](phase-2-plans.png) — plan listesi
- [phase-2-v1.png](phase-2-v1.png) — salt okunur v1
- [phase-2-editor.png](phase-2-editor.png) — yeni taslak editörü

## Kapsam notları

- Gerçek fare sürükle-bırak hareketi bu turda denenmedi; CDK drag-drop
  uygulanmış, klavye taşıma/dizi sırası/payload sırası test edilmiştir
  (P7-04/P2-08 takibi).
- İki fiziksel sekme yerine stale revision davranışı gerçek HTTP 409 ve
  tarayıcı bileşen testleriyle doğrulandı.
- Bu demo ürün kabulü değildir; bağımsız teknik inceleme ve kullanıcı nihai
  kabulü ayrıca gereklidir.
