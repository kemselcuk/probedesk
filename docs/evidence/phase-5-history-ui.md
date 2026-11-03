# Faz 5 — Run History ve Run Details UI kanıtı

- Tarih: 2026-11-03
- Görevler: P5-02 (Run History), P5-03 (Run Details)
- Durum: **In Review** — bağımsız teknik inceleme ve nihai kabul bekliyor.
- Kapsam: `apps/web` yalnızca; `apps/api` ve `packages/api-client` değiştirilmedi.

## Değişen dosyalar

### Run History

- `apps/web/src/app/features/runs/run-history-page.ts`
- `apps/web/src/app/features/runs/run-history-page.html`
- `apps/web/src/app/features/runs/run-history-page.scss`
- `apps/web/src/app/features/runs/run-history-page.spec.ts`
- `apps/web/src/app/features/runs/run-history.facade.ts`
- `apps/web/src/app/features/runs/runs-api.ts` (`listRuns`, sorgu üretimi, katı yanıt doğrulama)
- `apps/web/src/app/features/runs/runs-api.types.ts` (üretilen history DTO alias'ları)
- `apps/web/src/app/features/runs/runs-api.spec.ts` (history sorgu/yanıt testleri)

### Run Details

- `apps/web/src/app/features/runs/run-details-page.ts` (toplam ihlal, ilk ihlal, eksik örnek hesapları)
- `apps/web/src/app/features/runs/run-details-page.html` ("Result summary" bölümü)
- `apps/web/src/app/features/runs/run-details-page.scss`
- `apps/web/src/app/features/runs/run-details-page.spec.ts`
- `apps/web/src/app/features/runs/run-status.ts` (Cancelled/Interrupted/Error açıklamaları)
- `apps/web/src/app/features/runs/run-status-badge.ts` (History ve Details için ortak, metin + ikonlu rozet)

### Zorunlu test uyarlamaları (feature dışı, yalnızca test desteği)

- `apps/web/src/app/features/routes.spec.ts`: `/runs` placeholder `P5-02` metni kaldırıldı; gerçek history isteği yanıtlanıyor.
- `apps/web/src/app/features/auth/login-page.spec.ts`: başarılı girişten sonra `/runs` hedefine gidildiği için history ve plan istekleri yanıtlanıyor.
- `apps/web/src/app/app.routes.ts`: değiştirilmedi (mevcut `/runs` ve `/runs/:runId` route'ları yeterli).

## Run History davranışı

- Filtreler ve sayfa numarası URL query string'indedir: `planId`, `status`, `outcome`, `from`, `to`, `page`.
- Sayfa ilk açılışta `page=1&limit=20` gönderir. Filtre değişimi URL'i `replaceUrl` ile günceller, `page` değerini kaldırır ve yeni istek `page=1` gider.
- `from`/`to` URL'de `YYYY-MM-DD` olarak kalır; API'ye `YYYY-MM-DDT00:00:00.000Z` olarak gönderilir. Aralık `[from, to)` ve UTC'dir.
- URL'deki her değişiklik (yenileme, geri dönüş, doğrudan deep link) formu ve isteği yeniden kurar.
- Facade her okumaya artan bir sequence verir; eski filtrenin geç gelen başarı veya hata yanıtı yeni durumu ezmez. Testte eski `CANCELLED` yanıtı yeni `ERROR` sonucundan sonra döndürülerek doğrulandı.
- Liste yalnızca `RunHistoryPageDto` özet alanlarını ister ve doğrular; `steps`/`measurements` dizisi taşımaz. Satır detayı için yalnızca `/runs/:id` linki vardır.
- Durumlar: loading, empty (filtreli/filtresiz ayrı metin), hata + requestId + retry, 401 için ayrı "session expired" paneli ve giriş linki.
- Tablo: metin + ikonlu status/outcome rozeti, plan/sürüm, senaryo/seed, UTC başlangıç/bitiş, kaydedilen/beklenen örnek, tolerans dışı sayısı, ilk ihlal (adım + örnek indeksi), detay linki ve P6 için en fazla iki kayıt seçme kutuları. Karşılaştırma ekranı veya isteği yoktur.
- `PlansFacade` plan filtresi seçeneklerini yükler; plan listesi yüklenemezse URL'deki plan filtresi korunur ve kullanıcıya yeniden deneme sunulur.

## Run Details davranışı

- Tüm veriler mevcut `GET /api/runs/:id` snapshot'ından gelir; güncel plan taslağı okunmaz.
- "Result summary" bölümü: toplam tolerans dışı örnek (sunucudaki adım sayaçlarının toplamı, yeniden hesaplama yok), kaydedilen/beklenen ve yüzde, eksik örnek sayısı/yüzdesi, ilk ihlalin adımı/konumu/örnek indeksi ve kayıtlı örnek değeri.
- Eksik örnekler "not recorded" olarak gösterilir; null istatistikler "Not available" kalır, sıfıra çevrilmez.
- Cancelled/Interrupted/Error için genel sonuç Passed/Failed gösterilmez; açıklama bu durumun bir Passed/Failed sonucu olmadığını açıkça söyler. Sunucu yanlışlıkla outcome taşısa bile gösterge status'a göre belirlenir (test edildi).
- Mevcut snapshot kuralları, ölçüm tablosu, iptal ve Run Again davranışları korunur.
- Status rozeti ortak `RunStatusBadge` bileşenine taşındı; History ve Details aynı metin + ikon kuralını kullanır.

## Çalıştırılan kontroller ve gerçek sonuçlar

| Komut | Sonuç |
|---|---|
| `npm run lint --workspace apps/web` | `Found 0 warnings and 0 errors.` (84 dosya, 93 kural) |
| `npm run typecheck --workspace apps/web` | Exit 0; tanı yok. |
| `npm run test --workspace apps/web` | `Test Files 28 passed (28)`, `Tests 273 passed (273)`. Önceki 253 test korunur; 20 yeni test eklendi. |
| `npm run build --workspace apps/web` | `Application bundle generation complete.` Çıktı: `apps/web/dist/web`. Uyarı yok. |

### Yeni test kapsamı

- History: filtre → URL → istek eşlemesi; tarih → UTC sınırı; sayfa sıfırlama; ileri/geri sayfalama; URL'den yenileme; stale yanıt koruması; loading/empty/hata/401; plan listesi hatası; altı durum etiketi; partial rozeti; ölçüm dizisi yüklenmemesi; P6 seçim hook'ları.
- Details: toplam ihlal; ilk ihlal adımı/indeksi/değeri; eksik örnek sayısı/yüzdesi; tek örnekli adım; yalnızca snapshot kullanımı (güncel plan okunmaması); null istatistiklerin "Not available" kalması (mevcut test); Cancelled/Interrupted/Error için Passed/Failed gösterilmemesi.
- API sınırı: history query parametreleri; boş filtrelerin gönderilmemesi; özet satır doğrulaması; bozuk satırın reddedilmesi.

## Ertelenen / kapsam dışı

- Gerçek tarayıcıda sayfa yenileme ve filtre değiştirme kontrolü yapılmadı. P5-01 API'si paralel geliştirildiği için çalışan API + web ortamı başlatılmadı. URL'den açma/yenileme ve filtre değişimi `RouterTestingHarness` ile doğrulandı; gerçek tarayıcı kontrolü inceleme öncesinde yapılmalıdır.
- P6 karşılaştırma akışı kurulmadı; yalnızca en fazla iki kayıt seçme kutuları ve açıklama metni eklendi.
- P5-01 tarafından üretilen `RunHistoryPageDto`, `RunHistoryItemDto`, `RunFirstFailureDto` şemaları sonradan `packages/api-client` içine geldi; web artık doğrudan bu üretilen tipleri kullanıyor, geçici tip dosyası bırakılmadı.
- Bağımsız teknik inceleme ve nihai kabul yapılmadı; kartlar `In Review` durumundadır.
