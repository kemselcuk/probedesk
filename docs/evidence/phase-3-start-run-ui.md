# Phase 3 — Start Run UI kanıtı (P3-09)

- Tarih: 2026-11-03
- Kapsam: `/runs/new?versionId=...` Start Run ekranı, gerçek `POST /api/runs` bağlantısı, senaryo/seed/hata adımı/olasılık formu, rol görünürlüğü, idempotency davranışı ve hata yolları.
- Ortam: macOS 26.7.1 / arm64, Node.js 22.23.2, npm 10.9.8 (packageManager 11.6.2), Angular 22.2.4, Vitest 5.1.0 + TestBed + `HttpTestingController`.
- Uygulama commit'i: Bu çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge bir commit hash'i iddia etmez.
- Kapsam dışı: Canlı çalışma ekranının gerçek snapshot/SSE davranışı (P4-04), Run History/Details ve gerçek tarayıcı E2E testi (P7-01).

## Sonuç

Start Run ekranı yayımlanmış sürümü `GET /api/plan-versions/:id` üzerinden okuyor; plan adı, sürüm numarası, sıralı adım özeti ve nominal toplamları gösteriyor. Typed Reactive Form yalnızca seçilen senaryoya ait alanları gönderiyor. Başarılı `202`/`200` yanıtındaki gerçek `runId` ile `/runs/:runId/live` adresine geçiliyor; başarı tahmin edilmiyor.

`Idempotency-Key` her mantıksal deneme için bir kez üretiliyor. Aynı gövdeyle retry aynı anahtarı kullanıyor; senaryo/seed/ayarlar değişip yeni deneme gönderildiğinde yeni anahtar üretiliyor. Ağ hatası sonrası aynı isteğin tekrarı mevcut anahtarı koruyor.

Planner ve Viewer ekranı açabiliyor ancak ayarlar salt okunur ve başlatma düğmesi devre dışı. API'nin rol kontrolü değişmiyor: non-Operator gönderim yine `403 FORBIDDEN` alır. Bu nedenle `/runs/new` route'undaki `roleGuard(['OPERATOR'])` kaldırıldı; böylece istenen salt okunur açıklama gerçekten görülebiliyor.

## Eklenen ve değişen dosyalar

### Yeni

- `apps/web/src/app/features/runs/runs-api.types.ts`: `StartRunDto`, `RunStartResponseDto`, senaryo ve durum tipleri yalnızca generated `@probedesk/api-client` şemalarından alias.
- `apps/web/src/app/features/runs/runs-api.ts`: `POST /api/runs` sınırı; `Idempotency-Key` header'ı, 200/202 yanıt normalizasyonu ve UUID/durum/outcome doğrulaması. Eksik `runId`, bilinmeyen durum veya boş URL `MalformedApiResponseError` üretir.
- `apps/web/src/app/features/runs/run-start-form.ts`: typed form fabrikası, uint32 seed doğrulaması, 0–1 arası en fazla 6 ondalıklı olasılık doğrulaması, senaryo bazlı validator'lar, tam payload üretimi, rastgele uint32 seed ve idempotency denemesi yöneticisi.
- `apps/web/src/app/features/runs/runs.facade.ts`: start pending/error sinyalleri; `details.activeRunId` yalnızca güvenli bağlantı hedefi olarak okunur, diğer `details` alanları UI'a taşınmaz.
- `apps/web/src/app/features/runs/start-run-page.ts`, `.html`, `.scss`: sürüm yükleme, adım özeti, form, rol salt okunur durumu, hata panelleri, erişilebilir odak ve canlı ekrana yönlendirme.
- `apps/web/src/app/features/runs/run-start-form.spec.ts` (9 test): seed/olasılık sınırları, senaryo validator geçişleri, NORMAL/FORCED_FAILURE/RANDOM payload kesinliği, eksik değerde uydurma yapılmaması, anahtar tekrarı/yenilenmesi.
- `apps/web/src/app/features/runs/runs-api.spec.ts` (4 test): header/gövde, 202 oluşturma, 200 terminal replay, geçersiz `runId` ve bilinmeyen durum reddi.
- `apps/web/src/app/features/runs/start-run-page.spec.ts` (16 test): sürüm özeti, senaryo alan değişimi, üç payload, validasyon, seed üretimi, tek gönderim, ağ hatasında anahtar tekrarı, yeni denemede yeni anahtar, 409 aktif çalışma bağlantısı, 409 idempotency çakışması, 400 alan eşlemesi, Planner/Viewer salt okunur görünümü, 404 retry, eksik `versionId`, 202/200 yönlendirmesi, 401/403 yolları.
- `docs/evidence/phase-3-start-run-ui.md`: bu dosya.

### Değişen

- `apps/web/src/app/app.routes.ts`: `/runs/new` route'undan Operator guard'ı kaldırıldı; rol kontrolü ekran içinde salt okunur sunumla ve API'de kalıyor.
- `apps/web/src/app/features/routes.spec.ts`: P3-09 placeholder "task" beklentisi kaldırıldı; gerçek Start Run başlığı korunuyor.
- `apps/web/src/app/core/auth/auth.guards.spec.ts`: Viewer'ın Start Run'a yönlendirilmeden eriştiğini doğrulayan teste güncellendi. Bu dosya ve `routes.spec.ts`, route guard değişikliğinin zorunlu sonucu olarak dokunulan ortak testlerdir; başka bir worker'ın dosyası değildir.
- `docs/tasks/P3-09.md`: durum ve kanıt alanları.

Mevcut `plans-api.ts`/`plans.facade.ts` yayımlanmış sürüm okuması için yeniden kullanıldı; ikinci bir API modeli veya elle yazılmış sürüm DTO'su eklenmedi. Sürüm adımları `PlansFacade.loadVersion` üzerinden geliyor.

## Davranış

### Sürüm ve adım özeti

- `/runs/new?versionId=<uuid>` route'u `GET /api/plan-versions/:id` isteğini başlatır.
- Yüklenirken `Loading published version…`; yüklendiğinde plan adı, sürüm numarası, sürüm kimliği, sıralı adım tablosu (ad, birim, min, max, örnek sayısı, aralık) ve nominal toplamlar (adım, toplam örnek, nominal süre) görünür.
- Eksik `versionId` ayrı bir "Choose a published plan version" durumu; bilinmeyen/taslak sürüm `404` için "Published version not found" ve `Try again` gösterir. Diğer hatalar request ID'li genel hata durumuna düşer.
- Adımlar published revision sırasıyla `logicalStepId` üzerinden track edilir; frontend sıralama veya ölçüm kararı üretmez.

### Form ve payload

- NORMAL: `{planVersionId, scenario, seed}`.
- FORCED_FAILURE: `{planVersionId, scenario, seed, failureStepId}`; hata adımı seçenekleri görüntülenen sürümün adımlarından gelir.
- RANDOM: `{planVersionId, scenario, seed, errorProbability}`; olasılık ondalık metin olarak gönderilir, sayıya çevrilmez.
- Senaryo değişince o senaryoya ait olmayan alan temizlenir ve validator'ları kaldırılır; payload'a hiçbir zaman `undefined`/boş isteğe bağlı alan eklenmez.
- Seed `0–4294967295` aralığında tam sayı metni; olasılık `0–1` aralığında en fazla 6 ondalıklı kanonik ondalık metindir. Geçersiz değerlerde alan hatası İngilizce gösterilir ve submit devre dışı kalır.
- "Generate seed" `crypto.getRandomValues` ile uint32 üretir; varsayılan seed veya olasılık uydurulmaz.
- Form geçersizken, gönderim sürerken, sürüm yüklenmemişken veya kullanıcı Operator değilken submit devre dışıdır. İkinci submit aynı anda tek HTTP isteği üretir.

### Idempotency ve hatalar

- Anahtar `crypto.randomUUID` ile üretilir; `RunStartAttempt` aynı normalize gövde için anahtarı korur. Gövde değişirse yeni anahtar üretilir. Başarılı yanıttan sonra deneme durumu sıfırlanır.
- Ağ hatası veya `RUN_ALREADY_ACTIVE` sonrası aynı değerlerle retry aynı anahtarı kullanır; ayar değiştirilirse yeni anahtar kullanılır.
- `409 RUN_ALREADY_ACTIVE` yanıtındaki `details.activeRunId` doğrulanarak `/runs/:activeRunId/live` bağlantısı sunulur; `activeRunId` yoksa Run History bağlantısına düşülür.
- `409 IDEMPOTENCY_CONFLICT` "bu anahtar farklı istekle kullanılmış" açıklamasını ve yeni deneme için ayar değiştirme yönlendirmesini gösterir.
- `400 VALIDATION_ERROR` alan hataları `scenario`, `seed`, `failureStepId`, `errorProbability` yollarına bağlanır; eşlenemeyen yollar genel hata panelinde kalır. Form değerleri korunur.
- `401` oturum açma bağlantısı, `403` rol/CSRF açıklaması ve Test Plans'a dönüş bağlantısı sunar.
- `202` ve `200` yanıtlarında yalnızca doğrulanmış `runId` ile `/runs/:runId/live` adresine gidilir; canlı ekran P4-04 placeholder'ıdır.

## Çalıştırılan komutlar ve gerçek sonuçlar

Sıra: repo kökü, 2026-11-03.

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 7ms on 65 files with 93 rules using 8 threads.
```

```text
$ npm run typecheck --workspace apps/web
> tsc -p tsconfig.app.json --noEmit
(çıkış kodu 0; hata yok)
```

```text
$ npm run test --workspace apps/web
Test Files  20 passed (20)
Tests       154 passed (154)
Duration    5.52s
```

Önceki taban 125 test (17 dosya) korunmuştur; 3 yeni test dosyası ve 29 yeni test eklendi. Test dosyaları: `run-start-form.spec.ts` 9, `runs-api.spec.ts` 4, `start-run-page.spec.ts` 16.

```text
$ npm run build --workspace apps/web
Application bundle generation complete. [2.518 seconds]
Initial total: 325.65 kB | 90.88 kB
(warning/error yok)
```

## Gerçek API / tarayıcı smoke

Bu oturumda gerçek API ve yayımlanmış bir sürüm kullanılamadı. Makinede 3000 portunda dinleyen süreç `/health/live` için `404` döndürdü; bu, ProbeDesk API'si değildi. 3100 ve 4200 portlarında dinleyen süreç yoktu. Başka bir agent `apps/api` üzerinde eşzamanlı çalıştığı için API/DB veya dev-server başlatılmadı.

Sonuç: bu görev **mock-tested** durumdadır; gerçek API'ye giden istek, gerçek PostgreSQL kaydı veya tarayıcı görsel doğrulaması bu belgede iddia edilmez. `POST /api/runs`, `GET /api/plan-versions/:id` ve hata yanıtları `HttpTestingController` ile sözleşme biçiminde test edildi.

## Kalan riskler ve ertelenen işler

1. **Gerçek API smoke yapılmadı.** Yukarıdaki nedenle 202/409/400 yolları yalnızca mock HTTP ile doğrulandı. P3-04 API testleri gerçek PostgreSQL'de çalıştırılmış olsa da bu UI oturumu onları yeniden çalıştırmadı.
2. **App shell entegrasyonu bu kartın dosya sahipliği dışında.** `apps/web/src/app/layout/app-shell/*` içindeki Operator "Start run" aksiyonu hâlâ `disabled` ve "available with P3-09" metnini taşıyor; plan sürüm ekranından `/runs/new?versionId=...` bağlantısı da eklenmedi. Lead entegrasyonu veya ayrı bir küçük görev gerekir.
3. **Route guard değişikliği ortak testleri etkiledi.** `auth.guards.spec.ts` ve `routes.spec.ts` güncellendi. Bu değişiklik, Planner/Viewer'ın salt okunur ekranı görebilmesi için gerekliydi; API hâlâ non-Operator gönderimi 403 ile reddediyor.
4. **`activeRunId` ayrıntısı `HttpErrorNormalizer` dışında okunuyor.** Ortak normalizer yalnızca `reason`/`currentRevision` alanlarını taşıyor; bu ekran `details.activeRunId` alanını güvenli string olarak kendi facade'ında okuyor. Gelecekte ortak API error görünümü genişletilirse bu kod sadeleşebilir.
5. **Query param değişimi aynı component örneğinde yeniden yüklenmiyor.** Ekran `versionId` değerini route snapshot'ından alıyor. Normal deep link ve sayfa yenileme doğru çalışır; aynı route üzerinde yalnızca query değiştiren bir uygulama içi akış yoktur.
6. **Erişilebilirlik gerçek tarayıcıda denenmedi.** Alan hataları `mat-error` ile kontrol altında, form `fieldset` ve başlıklarla ilişkilendirildi; klavye ve ekran okuyucu kontrolü P7-04 kapsamındadır.
7. **Bağımsız teknik inceleme ve kullanıcı kabulü yapılmadı.** Kart `In Review`; `Accepted` değil.
8. **`docs/tasks/README.md` ve `docs/roadmap.md` güncellenmedi.** Bu dosyalar görev sahipliği dışında bırakıldı; durum değişikliği lead commit'inde işlenmelidir. Commit/push da bu worker tarafından yapılmadı.
