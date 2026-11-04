# Phase 8 — yerel Compose teslimi kanıtı (P8-01)

Durum: **Uygulandı ve yerelde doğrulandı; bağımsız inceleme bekliyor.**
Bu belge ürün kabulü veya P8-03 temiz-kurulum kabulü değildir.

- Tarih: 2026-11-04
- Görev: [P8-01](../tasks/P8-01.md)
- İlgili sözleşmeler: [architecture.md](../architecture.md),
  [testing.md](../testing.md) (T27/T28 P8-03'e aittir), [api.md](../api.md)
- Ortam: macOS 26.7.1 (25G241), arm64 (Apple M2), Docker 29.9.2,
  Docker Compose v5.6.1. Host Node.js `v22.23.2`, host npm `10.9.8`.
  İmajlar Node.js `22.23.2`, npm `11.6.2`, nginx `1.29.4`,
  PostgreSQL `18.1` kullanır.
- Commit SHA: Henüz yok; commit/push lead'in sorumluluğunda. Bu kayıt
  commit edilmemiş çalışma ağacındaki gerçek çıktılara dayanır.
- Test verisi: Mevcut geliştirme veritabanı (`probedesk`, host portu 5434)
  kullanıldı. Doğrulama başlangıcında 3 plan ve 40 run vardı; doğrulama
  sırasında bir NORMAL run eklendi (toplam 41 run). Bu veri silinmedi.

## Teslim tasarımı

### Compose giriş noktaları

`compose.yaml` iki giriş noktası sunar:

```text
docker compose up -d
  → yalnızca PostgreSQL (mevcut geliştirme akışı: npm run dev)

docker compose --profile delivery up -d --build
  → PostgreSQL + tek seferlik migrate + API + web/nginx
  → http://127.0.0.1:8080
```

`delivery` profili, geliştirme veritabanı servisini ve
`probedesk-postgres-data` named volume'ünü bilinçli olarak yeniden kullanır.
Böylece `docker compose up -d` geliştiriciler için değişmez; demo aynı yerel
veri kümesini gösterir ve yeniden başlatmada planlar/run'lar korunur.
Profil kullanılmayan servisler `docker compose up -d` tarafından başlatılmaz.

### Servisler ve başlangıç sırası

| Servis | İmaj | Host portu | Görev |
|---|---|---|---|
| `postgres` | `postgres:18.1-alpine` | `127.0.0.1:${PROBEDESK_DEV_DB_PORT:-5432}:5432` | Named volume, `pg_isready` healthcheck |
| `migrate` | yerel `probedesk-migrate` | yok | `npm run db:migrate --workspace apps/api` → `prisma migrate deploy`; başarıyla çıkarsa API başlar |
| `api` | yerel `probedesk-api` | yayınlanmaz; yalnızca compose ağında `3000` | Tek Node süreci, non-root `node` kullanıcısı, readiness healthcheck |
| `web` | yerel `probedesk-web` | `127.0.0.1:${PROBEDESK_DELIVERY_PORT:-8080}:8080` | Angular statik dosyaları + `/api` reverse proxy |

Bağımlılık zinciri:

```text
postgres healthy
  → migrate service_completed_successfully
    → api healthy (DB + migrations + startup recovery)
      → web başlar
```

`migrate` `restart: "no"` ve yalnızca `prisma migrate deploy` çalıştırır.
`prisma migrate reset` veya benzeri yıkıcı bir komut yoktur. `api` ve `web`
`restart: unless-stopped` kullanır; API `init: true` ve 30 saniye graceful
shutdown süresiyle tek süreç olarak çalışır.

### Dockerfile'lar

**API (`apps/api/Dockerfile`, build context repo kökü):**

- `deps`: tüm workspace manifestleri + `npm ci` (npm 11.6.2).
- `build`: kaynak + `npm run build --workspace apps/api`; `prebuild` Prisma
  client'ı `apps/api/src/prisma/generated` altına üretir, `nest build` ESM
  `dist` çıktısını verir.
- `prod-deps`: yalnızca API workspace'inin production bağımlılıkları.
- `runtime-deps`: Prisma CLI/Studio ağacını API runtime kopyasından çıkarır;
  generated client, `@prisma/client` runtime ve `pg` adapter kalır.
- `runtime`: `node:22.23.2-alpine`, `node` kullanıcısı (uid 1000), `dist` +
  production `node_modules`, `CMD ["node", "dist/main.js"]`. İmaj içinde
  `node -e "import('./dist/app.module.js')"` modül çözümleme kontrolü vardır.
- `migrate`: aynı production bağımlılık ağacı + Prisma CLI + şema/migration
  dosyaları; `CMD ["npm", "run", "db:migrate", "--workspace", "apps/api"]`.

**Web (`apps/web/Dockerfile`):**

- `deps`/`build`: `npm ci`, `npm run build --workspace apps/web`.
- `runtime`: `nginx:1.29.4-alpine`; yalnızca Angular `dist/web/browser` kopyası
  ve `infra/nginx/default.conf`.
- `try_files $uri $uri/ /index.html` ile `/runs/:id`, `/plans/:id/edit` gibi
  deep link'ler index.html'e döner.
- `/api/` konumu `proxy_http_version 1.1`, `proxy_buffering off`,
  `proxy_cache off`, `gzip off`, `proxy_read_timeout 1h` ve
  `Host $http_host` kullanır. `^~ /api/` sayesinde Swagger UI'nin `.css`
  istekleri statik dosya kuralına yakalanmaz.
- `resolver 127.0.0.11` + değişken `proxy_pass`, API konteyneri yeniden
  oluşturulduğunda nginx'in eski IP'ye sabitlenmemesini sağlar.

### Portlar, volume ve güvenlik

- Web: `127.0.0.1:8080` (gözlenen). `PROBEDESK_DELIVERY_PORT` ile değiştirilebilir.
- PostgreSQL: gözlenen host portu `127.0.0.1:5434`; repodaki `.env`
  `PROBEDESK_DEV_DB_PORT=5434` içerdiği için. Varsayılan `5432`'dir.
  Konteyner içinde her zaman `postgres:5432` kullanılır.
- API host'a publish edilmez; yalnızca `3000/tcp` iç ağdadır. Tek API süreci.
- Named volume: `probedesk-postgres-data`, mount `/var/lib/postgresql`
  (PostgreSQL 18 imajının PGDATA düzeni).
- `.env` imajlara kopyalanmaz; API `DATABASE_URL` değeri compose ortamından
  gelir. Compose'daki PostgreSQL kullanıcı/parolası yalnızca yerel demo
  kimliğidir; gerçek bir secret değildir. Loglarda parola, cookie, oturum
  token'ı veya CSRF token'ı bulunmadığı aşağıda taranmıştır.
- Localhost demosu HTTP kullandığı için `NODE_ENV=development` ve
  `SESSION_COOKIE_SECURE=false` seçilmiştir. API `NODE_ENV=production` ile
  güvensiz cookie'yi zaten reddeder; üretim TLS'i bu kartın kapsamı dışıdır.

## Çalıştırılan kontroller ve gerçek çıktılar

### 1. Compose doğrulaması

```text
$ docker compose --profile delivery config --quiet
exit=0

$ docker compose --profile delivery config --services
postgres
migrate
api
web

$ docker compose config --services
postgres
```

### 2. Release image build

Temel imajlar yerelde mevcutken, cache kullanmadan tam uygulama build'i:

```text
$ { /usr/bin/time -p docker compose --profile delivery build --no-cache ; } 2>&1 | tee ...
...
 Image probedesk-web Built
 Image probedesk-api Built
 Image probedesk-migrate Built
real 159.85
user 0.78
sys 0.92
```

Build çıktısındaki gerçek süreler: API production `npm ci` 42.44 s,
web `npm ci` 53.29 s, Angular production build 49.377 s.
Bu süre Docker layer cache'i olmadan ölçüldü; temel imaj katmanları zaten
yerelde olduğu için imaj indirme süresi dahil değildir.

Gerçek imaj boyutları:

| İmaj | ID | Boyut |
|---|---|---|
| `probedesk-api:latest` | `6e2c296db538` | **485 MB** |
| `probedesk-web:latest` | `04b766a7001b` | **93.3 MB** |
| `probedesk-migrate:latest` | `4b6065fbdd6f` | **1.11 GB** |

`probedesk-api` içinde `node_modules` 190.2 MB ve `node` kullanıcısı uid 1000.
`probedesk-web` içinde `nginx -t` "syntax is ok" / "test is successful" verdi.
`probedesk-migrate` Prisma CLI ve production bağımlılıklarını taşıdığı için
bilinçli olarak daha büyüktür; tek seferlik iştir.

### 3. Stack başlatma ve health

```text
$ docker compose --profile delivery up -d
 Container probedesk-postgres Healthy
 Container probedesk-migrate-1 Exited (0)
 Container probedesk-api-1 Healthy
 Container probedesk-web-1 Started
UP_EXIT=0

$ docker compose --profile delivery ps -a
NAME                  IMAGE                  STATUS
probedesk-api-1       probedesk-api          Up (healthy)      3000/tcp
probedesk-migrate-1   probedesk-migrate      Exited (0)
probedesk-postgres    postgres:18.1-alpine   Up (healthy)      127.0.0.1:5434->5432/tcp
probedesk-web-1       probedesk-web          Up (healthy)      127.0.0.1:8080->8080/tcp
```

Migration logunun gerçek çıktısı:

```text
> @probedesk/api@0.0.1 db:migrate
> prisma migrate deploy

Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "probedesk", schema "public" at "postgres:5432"

8 migrations found in prisma/migrations

No pending migrations to apply.
```

Health, web proxy üzerinden:

```text
$ curl -sS -w '\nstatus=%{http_code}\n' http://127.0.0.1:8080/api/health/live
{"status":"ok"}
status=200

$ curl -sS -w '\nstatus=%{http_code}\n' http://127.0.0.1:8080/api/health/ready
{"status":"ok","checks":{"database":"ok","migrations":"ok"}}
status=200
```

Web healthcheck'i (`wget ... | grep -q '<app-root>'`) ve API healthcheck'i
(readiness) başarılıdır; web ancak API healthy olduktan sonra başlamıştır.

### 4. Deep link, SPA ve statik önbellek

```text
$ curl -sS -o /dev/null -w 'status=%{http_code} type=%{content_type}\n' http://127.0.0.1:8080/
status=200 type=text/html

$ curl -sS -o /dev/null -w 'status=%{http_code} type=%{content_type}\n' \
    http://127.0.0.1:8080/runs/a36b18b7-851c-4d52-bb07-f00bd9e4e3aa
status=200 type=text/html

$ curl -sS -D - -o /dev/null http://127.0.0.1:8080/main-7EAZ3262.js | grep -i '^cache-control'
Cache-Control: public, max-age=31536000, immutable
```

Gerçek Chromium (Playwright 1.64.1, mevcut tarayıcı ikilisi) ile:

```text
deep-link-url: http://127.0.0.1:8080/login?returnUrl=%2Fruns%2Fa36b18b7-851c-4d52-bb07-f00bd9e4e3aa
login-heading-visible: true
post-login-url: http://127.0.0.1:8080/runs/a36b18b7-851c-4d52-bb07-f00bd9e4e3aa
document-title: Run Details · ProbeDesk
run-details-heading: true
run-id-visible: true
status-visible: true
reload-url: http://127.0.0.1:8080/runs/a36b18b7-851c-4d52-bb07-f00bd9e4e3aa
reload-run-details-heading: true
reload-still-authenticated: true
```

Bu, deep link'in SPA fallback ile açıldığını, giriş sonrası doğru run
detayına döndüğünü ve tam sayfa yenilemede oturumun korunduğunu gösterir.
Playwright tarayıcı revizyonu 1243 mevcut önbellekten açıkça verildi;
host'a yeni tarayıcı kurulmadı.

### 5. Üç demo hesabıyla giriş

Tüm istekler `http://127.0.0.1:8080` üzerinden, yani nginx proxy'sinden
yapıldı. Gerçek çıktı:

```text
planner@probedesk.local status=200
{"id":"4ac363be-f182-4586-8ef4-aeb62087160a","email":"planner@probedesk.local","role":"PLANNER"}
sessionHttpOnly=1 xsrfReadable=yes

operator@probedesk.local status=200
{"id":"e17abc67-1710-499a-9e3f-814e862f6c79","email":"operator@probedesk.local","role":"OPERATOR"}
sessionHttpOnly=1 xsrfReadable=yes

viewer@probedesk.local status=200
{"id":"df15ae20-6fab-4492-b483-05e44677955d","email":"viewer@probedesk.local","role":"VIEWER"}
sessionHttpOnly=1 xsrfReadable=yes

$ curl -sS -b operator.cookies .../api/auth/me
{"id":"e17abc67-1710-499a-9e3f-814e862f6c79","email":"operator@probedesk.local","role":"OPERATOR"}
status=200
```

Ek negatif kontroller:

```text
$ curl ... -H 'Origin: http://evil.example' .../api/auth/login
forged-origin status=403
{"code":"FORBIDDEN","message":"The request origin is not allowed.","requestId":"..."}

$ curl ... --data '{"email":"planner@probedesk.local","password":"wrong"}'
wrong-password status=401
{"code":"UNAUTHENTICATED","message":"Invalid email or password.","requestId":"..."}
```

Origin kontrolü nginx'in `Host $http_host` ayarıyla uyumludur; aksi halde
gerçek tarayıcı girişi 403 olurdu.

### 6. Gerçek run ve SSE (buffering yok)

Mevcut yayımlanmış plandan (`Power Supply Validation` v2) NORMAL/seed 42 ile
run başlatıldı:

```text
$ curl ... -X POST .../api/runs -H 'Idempotency-Key: ...' \
    --data '{"planVersionId":"dabccc91-8b3e-452a-a6c3-c805b23b5fb5","scenario":"NORMAL","seed":42}'
start_status=202
{"runId":"a36b18b7-851c-4d52-bb07-f00bd9e4e3aa","status":"RUNNING","outcome":null,
 "snapshotUrl":"/api/runs/a36b18b7-851c-4d52-bb07-f00bd9e4e3aa",
 "eventsUrl":"/api/runs/a36b18b7-851c-4d52-bb07-f00bd9e4e3aa/events"}
```

`/api/runs/:id/events?after=0` üzerinden `curl -N` ile canlı akış. Her satırın
geliş zamanı ayrıca damgalandı:

```text
ARRIVAL+  0.006s id: 1
ARRIVAL+  0.007s event: run.started
...
ARRIVAL+  0.007s event: step.started
...
ARRIVAL+ 17.160s event: step.completed
ARRIVAL+ 17.160s event: run.completed
```

Akış özeti:

```text
event frames: 98
first->last span: 17.154s
median inter-event arrival delta: 0.206s
events arriving in first 0.1s: 14
events arriving after 1s: 80
```

İlk 14 çerçeve `after=0` replay'i olduğu için hemen geldi; canlı ölçüm
çerçeveleri yaklaşık 200 ms aralıkla, run bitene kadar ayrı ayrı ulaştı.
Tüm çerçevelerin sonda toplanmaması nginx buffering'inin kapalı olduğunu
gösterir.

SSE yanıt başlıkları:

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Transfer-Encoding: chunked
Connection: keep-alive
Cache-Control: no-cache
```

`Accept-Encoding: gzip` ile tekrar denendi:

```text
body_lines=392 content_encoding=0
```

Yani olay akışı gzip ile sarılmadı; `gzip off` etkili. Run snapshot'ı:

```text
{"id":"a36b18b7-851c-4d52-bb07-f00bd9e4e3aa","status":"COMPLETED","outcome":"PASSED",
 "expectedSampleCount":90,"recordedSampleCount":90,"lastEventSequence":98}
```

### 7. Yeniden başlatma ve named-volume kalıcılığı

`docker compose --profile delivery down` (volume'e dokunmadan) ve ardından
`up -d` çalıştırıldı. Önce/sonra:

| Ölçüm | Önce | Sonra |
|---|---|---|
| Plan sayısı | 3 | 3 |
| Run sayısı | 41 | 41 |
| Doğrulama run'ı | `COMPLETED/PASSED`, 90/90, seq 98 | aynı |
| Volume | `probedesk-postgres-data`, oluşturma `2026-11-03T13:32:40Z` | aynı |
| API container ID | `d5f0b86e...` | `d973eaea...` |
| Eski oturum cookie'si | geçerli | `/api/auth/me` 200 |

PostgreSQL konteyneri yeniden oluşturuldu, API konteyneri yeni ID aldı; named
volume ve içindeki planlar/run'lar/session'lar korundu. Sonraki cache'siz
rebuild + `up -d --force-recreate` sonrasında da `plans=3 runs=41` ve aynı run
görüldü.

### 8. Tek API süreci, portlar ve loglar

```text
$ docker top probedesk-api-1 -eo pid,ppid,user,comm,args
PID    PPID   USER  COMMAND
9482   9459   1000  /sbin/docker-init -- docker-entrypoint.sh node dist/main.js
9527   9482   1000  node dist/main.js
```

Tek `node dist/main.js` süreci vardır; container `User=node`,
`Restart=unless-stopped`. API host portu yoktur (`3000/tcp`, publish
edilmemiş); web yalnızca `127.0.0.1:8080`, PostgreSQL yalnızca
`127.0.0.1:5434` (bu makinedeki `.env` nedeniyle; varsayılan 5432) dinler.

Tüm compose logları üzerinde hassas veri taraması:

```text
$ docker compose --profile delivery logs --no-color | \
    grep -niE 'PlannerDemo|OperatorDemo|ViewerDemo|probedesk_session|XSRF-TOKEN|authorization|set-cookie|password|DATABASE_URL|postgresql://'
# çıktı yok (0 eşleşme)

$ ... | grep -nE 'ERROR|WARN'
# çıktı yok
```

Nginx access logları yalnızca yol, durum, kullanıcı ajanı ve süre taşır;
cookie veya gövde kaydetmez.

## Sınırlar, riskler ve ertelenen işler

1. **Temiz volume'da demo hesapları yoktur.** Bu kart seed'i kapsamaz
   (P8-02). Yukarıdaki üç hesap mevcut geliştirme veritabanındadır. Yeni bir
   volume ile açılan teslimde P8-02/P8-03 seed adımı çalıştırılmadan giriş
   yapılamaz. Bu, P8-01 kabulünü değil, P8-02/P8-03 sırasını ilgilendirir.
2. **Teslim, geliştirme veritabanı volume'ünü paylaşır.** Bu bilinçli bir
   tercihtir; demo verisi ile geliştirici verisi aynı yerdedir. `docker compose
   down -v` bu volume'ü siler; temiz kurulum testi (P8-03) ayrı bir volume/DB
   veya açık onaylı bir reset kullanmalıdır. Yıkıcı olmayan bir T27 yolu:
   aynı PostgreSQL konteynerinde yeni bir veritabanı oluşturup
   `PROBEDESK_DATABASE_URL=postgresql://probedesk:probedesk@postgres:5432/<yeni_db>?schema=public`
   ile `--force-recreate` çalıştırmak; iş bitince yalnızca bu veritabanını
   düşürmek. Geliştirme volume'ü ve `probedesk` veritabanı korunur.
3. **HTTP/localhost demo ayarı.** `NODE_ENV=development` ve
   `SESSION_COOKIE_SECURE=false` yalnızca belgelenmiş localhost demosu içindir.
   Üretim TLS'i, secure cookie ve reverse-proxy sertifika yönetimi bu kartın
   dışındadır.
4. **Host'ta Node/PostgreSQL olmadan test edilmedi.** Teslim komutları host
   Node/PG kullanmaz; npm build'leri konteyner içinde çalışır. Ancak bu makinede
   host Node ve PostgreSQL kurulu olduğu için "hiç kurulu olmayan makine"
   senaryosu bu turda ayrıca denenmedi. P8-03 temiz ortam kontrolünde
   doğrulanmalıdır.
5. **İmaj boyutu.** API 485 MB, web 93.3 MB, migrate 1.11 GB. Migrate imajı
   Prisma CLI + production bağımlılıklarını taşır; tek seferlik iştir. API
   runtime'ında Prisma CLI/Studio ağacı elle çıkarılır; ileride bağımlılık
   grafiği değişirse build-time modül kontrolü (`node -e import(...)`) erken
   uyarı verir, ancak bu bakım noktası izlenmelidir.
6. **SSE reconnect/failure senaryosu bu turda proxy üzerinden ayrıca
   zorlanmadı.** Canlı akış ve buffering kontrolü gerçek run ile yapıldı;
   T13/T14 kapsamındaki reconnect/cursor testleri API entegrasyon testlerinde
   ayrıca ele alınmalıdır.
7. **Bağımsız inceleme yok.** Kart yalnızca `In Review` yapılabilir; ayrı
   teknik inceleme ve P8-03 temiz kurulum/kalıcılık kabulü olmadan `Accepted`
   değildir. `docs/tasks/README.md` ve `docs/roadmap.md` güncellemeleri bu
   worker'ın sahiplik alanı dışında olduğu için lead'e bırakılmıştır.

## Kanıt bağlantıları

- [`compose.yaml`](../../compose.yaml)
- [`apps/api/Dockerfile`](../../apps/api/Dockerfile)
- [`apps/web/Dockerfile`](../../apps/web/Dockerfile)
- [`infra/nginx/default.conf`](../../infra/nginx/default.conf)
- [`.dockerignore`](../../.dockerignore)
- [P8-01 görev kartı](../tasks/P8-01.md)

## Seed sonrası temiz veritabanı kontrolü (2026-11-04)

Delivery profiline idempotent `seed` servisi eklendi (`apps/api/Dockerfile` `seed` target +
`compose.yaml`); `migrate → seed → api → web` sırası korunuyor.

- `probedesk_delivery_check` adlı yeni veritabanı oluşturuldu; `PROBEDESK_DATABASE_URL` bu DB'ye
  yönlendirildi.
- `docker compose --profile delivery up -d --build` → migrate `Exited(0)`, seed `Exited(0)`,
  API `healthy`, web `healthy`.
- `/api/health/ready` → 200 `{database: ok, migrations: ok}`.
- `operator@probedesk.local` login → 200; `/api/plans` → tek `Power Supply Validation`,
  latest version 2.
- Bu, boş veritabanında migration + demo seed + API + web zincirinin çalıştığını gösterir.


## Host Node/PostgreSQL olmadan entry point (2026-11-04)

Host Node.js ve PostgreSQL ikilileri PATH'ten çıkarılarak:

```text
env -i HOME="$HOME" PATH=/usr/local/bin:/usr/bin:/bin docker --version
→ Docker version 29.9.2

env -i HOME="$HOME" PATH=/usr/local/bin:/usr/bin:/bin docker compose --profile delivery ps -a
→ api healthy, web healthy, postgres healthy, migrate Exited(0), seed Exited(0)
```

`npm` build'leri, migration ve seed container içinde çalıştı; host'ta Node veya
PostgreSQL kullanılmadı. Bu makinede host araçları kurulu olduğu için tamamen boş
bir işletim sistemi kurulumu ayrıca denenmedi.

## Seed log düzeltmesi

Tekrarlanan seed'de `seed-device-profiles` önce `create` denediği için PostgreSQL
`duplicate key` ERROR'u loglanıyordu. Profil önce `findUnique` ile aranacak şekilde
düzeltildi; ikinci seed artık hata üretmeden mevcut profili atlıyor.
