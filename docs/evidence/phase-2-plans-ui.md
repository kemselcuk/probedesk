# Phase 2 plan UI kanıtı

- Tarih: 2026-11-03
- Kapsam: P2-03 (Test Plans ekranı), P2-04 (typed dinamik adım formu), P2-05 (sıralama ve düzenleme güvenliği).
- Ortam: Node.js 22.23.2; Angular 22.2.4; geliştirme PostgreSQL 18 `127.0.0.1:5434`; Chromium 156 (başsız Chrome DevTools protokolü).
- Uygulama commit'i: Bu çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge bir commit hash'i iddia etmez.
- Kapsam dışı: Publish, yeni taslak oluşturma ve yayımlanmış sürüm ekranı. Bu girişler P2-07 olarak işaretlenmiş placeholder olarak bırakıldı.

## Uygulanan yüzey

| Dosya | Davranış |
|---|---|
| `apps/web/src/app/features/plans/plans.facade.ts` | Signal + RxJS durumu: liste, profil, detay, create/save pending ve hata durumları. |
| `apps/web/src/app/features/plans/plans-api.ts` | Tek HTTP sınırı; generated `@probedesk/api-client` DTO'larını kullanan view model normalizasyonu. |
| `apps/web/src/app/features/plans/plans-list-page.*` | Role uygun liste, loading/empty/error/retry/refresh, Planner inline create formu, sürüm ve edit bağlantıları. |
| `apps/web/src/app/features/plans/plan-editor-page.*` | Non-nullable typed FormGroup/FormArray, alan ve toplam doğrulaması, CDK drag-drop, klavye taşıma, kaydetme ve 409 güvenliği. |
| `apps/web/src/app/features/plans/plan-draft-form.ts` | Kanonik ondalık doğrulaması (ölçekli `bigint`), adım/toplam limitleri, payload trim ve fingerprint. |
| `apps/web/src/app/features/plans/discard-changes-dialog.ts`, `unsaved-changes.guard.ts` | Erişilebilir "Leave without saving?" onayı ve `canDeactivate` guard'ı. |
| `apps/web/src/app/app.routes.ts`, `plan-version-page.ts`, `layout/app-shell/*` | Gerçek sayfalara bağlanan route'lar, P2-07 sürüm placeholder'ı ve çalışan Planner "New plan" girişi. |

`plans-api.types.ts` artık tel biçimlerini elle tanımlamıyor; `@probedesk/api-client` içindeki
generated DTO'ları temel alıp yalnız liste ekranının "draft bilgisi gönderildi mi?" görünüm
modelini ekliyor.

## Çalıştırılan komutlar ve gerçek çıktılar

```text
$ npm run lint --workspace apps/web
Found 0 warnings and 0 errors.
Finished in 33ms on 52 files with 93 rules using 8 threads.

$ npm run typecheck --workspace apps/web
tsc -p tsconfig.app.json --noEmit
(çıkış kodu 0; hata yok)

$ npm run test --workspace apps/web
Test Files  15 passed (15)
Tests       96 passed (96)
Start at    16:19:14
Duration    3.76s

$ npm run build --workspace apps/web
Application bundle generation complete. [3.445 seconds]
Initial total: 315.78 kB | 87.90 kB
(warning/error yok)
```

## Gerçek API + dev-server smoke

Port 3000 bu makinede başka bir uygulama tarafından kullanıldığı için API derlenmiş çıktısı
`PORT=3100 node dist/main.js` ile, Angular ise `ng serve --port 4200` ve repo dışında geçici bir
`/api -> 127.0.0.1:3100` proxy dosyasıyla çalıştırıldı. Böylece tarayıcı istekleri gerçek Angular
dev sunucusundan, gerçek API'ye ve gerçek PostgreSQL'e gitti.

### HTTP sözleşmesi

| Kontrol | Gerçek sonuç |
|---|---|
| `GET /api/device-profiles` (Planner) | `DC Power Module`, code `DC_POWER_MODULE`. |
| `POST /api/plans` | 201; yeni plan + `draft.editRevision=1`, boş adımlar. |
| `PUT /api/plans/:id/draft` (2 adım, `expectedRevision=1`) | 200; `editRevision=2`; sunucu `logicalStepId` üretti; pozisyonlar 1 ve 2; ondalıklar `"4.750000"` / `"0.100000"` olarak döndü. |
| Aynı gövde, eski `expectedRevision=1` | 409 `DRAFT_CONFLICT`; `GET` sonrası kayıt `editRevision=2` ve 2 adım olarak değişmeden kaldı. |
| Viewer `GET /api/plans` | `[]` (yalnız taslak olan plan sızmadı). |
| Viewer `GET /api/plans/:id` | 404 `NOT_FOUND`. |
| Viewer `POST /api/plans` | 403 `FORBIDDEN`. |

### Gerçek tarayıcı akışı (Chromium, gerçek DOM)

1. Planner login; `/plans` satırı: `Smoke plan 160918`, `Draft in progress`, `Revision 2`,
   `Edit draft` ve `Not published yet`.
2. Editör: plan adı, iki adımın alanları (`4.750000`, `5.250000`, `0.100000`, `2.000000`),
   toplamlar `15 / 10,000` ve `20.0 s`.
3. Klavye erişimli **Move step 2 up** düğmesi + yeni adım ekleme + kaydetme: snackbar
   `Draft saved.`, revizyon `3`, adım sırası `Current`, `Output voltage`, `Resistance`.
4. Başka bir oturum taslağı revizyon 4'e taşıdı; formdaki yerel ada kaydetme denemesi:
   panel `This draft changed in another session`, yerel ad **korundu**, request ID gösterildi.
   `Reload saved draft` → `Discard and reload` sonrası ad sunucudaki değere döndü, revizyon 4.
5. Kirli formdan `/plans`'a gitme: dialog `Leave without saving?`; `role="dialog"`,
   `aria-labelledby="discard-changes-title"`, ilk odak `Keep editing`. `Keep editing` URL'yi
   korudu; ikinci denemede `Discard changes` listeye geçti ve revizyon 4 göründü.
6. Viewer login: liste boş, `New plan` yok, `Draft in progress`/`Edit draft` yok, tablo yok;
   editör URL'sine doğrudan gitme `/not-authorized` sayfasına yönlendirildi.

Smoke sonunda oluşturulan plan yalnız kendi kimliğiyle (`a194632d-4cab-46ff-9ced-84bff80793f4`)
`plan_steps → step_identities → plan_revisions → test_plans` sırasıyla silindi; geliştirme
veritabanında smoke planı bırakılmadı. API, web ve Chrome süreçleri kapatıldı.

## Test kapsamı

- `plans-list-page.spec.ts`: loading, empty, API hatası + request ID + retry, refresh, shell
  `?create=1` girişi, Planner/Viewer görünürlüğü, tablo semantiği, create akışı, create doğrulaması
  ve server alan hatası.
- `plan-editor-page.spec.ts`: draft yükleme, sıralı payload, `expectedRevision`, yeni adım
  kimliklerinin forma geri bağlanması, ondalık/aralık/örnek/aralık limitleri, toplam süre hatası,
  boş taslak kaydı, 409'da yerel girdinin korunması, onaylı reload, reorder sonrası server alan
  eşlemesi, dirty guard, ekleme/silme/taşıma sonrası değer/hata/odak korunması, 404/retry,
  no-draft görünümü, 30 adım/toplam limit görünümü ve Viewer yönlendirmesi.
- `plan-draft-form.spec.ts`: kanonik ondalık (baş sıfır, üs, virgül, 6 hane), tam `bigint`
  min/max karşılaştırması, 30 adım, 10.000 örnek, 600.000 ms sınırları, trim, payload ve fingerprint.
- `plans-api.spec.ts`: liste envelope/draft null-nesne ayrımı, profil listesi, detay/envelope,
  create, save gövdesi ve yanıt normalizasyonu.
- Mevcut `routes.spec.ts`, `app-shell.spec.ts`, `auth.guards.spec.ts`, `login-page.spec.ts` ve
  `app.spec.ts` gerçek plan ekranlarının başlattığı veri isteklerine göre güncellendi; 58 eski test
  korunurken toplam 96 test geçti.

## Doğrulanamayanlar ve ertelenen işler

1. **Bağımsız teknik inceleme** yapılmadı. Üç kart da `In Review`; hiçbiri `Accepted` değil.
2. **Fare ile CDK drag-drop hareketi** bu oturumda gerçek pointer ile çalıştırılmadı. CDK drop-list
   bağlantısı ve FormArray sırası kodda mevcut; klavye **Move up/down** yolu, DOM sırası, FormArray
   ve kaydetme payload sırası test edildi. Gerçek drag jesti P7-04/P2-08 tarayıcı kontrolüne kalır.
3. **Publish ve sürüm ekranı** P2-07 kapsamındadır. Editörde Publish devre dışı ve "available with
   P2-07" açıklamasıyla, sürüm sayfası placeholder olarak bırakıldı; publish isteği gönderilmedi.
4. **Playwright uçtan uca test** (P7-01) ve P2-08 API entegrasyon testi çalıştırılmadı. Buradaki
   gerçek tarayıcı kontrolü commit edilmiş bir test değil, tek seferlik smoke kanıtıdır.
5. **Ekran görüntüsü/video** kaydedilmedi; tarayıcı kanıtı DOM metni ve gerçek HTTP yanıtlarıdır.
6. **T17'nin DB pozisyon okuması** ayrıca bu smoke'ta sorgulanmadı; sıra, UI payload testiyle
   doğrulandı. P2-02 kanıt dosyasındaki API e2e testleri sıra sözleşmesini kapsıyor ancak bu
   oturumda yeniden çalıştırılmadı. Bu oturumda UI reorder + save gerçek API'de başarıyla
   tamamlandı, ancak kaydedilen satırların `position` değerleri smoke içinde tekrar okunmadı.
7. Root `npm run verify`, `npm ci` ve tüm workspace kontrolleri çalıştırılmadı; bu görev yalnız
   `apps/web` kapsamında doğrulandı. API agent'ının eşzamanlı değişiklikleri nedeniyle kök build
   sonucu bu belgeye yazılmadı.
