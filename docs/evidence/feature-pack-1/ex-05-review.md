# EX-05 — Bağımsız teknik inceleme (Cihaz ve run metadata frontend)

- Tarih: 2026-11-08
- İnceleme başlangıç commit'i: `11ba87de93ba12820882cce4f6aa7d3f80ec8f1f`
  (`feat: add filtered analytics overview with history drilldown`).
- İnceleme sırasında checkout `92027f71055b065c3fe5069d84931db86110cfcb`
  (`test: guard shared API bootstrap and verify analytics index contract`) commit'ine ilerledi.
  `git diff --name-only 11ba87d..92027f7 -- apps/web/src/app/features/devices
apps/web/src/app/features/runs apps/web/src/app/features/plans
apps/web/src/app/features/comparisons apps/web/src/app/app.routes.ts
apps/web/src/app/layout/app-shell` **boş**; EX-05 kapsamındaki web kodu iki commit'te aynıdır.
- Branch/origin: `feat/analytics-reporting-devices` / `origin/feat/analytics-reporting-devices`
  incelenen kod için aynıdır. Review dosyası yazılırken HEAD `92027f7` idi.
- İnceleme türü: **Bağımsız frontend kod, state, URL ve test incelemesi.** Ürün, görsel veya nihai
  yayın kabulü değildir.
- Kapsam: `apps/web/src/app/features/devices/**`; Start Run/Run Again, Live, Details, History ve
  Compare metadata entegrasyonu; device picker; `PlansFacade` sürüm durumu ve Published Version
  linkleri; devices/run/comparison runtime parser'ları; `f51cb35` düzeltmeleri.
- Kapsam dışı: EX-07 plan kopyalama UI, EX-09 Overview, EX-11 rapor/indirme UI, backend EX-03/04
  davranışının yeniden kabulü, gerçek browser/responsive/klavye/%200 zoom (EX-12).
- Kısıt: Repository içinde yalnızca bu dosya yazıldı. `git add`, `commit`, `push`, `checkout`,
  `reset`, `stash` çalıştırılmadı; subagent başlatılmadı. Dev/delivery DB'sine, `5434`/`5432`
  portlarına veya migration'a dokunulmadı. `openapi:check` çalıştırılmadı.

## Sonuç özeti

| Alan                              | Sonuç                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devices liste/ayrıntı/formlar     | **Geçti.** Liste, arama/state/page URL kaynağı, Planner create/edit diyaloğu, revision conflict, archive (restore aynı dialog yolu) ve salt okunur roller kod ve testlerle uyumlu; restore için ayrı UI testi yok.                                |
| Start / Run Again metadata        | **Geçti; L-1/L-2 düşük not.** Aktif/profil uyumlu cihaz seçimi, opsiyonel batch, archived cihazın engellenmesi, Run Again snapshot ve açık temizleme doğru. Cihaz önseçimi sözleşme ifadesiyle tam örtüşmüyor; geri linklerinde bağlam kaybı var. |
| History filtreleri ve URL         | **Geçti.** deviceId/batch/version/scenario/status/outcome/tarih/page URL'de taşınıyor; exact UTC sınırları korunuyor; stale yanıt sırası ve invalid URL uyarısı testli.                                                                           |
| Live / Details / Compare metadata | **Uygulama var; test kanıtı kısmi.** Details cihaz snapshot'ı testli; Live/Compare ve null “No device/No batch” etiketleri için doğrudan assertion yok (L-3).                                                                                     |
| Device picker                     | **Geçti; test boşluğu L-3.** Lazy list, server arama/sayfalama, archived/profil uyumsuzluğu, sayfa dışı seçim ve list iptali doğru. Seçim GET'i iptali ve profil değişiminde liste yenileme doğrudan test edilmiyor.                              |
| Runtime parser'lar                | **Geçti.** Devices required nullable alanları, UUID kimliği, Unicode code-point uzunluğu; run/comparison metadata'sında required nullable alanlar ve snapshot kimliği doğrulanıyor.                                                               |
| `f51cb35` düzeltmeleri            | **Kısmen geçti.** Cihaz bağlamlı Published Version linkleri ve Start batch server hatası testli. `loadVersions` stale/iptal düzeltmesi doğru; **`loadVersion` iptalinde aynı sınıf hata açık (M-1).**                                             |
| Web kalite kapısı                 | **Geçti (reviewer koşusu).** 43 dosya / 454 test, lint 144 dosya / 0 uyarı, typecheck ve production build exit 0.                                                                                                                                 |
| Browser / klavye / görsel         | **Yapılmadı; EX-12.** Bu review görsel veya responsive kabul iddiası taşımaz.                                                                                                                                                                     |
| Teknik kabul                      | **Henüz önerilmez.** M-1 kapatılmalı; L-3'teki null metadata testi eklenmeli. L-1/L-2/L-4 kabulü tek başına engellemez.                                                                                                                           |

## `f51cb35` doğrulaması

- **Cihaz bağlamlı Published Version linkleri:** `plan-version-page.html` “Back to plans”,
  “Open version N” ve published-versions linklerinde `deviceId` query'si korunuyor; mismatch/404
  geri linkleri de aynı bağlamı taşıyor. `plan-version-page.spec.ts:210-227` bu linkleri iki
  published sürümle doğruluyor. Hedefli koşuda **passed**.
- **PlansFacade stale/iptal yanıtları:** `plans.facade.ts:242-284` `versionsSequence`,
  plan kimliği ve `finalize` ile eski plan yanıtını/hatasını ve iptal sonrası takılı kalmayı
  engelliyor. `plan-versions-state.spec.ts:9-35` iki senaryoyu test ediyor; hedefli koşuda
  **passed**. Aynı koruma `loadVersion` için eksik (M-1).
- **Start Run metadata server hataları:** `start-run-page.html:240-247` deviceId/batchNumber
  field error'larını görünür kılıyor; `start-run-page.spec.ts:273-298` batch hatasının input
  değerini kaybetmeden göründüğünü doğruluyor. Hedefli koşuda **passed**; genel alan hata
  listesi hâlâ yalnız ilgili server error kontrolü varken gösteriliyor.

## İncelenen başlıca dosyalar

- Sözleşme/kanıt: `AGENTS.md`, `docs/implementation-guide.md`, `docs/feature-pack-1-plan.md`,
  `docs/tasks/EX-05.md`, `docs/tasks/README.md`, `docs/roadmap.md`,
  `docs/evidence/feature-pack-1/ex-05.md`, `docs/frontend.md`, `docs/api.md`,
  `docs/requirements.md`.
- Devices: `apps/web/src/app/features/devices/**` (11 dosya; page/detail/editor/archive dialogs,
  API/facades, picker ve spec'ler).
- Runs: `start-run-page.*`, `run-start-form.*`, `run-history-page.*`, `run-history.facade.ts`,
  `run-details-page.*`, `run-device-metadata.ts`, `run-metadata.*`, `runs-api.ts`,
  `runs-api.types.ts`, `runs.facade.ts`, `live-run-page.*`, `live-run.facade.ts`,
  `live-run.reducer.ts`, `run-rerun.ts` ve ilgili spec'ler.
- Comparisons: `compare-runs-page.*`, `comparisons-api.ts`, `comparisons-api.types.ts`,
  `comparisons-api.spec.ts`, `testing/comparison-fixtures.ts`.
- Plans/routing: `plan-version-page.*`, `plans.facade.ts`, `plans-list-page.*`,
  `plans-api.ts`, `plan-versions-state.spec.ts`, `app.routes.ts`, app-shell navigasyonu.
- Salt okunur sözleşme karşılaştırması: `apps/api/src/devices/**`,
  `apps/api/src/runs/dto/start-run.dto.ts`, `apps/api/src/runs/run-start.ts`,
  `apps/api/src/runs/runs.service.ts`, run history/snapshot/comparison DTO'ları ve
  `packages/api-client` generated tipleri.

## Bulgular

Kritik: **yok**. Yüksek: **yok**. Orta: **M-1**. Düşük: **L-1, L-2, L-3, L-4**.

### M-1 — Orta: `loadVersion` iptal edilen isteği sonsuz “loading” bırakıyor

**Dosya/satır:**

- `apps/web/src/app/features/plans/plans.facade.ts:287-315`: `loadVersion`, aynı `versionId`
  için `versionStatus === 'loading'` ve `versionState === null` olduğunda `EMPTY` döndürüyor;
  isteğin `finalize`/sequence koruması yok.
- `apps/web/src/app/features/plans/plan-version-page.ts:155-169`: `switchMap`/`takeUntilDestroyed`
  route değişiminde bu isteği iptal ediyor; facade'da durum `loading` kalıyor.
- `apps/web/src/app/features/runs/start-run-page.ts:267-276`: Start Run aynı facade metodunu
  kullanıyor; `start-run-page.html:404-406` `loading` durumunu “Loading published version…” olarak
  gösteriyor ve bu durumda retry düğmesi yok.

**Gerçek durum:** Kullanıcı `/runs/new?versionId=V` veya `/plans/P/versions/V` ekranını açıp
yanıt gelmeden “Back to plans”/başka route'a geçerse HTTP isteği iptal edilir; `versionStatus`
`loading`, `versionId = V`, `versionState = null` kalır. Aynı `V` ile Start Run tekrar açıldığında
`loadVersion(V)` yukarıdaki erken dönüş nedeniyle `EMPTY` üretir; **yeni istek atılmaz**, sayfa
sürekli loading'de kalır. `retryVersion()` yalnız `error` durumunda göründüğü için kullanıcı bu
ekrandan kurtulamaz; tam sayfa yenileme veya farklı bir sürüme gitmek gerekir.

Bu, `f51cb35`'in `loadVersions` için eklediği `versionsSequence` + `finalize` düzeltmesinin
(`plans.facade.ts:258-282`) kardeş metotta uygulanmamış halidir. İptal edilen istekten sonra aynı
kimlikle yeniden yükleme testi de yoktur.

Aynı eksik, ikinci bir yol daha üretiyor: `plan-version-page.ts:172-177` içindeki `retryVersion`
aboneliği route `switchMap`'inin dışındadır. Hata ekranında “Try again”e basıldıktan sonra aynı
bileşen üzerinde başka bir sürüme geçilirse eski istek iptal edilmez; `loadVersion` yanıtı
sequence ile reddedilmediği için geç gelen eski sürüm `versionState`'i ezebilir. Aynı plan
içindeki iki sürümde `versionPlanMismatch()` yalnız `planId`'yi kontrol ettiğinden URL sürüm B
iken ekranda A sürümü görünebilir. Regresyon testi, eski sürümün geç yanıtının yeni sürüm
state'ini ezmediğini de kapsamalıdır.

**Yeniden üretim (kod incelemesi):** `loadVersion('V')` çağrısını abonelikten çıkarın; ardından
aynı `versionId` ile tekrar çağırın. İlk çağrı `loading` bıraktığı için ikinci çağrı `EMPTY`
döner. Bu senaryo için mevcut web suite'inde test bulunmuyor; yalnız review dosyası yazma
kısıtı nedeniyle ek geçici spec oluşturulmadı.

**Öneri:** `loadVersions` ile aynı deseni uygula: istek sequence'i, stale yanıt kontrolü ve
`finalize` içinde yalnız güncel istek hâlâ `loading` ise `idle`'a dönüş. Mümkünse aynı anda gelen
aynı-ID çağrıları tek in-flight isteği paylaşsın. Savunma olarak `versionPlanMismatch()` veya
render guard'ı `version.id === this.versionId` kontrolünü de içermeli. Regresyon testi: isteği
başlat, aboneliği iptal et, `versionStatus === 'idle'` doğrula, aynı ID ile yeniden yükle ve yeni
HTTP isteği geldiğini assert et; ayrıca eski ID'nin geç yanıtının yeni sürümü ezmediğini doğrula.

**Kabul etkisi:** Orta. Veri bozulması yok, ancak sık kullanılan bir geri/ileri akışında Start Run
ve Published Version ekranı kalıcı loading'e takılabilir. Teknik kabulden önce kapatılmalıdır.

### L-1 — Düşük: Açık “geri” linkleri URL bağlamını kaybediyor

**Dosya/satır:**

- `apps/web/src/app/features/runs/start-run-page.html:5`: Start Run “Back to plans” linki
  `deviceId` query'sini taşımıyor. Aynı durum 403 `:270` ve sürüm 404 `:389` “Back to Test Plans”
  linklerinde de var.
- `apps/web/src/app/features/runs/run-details-page.html:2` ve
  `apps/web/src/app/features/runs/live-run-page.html:2`: “Back to Run History” linkleri
  `/runs`'a filtersiz dönüyor.
- `apps/web/src/app/features/devices/device-detail-page.ts:43`: “Back to devices” linki
  liste arama/state/page query'sini taşımıyor.

**Gerçek durum:** Tarayıcı Back'i önceki URL'yi geri getirdiği için filtreler korunur; ancak
sayfadaki açık “geri” linki yeni bir `/runs` veya `/devices` navigasyonu üretir ve URL bağlamını
kaybeder. Özellikle cihaz ayrıntısından gelen Operatör zincirinde (`/plans?deviceId` →
`/plans/P/versions/V?deviceId` → `/runs/new?versionId=V&deviceId`) Start Run'daki geri linki
`deviceId`'yi düşürür; plan listesindeki cihaz bağlamı ve sonraki sürüm/start linkleri artık
cihazı taşımaz. `f51cb35` Published Version sayfasındaki aynı sınıf hatayı düzeltmiş; Start Run
ve liste/detay geri linkleri bu turda ele alınmamıştır.

**Öneri:** Start Run'da `metadataForm.controls.deviceId.value` doluysa geri linklerine
`[queryParams]="{ deviceId: ... }"` ekle. Run Details/Live için dönüş URL'sini router state veya
query ile taşı; cihaz listesi için `q/state/page` parametrelerini koru. En az bir hedefli test,
`deviceId`'li Start Run geri linkinin `href`'inde `deviceId` bulunduğunu doğrulamalı.

**Kabul etkisi:** Düşük; veri kaybı yok, tarayıcı Back'i kullanılabilir. Ancak cihaz bağlamı
zincirinin bir parçası olduğu için tercihen M-1 ile aynı düzeltme turunda ele alınmalıdır.

### L-2 — Düşük: Start Run geçersiz `deviceId` önseçimi sözleşme ifadesinden farklı davranıyor

**Dosya/satır:**

- `apps/web/src/app/features/runs/start-run-page.ts:75-85`: `deviceId` URL'den koşulsuz olarak
  forma alınıyor; `deviceValid` yalnız değer varsa `false` başlıyor.
- `apps/web/src/app/features/devices/device-picker.facade.ts:27-35`: arşivli veya farklı profilli
  cihaz seçili kalıyor, hata metni üretiliyor; form geçersiz sayılıyor.
- `docs/feature-pack-1-plan.md:91,233` (4.2/8): “Device URL'sinden Start Run'a geçilirse
  `deviceId` önseçimi **yalnız aktif/profil uyumlu olduğunda uygulanır**.”
- `docs/evidence/feature-pack-1/ex-05.md:33`: uygulama davranışı “arşiv/mismatch sessizce
  kaldırılmaz” olarak kaydedilmiş.

**Gerçek durum:** Uygulama güvenli tarafta kalıyor; arşivli/profil uyumsuz cihazla run
başlatılamıyor ve kullanıcıya açık hata veriliyor. Ancak sözleşme, uyumsuz önseçimin
**uygulanmamasını** söylüyor; mevcut davranış onu uygulayıp gönderimi bloke ediyor. Bu bir ürün
davranışı farkıdır; güvenlik açığı değildir.

**Öneri:** İki yoldan biri seçilmeli: (a) uyumsuz URL cihazını önseçmeden bırak ve “bu cihaz
arşivli/profili uyumsuz olduğu için önseçilmedi” açıklaması göster; ya da (b) sözleşme/kanıt
metnini “uyumsuz cihaz seçili gösterilir, açık hata ile bloke edilir” olarak lead onayıyla
güncelle. Sessiz kaldırma yerine açıklamalı davranış tercih edilmelidir.

**Kabul etkisi:** Düşük; lead'in sözleşme yorumuna bağlı. EX-05 kabulünden önce karar
kaydedilmelidir.

### L-3 — Düşük: Null metadata, Live/Compare ve picker iptal testleri eksik

**Dosya/satır:**

- `apps/web/src/app/features/runs/run-device-metadata.ts:6-18`: “No device recorded” / “No batch
  recorded” etiketleri.
- `apps/web/src/app/features/runs/run-history-page.html:364-371`: aynı null etiketleri satır
  bazında.
- `apps/web/src/app/features/runs/run-details-page.html:237`,
  `apps/web/src/app/features/runs/live-run-page.html:207`,
  `apps/web/src/app/features/comparisons/compare-runs-page.html:202`: ortak metadata bileşeni.
- `apps/web/src/app/features/devices/device-picker.spec.ts`: archived/profil/sayfa dışı testleri
  var; seçim GET'i iptali ve profil değişiminde liste reload testi yok.
- `apps/web/src/app/features/devices/devices.spec.ts`: device list URL isteği ve roller testli;
  invalid URL, sayfa dışı, boş/error durumları testli değil.

**Gerçek durum:** `grep -rn "No device recorded\|No batch recorded"
apps/web/src --include='*.spec.ts'` **hiç eşleşme döndürmedi**. Live/Compare spec fixture'ları
`deviceSnapshot: null` kullanıyor ancak null etiketlerini assert etmiyor; Details testi yalnız
dolu cihaz adını kontrol ediyor. Bu nedenle kanıt dosyasındaki “null metadata için açık No
device/No batch metni” ve kartın üçüncü kabul ölçütündeki “null geçmiş … testli” ifadesi
doğrudan web testiyle desteklenmiyor.

**Öneri:** Ortak `RunDeviceMetadata` için null ve dolu metadata testi; History satırında null
etiket testi; Compare/Live kartında dolu snapshot testi; DevicePicker seçim iptali ve profil
değişimi testi ekle. Browser/klavye kısmı EX-12'de kalır.

**Kabul etkisi:** Düşük/kanıt eksiği. Kod doğru görünüyor; ancak kabul ölçütü “testli” olduğu
için test eklenmeden tam kabul edilmemelidir.

### L-4 — Düşük: Seçili cihaz GET'i hata verince dropdown seçeneği “Checking…” metninde kalıyor

**Dosya/satır:**

- `apps/web/src/app/features/devices/device-picker.ts:45-49`: seçili cihaz sayfada yoksa
  sentetik `mat-option` etiketi `selection.device()?.name ?? 'Selected device'` ve
  `selection.device()?.serialNumber ?? 'Checking…'` kullanıyor.
- Aynı dosya `:83-93`: `selection.error()` durumunda hata ve “Retry device” gösteriliyor.

**Gerçek durum:** Seçili cihaz GET'i 404/400/ağ hatası verirse `selection.device()` null,
`selection.checking()` false, `selection.error()` doludur. Buna rağmen sentetik seçenek hâlâ
“Selected device · Checking…” gösterir; hata mesajı ayrı satırdadır. Kullanıcı için metin
yanıltıcıdır (sonsuz kontrol izlenimi).

**Öneri:** Etiketi üç duruma ayır: `checking` → “Checking…”, `error` → “Selected device
(unavailable)” / “Seçili cihaz yüklenemedi”, başarı → ad · seri. Küçük bir picker testi ekle.

**Kabul etkisi:** Düşük; yalnız hata durumunda metin.

## Reviewer tarafından gerçekten çalıştırılan kontroller

Aşağıdaki komutlar bu inceleme sırasında çalıştırılmıştır; sonuçlar gerçek çıktılardır.
URL/credential yazdırılmamıştır; veritabanı kullanılmamıştır. Test, lint, typecheck ve build
ölçümleri 2026-11-08 15:04–15:09 aralığında, EX-05 kapsamı temizken alınmıştır; EX-11 worktree
değişiklikleri bu ölçümlerden sonra başlamıştır.

| Kontrol                   | Komut / yöntem                                                                                                                                                                                                                                                                                                                                                                           | Gerçek sonuç                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HEAD/branch/origin        | `git rev-parse HEAD`; `git rev-parse origin/feat/analytics-reporting-devices`; `git branch --show-current`                                                                                                                                                                                                                                                                               | Başlangıç `11ba87d`; final HEAD/origin `92027f7`; branch `feat/analytics-reporting-devices`.                                                                                                                                                                                                                                                                          |
| EX-05 kapsam diff'i       | `git diff --name-only 11ba87d..92027f7 -- apps/web/src/app/features/devices apps/web/src/app/features/runs apps/web/src/app/features/plans apps/web/src/app/features/comparisons apps/web/src/app/app.routes.ts apps/web/src/app/layout/app-shell`                                                                                                                                       | Çıktı yok; EX-05 web kodu iki commit'te aynı.                                                                                                                                                                                                                                                                                                                         |
| Değişen dosyalar          | `git show --stat --oneline f51cb35`; `git show --stat --oneline 427b9ac`; `git show --stat --oneline 4a409cf`; `git show --stat --oneline d81270a`                                                                                                                                                                                                                                       | `f51cb35` 7 dosya; `427b9ac` 25 dosya; `4a409cf` 12 dosya; `d81270a` 19 dosya. Review kapsamı bu UI/metadata dilimleridir.                                                                                                                                                                                                                                            |
| Hedefli web testleri      | `npx ng test --watch=false --include='src/app/features/devices/**/*.spec.ts' --include='src/app/features/runs/start-run-page.spec.ts' --include='src/app/features/runs/run-history-page.spec.ts' --include='src/app/features/runs/run-details-page.spec.ts' --include='src/app/features/plans/plan-version-page.spec.ts' --include='src/app/features/plans/plan-versions-state.spec.ts'` | **7 dosya / 111 test passed**, 5.32 s, **exit 0**. Devices, Start, History, Details, Plan Version ve f51cb35 regresyonları dahil.                                                                                                                                                                                                                                     |
| Tam web suite             | `npm run test:web`                                                                                                                                                                                                                                                                                                                                                                       | **43 dosya / 454 test passed**, 6.72 s, **exit 0**. Lead'in devralınan 43/454 iddiası bağımsız olarak yeniden üretildi.                                                                                                                                                                                                                                               |
| Web lint                  | `npm run lint --workspace apps/web`                                                                                                                                                                                                                                                                                                                                                      | **144 dosya, 0 warning / 0 error**, 35 ms, **exit 0**.                                                                                                                                                                                                                                                                                                                |
| Web typecheck             | `npm run typecheck --workspace apps/web`                                                                                                                                                                                                                                                                                                                                                 | Çıktı yok, **exit 0**.                                                                                                                                                                                                                                                                                                                                                |
| Web build                 | `npm run build --workspace apps/web`                                                                                                                                                                                                                                                                                                                                                     | **exit 0**; initial total **353.19 kB**; lazy chunks üretildi; budget hatası yok.                                                                                                                                                                                                                                                                                     |
| Null etiket test taraması | `grep -rn -e "No device recorded" -e "No batch recorded" apps/web/src --include='*.spec.ts'`                                                                                                                                                                                                                                                                                             | **Eşleşme yok**; null metadata etiketleri için web assertion'ı bulunmuyor (L-3).                                                                                                                                                                                                                                                                                      |
| Whitespace                | `git diff --check` (ölçüm anında)                                                                                                                                                                                                                                                                                                                                                        | Çıktı yok, **exit 0**.                                                                                                                                                                                                                                                                                                                                                |
| Çalışma ağacı             | `git status --short`                                                                                                                                                                                                                                                                                                                                                                     | Başlangıçta temizdi; web ölçümleri bu temiz ağaçta alındı. Review sonunda başka worker'ın EX-11 worktree değişiklikleri (`runs-api.ts`, `run-details-page.*`, `app.routes.ts`, `styles.scss`, `features/reports/`) ve `docs/evidence/feature-pack-1/ex-09-review.md` untracked dosyası görüldü; bunlar EX-05 review kapsamı dışıdır ve reviewer tarafından yazılmadı. |

## Devralınan ve çalıştırılmayan kontroller

Aşağıdakiler **bu incelemede çalıştırılmadı**; lead/worker kayıtlarından devralınmıştır ve
bağımsız doğrulama sayılmaz:

- API unit/integration/e2e, gerçek PostgreSQL migration/constraint testleri ve
  `npm run openapi:check`. EX-03/04 backend kabulü bu review'un konusu değildir; API sözleşmesi
  yalnız frontend tipleri ve DTO alanları için okundu.
- Playwright, gerçek tarayıcı, responsive 1440/1280/768/390, klavye, %200 zoom, ekran okuyucu ve
  görsel kabul. Bunlar EX-12 kapsamındadır; bu belge görsel kabul iddiası taşımaz.
- CI workflow, delivery/Compose ve `localhost:8080` smoke testi.
- Gerçek kullanıcı akışının uçtan uca (Planner create/edit → Operator run → Viewer rapor) browser
  doğrulaması.
- EX-07 plan copy UI, EX-09 Overview, EX-11 rapor/indirme/print.

Lead'in önceki kanıtındaki `41 dosya/430 passed`, `40 dosya/421 passed` gibi sayılar tarihsel
dilimlerdir; bu incelemede güncel ağaçta 43/454 doğrulandı. Lint dosya sayısı 144'tür; eski
kanıttaki 136/132 sayıları önceki dilimlere aittir.

## Sınırlar

- M-1 kod incelemesiyle bulundu. Yalnız review dosyası yazma kısıtı nedeniyle geçici bir test
  dosyası oluşturup runtime repro yapılmadı; mevcut suite'te bu senaryo yoktur. Bulgu, facade
  state machine'inin doğrudan okunmasına dayanır.
- L-3'teki test boşlukları `grep` ve spec dosyalarının okunmasıyla doğrulandı; kodun çalışma
  zamanı davranışı ayrıca browser'da denenmedi.
- İnceleme sırasında shared checkout'ta EX-08 acceptance commit'i ve EX-11 worktree değişiklikleri
  oluştu. `11ba87d..92027f7` aralığında EX-05 dosyaları değişmedi; ancak review tamamlanırken
  EX-11 aynı `runs` yolundaki bazı dosyalara (ör. `runs-api.ts`, `run-details-page.*`,
  `app.routes.ts`, `styles.scss`) worktree düzeyinde dokunmaya başladı. Bu review yalnız baseline
  EX-05 kodunu ve baseline satır numaralarını değerlendirir; concurrent EX-11 diff'i kapsam dışıdır.
- Ürün ve görsel kabul kullanıcıya aittir; bu belge onu vermez.

## Kabul önerisi

**EX-05 henüz teknik olarak `Accepted` edilmemelidir.** Kritik veya yüksek bulgu yoktur; ancak
**M-1** orta bulgusu kapatılmadan Start Run/Published Version akışında kalıcı loading riski
vardır. M-1 için `loadVersion` sequence/finalize düzeltmesi ve iptal-sonrası aynı-ID reload
regresyonu eklenmelidir.

Kabul için önerilen koşullar:

1. **M-1** düzeltilmeli; iptal edilen `loadVersion` isteği state'i `idle`'a döndürmeli ve aynı
   sürüm yeniden yüklenebilmeli. Stale yanıtın yeni sürümü ezmediği de test edilmeli.
2. **L-3** kapsamında en az null metadata etiketleri (History + ortak `RunDeviceMetadata`) ve
   Live/Compare dolu snapshot testi eklenmeli; böylece “null geçmiş testli” kanıtı tamamlanmalı.
3. **L-1** cihaz bağlamlı geri linkleri tercihen aynı düzeltmede ele alınmalı; en az Start Run
   `deviceId`'yi korumalı.
4. **L-2** için sözleşme yorumu lead tarafından netleştirilmeli (uyumsuz önseçimi bırak veya
   davranışı sözleşmeye yaz).
5. **L-4** küçük metin düzeltmesi takip commit'inde yapılabilir; kabulü tek başına engellemez.
6. Browser/responsive/klavye/%200 zoom ve gerçek E2E EX-12'de ayrıca doğrulanmalı; bu review
   onları yapılmış saymaz. Kullanıcı görsel/ürün kabulü ayrıdır.

Bu koşullar sağlandığında EX-05'in kod düzeyi 1. ve 2. kabul ölçütleri karşılanmış olur; üçüncü
ölçütün görsel/klavye kısmı EX-12 kapısına bağlı kalır. Reviewer görev kartı durumunu değiştirmedi;
`Accepted` kararı lead'e ve nihai ürün kabulü kullanıcıya aittir.
