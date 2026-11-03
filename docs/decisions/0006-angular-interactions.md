# 0006 — Typed forms, RxJS ve grafik sınırı

Durum: Planlanan uygulama varsayılanı; henüz kurulup test edilmedi.

## Karar

Angular typed Reactive Forms/FormArray, CDK sıralama, RxJS facade ve Chart.js bileşen sınırı kullanılır.

## Gerekçe

Dinamik adım düzenleme, canlı durum ve etkileşimli ölçüm inceleme frontend'in temel ürün davranışlarıdır.

## Sonuç ve kabul etkisi

Gerçek FormArray kontrolleri taşınır; abonelik/Chart instance cleanup zorunludur. Grafik testleri gerçek tarayıcı içerir; sonuç mantığı client'a kopyalanmaz.

## Bağlantılar

- [frontend.md](../frontend.md)
- [testing.md](../testing.md)
- [P2-04](../tasks/P2-04.md)
- [P2-05](../tasks/P2-05.md)
- [P4-03](../tasks/P4-03.md)
- [P5-04](../tasks/P5-04.md)
- [P5-06](../tasks/P5-06.md)

