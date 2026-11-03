# 0002 — Immutable sürüm ve run snapshot

Durum: Planlanan uygulama varsayılanı; henüz kurulup test edilmedi.

## Karar

Draft düzenlenir; Publish immutable revision oluşturur. Başlatmada kurallar RunStep'e kopyalanır. Sürümler arasında logicalStepId korunur.

## Gerekçe

Geçmiş sonuçların güncel taslaktan etkilenmemesi ve rename/reorder sonrası doğru karşılaştırma gerekir.

## Sonuç ve kabul etkisi

Run snapshot okuma kaynağıdır; eski sonuç yeniden hesaplanmaz. Silip aynı adla eklemek yeni kimliktir. Birimi değişen adımlar ortak eksene zorlanmaz.

## Bağlantılar

- [data-model.md](../data-model.md)
- [requirements.md](../requirements.md)
- [api.md](../api.md)
- [P2-01](../tasks/P2-01.md)
- [P2-06](../tasks/P2-06.md)
- [P3-03](../tasks/P3-03.md)
- [P6-06](../tasks/P6-06.md)

