# 0007 — Tek aktif run ve kısa transaction

Durum: Planlanan uygulama varsayılanı; henüz kurulup test edilmedi.

## Karar

Tek RUNNING kuralı partial UNIQUE index, start idempotency ve çalışma satırı üzerinde sıralanan kısa transaction'larla korunur.

## Gerekçe

Çift tıklama, eşzamanlı istek ve iptal/ölçüm yarışları veri doğruluğunu bozmamalıdır.

## Sonuç ve kabul etkisi

Simülasyon boyunca transaction açık tutulmaz. Çakışan ikinci iş kuyruklanmaz. Recovery tek API süreci varsayımına bağlıdır. Kısıtlar gerçek PG ile test edilir.

## Bağlantılar

- [data-model.md](../data-model.md)
- [measurement-rules.md](../measurement-rules.md)
- [api.md](../api.md)
- [P3-04](../tasks/P3-04.md)
- [P3-07](../tasks/P3-07.md)
- [P3-08](../tasks/P3-08.md)
- [P7-03](../tasks/P7-03.md)

