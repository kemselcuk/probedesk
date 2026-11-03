# Phase 3 — Çalıştırma özeti, iptal ve Run Again kanıtı (P3-10)

- Tarih: 2026-11-03
- Kapsam: `/runs/:runId` Run Details, snapshot refresh, rol kontrollü iptal, Run Again, yayımlanmış sürüm ekranındaki Start run girişi ve App Shell Operator aksiyonu.
- Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 10.9.8 (`packageManager` 11.6.2), Angular 22.2.4, Vitest 5.1.0 + TestBed + `HttpTestingController`.
- Uygulama commit'i: Bu çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge bir commit hash'i iddia etmez.
- Kapsam dışı: Live Run SSE ekranı (P4-04), Run History listesi (P5-02), Compare Runs (P6-02), gerçek tarayıcı E2E testi (P7-01).

## Sonuç

`/runs/:runId` ekranı artık `GET /api/runs/:id` snapshot'ını yüklüyor; loading, boş adım listesi, genel hata ve 404 durumlarını ayırıyor. Plan adı/sürümü, sunucudan gelen status/outcome etiketi (metin + ikon), senaryo/seed/ayarlar, simülatör ve değerlendirme sürümleri, beklenen/kaydedilen örnek sayıları, yüzde ilerleme, UTC başlangıç/bitiş zamanları, isteyen kullanıcı, reasonCode, adım kuralları, sayaçlar, istatistikler ve ölçüm tabloları gösteriliyor. Frontend hiçbir verdict, tolerans bayrağı veya istatistik üretmiyor; null istatistik "Not available", ölçümü olmayan adım "No samples recorded" olarak görünüyor. Eksik veri sıfırla doldurulmuyor.

İptal yalnızca Operator'a ve yalnızca `RUNNING` snapshot'ta sunuluyor. Onay dialog'u "Keep running" düğümüne odaklanıyor; onaydan sonra ekran iyimser olarak Cancelled göstermiyor, `POST /api/runs/:id/cancel` yanıtını bekliyor. Başarılı yanıttaki terminal snapshot gösterilip ardından snapshot yeniden okunuyor. İstek başarısızsa gerçek sunucu durumu korunuyor ve güvenli bir hata paneli gösteriliyor.

Run Again yalnızca Operator'a ve terminal çalıştırmada sunuluyor. Snapshot'taki `planVersionId`, `scenario`, `seed` ve senaryoya ait `errorProbability` veya `failureStepId` aynen yeni isteğe dönüşüyor. İlk tıklamada yeni bir `Idempotency-Key` üretiliyor; ağ hatasında aynı anahtar korunuyor, `IDEMPOTENCY_CONFLICT` sonrasında kullanıcı yeniden tıkladığında yeni anahtar üretiliyor. Başarılı yanıttaki gerçek `runId` ile `/runs/:runId/live` adresine gidiliyor. Eski kayıt değiştirilmiyor ve bu metin ekranda açıkça yazıyor.

Yayımlanmış sürüm ekranında Operator'a `/runs/new?versionId=...` bağlantısı eklendi. App Shell'deki Operator "Start run" aksiyonu artık devre dışı değil; yayımlanmış bir sürüm seçilebilen `/plans` ekranına gidiyor. Global bir sürüm seçici olmadığı için bu, uydurma bir doğrudan başlatma yerine dürüst akış olarak seçildi.

## Eklenen ve değişen dosyalar

### Yeni

- `apps/web/src/app/features/runs/run-details-page.ts`, `.html`, `.scss`: snapshot ekranı, refresh, iptal ve Run Again davranışı.
- `apps/web/src/app/features/runs/cancel-run-dialog.ts`: erişilebilir iptal onayı; "Keep running" başlangıç odağı ve Escape/backdrop ile iptal etmeme.
- `apps/web/src/app/features/runs/run-status.ts`: status/outcome etiketleri, ikonları, senaryo etiketleri, kısmi sonuç ve ilerleme metni. Renk tek gösterge değil.
- `apps/web/src/app/features/runs/run-rerun.ts`: snapshot'tan tam `StartRunDto` üretimi; eksik senaryo ayarında değer uydurmak yerine hata.
- `apps/web/src/app/features/runs/run-details-page.spec.ts` (24 test): PASSED/FAILED/CANCELLED/INTERRUPTED/ERROR, terminal-null outcome, boş adım, null istatistik, ölçüm tablosu, 404/503, refresh, eski yanıtın yeni seçimi ezmemesi, iptal dialog'u/odak/iyimser olmama/başarılı iptal + GET refresh/başarısız iptal/already-terminal, rol görünürlüğü, Run Again FORCED_FAILURE ve RANDOM payload'ları, yeni anahtar, ağ hatasında anahtar tekrarı, conflict sonrası yenileme, RUN_ALREADY_ACTIVE ve 400 fieldErrors.
- `docs/evidence/phase-3-run-summary.md`: bu dosya.

### Değişen

- `apps/web/src/app/features/runs/runs-api.types.ts`: `RunSnapshotDto`, `RunSnapshotStepDto`, `RunMeasurementDto`, `RunStepStatisticsDto` generated şema alias'ları.
- `apps/web/src/app/features/runs/runs-api.ts`: `getRun` ve `cancelRun`; snapshot'ın tüm tüketilen alanları için çalışma zamanı doğrulaması. Eksik/bilinmeyen alan `MalformedApiResponseError` üretiyor; varsayılan değer atanmıyor.
- `apps/web/src/app/features/runs/runs.facade.ts`: snapshot load/refresh durumları, yerel istek sırası ile stale yanıt engeli, iptal pending/error sinyalleri, iptal yanıtının eski GET yanıtlarını geçersiz kılması.
- `apps/web/src/app/features/runs/runs-api.spec.ts` (+5 test): snapshot parse, null istatistik/outcome, cancel POST'u, bozuk istatistik ve bozuk tolerans bayrağı reddi.
- `apps/web/src/app/features/plans/plan-version-page.ts`, `.html`: Operator için `#start-run-link` ve `isOperator` sinyali.
- `apps/web/src/app/features/plans/plan-version-page.spec.ts` (+3 test): Operator bağlantısı, Planner/Viewer'da bağlantının olmaması.
- `apps/web/src/app/layout/app-shell/app-shell.html`: Operator "Start run" aksiyonu `/plans` bağlantısına dönüştü; "available with P3-09" metni kaldırıldı.
- `apps/web/src/app/layout/app-shell/app-shell.spec.ts`: Operator aksiyonunun artık etkin bağlantı olduğu doğrulandı.
- `apps/web/src/app/features/routes.spec.ts`: Run Details placeholder beklentisi kaldırıldı; route smoke testi gerçek ekranın 404 durumunu yanıtlıyor. Bu, route değişikliğinin zorunlu sonucu olarak dokunulan ortak test dosyasıdır.
- `docs/tasks/P3-10.md`: durum ve kanıt alanları.

`app.routes.ts` değişmedi; `/runs/:runId` route'u zaten vardı ve `/runs/new` ile `/runs/:runId/live` statik route'larından sonra geliyor.

## Davranış

### Snapshot ve durum gösterimi

- Yükleme sırasında `Loading run snapshot…`; 404'te "Run not found" + run kimliği + requestId + Run History/Try again; diğer hatalarda `app-error-state` + requestId + retry.
- `RUNNING` → "Running" + play ikonu + "provisional snapshot" açıklaması.
- `COMPLETED` + `PASSED` → "Passed", `COMPLETED` + `FAILED` → "Failed", `COMPLETED` + null → "Completed" ve "no overall outcome"; PASSED/FAILED uydurulmuyor.
- `CANCELLED` → "Cancelled" + neden kodu varsa gösterim; kaydedilmiş örneklerin ve tamamlanan adımların korunduğu açıklaması.
- `INTERRUPTED` → "Interrupted" + sunucu kesintisi açıklaması.
- `ERROR` → "Error" + teknik hatanın tolerans ihlali olmadığı açıklaması.
- Terminal ve beklenen örnekten az kayıt varsa "Partial results" notu; `RUNNING` için ayrı "Provisional snapshot" notu. Her iki durumda da eksik örneklerin sıfır olarak gösterilmediği yazıyor.
- İstatistikler `minimum`, `maximum`, `average`, `sampleCount`; null olan her alan "Not available". Adım ölçümü yoksa tablo yerine "No samples were recorded for this step.".
- Ölçüm tablosu altı sütun: sample index, değer, birim, tolerans (ikon + "Within tolerance"/"Outside tolerance"), elapsed ms, UTC zaman. `caption` ve `th scope="col"` mevcut.
- Adım özeti ayrıca snapshot minimum/maksimum, örnek sayısı, interval; kaydedilen/beklenen; tolerans dışı sayısı; ilk ihlal indeksi; sunucu istatistikleri gösteriyor.

### Refresh ve yarışlar

- Refresh düğmesi aynı `runId` için yeni `GET /api/runs/:id` gönderiyor; istek sırasında "Refreshing…" ve `aria-busy`.
- Başarılı refresh canlı bölgede "The latest run snapshot has been loaded." duyuruyor. Başarısız refresh önceki snapshot'ı silmiyor; "The snapshot could not be refreshed" paneli ve requestId gösteriyor.
- Facade her snapshot okumasına yerel bir sıra numarası veriyor. Daha yeni bir run seçimi veya daha yeni refresh başladıysa eski yanıt uygulanmıyor. İptal yanıtı da kendisinden önce başlayan GET'leri geçersiz kılıyor.
- Aynı route içinde `runId` değişirse ekran yeni kimliği yüklüyor; eski run'ın yanıtı yeni başlığı ezemiyor.

### İptal

- `showCancelAction` yalnızca Operator + `RUNNING`. Planner/Viewer hiçbir iptal düğmesi görmüyor; salt okunur rol notu görüyor.
- Diyalog plan adı/sürümü ve kaydedilen/beklenen örnek sayısını gösteriyor. Başlangıç odağı `#cancel-run-keep` ("Keep running"); backdrop/Escape iptal etmiyor.
- Onaydan sonra `POST /api/runs/:id/cancel`; pending sırasında düğme "Cancelling…" ve disabled, fakat status hâlâ sunucunun son durumu (Running). İyimser terminal durum yazılmıyor.
- 200 yanıtındaki snapshot benimseniyor; ardından `GET /api/runs/:id` ile doğrulama okuması yapılıyor. Yanıt `CANCELLED` ise canlı bölgede "The server confirmed the cancellation." duyuruluyor. Yanıt zaten terminal başka bir durumsa "The run was already Failed/… Its existing result is shown unchanged." deniyor; Cancelled uydurulmuyor.
- Hata durumunda status değişmiyor; panelde "The cancellation was not confirmed", normalize edilmiş güvenli mesaj, requestId ve "Refresh snapshot" düğmesi var. 401 için sign-in bağlantısı, 403 için rol/CSRF açıklaması.
- Terminal durumda iptal düğmesi kaybolduğu için tekrar tıklama mümkün değil; sunucunun already-terminal yanıtı da idempotent biçimde mevcut sonucu gösteriyor.

### Run Again

- Yalnızca Operator + terminal snapshot. `RUNNING` sırasında düğme yok; "Run again becomes available after this run reaches a terminal state." notu var.
- Plan sürümü, senaryo, seed ve varsa error probability/failing step değerleri kartta salt okunur gösteriliyor. "Run again starts a new run… The recorded run on this page stays in history unchanged." ve "This creates a new run. The existing run is not modified." metinleri var.
- İstek gövdesi senaryoya göre tam: NORMAL `{planVersionId, scenario, seed}`, FORCED_FAILURE `+failureStepId`, RANDOM `+errorProbability` (kanonik ondalık metin aynen).
- `RunStartAttempt` yeni bir anahtar üretiyor; aynı isteğin ağ hatası retry'ında anahtar korunuyor. `IDEMPOTENCY_CONFLICT` sonrası kullanıcı yeniden tıkladığında anahtar sıfırlanıp yeni deneme üretiliyor.
- `RUN_ALREADY_ACTIVE` → mevcut çalışma bağlantısı (`details.activeRunId` doğrulanmışsa `/runs/:id/live`, yoksa Run History). `IDEMPOTENCY_CONFLICT` ve 400 `fieldErrors` güvenli biçimde gösteriliyor; kayıtlı run değişmiyor.
- Başarılı 202/200 yanıtındaki gerçek `runId` ile `/runs/:runId/live` adresine gidiliyor; tahmini kimlik kullanılmıyor.

### Giriş noktaları

- `GET /api/plan-versions/:id` yüklendikten sonra, plan/route uyuşmazlığı yoksa ve kullanıcı Operator ise Published Plan başlığında "Start run" bağlantısı `/runs/new?versionId=<id>` adresine gidiyor. Planner/Viewer'da bağlantı yok.
- App Shell Operator "Start run" aksiyonu `/plans` bağlantısı. Açıklama "Operator action · choose a published version on Test Plans." Global bir sürüm seçici olmadığı için doğrudan `/runs/new` uydurulmadı. Planner "New plan" aksiyonu ve Viewer salt okunur notu değişmedi.

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: repo kökü, 2026-11-03.

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 25ms on 69 files with 93 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
(çıkış kodu 0; hata yok)
```

```text
$ npm run test --workspace apps/web
Test Files  21 passed (21)
Tests       186 passed (186)
Duration    4.47s
```

Önceki taban 154 test (20 dosya) korunmuştur. Yeni testler: `run-details-page.spec.ts` 24, `runs-api.spec.ts` +5, `plan-version-page.spec.ts` +3; App Shell'de bir test güncellendi. Toplam 186 test.

```text
$ npm run build --workspace apps/web
Application bundle generation complete. [2.213 seconds]
Initial total: 325.65 kB | 90.90 kB
(warning/error yok)
```

Not: İlk build'de `run-details-page.scss` 6 kB component style uyarı bütçesini aştı. Kullanılmayan dekoratif kurallar çıkarılıp grid'ler `auto-fit` ile dar ekranlara uyarlanabilir hale getirilerek stil dosyası bütçenin altına indirildi; son build uyarısız.

## Gerçek API / tarayıcı smoke

Bu oturumda API, PostgreSQL veya tarayıcı başlatılmadı. Tüm HTTP davranışı `HttpTestingController` ile sözleşme biçiminde doğrulandı; gerçek `GET /api/runs/:id`, `POST /api/runs/:id/cancel`, `POST /api/runs` çağrıları ve gerçek tarayıcı görsel/klavye kontrolü bu belgede iddia edilmez.

Sonuç: bu görev **mock-tested** durumundadır. `crypto.randomUUID` anahtar üretimi, Angular form/DOM etkileşimi ve HTTP sözleşmesi test edildi; gerçek ağ, DB veya ekran okuyucu testi yapılmadı.

## Kalan riskler ve ertelenen işler

1. **Gerçek API/tarayıcı smoke yapılmadı.** İptal ve Run Again yalnızca mock HTTP ile doğrulandı. Gerçek API'nin 200/409/400 yanıtları ve terminal snapshot içeriği bu oturumda yeniden çalıştırılmadı.
2. **Aşama 3 demosu yapılmadı.** Başlat → canlı → iptal/kesinti → özet akışı gerçek tarayıcıda gösterilmedi; P3-10 doğrulama maddesi açık kaldı.
3. **Live Run hâlâ P4-04 placeholder'ı.** Run Again başarısında `/runs/:runId/live` adresine gidiliyor; gerçek canlı ekran gelene kadar kullanıcı orada placeholder görür. Bu kartın kapsamı dışındadır.
4. **Run Again yalnızca terminal çalıştırmada gösteriliyor.** `RUNNING` sırasında düğme yerine ne zaman açılacağını söyleyen bir not var; bu, her tıklamada `RUN_ALREADY_ACTIVE` üretecek bir aksiyondan kaçınmak için bilinçli bir tercihtir.
5. **App Shell aksiyonu `/plans`'a gidiyor.** Yayımlanmış sürüm seçimi Test Plans ekranında yapılıyor; global sürüm seçici eklenmedi.
6. **Ortak test dosyası güncellendi.** `app.routes.ts` değişmediği halde `routes.spec.ts` Run Details placeholder beklentisini ve gerçek ekranın `/api/runs/:id` isteğini yansıtacak şekilde güncellendi. Bu, sahiplik alanı dışındaki zorunlu test güncellemesidir.
7. **Erişilebilirlik gerçek tarayıcıda denenmedi.** Tablo caption/scope, dialog `autoFocus`, canlı bölge ve metin+ikon durum etiketleri uygulandı; klavye/ekran okuyucu doğrulaması P7-04 kapsamındadır.
8. **Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı.** Kart `In Review`; `Accepted` değil.
9. **`docs/tasks/README.md` ve `docs/roadmap.md` güncellenmedi.** Bu dosyalar görev sahipliği dışında bırakıldı; durum değişikliği lead commit'inde işlenmelidir. Commit/push da bu worker tarafından yapılmadı.
