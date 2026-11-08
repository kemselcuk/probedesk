# EX-06 — Bağımsız teknik inceleme (Yayımlanmış plandan bağımsız kopya API)

- Tarih: 2026-11-06
- İnceleme commit'i: `7195ad4c1f7aac4c65ab4180f4263ef0d1ea0e20` (`feat: copy published plans into independent drafts idempotently`)
- İnceleme başlangıcındaki HEAD: `b58f1228d27d747c573efa238f7b708760329bbf`
- İnceleme sonundaki HEAD: `db235e1c457f21fef02aa9eb3fe14b4e8c9f9162` (`feat: copy published plans through an independent draft dialog`)
- Branch: `feat/analytics-reporting-devices`
- İnceleme türü: **Bağımsız kod/API/test incelemesi.** Ürün kabulü, kullanıcı kabulü veya
  yayın kararı değildir.
- Kapsam: `7195ad4` içindeki `PlanCopyService`, copy DTO'ları, controller/module bağlantısı,
  `plan-copy.e2e-spec.ts` ve helper; ayrıca plan §4.3, §5.2, §11, EX-06 kartı/kanıtı ve
  nihai HEAD'deki ortak OpenAPI/client entegrasyonu.
- Kısıt: İnceleme sırasında repository içinde yalnızca bu review dosyası eklendi;
  kaynak/doküman dosyaları değiştirilmedi. `git add`,
  `git commit`, `git push`, `git checkout`, `git reset` veya `git stash` çalıştırılmadı;
  subagent başlatılmadı. Başka worker'a ait `devices/`, `seed/` ve `AppModule` dosyaları
  düzenlenmedi. İnceleme sırasında Device ve frontend entegrasyon commit'leri geldi
  (`9efbcb2`, `db235e1`); API implementasyonu `7195ad4` olarak değişmeden kaldı.

## Sonuç özeti

| Alan                                 | Sonuç                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published source → yeni plan/draft   | **Geçti.** Yalnız `PUBLISHED` kaynak okunuyor; draft/unknown kaynak 404.                                                                                                     |
| Scalar değer, sıra ve decimal koruma | **Geçti.** `position, name, unit, minimum, maximum, sampleCount, intervalMs` birebir; negatif/küçük/büyük decimal örnekleri gerçek PG'de korunuyor.                          |
| Yeni kimlikler                       | **Geçti.** Plan, draft revision, `PlanStep.id` ve bütün `logicalStepId`/`StepIdentity` kimlikleri yeni; kaynak kimlikleriyle çakışmıyor.                                     |
| Kaynak değişmezliği                  | **Geçti (kanıt sınırı L-1).** Kaynak revision/adımlar API ve DB parmak iziyle aynı; run sayısı değişmiyor. Gerçek source-run fingerprint fixture'ı yok.                      |
| Idempotency/replay/conflict          | **Geçti.** Kullanıcıya scope'lu key; aynı istek 200 replay; farklı ad/kaynak 409 `IDEMPOTENCY_CONFLICT`; başka kullanıcı aynı key ile yeni hedef alıyor.                     |
| Eşzamanlılık                         | **Geçti.** Gerçek iki HTTP isteğiyle 200/201, tek plan/revision/copy-request; kaybeden transaction orphan bırakmıyor. Test dalı deterministik zorlamıyor (L-2).              |
| Rollback                             | **Geçti.** `plan_copy_requests` insert'inde zorlanan hata sonrası plan/revision/step/copy satırı kalmıyor; aynı key ile retry 201.                                           |
| Rol/CSRF/validation                  | **Geçti.** Planner zorunlu; Operator/Viewer 403; CSRF'siz 403; oturumsuz 401; eksik/blank/uzun key, eksik/blank/uzun/yanlış tip ad, unknown field ve bozuk UUID 400.         |
| Yanıt ve OpenAPI                     | **Geçti.** 201/200 ayrımı, dört alanlı yanıt, hata kodları ve OpenAPI operation/şemaları doğru. Ortak artifact'lar artık HEAD'de commit'li ve emitter/istemci ile eşleşiyor. |
| Testlerin anlamlılığı                | **Yeterli.** Gerçek HTTP + gerçek PostgreSQL; DB kısıtı/transaction davranışı mock'lanmamış. Reviewer hedefli 2 dosya/9 testi bağımsız koştu.                                |
| Öneri                                | **Teknik kabul önerilir; kritik/yüksek/orta açık bulgu yok.** L-1 EX-12 kapsamında kapanmalı; L-2 opsiyonel test güçlendirmesidir.                                           |

## Ortak entegrasyon durumu

İnceleme başlangıcında HEAD `b58f122` idi ve ortak `apps/api/openapi.json` ile
`packages/api-client/src/schema.ts` yalnız çalışma ağacında copy path'ini içeriyordu; temiz
checkout'ta `openapi:check` drift üretirdi. İnceleme sırasında gelen `9efbcb2` commit'i Device
API'siyle birlikte OpenAPI/client artifact'larını ve path listesini commit etti; `db235e1` copy
frontend'ini ekledi. Nihai HEAD'de:

- Commit'li `apps/api/openapi.json` içinde `/api/plan-versions/{id}/copy` vardır; operation
  `session` + `csrfToken` security, zorunlu `Idempotency-Key`, 200/201/400/401/403/404/409
  yanıtları ve `CopyPlanDto`/`CopyPlanResponseDto` şemalarıyla eşleşir.
- Commit'li `packages/api-client/src/schema.ts` içinde `PlanVersionsController_copy` vardır.
- Read-only emitter karşılaştırması `OPENAPI_DOCUMENT_MATCH` (exit 0), `openapi-typescript`
  çıktısıyla client karşılaştırması `CLIENT_SCHEMA_MATCH` verdi.

`npm run openapi:check` komutu artifact'ları yeniden yazdığı için reviewer tarafından
çalıştırılmadı; bunun yerine aynı karşılaştırma bellekte/temp dosyada read-only yapıldı. Lead'in
`openapi:check` exit 0 kaydı ayrıca devralınan kanıt olarak duruyor. **Açık ortak entegrasyon
önkoşulu kalmadı.**

## Bulgular

### L-1 — Düşük: Kaynak run fingerprint fixture'ı yok; test yalnız run sayısını kontrol ediyor

**Konum:**

- `apps/api/src/plans/plan-copy.service.ts:59-125`: kaynak yalnız `planRevision.findFirst` ile
  okunuyor; yazılan satırlar yeni `test_plan`, `plan_revision`, `step_identity`, `plan_step` ve
  `plan_copy_request`.
- `apps/api/test/plan-copy.e2e-spec.ts:338-340` ve `:470-472`: kaynak run sayısı alınıp
  karşılaştırılıyor; snapshot/measurement/event/hash parmak izi karşılaştırılmıyor.
- `docs/feature-pack-1-plan.md:314` (§11): kopyalamada “kaynak unchanged” ve izolasyon
  satırında gerçek run temizliği isteniyor.

**Gerçek durum:** Test, kaynak revision'ın adı/state/version/publishedAt ve bütün adım
satırlarını API + DB düzeyinde önce/sonra karşılaştırıyor; kaynak run sayısının değişmediğini
doğruluyor. Gerçek bir source run'ın `snapshot`, ölçüm, event ve idempotency/hash içeriği
parmak izi olarak alınmıyor. Ancak copy servisinin `test_runs`, ölçüm veya event tablolarına
yazan hiçbir yolu yok; kaynak revision/adımlar da DB immutability trigger'larıyla korunuyor.
Bu nedenle **gerçek kod riski düşüktür**; eksik olan, uçtan uca senaryoda kanıtın kendisidir.

**Somut başarısızlık:** Gözlenen bir kaynak mutasyonu yok. Bu bir davranış hatası değil, kanıt
boşluğudur.

**Öneri:** EX-12 gerçek E2E'sinde source plana bağlı gerçek bir run oluşturup copy öncesi/sonrası
snapshot, ölçüm, event ve hash parmak izini karşılaştırmalı. EX-06'ya implementasyonu taklit eden
ek bir test eklenmesi zorunlu değildir. Kabulü engellemez.

### L-2 — Düşük: Eşzamanlılık testi unique-conflict kaybeden dalını deterministik zorlamıyor

**Konum:** `apps/api/test/plan-copy.e2e-spec.ts:730-737`.

**Gerçek durum:** İki gerçek HTTP isteği `Promise.all` ile aynı anda gönderiliyor ve
`[200, 201]`, tek hedef plan, tek revision, tek copy-request ve doğru step sayıları
doğrulanıyor. Bu, sözleşme düzeyinde anlamlı bir eşzamanlılık kanıtıdır. Ancak istekler
serileşirse ikinci istek `findByKey` ön kontrolünden replay dönebilir; unique index çakışmasını
yakalayan `catch` dalı her koşuda deterministik olarak çalıştırılmaz. Rollback testi ve kod
incelemesi bu dalın doğru olduğunu destekliyor.

**Somut başarısızlık:** Gözlenen bir hata yok; yalnız dal kapsamı garanti değil.

**Öneri:** İstenirse service seviyesinde iki eşzamanlı çağrıyı barrier ile başlatacak bir test
eklenebilir. EX-06 kabulü için zorunlu değildir; mevcut test sözleşme davranışını gerçek
HTTP/PostgreSQL üzerinde doğruluyor.

## Reviewer tarafından çalıştırılan kontroller

Aşağıdaki sonuçlar inceleme sırasında gerçekten çalıştırılan komutlardan alınmıştır. Lead'in
tam API integration `246/246` ve worker'ın plan regresyonları `40/40` sonuçları devralınan
kayıt olarak anılmıştır; bu iki tam koşu reviewer tarafından yeniden çalıştırılmamıştır.

| Kontrol                      | Komut / yöntem                                                                                                                                                                       | Gerçek sonuç                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HEAD/branch                  | `git rev-parse HEAD`; `git branch --show-current`                                                                                                                                    | `db235e1c457f21fef02aa9eb3fe14b4e8c9f9162`; `feat/analytics-reporting-devices`.                                                                                                            |
| Implementasyon kapsamı       | `git show --stat --oneline 7195ad4`                                                                                                                                                  | 11 dosya, `+1438/−7`; plans servis/DTO/controller/module, copy e2e/helper ve doküman/kanıt. Devices/frontend dosyası yok.                                                                  |
| Whitespace                   | `git show --check --oneline 7195ad4`                                                                                                                                                 | Çıktı yok; exit 0.                                                                                                                                                                         |
| Format                       | `prettier --check` ile `plan-copy.service.ts`, copy DTO'ları, controller/module, `plan-copy.e2e-spec.ts`, `plan-copy-helpers.ts`                                                     | `All matched files use Prettier code style!`; exit 0.                                                                                                                                      |
| Lint                         | `apps/api` içinde `../../node_modules/.bin/oxlint --type-aware src/ test/`                                                                                                           | `0 warnings and 0 errors`; 163 dosya, exit 0.                                                                                                                                              |
| Typecheck                    | `apps/api` içinde `../../node_modules/.bin/tsc --noEmit -p tsconfig.json`                                                                                                            | Çıktı yok; exit 0.                                                                                                                                                                         |
| Hedefli gerçek DB/HTTP testi | Benzersiz `probedesk_ex06_review_1793989410_test` DB'si; `migrate-test-database.ts` + `vitest run --config vitest.config.e2e.ts test/plan-copy.e2e-spec.ts test/openapi.e2e-spec.ts` | 9 migration uygulandı; **2 dosya / 9 test geçti**, 2.40s, exit 0. DB `DROP DATABASE ... WITH (FORCE)` ile silindi; `pg_database` sayımı 0.                                                 |
| OpenAPI belgesi              | Read-only `tsx` emitter ile `apps/api/openapi.json` karşılaştırması                                                                                                                  | `OPENAPI_DOCUMENT_MATCH`; exit 0.                                                                                                                                                          |
| API client                   | `openapi-typescript` çıktısını temp dosyaya üretip `cmp` ile `packages/api-client/src/schema.ts` karşılaştırması                                                                     | `CLIENT_SCHEMA_MATCH`.                                                                                                                                                                     |
| Commit'li OpenAPI operation  | `node` ile committed `openapi.json` okuması                                                                                                                                          | Copy path'i var; security `{session, csrfToken}`, zorunlu `Idempotency-Key`, yanıtlar `200,201,400,401,403,404,409`.                                                                       |
| Çalışma ağacı                | `git status --short` (inceleme başlangıcı ve sonu)                                                                                                                                   | Başlangıçta Device/frontend/shared artifact değişiklikleri vardı; inceleme sırasında HEAD ilerledi. Reviewer yalnız bu review dosyasını ekledi; başka reviewer'ın dosyalarına dokunulmadı. |

Reviewer bu incelemede tam `npm run verify`, tam API integration, web testleri, browser/Playwright
veya `npm run openapi:check` çalıştırmadı. Hedefli copy/OpenAPI testi, typecheck ve lint gerçek
çıktıları yukarıda kayıtlıdır; çalıştırılmayan kontroller çalıştırılmış gibi gösterilmedi.

## Kabul önerisi

**EX-06 teknik olarak `Accepted` edilebilir; kritik, yüksek veya orta açık bulgu yoktur.**
Published source doğrulaması, tek transaction'da yeni plan/draft/adım kimlikleri, scalar ve
decimal koruma, kaynak değişmezliği, kullanıcıya scope'lu idempotency, eşzamanlı tek hedef,
rollback, rol/CSRF ve yanıt/OpenAPI sözleşmesi kod ve gerçek testlerle desteklenmektedir.
Reviewer'ın benzersiz test DB'sindeki hedefli koşusu **9/9** geçmiştir.

Kabul için önerilen koşullar:

1. **L-1** EX-12 gerçek paket E2E'sinde gerçek source run fingerprint'i ile kapatılmalı; EX-06
   kabulünü engellemez.
2. **L-2** opsiyonel test güçlendirmesidir; istenirse barrier'lı bir eşzamanlılık testi eklenir.
3. Kart durumu, `docs/tasks/README.md` ve `docs/roadmap.md` güncellemesi lead tarafından ayrı
   commit'te yapılmalıdır; bu review kaydı görev statüsünü değiştirmez.
4. Ürün/görsel kabul ve nihai teslim kararı kullanıcıya aittir; bu belge onları vermez.
