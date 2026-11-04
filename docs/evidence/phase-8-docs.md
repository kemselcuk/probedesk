# Phase 8 — README ve teknik belgeler kanıtı (P8-04)

Durum: **Uygulandı, yerelde doğrulandı ve teknik incelemeden geçti.** Bu belge ürün kabulü
değildir. Kart `Accepted`; nihai ürün kabulü kullanıcıdadır.

- Tarih: 2026-11-04
- Görev: [P8-04](../tasks/P8-04.md) — README ve teknik belgeler
- Kapsam: İngilizce README, belge dizini, uygulama rehberi, demo, test sözleşmesi, kabul listesi ve
  P8-04 kartı
- Ortam: macOS 26.7.1 (25G241), arm64; Node.js `22.23.2`; npm `11.6.2`; Docker Compose delivery
  profili ve `probedesk_test` PostgreSQL 18.1 test konteyneri
- Commit SHA: **Henüz yok.** Commit/push lead'in sorumluluğunda; bu kayıt çalışma ağacındaki
  gerçek çıktılara dayanır.
- Git komutu çalıştırılmadı.

## Değişen dosyalar

- `README.md` — çalışan uygulama, durum, kurulum, demo, mimari, test/CI, yapı ve sınırlar.
- `docs/README.md` — belge dizini, okuma sırası ve güncel aşama durumu.
- `docs/implementation-guide.md` — Phase 1 iskeleti anlatımı yerine çalışan uygulama ve açık işler.
- `docs/demo.md` — planlı demo metni yerine gerçek seed fixture'ları ve doğrulanmış UI akışı.
- `docs/testing.md` — uygulanan test katmanları, doğrulanan komutlar ve gerçek CI durumu.
- `docs/acceptance.md` — yalnızca gerçek kanıtı olan teslim maddeleri işaretlendi; ürün ve kullanıcı
  kabulü açık bırakıldı.
- `docs/tasks/P8-04.md` — `Accepted`, kabul ölçütleri ve kanıt alanları.
- `docs/evidence/phase-8-docs.md` — bu kayıt.

## Çalıştırılan komutlar ve gerçek sonuçlar

### 1. Tam yerel doğrulama

```text
$ npm run verify
> probedesk@0.1.0 verify
> npm run lint && npm run typecheck && npm run test:api:unit && npm run test:web && npm run build && npm run openapi:check

lint:
  @probedesk/api       Found 0 warnings and 0 errors. (144 files, 107 rules)
  @probedesk/web       Found 0 warnings and 0 errors. (113 files, 93 rules)
  @probedesk/api-client Found 0 warnings and 0 errors. (2 files, 93 rules)

typecheck:
  API, web ve api-client tsc --noEmit → çıkış 0

test:api:unit:
  Test Files  16 passed (16)
       Tests  118 passed (118)
    Duration  735ms

test:web:
  Test Files  36 passed (36)
       Tests  370 passed (370)
    Duration  5.89s

build:
  API nest build → başarılı
  Angular production build → başarılı
  Initial total 327.17 kB raw / 90.04 kB estimated transfer

openapi:check:
  OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
```

Çıkış kodu: `0`.

### 2. PostgreSQL entegrasyon paketi

Test veritabanı: `probedesk_test` (`127.0.0.1:5433`), 8 migration uygulanmış test konteyneri.

```text
$ npm run test:api:integration
> npm run test:e2e --workspace apps/api
> vitest run --config ./vitest.config.e2e.ts

 Test Files  22 passed (22)
      Tests  197 passed (197)
   Duration  34.59s (transform 419ms, setup 1.90s, import 4.08s, tests 26.28s, environment 1ms)
```

Çıkış kodu: `0`.

### 3. Markdown bağlantı kontrolü

Yerel bir Markdown link aracı kurulu olmadığı için küçük bir Node script'i kullanıldı. Script göreli
dosya yollarını, görsel yollarını ve `#anchor` hedeflerini denetler; harici `http(s)` bağlantılarını
ağ isteği yapmadan atlar. Kod blokları taranmaz.

```text
$ node /private/var/folders/.../probedesk-link-check.mjs
files scanned: 8
  - README.md
  - docs/README.md
  - docs/implementation-guide.md
  - docs/demo.md
  - docs/testing.md
  - docs/acceptance.md
  - docs/tasks/P8-04.md
  - docs/evidence/phase-8-docs.md
relative links/images checked: 165 (5 images)
unique link targets checked: 115
broken: 0
```

Çıkış kodu: `0`. Script çalışma alanı dışında, geçici dizinde tutuldu; repository'ye eklenmedi.

### 4. Ekran görüntüsü yolları

README'de kullanılan dört görselin dosya varlığı, sıfır olmayan boyutu ve gerçek piksel ölçüleri
kontrol edildi:

```text
docs/evidence/phase-2-editor.png              1280 x 813
docs/evidence/phase-7-live-running.png        1280 x 1000
docs/evidence/phase-7-failed-details.png      1280 x 1000
docs/evidence/phase-7-compare-v1-v2-rules.png 1280 x 1000
assets/icon.svg                               302 bytes
```

Görseller çalışan Angular uygulamasından gerçek Chrome/Playwright koşularında alınmıştır:

- `phase-2-editor.png` — [Phase 2 plan yaşam döngüsü](phase-2-demo.md).
- `phase-7-live-running.png`, `phase-7-failed-details.png` ve
  `phase-7-compare-v1-v2-rules.png` — [P7-01 ana demo](phase-7-e2e.md).

### 5. Doküman iddialarının kanıt eşlemesi

| İddia | Kanıt |
|---|---|
| Üç demo hesabı ve yerel parolalar | [phase-8-seed.md](phase-8-seed.md) |
| `Power Supply Validation` v1/v2 ve dört run | [phase-8-seed.md](phase-8-seed.md) |
| FAILED Current Draw `sampleIndex=14`, `0.600000 A`, v1 max `0.550000 A` | [phase-8-seed.md](phase-8-seed.md) |
| Temiz DB migration + seed + API + web | [phase-8-clean-install.md](phase-8-clean-install.md) |
| `down`/`up` sonrası plan/run kalıcılığı | [phase-8-clean-install.md](phase-8-clean-install.md) |
| Compose http://127.0.0.1:8080, SSE ve deep link | [phase-8-compose.md](phase-8-compose.md) |
| API 118, web 370, entegrasyon 197 test | Bu belge, bölüm 1–2 |
| Playwright 2 senaryo | [phase-7-e2e.md](phase-7-e2e.md) |
| CI altı işin tamamı yeşil (`0d76dcf`, `v0.1.0-rc.3`) | [general-review-fixes.md](general-review-fixes.md) |
| Erişilebilirlik/klavye ve 1280/768 yerleşim | [phase-7-accessibility.md](phase-7-accessibility.md) |

## Kaldırılan veya düzeltilen eski iddialar

- README'deki "planned application", "Phases 1, 2 and 3 accepted", "documents describe the
  intended product, not completed features" ve "delivery pending Phases 4-8" ifadeleri kaldırıldı.
- README'nin "These commands were run during Phase 1" ifadesi yerine güncel komutlar ve gerçek
  çıktılar/kanıt bağlantıları yazıldı.
- `docs/README.md` ve `docs/implementation-guide.md` artık Phase 1 iskeleti anlatmıyor; P1–P6
  `Accepted`, P7/P8 inceleme durumu ve açık işler yazılı.
- `docs/demo.md`'deki "seed veya video henüz üretilmedi" ve planlı fixture metni kaldırıldı;
  gerçek üç hesap, iki sürüm, dört run ve hata indeksi yazıldı. Video başlangıçta "henüz yok"
  olarak yazıldı; ardından kullanıcı kararıyla kapsam dışına alındı.
- `docs/testing.md` başlığındaki "P4–P8 davranış testleri henüz yazılmadı" ve "komutlar planlanan
  giriş noktalarıdır" ifadeleri kaldırıldı; uygulanan katmanlar ve gerçek CI koşusu eklendi.
  `planlanan-komutlar` anchor'ı eski görev kartı bağlantıları kırılmasın diye korundu.
- Doğrulanmamış Safari/Firefox/mobil iddiası eklenmedi; yalnızca gerçek Chrome ve 1280/768 px
  kontrolleri yazıldı.
- Coverage yüzdesi, performans, kota veya süre uydurulmadı; yalnızca raporlanan test sayıları ve
  süreler kullanıldı.
- Demo parolaları dışında secret/token/cookie yazılmadı.

## Açık işler ve nihai kabule kalanlar

1. **P8-05 demo videosu** kullanıcı kararıyla kapsam dışıdır; README'de video bağlantısı yoktur.
2. **P8-06 sürüm adayı** `v0.1.0-rc.3` (`0d76dcf`) olarak hazırlanmıştır; kullanıcı ürün kabulü açıktır.
3. **CI:** Sürüm adayı `0d76dcf` için run `41918727810` altı işle yeşildir; önceki kayıtlar
   `3d27f2f`, `81a7f2c`, `270a399` ve `10798fa` içindir.
4. **Bağımsız inceleme:** P8 incelemesi tamamlandı; kalan Medium doküman bulguları bu commit'te
   giderildi. Kartların teknik kabul durumu görev kartlarında kayıtlıdır.
5. **Kullanıcı ürün kabulü:** [acceptance.md](../acceptance.md) ürün kutuları ve kullanıcı kabulü
   açık.
6. **Kök `npm run dev`:** Bu turda tek parça çalıştırılmadı; 4200/3000 portları başka süreçler
   tarafından kullanılıyordu. README'deki delivery yolu P8-01/P8-03 ile, API/Angular geliştirme
   bileşenleri P7 E2E kayıtlarıyla doğrulanmıştır. Temiz bir makinede README geliştirme akışının
   tek parça denenmesi P8-06 kapsamında önerilir.
7. **`docs/tasks/README.md` ve `docs/roadmap.md`:** Durum satırları bu commit'te güncellendi.

## Kanıt bağlantıları

- [P8-04 görev kartı](../tasks/P8-04.md)
- [Proje README'si](../../README.md)
- [Hazır veri kanıtı](phase-8-seed.md)
- [Compose teslimi](phase-8-compose.md)
- [Temiz kurulum ve kalıcılık](phase-8-clean-install.md)
- [CI pipeline](phase-7-ci.md)
- [Ana demo E2E](phase-7-e2e.md)
- [Erişilebilirlik](phase-7-accessibility.md)
