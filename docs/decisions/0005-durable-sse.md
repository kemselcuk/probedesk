# 0005 — Kalıcı olaylar ve SSE replay

Durum: Planlanan uygulama varsayılanı; henüz kurulup test edilmedi.

## Karar

Ölçüm/durum/RunEvent aynı transaction'da commit edilir. Snapshot cursor ile tutarlıdır; SSE kalıcı olayları sequence sonrası takip eder.

## Gerekçe

Kopma veya snapshot ile stream açılışı arasında ölçüm kaybı olmamalıdır.

## Sonuç ve kabul etkisi

Replay ve duplicate/gap yönetimi gerekir. DB tail yaklaşımı düşük ölçek hedefiyle başlar; heartbeat domain sequence tüketmez. Kaynak cleanup yürütücüyü durdurmaz.

## Bağlantılar

- [api.md](../api.md)
- [data-model.md](../data-model.md)
- [frontend.md](../frontend.md)
- [P3-05](../tasks/P3-05.md)
- [P4-01](../tasks/P4-01.md)
- [P4-03](../tasks/P4-03.md)
- [P4-06](../tasks/P4-06.md)

