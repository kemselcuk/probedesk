# Phase 4 — Kalan yeniden inceleme maddeleri (N-01, P4-06, P4-07)

- Tarih: 2026-11-03.
- Ortam: macOS arm64, Node.js `22.23.2`, npm `10.9.8` (sistem npm'i; bu turda kurulum
  yapılmadı — kurulumlar için `AGENTS.md` npm `11.6.2` ister), Angular 22.2.4,
  PostgreSQL 18 geliştirme veritabanı `127.0.0.1:5434`, Google Chrome headless.
- API: `127.0.0.1:3110` (`apps/api/dist/main.js`), akış proxy'si `127.0.0.1:3200`,
  statik SPA sunucusu `127.0.0.1:4300`, Chrome DevTools `127.0.0.1:9338`.
- Plan sürümü: `RUN_VERSION_ID=89064e8a-bfb9-4645-91f2-cd913a00cb53`
  (Power Supply Validation v2; 3 adım × 30 örnek × 200 ms).
- Kapsam: N-01 commit izlenebilirliği, P4-06'nın işaretsiz snapshot/olay yarışı ölçütü,
  P4-07'nin işaretsiz SPA dönüşü ve logout/expiry ölçütleri.
- Bu belge bir doğrulama kanıtıdır, ürün kabulü değildir. Hiçbir görev `Accepted`
  yapılmadı; bağımsız nihai yeniden inceleme bekleniyor.

## N-01 — Commit izlenebilirliği

H-01 ve M-03 düzeltmelerinin ürün kodu `8f06f33` içinde değildir. Doğru eşleme:

| İçerik | Commit |
|---|---|
| H-01 transport düzeltmesi (`run-events.service.ts`) ve M-03 facade/page düzeltmesi | `b9134d6` (`feat(web): add measurement charts with tolerance and interactions`) |
| Kanıt, script, task kartı ve doküman güncellemeleri | `8f06f33` (`fix(web): bound live reconnects and harden terminal finalization`) |
| P4-01 SSE uygulaması | `dabb463` |
| İlk P4 web taşıması / cursor düzeltmesi | `e903f44` / `df9e7b3` |
| İlk P4 SSE ve iki-sekme kanıtı | `b14209c` |

- P4-01, P4-02, P4-03, P4-04, P4-05, P4-06 ve P4-07 kartlarındaki eski
  “Uygulama commit'i: Henüz yok” / “commit edilmedi” ifadeleri kaldırıldı; yerine
  yukarıdaki SHA'lar yazıldı.
- `phase-4-review-fixes-web.md`, `phase-4-demo.md` ve `phase-4-live-ui.md` başlıklarındaki
  aynı eski ifadeler düzeltildi.
- Git geçmişi yeniden yazılmadı, commit değiştirilmedi. `8f06f33` tek başına geri alınırsa
  H-01/M-03 ürün düzeltmesi geri alınmaz; bu risk kartlarda açıkça kayıtlıdır.
- Bu turda eklenen `scripts/phase-4-snapshot-race-check.mjs`,
  `scripts/phase-4-lifecycle-check.mjs`, bu dosya ve üç ekran görüntüsü için commit'i
  lead aynı değişiklikte oluşturacak.

## P4-06 — Snapshot sırasında gelen olay kaybolmaz

Komut:

```text
$ PROBEDESK_API_URL=http://127.0.0.1:3110 \
    RUN_VERSION_ID=89064e8a-bfb9-4645-91f2-cd913a00cb53 \
    node scripts/phase-4-snapshot-race-check.mjs
EXIT: 0
```

Script üç bağımsız NORMAL run başlatır. Her run için REST snapshot hâlâ `RUNNING`
durumdayken alınır, hemen ardından `GET /api/runs/:id/events?after=N` açılır ve akış
terminal olaya kadar okunur. Son olarak terminal snapshot'ı yeniden okunur.

| # | Run | Snapshot anı | Snapshot `N` | İlk akış olayı | Akış olayı | Terminal | Final snapshot |
|---|---|---|---|---|---|---|---|
| 1 | `f332bf7d-744b-4c9f-924d-bf2069ea1170` | 18/90, `RUNNING` | 20 | `measurement.recorded`, id 21 | 78 | `run.completed`, id 98 | `COMPLETED/PASSED`, 90/90, seq 98 |
| 2 | `97fda687-a471-4c31-995c-947a088c377b` | 41/90, `RUNNING` | 45 | `measurement.recorded`, id 46 | 53 | `run.completed`, id 98 | `COMPLETED/PASSED`, 90/90, seq 98 |
| 3 | `3fe0de15-6e93-45f5-91c3-5ed0e589f843` | 63/90, `RUNNING` | 69 | `measurement.recorded`, id 70 | 29 | `run.completed`, id 98 | `COMPLETED/PASSED`, 90/90, seq 98 |

Doğrulananlar:

- İlk akış olayı her zaman `N+1`; snapshot ile akış arasında commit edilen olaylar
  replay edildi.
- Sequence'lar `N+1 … 98` aralığında boşluksuz; tam bir terminal `run.*` olayı var.
- Final REST snapshot'ın `status`, `outcome`, `recordedSampleCount`,
  `expectedSampleCount` ve `lastEventSequence` değerleri terminal olayın payload'ı ve
  `id` değeriyle eşleşti.
- Script üç run'ı ve kendi oturumunu temizledi: `CLEANUP {"runs":3,"deleted":3}`,
  `SESSION_REVOKED 1`.

Bu, P4-06'nın “Snapshot sırasında gelen olay kaybolmaz” ölçütünü gerçek HTTP/SSE ve
PostgreSQL üzerinde kapatır. Gerçek backend duplicate olayı bu turda zorlanmadı; o ölçüt
reducer/facade duplicate testleriyle kapsanmaya devam eder.

## P4-07 — Gerçek SPA dönüşü, Sign out ve sunucu tarafı expiry

Komut:

```text
$ PROBEDESK_API_URL=http://127.0.0.1:3110 \
    RUN_VERSION_ID=89064e8a-bfb9-4645-91f2-cd913a00cb53 \
    node scripts/phase-4-lifecycle-check.mjs
EXIT: 0
```

Script `scripts/app-server.mjs` ile derlenmiş SPA'yı sunar, `/api`'yi
`scripts/sse-proxy.mjs` üzerinden gerçek API'ye aktarır ve gerçek headless Chrome'u CDP
ile sürer. `window.EventSource` yalnız sayım için sarmalanır; hiçbir yapay hata olayı
gönderilmez.

### 1. SPA dönüşü

Run `7455ef39-15cd-4d12-b6bf-b6cc421f6d26`:

| Kontrol | Sonuç |
|---|---|
| Başlangıç | `/runs/<id>/live`, `Running`, `Connected`, 4/90 |
| `/plans`'a geçiş | Gerçek nav link tıklaması; 2,5 sn bekleme; sayfa `/plans` |
| Ekrandan ayrılırken açık akış | 0 (toplam kaynak 1, kapalı) |
| Geri dönüş | `history.back()` ile aynı `/runs/<id>/live` URL'i |
| Aynı SPA dokümanı | Evet; `window.__probedeskDocumentId` değişmedi (tam sayfa yükleme yok) |
| Aynı run | Evet, run id `7455ef39-…` değişmedi |
| İlerleme | 4/90 → 19/90 (ekrandan ayrıyken de arttı) |
| Yeni run | `POST /api/runs` sayısı 0 |
| Dönüşte açık akış | Tam 1, aynı run'ın `/events` URL'i; toplam 2 kaynak (biri eski/kapalı) |
| Sunucu sonu | `COMPLETED/PASSED`, 90/90 |

### 2. Uygulamanın kendi Sign out'u

Run `181fd7ed-117c-400e-b9be-93afd4af17dd`:

| Kontrol | Sonuç |
|---|---|
| Başlangıç | `/runs/<id>/live`, `Running`, `Connected`, 3/90 |
| Sign out | `POST /api/auth/logout` → `204` |
| Yönlendirme | `/login`, giriş formu (`#email`) görünür |
| Kimlik durumu | `.role-chip` ve `.user-email` yok |
| Açık akış | 0 |
| Sonraki 3,5 sn | Yeni `/events` isteği 0, yeni EventSource 0 |
| Run | Sign out anında `RUNNING` (21/90); sonra `COMPLETED/PASSED` 90/90 |

### 3. Sunucu tarafında oturum iptali (expiry)

Run `02cde85b-7d3a-4db0-bbe9-7856806a8e2c`:

| Kontrol | Sonuç |
|---|---|
| Başlangıç | `/runs/<id>/live`, `Running`, `Connected`, 3/90 |
| İkinci oturum | Ayrı operator login'i, aynı run'da `after=5` ile SSE açık, `/auth/me` 200 |
| Revoke | Tarayıcı cookie'sinin SHA-256'sıyla tam 1 `sessions` satırı `revokedAt` aldı |
| İlk kapanış | Heartbeat sonrası ~14,8 sn'de akış kapandı; bu arada 1 yeniden bağlanma isteği |
| `/auth/me` | `401` gözlendi |
| Yönlendirme | `/login?returnUrl=%2Fruns%2F02cde85b-…%2Flive` |
| Geçiş etiketi | Nihai koşuda yakalanmadı; önceki koşuda `Connection: Signed out` DOM'da gözlendi |
| UI | Giriş formu görünür; `.role-chip`/`.user-email` yok |
| Açık akış | 0 |
| Sonraki 6 sn | Yeni `/events` isteği 0, yeni EventSource 0 (sonsuz reconnect yok) |
| Run | Revoke sonrası hemen `RUNNING`, 3/90; sonra `COMPLETED/PASSED` 90/90 |
| Diğer oturum | Cursor 5'ten 93 olay, boşluksuz, `run.completed`; `/auth/me` 200 |
| Konsol | Yakalanmamış istisna yok (`exceptions: []`) |

Not: `Connection: Signed out` geçiş etiketi bir koşuda DOM'da yakalandı; nihai koşuda
yönlendirme aynı render turunda gerçekleştiği için yakalanmadı. Bu nedenle geçiş
etiketinin her zaman boyanacağı garanti edilemez; her koşuda kullanıcıya görünen son durum
kimliksiz `/login?returnUrl=…` ekranıdır. Bunun bir ürün hatası olduğuna dair kanıt yoktur;
gözlem yalnızca zamanlama duyarlılığı olarak kaydedilmiştir.

Ekran görüntüleri:

- [phase-4-lifecycle-return.png](phase-4-lifecycle-return.png) — dönüş sonrası aynı canlı ekran; görüntü terminale yakın 89/90 anını gösterir, aynı run id ve tek açık akış korunur.
- [phase-4-lifecycle-signout.png](phase-4-lifecycle-signout.png) — Sign out sonrası login.
- [phase-4-lifecycle-expiry.png](phase-4-lifecycle-expiry.png) — expiry sonrası login.

## Son doğrulama komutları

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 35ms on 98 files with 93 rules using 8 threads.
EXIT: 0

$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
EXIT: 0

$ npm run test --workspace apps/web
Test Files  32 passed (32)
     Tests  319 passed (319)
  Duration  4.95s
EXIT: 0

$ npm run build --workspace apps/web
Application bundle generation complete. [2.941 seconds]
EXIT: 0

$ npm run verify
EXIT: 0
Found 0 warnings and 0 errors.        # üç workspace lint
Test Files  16 passed (16)            # API birim
Tests       118 passed (118)
Test Files  32 passed (32)            # web
Tests       319 passed (319)
Application bundle generation complete.   # API + web
OpenAPI contract is current.

$ npm run test:e2e --workspace apps/api
Test Files  18 passed (18)
Tests       173 passed (173)
Duration    21.61s
EXIT: 0

$ npm run openapi:check
OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
EXIT: 0
```

Ek olarak `PROBEDESK_API_URL=http://127.0.0.1:3110 RUN_VERSION_ID=89064e8a-… node
scripts/phase-4-sse-check.mjs` yeniden koşuldu: 98 olay, `snapshotSequence=98`,
`recordedSampleCount=90`, `replayFrom=49`, 49 replay olayı, `Last-Event-ID` önceliği 6,
terminal 204, geçersiz/gelecek cursor 400, `EXIT: 0`. Bu run (`0d44c59a-…`) da silindi.

## Sınırlar ve doğrulanmayanlar

- Gerçek backend duplicate olayı zorlanmadı; duplicate davranışı reducer/facade
  testleriyle kapsanıyor.
- Gerçek FORCED_FAILURE canlı UI izlemesi bu turda yapılmadı; P7 kapsamındadır.
- `Connection: Signed out` geçiş etiketi her koşuda yakalanmadı (yukarıdaki not); bir
  koşuda yakalandı, nihai koşuda yakalanmadı.
- Sign out ve expiry ekran görüntüleri son durumu (login) gösterir; bu nedenle iki görüntü
  aynı ekranı gösterir. Dönüş görüntüsü canlı ekranı gösterir.
- Ölçümler tek geliştirme veritabanı ve tek makinede alındı; yük/çoklu istemci ölçümü
  yapılmadı.
- `npm ci` veya temiz kurulum çalıştırılmadı.

## Temizlik

- Yarış kontrolünün 3 run'ı, yaşam döngüsü kontrolünün 3 run'ı ve SSE kontrolünün 1 run'ı
  ilişkili `measurements`/`run_events`/`run_steps` satırlarıyla silindi.
- Script'lerin oluşturduğu oturumlar `revokedAt` ile iptal edildi; tarayıcı oturumu
  Sign out/expiry senaryolarında zaten iptal edilmişti.
- API `:3110`, proxy `:3200`, uygulama sunucusu `:4300` ve Chrome `:9338` kapatıldı.
