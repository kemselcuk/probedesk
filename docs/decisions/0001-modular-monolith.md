# 0001 — Modüler monolit ve aynı origin

Durum: Planlanan uygulama varsayılanı; henüz kurulup test edilmedi.

## Karar

Tek repository içinde NestJS modüler monolit, Angular SPA ve PostgreSQL; simülatör tek API sürecinin içinde.

## Gerekçe

Yerel kurulum ve tek aktif cihaz simülasyonu için az operasyon bileşeni yeterlidir. Modül sınırları backend/frontendi ayrı geliştirmeye izin verir.

## Sonuç ve kabul etkisi

Uzun iş yürütücüsü HTTP/SSE bağlantısına bağlanmaz. Tek süreç ölünce çalışma Interrupted olur; otomatik resume veya çok kopyalı recovery vaat edilmez.

## Bağlantılar

- [architecture.md](../architecture.md)
- [implementation-guide.md](../implementation-guide.md)
- [P0-03](../tasks/P0-03.md)
- [P1-01](../tasks/P1-01.md)
- [P8-01](../tasks/P8-01.md)

