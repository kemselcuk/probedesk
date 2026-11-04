# Phase 8 — bağımsız teknik inceleme (P8-01…P8-05)

- Tarih: 2026-11-04
- İnceleme commit'i: `ac571cc` (`docs: add README, demo guide and delivery documentation`)
- İnceleme türü: **Bağımsız teknik inceleme.** Bu belge ürün kabulü, kullanıcı kabulü veya
  yayın kararı değildir. P8-06 tamamlanmamıştır; tamamlanmış gibi değerlendirilmemiştir.
- Ortam: macOS 26.7.1 (25G241), arm64; Docker 29.9.2, Docker Compose v5.6.1; host Node
  `v22.23.2`, npm `11.6.2`. Delivery doğrulamaları container içinde yapıldı; host Node/PG
  delivery çalışma zamanına bağlanmadı.
- Ürün kodu değiştirilmedi. Yalnızca bu dosya yazıldı. `git status` inceleme sonunda temizdir.

## Yöntem ve veri güvenliği

- Mevcut delivery stack'i (`http://127.0.0.1:8080`, `probedesk_delivery_check`) salt-okunur
  incelendi; kullanıcı volume'üne (`probedesk-postgres-data`) ve geliştirme veritabanına
  dokunulmadı.
- P8-01/P8-03 için aynı `compose.yaml` servislerinin izole bir kopyası kullanıldı:
  proje adı `probedesk-review`, web portu `18080`, PostgreSQL portu `15434`, ayrı volume
  `probedesk-review-postgres-data` ve boş `probedesk` veritabanı. Bu, kullanıcı verisini
  silmeden temiz kurulum ve restart testi yapmayı sağladı; iş bitiminde `down -v` ile yalnızca
  bu izole proje silindi.
- İzole stack'te migration + seed + API + web build/start, gerçek HTTP/SSE, gerçek Chromium
  (Playwright `channel: chrome`) ve gerçek PostgreSQL kullanıldı. Mock kullanılmadı.
- Mevcut stack'te toplamlar inceleme sonunda değişmedi: `users=3`, `plans=1`, `runs=4`.

## Sonuç özeti

| Görev | Sonuç | Kısa gerekçe |
|---|---|---|
| P8-01 | **Koşullu geçti** | Compose, health, proxy, SPA deep link, SSE buffering, tek API süreci ve volume davranışı çalışıyor. "Host'ta Node/PG olmadan" kabul koşulu gerçekten çalıştırılmadı; kanıtlar birbiriyle çelişiyor (H-3). |
| P8-02 | **Geçti** | Seed iki kez çalıştırıldı; kullanıcı/profil/plan/sürüm/run/ölçüm/olay satırları değişmedi. FAILED örnek 14 `0.600000`, v1/v2 tolerans farkı ve kısmi run doğru. Düşük kanıt-eskiği ve log gürültüsü var (M-1, L-2). |
| P8-03 | **Koşullu geçti** | Boş veritabanında migrate + seed + API + web zinciri ve `down`/`up` sonrası kalıcılık izole stack'te doğrulandı. Belgelenen giriş noktasının birebir aynısı ve boş host senaryosu çalıştırılmadı; karttaki kabul kutuları açık. |
| P8-04 | **Başarısız** | README/docs komutları ve bağlantıları büyük ölçüde doğru; ancak video/P7/P8 durumları çok sayıda belgede çelişiyor, `ps` komutu yanlış ve `npm run dev` tek parça doğrulanmamış (H-2). |
| P8-05 | **Başarısız** | Video açılıyor ve gerçek veri gösteriyor; fakat 35.36 sn, sözleşmedeki 3–5 dakikanın çok altında. Plan/run oluşturma ve canlı normal run yok; v2 run seed'den geliyor; "hover tooltip" iddiası karelerde doğrulanamıyor; commit/ortam kaydı eksik (H-1). |
| P8-06 | **İncelenmedi** | Kart `Planned`; sürüm adayı, nihai teslim commit'i, final CI ve kullanıcı kabulü yok. Aşağıdaki "P8-06 için kalanlar" bölümüne bakın. |

**Kritik bulgu yok.** Üç yüksek bulgu (H-1, H-2, H-3) P8-04/P8-05'in ve P8-01/P8-03'ün tam
kabulünü engelliyor. P8-02 teknik olarak kabul edilebilir; P8-01/P8-03 davranış olarak çalışıyor
ancak kanıt/doküman düzeltmesi olmadan `Accepted` önerilmez.

## Bulgular

### H-1 — Yüksek: P8-05 video sözleşmesi karşılanmıyor; kanıt iddiası fazla

- Görev hedefi "yaklaşık **3–5 dakikalık** İngilizce UI videosu" (`docs/tasks/P8-05.md:11`).
  Gerçek dosya **35.36 sn** (`ffprobe`), yani alt sınırın yaklaşık beşte biri. Kanıt dosyası da
  bunu doğruluyor (`docs/evidence/phase-8-video.md:4`); README bunu "35-second" olarak
  tanıtıyor (`README.md:50-51`). Bu, görev hedefiyle doğrudan çelişir.
- Video ana akışın yalnızca bir bölümünü gösteriyor: Test Plans, Run History, FAILED run özeti,
  v1/v2 compare ve v2 PASSED run. Plan oluşturma, yeni normal run başlatma/canlı izleme ve
  görevde istenen "create/fail/inceleme/normal/compare/v2 korunma" zincirinin tamamı yok.
  Kanıt dosyası canlı run başlatmanın videoda olmadığını açıkça kabul ediyor
  (`docs/evidence/phase-8-video.md:24`).
- P8-05 kabul ölçütü "Sürümler arası compare için v2 terminal run gerçekten oluşturulur"
  (`docs/tasks/P8-05.md:22`). Videoda kullanılan v2 run seed fixture'ıdır; videoda
  oluşturulmuyor. Seed gerçek simülatörle üretilmiş olsa da bu, videonun "gerçekten oluşturulur"
  anlatımını göstermiyor.
- Kanıt "Grafikte gerçek hover tooltip'i (hata noktası)" diyor (`docs/evidence/phase-8-video.md:15`;
  ayrıca `docs/demo.md:129`). 10–18 sn aralığında 0.2–0.5 sn adımlarla kare çıkardım:
  14.5–17.5 sn'de grafik **Output Voltage** ve tooltip yok; 17.5 sn'deki caption "failure is the
  stored 0.600000 A sample" derken grafik hata noktasını göstermiyor. FAILED özetinde
  `Sample index 14 · 0.600000 A` 11–12 sn'de görünüyor; bu doğru. Ancak tooltip iddiası
  örneklenen karelerde desteklenmiyor.
- P8-05 kabul ölçütü kullanılan commit/ortamın kayıtlı olmasını istiyor
  (`docs/tasks/P8-05.md:24`). `docs/evidence/phase-8-video.md:5-7` yalnızca "Docker Compose
  delivery stack, temiz demo veritabanı" diyor; commit SHA, Docker/Chrome sürümü veya tam
  ortam kaydı yok. Görüntü gerçek (uydurma kare yok; karelerdeki run ID `f13a3106…` mevcut
  delivery veritabanındaki FAILED run ile eşleşiyor), fakat sözleşme kaydı eksik.
- Sonuç: P8-05 **kabul edilemez**. Video 3–5 dakikaya yeniden çekilmeli; plan/run oluşturma,
  canlı normal run, gerçek hata tooltip'i ve v2 terminal run'ın oluşturulması gösterilmeli;
  commit/ortam kaydı eklenmeli. Alternatif olarak kullanıcıdan açık kapsam değişikliği
  alınmalı; görev kartı sessizce değiştirilmemeli.

### H-2 — Yüksek: P8-04 dokümanları güncel değil; durumlar birbiriyle çelişiyor

Aşağıdakiler tek tek doğrulandı; bunlar "eski metin" değil, aynı sürümde çelişen sözleşme
ifadeleridir:

- **Video var, fakat birçok belge yok diyor:**
  - `docs/demo.md:4-5` "demo videosu henüz yok" derken aynı dosyanın `:127-129` bölümü
    `probedesk-demo.mp4` videosunu "hazırdır" diye tanıtıyor.
  - `docs/README.md:56` "Demo videosu yoktur; README'ye video bağlantısı eklenmez" diyor;
    README'de bağlantı var (`README.md:50-51`).
  - `docs/implementation-guide.md:126` "Video henüz yoktur; README'de video bağlantısı da yoktur"
    diyor; README'de var.
  - `docs/testing.md:5` ve `:153` P8-05'i açık/`Planned` sayıyor; kart `In Review`
    (`docs/tasks/P8-05.md:3`) ve video mevcut.
  - `docs/evidence/phase-8-docs.md:162` "P8-05 demo videosu yok; README'de video bağlantısı yok"
    diyor; README'de var.
  - `docs/acceptance.md:53-54` "demo videosu (gerçek bağlantı) henüz yok" diyor; hemen alt
    satırda `:55` video dosyasını `[x]` işaretliyor. `:68` ayrıca "video kaydı yoktur" diyor.
  - `README.md:246-247` "demo video (P8-05) ... not complete" derken `README.md:50-51` videoyu
    "available" olarak sunuyor.
- **P7 durumu çelişiyor:** README "phases 1–7 are technically accepted" diyor
  (`README.md:13-15`), ancak aynı README'nin `:246` satırı "P7 ... in review" diyor.
  `docs/README.md:47-48` ve `docs/testing.md:153` de P7'yi `In Review` sayıyor; P7 kartları
  `Accepted` ve roadmap `P1–P7 Accepted` diyor (`docs/roadmap.md:3`). `docs/roadmap.md:19-20`
  ayrıca P4'ü `In Review`, P5'i `In Progress` gösteriyor; P4/P5 kartları `Accepted`.
- **P8 görev indeksi çelişiyor:** `docs/tasks/README.md:116-121` P8-01…P8-06'nın tamamını
  `Planned` gösteriyor; P8-01…P8-05 kartları `In Review`. `docs/README.md:47` ise
  P8-01–P8-04 `In Review`, P8-05/06 `Planned` diyor (P8-05 kartıyla çelişiyor).
- **README'deki `ps` komutu yanlış:** `README.md:90` "`docker compose --profile delivery ps`
  should show `migrate` and `seed` exited" diyor. Gerçek çıktı yalnızca çalışan `api`,
  `postgres`, `web` servislerini gösterdi; bir kerelik `migrate`/`seed` için `ps -a` gerekir.
  P8-01 kanıtı doğru komutu (`ps -a`) kullanıyor (`phase-8-compose.md:173`); README düzeltilmeli.
- **P8-04 "komutlar gerçekten uygulandı" iddiası tam değil:** kart `docs/tasks/P8-04.md:22`
  bunu `[x]` işaretliyor; kanıt `docs/evidence/phase-8-docs.md:169-172` kök `npm run dev`'in bu
  turda tek parça çalıştırılmadığını, 4200/3000 portlarının başka süreçlerce kullanıldığını
  yazıyor. Komut dosyada var; tek parça README akışı doğrulanmış değil.
- **Kanıt dizini eksik:** `docs/evidence/README.md:9-28` yalnızca P1–P4 kayıtlarını listeliyor;
  P5, P6, P7 ve Phase 8 kanıtları (bu dosya dahil) indekste yok. README'nin "Evidence index"
  bağlantısı (`README.md:264`) tüm kanıtları kapsamıyor.

Sonuç: Komutların çoğu ve bağlantılar çalışıyor (aşağıda), fakat P8-04'ün "belgeler kodla eş"
kabul ölçütü karşılanmıyor. Bu çelişkiler P8-06'nın "belgeler/CI/görseller/video aynı sürüm"
maddesini de doğrudan etkiler.

### H-3 — Yüksek: "Host'ta Node/PostgreSQL olmadan" doğrulaması çelişkili ve yapılmamış

- P8-01 kanıtı açıkça "Host'ta Node/PostgreSQL olmadan test edilmedi" diyor
  (`docs/evidence/phase-8-compose.md:413-417`): host Node/PG kurulu olduğu için boş makine
  senaryosu denenmemiş; P8-03'te doğrulanması isteniyor.
- P8-03 kanıtı ise "Host'ta Node/PostgreSQL olmadan çalışma, container içi build ile P8-01'de
  doğrulandı" diyor (`docs/evidence/phase-8-clean-install.md:58-60`). Container içi build,
  host'ta Node/PG olmadan çalıştırmayı kanıtlamaz; ayrıca P8-01 bunun yapılmadığını söylüyor.
- P8-03 kabul ölçütleri hâlâ açık: "Belgedeki komutlar temiz ortamda uygulamayı açar" ve
  "Kontrol edilen OS/mimari/sürümler kanıta yazılır" (`docs/tasks/P8-03.md:21-24`). İzole
  stack'im host'ta Node/PG **kuruluyken** çalıştı; boş host değildir.
- Benim izole stack'imde host mount yoktu: yalnızca PostgreSQL named volume'ü vardı; API/web
  bind mount'u yoktu; API `DATABASE_URL` container içi `postgres:5432` idi. Bu, tasarımın host
  Node/PG kullanmadığını destekler, fakat "hiç kurulu olmayan makine" testi değildir.

Sonuç: P8-01/P8-03 tam kabul için bu iddia düzeltilmeli veya gerçekten boş bir host/VM'de
belgelenen giriş noktası çalıştırılmalıdır. Davranışsal bir hata bulunmadı; kanıt dürüstlüğü
ve kabul koşulu sorunu vardır.

### M-1 — Orta: Tekrarlanan seed PostgreSQL'de ERROR üretiyor; "0 ERROR/WARN" kanıtı yanlış

- `compose.yaml:71-84` seed servisini her delivery başlangıcında çalıştırır.
  `apps/api/prisma/seed-device-profiles.ts:21-36` profili önce `create` ile eklemeye çalışıp
  `P2002` hatasını yakalıyor. Profil zaten varsa PostgreSQL her seferinde
  `duplicate key value violates unique constraint "device_profiles_code_key"` satırı yazıyor.
- Gerçek gözlem: mevcut `probedesk-postgres` logunda 18:52:57'de bu ERROR var; izole stack'te
  ikinci ve üçüncü seed çalıştırmalarında da aynı ERROR oluştu. Seed yine de `Exited (0)` ve
  0 yeni kayıt veriyor; veri bozulmuyor.
- Buna karşılık `docs/evidence/phase-8-compose.md:381-390` "ERROR/WARN çıktı yok" diyor. Bu
  ifade mevcut loglarla uyuşmuyor. Gizli veri sızıntısı yok (aşağıdaki secret taraması 0);
  sorun log gürültüsü ve kanıt doğruluğudur. Önce `findUnique`/upsert kullanmak veya kanıt
  metnini düzeltmek gerekir.

### M-2 — Orta: README'deki `ps` komutu bir kerelik servisleri göstermiyor

Yukarıdaki H-2 içinde ayrıntılı. Kısa kanıt:

```text
$ docker compose --profile delivery ps
NAME                 SERVICE    STATUS
probedesk-api-1      api        Up (healthy)
probedesk-postgres   postgres   Up (healthy)
probedesk-web-1      web        Up (healthy)

$ docker compose --profile delivery ps -a
... migrate-1  Exited (0)
... seed-1     Exited (0)
```

README `ps` yerine `ps -a` demeli veya "running services" olarak düzeltilmeli.

### L-1 — Düşük: `/api` yönlendirmesi özel portta yanlış hedefe gidiyor

`infra/nginx/default.conf:45-47` `location = /api { return 308 /api/; }` kullanıyor. Nginx
bunu sunucunun dinlediği iç portla (`8080`) mutlaklaştırıyor. `PROBEDESK_DELIVERY_PORT=18080`
ile:

```text
$ curl -D - -o /dev/null http://127.0.0.1:18080/api
HTTP/1.1 308 Permanent Redirect
Location: http://127.0.0.1:8080/api/
```

Varsayılan 8080'de doğru; UI bu çıplak `/api` yolunu kullanmıyor. Yine de belgelenen port
override'ı ile tutarsız. `$http_host`/göreli hedef kullanılmalı veya bu uç kaldırılmalı.

### L-2 — Düşük: P8-02 reset script'i ve kanıt metni eski

`docs/tasks/P8-02.md:57-60` ve `docs/evidence/phase-8-seed.md:267-270` "guarded reset için npm
paket script'i eklenmedi" diyor. Oysa kök `package.json:30` `demo:reset` script'ini ve
`apps/api/package.json` ilgili workspace script'ini içeriyor. Seed/reset davranışı korumalı;
yalnızca kanıt metni güncellenmeli. Ayrıca `npm run demo:seed` iki kez çalıştırıldığında
`phase-8-seed.md`'de belirtilmeyen P2002 log satırı oluşuyor (M-1).

### L-3 — Düşük: Kanıt izlenebilirliği ve eksik kayıtlar

- `docs/evidence/phase-8-compose.md:14` ve `docs/evidence/phase-8-seed.md` başlarında commit
  SHA "henüz yok" diyor; oysa compose/seed commit'leri (`518f278`, `ca44731`) mevcut. Kanıt
  dosyaları hangi commit'e ait olduğunu kesinleştirmeli.
- P8-05 kanıtında commit/ortam SHA'sı yok (`docs/evidence/phase-8-video.md:5-7`).
- `phase-8-compose.md:418-422` imaj boyutlarında seed imajını saymıyor. Gerçek seed imajı
  `2.06GB`; migrate `1.11GB`, API `485MB`, web `93.3MB`. İşlevsel değil, disk/limitation kaydı.
- `docs/evidence/README.md` P8 kayıtlarını listelemiyor (H-2).

## P8-01 — doğrulananlar

Mevcut delivery stack ve izole stack üzerinde gerçek çıktılar. Derin bağlantı, canlı NORMAL run
ve SSE ölçümleri izole stack'te (`18080`) yapıldı; mevcut stack'te health, login ve portlar
doğrulandı.

```text
$ docker compose config --services
postgres

$ docker compose --profile delivery config --services
postgres
migrate
seed
api
web

$ docker compose --profile delivery ps -a
probedesk-api-1       probedesk-api       Up (healthy)       3000/tcp
probedesk-migrate-1   probedesk-migrate   Exited (0)
probedesk-postgres    postgres:18.1       Up (healthy)       127.0.0.1:5434->5432/tcp
probedesk-seed-1      probedesk-seed      Exited (0)
probedesk-web-1       probedesk-web       Up (healthy)       127.0.0.1:8080->8080/tcp
```

- `GET /api/health/live` → 200 `{"status":"ok"}`.
- `GET /api/health/ready` → 200
  `{"status":"ok","checks":{"database":"ok","migrations":"ok"}}`.
- `/` ve `/runs/<uuid>` → 200 `text/html`; `Cache-Control: no-cache`; Angular SPA fallback
  çalışıyor.
- Playwright/Chrome: `/runs/<uuid>` önce login'e yönlendi; `operator@probedesk.local` ile
  girişten sonra aynı run detayı açıldı; başlık `Run Details · ProbeDesk`; tam sayfa yenilemede
  URL korundu ve `/api/auth/me` 200 döndü. Oturum çerezi HttpOnly, `XSRF-TOKEN` okunabilir.
- Sahte Origin 403, yanlış parola 401.
- Tek API süreci: `docker top probedesk-api-1` yalnızca `docker-init` + bir
  `node dist/main.js` gösterdi; container kullanıcısı `node` (uid 1000); API host portu yok
  (`3000/tcp` yalnızca compose ağı). Web `127.0.0.1:8080`, PostgreSQL `127.0.0.1:5434`.
- Gerçek NORMAL v2 run: POST 202, `COMPLETED/PASSED`, `90/90`, `lastEventSequence=98`.
- SSE (`curl`/Python stream, `Accept-Encoding: gzip`): 200, `Content-Type: text/event-stream`,
  `Transfer-Encoding: chunked`, `Content-Encoding` **yok**. 98 çerçeve; stream ortasında
  başladığı için 38 replay çerçevesi hemen, 56 canlı çerçeve >1 s'de; medyan varış aralığı
  **0.202 s**; son çerçeve 12.185 s'de. Bu, nginx buffering'inin kapalı olduğunu destekler.
- İmajlar: API 485 MB, web 93.3 MB, migrate 1.11 GB, seed 2.06 GB. API/web container'larında
  host bind mount yok; PostgreSQL yalnızca named volume kullanıyor.
- Loglarda secret taraması (`PlannerDemo|OperatorDemo|ViewerDemo|probedesk_session|XSRF-TOKEN|
  authorization|set-cookie|password|DATABASE_URL|postgresql://`) → 0 eşleşme.
- **Ancak** tekrarlanan seed'de bir PostgreSQL ERROR'u var (M-1); P8-01 kanıtının "0 ERROR/WARN"
  ifadesi bu nedenle yanlış.

**P8-01 sonucu:** Çalışma zamanı davranışı geçti. "Host Node/PG yok" kanıtı ve log taraması
düzeltilmeden tam kabul önerilmez.

## P8-02 — doğrulananlar

İzole boş veritabanında gerçek `npm run demo:seed` (container içinde) üç kez çalıştırıldı:

```text
İlk çalıştırma:
Demo users ready: 3 accounts (3 created, 0 already present).
Demo device profiles ready: 1 profiles (1 created, 0 already present).
Demo plan ready: Power Supply Validation (created), 2 published versions, 4 runs
(4 created, 0 already present).

İkinci ve üçüncü çalıştırma:
Demo users ready: 3 accounts (0 created, 3 already present).
Demo device profiles ready: 1 profiles (0 created, 1 already present).
Demo plan ready: Power Supply Validation (existing), 2 published versions, 4 runs
(0 created, 4 already present).
```

Tablolar ve satır özetleri (ikinci/üçüncü seed öncesi/sonrası):

```text
users=3, device_profiles=1, test_plans=1, plan_revisions=2, plan_steps=6,
step_identities=3, test_runs=4, run_steps=12, measurements=315, run_events=344
```

`md5(string_agg(row::text))` ile alınan tüm tablo özetleri ikinci ve üçüncü çalıştırmada
**birebir aynı** kaldı; `diff` çıktısı `NO_DIFF`. Yani kullanıcı, plan, published sürüm,
run, ölçüm ve olay satırları güncellenmedi/silinmedi. Bu, "idempotent ve non-destructive"
kabulünü destekler.

Gerçek değerler (izole DB):

```text
CANCELLED  | 45/90  | seq=50  | NORMAL | seed 42
COMPLETED  | FAILED | 90/90  | seq=98  | FORCED_FAILURE | seed 42
COMPLETED  | PASSED | 90/90  | seq=98  | NORMAL | seed 42
COMPLETED  | PASSED | 90/90  | seq=98  | NORMAL | seed 42
```

- FAILED Current Draw, `sampleIndex=14`, değer `0.600000`, `isWithinTolerance=false`.
- v1 Current Draw `0.450000–0.550000`; v2 `0.450000–0.650000`; v2 normal run'da 30 Current
  Draw örneğinin 14'ü v1'in `0.550000` üst sınırını aşıyor, v2'de hepsi tolerans içinde.
- Kısmi run: Output Voltage 30/30 `COMPLETED`, Current Draw 15/30 `CANCELLED`, Case Temperature
  `NOT_RUN`; kısmi adım istatistikleri null.
- `run_steps` 12, `measurements` 315, `run_events` 344; event sequence'ları 1..N boşluksuz.
- Üretim kodu gerçekten kullanılıyor: `apps/api/prisma/seed-demo-runs.ts:9-17` üretim
  `simulate`/`evaluateMeasurementValue`/`calculateStatistics`/`buildRunSnapshot` fonksiyonlarını
  import ediyor; seed içinde sabit verdict/değer yok. Bu iddia testle de destekleniyor
  (`apps/api/test/seed-demo-data.e2e-spec.ts:58-315`).
- Bağımsız test: `npx vitest run test/seed-demo-data.e2e-spec.ts --config ./vitest.config.e2e.ts`
  → **2 test geçti**, 1.26 s. Test gerçek PostgreSQL kullanıyor; mock yok.

**P8-02 sonucu:** Geçti. Yalnızca L-2 ve M-1 düzeltilmeli.

## P8-03 — doğrulananlar

İzole boş `probedesk` DB'sinde `docker compose ... up -d --build`:

```text
migrate-1  Exited (0)
seed-1     Exited (0)
api-1      Up (healthy)
web-1      Up (healthy)
GET /api/health/ready → 200
```

Seed sonrası ilk temiz durum:

```text
users=3, profiles=1, plans=1, publishedRevisions=2, runs=4
CANCELLED 45/90; COMPLETED FAILED 90/90; COMPLETED PASSED 90/90; COMPLETED PASSED 90/90
```

`down` (volume'e dokunmadan) + `up -d` sonrası:

- Volume oluşturma zamanı değişmedi: `2026-11-04T19:07:16Z`.
- İnceleme sırasında SSE testleriyle eklenen 3 run dahil **7 run**, 585 ölçüm ve 638 olay
  aynen korundu; FAILED run `COMPLETED/FAILED`, `90/90`.
- Eski oturum çerezi yeni API container'ında `/api/auth/me` → 200.
- `/api/health/ready` → 200.

Not: Temiz seed anındaki exact sayılar yukarıdaki 4 run'lık durumdur; restart testi bu temiz
durumun üzerine eklenen geçici SSE run'larıyla yapıldı. Kullanıcı geliştirme veritabanı ve
mevcut `probedesk-postgres-data` volume'ü silinmedi/değiştirilmedi.

**P8-03 sonucu:** Teknik zincir ve kalıcılık geçti. Ancak kartın kabul kutuları açık
(`docs/tasks/P8-03.md:21-24`), belgelenen giriş noktasının birebir aynısı (varsayılan proje
adı/portları ve mevcut volume) kullanıcı verisini korumak için çalıştırılmadı ve boş host
senaryosu yok (H-3). Bu nedenle "koşullu geçti".

## P8-04 — doğrulananlar ve neden başarısız

Bağımsız olarak çalıştırılanlar:

```text
$ npm run verify
exit=0
lint: 3 workspace, 0 warning/0 error
test:api:unit: 16 dosya / 118 test
test:web:     36 dosya / 370 test
build: API + web başarılı; initial 327.17 kB / 90.04 kB
openapi:check: OpenAPI contract is current

$ npm run test:api:integration
exit=0
22 dosya / 197 test, 33.44 s
```

Markdown bağlantı kontrolü (17 dosya, göreli bağlantı/görsel):

```text
files=17 relative_links=229 broken=0
```

README'deki video bağlantısı ve dört PNG resolve ediyor; video dosyası mevcut. README'deki
`npm ci`, `docker compose`, `db:migrate`, `demo:seed`, `dev`, `verify`, `test:e2e`,
`test:api:integration` giriş noktaları `package.json` içinde var. Olumlu olarak README ve
`docs/acceptance.md` nihai kullanıcı kabulünün verilmediğini açıkça söylüyor; yanlış bir ürün
kabulü iddiası bulunmadı. Ancak:

- `npm run dev` bu incelemede tek parça çalıştırılmadı; 3000 portu başka bir uygulama, 4200
  portu başka bir ProbeDesk dev sunucusu tarafından kullanılıyordu. P8-04 kanıtı da bunu
  kabul ediyor (`phase-8-docs.md:169-172`).
- `docker compose --profile delivery ps` iddiası yanlış (M-2).
- Video/P7/P8 durum çelişkileri H-2'de listelendi.
- Kanıt dizini P8 kayıtlarını listelemiyor.

**P8-04 sonucu:** Test sayıları, OpenAPI, build ve bağlantılar doğru; fakat belge doğruluğu ve
durum tutarlılığı kabul ölçütünü karşılamıyor. **Başarısız.**

## P8-05 — video incelemesi

`ffprobe` gerçek çıktısı:

```text
codec_name=h264
width=1280
height=800
r_frame_rate=25/1
duration=35.360000
size=703359
pix_fmt=yuv420p
```

- Dosya açılıyor; 1280×800, H.264, 25 fps, ses yok; 884 kare. Kanıt dosyasındaki süre/boyut
  bilgisiyle uyumlu.
- Kareler gerçek Angular UI'dan alınmış; sahte/üretilmiş ekran yok. Karelerdeki FAILED run ID
  `f13a3106…` mevcut delivery veritabanındaki FAILED run ile eşleşiyor. Caption'lar gerçek
  verilerle uyumlu (ör. `Sample index 14 · 0.600000 A`, v1/v2 `0.550000 → 0.650000`).
- Ana sonuçlar görünüyor: FAILED özeti, Run History, v1/v2 compare, v2 PASSED run.
- Eksikler: 3–5 dakika hedefi, plan/run oluşturma, canlı normal run, v2 run'ın videoda
  oluşturulması, gerçek hover tooltip, commit/ortam kaydı. Kanıt dosyası canlı run'ın videoda
  olmadığını zaten söylüyor (`phase-8-video.md:24`).
- Video P8-05 kabul ölçütlerini karşılamıyor; P8-05 kartındaki kutular da açık
  (`docs/tasks/P8-05.md:21-24`). **Başarısız.**

## P8-06 için kalanlar

P8-06 kartı `Planned` (`docs/tasks/P8-06.md:3`); aşağıdakiler tamamlanmadan sürüm adayı/nihai
kabul paketi oluşturulamaz:

1. **H-1'i kapat:** P8-05'i 3–5 dakikalık, plan/run oluşturma + canlı normal run + gerçek hata
   tooltip'i + videoda oluşturulan v2 terminal run içeren bir kayıtla yeniden üret; commit,
   Docker/Chrome ve ortam bilgisini kanıta yaz. Alternatif kapsam değişikliği kullanıcı onayı
   gerektirir.
2. **H-2'yi kapat:** Video/P7/P8 durumlarını tek bir doğru matriste birleştir; `docs/tasks/README.md`,
   `docs/roadmap.md`, `docs/README.md`, `docs/implementation-guide.md`, `docs/testing.md`,
   `docs/demo.md`, `docs/acceptance.md`, `docs/evidence/phase-8-docs.md` ve README'yi aynı
   sürümde güncelle. `ps -a` düzelt; `docs/evidence/README.md` indeksine P5–P8 kayıtlarını ekle.
3. **H-3'ü çöz:** Belgelenen delivery giriş noktasını gerçekten boş bir host/VM'de veya en azından
   Node/PG kurulu olmayan temiz bir ortamda çalıştır ve OS/mimari/sürümleri kaydet. Mümkün
   değilse "host'suz doğrulanmadı" olarak açıkça işaretle; P8-01/P8-03'te "doğrulandı" deme.
4. **M-1/M-2/L-1/L-2/L-3'ü düzelt:** Seed'de P2002 log gürültüsünü gider veya kanıtı düzelt;
   README `ps -a`; `/api` redirect; reset script kanıtı; commit SHA/seed imaj boyutu.
5. **Nihai sürüm:** Nihai teslim commit'ini oluştur; tüm test, CI, ekran görüntüsü ve videoyu
   bu commit'e bağla. Temiz checkout'ta `npm ci` + `npm run verify` + integration + final E2E
   çalıştır; `.github/workflows/ci.yml` altı işinin final commit'te yeşil olduğunu kaydet.
   Mevcut yeşil CI `3d27f2f` içindir, final commit için değildir.
6. **Kabul kaydı:** P8-01…P8-05 için ayrı teknik inceleme kayıtlarını kartlara işle; P8-03/P8-05
   kabul kutularını gerçek duruma göre güncelle; `docs/acceptance.md` ürün kutularını ve
   kullanıcı nihai kabulünü ayrı tut. Ürün/kullanıcı kabulü bu incelemenin kapsamı dışındadır.

## Doğrulanamayanlar / açık sınırlar

- Host'ta Node/PostgreSQL **kurulu değilken** delivery çalıştırılmadı; host Node/PG mevcut.
  Container içi build ve host bind mount olmaması gözlendi, ancak bu boş host testi değildir.
- Belgelenen komutun birebir aynısı (varsayılan `probedesk` projesi/volume'ü ve 8080/5434
  portları) kullanıcı verisini korumak için çalıştırılmadı; aynı servisler izole proje/port/
  volume ile çalıştırıldı. Mevcut stack salt-okunur incelendi.
- `docker compose build --no-cache` bu incelemede yeniden çalıştırılmadı; mevcut image'lar ve
  cache'li `up --build` kullanıldı. Kanıttaki 159.85 s no-cache build süresi bağımsız olarak
  tekrarlanmadı.
- Tam Playwright E2E paketi (`npm run test:e2e`) bu incelemede çalıştırılmadı; yalnızca
  deep-link/login/reload için gerçek Chromium kontrolü yapıldı. P7 E2E sonucu P7 kanıtına
  dayanıyor.
- Video tooltip iddiası örneklenen karelerde doğrulanamadı; video dosyasının tamamı kare kare
  izlenmedi, 0–34 s aralığında ve özellikle 10–18 s'de 0.2–0.5 s adımlarla örneklendi.
- `npm run dev` tek parça çalıştırılmadı; 3000/4200 portları başka süreçlerce kullanılıyordu.
- Ürün kullanıcı kabulü, yayın kararı ve P8-06 nihai paketi bu incelemenin dışındadır.

## Kanıt bağlantıları

- [P8-01 compose kanıtı](phase-8-compose.md)
- [P8-02 seed kanıtı](phase-8-seed.md)
- [P8-03 temiz kurulum kanıtı](phase-8-clean-install.md)
- [P8-04 docs kanıtı](phase-8-docs.md)
- [P8-05 video kanıtı](phase-8-video.md)
- [Video dosyası](probedesk-demo.mp4)
- [compose.yaml](../../compose.yaml)
- [API Dockerfile](../../apps/api/Dockerfile), [web Dockerfile](../../apps/web/Dockerfile)
- [nginx yapılandırması](../../infra/nginx/default.conf)
- [P8-01 görev kartı](../tasks/P8-01.md), [P8-02](../tasks/P8-02.md),
  [P8-03](../tasks/P8-03.md), [P8-04](../tasks/P8-04.md), [P8-05](../tasks/P8-05.md),
  [P8-06](../tasks/P8-06.md)
- [Kabul listesi](../acceptance.md), [test sözleşmesi](../testing.md)

---

Bu belge **bağımsız teknik inceleme** kaydıdır; ürün kullanıcı kabulü, aşama kabulü veya yayın
onayı değildir. P8-06 tamamlanmamıştır ve bu incelemede tamamlanmış sayılmamıştır.
