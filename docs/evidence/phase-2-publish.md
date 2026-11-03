# Phase 2 publish, sürüm ve immutable veri kanıtı

- Tarih: 2026-11-03
- Kapsam: P2-06 — atomik Publish, sürüm numarası, yeni draft kopyası, published verinin API ve PostgreSQL koruması.
- Ortam: Node.js 22.23.2; test PostgreSQL 18 `127.0.0.1:5433/probedesk_test`; geliştirme PostgreSQL 18 `127.0.0.1:5434/probedesk`.
- Uygulama commit'i: Bu çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge commit hash'i iddia etmez.
- Kapsam dışı: `packages/api-client` yeniden üretimi (sahiplik lead'de), `docs/tasks/README.md` ve `docs/roadmap.md` durum satırları (lead günceller).

## P2-06 — Publish ve yeni sürüm taslağı

### Uçlar

| Yöntem | Yol | Rol / koruma | Başarı | Davranış |
|---|---|---|---|---|
| POST | `/api/plans/:id/draft/publish` | Planner + CSRF | 201 | `expectedRevision` ile açık taslağı atomik yayımlar; `PublishedRevisionDto` ve adımları döner. |
| POST | `/api/plans/:id/drafts` | Planner + CSRF | 201 | Son yayımlanmış sürümden yeni `DRAFT` kopyası; `editRevision=1`, `baseVersionId` yayımlanmış revision. |
| GET | `/api/plans/:id/versions` | P/O/V | 200 | Yayımlanmış sürümler `versionNumber DESC` sırasıyla; `id`, `versionNumber`, `name`, `publishedAt`, `publishedBy { id, email, role }`. |
| GET | `/api/plan-versions/:id` | P/O/V | 200 | Yalnız `PUBLISHED` revision ve sıralı adımlar; draft veya bilinmeyen id 404. |

OpenAPI şemaları: `PublishDraftDto`, `PublishedVersionListItemDto`, `PublishedBySummaryDto`; yanıtlar mevcut `PublishedRevisionDto` ve `DraftRevisionDto`. `apps/api/openapi.json` yeniden üretildi.

### Publish kuralları ve atomiklik

- Gövde yalnız `expectedRevision` (integer ≥ 1) taşır; eksik/yanlış tip 400 `VALIDATION_ERROR`.
- Plan satırı `SELECT ... FOR UPDATE` ile kilitlenir; açık draft yoksa 409 `DRAFT_CONFLICT` (`NO_OPEN_DRAFT`), `expectedRevision` uyuşmazsa 409 (`details.currentRevision`).
- Yayın öncesi saklanan adımlar yeniden doğrulanır: 1–30 adım, bitişik `position` (1..n), ad 1–100, birim 1–16, ondalık sınırlar, `minimum <= maximum`, `sampleCount` 1–1000, `intervalMs` 100–5000, toplam örnek ≤ 10.000, nominal süre ≤ 600.000 ms. İhlal 400 `VALIDATION_ERROR` ve `steps.N.field` yolu; hiçbir satır yayımlanmaz.
- Sürüm numarası plan kilidi altında `max(versionNumber) + 1` olarak atanır. Veritabanındaki `plan_revisions_planId_versionNumber_key` partial unique index son backstop'tur; eşzamanlı iki publish tek sürüm üretir.
- `updateMany` yalnız `id + planId + state=DRAFT + editRevision` eşleşirse `PUBLISHED`, `versionNumber`, `publishedById`, `publishedAt` yazar. Etkilenen satır 1 değilse işlem 409 ile geri alınır.
- State geçişinden sonra adımlar yeniden okunur; ilk okunan içerikle ad/adım alanları birebir aynı değilse 409 `DRAFT_CHANGED` ile rollback yapılır. Böylece plan kilidini atlayan doğrudan SQL yazımı publish'e karışamaz.
- Publish, `editRevision` değerini değiştirmez; yayımlanan revision'ın kimliği draft'ın kimliğidir.

### Yeni draft kopyası

- Plan kilidi altında açık draft varsa 409 `DRAFT_CONFLICT` (`OPEN_DRAFT_EXISTS`, `currentRevision`) ve ikinci draft oluşturulmaz.
- Yayımlanmış sürüm yoksa 409 `DRAFT_CONFLICT` (`NO_PUBLISHED_VERSION`).
- Kopya, en yüksek `versionNumber` değerine sahip yayımlanmış revision'dan yapılır; `logicalStepId`, `position`, ad, birim, sınırlar, `sampleCount`, `intervalMs` korunur. Yeni revision `DRAFT`, `editRevision=1`, `baseVersionId=<published id>` olur. Draft düzenlemeleri eski sürümü değiştirmez.

### PostgreSQL immutable koruması

`apps/api/prisma/migrations/20261103170000_published_immutability/migration.sql`:

- `plan_revisions` üzerinde `BEFORE UPDATE OR DELETE` trigger: `OLD.state = 'PUBLISHED'` ise her update ve delete reddedilir. `DRAFT -> PUBLISHED` geçişi (publish) ve normal draft güncellemeleri serbesttir.
- `plan_steps` üzerinde `BEFORE INSERT OR UPDATE OR DELETE` trigger: sahibi `PUBLISHED` revision olan insert/update/delete reddedilir; adımın `revisionId` değiştirilmesi hem eski hem yeni revision için kontrol edilir.
- `probedesk_assert_revision_is_draft(uuid)` fonksiyonu revision satırını `FOR SHARE` kilitler. Publish aynı satırı `UPDATE` ettiği için yarış iki şekilde çözülür:
  - doğrudan adım yazımı önce commit ederse publish'in geçiş sonrası yeniden okuması içerik farkını görür ve 409 ile rollback olur;
  - publish geçişi önce kilit alırsa adım yazımı bekler ve commit sonrası `PUBLISHED` görüp reddedilir.
- API save/publish/yeni draft yolları aynı plan satırı kilidini kullandığından uygulama çağrıları birbirinin arasına girmez.
- Published revision/step silme reddedilir; mevcut `ON DELETE RESTRICT` FK'ları tarih silmeyi ayrıca engeller. Cascade delete eklenmedi.
- Test temizliği şema sahibi olarak `ALTER TABLE ... DISABLE TRIGGER USER` kullanır; uygulama bağlantısının böyle bir kaçış yolu yoktur.

Migration hem test hem geliştirme veritabanına uygulandı; `migration-manifest.ts` dört migration'ı listeler ve readiness kontrolü manifest ile `_prisma_migrations` adlarını karşılaştırır.

## Test kapsamı

Yeni `test/plan-publish.e2e-spec.ts` 9 test:

1. Publish başarısı: 201, `versionNumber=1`, yayınlayan/zaman DB'de, draft kapanır, detay yayımlanmış içeriği döner.
2. Boş draft, eksik/0/string `expectedRevision`, stale revision, bilinmeyen plan, geçersiz saklanmış `position` reddi ve hiç publish olmaması.
3. Saklanmış 31 adımın publish anında 400 ile reddi.
4. Eşzamanlı iki publish: `[201, 409]`, tek yayımlanmış sürüm, `versionNumber=1`, açık draft kalmaması.
5. Yeni draft kopyası: `baseVersionId`, `editRevision=1`, `logicalStepId`/adım alanları korunur; ikinci draft 409; kopyanın düzenlenmesi v1'i değiştirmez; v2 publish `versionNumber=2`; liste `[2, 1]`.
6. P/O/V sürüm listesi ve detay erişimi, `publishedBy` özetinde sır olmaması, draft id ile `/plan-versions/:id` 404, draft-only planın O/V için 404, Planner için boş liste, rol/CSRF reddi.
7. Doğrudan SQL ile published revision update/delete ve published step update/delete/insert reddi; satırların değişmemesi.
8. Publish ile aynı `expectedRevision` kullanan eşzamanlı save: biri başarılı, diğeri 409; DB'de tek tutarlı sonuç.
9. Doğrudan SQL adım insert'i revision satırını `FOR SHARE` ile tutarken publish bekletilir; insert commit edince publish 409 `DRAFT_CHANGED` ile rollback olur, draft iki adımlı kalır ve published sürüm oluşmaz.

Mevcut 76 e2e testi korunarak toplam 85 test geçti. `plans.e2e-spec.ts` fixture'ı published revision'ı artık önce `DRAFT` olarak oluşturup adımları ekledikten sonra `PUBLISHED`'a geçiriyor; doğrudan published revision'a adım eklenmesi yeni trigger tarafından reddedildiği için bu gerekliydi. `plans-schema.e2e-spec.ts` de aynı nedenle kimlik koruma testini draft üzerinden kurup sonra publish ediyor.

## Çalıştırılan kontroller (gerçek çıktılar)

Aşağıdaki komutlar kodun son hali üzerinde sırayla çalıştırıldı.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 328ms on 83 files with 107 rules using 8 threads.

$ npm run typecheck --workspace apps/api
tsc --noEmit -p tsconfig.json
(çıkış kodu 0; hata yok)

$ npm run test --workspace apps/api
Test Files  9 passed (9)
Tests       43 passed (43)

$ npm run db:migrate:test --workspace apps/api
4 migrations found in prisma/migrations
No pending migrations to apply.

$ npm run test:e2e --workspace apps/api
Test Files  10 passed (10)
Tests       85 passed (85)
Duration    10.46s

$ npm run build --workspace apps/api
nest build
(çıkış kodu 0; hata yok)

$ npm run openapi:emit --workspace apps/api
Wrote OpenAPI document to /Users/kemalselcuk/.t3/projects/probedesk/apps/api/openapi.json
```

Ek doğrulamalar:

```text
$ npx vitest run --config ./vitest.config.e2e.ts test/plan-publish.e2e-spec.ts
Test Files  1 passed (1)
Tests       9 passed (9)

$ npx vitest run --config ./vitest.config.e2e.ts test/openapi.e2e-spec.ts
Test Files  1 passed (1)
Tests       3 passed (3)

$ npm run db:migrate --workspace apps/api
Datasource "db": PostgreSQL database "probedesk", schema "public" at "127.0.0.1:5434"
Applying migration `20261103170000_published_immutability`
All migrations have been successfully applied.
```

## Değişen dosyalar

- `apps/api/prisma/migrations/20261103170000_published_immutability/migration.sql` (yeni)
- `apps/api/src/prisma/migration-manifest.ts`
- `apps/api/src/plans/plans.service.ts`
- `apps/api/src/plans/plans.controller.ts`
- `apps/api/src/plans/plan-versions.controller.ts` (yeni)
- `apps/api/src/plans/plans.module.ts`
- `apps/api/src/plans/plan-limits.ts`
- `apps/api/src/plans/dto/plan-response.dto.ts`
- `apps/api/src/plans/dto/publish-draft.dto.ts` (yeni)
- `apps/api/test/plan-publish.e2e-spec.ts` (yeni)
- `apps/api/test/plans.e2e-spec.ts`, `apps/api/test/plans-schema.e2e-spec.ts`, `apps/api/test/support/plan-helpers.ts`
- `apps/api/test/openapi.e2e-spec.ts`
- `apps/api/openapi.json`
- `apps/api/README.md`
- `docs/tasks/P2-06.md`, bu kanıt belgesi

## Açık riskler ve ertelenen işler

- `packages/api-client` bu görevin sahipliğinde olmadığı için yeniden üretilmedi; yeni DTO'lar istemci paketine lead tarafından aktarılmalı. Kök `npm run openapi:check` bu nedenle çalıştırılmadı.
- Immutability trigger'ları şema sahibi tarafından `DISABLE TRIGGER` ile devre dışı bırakılabilir; bu yalnız test temizliğinde kullanılır. Üretimde API rolünün tablo sahibi olmaması gerekir; deployment rol ayrımı bu görevin kapsamı dışındadır.
- Publish ile doğrudan SQL yazımı arasındaki yarış testi gerçek PostgreSQL kilit beklemesiyle doğrulandı; yine de çoklu API süreci bu sözleşmenin parçası değildir (tek API süreci varsayımı korunur).
- Bağımsız teknik inceleme yapılmadı; görev `In Review` durumundadır ve Accepted değildir.
- Aşama demosu ve nihai kabul ayrıca yapılmalıdır.
