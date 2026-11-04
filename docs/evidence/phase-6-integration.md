# Phase 6 — karşılaştırma entegrasyonu

- Tarih: 2026-11-04
- Kapsam: P6-05 (birim/örnekleme farkları), P6-06 (sürüm tutarlılığı regresyonu)
- Ortam: gerçek PostgreSQL 18, gerçek API, gerçek Chrome (1280×1100), iki yayımlanmış sürüm
  (`Power Supply Validation` v1/v2), iki terminal run.

## P6-05 — birim ve örnekleme farkları

`apps/api/test/comparisons.e2e-spec.ts`:

- `compares versions by identity through rename, reorder, unit and sampling changes` — aynı
  `logicalStepId` üzerinden ad/sıra/birim/örnekleme değişimleri eşleşiyor; birim farkında
  `numericComparison.comparable=false`, `reason=UNIT_MISMATCH`, delta yok; her seri kendi
  `sampleIndex`/`elapsedMs` değerleriyle dönüyor; indeks hizalama/interpolasyon yok.
- `compares a partial CANCELLED run with explicit nulls, never zeros`.
- `accepts INTERRUPTED and ERROR runs with explicit missing data`.

Gerçek API doğrulaması (v1 vs v2):

```text
planId 8b04c2c1-…, versions 1 → 2
matchedSteps: 3
changed: Current Draw / maximum 0.550000 → 0.600000
added: 0, removed: 0
```

Gerçek Chrome `/compare?leftRunId=…&rightRunId=…`:

- `Version 1`, `Version 2`, iki `Passed` özeti
- 3 ortak adım, 0 eklenen/kaldırılan, 1 değişen kural
- 3 grafik canvas’ı; adım kartlarında eski/yeni maksimum görünür
- konsol istisnası yok

Kanıt: [phase-6-compare.png](phase-6-compare.png).

## P6-06 — sürüm tutarlılığı

`keeps the old snapshot and rules after a newer version is published` e2e testi:

- v2 yayımlandıktan sonra v1 run snapshot’ının adı/sınırları/sonucu değişmiyor.
- Karşılaştırma eski run’ı kendi kayıtlı sınırlarıyla değerlendiriyor; güncel plandan yeniden
  hesaplama yapılmıyor.
- Gerçek API’de v1 run hâlâ `0.550000`, v2 run `0.600000` maksimumunu taşıyor; iki run da
  `COMPLETED/PASSED`.

## Komutlar ve sonuçlar

```text
npm run test:e2e --workspace apps/api -- test/comparisons.e2e-spec.ts
→ Test Files 1 passed (1), Tests 10 passed (10)

npm run test:e2e --workspace apps/api
→ 19 dosya / 183 test (P6-01 sonrası)

node scripts/phase-6-compare-check.mjs
→ compare: versions 1/2, Passed, old/new max, 3 shared, 1 changed rule, 3 canvas
→ history selection → /compare?leftRunId=…&rightRunId=…
→ exceptions: []
```

## Sınırlar

- Birim/örnekleme farkı gerçek tarayıcıda ayrı bir fixture ile çizilmedi; backend e2e ve
  dual-chart bileşen testleri kapsıyor. P7-01 Playwright kapsamında genişletilecek.
- Grafik seri aç/kapat düğmeleri gerçek tarayıcıda ayrıca tıklanmadı; bileşen testleri var.
- Bu demo ürün kabulü değildir; bağımsız Faz 6 incelemesi gerekir.
