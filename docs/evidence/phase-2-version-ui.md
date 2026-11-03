# Phase 2 frontend sürüm akışı kanıtı

- Tarih: 2026-11-03
- Kapsam: P2-07 — Publish onayı, sürüm listesi, salt okunur sürüm sayfası, yeni draft eylemi ve 409 yönlendirmeleri.
- Ortam: Node.js 22.23.2; Angular 22.2.4; testler Vitest/TestBed; geliştirme PostgreSQL 18 `127.0.0.1:5434/probedesk`; ayrı API portu 3100, web dev portu 4300.
- Uygulama commit'i: Bu çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge commit hash'i iddia etmez.
- Kapsam dışı: `packages/api-client` yeniden üretimi (gerekli tipler zaten vardı), bağımsız teknik inceleme, `docs/tasks/README.md` ve `docs/roadmap.md` durum satırları (lead günceller).

## P2-07 — Frontend sürüm akışı

### Plan Editor

- Save ve Publish ayrı düğmelerdir. Publish yalnız `form.dirty`/`dirty()` false, form geçerli ve `expectedRevision` bilinirken açılır.
- Dirty formda Publish kapalıdır; `#publish-availability` metni `Save your changes before publishing` gösterir ve düğme bu metne `aria-describedby` ile bağlıdır. Publish isteği gövdesi yalnız `{ expectedRevision }` taşır.
- Publish öncesi onay dialogu plan adını ve adım sayısını gösterir; `ariaLabelledBy`/`ariaDescribedBy`, başlangıç odağı "Keep editing", `restoreFocus` ve Escape ile kapatma vardır.
- Başarılı publish sonrası snackbar, açık draft'sız plan durumu, `GET /plans/:id/versions` tazelemesi ve yeni sürümün salt okunur sayfasına bağlantı gösterilir. Plan state, publish yanıtındaki sürüm özetiyle güncellenir.
- Publish hataları: `DRAFT_CHANGED`, `NO_OPEN_DRAFT`, eski `DRAFT_CONFLICT`, `VALIDATION_ERROR`, 403 ve 404 için ayrı İngilizce başlık/mesaj. Panel `requestId` ve varsa `currentRevision` gösterir; yerel form değerleri korunur, reload yalnız onayla yapılır.
- Publish başarısında form ve `expectedRevision` temizlenir; "Start new draft" eylemi açılır.

### Sürüm listesi ve yeni draft

- Editör `GET /plans/:id/versions` ile yayımlanmış sürümleri yeni→eski listeler; her satır sürüm numarası, ad, UTC yayın zamanı ve yayınlayan e-posta/rol içerir. En yeni sürüm `Current` etiketi ve `current-version` sınıfıyla işaretlenir.
- Plan listesindeki latest published version bağlantısı korunur; Operator/Viewer için sürüm verisi üretilmez.
- Editörde açık draft yoksa "Start new draft" görünür; planın yayımlanmış sürümü yoksa kapalıdır ve açıklama gösterir. `OPEN_DRAFT_EXISTS` 409'unda mevcut draft editörüne bağlantı ve `currentRevision` gösterilir.
- Sürüm sayfasında Planner için açık draft yoksa "Start new draft" görünür; açık draft varsa düğme yerine "Continue editing draft" bağlantısı gösterilir. Başarılı `POST /plans/:id/drafts` sonrası editöre gidilir.

### Published Plan sayfası

- `/plans/:planId/versions/:versionId` yalnız `GET /plan-versions/:id` yayımlanmış içeriğini gösterir.
- Plan adı, sürüm numarası, UTC yayın zamanı, yayınlayan e-posta/rol ve sıralı adım tablosu (ad, birim, min, max, sampleCount, intervalMs) gösterilir; nominal toplam örnek ve süre hesaplanır.
- Form, input, select ve textarea yoktur. Tek yazma eylemi Planner'ın ayrı draft oluşturmasıdır; published revision değiştirilmez.
- Planner için "Back to plan" editöre, Operator/Viewer için "Back to plans" listeye gider.
- Bilinmeyen veya draft revision id'si 404 olduğunda "Published version not found" durumu, `requestId` ve listeye dönüş bağlantısı gösterilir.
- `PublishedRevisionDto` yayınlayan özetini taşımadığı için yayınlayan bilgisi sürüm listesi yanıtından eşlenir. Liste isteği başarısızsa "Publisher unavailable" ve Retry gösterilir.

### Hata modeli

`ApiErrorView` içine yalnız `reason` (`details.reason`) ve `currentRevision` (`details.currentRevision`) eklendi. Diğer `details` alanları ekrana taşınmaz. Beş plan hatası için eşleme `plan-error-guidance.ts` içinde saf fonksiyonlarla test edilir:

- `DRAFT_CHANGED` → saved draft publish sırasında değişti, hiçbir şey yayımlanmadı.
- `NO_OPEN_DRAFT` → açık draft yok, plan başka oturumda yayımlanmış olabilir.
- `OPEN_DRAFT_EXISTS` → mevcut draft'ı düzenle, yeni draft açma.
- `NO_PUBLISHED_VERSION` → yeni draft için önce bir sürüm yayımla.
- Eski revision → saved draft daha yeni, reload et.

### Test kapsamı

Yeni 19 test:

1. Dirty formda Publish kapalı ve "Save your changes before publishing" görünür; tıklama dialog açmaz.
2. Onay dialogu plan adı/adım sayısını gösterir, ilk odak "Keep editing"; iptal HTTP isteği üretmez.
3. Onay sonrası istek `POST /plans/:id/draft/publish` ve gövde yalnız `{ expectedRevision: 4 }`; başarı sonrası sürüm listesi tazelenir, success paneli/bağlantısı ve açık draft'sız "Start new draft" görünür.
4. Eski revision 409'unda yerel input korunur; `currentRevision`, `requestId` ve onaylı reload gösterilir.
5. Yeni draft başarısında POST gövdesi yoktur, dönen draft forma bağlanır, revision 1 ve adımlar görünür.
6. `OPEN_DRAFT_EXISTS` 409'unda panel, mevcut draft bağlantısı, revision ve requestId görünür; yeni draft düğmesi kapanır.
7. Yayımlanmış sürüm yokken yeni draft düğmesi kapalıdır.
8. Açık draft yüklendiğinde editör sürüm listesindeki en yeni sürümü "Current" olarak işaretler.
9. Sürüm sayfası salt okunur tabloyu, sıralı adımları, toplamları ve yayınlayanı gösterir; input/form yoktur, Operator "Start new draft" görmez.
10. Sürüm sayfasında Planner açık draft yokken yeni draft oluşturur ve editöre gider; açık draft varken bağlantı gösterir.
11. Sürüm 404'ü ayrı not-found durumu ve requestId gösterir.
12. `PlansApi` publish/create-draft/versions/get-version yolları, metodları, gövdeleri ve normalizasyonu test edilir.
13. `HttpErrorNormalizer` güvenli reason/currentRevision alanlarını ve keyfi details'in dışarıda kalmasını test eder.
14. Beş hata nedeni için guidance eşlemeleri test edilir.

Mevcut 96 test korunarak toplam 115 test geçti.

## Çalıştırılan kontroller (gerçek çıktılar)

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 23ms on 56 files with 93 rules using 8 threads.

$ npm run typecheck --workspace apps/web
tsc -p tsconfig.app.json --noEmit
(çıkış kodu 0; hata yok)

$ npm run test --workspace apps/web
Test Files  17 passed (17)
Tests       115 passed (115)
Duration    4.23s

$ npm run build --workspace apps/web
Application bundle generation complete. [3.190 seconds]
(çıkış kodu 0; uyarı/hata yok)
```

`apps/web/angular.json` içindeki `anyComponentStyle` `maximumWarning` değeri 4 kB'dan 6 kB'a çıkarıldı; editör bileşen stilinin büyümesi nedeniyle oluşan uyarıyı gidermek içindir. `maximumError` 8 kB olarak kaldı.

## API duman testi

Ayrı API süreci (geliştirme veritabanı, port 3100):

```text
GET /api/health/ready
{"status":"ok","checks":{"database":"ok","migrations":"ok"}}

POST /api/auth/login (planner@probedesk.local) -> role=PLANNER
POST /api/plans -> plan=cd85654c-2d9c-4eed-9316-c46364071ddd
PUT /api/plans/:id/draft -> editRevision=2, steps=2
POST /api/plans/:id/draft/publish {"expectedRevision":2}
  -> version=1, id=45f287b7-38cf-4fcc-adb7-e9e259c82399, steps=2
GET /api/plans/:id/versions -> [1]
GET /api/plan-versions/:id -> version=1, steps=2
POST /api/plans/:id/drafts -> editRevision=1, baseVersionId=v1, steps=2
GET /api/plan-versions/:id (tekrar) -> version=1, steps=2, name="P2-07 smoke plan"
```

Web dev sunucusu `localhost:4300` (API proxy 3100) ile açıldı; `/` 200 ve proxy üzerinden `/api/health/ready` 200 döndü.

Gerçek tarayıcı tıklama testi yapılamadı: in-app browser `[browser.disconnected]` döndü ve oturumda bağlı desktop tarayıcı yoktu. Bu nedenle login → editör → publish dialogu → sürüm sayfası tıklama akışı tarayıcı kanıtı olarak sunulmaz; bileşen davranışı TestBed/HttpTestingController testleriyle doğrulandı.

## Değişen dosyalar

- `apps/web/src/app/core/http/http-error-normalizer.ts`, `.spec.ts`
- `apps/web/src/app/features/plans/plans-api.ts`, `plans-api.types.ts`, `plans-api.spec.ts`
- `apps/web/src/app/features/plans/plans.facade.ts`
- `apps/web/src/app/features/plans/plan-editor-page.ts`, `.html`, `.scss`, `.spec.ts`
- `apps/web/src/app/features/plans/plan-version-page.ts`, `.html` (yeni), `.scss` (yeni), `.spec.ts` (yeni)
- `apps/web/src/app/features/plans/publish-confirm-dialog.ts` (yeni)
- `apps/web/src/app/features/plans/plan-error-guidance.ts`, `.spec.ts` (yeni)
- `apps/web/src/app/features/routes.spec.ts`
- `apps/web/angular.json`
- `docs/tasks/P2-07.md`, bu kanıt belgesi

## Açık riskler ve ertelenen işler

- Bağımsız teknik inceleme yapılmadı; görev `In Review` durumundadır ve Accepted değildir.
- Gerçek tarayıcı/klavye duman testi yapılamadı; yalnız API ve bileşen testleri vardır.
- Sürüm detayındaki yayınlayan bilgisi sürüm listesi isteğine bağlıdır; `GET /plan-versions/:id` yanıtı yayınlayan alanını taşımıyor.
- Publish sonrası plan verisi publish yanıtından güncellenir; ayrıca `GET /plans/:id` yeniden okunmaz. Yanıt alanları sözleşmedeki published revision ile aynıdır.
- Aşama demosu ve nihai kabul ayrıca yapılmalıdır.
