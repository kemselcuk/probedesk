# 0004 — Cookie oturumu ve rol yetkileri

Durum: Planlanan uygulama varsayılanı; henüz kurulup test edilmedi.

## Karar

PostgreSQL'de hash'i tutulan opaque session, HttpOnly cookie, session'a bağlı CSRF ve üç sabit rol kullanılır.

## Gerekçe

Native EventSource aynı-origin cookie ile çalışır; ilk kapsam için kullanıcı yönetimi veya token yenileme ürünü gerekmez.

## Sonuç ve kabul etkisi

API guard'ları zorunludur. Logout/expiry stream'i kapatır ama testi iptal etmez. Demo localhost cookie ayarları HTTPS ortamından açıkça ayrılır.

## Bağlantılar

- [architecture.md](../architecture.md)
- [requirements.md](../requirements.md)
- [api.md](../api.md)
- [P1-06](../tasks/P1-06.md)
- [P1-07](../tasks/P1-07.md)
- [P4-05](../tasks/P4-05.md)
- [P7-02](../tasks/P7-02.md)

