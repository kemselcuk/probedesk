# Phase 7 — Yetki/güvenlik ve yarış/kesinti kanıtı

Tarih: 2026-11-04 18:29 CET
Ortam: macOS Darwin arm64, Node.js `22.23.2`, npm `10.9.8`, gerçek PostgreSQL
(test DB `127.0.0.1:5433/probedesk_test`, 8 migration uygulanmış).
Başlangıç commit'i: `9f4017e`. Bu çalışma henüz commit edilmedi; çalışma ağacı
kirli ve commit'i lead oluşturacak.

Kapsam: P7-02 (T24, auth negative matrisi, CSRF/origin, hassas veri sızıntısı)
ve P7-03 (T09/T11/T12, gerçek süreç SIGKILL/SIGTERM recovery). UI kodu
değiştirilmedi. Gerçek parola, cookie veya token bu dosyaya yazılmadı.

## Çalıştırılan kontroller ve gerçek sonuçlar

| Komut | Sonuç |
|---|---|
| `npm run lint --workspace apps/api` | 0 warning, 0 error; 143 dosya, 107 kural. |
| `npm run typecheck --workspace apps/api` | Çıkış kodu 0 (`tsc --noEmit`). |
| `npm run test --workspace apps/api` | 16 dosya, 118 test geçti; 1.34 sn. |
| `npm run db:migrate:test --workspace apps/api` | 8 migration bulundu; uygulanacak yeni migration yok. |
| `npm run build --workspace apps/api` | `nest build` çıkış kodu 0. |
| `npm run test:e2e --workspace apps/api` | 21 dosya, 195 test geçti; 66.53 sn. Yeni `security` ve `runs-process` dosyaları dahil. |
| `npx vitest run --config ./vitest.config.e2e.ts test/runs-process.e2e-spec.ts` | İkinci bağımsız koşu: 3/3 test geçti; 12.12 sn (tekrar/kararlılık kontrolü). |
| `npx ng test --include='src/app/core/auth/**/*.spec.ts' --watch=false` | 4 dosya, 30 test geçti (auth kaybı/401 yönlendirmesi mevcut web testleri). |
| `npm run test:web` | 35/36 dosya, 366/367 test geçti; **1 ilgisiz hata**: `compare-runs-page.spec.ts` derin bağlantı testi 5 sn timeout (`el.scrollTo is not a function`). Bu worker `apps/web` değiştirmedi; hata P7-02/P7-03 kapsamı dışında ve ayrı raporlanmalı. |

## P7-02 kapsam haritası

Yeni dosya: `apps/api/test/security.e2e-spec.ts` (7 test). Tümü gerçek
Supertest HTTP isteği + gerçek PostgreSQL üzerinde çalışır. Plan/run fixture'ları
gerçek DB satırlarıdır; DB kısıtı mock'lanmaz.

| Kabul ölçütü | Yeni/mevcut kanıt |
|---|---|
| Viewer run başlatamaz; Operator plan değiştiremez. | `security.e2e-spec.ts` → “enforces the role matrix with 401 before 403 and no side effects”: Viewer/Planner `POST /api/runs` 403; Operator ve Viewer `POST /api/plans` 403; Operator `PUT /draft`, `POST /publish`, `POST /drafts` 403. Mevcut `runs.e2e-spec.ts` “requires an Operator session…” ve `plans.e2e-spec.ts` “allows only a Planner to create and save plans” aynı davranışı ayrıca kapsıyor. |
| Planner run başlatamaz/iptal edemez. | Aynı matris: Planner `POST /api/runs` 403, Planner/Viewer `POST /api/runs/:id/cancel` 403. Mevcut `runs-cancel.e2e-spec.ts` “enforces Operator, session, CSRF and unknown-run rules” da kapsıyor. |
| Eksik oturum 401, yanlış rol 403. | Matrisin `missing session` satırları `POST /runs`, `POST /plans`, `POST /runs/:id/cancel`, `GET /plans`, `GET /runs/active` için 401; rol satırları 403. Gövde kodları `UNAUTHENTICATED` / `FORBIDDEN`; reddedilen yanıtlarda `Set-Cookie` yok. Mevcut `auth.e2e-spec.ts` “enforces the role matrix…” genel guard matrisini kapsıyor. |
| İstemcinin gönderdiği status/outcome/verdict/createdBy/publishedBy/timestamp/requestedBy reddedilir ve sunucu değerini ezemez. | `security.e2e-spec.ts` → “rejects every client-supplied server-owned field without a write”: `POST /plans`, `PUT /plans/:id/draft`, `POST /plans/:id/draft/publish`, `POST /runs` gövdelerinde `status`, `outcome`, `verdict`, `createdBy`, `publishedBy`, `createdAt`, `startedAt`, `finishedAt`, `publishedAt`, `requestedBy` alanlarının her biri `UNKNOWN_FIELD` ile 400; nested adımda `outcome/status/recordedCount` da 400. Hiçbir plan/run satırı yazılmıyor. Mevcut `runs.e2e-spec.ts` “rejects client-supplied status, outcome…” ve `plans.e2e-spec.ts` / `plan-publish.e2e-spec.ts` unknown-field testleri de var. |
| Sunucu değerleri istemci tarafından atanamaz. | `security.e2e-spec.ts` → “returns only server-assigned publisher and requestedBy values”: plan `createdById`, yayın `publishedById`, run `requestedById`, `status=RUNNING`, `outcome=null`, `idempotencyKey` başlıktan ve 64 hex `requestHash` DB'de doğrulanıyor; yanıt `publishedBy` özeti `GET /plans/:id/versions` üzerinden Planner kullanıcısını gösteriyor. |
| Eksik/yanlış CSRF ve yabancı Origin mutasyonlarda reddedilir. | `security.e2e-spec.ts` → “rejects missing/wrong CSRF and a foreign Origin on every mutation”: create plan, save draft, publish, create draft, start run, cancel run ve logout için ayrı ayrı eksik CSRF, yanlış CSRF ve `Origin: https://evil.example` + geçerli CSRF → 403; plan/draft/run/session durumu değişmiyor; ardından doğru imzalı istek 200/204. **Bulunan ürün açığı:** yabancı Origin daha önce yalnız login'de kontrol ediliyordu; authenticated mutasyonlarda kontrol edilmiyordu. Düzeltme aşağıda. |
| Login JSON-only ve origin kuralları. | `security.e2e-spec.ts` → “keeps login JSON-only and same-origin”: `text/plain` 400, `Origin: https://evil.example`, `null`, geçersiz URL 403 ve cookie yok; unknown `role` alanı 400; aynı origin 200. Mevcut `auth.e2e-spec.ts` “rejects unknown login fields…” ile aynı sözleşme. |
| Hassas alanlar yanıt/loglara sızmaz. | `security.e2e-spec.ts` → “does not expose credentials, token hashes or idempotency internals in responses or logs”: login, plan create/list/detail/versions, version detail, device profiles, `/auth/me`, run snapshot/history/active yanıtlarında; `password`, `passwordHash`, session cookie değeri, CSRF token, `tokenHash`, `csrfTokenHash`, `idempotencyKey`, `requestHash`, `Set-Cookie`, `postgresql://` geçmiyor. `MemoryLogger` ile Nest log satırları da taranıyor. Mevcut `sse.e2e-spec.ts` “replays every committed event…” SSE gövdesini, `plan-publish.e2e-spec.ts` yayıncı özetini ayrıca kontrol ediyor. |
| Hata gövdesi SQL/stack/DSN sızdırmaz. | `security.e2e-spec.ts` → “returns a safe 500 body and log when an unexpected database error occurs”: `test_runs` INSERT trigger'ı DSN ve `SELECT` metni içeren hata fırlatıyor; yanıt yalnız `{code, message, requestId}` ve genel mesaj; yanıt/logda trigger adı, SQL, DSN, stack yok; log requestId ve `status=500` içeriyor. Mevcut `common-behaviour.e2e-spec.ts` “does not leak unexpected error messages…” de kapsıyor. |
| Auth kaybı UI'da açıklanır. | Bu worker UI değiştirmedi. Mevcut `auth.interceptor.spec.ts` ve `auth.guards.spec.ts` 401'i anonymous oturuma çevirip korumalı URL'yi koruyor; hedefli web koşusu 4 dosya/30 test geçti. Gerçek Chrome oturum expiry kanıtı P4-07'de kabul edilmiş durumda. P7-04/P7-06 kapsamında ayrıca değerlendirilmeli. |

### Bulunan ürün açığı ve düzeltme

- **Açık:** `assertCsrfRequest` yalnız CSRF token'ını doğruluyordu. Tarayıcı
  kaynaklı bir mutasyon `Origin: https://evil.example` ile geçerli CSRF başlığı
  taşırsa Origin reddedilmiyordu. Login'de ayrı bir origin guard vardı; diğer
  mutasyonlarda yoktu.
- **Düzeltme (küçük ve doğrudan P7-02 kapsamında):**
  - `apps/api/src/auth/origin.ts` eklendi; `Host` + `Origin` (ve varsa
    `X-Forwarded-Proto`) karşılaştırması tek yerde toplandı. Origin yoksa
    (curl/non-browser) istek geçer; `null`, malformed, credential içeren ve
    host ile eşleşmeyen Origin 403.
  - `apps/api/src/auth/login-origin.guard.ts` aynı yardımcıyı kullanıyor.
  - `apps/api/src/auth/csrf.ts` güvenli olmayan metotlarda CSRF'den önce
    `assertSameOrigin` çağırıyor. Böylece `SessionAuthGuard`, `CsrfGuard` ve
    logout yolu aynı korumayı alıyor.
- **Doğrulama:** Yeni Origin testleri ve tüm e2e suite'i geçti. Playwright
  istekleri `Origin` olarak API URL'sini gönderdiği için aynı origin kuralına
  uyuyor.

## P7-03 kapsam haritası

Yeni dosya: `apps/api/test/runs-process.e2e-spec.ts` (3 test). API `nest build`
çıktısı `dist/main.js` olarak ayrı işletim sistemi süreçlerinde, boş loopback
portlarında başlatılır; gerçek HTTP `fetch` ve gerçek PostgreSQL kullanılır.

| Kabul ölçütü | Kanıt |
|---|---|
| Eşzamanlı iki bağımsız başlangıç iki RUNNING run üretemez. | Yeni “accepts exactly one of two concurrent starts across two API processes for repeated rounds”: iki ayrı API süreci, aynı test DB, 5 tur. Her turda eşzamanlı iki `POST /api/runs` farklı idempotency anahtarlarıyla → tam olarak `[202, 409]`; 409 `RUN_ALREADY_ACTIVE` ve `details.activeRunId` = kabul edilen run; DB'de anahtarlardan yalnız biri var, `status=RUNNING` sayısı 1; kabul edilen run cancel edilince RUNNING sayısı 0. Tur sonunda beş run da CANCELLED ve olay sequence'ları gapsiz. Mevcut `runs.e2e-spec.ts` “accepts exactly one of two concurrent starts with different keys” tek süreçte aynı DB kısıtını ayrıca kapsıyor. |
| Cancel/final ölçüm yarışında tek terminal durum ve geç yazma koruması; kısmi veri korunur. | Mevcut `runs-cancel.e2e-spec.ts` “keeps exactly one terminal state when cancel races final completion”: kontrollü scheduler son örnek sınırında cancel ve completion'ı yarıştırır; tam bir RUN_CANCELLED veya RUN_COMPLETED olayı, terminal `finishedAt` eşleşmesi, `recordedSampleCount = measurements.length`, terminal sonrası ölçüm/olay yazılmaması. “serialises a sample racing with cancel and keeps only pre-terminal writes” gerçek PostgreSQL satır kilidiyle sample/cancel sırasını kanıtlar. “cancels a partial run while preserving measurements and completed steps” tamamlanan adım/ölçümlerin korunduğunu, pending adımların NOT_RUN olduğunu doğrular. Bu testler bu turda tüm e2e suite içinde geçti. |
| SIGKILL/fresh instance: ölçümler korunur; INTERRUPTED readiness öncesi oluşur; resume yok. | Yeni “preserves measurements across SIGKILL, recovers to INTERRUPTED before readiness and never resumes”: gerçek süreçte uzun aralıklı run başlatılır, en az bir ölçüm commit edince `SIGKILL`; süreç `signal=SIGKILL` ile ölür. Ölçüm sayısı, `recordedSampleCount`, olaylar ve RUNNING durumu değişmez. Yeni süreç ayağa kalkar; ilk başarılı `/api/health/ready` 200 döndüğünde run INTERRUPTED, `SERVER_RESTART`, `finishedAt` dolu, aktif adım INTERRUPTED, pending adımlar NOT_RUN, ölçümler aynı, olaylarda tek `run.interrupted` ve `run.completed` yok. Yeni run başlatılırken eski kayıt okunur; retry yeni run id'si alır, ilk ölçümünü commit ederken eski run'ın status/recordedSampleCount/finishedAt/eventSequence/ölçüm/olay kümesi birebir aynı kalır. Retry cancel edildikten sonra da eski kayıt değişmez. Mevcut `runs-recovery.e2e-spec.ts` aynı recovery sözleşmesini süreç içi ve DB trigger'larıyla ayrıca kapsıyor. |
| Kontrollü kapanış RUNNING bırakır; shutdown sonrası COMPLETED commit yok. | Yeni “leaves the run RUNNING on controlled shutdown and commits no COMPLETED event”: gerçek süreçte run başlatılır, en az bir ölçüm commit edilir, `SIGTERM` gönderilir. Nest shutdown hook'ları çalışıp sinyali yeniden yükselttiği için süreç `signal=SIGTERM`, `code=null` ile biter. DB'de run hâlâ RUNNING, `finishedAt=null`, `recordedSampleCount` korunmuş, `run.completed` yok; ölçümler ve gapsiz olaylar duruyor. Yeni süreç readiness 200 verdiğinde run INTERRUPTED ve tek `run.interrupted` olayı var. Mevcut `runs-recovery.e2e-spec.ts` “leaves RUNNING data on controlled shutdown…” süreç içi `app.close()` ile aynı davranışı kapsıyor. |
| Yeni deneme yeni run'dır; eski kısmi kayıt değişmez. | SIGKILL testinin retry bölümü: yeni run id'si eski id'den farklı; eski run'ın terminal alanları, olayları ve ölçümleri retry ilerlerken ve retry cancel edildikten sonra da değişmiyor. |

## Riskler, sınırlar ve ertelenen işler

- **Build sırası:** `runs-process` testleri `dist/main.js` ister. `test:e2e`
  komutu build çalıştırmaz; P7-06 CI'da `npm run build --workspace apps/api`
  adımı e2e'den önce olmalı. Dist yoksa test açık bir hata ile durur; sessizce
  kaynak dosyaya düşmez. Bu tercih, decorator metadata üretmeyen loader'larla
  yanlışlıkla farklı bir çalışma biçimi test edilmesini engeller.
- **Tek API süreci varsayımı:** Ürün recovery'si deployment'ta tek API süreci
  varsayar. İki süreç yalnızca eşzamanlı başlangıç yarışını kanıtlamak için
  kullanıldı; ikisi de herhangi bir run başlamadan önce ayağa kaldırıldı.
  Üretimde iki süreç aynı anda çalıştırılırsa startup recovery birinin aktif
  run'ını INTERRUPTED yapabilir; bu mevcut ve belgelenmiş bir sınırdır.
- **Web suite:** Tam `test:web` koşusunda P7 kapsamı dışındaki
  `compare-runs-page` testi timeout ile düştü. Auth'a özel 4 dosya/30 test
  geçti. Bu hata bu worker tarafından düzeltilmedi ve P7-02/P7-03 kanıtı olarak
  kullanılmadı.
- **Origin guard proxy varsayımı:** Host ve `X-Forwarded-Proto` doğru
  yapılandırılmalıdır. Ters proxy başlıkları yanlışsa meşru same-origin
  mutasyonlar 403 olabilir; login guard'ı da aynı varsayımı kullanır.
- **Log kapsamı:** `MemoryLogger` Nest logger çağrılarını yakalar; alt süreç
  stdout'u P7-02 sızıntı testinde ayrıca taranmaz. Süreç testleri gerçek
  `dist/main.js` çıktısını toplar ancak token/DSN taraması yapmaz.
- **İnceleme:** Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı. Kartlar
  `In Review`; `Accepted` değil. `docs/tasks/README.md` ve `docs/roadmap.md`
  bu worker'ın sahiplik alanı dışında olduğu için güncellenmedi; lead'in aynı
  commit'te güncellemesi gerekir.
