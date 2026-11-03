# Phase 2 — Bağımsız Teknik İnceleme

- Tarih: 2026-11-03
- İnceleme kapsamı: P2-01 … P2-08, `12e8405` commit'i ve öncesindeki Phase 2 değişiklikleri.
- Ortam: macOS, Node.js `22.23.2`, sistem npm `10.9.8` (pinned `11.6.2` ile temiz kurulum bu incelemede çalıştırılmadı), PostgreSQL 18 geliştirme `127.0.0.1:5434/probedesk`, test `127.0.0.1:5433/probedesk_test`.
- Yöntem: Doküman ve kod okuması; `npm run verify`, `npm run test:e2e --workspace apps/api`, `npm run openapi:check`; gerçek PostgreSQL üzerinde doğrudan SQL deneyleri; ayrı API süreci (`:3100`) üzerinden Planner/Operator/Viewer oturumlarıyla adversarial HTTP; gerçek headless Chrome (`:9335`) ile UI kontrolü.
- **Bu belge bağımsız bir teknik incelemedir; ürün kabulü değildir. Hiçbir görev bu inceleme nedeniyle `Accepted` yapılmamıştır.**

## 1. Çalıştırılan kontroller ve gerçek sonuçlar

### 1.1 Toplu doğrulama

```text
$ npm run verify
...
Test Files  9 passed (9)      # apps/api birim
Tests       43 passed (43)
Test Files  17 passed (17)    # apps/web
Tests       115 passed (115)
...
Application bundle generation complete.
OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
EXIT: 0
```

`npm run verify`; lint, iki workspace typecheck, API birim, web testleri, iki build ve OpenAPI kontrolünü içeriyor. Çıktıda hata/uyarı yok; ancak pinned npm `11.6.2` ile `npm ci` çalıştırılmadı.

```text
$ npm run test:e2e --workspace apps/api
Test Files  10 passed (10)
Tests       85 passed (85)
Duration    9.70s
EXIT: 0
```

```text
$ npm run openapi:check
OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.
```

### 1.2 Migration ve şema

İki geçici gerçek PostgreSQL veritabanı oluşturuldu; inceleme sonunda ikisi de silindi.

- Boş veritabanı: `prisma migrate deploy` dört migration'ı da uyguladı (`20261103120000_init`, `20261103130000_session_csrf_token_optional`, `20261103160000_plans`, `20261103170000_published_immutability`).
- Phase 1 yükseltmesi: ilk iki migration SQL'i doğrudan uygulandı, `prisma migrate resolve --applied` ile kaydedildi, ardından `prisma migrate deploy` yalnızca `20261103160000_plans` ve `20261103170000_published_immutability` migration'larını uyguladı.
- Geliştirme veritabanında `_prisma_migrations` dört satır ve `finished_at` dolu; Phase 1 verisi (3 kullanıcı, 1 profil) korunmuş durumda.

Doğrudan SQL ile doğrulananlar:

| Kontrol | Sonuç |
|---|---|
| Aynı planda ikinci `DRAFT` | Reddedildi (`plan_revisions_planId_draft_key`) |
| Aynı planda aynı `versionNumber` | Reddedildi (`plan_revisions_planId_versionNumber_key`) |
| Aynı revision'da ikinci `position` / ikinci `logicalStepId` | Reddedildi (unique index) |
| Başka planın `StepIdentity`'si | Reddedildi (`plan_steps_logicalStepId_planId_fkey`) |
| Başka planın draft revision'ı | Kompozit FK ile reddedildi |
| `minimum > maximum`, `sampleCount=0`, `intervalMs=99`, 1e9 dışı sınır | CHECK'ler reddetti |
| Published revision UPDATE/DELETE | Trigger reddetti |
| Published step INSERT/UPDATE/DELETE | Trigger reddetti |
| Draft adının boş olması | **Kabul edildi** (bkz. H-01) |
| `baseVersionId`'nin başka planın published revision'ı olması | **Kabul edildi** (bkz. M-05) |
| Doğrudan `PUBLISHED` revision INSERT (version 999, Viewer publisher, 0 adım) | **Kabul edildi** (bkz. M-06) |
| `TRUNCATE plan_steps` / `TRUNCATE plan_revisions CASCADE` | **Başarılı oldu; satır trigger'ları çalışmadı** (bkz. M-06) |

### 1.3 Adversarial HTTP

Ayrı API süreci (`PORT=3100`) ve gerçek geliştirme veritabanı kullanıldı. 96 kontrolün tamamı beklenen sonucu verdi; öne çıkanlar:

- Planner/Operator/Viewer login; CSRF'siz Planner yazımı 403; yanlış login Origin 403; JSON olmayan login 400.
- Operator/Viewer create/save/publish/new-draft 403.
- Draft-only plan O/V için listede yok, detayda ve sürüm listesinde 404; Planner `draft: null` alıyor, O/V yanıtında `draft` anahtarı hiç yok.
- 0 adımlı draft kaydı 200; 31 adım 400 (`steps`).
- `5e2`, `1,5`, `1.1234567`, `NaN`, `Infinity`, `+1`, `01`, boşluklu değer, `1.`, `.5`, `1e9` dışı değerler `steps.0.minimum` ile 400.
- `-1000000000`, `1000000000`, `-0.000001`, `0.000001`, `-0` kabul; altı ondalıklı kanonik çıktı.
- Dizi sırası pozisyonları belirliyor; sunucu kimlikleri üretiyor; yeniden okumada sıra alanları aynı.
- Çapraz plan, tekrar eden ve bilinmeyen `logicalStepId` 400; hiçbir satır değişmiyor.
- Geçersiz gövde ve eski `expectedRevision` sonrası draft revision/adımları değişmiyor.
- Aynı `expectedRevision` ile iki eşzamanlı kayıt: `[200, 409]`, tek kazanan.
- Boş draft publish 400; eksik `expectedRevision` 400; stale publish 409.
- Publish 201 v1; `draft:null`; O/V yalnız published görüyor.
- v1 → yeni draft → v2: `logicalStepId` korunuyor, v1 içeriği değişmiyor; ikinci draft 409 `OPEN_DRAFT_EXISTS`.
- İki eşzamanlı publish: `[201, 409]`, tek sürüm.
- Publish/save yarışı: `[201, 409]`, sonuç tutarlı.

### 1.4 Gerçek tarayıcı

Headless Chrome DevTools protokolüyle gerçek Angular dev sunucusu (`:4201`) ve API (`:3100`) üzerinden:

- 0 adımlı draft editöründe `#publish-button` **disabled değil**; adım sayısı 0; sunucu aynı draft için 400 döndürüyor.
- Başka planın sürüm kimliğiyle `/plans/:planId/versions/:versionId` açıldığında sayfa 404 vermiyor; sürüm içeriğini gösteriyor, "Publisher unavailable" gösteriyor.
- Bir planın v1'inde `Start new draft` tıklandığında editör v2 değerlerini yüklüyor (`0.500000` yerine `0.750000`) ve "Version 2" gösteriyor.
- Konsolda yakalanmamış istisna yok.

## 2. Bulgular

### H-01 — Boş/geçersiz plan adı publish edilebiliyor; oluşan kayıt tüm plan listesini 500 yapıyor

**Önem: High — P2-06 kabulünü engeller.**

- Kanıt: `apps/api/src/plans/plans.service.ts:350` ve `:401` yalnız `assertPublishableSteps` çağırıyor; `draft.name` doğrulanmıyor. `apps/api/src/plans/plan-limits.ts:49-108` yalnız adım alanlarını kontrol ediyor. Migration'daki `plan_revisions_state_fields_check` (`20261103160000_plans/migration.sql:113-129`) sürüm/yayınlayan/zamanı zorunlu tutuyor ama `name` için 1–100 kontrolü yok. `plans.service.ts:389-399` ad değişikliğini yalnız yarış tespiti için karşılaştırıyor; geçerliliğini kontrol etmiyor.
- Gözlem: Geçerli bir draft oluşturulup tek adım kaydedildi; doğrudan SQL ile draft revision adı `''` yapıldı (DB kabul etti). `POST /api/plans/:id/draft/publish` **201** döndü ve yanıt `name: ""`, `versionNumber: 1` oldu. Ardından:
  - `GET /api/plans` Planner için **500 INTERNAL_ERROR**;
  - `GET /api/plans` Viewer için **500 INTERNAL_ERROR**;
  - `GET /api/plans/:id` Planner için **500**;
  - `GET /api/plans/:id/versions` 200, boş adlı sürüm.
  Neden: `plans.service.ts:151-155` ve `:617-621` ad falsy ise `throw new Error(...)`; hata tek planla sınırlı değil, tüm liste/detay isteğini düşürüyor.
- Beklenen: `docs/measurement-rules.md:11` plan/adım adı trim sonrası 1–100; P2-06 kabul ölçütü "Boş/geçersiz draft yayımlanmaz" (`docs/tasks/P2-06.md:21`); published içerik immutable olduğu için bu kayıt sonradan normal yolla düzeltilemez.
- Not: Bu duruma API tek başına yol açmıyor; doğrudan SQL veya gelecekteki bir migration/yazma yolu gerekiyor. Ancak P2-06'nın kendi doğrulama yaklaşımı da "saklanmış geçersiz içerik" için doğrudan SQL kullanıyor (31 adım/position testi); aynı standartta ad doğrulaması da publish anında yapılmalı. Ayrıca liste kodu tek bozuk satırda tüm sonucu 500 yapmamalı.

### H-02 — Frontend'de generated DTO'ların yanında elle yazılmış ikinci bir yanıt modeli var

**Önem: High — P2-03/P2-07 kabulünü engeller (teknik sözleşme ihlali).**

- Kanıt:
  - `apps/web/src/app/features/plans/plans-api.ts:31-88`: tüm plan uçları `get<unknown>` / `post<unknown>` ile çağrılıyor; yanıt tipleri generated şemadan alınmıyor.
  - `plans-api.ts:91-332`: `draft`/`openDraft`, `profile`/`deviceProfile`, `latestPublishedVersion`/`latestVersion`, `plans`/`items`/`data`, `plan` sarmalı, `logicalStepIds` gibi sözleşmede olmayan alternatif adlar elle deneniyor.
  - `plans-api.ts:167-190`: eksik `logicalStepId` `''`, eksik `editRevision` `0`, eksik `sampleCount`/`intervalMs` `0`, eksik `minimum`/`maximum` `'0'` olarak uyduruluyor. `readDecimal` (`:426-433`) eksik veya sayısal olmayan değeri `'0'` yapıyor.
  - `plans-api.ts:304-314`: eksik `steps` sessizce `[]` oluyor; published sürüm "0 adımlı" gibi gösterilebilir.
  - `plans-api.types.ts:80-91`: `SaveDraftResult.logicalStepIds` sözleşmede olmayan bir fallback.
  - `plans-api.spec.ts:70-79, 189-208, 403-417`: `{ items }`, `{ plan }` ve `{ plan: { id } }` gibi API'nin hiç üretmediği zarfları test ediyor; sözleşme değişse bile bu testler geçebilir.
- Beklenen: `docs/api.md:131` "Frontend'de elle farklı bir API iş modeli tutulmaz." Generated `components['schemas']` yanıtları doğrudan kullanılmalı; zorunlu alan eksikse istek başarısız olmalı, varsayılan ölçüm değeri/ID uydurulmamalı.
- Etki: Backend alanı yeniden adlandırdığında veya yanıtı bozduğunda UI hata vermek yerine `0` tolerans, boş `logicalStepId` veya boş adım listesiyle çalışmaya devam edebilir. `logicalStepId` kaybı, kaydetmede yeni kimlik üretilmesine ve sürümler arası kimlik sürekliliğinin bozulmasına yol açabilir. Bu, "typed API" ve "generated client" iddiasıyla çelişiyor.

### M-03 — 0 adımlı draft'ta Publish düğmesi etkin; publish geçerliliği UI'da ayrılmamış

**Önem: Medium.**

- Kanıt: `apps/web/src/app/features/plans/plan-editor-page.ts:261-284` `publishBlockReason` dirty/savePending/expectedRevision/form.invalid kontrol ediyor; `stepCount() === 0` kontrolü yok. `:286-288` buna göre disable ediyor. Şablon `plan-editor-page.html:507-520` düğmeyi bu değere bağlıyor; boş durum metni `:248-255` "Publishing requires at least one valid step" diyor.
- Gözlem: Gerçek Chrome'da 0 adımlı draft için `publishDisabled: false`, ipucu "Publishing uses the last saved draft only."; aynı draft için `POST /draft/publish` 400 `VALIDATION_ERROR` (`steps`).
- Beklenen: P2-04 kabul ölçütü "Sıfır adımlı draft kaydı ile Publish geçerliliği ayrıdır" (`docs/tasks/P2-04.md:22`); publish düğmesi boş draftta kapalı ve nedeni açık olmalı.
- Etki: Kullanıcı onay dialogunu açıp sunucu hatası alıyor; veri bozulmuyor ama kabul ölçütü ve beklenen UX karşılanmıyor. Testlerde bu durum yok; `plan-editor-page.spec.ts` yalnız 2 adımlı fixture ile publish akışını test ediyor.

### M-04 — Sürüm sayfası sürümü plana bağlamıyor; eski sürümde "Start new draft" en son sürümü kopyalıyor

**Önem: Medium.**

- Kanıt: `apps/web/src/app/features/plans/plan-version-page.ts:61-62` route parametrelerini snapshot'tan alıyor; `:115-132` sürümü yalnız `versionId` ile, planı `planId` ile yüklüyor; `version.planId === planId` kontrolü yok. `:66-70` yayınlayanı yalnız planın sürüm listesinden eşliyor. `:92-100` yeni draft uygunluğu; `:156-170` `planId` için draft oluşturuyor. Backend `createDraft` her zaman en son published sürümü kopyalıyor (`plans.service.ts:439-443`); şablon `plan-version-page.html:151-165` "copy its ordered steps" diyor.
- Gözlem:
  - Başka planın v1 kimliğiyle `/plans/<plan>/versions/<other-version>` açıldı; sayfa 404 vermedi, sürümü gösterdi, "Publisher unavailable" dedi.
  - Bir planın v1'inde (`maximum 0.500000`) `Start new draft` tıklandı; editör v2 değerlerini (`0.750000`) ve "Version 2" bilgisini yükledi. Kullanıcı sayfada gördüğü sürümün kopyalandığını sanabilir.
- Beklenen: P2-07 kabul ölçütü "Kullanıcı görüntülediği plan ve sürümü açıkça görür" (`docs/tasks/P2-07.md:19`); route planı ile sürümün `planId`'si eşleşmeli, uyuşmazlık 404/NotFound olmalı. Eski sürümde yeni draft eylemi ya gizlenmeli ya da "en son yayımlanmış sürümden kopyalanır" açıkça yazmalı.
- Etki: Yanlış sürüm içeriğiyle düzenlemeye başlama; tüm published sürümler tüm rollere okunabildiği için yeni bir veri sızıntısı değil, fakat kullanıcıyı yanıltan bir doğruluk hatası.

### M-05 — `baseVersionId` plan/state sahipliği veritabanında zorlanmıyor

**Önem: Medium.**

- Kanıt: `apps/api/prisma/schema.prisma:96-97` `baseVersion` yalnız `id`'ye bağlı; `20261103160000_plans/migration.sql:158` FK yalnız `plan_revisions(id)`. `(baseVersionId, planId)` kompozit FK'si ve "base published olmalı" kontrolü yok.
- Gözlem: Geçici veritabanında A planının draft revision'ına B planının published revision kimliği `baseVersionId` olarak yazıldı; DB kabul etti (INSERT 0 1). API bu alanı yalnız `createDraft` içinde aynı planın latest published sürümüne set ediyor; doğrudan SQL veya gelecekteki bir yazma yolu bu invariant'ı bozabilir.
- Beklenen: `docs/data-model.md:37` yeni taslak son yayımlanmış sürümden kopyalanır; P2-01 hedefi "StepIdentity başka plana bağlanamaz" ve revision sahipliğiyle aynı çizgide `baseVersionId` de aynı plana ve published duruma bağlı olmalı.
- Etki: Geçmiş/lineage bilgisi yanlış plana işaret edebilir; şu an API ile üretilemiyor, bu nedenle Medium.

### M-06 — Published veri koruması INSERT ve TRUNCATE'i kapsamıyor; metadata CHECK'leri eksik

**Önem: Medium (savunma katmanı / şema bütünlüğü).**

- Kanıt:
  - `20261103170000_published_immutability/migration.sql:93-97`: `plan_revisions` trigger'ı yalnız `BEFORE UPDATE OR DELETE`; doğrudan `INSERT ... state='PUBLISHED'` engellenmiyor.
  - `20261103160000_plans/migration.sql:113-129`: `plan_revisions.name` için 1–100 kontrolü yok; version numarasının `max+1` olması, `publishedById`'nin Planner olması veya published revision'ın en az bir adım içermesi zorlanmıyor.
  - Satır trigger'ları `TRUNCATE`'te çalışmaz.
- Gözlem (geçici DB):
  - `INSERT` ile `PUBLISHED`, `versionNumber=999`, `publishedById=Viewer`, 0 adım, boş ad: **kabul**.
  - Boş/boşluklu adlı `PUBLISHED` revision: **kabul**.
  - `TRUNCATE plan_steps` ve `TRUNCATE plan_revisions CASCADE`: **başarılı**, published satırlar silindi; UPDATE/DELETE trigger'ları devreye girmedi.
  - Buna karşılık satır bazlı UPDATE/DELETE ve published adıma INSERT/UPDATE/DELETE doğru şekilde reddedildi.
- Beklenen: P2-01/P2-06 "Published revision/step içerikleri API ve DB korumasıyla değişmez"; published metadata geçerli olmalı. P2-06 kartı üretimde API rolünün tablo sahibi olmaması gerektiğini kabul ediyor (`docs/tasks/P2-06.md` son bölüm); bu incelemede geliştirme DB'sinde API rolü tablo sahibi olduğu için trigger'lar `DISABLE TRIGGER`/`TRUNCATE` ile aşılabiliyor.
- Etki: Normal API yolu bu verileri üretmiyor; fakat şema, "doğrudan SQL ile bile published invariant korunur" iddiasını tam karşılamıyor. Özellikle H-01'deki boş ad, bu eksik CHECK'in doğrudan sonucu.

### M-07 — Sign out, kirli editördeki unsaved-changes uyarısını atlıyor

**Önem: Medium (kullanıcı verisi kaybı).**

- Kanıt: `apps/web/src/app/features/plans/unsaved-changes.guard.ts:22-24` hedef `/login` veya `/not-authorized` ise `true` dönüyor. `apps/web/src/app/layout/app-shell/app-shell.ts:142-153` sign out sonrası `router.navigateByUrl('/login')` çağırıyor; `canLeave` çağrılmıyor.
- Gözlem: Kod yolu açık; kirli formda Sign out tıklanırsa `Leave without saving?` dialogu gösterilmeden oturum kapatılıp `/login`'e gidiliyor. (Bu davranış gerçek tarayıcıda ayrıca tıklanmadı; guard'ın `/login` istisnası ve sign-out navigasyonu doğrudan okundu.)
- Beklenen: P2-05 kabul ölçütü "Kaydedilmemiş veri kaybı uyarısı ve başarısız kayıt korunması doğrulanır" (`docs/tasks/P2-05.md`); kullanıcı tarafından başlatılan sign out, oturum süresi dolması gibi kaçınılmaz bir yönlendirme değil.
- Etki: Kaydedilmemiş plan değişiklikleri sessizce kaybolabilir. Oturum expiry/401 yönlendirmesi için istisna savunulabilir; sign out için ayrı ele alınmalı.

### L-08 — Sürüm detayında yayınlayan bilgisi ikinci isteğe bağlı

**Önem: Low.**

- Kanıt: `PublishedRevisionDto` (`apps/api/src/plans/dto/plan-response.dto.ts:121-150`) `publishedBy` taşımıyor; `plan-version-page.ts:66-70` yayınlayanı `GET /plans/:id/versions` yanıtından eşliyor. Liste isteği başarısızsa şablon "Publisher unavailable" gösteriyor (`plan-version-page.html:30-42`).
- Gözlem: Normal akışta yayınlayan görünüyor; sürüm-plan uyuşmazlığında veya liste hatasında görünmüyor.
- Beklenen: P2-07 "yayınlayan e-posta/rol" gösterimi; tek sürüm okuması kendi başına yeterli olmalı. Kart bu bağımlılığı açıkça kabul ediyor; bu nedenle Low.

### L-09 — P2-08 kanıt kaydında çelişkili/tekrarlı alan ve koşullu ölçütler

**Önem: Low (kanıt dürüstlüğü).**

- Kanıt: `docs/tasks/P2-08.md:47` gerçek kanıt bağlantılarını listeliyor; hemen `:48` "Kanıt bağlantıları: Henüz yok." diyor. Kart ayrıca "Yenilemede sıra ve bütün alanlar aynıdır" ve "iki sekme" ölçütlerini `[x]` işaretliyor; iki fiziksel sekme ve gerçek fare drag-drop yapılmadığı kartın kendi notunda belirtiliyor.
- Beklenen: `docs/testing.md:98-100` inceleme yalnız geliştirici özetine dayanmaz; yapılmayan kontrol yapılmış gibi işaretlenmez.
- Etki: Kod davranışını değiştirmiyor; aşama kabulünde kanıt güvenilirliğini zayıflatıyor. P2-08 demo ve API kontrolleri gerçekten çalışmış olsa da fiziksel iki sekme ve fare drag-drop hâlâ doğrulanmamıştır.

### L-10 — Test boşlukları: bulguların bir kısmı yeşil suite'e rağmen yakalanmıyor

**Önem: Low/Medium (test gerçekliği).**

- `plans-api.spec.ts` sözleşme dışı zarfları test ediyor; `plan-editor-page.spec.ts` 0 adımlı publish düğmesini, `plan-version-page.spec.ts` plan/sürüm uyuşmazlığını ve eski sürümden yeni draft davranışını, `unsaved-changes.guard` testleri sign-out yolunu kapsamıyor.
- `plans-schema.e2e-spec.ts` doğrudan `PUBLISHED` revision oluşturuyor (`:135-165, 289-319`) ama boş ad, version 999/Viewer publisher, `baseVersionId` çapraz planı veya `TRUNCATE`'i sınamıyor. Bu nedenle suite yeşilken H-01/M-05/M-06 açık kalıyor.
- Gerçek PostgreSQL/HTTP kullanımı güçlü: e2e testleri mock DB/transaction yerine gerçek PG ve Supertest kullanıyor; bu incelemede de aynı yaklaşım uygulandı.

## 3. Görev bazlı verdict

| Görev | Verdict | Kısa gerekçe |
|---|---|---|
| P2-01 | **PASS with findings** | Tablolar, tek draft/sürüm unique index'leri, kompozit adım FK'leri, CHECK'ler ve migration (boş + Phase 1) doğrulandı. M-05 (baseVersion sahipliği) ve M-06 (metadata/INSERT/TRUNCATE) şema bütünlüğü açıkları. |
| P2-02 | **PASS** | Gerçek HTTP ile 0–30 adım, sıra, sunucu kimlikleri, `steps.N.field`, ondalık/sınırlar, 400/409 atomikliği, eşzamanlı kayıt, rol/CSRF ve draft sızıntısı doğrulandı; bulgu yok. |
| P2-03 | **PASS with findings** | Liste/loading/empty/error, rol görünürlüğü ve create akışı çalışıyor. H-02 (elle yanıt modeli) bu ekranın API sınırını da etkiliyor; kabul engeli. |
| P2-04 | **PASS with findings** | Non-nullable typed form, sınırlar, alan eşleme ve 400/409 koruması iyi. M-03: 0 adımlı draftta Publish etkin; P2-04 kabul ölçütü tam karşılanmıyor. |
| P2-05 | **PASS with findings** | FormArray/DOM/payload sırası, taşınan kontrol durumu, yukarı/aşağı ve odak testleri geçti. M-07 sign-out istisnası; gerçek fare drag-drop doğrulanamadı. |
| P2-06 | **FAIL** | H-01: boş/geçersiz saklanmış plan adı publish edilerek immutable geçersiz sürüm oluşturuyor ve tüm plan listesini 500 yapıyor. M-05/M-06 ek DB bütünlüğü açıkları. Diğer publish/clone/race/immutability davranışları geçti. |
| P2-07 | **PASS with findings** | Publish/409/read-only/0 edit kontrolü ve yeni draft akışı normal yolda çalışıyor. H-02 (elle API modeli), M-04 (plan/sürüm bağlama ve eski sürüm draft'ı), L-08 (yayınlayan bağımlılığı) var. |
| P2-08 | **PASS with findings** | API yaşam döngüsü, demo ve gerçek Chrome kontrolü büyük ölçüde geçti; v1 değişmezliği ve rol reddi doğrulandı. L-09 kanıt çelişkisi; iki fiziksel sekme/fare drag-drop yok; H-01/H-02 düzeltilmeden aşama kabulü yapılamaz. |

**Genel:** Critical bulgu yok. İki High (H-01, H-02) ve beş Medium bulgu kabul öncesi kapatılmalıdır. P2-06 bu haliyle `Accepted` edilemez; P2-03/P2-07'nin "PASS with findings" sonucu H-02 nedeniyle kabul engeli taşır. Bu belge ürün kabulü değildir; nihai kabul kullanıcıdadır.

## 4. Doğrulanamayanlar ve sınırlar

- Gerçek fare sürükle-bırak jesti çalıştırılmadı; yalnız CDK bağlantısı, FormArray sırası, yukarı/aşağı düğmeleri ve payload test edildi. P2-05/P2-08 kanıtları da bunu kabul ediyor.
- İki fiziksel tarayıcı sekmesiyle eşzamanlı stale-revision senaryosu denenmedi; gerçek HTTP 409 ve bileşen testi var.
- Çoklu API süreci ile publish/version ataması denenmedi; sözleşme tek API süreci varsayıyor.
- Üretimde API rolünün tablo sahibi olmaması/deployment rol ayrımı doğrulanmadı; P2-06 bunu kapsam dışı bırakıyor. Geliştirme DB'sinde API rolü tablo sahibi olduğu için `TRUNCATE`/`DISABLE TRIGGER` ile immutability aşılabildi (M-06).
- `npm ci` ve pinned npm `11.6.2` ile temiz kurulum çalıştırılmadı; `npm run verify` sistem npm `10.9.8` ile geçti.
- Root `npm run test:e2e` Playwright suite'i P7-01'e kadar bilinçli olarak başarısız; bu incelemede çağrılmadı. Gerçek tarayıcı kontrolü headless Chrome/CDP ile yapıldı; in-app browser `[browser.disconnected]` olduğu için kullanılamadı.
- OpenAPI/istemci senkronu doğrulandı; ancak H-02'deki elle yanıt modeli OpenAPI şemasıyla uyumlu olmasına rağmen generated response tiplerini kullanmıyor.

## 5. Temizlik ve yeniden üretilebilirlik

- Geçici PostgreSQL veritabanları (`probedesk_review_empty_*`, `probedesk_review_upgrade_*`) inceleme sonunda silindi.
- Geliştirme veritabanında yalnız bu inceleme için oluşturulan 17 plan, adımları, revision'ları ve step identity'leri temizlendi; mevcut demo planlarına (`Power Supply Validation`) dokunulmadı. Temizlik sırasında trigger'lar kısa süre devre dışı bırakıldı ve yeniden etkinleştirildi; `pg_trigger.tgenabled = 'O'` ile doğrulandı.
- Ürün kodu, `apps/`, `packages/`, `scripts/` veya kök konfigürasyon değiştirilmedi; git write komutu çalıştırılmadı. `git status` inceleme sonunda temiz.
