# EX-11 — Bağımsız teknik inceleme (rapor, indirme, yazdırma hazırlığı)

- Tarih: 2026-11-08
- İnceleme commit'i: `4f992677433598ed071a3169b1dcb72580d6d919` (`feat: download recorded results and prepare printable run reports`)
- Branch: `feat/analytics-reporting-devices`
- İnceleme başlangıcı HEAD: `690eb08c9740a474952e98162460b00b6d55139d`; başlangıçta çalışma ağacı temizdi.
- İnceleme bitişi HEAD: `8568820699f759e173e6f525eed45436502f3fbd`. Bu arada `138d482` (Start Run URL device preselect) ve `8568820` (EX-12 hazırlık dokümanı) eklendi; `apps/web` rapor/Details/route/print kaynakları `690eb08..8568820` aralığında değişmedi (`git diff --stat` boş). İnceleme sırasında çalışma ağacında bu incelemeye ait olmayan `apps/api/test/device-seed.e2e-spec.ts`, `apps/api/test/plan-copy.e2e-spec.ts`, `apps/api/test/support/plan-copy-helpers.ts`, `scripts/e2e-isolated.mjs`, `tests/e2e/support/database.ts` ve `tests/e2e/support/ex12-support.integration.ts` değişiklikleri görüldü; bunlara dokunulmadı.
- İnceleme modeli: DeepSeek V4.1 Flash / max.
- İnceleme türü: **Bağımsız frontend/API sözleşme incelemesi.** Ürün, görsel veya nihai yayın kabulü değildir.
- Kapsam: `features/reports/**`, `/runs/:runId/report` route'u, terminal Details rapor/indirme entegrasyonu, `runs-api.ts` ortak `parseRecordedRun` çıkarımı, rapor print CSS'i ve rapor DTO/generated schema uyumu. Download/direct-link/print hazırlık kodu incelendi; gerçek browser, canvas ve print kabulü yapılmadı.
- Kısıt: Repository içinde yalnızca bu review dosyası yazıldı. Kaynak, generated artifact, görev kartı, durum ve diğer dokümanlar değiştirilmedi. `git add/commit/push/checkout/reset/stash`, DB bağlantısı, migration/reset, `openapi:check`, browser/preview ve subagent çalıştırılmadı. Video üretilmedi.
- Ayrı kapsam: EX-05 ve EX-09 incelemelerindeki medium bulgular bu incelemenin konusu değildir; lead'in `84accb0`/`690eb08` düzeltmeleri ayrı kapsamdadır ve burada yeniden değerlendirilmemiştir.

## Sonuç özeti

| Alan | Sonuç |
| --- | --- |
| Rapor kimliği/şeması | **Geçti.** `schemaVersion === 1`, sunucu `runId`'si UUID ve istek kimliğiyle case-insensitive eşleşiyor; `generatedAt` UTC ISO olarak doğrulanıyor. |
| Zorunlu/nullable alanlar | **Geçti, iki düşük sözleşme farkı var.** `deviceId/deviceSnapshot/batchNumber`, istatistikler, `firstFailureSampleIndex`, `reasonCode` ve `finishedAt` `hasOwn`/null/string kontrollerinden geçiyor. `finishedAt: null` reddi ve `expectedSampleCount: 0` kabulü D-1/D-2'de. |
| Ondalık koruma | **Geçti.** `minimum`, `maximum`, istatistikler, `errorProbability` ve ölçüm `value` altı haneli decimal string olarak doğrulanıyor; UI bunları sayıya çevirip yeniden biçimlendirmiyor; yalnız chart çizimi için sayısal projeksiyon var. |
| Event cursor uydurmama | **Geçti.** Rapor parser'ı `lastEventSequence`/`id` alanlarını istemiyor; testte de rapor nesnesinde bu alanların olmadığı doğrulanıyor. |
| Terminal/RUNNING | **Geçti.** COMPLETED, CANCELLED, INTERRUPTED, ERROR okunuyor; RUNNING response'u parser tarafından reddediliyor; API 409 `RUN_NOT_TERMINAL` UI'da açıklama ve retry olarak gösteriliyor. |
| Snapshot kuralları/sonuçları | **Geçti.** Adım kuralı, durum, `isWithinTolerance`, sayaçlar ve istatistikler rapordaki kayıtlı değerlerden geliyor; canlı plan/cihaz join'ı yok; null istatistik "Not available". Scenario/seed/errorProbability/failureStepId/simulator/evaluation ve requester/tarih/reason metadata şablonda gösteriliyor. |
| Gizlilik | **Geçti.** Parser yalnız public alanları topluyor; session, CSRF, passwordHash, requestHash, idempotencyKey ve event payload raporda yok. Rapor sayfası yalnız public requester özetini gösteriyor. |
| RxJS iptal/route reuse | **Geçti, stale print state için bir bulgu var.** `switchMap` eski rapor isteğini iptal ediyor ve eski veriyi temizliyor; route değişiminde eski image decode sonucu başarıyla gelirse print engelleniyor. Ancak decode reddi/print state'i O-2'de. |
| Blob CSV/JSON indirme | **Geçti, test kapsamı kısmi.** Format/content-type kontrolü, tek pending eylem, duplicate engeli, Blob JSON hata decode'u, requestId, 401 returnUrl, UUID tabanlı güvenli dosya adı ve object URL cleanup kodu doğru. 403, JSON başarı yolu ve gerçek dosya adı otomatik test edilmiyor. |
| Direct link ve roller | **Kaynak düzeyinde geçti.** Route yalnız auth guard altında; ayrı role guard yok; API üç rolü de kabul ediyor. Otomatik test direct link'i yalnız VIEWER ile açıyor; Planner/Operator gerçek browser akışı EX-12'de açık. |
| Chart/font/image hazırlığı | **Kaynak düzeyinde geçti; gerçek canvas değil.** Chart factory fake; `toDataURL` ve `image.decode` mock'lanıyor. Gerçek Chart.js, font, PNG decode ve native print EX-12'de açık. |
| Print kapsamı/A4 | **Kaynak düzeyinde geçti, bir düşük kapsam farkı var.** Navigasyon/aksiyon gizleme, overflow açma, A4 portrait 12 mm, uzun metadata wrap, tablo header tekrarı ve 10k ham satır basmama kodu var. Global `@page` kapsamı D-3'te. |
| Test/lint/typecheck/build | **Geçti (bu incelemede gerçek çalıştırıldı).** Ayrıntı ve sayılar aşağıda. |
| Gerçek browser/EX-12, API/DB/CI/delivery | **Açık.** Bu incelemede çalıştırılmadı. |

## Bu incelemede gerçekten çalıştırılanlar

Komutlar current HEAD `8568820` üzerinde çalıştırıldı; rapor kaynakları `4f99267` ile aynıdır. Tüm komutlar başarılı tamamlandı (exit 0); aşağıdaki sayılar gerçek çıktıdan alınmıştır.

| Komut | Gerçek sonuç |
| --- | --- |
| `npx ng test --watch=false --include src/app/features/reports/reports.spec.ts` (`apps/web`) | **1 dosya / 20 test passed**, exit 0, 1.27 s |
| `npx ng test --watch=false --include src/app/features/runs/run-details-page.spec.ts --include src/app/features/runs/runs-api.spec.ts --include src/app/features/runs/run-metadata.spec.ts` (`apps/web`) | **3 dosya / 62 test passed**, exit 0, 3.91 s |
| `npm run test:web` (root) | **45 dosya / 485 test passed**, exit 0, 7.09 s |
| `npm run lint --workspace apps/web` | **152 dosya, 0 warning, 0 error**, exit 0, 32 ms |
| `npm run typecheck --workspace apps/web` | **exit 0**, hata çıktısı yok |
| `npm run build --workspace apps/web` | **exit 0**, 354.12 kB initial, 4.247 s, budget uyarısı yok |

Not: Full web sayısı lead'in hedef commit çevresindeki 44/474 ve sonrasındaki 45/481 kayıtlarından farklıdır. Fark, inceleme sırasında eklenen `138d482` commit'indeki 4 Start Run testinden kaynaklanır; rapor suite'i hâlâ 20 testtir. Bu nedenle 45/485 sayısı EX-11 kaynaklarına ek bir rapor testi eklenmiş gibi yorumlanmamalıdır. `lint` sayısı da evidence dosyasındaki 151 yerine güncel HEAD'de 152'dir.

Bu incelemede çalıştırılmayanlar: API unit/integration/e2e, DB migration/reset/constraint, `openapi:check` (artifact rewrite ettiği için), GitHub CI, delivery profili, gerçek browser, gerçek Chart.js canvas, native print/Save PDF. Bunlar EX-12 ve teslim kapılarıdır.

## Bulgular

### O-1 — Orta: Tamamlanmış örnek setine sahip terminal run "Partial result" olarak gösteriliyor

**Konum:**

- `apps/web/src/app/features/reports/run-report-page.html:55-60`: Uyarı yalnız `run.status !== 'COMPLETED'` koşuluna bağlı.
- `apps/web/src/app/features/runs/run-status.ts:165-203`: Mevcut ortak kurallar `isPartialResult` için `recordedSampleCount < expectedSampleCount`, `isStoppedAfterAllSamples` için tersi ayrımını yapıyor.
- `apps/web/src/app/features/runs/run-details-page.html:141-153`: Details ekranı tam bu ayrımı kullanıyor; tam örnekli CANCELLED/INTERRUPTED/ERROR için "All expected samples were recorded" diyor.
- `apps/web/src/app/features/reports/reports.spec.ts:285-303`: Rapor testi yalnız `INTERRUPTED`, `recordedSampleCount: 0` durumunu kapsıyor.

**Gerçek durum:** CANCELLED, INTERRUPTED veya ERROR statüsündeki bir run beklenen bütün örnekleri kaydetmiş olabilir (örneğin finalizasyon sırasında iptal veya teknik hata). Bu durumda rapor sayfası hâlâ "Partial result: ... Missing samples ... are not inferred." yazıyor. Sayaçlar doğru görünse de metin, eksik örnek varmış gibi yanlış bir sonuç iletir. Details ekranındaki doğru davranışla çelişir.

**Etki:** Orta. Veri uydurulmuyor ve verdict hesaplanmıyor; ancak kullanıcıya terminal bir run hakkında yanlış "partial/missing" bilgisi veriliyor. Rapor kabulünde tamamlanmış örnek seti iddiası bu yüzden tartışmalı.

**Öneri:** Rapor sayfasında `isPartialResult(run)` ve `isStoppedAfterAllSamples(run)` ortak fonksiyonlarını kullan; kısmi durumda mevcut uyarıyı, tam örnekli durumda "All expected samples were recorded; run stopped before final completion" mesajını göster. Testleri CANCELLED/INTERRUPTED/ERROR × (tam örnek / eksik örnek) matrisiyle genişlet.

### O-2 — Düşük: Route/print değişiminde stale decode reddi yeni raporun print state'ini bozabiliyor

**Konum:**

- `apps/web/src/app/features/reports/run-report-page.ts:71-80`: Route parametresi değişince `prepared` ve `printError` sıfırlanıyor; `printing` sıfırlanmıyor.
- `apps/web/src/app/features/reports/run-report-page.ts:104-125`: Başarılı decode sonrası `facade.data() !== printedReport` kontrolü var; ancak `catch` içinde aynı stale kontrolü yok. Ayrıca decode hiç çözülmezse `printing` yeni raporda `true` kalır.
- `apps/web/src/app/features/reports/reports.spec.ts:246-267`: Test yalnız decode'un başarıyla çözüldüğü yolu kapsıyor; reddedilen promise ve route değişiminde `printing` reset'i test edilmiyor.

**Gerçek durum:** Run A'nın Print hazırlığı sırasında Run B'nin report route'una geçildiğinde eski `<img>` elemanları DOM'dan kalkar. Eski `image.decode()` promise'i reddederse `catch` bloğu yeni raporun `printError` sinyalini "Charts could not be prepared..." ile doldurur ve `prepared` değerini `false` yapar. Bu, yeni raporda kullanıcıya yanlış hata gösterir. Decode promise'i hiç sonuçlanmazsa yeni raporun Print düğmesi "Preparing print…" ve disabled kalabilir. Stale rapor yazdırılmıyor; ancak yeni ekranın print durumu kirleniyor.

**Etki:** Düşük/Orta sınırı. Normalde data URL decode hızlı çözülür ve hata nadirdir; fakat route reuse sırasında asenkron sonucun yeni state'e yazılması gerçek bir yarıştır. Print kabulünde kullanıcıya yanlış hata gösterme riski vardır.

**Öneri:** `print()` başında istenen run kimliğini/nesneyi yakala; `catch` içinde de `destroyRef.destroyed`, `facade.data() === printedReport` ve route kimliği kontrolü yap. Route parametresi ve `reload()` içinde `printing.set(false)` uygula; mümkünse decode promise'ine iptal/timeout ekle. Stale decode reddi testi ekle.

### D-1 — Düşük: Parser `finishedAt: null` değerini reddediyor; DTO bu alanı nullable tanımlıyor

**Konum:**

- `apps/web/src/app/features/reports/reports-api.ts:80-88`: `run.finishedAt === null` doğrudan malformed response sayılıyor.
- `apps/api/src/reports/dto/run-report.dto.ts:205-209`: `finishedAt!: string | null` ve `nullable: true`.
- `packages/api-client/src/schema.ts:1296-1297`: Generated `RunReportDto.finishedAt` tipi `string | null`.
- `apps/web/src/app/features/reports/run-report-page.html:85-87`: Şablonda null için "Not recorded" fallback'i yok; parser reddettiği için normalde buraya gelinmiyor.

**Gerçek durum:** Bilinen terminal geçişleri `finishedAt` yazıyor; bu nedenle mevcut seed/executor verisinde reddedilen bir kayıt görülmedi. Ancak API sözleşmesi ve DB kolonu nullable'dır; legacy veya bozuk bir terminal satırda `finishedAt: null` gelirse rapor "Invalid report response" olur. Parser, DTO'dan daha katıdır.

**Etki:** Düşük. Normal akışta görülmez; sözleşme/legacy uyumluluğu açısından karar verilmesi gerekir.

**Öneri:** Ya API/DB terminal run için `finishedAt` non-null garantisi verecek şekilde sözleşme ve test ekle, ya da parser null'u kabul edip UI'da "Not recorded" göster. İki taraftan biri açıkça seçilmeli.

### D-2 — Düşük: Rapor parser'ı DTO alt sınırlarının bir kısmını uygulamıyor

**Konum:**

- `apps/web/src/app/features/reports/reports-api.ts:83-86`: `expectedSampleCount` yalnız üst sınırla kontrol ediliyor; alt sınır yok.
- `apps/web/src/app/features/runs/runs-api.ts:286`: Paylaşılan parser `expectedSampleCount` için minimum `0` kullanıyor.
- `apps/web/src/app/features/runs/runs-api.ts:312-313`: Adım `sampleCount` ve `intervalMs` için minimum `0` kullanılıyor.
- `apps/api/src/reports/dto/run-report.dto.ts:59-63,228-232`: DTO adım `sampleCount` min 1, `intervalMs` min 100, `expectedSampleCount` min 1 diyor.

**Gerçek durum:** `expectedSampleCount: 0` veya `sampleCount: 0/intervalMs: 0` içeren bozuk bir rapor parser'dan geçebilir; sayfa "0 / 0" veya sıfır aralıklı adım gösterebilir. Backend normalde bu değerleri üretmez; bu bir savunma/contract uyumu boşluğudur. Mevcut run snapshot parser'ı da aynı gevşek alt sınırları kullanıyor; bu değişiklik EX-11'e özgü değildir.

**Etki:** Düşük. Kullanıcıya yanlış verdict gitmez; yalnız malformed response daha geç yakalanır.

**Öneri:** Rapor parser'ında DTO alt/üst sınırlarını uygula (`expectedSampleCount >= 1`, `1 <= sampleCount <= 1000`, `100 <= intervalMs <= 5000`, `position` benzersizliği/ölçüm sayısı tutarlılığı isteğe bağlı). Run snapshot parser'ını değiştirmek gerekiyorsa bunu ayrı bir regresyon olarak ele al.

### D-3 — Düşük: A4 `@page` kuralı rapor route'una scope'lanmamış

**Konum:**

- `apps/web/src/styles.scss:52-56`: `@media print` içindeki `@page { size: A4 portrait; margin: 12mm; }` global stillerin parçası; `body.pd-print-report` seçicisinin dışında.
- `apps/web/src/styles.scss:57-84`: Navigasyon/toolbar/overflow temizliği doğru biçimde yalnız `body.pd-print-report` altında.

**Gerçek durum:** Rapor route'u dışında herhangi bir ekran yazdırıldığında da sayfa boyutu A4 portrait ve kenar 12 mm olur. Navigasyon gizleme raporla sınırlı olduğu için asıl risk düşüktür; ancak "scoped global print CSS" iddiası `@page` için doğru değildir. Başka bir ekranın print davranışı istenmeden değişir.

**Etki:** Düşük. Uygulamada başka print hedefi yoksa görünür bir hata yoktur; gelecekteki print ekranları için kapsam sızıntısıdır.

**Öneri:** Named page kullan (`body.pd-print-report`/host `page: report`, `@page report { ... }`) veya global A4 kararını bilinçli olarak dokümante et. A4/12 mm'nin yalnız rapor route'unda uygulandığını gerçek browser testiyle doğrula.

## Doğrulanan ve açık kalan noktalar

### Doğrulananlar

- **Parser:** `schemaVersion=1`, `runId` UUID/eşleşme, `generatedAt` ISO/UTC, zorunlu nullable alanların varlığı, decimal string koruma, event cursor yokluğu ve terminal-only kontrolü kod ve test düzeyinde doğrulandı.
- **Durumlar:** Dört terminal statü test edildi; RUNNING 409 açıklaması ve retry test edildi.
- **Snapshot/gizlilik:** Rapor projection'ı canlı plan/cihaz join'ı yapmıyor; null cihaz/parti legacy gösterimi var; public requester dışında kullanıcı/oturum alanı gösterilmiyor.
- **RxJS:** Facade `switchMap` ile eski isteği iptal ediyor, eski veriyi temizliyor; route değişiminde eski başarılı rapor response'u yeni ekrana yazılmıyor.
- **İndirme:** CSV/JSON blob yolu, content-type doğrulaması, tek pending eylem, duplicate engeli, Blob JSON hata decode'u, requestId, 401 returnUrl, UUID tabanlı güvenli ad ve object URL cleanup kodu mevcut; ilgili testler geçti.
- **Chart/print hazırlığı:** Chart factory/config mevcut ortak yapıyı kullanıyor; başarısız capture print'i engelliyor; PNG capture/decode ve `window.print()` sırası kod düzeyinde doğru; body class, chart destroy, listener ve object URL cleanup yapılıyor.
- **Print CSS:** A4 portrait/12 mm, rapor route'unda navigasyon/toolbar/aksiyon gizleme, shell overflow açma, uzun metadata wrap, tablo header tekrarı ve 10k ham satır basmama kodu var.

### Açık/doğrulanmamış kapılar

- **EX-12 gerçek browser:** 390 px, %200 zoom, klavye, Planner → Operator → Viewer tam akış, direct link, RUNNING/terminal/partial/null, uzun metadata, 10k ölçüm, A4 sayfa kırıklıkları ve native Print/Save PDF.
- **Gerçek canvas/font:** Chart.js gerçek canvas çizimi, `document.fonts.ready`, `canvas.toDataURL`, `image.decode`, çok adımlı grafikler ve başarısız canvas. Bu incelemedeki factory/decode testleri fake/mock'tur; kabul kanıtı sayılmaz.
- **Test kapsamı boşlukları:** Terminal Details'te rapor/indirme bölümünün görünmesi, RUNNING'de gizlenmesi, geçersiz UUID route'unun istek üretmemesi, üç rolün direct link'i, 403 export hatası, JSON başarılı indirme/content-type, gerçek dosya adı değeri, input change ile pending iptali, object URL timer revocation ve stale decode reddi otomatik test edilmiyor.
- **API/DB/CI/delivery:** API unit/integration/e2e, gerçek PostgreSQL, migration/reset, `openapi:check`, GitHub CI, delivery profili ve ürün kabulü bu incelemede çalıştırılmadı; `openapi:check` artifact rewrite ettiği için özellikle çalıştırılmadı. API DTO ve generated schema yalnız okunarak karşılaştırıldı.
- **Ölçüm/kanıt farkı:** `docs/evidence/feature-pack-1/ex-11.md` ve `docs/tasks/EX-11.md` içindeki 44/474, 45/481 ve 151 dosya sayıları hedef commit/ara HEAD ile tutarlı olabilir; güncel HEAD'de gerçek sayılar 45/485 ve 152 dosyadır. Bu bir kod bulgusu değildir; kanıt/status metni güncellenirken gerçek HEAD ve komut çıktısıyla hizalanmalıdır.

## Teknik kabul önerisi

**Mevcut haliyle teknik kabul önerilmez.** En az **O-1** (yanlış "Partial result" bilgisi) kapatılmalıdır. **O-2** düşük olmakla birlikte aynı route/print düzeltmesinde ele alınması önerilir. **D-1/D-2** parser–DTO sözleşme uyumu için düzeltilmeli veya bilinçli kabul olarak kayda geçirilmelidir; **D-3** düşük ve opsiyoneldir.

O-1/O-2 düzeltildikten sonra EX-11 kod düzeyinde teknik kabul edilebilir; ancak bu, EX-12 gerçek browser/print/canvas, API/DB/CI/delivery ve ürün/görsel kabulünün verildiği anlamına gelmez. Bu inceleme hiçbir browser veya ürün kabulü üretmemiştir.
