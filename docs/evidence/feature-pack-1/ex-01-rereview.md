# EX-01 — Bağımsız yeniden inceleme (paket sözleşmeleri ve görev izlenebilirliği)

- Tarih: 2026-11-06
- İnceleme commit'i: `2356b8b` (`docs: complete feature contract traceability and edge cases`)
- Önceki inceleme: `c169654` / [ex-01-review.md](ex-01-review.md)
- Branch: `feat/analytics-reporting-devices`; HEAD `2356b8b`
- İnceleme türü: **Bağımsız doküman/sözleşme yeniden incelemesi.** Ürün kabulü, kullanıcı kabulü
  veya yayın kararı değildir.
- Kapsam: `2356b8b` diff'i ve mevcut sözleşme dosyaları; kod doğrulaması için yalnız salt-okunur
  okuma. Uygulama/API/DB/browser testi çalıştırılmadı; EX-01 doküman görevidir ve planın 11.
  bölümündeki gerçek kontroller EX-02 ve sonraki kartlara aittir.
- Kısıt: Yalnız bu dosya yazıldı. `git add/commit/push/checkout/reset/stash` çalıştırılmadı;
  hiçbir görev kartı durumu değiştirilmedi; subagent başlatılmadı.

## Sonuç özeti

| Alan                | Sonuç                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Önceki H-1          | **Kapandı.** Rol matrisi, REQ-28–31 kayıtları, dört kabul kutusu ve T29–T39 kontrolleri ana sözleşmelere aktarılmış.                                                                   |
| Önceki M-1          | **Kapandı.** Veri modeli, API uç/hata tablosu, frontend route tablosu ve backend modül tablosu yeni yüzeyi gösteriyor.                                                                 |
| Önceki M-2          | **Kapandı.** “Dört özellik paketi” ifadesi “özellik paketi 1’in (dört özellik)” olarak düzeltilmiş.                                                                                    |
| Önceki M-3          | **Kapandı.** EX-13 bağımlılığı EX-12 + EX-01–EX-12 kart bazlı inceleme kayıtlarını içeriyor.                                                                                           |
| Önceki M-4          | **Kapandı.** Analytics top-step satırında `planId`, `planVersionId`, `logicalStepId` var.                                                                                              |
| Önceki M-5          | **Kapandı.** `failureRatePercent` 2 hane half-up decimal string; payda sıfırsa null.                                                                                                   |
| Önceki L-1          | **Kapandı.** EX-05 kartında generated OpenAPI/client tipi önkoşulu yazılı.                                                                                                             |
| Önceki L-2          | **Kapandı.** Batch çifti, varsayılan state, archive/restore, copy adı/404, CSV boolean ve bilinmeyen cihaz filtresi netleştirilmiş.                                                    |
| Önceki L-3          | **Kısmen kapandı.** Prettier ve README tarihi düzeldi; kanıt link sayıları hâlâ gerçek sayımla uyuşmuyor (yeni L-5).                                                                   |
| Kritik/Yüksek bulgu | **Yok.**                                                                                                                                                                               |
| Yeni Orta bulgu     | **M-6:** Güncel iş ve özet sayıları hâlâ eski (implementation guide/roadmap).                                                                                                          |
| Yeni Düşük bulgular | **L-4:** Architecture sürüm tablosu bozuk. **L-5:** Kanıt link sayıları. **L-6:** `RUN_NOT_TERMINAL` açıklaması dar.                                                                   |
| Kabul önerisi       | **Koşullu kabul.** Sözleşme gate'i kapandı ve EX-02 başlayabilir; EX-01 kartının `Accepted` işareti M-6 ve L-5 düzeltmesine bağlı. Bu düzeltmeler davranış sözleşmesini değiştirmiyor. |

## Önceki bulguların kapanışı

### H-1 — Kapandı: rol matrisi, REQ kayıtları, kabul ve test izlenebilirliği

- `docs/requirements.md:24-28` rol tablosuna beş yeni satır eklendi: dashboard/cihaz
  listesi-ayrıntısı-geçmişi (P/O/V), cihaz oluşturma/düzenleme/arşivleme/geri açma (P), bağımsız
  plan kopyalama (P), Start Run’da cihaz/parti seçimi (O), terminal rapor/CSV/JSON/yazdırma
  (P/O/V). Bu satırlar plan §3 matrisiyle anlamca uyumlu.
- `docs/requirements.md:63-66` REQ-28–31 kayıtları “Ana görevler” ve “Kontroller” kolonlarıyla
  mevcut. Kontroller sırasıyla T32/T36/T39, T34/T38/T39, T29/T30/T31/T35/T39 ve
  T29/T33/T37/T39.
- `docs/acceptance.md:30-33` dört yeni ürün kabul kutusu var; her biri ilgili T kimliklerine atıf
  yapıyor.
- `docs/testing.md:7` kapsamı REQ-23–31’e genişletiyor; `:63-73` T29–T39 satırlarını ve her
  satırın ana EX görevini tanımlıyor. Tüm yeni T kimlikleri gerçekten mevcut; REQ kayıtlarındaki
  kontrollerin hiçbiri eksik değil.

**Sonuç:** Önceki H-1’in dört ayağı (rol tablosu, REQ kaydı, kabul kutuları, test kontrolleri)
kapanmıştır. Kartların REQ-28–31 atıfları artık birincil sözleşmelerden doğrulanabiliyor.

### M-1 — Kapandı: özet tabloları yeni yüzeyi gösteriyor

- `docs/data-model.md:24` `TestRun` satırına `deviceId?`, `deviceSnapshot?`, `batchNumber?`,
  `batchNumberKey?` eklendi; `:28-29` `Device` ve `PlanCopyRequest` modelleri eklendi.
- `docs/api.md:42-51` `/devices`, `/plan-versions/:id/copy`, `/analytics/overview`,
  `/runs/:id/report` ve `/runs/:id/export` uçlarını; `:113-116` dört yeni device hata kodunu
  içeriyor.
- `docs/frontend.md:30-33` `/overview`, `/devices`, `/devices/:deviceId` ve `/runs/:runId/report`
  route’larını gösteriyor.
- `docs/architecture.md:42-44` `Devices`, `Analytics` ve `Reports` modüllerini içeriyor.

**Sonuç:** Önceki M-1’in dört tablosu güncellenmiş. Ayrıntılı alan/kısıt kuralları plan §4–5’te
kalmaya devam ediyor; bu, M-1’in istediği “en azından yeni yüzey görünür olsun” koşuluyla
uyumlu.

### M-2 — Kapandı: “dört özellik paketi” ifadesi

`docs/tasks/README.md:148` artık “Kullanıcı özellik paketi 1’in (dört özellik) uygulanmasını
yetkilendirdi.” diyor. Plan §1’deki tek paket/dört özellik tanımıyla çelişki kalmadı.

### M-3 — Kapandı: EX-13 inceleme önkoşulu

`docs/tasks/EX-13.md:5` bağımlılığı “EX-12 ve EX-01–EX-12 kartlarının ayrı inceleme kayıtları”
olarak güncellendi. Plan §10’daki “EX-12 ve kart bazlı incelemeler” önkoşuluyla uyumlu.

### M-4 — Kapandı: analytics top-step kalıcı kimlikleri

`docs/feature-pack-1-plan.md:173` satır alanlarına `planId`, `planVersionId` ve `logicalStepId`
eklendi; `:175` drilldown’un adım filtresi varmış gibi davranmayacağını, plan/sürüm Failed run
listesine gideceğini açıkça söylüyor. History URL’si artık kalıcı kimliklerle kurulabilir.

### M-5 — Kapandı: `failureRatePercent` sözleşmesi

`docs/feature-pack-1-plan.md:173` oranı `100 × failedStepRuns / completedStepRuns` için 2 hane
half-up **decimal string** olarak tanımlıyor; payda sıfırsa null diyor. `passRatePercent` ile aynı
tip/rounding ailesi kullanılıyor; API/UI/test için yorum farkı kalmadı.

### L-1 — Kapandı: EX-05 generated tip önkoşulu

`docs/tasks/EX-05.md:5` “EX-03/04 API sözleşmesi ve lead tarafından üretilmiş güncel
OpenAPI/client tipleri” ek önkoşulunu içeriyor. Bu, UI’nin generated tipler hazır olmadan
başlayabileceği izlenimini kaldırıyor.

### L-2 — Kapandı: uç durumlar ve batch tutarlılığı

- `docs/feature-pack-1-plan.md:85` `batchNumber`/`batchNumberKey` çiftinin birlikte null veya
  birlikte dolu olmasını DB check + canonical servis doğrulamasına bağlıyor.
- `:76` `GET /devices` için varsayılan `state=active` yazıyor.
- `:125` archive/restore’da önce `expectedRevision` kontrolünü, hedef durum zaten varsa 200 ve
  değişmemiş revision’ı, aksi halde revision artışını; bilinmeyen cihaz UUID’sinin tek-kaynak
  işlemde 404, liste/analytics filtrelerinde boş sonuç üretmesini tanımlıyor.
- `:140` kopya adının trim sonrası 1–100 karakter olduğunu ve bulunamayan/yayımlanmamış kaynak
  sürümün 404 döneceğini yazıyor.
- `:190` CSV’de `isWithinTolerance` değerinin küçük harf `true`/`false` olduğunu belirtiyor.

**Sonuç:** Önceki L-2’nin altı açıklığı da kapatılmış.

### L-3 — Kısmen kapandı: format ve tarih düzeldi, kanıt sayıları kaldı

- `./node_modules/.bin/prettier --check` bu incelemede değişen 15 dokümanın tamamında geçti:
  `All matched files use Prettier code style!`, exit 0. `docs/tasks/README.md` artık uyarı
  vermiyor.
- `docs/README.md:6` son güncelleme tarihi **2026-11-06** oldu.
- `git diff --check 2356b8b^ 2356b8b` çıktı vermedi, exit 0.
- Ancak kanıt link sayıları hâlâ gerçek sayımla uyuşmuyor; ayrıntı L-5’te. Bu nedenle L-3’ün
  “format/tarih” kısmı kapandı, “kanıt doğruluğu” kısmı açık kaldı.

## Kalan bulgular

### M-6 — Orta: “Güncel iş” ve özet sayıları hâlâ eski

İki birincil okuma satırı yeni paketi göstermiyor:

- `docs/implementation-guide.md:66-67`: “mevcut sıradaki iş P8-06 ve açık inceleme kayıtlarıdır.”
  Oysa `docs/feature-pack-1-plan.md:4` uygulamanın başladığını, `docs/tasks/README.md:152`
  EX-01’in `In Review`, EX-02–EX-13’ün `Planned` olduğunu söylüyor. Yeni bir oturum bu satırı
  izlerse P8-06’dan başlayabilir; rehberin sonundaki özellik paketi bölümü bu çelişkiyi açıkça
  düzeltmiyor.
- `docs/roadmap.md:25`: “Toplam 62 görev.” Görev dizini `docs/tasks/README.md:148` ve plan §10
  toplam **85 kart** diyor (62 P + 10 UI + 13 EX).
- `docs/roadmap.md:173`: “[Test matrisi] T01–T28’i ... tanımlar.” `docs/testing.md:33-73` artık
  T01–T39’u tanımlıyor; EX kontrolleri T29–T39.

**Etki:** Davranış sözleşmesini değiştirmiyor; ancak EX-01’in adı “görev izlenebilirliği” olduğu
için ilk okuma/onboarding satırının yanlış olması gerçek bir izlenebilirlik açığıdır. Bu bulgu
backend davranışını bloke etmez.

**Öneri:** `implementation-guide.md:66` “mevcut sıradaki iş EX-01 ve EX kartlarıdır” şeklinde;
`roadmap.md:25` “ilk ürün paketi 62; UI 10 + EX 13 ile toplam 85” şeklinde; `roadmap.md:173`
T01–T39 olarak düzeltilmeli. Aynı dosyadaki eski UI sayısı (`roadmap.md:184`, “8 kart”) da 10
UI kartına göre düzeltilebilir; bu EX-01’in doğrudan kapsamı değildir.

### L-4 — Düşük: architecture sürüm tablosu bozuk

`docs/architecture.md:87-89` tablosunda başlık 3 sütun, ayırıcı 5 sütun, Node.js satırı 5
sütundur. Nedeni, inline code içindeki `^22.22.3 || ^24.15.0` ifadesindeki `|` karakterlerinin
kaçırılmamasıdır. Bağımsız tablo kontrolü:

```text
docs/architecture.md:87 header=4 sep=6 badRows=89:6
```

(Leading/trailing pipe’lar dahil sayımdır: 4 pipe = 3 sütun, 6 pipe = 5 sütun.)

**Etki:** Prettier bu satırı “geçerli” sayıyor; ancak Markdown tablosu render’da bozuluyor.
Davranış sözleşmesi değil, doküman kalitesi sorunu.

**Öneri:** Inline code içindeki `||` karakterini `\|\|` olarak kaçır veya “veya” yaz; ayırıcıyı
3 sütuna döndür.

### L-5 — Düşük: kanıt link sayıları yeniden üretilemiyor

- `docs/evidence/feature-pack-1/ex-01.md:23` “13 documents, 213 relative links, 0 broken”
  diyor. Bağımsız sayımım, değişen 13 sözleşme dokümanında (evidence/review hariç) **216**
  relative link ve 0 kırık buldu; 15 değişen dokümanda **217** link var. 213 sayısı bu dosya
  kümesiyle yeniden üretilemedi; hangi 13 dosyanın sayıldığı kayıtlı değil.
- `docs/tasks/EX-01.md:24` hâlâ “13 kart / 30 geçerli link” diyor. Güncel 13 EX kartında
  **32** relative link (15 farklı hedef) ve 0 kırık var; EX-01 kartına eklenen inceleme linki
  sayıyı artırdı.

**Etki:** EX-01’in kanıt kaydı, kendi komutunun çıktısını tam olarak yansıtmıyor. L-3’ün açık
kalan kısmıdır; davranış sözleşmesini etkilemez.

**Öneri:** Kanıtta kullanılan Node komutunun dosya listesini ve gerçek çıktısını yaz; EX-01 kartını
güncel sayıyla (32 link) eşitle. Sayım yöntemi dosya kümesiyle birlikte tekrarlanabilir olmalı.

### L-6 — Düşük: `RUN_NOT_TERMINAL` açıklaması yeni kullanımı kapsamıyor

`docs/api.md:108` kodu yalnız “Karşılaştırmada devam eden çalışma” olarak açıklıyor. Oysa
`docs/feature-pack-1-plan.md:127` report/export için de aynı mevcut kodu kullanacağını söylüyor.
Kod adı genel olduğu için teknik engel yok; ancak API sözleşmesi okuyucusu report/export’un hangi
kodla 409 döneceğini bu satırdan çıkaramıyor. `apps/api/README.md:279` de yalnız comparison
kullanımını anlatıyor.

**Öneri:** `docs/api.md:108` açıklamasını “terminal olmayan run; karşılaştırma/report/export”
şeklinde genişlet. Kod ve HTTP durumu değişmiyor.

## Doğrulanan gerçek kontroller

Bu bölümdeki sonuçlar inceleme sırasında gerçekten çalıştırılan salt-okunur komutlardan alınmıştır.
Uygulama/API/DB/browser testi değildir.

| Kontrol                       | Komut / yöntem                                                                                                                                                                                                                                                                                                                                                                     | Gerçek sonuç                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Çalışma ağacı ve branch       | `git status --short`; `git branch --show-current`; `git rev-parse HEAD`                                                                                                                                                                                                                                                                                                            | `git status` boş; branch `feat/analytics-reporting-devices`; HEAD `2356b8b557f6a74d020fa4cc405aca268d10e4c3`.                                                                 |
| Commit kapsamı                | `git show --stat --oneline 2356b8b`                                                                                                                                                                                                                                                                                                                                                | 15 dosya, +691/−349; tamamı `docs/` altında.                                                                                                                                  |
| Yalnız doküman kontrolü       | `git show --format= --name-only 2356b8b \| grep -v '^docs/'`                                                                                                                                                                                                                                                                                                                       | Çıktı yok; exit 1 (doküman dışı dosya yok).                                                                                                                                   |
| Whitespace                    | `git diff --check 2356b8b^ 2356b8b`                                                                                                                                                                                                                                                                                                                                                | Çıktı yok; exit 0.                                                                                                                                                            |
| Prettier (değişen 15 doküman) | `./node_modules/.bin/prettier --check docs/README.md docs/acceptance.md docs/api.md docs/architecture.md docs/data-model.md docs/evidence/feature-pack-1/ex-01-review.md docs/evidence/feature-pack-1/ex-01.md docs/feature-pack-1-plan.md docs/frontend.md docs/requirements.md docs/tasks/EX-01.md docs/tasks/EX-05.md docs/tasks/EX-13.md docs/tasks/README.md docs/testing.md` | `All matched files use Prettier code style!`; exit 0.                                                                                                                         |
| Link kontrolü (15 dosya)      | Node: değişen 15 dokümandaki relative Markdown linkleri                                                                                                                                                                                                                                                                                                                            | 217 relative link; 0 kırık.                                                                                                                                                   |
| Link kontrolü (13 EX kartı)   | Node: `docs/tasks/EX-*.md`                                                                                                                                                                                                                                                                                                                                                         | 13 kart; 32 relative link; 15 farklı hedef; 0 kırık.                                                                                                                          |
| Link kontrolü (13 sözleşme)   | Node: evidence/review hariç değişen 13 doküman                                                                                                                                                                                                                                                                                                                                     | 216 relative link; 0 kırık.                                                                                                                                                   |
| Tablo yapısı                  | Node: header/separator/row pipe sayısı; 15 değişen doküman                                                                                                                                                                                                                                                                                                                         | Yalnız `docs/architecture.md:87` bozuk: `header=4 sep=6 badRows=89:6`; diğer tablolar tutarlı.                                                                                |
| Kart sayısı/durum             | Node: `docs/tasks/README.md` + kart dosyaları                                                                                                                                                                                                                                                                                                                                      | 85 kart: 62 P + 10 UI + 13 EX; dizin/kart durumları arasında 0 uyuşmazlık; EX-01 `In Review`, EX-02–EX-13 `Planned`.                                                          |
| REQ/T/kabul izlenebilirliği   | Node: requirements, acceptance, testing tabloları                                                                                                                                                                                                                                                                                                                                  | 31 REQ satırı; REQ-28–31 “Ana görevler”/“Kontroller” dolu; T01–T39 mevcut; dört yeni acceptance kutusu var.                                                                   |
| Bağımlılık karşılaştırması    | Node: plan §10 EX satırları ↔ 13 kartın `Bağımlılıklar`/`Ek önkoşul` satırları                                                                                                                                                                                                                                                                                                     | 13/13 anlamca eşleşiyor; EX-05 generated tip ek önkoşulu, EX-13 kart bazlı inceleme kayıtları ekli.                                                                           |
| Salt-okunur kod kontrolü      | `run-start.ts`, Prisma schema, hata enum’u                                                                                                                                                                                                                                                                                                                                         | `apps/api/src/runs/run-start.ts:207` v1 marker’ı doğrulandı; `Device`/`PlanCopyRequest` henüz schema’da yok (EX-02 işi); `RUN_NOT_TERMINAL` şu an comparison’da kullanılıyor. |

**Uygulama testleri:** Çalıştırılmadı. EX-01 yalnız doküman/sözleşme görevidir; API/web/DB/browser
kontrolleri plan §11 uyarınca EX-02 ve sonraki kartlarda yürütülmelidir. Bu incelemede
çalıştırılmamış bir kontrol “geçti” sayılmamıştır.

## Kabul önerisi

**Koşullu kabul.**

- EX-01’in asıl sözleşme gate’i kapandı: H-1 ve M-1–M-5 kapandı; L-1/L-2 kapandı; L-3’ün
  format/tarih kısmı kapandı. Kritik veya yüksek açık bulgu yok.
- Kalan **M-6** orta önemdedir; davranış sözleşmesini değiştirmez, ancak yeni bir oturumu yanlış
  işe (P8-06) yönlendirebilir. Bu nedenle EX-01 kartı `Accepted` işaretlenmeden önce
  `implementation-guide.md:66` ve `roadmap.md:25/173` düzeltilmeli.
- **L-5** kanıt doğruluğu için aynı docs commit’inde kapatılmalı; **L-4** ve **L-6** de aynı
  commit’te düzeltilebilir.
- Bu düzeltmeler metin/kanıt düzeyindedir; yeni bir tam bağımsız inceleme gerekmez, sonuç bu
  kayda veya EX-01 evidence dosyasına işlenebilir. Backend sözleşmesi hazır olduğu için EX-02
  çalışması bu küçük düzeltmelerden bağımsız başlayabilir.

Bu belge ürün kabulü değildir. Kullanıcı görsel/ürün kabulü ayrıca kullanıcıya aittir ve verilmiş
sayılmaz. İnceleme sırasında hiçbir görev kartı durumu değiştirilmedi.
