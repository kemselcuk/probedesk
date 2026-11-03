# 0009 — Simülatör PRNG ve değer eşlemesi

Durum: P3-01/P3-02 kapsamında uygulandı ve test edildi (2026-11-03); bağımsız inceleme bekliyor.

## Karar

Simülatör, tek bir `mulberry32-v1` akışını `seed` ile başlatır ve adım sırasına göre tüketir. Sürüm dizesi `mulberry32-v1` hem PRNG'yi hem de aşağıdaki çağrı sırası, normalizasyon, yuvarlama ve değer eşlemesini kilitler. `simulatorVersion` çalıştırma kaydında saklanır; geçmiş ölçümler yeniden üretilip üzerine yazılmaz.

## PRNG

Durum 32 bit işaretsiz tamsayıdır. Her çağrıda önce sabit artış uygulanır, sonra kanonik mulberry32 karıştırıcısı çalışır:

```text
state = seed >>> 0

nextUint32():
  state = (state + 0x6d2b79f5) >>> 0
  t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return (t ^ (t >>> 14)) >>> 0
```

`Math.imul` ve bit işlemleri tam 32 bit aritmetiktir; `Math.random()` veya saat kullanılmaz. Aynı seed ve aynı adım tanımları aynı akışı üretir.

## Normalizasyon ve değer üretimi

Tolerans sınırları ve üretilen değerler 10^6 ölçekli tamsayı (mikro birim) olarak tutulur. `minimum`/`maximum` en fazla altı ondalıklı kanonik ondalık metinden tam olarak ayrıştırılır. Kayan noktalı değer aritmetiği kullanılmaz.

`span = maximumMicro - minimumMicro` olmak üzere, bir `r` uint32 değeri için:

```text
offset = floor(r * (span + 1) / 2^32)
normalValue = minimumMicro + offset
```

Bu eşleme `[minimum, maximum]` aralığını **inclusive** kapsar: `offset` her zaman `0..span` aralığındadır ve üst sınıra yuvarlama taşması olmaz. `minimum == maximum` ise `offset = 0` olur ve sabit değer döner; PRNG yine bir kez tüketilir.

### NORMAL

Her örnek için tam olarak bir `nextUint32()` çağrısı yapılır ve yukarıdaki normal eşleme kullanılır.

### FORCED_FAILURE

Her örnek için normalde bir `nextUint32()` çağrısı yapılır. Hedef adımda `floor((sampleCount - 1) / 2)` indeksindeki örnek için çağrı yine tüketilir, ancak üretilen değer atılıp şu değer yazılır:

```text
distance = max(ceil((maximum - minimum) / 2), 0.000001)   // mikro birim
forcedValue = maximumMicro + distance
```

Yön her zaman üst sınırın üzeridir. `distance` tam sayı mikro birime yuvarlanırken yarım mikro birim yukarı yuvarlanır; böylece değer hem kesinlikle tolerans dışında hem de altı ondalıkla tam temsil edilebilir. Hedef olmayan örnekler ve diğer adımlar NORMAL akışıyla birebir aynıdır; tek fark hedef indekstir. Demo `Current Draw` (0.45–0.55, 30 örnek, seed 20261103) için indeks 14 değeri tam `0.600000` olur.

### RANDOM

Her örnek için sabit sırayla **üç** çağrı yapılır. Karar, yön ve değer çağrıları sonuçtan bağımsız olarak her zaman tüketilir; böylece kaç hata oluştuğu sonraki örneklerin akışını kaydırmaz.

```text
decision  = nextUint32()
direction = nextUint32()
value     = nextUint32()

fail = decision * 1_000_000 < errorProbabilityMicro * 2^32
```

`errorProbability` 0–1 aralığında, en fazla altı ondalıklı ondalık metindir. Bu karşılaştırma p=0 için hiçbir zaman, p=1 için her zaman doğrudur. Hata varsa:

- `direction < 2^31` ise alt sınırın altına, değilse üst sınırın üstüne çıkılır.
- Aşma mesafesi `1 + floor(value * distance / 2^32)` mikro birimdir; yani `[0.000001, distance]` aralığındadır.

Hata yoksa `value` çağrısı NORMAL eşlemesiyle `[minimum, maximum]` içine yerleştirilir.

## Biçim ve yuvarlama

- Çıktı her zaman tam altı ondalıklı kanonik metindir (`"0.600000"`, `"-4.500000"`); bilimsel gösterim ve `-0.000000` üretilmez.
- Normal değerler `[minimum, maximum]` dışına çıkmaz.
- FORCED_FAILURE ve RANDOM hata değerleri kabul edilen girdi aralığının (±1.000.000.000) biraz dışına çıkabilir; bu değerler `NUMERIC(18,6)` aralığına sığar ve kırpılmaz.

## Girdi doğrulaması

- `seed`: 0–4.294.967.295 tamsayı.
- `sampleCount`: 1–1.000 tamsayı; `intervalMs`: 100–5.000 tamsayı.
- `minimum`/`maximum`: kanonik ondalık, en fazla altı ondalık, ±1.000.000.000; `minimum <= maximum`.
- `steps`: boş olmayan, sıralı dizi; `logicalStepId` benzersiz; ad trim sonrası 1–100, birim trim sonrası 1–16 karakter.
- NORMAL yalnız `seed` + `steps`; FORCED_FAILURE ayrıca mevcut bir `failureStepId`; RANDOM ayrıca geçerli `errorProbability` kabul eder. Senaryoya uymayan alanlar reddedilir.
- Hatalar `SimulatorInputError` tipinde, İngilizce mesajlı ve kararlı bir `code`/`path` taşır.

## Golden fixture'lar

Tam diziler `src/simulator/simulator.spec.ts` içinde sabit beklenen değerler olarak tutulur. Temsili değerler:

| Senaryo | Girdi | Beklenen |
|---|---|---|
| NORMAL | seed 12345, `-1.250000..1.250000`, 8 örnek | `1.199321, -0.483120, -0.039486, 0.794836, 0.023571, -0.381321, -1.065607, 0.665991` |
| NORMAL | 3 adım, seed 20261103, Current Draw | indeks 0 `0.452902`, indeks 14 `0.541052`, indeks 29 `0.500105` |
| FORCED_FAILURE | 3 adım, seed 20261103, Current Draw hedefi | indeks 14 `0.600000`; diğer indeksler NORMAL ile aynı |
| RANDOM | seed 7, `0..10`, p=0.5, 8 örnek | `-4.884539, 4.055217, -2.766629, 1.559483, 1.971372, -2.673698, 11.237668, 1.436574`; hata indeksleri `[0,2,5,6]` |

## Sürümleme

Aşağıdakilerden biri değişirse `SIMULATOR_VERSION` artırılmalıdır: PRNG gövdesi, durum normalizasyonu, çağrı sayısı/sırası, `offset` eşlemesi, hata mesafesi veya yuvarlama kuralı, hata yönü/olasılık karşılaştırması. Sürüm artışı yeni çalıştırmaları etkiler; tamamlanmış çalıştırmaların ölçümleri değiştirilmez.

## Bağlantılar

- [simulation.md](../simulation.md)
- [measurement-rules.md](../measurement-rules.md)
- [0003 — Kesin sayılar ve backend değerlendirme](0003-decimal-evaluation.md)
- [P3-01](../tasks/P3-01.md)
- [P3-02](../tasks/P3-02.md)
- [Phase 3 simülatör kanıtı](../evidence/phase-3-simulator.md)
