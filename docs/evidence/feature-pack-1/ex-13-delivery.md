# EX-13 — Feature branch delivery rollout kanıtı

- Tarih: 2026-11-08
- Branch: `feat/analytics-reporting-devices`
- Teslim edilen build HEAD'i: `49ec0b0c5b9c12be044698f4af3c2cac0e67e367`
  (`ci: run feature pack checks on its delivery branch`)
- Baseline: `49ec0b0`
- Rollout sırasında branch HEAD'i `bb753712aa6c21cd59866c1990c1f54c80684ec5`'e ilerledi;
  bu commit yalnız `scripts/feature-pack-upgrade-check.mjs` ve
  `docs/evidence/feature-pack-1/ex-13-upgrade.md` ekler, runtime kaynağını değiştirmez.
  Bu nedenle teslim edilen API/web imajları `49ec0b0` runtime kaynağına karşılık gelir.
- Kapsam: mevcut veriyi koruyan yerel Compose delivery rollout'u
  (`http://127.0.0.1:8080`), feature HEAD API/web imajları ve additive migration.
- Durum: **Rollout tamamlandı; yedek ve veri koruma kapısı geçti.** Bu belge ürün veya
  görsel kabul değildir. Nihai ürün/görsel kabul kullanıcıya aittir. `main` merge, PR
  veya kaynak/config değişikliği yapılmadı.

## Özet

| Kapı                                     | Sonuç                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Mevcut container/image/DB/volume kimliği | Kaydedildi; Postgres container'ı ve named volume değişmedi                                                |
| Rollout öncesi yedek                     | `pg_dump` custom format; SHA-256 ve restore doğrulaması geçti                                             |
| Migration                                | Yalnız `20261107120000_analytics_query_indexes` uygulandı; toplam 10 migration                            |
| Seed                                     | Yalnız 2 demo cihaz eklendi; kullanıcı/plan/run oluşturulmadı                                             |
| Eski veri parmak izleri                  | Run/step/measurement/event/plan/hash/kullanıcı/eski session alt kümeleri **birebir aynı**                 |
| 8080 health                              | `/api/health/live` ve `/api/health/ready` 200                                                             |
| Yeni API                                 | Overview, Devices, report ve CSV/JSON export gerçek veriyle 200                                           |
| Eski run smoke                           | PASSED, FAILED ve CANCELLED run snapshot/report/export 200                                                |
| Gerçek tarayıcı smoke                    | Overview/Devices/device detail/report/old run/UI indirme/Sign out geçti; JS/page hatası yok               |
| Test verisi                              | Delivery'ye yeni run/plan/ölçüm/event/copy yazılmadı                                                      |
| Kalan kapılar                            | README/demo dokümanı, CI, native yazdırma/zoom ve kullanıcı kabulü; ayrı upgrade kaydı lead incelemesinde |

## 1. Rollout öncesi kimlik

PostgreSQL 18.1, veritabanı `probedesk` (OID `16384`, system identifier
`7703937802249089061`), boyut `13 MB`, timezone `UTC`.

| Öğe                       | Rollout öncesi                                              |
| ------------------------- | ----------------------------------------------------------- |
| Volume                    | `probedesk-postgres-data`, oluşturma `2026-11-03T13:32:40Z` |
| Postgres container        | `30377ff6880a`, image `sha256:aa6eb304ddb6`                 |
| API container / image     | `f90f44d6ec87` / `probedesk-api` `sha256:ef0ae18d6886`      |
| Web container / image     | `a62123056853` / `probedesk-web` `sha256:c2959f4052c1`      |
| Migrate container / image | `976e693129f1` / `probedesk-migrate` `sha256:c580fca93d1b`  |
| Seed container / image    | `547369b0f1a4` / `probedesk-seed` `sha256:ee2e6627b46e`     |
| Uygulanmış migration      | 9                                                           |

Veritabanında cihaz migration'ı `2026-11-06` tarihinde zaten uygulanmıştı; rollout bu
nedenle yalnız analytics index migration'ını ekledi. Rollout öncesi tracked çalışma ağacı
temizdi (`git status --porcelain` boş).

## 2. Yedek ve restore doğrulaması

Yedek, çalışan delivery DB'sinden `pg_dump -Fc -Z 6` ile alındı. Dosya repository dışında,
`600` izinle tutuldu ve git'e eklenmedi.

```text
dosya: probedesk-delivery-pre-ex13-20261108.dump
boyut: 458353 bytes
sha256: b6073e7d73a8607a5dec487ffda8591b9f9e989e1422ee8ea37729d6411c63f2
pg_dump exit: 0
pg_restore -l exit: 0; 147 TOC satırı, 14 TABLE DATA
```

Yedek ayrıca boş bir doğrulama DB'sine geri yüklendi:
`probedesk_ex13_verify_20261108_test`. `pg_restore --exit-on-error` exit `0` verdi.
Geri yüklenen DB'de aynı baseline SQL'i çalıştırıldı; locale bloğu dışındaki bütün
count/digest satırları orijinaliyle aynıydı:

```text
diff <(baseline orijinal, "== locale" sonrası)
     <(restored DB, "== locale" sonrası)
exit: 0
```

Doğrulama DB'si `DROP DATABASE ... WITH (FORCE)` ile silindi; kalan kayıt `0`. Bu işlem
delivery verisine dokunmadı. `dev5434` host portuna bağlanılmadı; bakım/doğrulama
komutları delivery Postgres container'ı içinde çalıştırıldı.

## 3. Locale ve ASCII canonical key (EX-03 L-3)

```text
datcollate = en_US.utf8
datctype   = en_US.utf8
datlocprovider = c
upper('i')        = I      (ASCII eşleşmesi true)
upper('serial-i') = SERIAL-I
JS 'serial-i'.toUpperCase() = SERIAL-I
```

Seed edilen iki cihazın DB kaydı:

```text
Bench Power Module A | PSU-DEMO-0001 | serialNumberKey = PSU-DEMO-0001 | key = upper(serial) true
Bench Power Module B | PSU-DEMO-0002 | serialNumberKey = PSU-DEMO-0002 | key = upper(serial) true
```

Bu delivery DB'sinde servis ve DB canonical anahtarı ASCII `i` için aynı sonucu verir.
Farklı locale'li bir PostgreSQL'de `upper()` davranışı bu kanıtla garanti edilmez; EX-03
L-3'teki taşınabilirlik notu geçerlidir.

## 4. Baseline veri parmak izleri

`md5(jsonb_agg(to_jsonb(satır) ORDER BY id))` ile alınan rollout öncesi değerler:

| Tablo                | Kayıt | Digest                             |
| -------------------- | ----: | ---------------------------------- |
| `users`              |     3 | `eed6964bf5dd25f439e78d25f6c59f65` |
| `device_profiles`    |     1 | `b18e4be697cbea2369c3ed9f2fc2c188` |
| `devices`            |     0 | `d751713988987e9331980363e24189ce` |
| `plan_copy_requests` |     0 | `d751713988987e9331980363e24189ce` |
| `test_plans`         |     5 | `cf3794902f6d73a9ddd600465aeee212` |
| `plan_revisions`     |    11 | `444161aa0521f44a382fbc8209235dad` |
| `plan_steps`         |    33 | `0ee4abda99aec93a9876f37f08c80f4a` |
| `step_identities`    |    15 | `7be8b06dfe16282f0b6987d0a001d692` |
| `test_runs`          |    45 | `6695a33180e43e38f0b1b83929a03357` |
| `run_steps`          |   135 | `c6ec065a221852b242a94b7f9e1f1d06` |
| `measurements`       |  3136 | `5d4d5617ccd0ee743a5fa8b139e7ec64` |
| `run_events`         |  3462 | `017fc4e54c8c2e06888c7f0288127dc9` |
| `sessions`           |   330 | `9dc56b032965ec4a7dcf0fc10792b7fc` |

Baseline run dağılımı: `COMPLETED` 37 (28 PASSED, 9 FAILED), `CANCELLED` 6,
`INTERRUPTED` 2; RUNNING yok. Eski run'larda `deviceId` ve `batchNumber` dolu olan
kayıt sayısı `0/0`. Run parmak izine `requestHash` ve `idempotencyKey` alanları da dahildir.

## 5. Build

```text
$ docker compose --profile delivery build
BUILD_EXIT=0
real 21.43
```

Layer cache kullanıldı; build tracked kaynak HEAD `49ec0b0` üzerinden yapıldı. Yeni imajlar:

| İmaj                       | Image ID       | Oluşturma (CET)     | Boyut   |
| -------------------------- | -------------- | ------------------- | ------- |
| `probedesk-api:latest`     | `965ca98e01da` | 2026-11-08 21:03:42 | 486 MB  |
| `probedesk-web:latest`     | `fe43310248e3` | 2026-11-08 21:03:40 | 93.8 MB |
| `probedesk-migrate:latest` | `01ffaa5b51b3` | 2026-11-08 21:03:25 | 1.11 GB |
| `probedesk-seed:latest`    | `ad3d2cf2a538` | 2026-11-08 21:03:41 | 2.06 GB |

İmaj içerik kontrolleri:

- API: `dist/analytics`, `dist/devices`, `dist/reports` mevcut; build-time modül çözümleme
  kontrolü `API runtime modules resolve` verdi.
- Migrate: `20261107120000_analytics_query_indexes` migration dizininde mevcut.
- Web: bundle içinde `overview` ve `devices` chunk'ları bulundu.

İmajlarda git SHA label'i yoktur; teslim eşlemesi temiz HEAD, image ID ve oluşturma
zamanıyla kayıtlıdır.

## 6. Migration ve seed

```text
$ docker compose --profile delivery up -d
UP_EXIT=0
migrate: 10 migrations found
migrate: Applying migration `20261107120000_analytics_query_indexes`
migrate: All migrations have been successfully applied.
migrate container: Exited (0)

seed: Demo devices ready: 2 fixtures (2 created, 0 already present).
seed: Demo plan ready: Power Supply Validation (existing), 2 published versions,
      4 runs (0 created, 4 already present).
seed container: Exited (0)
```

Migration sonrası `_prisma_migrations` içinde tamamlanmış migration sayısı `10`;
`test_runs_batchNumberKey_startedAt_id_idx` mevcut, kaldırılan yinelenen
`devices_deviceProfileId_idx` yok.

Postgres container'ı yeniden oluşturulmadı (`30377ff6880a` aynı) ve named volume
`probedesk-postgres-data` korundu (`2026-11-03T13:32:40Z`). `down -v`, reset, truncate
veya destructive rollback çalıştırılmadı.

## 7. Rollout sonrası veri koruma

Aynı baseline run/session ID kümeleri üzerinde rollout sonrası ve smoke sonrası
hesaplanan parmak izleri rollout öncesiyle karşılaştırıldı:

```text
run/step/measurement/event/plan/revision/step-identity/user/eski-session alt küme diff:
exit 0   (rollout sonrası)
exit 0   (tarayıcı smoke sonrası)
```

Tam tablo digest'lerinde yalnız beklenen değişiklik oluştu:

| Tablo                | Önce | Sonra | Not                |
| -------------------- | ---- | ----- | ------------------ |
| `devices`            | 0    | 2     | Additive demo seed |
| `test_runs`          | 45   | 45    | Birebir aynı       |
| `run_steps`          | 135  | 135   | Birebir aynı       |
| `measurements`       | 3136 | 3136  | Birebir aynı       |
| `run_events`         | 3462 | 3462  | Birebir aynı       |
| `test_plans`         | 5    | 5     | Birebir aynı       |
| `plan_revisions`     | 11   | 11    | Birebir aynı       |
| `plan_steps`         | 33   | 33    | Birebir aynı       |
| `plan_copy_requests` | 0    | 0     | Birebir aynı       |
| `users`              | 3    | 3     | Birebir aynı       |

Eski 45 run'ın tamamında `deviceId`/`batchNumber` hâlâ `null`; geriye dönük eşleştirme
yapılmadı. Yeni run oluşturulmadı; RUNNING run yok.

## 8. 8080 health ve API smoke

```text
GET /api/health/live  -> 200 {"status":"ok"}
GET /api/health/ready -> 200 {"status":"ok","checks":{"database":"ok","migrations":"ok"}}
GET /, /overview, /devices, /runs/<id>, /runs/<id>/report -> 200 text/html
GET /api/docs-json -> 200; 27 path
```

Servis edilen OpenAPI'de yeni yollar mevcut:

```text
/api/analytics/overview
/api/devices
/api/devices/{id}
/api/devices/{id}/archive
/api/devices/{id}/restore
/api/plan-versions/{id}/copy
/api/runs/{id}/export
/api/runs/{id}/report
```

Viewer oturumuyla gerçek veri üzerinde:

- `GET /api/devices?state=all` → 200, 2 cihaz: `PSU-DEMO-0001`, `PSU-DEMO-0002`.
- `GET /api/analytics/overview?from=2026-11-01T00:00:00.000Z&to=2026-11-09T00:00:00.000Z`
  → 200; `totalRuns=45`, `completedRuns=37`, `passedRuns=28`, `failedRuns=9`,
  `cancelledRuns=6`, `interruptedRuns=2`, `errorRuns=0`,
  `passRatePercent="75.68"`, `averageDurationMs="17718.784"`; 8 günlük trend,
  7 başarısız adım grubu.
- Eski run snapshot'ları:
  - `a36b18b7-851c-4d52-bb07-f00bd9e4e3aa` PASSED, 90/90, cihaz/parti null.
  - `20e8fcf4-5f15-4296-ba39-3a2b5c8df21a` FAILED, 90/90, cihaz/parti null.
  - `94f1c52b-ed83-4acd-b00d-f825a6882985` CANCELLED, 45/90, cihaz/parti null.
- Report projection (`schemaVersion=1`): PASSED/FAILED run'larda 3 adım ve 90 ölçüm;
  CANCELLED run'da 3 adım ve 45 ölçüm; eksik istatistikler başarıya çevrilmedi.
- CSV (`format=csv`): PASSED run 200, `16057` byte, BOM `efbbbf`, 91 satır
  (header + 90 ölçüm); CANCELLED run `7746` byte, 46 satır (header + 45 ölçüm).
  `Content-Type: text/csv; charset=utf-8`, `Cache-Control: no-store`,
  `Content-Disposition: attachment; filename="probedesk-run-<uuid>.csv"`.
- JSON (`format=json`): 200, `13215` byte, `schemaVersion=1`, aynı run/steps,
  90 ölçüm; `Content-Disposition: attachment; filename="probedesk-run-<uuid>.json"`.
- Report/export gövdelerinde `passwordHash`, `password`, `csrfToken`, `tokenHash`,
  `requestHash`, `idempotencyKey`, `sessionId`, `cookie` anahtarları taranmadı
  (eşleşme yok).

## 9. Gerçek tarayıcı smoke (localhost:8080)

Playwright 1.64.1 ve mevcut yerel Chromium headless shell 1243 cache'i kullanıldı;
yeni tarayıcı indirilmedi. Viewer hesabıyla gerçek UI:

- Login → `/overview`; başlık `Overview · ProbeDesk`. KPI'lar: toplam `45`,
  pass rate `75.68%`, failed `9`, average duration `17718.784 ms`.
  Navigation: Overview, Test Plans, Devices, Run History, Compare Runs.
  Chart.js canvas `1134×272`, boyanmış piksel `19182` (boş canvas değil).
- `/devices`: 2 satır, `PSU-DEMO-0001` ve `PSU-DEMO-0002`, ikisi Active.
- `/devices/5f0d3c1e-2a4b-4c6d-8e9f-000000000001`: seri numarası, profil,
  Active durumu ve açıklama göründü.
- `/runs/a36b18b7-851c-4d52-bb07-f00bd9e4e3aa/report`: başlık `Run Report · ProbeDesk`;
  `Simulated test results`, `90 / 90`, `No device recorded`, `No batch recorded`.
  Üç grafik canvas'ı `1134×272` ve sırasıyla `200233`, `199480`, `199286` boyanmış
  piksel verdi.
- `/runs/a36b18b7-851c-4d52-bb07-f00bd9e4e3aa`: `Run Details · ProbeDesk`,
  `Completed`/`Passed`, cihaz/parti null.
- Run Details üzerinden gerçek UI indirmeleri: CSV `16057` byte / 91 satır / BOM
  `efbbbf`; JSON `13215` byte / `schemaVersion=1` / 90 ölçüm; dosya adları
  `probedesk-run-<uuid>.csv|json`.
- Sign out → `/login`; page error yok. Giriş öncesi tek `/api/auth/me` 401'i beklenen
  oturum yoklamasıdır; işlevsel hata değildir.

Ekran görüntüleri yerel geçici artifact'tir, git'e eklenmedi:
`smoke-overview-1440.png`, `smoke-devices-1440.png`, `smoke-device-detail-1440.png`,
`smoke-report-1440.png`, `smoke-run-details-1440.png`.

## 10. Oturum, log ve veri hijyeni

- Smoke için 4 geçici Viewer oturumu açıldı; hepsi Sign out/`POST /api/auth/logout`
  (204) ile kapatıldı. Session son durumu: toplam `334`, aktif `295`, revoked `39`;
  aktif sayı baseline ile aynı kaldı.
- Delivery'ye yeni run, plan, revision, ölçüm, event veya `PlanCopyRequest` yazılmadı.
  Tek ekleme seed'in 2 demo cihazıdır.
- Rollout sonrası nginx loglarında `5xx` yok (`0`). Compose logları `PlannerDemo`,
  `OperatorDemo`, `ViewerDemo`, `probedesk_session`, `XSRF-TOKEN`, `authorization`,
  `set-cookie`, `password`, `DATABASE_URL` ve `postgresql://` desenleriyle tarandı;
  `0` eşleşme bulundu. Postgres container logundaki eski `ERROR` satırları
  2026-11-03–06 tarihli önceki testlerden kalmadır; rollout sonrası yeni API sürecinde
  hata görülmedi.

- API tek süreç: `docker top probedesk-api-1` yalnız `node dist/main.js` (PID 47138)
  gösterdi.

## 11. Teslim edilen runtime kimliği

| Öğe                         | Rollout sonrası                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Build kaynağı               | `49ec0b0c5b9c12be044698f4af3c2cac0e67e367`                                               |
| Rollout sonrası branch HEAD | `bb753712aa6c21cd59866c1990c1f54c80684ec5` (yalnız script/evidence ekler)                |
| API container / image       | `69e03a40625b` / `probedesk-api` `sha256:965ca98e01da`                                   |
| Web container / image       | `b8fdc9054b9a` / `probedesk-web` `sha256:fe43310248e3`                                   |
| Migrate container / image   | `11479f1a3df1` / `probedesk-migrate` `sha256:01ffaa5b51b3`, Exited (0)                   |
| Seed container / image      | `73312a619a50` / `probedesk-seed` `sha256:ad3d2cf2a538`, Exited (0)                      |
| Postgres container / image  | `30377ff6880a` / `postgres:18.1-alpine` (değişmedi)                                      |
| Volume                      | `probedesk-postgres-data` (değişmedi)                                                    |
| Portlar                     | Yalnız `127.0.0.1:8080` web; Postgres host `127.0.0.1:5434`; API host'a publish edilmedi |

## 12. Sınırlar, açık kapılar ve lead'e devredilenler

1. Bu teslim **yerel Compose delivery**'dir: HTTP, `NODE_ENV=development`,
   `SESSION_COOKIE_SECURE=false`, tek API süreci ve dev/delivery ortak named volume.
   Üretim TLS/secure cookie kapsam dışıdır.
2. İmajlar yalnız yerelde build edildi; registry push, PR veya `main` merge yapılmadı.
3. Birim/integration/web/E2E geniş suite'leri ve GitHub CI bu teslim turunda yeniden
   çalıştırılmadı; EX-12'deki mevcut sonuçlar geçerlidir. CI sonucu bu belgede iddia
   edilmez.
4. Native OS print dialog, native %200 zoom ve kullanıcı görsel kabulü bu turda
   yapılmadı; EX-12'deki sınırlar geçerlidir. Ürün/görsel kabul kullanıcıya aittir.
5. README ve demo dokümanları iki demo cihazı ve yeni uçtan uca akışı bu rollout
   sırasında doğrulanmış olarak anlatmıyor; bu dosyalar lead sahipliğindedir. EX-13
   kabulündeki README maddesi lead tarafından kapatılmalıdır.
6. EX-13'ün istediği ayrı seed'li `_test` DB kopyası upgrade kaydı bu işin dosya
   sahipliğinde değildir; rollout sırasında `bb75371` ile
   [`ex-13-upgrade.md`](ex-13-upgrade.md) eklenmiştir. Bu worker o kaydı üretmedi veya
   doğrulamadı. Bu rollout ayrıca gerçek delivery DB'sinde yedekli additive upgrade
   kanıtı üretmiştir; ayrı upgrade kaydının incelenmesi ve EX-13 kart durumu lead'in
   kararına bırakılmıştır.
7. Yedek dosyası repository dışında tutulur; içeriği (password hash'leri dahil) git'e
   eklenmedi ve bu belgeye yazılmadı. Yedek yalnız yerel makinede saklanır.
8. Delivery DB'si dev ile aynı volume'ü paylaşır; bu iş sırasında `down -v`, reset,
   drop veya destructive rollback yapılmadı. `127.0.0.1:5433` test DB'leri ve
   `127.0.0.1:5434` host bağlantısı kullanılmadı.

## Lead kontrolü

Kanıt kaydı ve yedek/restore/fingerprint yöntemi incelendi. Lead ayrıca
`curl -fsS http://127.0.0.1:8080/api/health/ready` çalıştırdı: exit0,
`status=ok`, database/migrations=ok. README/demo iki cihazı, yeni rol akışını ve
gerçek E2E/teslim kayıtlarını kapsayacak şekilde güncellendi. Worker smoke
sonuçları devralınmıştır; lead tarafından geniş suite tekrar edilmemiştir.
