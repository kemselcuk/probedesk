# 0003 — Kesin sayılar ve backend değerlendirme

Durum: Planlanan uygulama varsayılanı; henüz kurulup test edilmedi.

## Karar

Ondalık API metinleri, NUMERIC(18,6) kayıt ve kesin karşılaştırma kullanılır. Backend isWithinTolerance ve outcome kaynağıdır.

## Gerekçe

Inclusive sınırlar ve sınırın hemen dışındaki örnekler kayan nokta/görüntü yuvarlaması nedeniyle farklı sonuç vermemelidir.

## Sonuç ve kabul etkisi

Altı basamak üstü giriş reddedilir; UI grafiği sayıya dönüştürebilir ama sonucu değiştiremez. Status ve outcome ayrıdır; kısmi run outcome null'dır.

## Bağlantılar

- [measurement-rules.md](../measurement-rules.md)
- [data-model.md](../data-model.md)
- [frontend.md](../frontend.md)
- [P0-02](../tasks/P0-02.md)
- [P3-05](../tasks/P3-05.md)
- [P5-04](../tasks/P5-04.md)

