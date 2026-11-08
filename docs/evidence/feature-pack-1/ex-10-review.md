# EX-10 — Bağımsız teknik inceleme (terminal rapor ve güvenli CSV/JSON export)

- Tarih: 2026-11-07
- İnceleme commit'i: `2e56960f0b267474fbc3488bae7d05c221fee626` (`feat: export terminal run reports as safe CSV and JSON`)
- İnceleme başlangıcındaki ve sonundaki HEAD: `427b9ac8ec2b0a767746b4e45bb5401ba4d8e44f` (`feat: select devices and batches when starting or repeating runs`)
- Branch: `feat/analytics-reporting-devices`; `origin/feat/analytics-reporting-devices` aynı commit'te.
- İnceleme türü: **Bağımsız backend kod/API/DB/test incelemesi.** Ürün, görsel veya nihai yayın kabulü değildir.
- Kapsam: EX-10 rapor projection'ı, CSV/JSON export, HTTP başlıkları, OpenAPI/client yansıması, production
  `AppModule` kaydı ve bunların testleri. `427b9ac` yalnız EX-05 frontend/metadata değişikliğidir; EX-10
  kapsamına girmez. EX-08 analytics, EX-11 download/print ve EX-05 UI bu incelemenin dışındadır.
- Kısıt: Repository içinde yalnızca bu review dosyası yazıldı. Kaynak, şema, migration, doküman ve görev
  kartı değiştirilmedi. `git add`, `git commit`, `git push`, `git checkout`, `git reset`, `git stash`
  çalıştırılmadı; subagent başlatılmadı. Başka worker'ın `analytics/**`, schema ve migration alanına
  dokunulmadı.

## Sonuç özeti

| Alan                                       | Sonuç                                                                                                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal projection, `schemaVersion=1`     | **Geçti.** `schemaVersion`, `generatedAt`, çalışma kimlikleri ve metadata tek projection'da.                                                                                                              |
| Tek repeatable-read snapshot               | **Geçti.** `ReportsService` tek `RepeatableRead` transaction'ında `RUN_SNAPSHOT_SELECT` okuyor; report/export aynı servisi kullanıyor.                                                                    |
| Canlı plan/cihaz join'ı yok                | **Geçti.** Yalnız snapshot alanları seçiliyor; cihaz canlı adı değiştirilse de rapor eski snapshot'ı veriyor.                                                                                             |
| Whitelist ve hassas alan yok               | **Geçti.** Session, CSRF, `passwordHash`, `requestHash`, `idempotencyKey`, event payload ve `eventSequence` yok; testte anahtar listesi ve yasak string taraması var.                                     |
| RUNNING 409 / tüm terminal durumlar        | **Geçti.** `RUN_NOT_TERMINAL` + güvenli `{status}` detayı; COMPLETED, CANCELLED, INTERRUPTED ve ERROR okunuyor.                                                                                           |
| Kısmi ve boş veri                          | **Geçti.** Kısmi adımda istatistikler null, eksik örnek uydurulmuyor; boş run header-only CSV üretiyor.                                                                                                   |
| CSV sözleşmesi                             | **Geçti.** UTF-8 BOM, CRLF, RFC 4180 quote, 19 kolon, stepPosition/sampleIndex sırası, formül/control neutralizasyonu, resmi negatif decimal korunması, Unicode ve null metadata testli.                  |
| 10.000 ölçüm                               | **Geçti.** 10×1.000 gerçek PG kaydı; 10.000 CSV satırı, >1 MB yanıt, kırpma/uydurma satır yok.                                                                                                            |
| HTTP başlıkları ve dosya adı               | **Geçti.** `text/csv; charset=utf-8` / `application/json; charset=utf-8`, `attachment`, yalnız canonical UUID dosya adı, `Cache-Control: no-store`. Uppercase UUID isteği lowercase'e normalize ediliyor. |
| JSON = rapor projection'ı                  | **Geçti.** `generatedAt` dışında birebir aynı; decimal string'ler korunuyor.                                                                                                                              |
| Production kaydı ve generated artifact'lar | **Geçti.** `ReportsModule` `AppModule`'da; `openapi.json` ve `api-client/schema.ts` commit'li ve birbiriyle eşleşiyor.                                                                                    |
| OpenAPI hata içerik tipleri                | **L-1 düşük.** Export hata yanıtları belgede `text/csv` alternatifiyle de tanımlı; çalışma zamanında hata gövdesi yalnız JSON.                                                                            |
| Test bootstrap sadakati                    | **L-2 düşük.** `AppModule` artık `ReportsModule`'u içeriyor; test ayrıca aynı modülü import ediyor ve eski yorumu taşıyor.                                                                                |
| Öneri                                      | **Teknik kabul önerilir; kritik/yüksek/orta açık bulgu yok.** L-1 EX-11 generated client entegrasyonundan önce düzeltilmeli; L-2 opsiyonel test temizliğidir.                                             |

## Bulgular

### L-1 — Düşük: Export hata yanıtları OpenAPI'de `text/csv` gövdesiyle de tanımlı

**Konum:**

- `apps/api/src/reports/reports.controller.ts:105`: `@ApiProduces('text/csv', 'application/json')` metot
  seviyesinde bütün yanıtlara uygulanıyor.
- `apps/api/openapi.json:2217-2230`: export `400` içeriği hem `text/csv` hem `application/json` olarak
  `ApiErrorDto` taşıyor; aynı durum `401`, `403`, `404` ve `409` için de tekrarlanıyor.
- `packages/api-client/src/schema.ts:3017-3024` ve devamı: generated client hata içeriğinde `text/csv`
  alternatifi yer alıyor.
- `apps/api/src/common/errors/api-exception.filter.ts:165`: bütün hatalar `response.status(...).json(body)`
  ile JSON olarak gönderiliyor.

**Gerçek durum:** Çalışma zamanı hatası her zaman JSON'dur; `report-export.e2e-spec.ts:724-739` içindeki
400 senaryoları `response.body.code === 'VALIDATION_ERROR'` beklentisiyle geçmiştir, yani gövde JSON olarak
ayrıştırılmıştır. Buna karşılık sözleşme ve generated client, hata yanıtının CSV de olabileceğini söylüyor.
Başarılı 200 içeriği (`text/csv` binary veya `RunReportDto`) doğrudur; sorun yalnız hata yanıtlarının içerik
tipi beyanındadır.

**Yeniden üretim:** `apps/api/openapi.json` içindeki `/api/runs/{id}/export` → `400.content` bloğunu okuyun;
`text/csv` altında `ApiErrorDto` görülür. Aynı isteği `format` olmadan çalıştırınca gövde JSON döner; mevcut
e2e testi bunu dolaylı olarak doğrular. Hata yanıtının `Content-Type` başlığı ayrıca assert edilmiyor.

**Etki:** Düşük. Çalışma zamanı davranışı doğru; ancak OpenAPI sözleşmesi ve EX-11'de kullanılacak generated
client hata tipi yanıltıcı. Blob indirme hatasının JSON olarak okunması gerektiği istemcide açıkça
bilinmezse tip/ayrıştırma hatasına yol açabilir.

**Öneri:** `@ApiProduces` kaldırılıp başarı içeriği yalnız `@ApiOkResponse` içinde bırakılmalı veya hata
yanıtları açıkça yalnız `application/json` olarak tanımlanmalı; ardından `openapi:emit`,
`openapi:generate` ve `openapi:check` çalıştırılmalı. Testlere hata yanıtı için tek bir
`Content-Type: application/json` assertion'ı eklenmeli. Kabulü engellemez.

### L-2 — Düşük: Hedefli test uygulaması `ReportsModule`'u ikinci kez import ediyor

**Konum:**

- `apps/api/test/support/report-test-application.ts:8-12`: yorum hâlâ modülün production'da kayıtlı
  olmadığını söylüyor.
- `apps/api/test/support/report-test-application.ts:16-18`: `imports: [AppModule, ReportsModule]`.
- `apps/api/src/app.module.ts:11,23`: `ReportsModule` artık production `AppModule` içinde.

**Gerçek durum:** Nest aynı modül sınıfını dedupe ettiği için testler geçiyor ve çalışma zamanı hatası yok.
Ancak test, production kaydını kendi import'uyla telafi edebildiği için kayıt kaldırılsa bile bu hedefli suite
yeşil kalabilir. Production kaydı `openapi.e2e-spec.ts:52-57` exact path listesiyle ayrıca korunuyor; bu
nedenle gerçek bir kayıp yok. Yorum ise artık yanlış.

**Yeniden üretim:** `report-test-application.ts` dosyasındaki import listesini ve `app.module.ts` kaydını
karşılaştırın; aynı `ReportsModule` iki kez istenir.

**Etki:** Düşük; test bakım/sadakati sorunu, ürün davranışı değil.

**Öneri:** `imports: [AppModule]` yapılıp yorum güncellenmeli; istenirse production-only bir smoke
assertion'ı eklenmeli. Kabulü engellemez.

### I-1 — Bilgi: CSV başlıkları serialize işleminden önce set ediliyor

**Konum:** `apps/api/src/reports/reports.controller.ts:170-179`.

**Gerçek durum:** `Content-Type: text/csv` ve `Content-Disposition: attachment` başlıkları
`serialiseRunReportCsv(report)` çağrısından önce set ediliyor. Serialization normal DTO için toplam bir
fonksiyondur ve gözlenen bir hata yoktur. Yine de beklenmeyen bir serialization hatası oluşursa exception
filter JSON hata gövdesini gönderirken bu CSV başlıkları korunabilir. Bu yalnızca savunma amaçlı bir
gözlemdir; mevcut veri tipleriyle tetiklenebilir bir yol gösterilmedi.

**Öneri:** İstenirse CSV gövdesi başlıklar set edilmeden önce hesaplanabilir. EX-10 kabulü için zorunlu
değildir.

## Reviewer tarafından gerçekten çalıştırılan kontroller

Aşağıdaki sonuçlar bu inceleme sırasında çalıştırılan komutlardan alınmıştır. Hiçbir komut çalıştırılmamış
gibi gösterilmemiştir.

| Kontrol                     | Komut / yöntem                                                                                                                                                                                  | Gerçek sonuç                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HEAD/branch                 | `git rev-parse HEAD`; `git rev-parse origin/feat/analytics-reporting-devices`; `git status --short`                                                                                             | `427b9ac8…`; origin aynı; çalışma ağacında yalnız EX-08 analytics alanı ve bu review dosyası.                                                                                              |
| EX-10 commit kapsamı        | `git show --stat --oneline 2e56960`                                                                                                                                                             | 18 dosya, `+3471/−8`; reports, OpenAPI/client, testler, kanıt ve görev kaydı. Prisma schema/migration yok.                                                                                 |
| Sonraki commit ayrımı       | `git diff --stat 2e56960..427b9ac -- <reports/openapi/client/app.module yolları>`; `git log 2e56960..HEAD -- <aynı yollar>`                                                                     | Çıktı yok; `427b9ac` EX-10 delta'sına dokunmuyor.                                                                                                                                          |
| CSV unit                    | `NODE_ENV=test npm run test --workspace apps/api -- src/reports/report-csv.spec.ts`                                                                                                             | **1 dosya / 8 test geçti**, 209 ms, exit 0.                                                                                                                                                |
| Gerçek HTTP/PG rapor-export | Benzersiz `probedesk_ex10_review_11072335040198_test` DB'si; guarded migrate; `npm run test:e2e --workspace apps/api -- test/report-export.e2e-spec.ts test/openapi.e2e-spec.ts`                | **2 dosya / 13 test geçti**, 3.23 s, exit 0. (10 rapor/export + 3 OpenAPI.)                                                                                                                |
| Migration guard             | `npm run db:migrate:test --workspace apps/api`; `TEST_DATABASE_URL` yalnız review DB'sine yönlendirildi; host `127.0.0.1`, port `5433`, DB adı pattern'i kodda assert edildi.                   | **10 migration** başarıyla uygulandı, exit 0. 9'u commit'li; 10'uncusu EX-08'in henüz commit'li olmayan analytics index migration'ı (yalnız review DB'si).                                 |
| Hedefli lint                | `./node_modules/.bin/oxlint --type-aware apps/api/src/reports apps/api/test/report-export.e2e-spec.ts apps/api/test/support/report-helpers.ts apps/api/test/support/report-test-application.ts` | **0 warning / 0 error**, 10 dosya, exit 0.                                                                                                                                                 |
| Hedefli format              | `./node_modules/.bin/prettier --check <aynı dosyalar>`                                                                                                                                          | `All matched files use Prettier code style!`, exit 0.                                                                                                                                      |
| Genel API typecheck         | `npm run typecheck --workspace apps/api`                                                                                                                                                        | **Exit 0.** İnceleme anında EX-08'in geçici `analytics-perf-tmp.ts` dosyası worktree'de yoktu; lead'in devralınan exit 2 hatası bu koşuda görülmedi.                                       |
| Genel API build             | `npm run build --workspace apps/api`                                                                                                                                                            | `nest build` **exit 0**; build zinciri bu incelemede çalıştı.                                                                                                                              |
| OpenAPI uygulama eşleşmesi  | `openapi.e2e-spec.ts` içindeki “keeps the committed document in sync with the application” testi                                                                                                | Geçti; commit'li `openapi.json`, uygulamadan üretilen belgeyle eşit.                                                                                                                       |
| API client eşleşmesi        | `npx --no-install openapi-typescript apps/api/openapi.json -o <temp>` + `diff`                                                                                                                  | `CLIENT_SCHEMA_MATCH=yes`; commit'li client, commit'li OpenAPI'den birebir üretiliyor.                                                                                                     |
| OpenAPI path/şema kontrolü  | `node` ile committed `openapi.json` okuması                                                                                                                                                     | Report/export path'leri, `schemaVersion` enum `[1]`, CSV binary, JSON `$ref`, `format` enum `csv/json`, `session` security, 409 yanıtları: hepsi mevcut.                                   |
| DB temizliği                | Test sonrası `pg` ile tablo sayımları; ardından exact assert + `DROP DATABASE … WITH (FORCE)`                                                                                                   | `users=0`, `devices=0`, `device_profiles=0`, `test_plans=0`, `plan_revisions=0`, `plan_steps=0`, `test_runs=0`, `run_steps=0`, `measurements=0`, `run_events=0`, `sessions=0`; DB silindi. |

### Devralınan kanıtlar (reviewer tarafından yeniden çalıştırılmadı)

- Worker: CSV unit 8/8; gerçek HTTP/PG report-export 10/10; API lint 0 warning/error; typecheck exit 0;
  yeni dosyaların Prettier kontrolü exit 0. Dedicated `probedesk_pack1_reports_test` DB'sinde guarded
  migration 9 migration ile exit 0.
- Lead: production `ReportsModule` kaydı sonrası aynı dedicated DB'de `report-export.e2e-spec.ts` +
  `openapi.e2e-spec.ts` **2 dosya / 13 passed**, exit 0, 4.75 s; CSV unit 8/8; `openapi:emit`,
  `openapi:generate`, `openapi:check` exit 0; genel API typecheck exit 2 (EX-08'in geçici
  `test/support/analytics-perf-tmp.ts:425` tip hatası) ve build zinciri o koşuda çalışmadı.
- Reviewer'ın kendi koşusu aynı test sayılarını (8 ve 13) doğruladı. Lead'in typecheck/build engeli
  inceleme anında tekrarlanmadı: EX-08'in geçici `analytics-perf-tmp.ts` dosyası worktree'de artık yoktu
  ve `tsc`/`nest build` exit 0 verdi. Bu sonuç EX-10 kodu değiştiği için değil, paralel çalışma ağacı
  durumu değiştiği için böyledir.

## DB güvenliği ve izolasyon

- Review DB'si `TEST_DATABASE_URL`den türetilen benzersiz
  `probedesk_ex10_review_11072335040198_test` adıyla, yalnız `127.0.0.1:5433` üzerinde oluşturuldu.
  Her write/migration/test öncesi DB adı regex'i, host ve port kodda assert edildi.
- Migration yalnız `npm run db:migrate:test --workspace apps/api` guarded komutuyla uygulandı; doğrudan
  `prisma migrate deploy` çalıştırılmadı.
- Test runner'a `NODE_ENV=test`, doğru `DATABASE_URL`/`TEST_DATABASE_URL` kimliği ve exact
  `REPORT_TEST_DATABASE_NAME` verildi; uygulamanın ve helper'ın guard'ları korundu.
- `127.0.0.1:5434/probedesk` geliştirme DB'sine, `127.0.0.1:5433/probedesk_test` şablon DB'sine, lead'in
  report DB'sine ve delivery `5432` DB'sine hiçbir migration/test/write yapılmadı. Başka agent'ın DB'si
  kullanılmadı.
- Test sonunda review DB'si yalnız exact ad/host/port assertion'ları ve `WITH (FORCE)` ile silindi;
  `pg_database` kontrolünde kalmadığı doğrulandı. URL veya credential çıktısı yazdırılmadı.

## Çalıştırılmayan kontroller ve sınırlar

- Tam API unit/integration suite, tam `npm run verify`, web testleri, CI workflow, Playwright/browser,
  print/PDF, delivery profili ve `localhost:8080` smoke bu incelemede çalıştırılmadı. EX-11/EX-12
  kapsamındadır; çalıştırılmış gibi gösterilmedi.
- `npm run openapi:check` yeniden çalıştırılmadı; komut lead'in sahip olduğu `apps/api/openapi.json`
  dosyasını yeniden yazar. Bunun yerine OpenAPI uygulama eşleşmesi gerçek testte ve client eşleşmesi
  temp dosyada read-only doğrulandı. Lead'in `openapi:check` exit 0 kaydı devralınan kanıttır.
- EX-08 analytics sorguları, manifest/readiness entegrasyonu ve 10. migration'ın commit'lenmesi bu
  incelemenin dışındadır. Review DB'sinde worktree'de bulunan EX-08 index migration'ı da uygulandı; bu
  yalnız izole review DB'sini etkiledi ve DB silindi. Manifest'in 9 migration beklentisi nedeniyle
  readiness/full-suite gate'i EX-08 entegrasyonunu beklemeye devam ediyor.
- Eşzamanlı yazma ile repeatable-read yarışı ayrı bir testle zorlanmadı; tek `findUnique` okuması ve
  `RepeatableRead` transaction ayarı kod düzeyinde doğrulandı. E2E fixture'larında FORCED_FAILURE ve
  non-null `failureStepId` ile `versionNumber > 1` varyasyonu yok; alanlar doğrudan snapshot'tan
  kopyalandığı için kod riski düşüktür, istenirse test genişletilebilir.
- EX-05 frontend ve `427b9ac` bu incelemenin kapsamı dışıdır; yalnız EX-10 delta'sının değişmediği
  doğrulandı.
- Fiziksel cihaz, Safari/mobil ve üretim TLS kapsam dışıdır; bu incelemede ayrıca denenmedi.

## Kabul önerisi

**EX-10 teknik olarak `Accepted` edilebilir; kritik, yüksek veya orta açık bulgu yoktur.** Terminal
snapshot projection'ı, tek repeatable-read okuma, canlı join yapmama, hassas alan whitelist'i, dört terminal
durum, kısmi/boş/10.000 ölçüm, CSV byte/format güvenliği, attachment/no-store/canonical UUID ve JSON=rapor
eşitliği gerçek PostgreSQL ve gerçek HTTP üzerinden doğrulandı. Reviewer'ın izole DB'sindeki hedefli koşusu
**8/8 unit + 13/13 e2e** geçti; hedefli lint/format, typecheck ve build de exit 0 verdi.

Kabul için önerilen koşullar:

1. **L-1** düşük bulgusu EX-11 generated client entegrasyonundan önce düzeltilmeli; hata yanıtları yalnız
   JSON olarak belgelenmeli ve OpenAPI/client yeniden üretilmelidir. Teknik kabulü engellemez.
2. **L-2** opsiyonel test temizliğidir; `report-test-application.ts` yalnız `AppModule` import etmeli ve
   yorum güncellenmelidir.
3. **I-1** savunma amaçlı gözlemdir; istenirse CSV gövdesi başlıklardan önce hesaplanır.
4. Kart durumu, `docs/tasks/README.md` ve `docs/roadmap.md` güncellemesi lead tarafından ayrı commit'te
   yapılmalıdır; bu review kaydı görev statüsünü değiştirmez.
5. Ürün/görsel kabul, nihai teslim ve yayın kararı kullanıcıya aittir; bu belge onları vermez.
