# EX-07 — Bağımsız frontend kod incelemesi

- Tarih: 2026-11-06.
- İnceleyen: bağımsız review sub-agent (UI düzenlemesi yapmadı; yalnız bu dosya yazıldı).
- Kapsam: EX-07 plan kopyalama frontend delta'sı. EX-06 API implementasyonunun bağımsız kabulü başka
  review'a aittir; burada yalnız frontend'in sözleşmeye uyumu için okundu. Devices/seed/AppModule
  değişiklikleri kapsam dışıdır (başka worker sahipliği).
- Sözleşme: `docs/feature-pack-1-plan.md` §5.2, §8 (Plan kopyalama), §11; `docs/tasks/EX-07.md`;
  `docs/evidence/feature-pack-1/ex-07.md`; `AGENTS.md`; `docs/implementation-guide.md`.

## Gerçek durum ve commit'ler

- Brief'te verilen `b58f1228d27d747c573efa238f7b708760329bbf` inceleme sırasında güncel HEAD
  değildi. Lead frontend'i commitledi; inceleme fiilen
  **`db235e1c457f21fef02aa9eb3fe14b4e8c9f9162` — feat: copy published plans through an independent
  draft dialog** üzerinde yapıldı. Çalışma ağacı bu review dosyası yazılmadan önce temizdi.
- Frontend delta'sı `db235e1` içinde; commit sırası
  `b58f122` → `9efbcb2b30c7891861ab16fb0a057d65c9f4a9c0` (devices + ortak generated contract) →
  `db235e1` şeklindedir.
- Ortak generated OpenAPI/client şu anda **`9efbcb2`** ile commitlidir ve hem `CopyPlanDto` /
  `CopyPlanResponseDto` hem Devices şemalarını içerir. Brief'teki "generated dosyalar ortak commit
  bekliyor" koşulu bu commit ile karşılanmıştır.
- API copy implementasyonu `7195ad4` yalnızca sözleşme uyumu için okundu: 201 yeni / 200 replay,
  Planner+CSRF, trim/name, kullanıcı-kapsamlı `Idempotency-Key`, response alanları.

## İncelenen dosyalar

Yeni:

- `apps/web/src/app/features/plans/copy-plan-button.ts`
- `apps/web/src/app/features/plans/copy-plan-dialog.ts`
- `apps/web/src/app/features/plans/plan-copy.facade.ts`
- `apps/web/src/app/features/plans/plan-copy.spec.ts`

Değişen:

- `apps/web/src/app/features/plans/plans-api.ts`
- `apps/web/src/app/features/plans/plans-api.types.ts`
- `apps/web/src/app/features/plans/plans-list-page.ts`
- `apps/web/src/app/features/plans/plans-list-page.html`
- `apps/web/src/app/features/plans/plans-list-page.scss`
- `apps/web/src/app/features/plans/plan-version-page.ts`
- `apps/web/src/app/features/plans/plan-version-page.html`

Sözleşme/üretilmiş dosyalar:

- `apps/api/openapi.json` ve `packages/api-client/src/schema.ts` (copy şemaları; `9efbcb2`).
- `apps/web/src/styles/_tokens.scss`, `_data-tables.scss`, `_primitives.scss` (token/geometri
  doğrulaması).

## Çalıştırılan komutlar ve gerçek sonuçlar

Bu incelemede gerçekten çalıştırılanlar:

```text
npm run test --workspace apps/web -- --watch=false \
  --include=src/app/features/plans/plan-copy.spec.ts
→ 1 dosya / 6 test geçti, 1.23s, exit0

npm run test --workspace apps/web -- --watch=false \
  --include=src/app/features/plans/plans-list-page.spec.ts \
  --include=src/app/features/plans/plan-version-page.spec.ts
→ 2 dosya / 19 test geçti, 1.64s, exit0

npm run typecheck --workspace apps/web
→ exit0

npm run openapi:check
→ "OpenAPI contract is current: apps/api/openapi.json and
   packages/api-client/src/schema.ts match the application.", exit0

git diff --check b58f122..HEAD
→ exit0

git status --short
→ boş (inceleme sırasında çalışma ağacı temiz)
```

Root tarafından bildirilen, bu incelemede tekrar koşulmayanlar:

- `npm run test:web`: 38 dosya / 393 test geçti, exit0.
- `npm run lint --workspace apps/web`: 121 dosya, 0 warning / 0 error, exit0.
- `npm run build --workspace apps/web`: exit0, initial 352.49 kB, bütçe hatası yok.

Web tarayıcı, görsel, print/PDF ve gerçek 1440/1280/768/390 / %200 zoom kontrolleri bu görevde
yapılmadı; EX-12 bütünleşik senaryosuna bırakıldı. Bu dosyada browser doğrulaması iddia
edilmemektedir.

## Kabul ölçütleri değerlendirmesi

| Ölçüt | Sonuç | Kanıt / not |
| --- | --- | --- |
| Liste/versiyon eylemi kaynak sürümü açıklar ve typed ad dialogu sunar | Kod düzeyinde karşılandı | Listede `latestPublishedVersion.id`, versiyon sayfasında route `versionId` dialog'a verilir; dialog `GET /api/plan-versions/:id` ile gerçek published kaydı yükler (`copy-plan-dialog.ts:141`, `copy-plan-button.ts:62-68`). Parser `state === 'PUBLISHED'` ve integer `versionNumber` doğrular (`plans-api.ts:234-256`). Dialog kaynak adı + sürümü gösterir (`copy-plan-dialog.ts:40-43`). |
| Hata girdiyi korur; aynı retry key; başarılı kopya yeni editora geçer | Kod düzeyinde karşılandı | Network/500 hata testleri input'u koruyor ve aynı key ile retry'ı doğruluyor (`plan-copy.spec.ts:48-64,147-186`). Pending'de duplicate submit engelli (`plan-copy.facade.ts:44-53`), Cancel/backdrop/Escape `disableClose` ile kapatılıyor (`copy-plan-dialog.ts:146-148`). Başarı `result.planId` ile `/plans/:id/edit`'e gider (`copy-plan-button.ts:71-77`). |
| Create new version ile bağımsız kopya ayrımı açık; role/draft sızıntısı yok | Kod düzeyinde karşılandı | Liste action kolonu yalnız Planner'da (`plans-list-page.html:149-207`); versiyon sayfası copy düğmesi yalnız `isPlanner()` + yüklenmiş + plan uyumlu ise görünür (`plan-version-page.html:11-13`). Dialog metni bağımsız draft ve değişmeyen kaynak geçmişini açıklar (`copy-plan-dialog.ts:44-47`). Kaynak parser'ı draft'ı reddeder; list data'sı draft adı yerine published version id kullanır. API ayrıca Planner+CSRF zorlar (`7195ad4`). |

Not: Üçüncü ölçütteki "kaynak yalnızca URL'deki published sürüm" garantisi için aşağıdaki **B2**
source-identity doğrulama boşluğu ve **B3** hedef-bağımsızlık doğrulama boşluğu savunma derinliği
olarak açıktır; normal API davranışında akış doğrudur.

Sözleşme tipleri: `plans-api.types.ts` içindeki `CopyPlanRequest` / `CopyPlanResponse`, generated
`components['schemas']['CopyPlanDto']` / `CopyPlanResponseDto` doğrudan alias'larıdır; ekranlar
ikinci bir hand-written API modeli tutmaz. Request typed, response runtime parser'dan geçer; alan
eksikliği/biçim hatası `MALFORMED_API_RESPONSE` olur. Generated şema `9efbcb2` içinde ve
`openapi:check` güncel.

UI token/geometri: Dialog ve liste action stillerinde kullanılan `--pd-space-2`, `--pd-space-3`,
`--pd-related-gap`, `--pd-danger`, `--pd-danger-bg`, `--pd-radius-control`, `--pd-font-body-size`,
`--pd-font-body-relaxed-line` ve `--pd-font-meta-size` `_tokens.scss` içinde tanımlıdır; yeni global
token eklenmemiştir. Liste action kolonu için sayfa SCSS'inde 11rem override vardır; tablo
`.table-scroll` içinde yatay kayar, sayfa gövdesine taşma yolu görünmemektedir. Gerçek 390/768 ve
%200 zoom yerleşimi EX-12 kanıtına bağlıdır (aşağıdaki başlık).

## Bulgular

### B1 — Düşük — Liste satırındaki ikon düğmelerinin erişilebilir adı bağlamsız

- Yer: `apps/web/src/app/features/plans/copy-plan-button.ts:20-41` (özellikle `aria-label`/`title`
  satırları 26-27) ve `apps/web/src/app/features/plans/plans-list-page.html:197-205`.
- Durum: Her plan satırında aynı "Copy as new plan" erişilebilir adı ve tooltip'i var. Plan adı
  satırdaki `<td>` içinde (row header değil). Ekran okuyucunun düğme listesinde birden fazla aynı
  ad görünür; hangi planın hangi sürümünün kopyalanacağı düğme adından anlaşılmaz. Görsel kullanıcı
  satır bağlamını görür, ekran okuyucu kullanıcısı görmez.
- Öneri: `CopyPlanButton`'a `planName` ve `versionNumber` (veya hazır `accessibleLabel`) input'u
  ekleyip `aria-label="Copy version 2 of Thermal plan as new plan"` üret; alternatif olarak satır
  plan adına `id` verip `aria-describedby` ile bağla. SVG'ye diğer ikonlarla tutarlı
  `focusable="false"` ekle.
- Sınıflandırma: a11y iyileştirmesi; EX-07 kabulünü tek başına engellemez.

### B2 — Düşük — Dialog, GET kaynağının kimliğini istenen sürümle doğrulamıyor

- Yer: `apps/web/src/app/features/plans/plan-copy.facade.ts:21-37,44-55`;
  `apps/web/src/app/features/plans/plans-api.ts:131-137` ve `44-64`.
- Durum: `loadSource(versionId)` istenen id ile GET yapar, ancak dönen `source.id`'yi istenen
  `versionId` ile karşılaştırmaz. `submit` copy'yi `source.id` ile çağırır. `PlansApi.copyPlan`
  yanıtın `sourceVersionId`'sini **copyPlan'a verilen** id ile karşılaştırır; bu id `source.id`
  olduğundan, GET farklı bir yayımlanmış sürüm döndürürse karşılaştırma yine geçer. Sözleşme §5.2
  kaynağın URL'deki published sürüm olmasını ister.
- Etki: Bozuk/regrese bir GET yanıtı, kullanıcının tıkladığı sürüm yerine başka bir published
  sürümü sessizce kopyalayabilir. Normal API davranışında gerçekleşmez; sınır doğrulaması eksiktir.
- Öneri: Facade istenen `versionId`'yi saklasın; `source.id === versionId` değilse
  `MALFORMED_API_RESPONSE` üretsin ve copy POST göndermesin. `PlansApi.getVersion` de yanıt
  `id`'sini istenen id ile doğrulasın; versiyon sayfasındaki `versionPlanMismatch` yanında sürüm
  kimliği de kontrol edilsin. Test: GET farklı id döndürürse dialog hata verir, copy isteği yoktur.

### B3 — Düşük — Copy yanıtı, hedef planın kaynaktan bağımsız olduğunu doğrulamıyor

- Yer: `apps/web/src/app/features/plans/plans-api.ts:45-64`;
  `apps/web/src/app/features/plans/plan-copy.facade.ts:58-61`;
  `apps/web/src/app/features/plans/copy-plan-button.ts:71-77`.
- Durum: Parser `planId`, `draftRevisionId`, `sourceVersionId` için UUID biçimi, `replayed` boolean
  ve `sourceVersionId` eşleşmesini doğrular. Ancak `planId === source.planId` veya
  `draftRevisionId === source.id` gibi sözleşmeye aykırı ama biçimsel olarak geçerli bir yanıtı
  reddetmez. Facade `source.planId`'yi bildiği hâlde bu karşılaştırmayı yapmaz.
- Etki: Bozuk bir 201/200 yanıtı kaynak planın id'sini döndürürse UI başarı gösterip
  `/plans/<sourcePlanId>/edit`'e gider; yeni bağımsız kopya açılmamış olur. Bu, "malformed response
  no false navigation" ve "bağımsız kopya" beklentisiyle çelişir.
- Öneri: Facade'da `result.planId !== source.planId` ve gerekiyorsa
  `result.draftRevisionId !== source.id` / `result.planId !== result.draftRevisionId` kontrolleri
  yapılsın; hata normal `MALFORMED_API_RESPONSE` yoluna düşsün. Test: `{...RESPONSE,
  planId: SOURCE.planId}` yanıtı navigation üretmemeli.
- Not: Backend `7195ad4` yeni plan/draft kimlikleri üretiyor; bu bulgu yalnız bozuk/regrese yanıt
  savunmasıdır, normal akış hatası değildir.

### B4 — Orta — Dialog route/component yıkımında kapanmıyor; başarılı sonuç ve key kaybolabiliyor

- Yer: `apps/web/src/app/features/plans/copy-plan-button.ts:58-78` (özellikle
  `afterClosed().pipe(takeUntilDestroyed(this.destroyRef))` satırları 69-77);
  `apps/web/src/app/features/plans/copy-plan-dialog.ts:146-152`.
- Durum: `MatDialog` overlay'i router-outlet dışında yaşar; dialog `viewContainerRef` olmadan
  açıldığı için sayfa/buton destroy olduğunda dialog otomatik kapanmaz. `afterClosed` aboneliği
  butonun `DestroyRef`'ine bağlıdır. Pending sırasında `disableClose` yalnız Escape/backdrop'u
  engeller; browser Back veya 401 oturum yönlendirmesiyle route değişirse dialog açık kalır.
- Etki: Copy isteği sunucuda başarılı olur, `CopyPlanDialog` result effect'i ile kendini kapatır,
  ama `afterClosed` abonesi sayfa destroy olduğu için yoktur: başarı notification'ı ve yeni editor
  navigation'ı çalışmaz; plan sessizce oluşur. Kullanıcı yeniden dialog açarsa yeni facade yeni key
  üretir (`plan-copy.facade.ts:19,49-51`); ilk istek commit olduysa ikinci bir plan oluşabilir. Bu,
  §5.2'deki "belirsiz yanıtta aynı key" ve kabuldeki "başarılı kopya yeni editora geçer"
  beklentilerini koşullu bir senaryoda bozar.
- Öneri: Pending copy state'ini route-bağımsız bir servise taşı veya pending sırasında route
  navigation'ını engelle; en azından host destroy'da dialogu kapatıp sonucu kullanıcıya bildir.
  Route change/back sırasında dialog sayısı, afterClosed sonucu ve navigation için test ekle.
- Sınıflandırma: Kod düzeyi yaşam döngüsü bulgusu; browser görsel kontrolüyle kapanmaz, ancak normal
  mutlu yol testlerinde görünmez. EX-07 kabulünden önce düzeltilmesi veya bilinçli risk olarak kabul
  edilmesi önerilir.

### B5 — Düşük — 100 karakterlik varsayılan ad surrogate çiftini bölebilir

- Yer: `apps/web/src/app/features/plans/copy-plan-dialog.ts:142-145` (özellikle
  `source.name.slice(0, 93)`).
- Durum: `slice` UTF-16 code unit'i ile keser. Kaynak adının 93. sınırında astral bir karakter
  (emoji vb.) varsa lone surrogate oluşur; input/JSON/PostgreSQL katmanında bozuk veya değiştirilmiş
  bir ad görünebilir. Test yalnız ASCII `'x'.repeat(100)` kullanıyor
  (`plan-copy.spec.ts:188-203`).
- Öneri: `Array.from(source.name).slice(0, 93).join('')` veya grapheme-aware truncation kullan;
  emoji/surrogate sınırı testi ekle. 100 karakter sınırı korunmalı.

### B6 — Düşük — `PlanVersionPage` sınıf yorumu artık yanlış

- Yer: `apps/web/src/app/features/plans/plan-version-page.ts:27-33`.
- Durum: Yorum "The only write action is 'Start new draft' for a Planner" diyor; yeni
  `Copy as new plan` eylemi de yeni plan/draft oluşturan bir write action'dır. Davranış hatası
  değil, bakım/yanlış dokümantasyon.
- Öneri: Yorumu copy eylemini de kapsayacak şekilde güncelle.

### B7 — Düşük — EX-07 kanıtı kendi içinde çelişkili

- Yer: `docs/evidence/feature-pack-1/ex-07.md:17` ve `:24`.
- Durum: 17. satır ortak generated dosyaların entegrasyon commit'ini beklediğini söyler; 24. satır
  aynı dosyada `9efbcb2` ile push edildiğini söyler. İnceleme sırasında gerçek durum `9efbcb2`'dir
  ve `npm run openapi:check` geçmiştir. 17. satır güncellenmeli; ayrıca full 393/lint/build
  sonuçlarının root tarafından bildirildiği, bu review'da tekrar koşulmadığı açık kalmalıdır.
- Öneri: Kanıt metnini güncel commit ve gerçekten koşulan komutlarla hizala.

### B8 — Düşük — Test boşlukları

- Yer: `apps/web/src/app/features/plans/plan-copy.spec.ts` ve mevcut
  `plans-list-page.spec.ts` / `plan-version-page.spec.ts`.
- Kapsananlar: retry key, değişen istek/new key, pending duplicate, malformed copy identity,
  source reload, input koruma, başarı navigation, 100 karakter/boş/aşırı ad.
- Eksikler:
  - Cancel/Escape/focus return ve B4'teki route/component destroy senaryosu.
  - Liste ve versiyon sayfasında copy düğmesinin Planner'da görünüp Operator/Viewer'da
    görünmemesi; draft-only planda hiç görünmemesi. Mevcut spec'ler yeni düğmeyi assert etmiyor.
  - GET source id mismatch (B2) ve `result.planId === source.planId` (B3).
  - `http.expectOne(COPY_URL)` isteğin metodunun `POST` olduğunu ayrıca doğrulamıyor.
- Öneri: En az B2/B3 ve role-embedding testleri eklenmeli; B4 için route change testi.

## Kapsam dışı gözlem (mevcut, EX-07 delta'sına ait değil)

### O1 — Orta (mevcut) — Versiyon sayfası route param snapshot'ını bir kez okuyor

- Yer: `apps/web/src/app/features/plans/plan-version-page.ts:60-61` (constructor'da
  `route.snapshot.paramMap`), `apps/web/src/app/app.routes.ts:37-43` (tek route config),
  `apps/web/src/app/features/plans/plan-version-page.html:286-313` (version history linkleri).
- Durum: Angular'ın varsayılan `RouteReuseStrategy`'si aynı `routeConfig` için component'i yeniden
  kullanır. Version history linki aynı route config'te farklı `versionId`'ye giderse component
  yeniden yaratılmayabilir; `versionId`/`planId` alanları eski kalır. Bu, EX-07 tarafından
  eklenmedi; ancak yeni copy düğmesi de aynı alanı kullandığı için version history/back-forward
  sonrası kopya kaynağı eski sürüm olabilir.
- Öneri: `route.paramMap` subscription veya `withComponentInputBinding`/component input ile
  parametreleri güncelle; version history linki, back/forward ve copy source için test ekle. Bu
  ayrı bir kart olarak izlenmeli; EX-07 delta kabulünü tek başına engellemez, ancak EX-12 browser
  senaryosunda version history/back-forward ile copy kaynağı doğrulanmalıdır.

## EX-12'ye kalan görsel/etkileşim doğrulaması

Bu başlık kod blokerı değildir; gerçek browser/görsel kanıt borcudur:

- 1440, 1280, 768 ve 390 px'de liste action kolonu (11rem), edit + copy ikonunun yan yana
  taşmaması, tablonun yalnız kendi `.table-scroll` kapsayıcısında kayması.
- Dialog 390 px ve %200 zoom: 32rem/max-width, `mat-dialog-content`'in form sarmalı içinde
  scroll/padding davranışı, uzun 100 karakter kaynak adı ve uzun `requestId` satır kırılması.
- Klavye: dialog açılış odağı, Tab sırası, Escape (pending değilken), pending sırasında
  Escape/backdrop/Cancel engeli, iptal sonrası odağın copy düğmesine dönmesi.
- Version history / browser back-forward sonrası copy kaynağının gösterilen sürümle aynı olması
  (O1).
- Liste/versiyon sayfasında Planner dışı rollerde copy eyleminin görünmemesi; draft-only planda
  eylem olmaması.

## Sonuç ve kabul önerisi

- **Kritik: 0. Yüksek: 0. Orta: 1 (B4). Düşük: 7 (B1, B2, B3, B5, B6, B7, B8).** Kapsam dışı
  mevcut O1 ayrıca Orta olarak not edildi; EX-07 delta'sına ait değildir.
- EX-07 frontend delta'sı işlevsel olarak sözleşmenin ana akışını karşılıyor: gerçek published
  kaynak, typed form, pending/duplicate/close koruması, aynı key retry, değişen istekte yeni key,
  input koruma, malformed copy identity reddi, başarı navigation'ı ve Planner rol sınırı kod
  düzeyinde doğru.
- **Kabul önerisi: koşullu olumlu.** Koşullar:
  1. **B4** düzeltilmeli veya bilinçli risk olarak kabul edilmeli; aksi hâlde route değişimi
     sırasında başarılı copy sessiz kalabilir ve yeniden deneme ikinci plan oluşturabilir.
  2. **EX-06 bağımsız review'u kabul edilmeli** (EX-07 kart bağımlılığı); bu dosya EX-06 API
     kodunu bağımsız kabul etmez.
  3. **EX-12 gerçek browser/görsel/klavye/390/%200** kontrolleri tamamlanmalı; bu incelemede
     browser doğrulaması yoktur. Özellikle version history/back-forward copy kaynağı (O1)
     doğrulanmalı.
  4. B2/B3 sınır doğrulamaları ve B1 erişilebilir ad düzeltmesi önerilir; B5/B6/B7/B8 düşük
     bakım/kanıt/test kalemleridir.
- Ortak generated artifact koşulu `9efbcb2` ile karşılanmıştır; `npm run openapi:check` exit0.
  Frontend commit'i bu generated commit olmadan tek başına taşınırsa `CopyPlanDto` tipleri
  kaybolur ve typecheck kırılır.
- Bu inceleme **kart durumunu değiştirmedi**; EX-07 `In Review` kalır. `Accepted` kararı lead'in
  ayrı işlemidir ve yukarıdaki koşullar kapanmadan verilmemelidir.
