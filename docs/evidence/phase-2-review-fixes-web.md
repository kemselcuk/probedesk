# Phase 2 — Frontend inceleme bulgularının düzeltme kanıtı

- Tarih: 2026-11-03
- Kapsam: `docs/evidence/phase-2-review.md` içindeki H-02, M-03, M-04, M-07 ve L-08 bulgularının `apps/web` tarafı.
- Ortam: macOS, Node.js `22.23.2`, ortak checkout. API kodu ve sözleşme değiştirilmedi; kurulum veya git komutu çalıştırılmadı.
- Bu belge bir düzeltme kanıtıdır, ürün kabulü değildir. Görev kartları `In Review` durumunda bırakılmıştır.

## Kapatılan bulgular

### H-02 — Elle yazılmış ikinci yanıt modeli kaldırıldı

- `apps/web/src/app/features/plans/plans-api.types.ts` artık yalnızca generated
  `components['schemas'][...]` tiplerinin takma adlarını içeriyor:
  `PlanListItemDto`, `PlanDetailDto`, `DraftRevisionDto`, `PublishedRevisionDto`,
  `PublishedVersionListItemDto`, `SaveDraftDto`, `CreatePlanDto`, `DeviceProfileDto`,
  `PlanStepDto`, `PublishDraftDto`.
- `plans-api.ts` tüm uçlarda `http.get/post/put<GeneratedDto>` kullanıyor ve yanıtı
  `map` içinde doğruluyor. `openDraft`, `items`, `data`, `plan`, `profile`,
  `latestVersion`, `logicalStepIds` gibi sözleşme dışı zarflar ve fallback'ler silindi.
- Eksik zorunlu alan, yanlış tip veya `DRAFT`/`PUBLISHED` dışı `state` artık
  `MalformedApiResponseError` fırlatıyor. `HttpErrorNormalizer` bu hatayı
  `MALFORMED_API_RESPONSE` kodlu normal hata görünümüne çeviriyor; liste/plan ekranı
  bunu standart `role="alert"` panosunda gösteriyor.
- `PlanStepDto` alanları (`logicalStepId`, `position`, ad, birim, min, max, örnek,
  aralık) ve `steps` dizisi zorunlu; eksikse adım düşürülmüyor, `'0'`, `''`, `0`
  veya `[]` uydurulmuyor. `SaveDraftResult` doğrudan `DraftRevisionDto`.
- Create plan yanıtı `PlanDetailDto` olarak okunuyor; kimlik uydurulmuyor.
- View-model yalnızca ekranın gerçekten kullandığı yerde kaldı: liste satırı doğrudan
  `PlanListItemDto`, editör `PlanDetailDto`, sürüm ekranı `PublishedRevisionDto`
  kullanıyor. `PlanSummary`/`PlanDetail` adları generated tiplerin takma adıdır;
  ikinci bir iş modeli yok.
- Testler gerçek yanıt biçimlerini ve bozuk yanıt yolunu kapsıyor:
  `plans-api.spec.ts` (17 test), `plans-list-page.spec.ts` içinde bozuk liste yanıtı.
  Sözleşmede olmayan `{ items }`, `{ plan }` ve tek nesne profil zarfları testleri silindi.

### M-03 — Sıfır adımlı kaydedilmiş draft'ta Publish kapalı

- `plan-editor-page.ts` içinde `savedStepCount` eklendi; değer
  `facade.plan()?.draft?.steps.length` yani sunucudan gelen kaydedilmiş draft'tan
  okunuyor, formdaki yerel adım sayısından değil.
- `publishBlockReason` sırasıyla dirty/save, kaydedilmiş adım sayısı, revision ve form
  geçerliliğini kontrol ediyor. Sıfır adımda nedeni
  `Add at least one step before publishing.` olarak gösteriliyor.
- Test: `plan-editor-page.spec.ts` "saves an empty draft separately from publish
  validity" hem kayıt öncesi hem boş draft kaydından sonra `#publish-button`
  disabled ve açıklama metnini doğruluyor.

### M-04 — Sürüm plana bağlandı; eski sürümde yeni draft gizlendi

- `plan-version-page.ts` `version.planId !== planId` durumunu hesaplıyor; eşleşmezse
  şablon sürüm içeriğini hiç render etmeden "Published version not found" durumunu
  gösteriyor.
- "Start new draft" yalnız Planner + açık draft yok + sürüm listesi yüklü + görüntülenen
  sürüm en yüksek `versionNumber` olan published sürüm olduğunda görünüyor.
- Eski sürümde düğme gizleniyor; "This is an older published version. A new draft
  always copies the latest published version, not this older version." açıklaması ve
  en son sürüme bağlantı gösteriliyor. Sürüm listesi yüklenemezse yeni draft
  başlatılmıyor ve retry sunuluyor.
- Testler: `plan-version-page.spec.ts` içinde plan/sürüm uyuşmazlığı ve eski sürüm
  senaryosu; mevcut latest-sürüm akışı korunarak geçiyor.

### M-07 — Sign out kirli editörde onay istiyor

- `core/navigation/unsaved-changes.service.ts` eklendi. Editör kendi `canLeave()`
  kontrolünü kaydediyor ve destroy sırasında kaydı kaldırıyor.
- `app-shell.ts` sign out artık önce bu kontrolü çalıştırıyor. Editör kirliyse mevcut
  `Leave without saving?` dialogu açılıyor; "Keep editing" oturumu kapatmıyor,
  "Discard changes" sonrası `POST /api/auth/logout` ve `/login` yönlendirmesi yapılıyor.
- 401/oturum süresi yönlendirmeleri bu yolu kullanmıyor; route guard'ın `/login`
  istisnası korunuyor.
- Test: `app-shell.spec.ts` kirli editörde iptal ve onay adımlarını; iptalde logout
  isteği olmadığını ve yerel girdinin korunduğunu; onayda oturumun kapandığını
  doğruluyor.

### L-08 — Yayınlayan bilgisi

- `PublishedRevisionDto` (tek sürüm okuması) yayınlayan alanı taşımıyor; API
  değiştirilmedi. Sürüm ekranı yayınlayan e-postasını/rolünü sürüm listesinden
  eşlemeye devam ediyor ve liste yüklenemezse "Publisher unavailable" + retry
  gösteriyor. Bu bağımlılık P2-07 kartında açıkça kayıtlı.

## Değişen dosyalar

- `apps/web/src/app/features/plans/plans-api.ts`
- `apps/web/src/app/features/plans/plans-api.types.ts`
- `apps/web/src/app/features/plans/plans-api.spec.ts`
- `apps/web/src/app/features/plans/plans.facade.ts`
- `apps/web/src/app/features/plans/plans-list-page.ts`
- `apps/web/src/app/features/plans/plans-list-page.html`
- `apps/web/src/app/features/plans/plans-list-page.spec.ts`
- `apps/web/src/app/features/plans/plan-editor-page.ts`
- `apps/web/src/app/features/plans/plan-editor-page.spec.ts`
- `apps/web/src/app/features/plans/plan-version-page.ts`
- `apps/web/src/app/features/plans/plan-version-page.html`
- `apps/web/src/app/features/plans/plan-version-page.spec.ts`
- `apps/web/src/app/layout/app-shell/app-shell.ts`
- `apps/web/src/app/layout/app-shell/app-shell.spec.ts`
- `apps/web/src/app/core/http/http-error-normalizer.ts`
- `apps/web/src/app/core/http/malformed-api-response.error.ts` (yeni)
- `apps/web/src/app/core/navigation/unsaved-changes.service.ts` (yeni)

## Çalıştırılan kontroller ve gerçek sonuçlar

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 11ms on 58 files with 93 rules using 8 threads.
EXIT: 0

$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
EXIT: 0

$ npm run test --workspace apps/web
Test Files  17 passed (17)
Tests       125 passed (125)
Duration    4.62s
EXIT: 0

$ npm run build --workspace apps/web
Application bundle generation complete. [2.964 seconds]
Initial total 325.68 kB / 90.91 kB
EXIT: 0
```

Not: Test sayısı son düzeltme turunda 125'tir. `plans-api.spec.ts` 17 test içerir.
Build çıktısındaki boyutlar bu düzeltme turunda alınmıştır.

## Doğrulanamayanlar / sınırlar

- Gerçek API süreci, gerçek tarayıcı tıklaması ve gerçek PostgreSQL bu düzeltme
  turunda çalıştırılmadı; doğrulama TestBed/HttpTestingController ve Angular build
  ile sınırlıdır.
- Gerçek ağ üzerinden malformed yanıt üretilmedi; bozuk yanıt yolu HttpTestingController
  ile beslendi.
- L-08 için API'ye yayınlayan alanı eklenmedi; sözleşme değişikliği bu görevin dışında.
- Görev kartları `In Review` durumundadır; bağımsız yeniden inceleme ve nihai kabul
  yapılmadı.
