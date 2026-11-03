# Phase 3 simülatör kanıtı (P3-01, P3-02)

- Tarih: 2026-11-03
- Kapsam: P3-01 deterministik normal simülatör ve P3-02 forced failure / random senaryoları.
- Ortam: Node.js `v22.23.2`, npm `10.9.8` (kurulum yapılmadı; repository `npm@11.6.2` pinler), Darwin arm64.
- Uygulama commit'i: Bu çalışma ortak checkout'ta yapıldı; commit/push lead tarafından oluşturulacak. Bu belge commit SHA'sı iddia etmez.
- Kapsam dışı: HTTP uçları, veritabanı kayıtları, zamanlayıcı/yürütücü ve OpenAPI sözleşmesi. Bunlar P3-03/P3-04 ve sonraki görevlerdedir.

## Değişen dosyalar

- `apps/api/src/simulator/decimal.ts`: kanonik ondalık ayrıştırma ve tam altı ondalıklı biçimlendirme.
- `apps/api/src/simulator/mulberry32.ts`: `mulberry32-v1` uint32 üreticisi.
- `apps/api/src/simulator/simulator.ts`: saf `simulate()` giriş noktası, senaryolar, doğrulama ve tipli hatalar.
- `apps/api/src/simulator/index.ts`: modül dışa aktarımları.
- `apps/api/src/simulator/simulator.spec.ts`: 31 unit test ve sabit golden fixture'lar.
- `docs/decisions/0009-simulator-prng.md`: PRNG, çağrı sırası, eşleme ve yuvarlama kararı.
- `docs/tasks/P3-01.md`, `docs/tasks/P3-02.md`: `In Review` kaydı ve gerçek komut sonuçları.

Modül HTTP, veritabanı, dosya sistemi, saat ve `Math.random()` kullanmaz. Zamanlama ve kalıcı kayıt yürütücünün sorumluluğundadır.

## Algoritma ve determinizm

Tek `mulberry32-v1` akışı `seed` ile başlatılır; adımlar ve örnekler sırayla tüketilir. Toleranslar 10^6 ölçekli `bigint` mikro birimlere ayrıştırılır; değer üretiminde kayan nokta aritmetiği yoktur.

| Senaryo | PRNG tüketimi | Üretim |
|---|---|---|
| NORMAL | örnek başına 1 uint32 | `minimum + floor(r * (span + 1) / 2^32)`; inclusive |
| FORCED_FAILURE | örnek başına 1 uint32 | hedef indekste `maximum + distance`; diğerleri NORMAL ile aynı |
| RANDOM | örnek başına 3 uint32 (karar, yön, değer) | p=0 tamamen içeride; p=1 tamamen dışarıda |

- `distance = max(ceil((maximum - minimum) / 2), 0.000001)` mikro birim; yarım mikro birim yukarı yuvarlanır.
- Eşit `minimum`/`maximum` normal üretimde sabit değer döndürür.
- `seed` 0 ve 4.294.967.295 desteklenir.
- `errorProbability` 0–1 arasında, en fazla altı ondalıklı ondalık metindir; karşılaştırma `decision * 10^6 < pMicro * 2^32` ile tam tamsayı aritmetiğinde yapılır.

Ayrıntılı sözleşme: [0009-simulator-prng.md](../decisions/0009-simulator-prng.md).

## Golden fixture'lar

Değerler, modülden bağımsız yazılmış referans uygulamasıyla üretildi ve testlerde sabit beklenti olarak tutuldu. Testler çalışma zamanında üretilen değerlerle karşılaştırma yaparak kendi kendini doğrulamaz.

### NORMAL — negatif aralık

Girdi: seed `12345`, `minimum=-1.250000`, `maximum=1.250000`, `sampleCount=8`, `intervalMs=100`.

```text
1.199321, -0.483120, -0.039486, 0.794836, 0.023571, -0.381321, -1.065607, 0.665991
```

### NORMAL — demo üç adım

Girdi: seed `20261103`; Output Voltage `4.75–5.25`, Current Draw `0.45–0.55`, Case Temperature `20–60`, her biri 30 örnek / 200 ms. Current Draw için tam 30 değer `simulator.spec.ts` içinde sabittir; temsili değerler:

| İndeks | Değer |
|---|---|
| 0 | `0.452902` |
| 14 | `0.541052` |
| 29 | `0.500105` |

Bütün değerler kendi inclusive aralığındadır.

### FORCED_FAILURE — demo Current Draw

Girdi: aynı üç adım, seed `20261103`, `failureStepId=Current Draw`.

| Özellik | Beklenen | Sonuç |
|---|---|---|
| Hata indeksi | `floor((30-1)/2) = 14` | 14 |
| Hata değeri | `0.550000 + 0.050000` | `0.600000` |
| Diğer Current Draw örnekleri | NORMAL dizisiyle aynı ve içeride | Doğrulandı |
| Output Voltage / Case Temperature | tamamen içeride | Doğrulandı |

Diğer sabit kontroller: tek örnekli `0..1` adımında tek örnek `1.500000`; eşit `-5.250000` sınırında hata indeksi 1 ve değer `-5.249999`; tek mikro birimlik tek farkta (`0..0.000003`) hata değeri `0.000005`; negatif üst sınır `-4.75` için hata değeri `-4.500000`.

### RANDOM — p=0, p=1 ve p=0.5

| Girdi | Beklenen | Sonuç |
|---|---|---|
| seed 20261103, Current Draw, p=0 | 30 örneğin tamamı `[0.45, 0.55]` içinde; tam dizi sabit | Doğrulandı |
| seed 20261103, Current Draw, p=1 | 30 örneğin tamamı aralık dışında; tam dizi sabit | Doğrulandı |
| seed 7, `0..10`, p=0.5, 8 örnek | `-4.884539, 4.055217, -2.766629, 1.559483, 1.971372, -2.673698, 11.237668, 1.436574`; hata indeksleri `[0,2,5,6]` | Doğrulandı |
| seed 9, eşit `0`, p=1, 4 örnek | dört değer de `0.000001` | Doğrulandı |

Hiçbir test rastgele örneklerin belirli bir yüzdesinin hatalı olmasına dayanmaz; kontrollü seed ve sabit beklenen diziler kullanılır.

## Çalıştırılan kontroller (gerçek çıktılar)

Komutlar son kod hali üzerinde çalıştırıldı.

```text
$ npm run lint --workspace apps/api
Found 0 warnings and 0 errors.
Finished in 342ms on 93 files with 107 rules using 8 threads.

$ npm run typecheck --workspace apps/api
tsc --noEmit -p tsconfig.json
(çıkış kodu 0; hata yok)

$ npm run test --workspace apps/api -- src/simulator/simulator.spec.ts
Test Files  1 passed (1)
Tests       31 passed (31)
Duration    182ms

$ npm run test --workspace apps/api
Test Files  11 passed (11)
Tests       82 passed (82)
Duration    493ms

$ npm run build --workspace apps/api
nest build
(çıkış kodu 0; hata yok)
```

Not: Tam paketteki 82 testin 31'i bu görevin simülatör testleridir; kalan testler paralel çalışan diğer işlerin mevcut kapsamıdır. `npm run test:e2e` bu görevde çalıştırılmadı: modül saf birim davranışıdır, HTTP/DB entegrasyonu P3-03/P3-04 kapsamındadır.

## Test kapsamı

`apps/api/src/simulator/simulator.spec.ts` (31 test):

- NORMAL: sabit golden dizi, 3 adımlı paylaşımlı akış, inclusive min/max, eşit sınır, negatif aralık, seed 0 ve uint32 üst sınırı, adım sırası ve sıfır tabanlı indeksler.
- FORCED_FAILURE: demo `0.600000`, tek hata, `floor((sampleCount-1)/2)` formülü (1/4/5/30 örnek), tek örnekli adım, eşit sınır, tek mikro birim yuvarlama, negatif üst sınır, üst sınır taşmasının kırpılmaması.
- RANDOM: p=0/p=1 uçları, p=0.5 karar-yön-değer sırası, eşit sınırda hata yönü ve tam dizi.
- Girdi doğrulama: senaryo, seed, adım listesi, adım alanları, yinelenen kimlik, senaryoya uymayan alanlar, eksik/geçersiz `failureStepId`, geçersiz olasılık biçimleri.
- Saflık: aynı girdi aynı çıktı, farklı seed farklı dizi, `Date.now`/`Math.random` çağrılmaması, zamanlayıcı kurulmaması, immutable adım tanımlarının değiştirilmemesi.

## Açık noktalar ve riskler

1. `simulatorVersion` dizesi `mulberry32-v1` olarak seçildi. Sözleşme yalnızca PRNG başlangıç tercihini adlandırıyordu; sürüm dizesinin biçimi başka bir tüketici tarafından beklenmiyorsa bu seçim korunmalıdır. PRNG, çağrı sırası, eşleme veya yuvarlama değişirse sürüm artırılmalıdır.
2. Simülatör plan düzeyindeki toplam örnek/süre ve adım sayısı limitlerini yeniden uygulamaz; bunlar plan yayımlama katmanında doğrulanır. Simülatör kendi yapısal sınırlarını (`sampleCount`, `intervalMs`, ondalık aralığı) uygular.
3. Bilinmeyen üst düzey alanların reddi API DTO whitelist'inin sorumluluğundadır. Simülatör, senaryoya uymayan `failureStepId`/`errorProbability` alanlarını reddeder.
4. Forced/random hata değerleri ±1.000.000.000 girdi aralığının biraz dışına çıkabilir; bu değerler `NUMERIC(18,6)` içinde kalır ve kırpılmaz. Gerçek ölçüm kaydı ve tolerans değerlendirmesi P3-03/P3-05 kapsamındadır.
5. `docs/tasks/README.md`, `docs/roadmap.md` ve `docs/decisions/README.md` bu worker'ın sahipliğinde değildir; P3-01/P3-02 `In Review` durumunun dizin/yol haritası kaydı ve 0009 kararının indeks bağlantısı lead tarafından aynı commit'te güncellenmelidir.
6. Bağımsız teknik inceleme henüz yapılmadı; görev kartları bu nedenle `In Review` durumundadır, `Accepted` değildir.
7. 32 bit PRNG nedeniyle `span + 1 > 2^32` olan çok geniş aralıklarda her mikro değer erişilebilir değildir; üretilen değerler yine aralık içinde ve deterministiktir. Ölçüm planlarındaki tipik tolerans aralıkları bu sınıra ulaşmaz.
8. Yürütücü, Prisma `Decimal` sınırlarını simülatöre vermeden önce kanonik altı ondalıklı metne çevirmelidir; modül yalnızca ondalık metin kabul eder. Çıktıdaki `simulatorVersion` çalıştırma kaydına yazılmalıdır.
