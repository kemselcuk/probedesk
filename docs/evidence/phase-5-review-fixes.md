# Phase 5 inceleme düzeltmeleri

- Tarih: 2026-11-03
- Kaynak: `docs/evidence/phase-5-review.md` (3 Medium, 4 Low)

## Kapatılan Medium bulgular

1. **Aralık dışı sayfa:** `/runs?page=999` artık "No runs recorded yet" göstermiyor. `isPageOutOfRange` durumu, toplam/sayfa bilgisi ve "Go to first/last page" aksiyonları eklendi. `run-history-page.spec.ts` testi eklendi.
2. **`partial` çelişkisi:** API `partial` alanı yalnızca `recordedSampleCount < expectedSampleCount` olduğunda true. CANCELLED/INTERRUPTED/ERROR ama tüm örnekleri kaydedilmiş run'lar artık "Partial" değil; durum rozetleri stop'u anlatıyor. Backend testleri ve History bileşen testleri eklendi/güncellendi.
3. **İndeks:** `20261103210000_run_history_index` migration'ı `(startedAt DESC, id DESC)` indeksini ekledi; migration manifest güncellendi ve test/geliştirme DB'sine uygulandı.

## Doğrulama

- `npm run lint`, `typecheck`, `test` (API 118, web 322), `db:migrate:test`, `test:e2e` (183), `build`, `openapi:generate/check` — tümü yeşil.
- Migration boş DB ve mevcut şema üzerinde uygulandı; manifest testi 8 migration ile geçti.

## Açık Low riskler (kabul edildi)

- Gerçek 401'de History paneli yerine global login yönlendirmesi.
- Sayfa değişiminde odak `MAIN#main-content`'e düşüyor.
- Aynı adlı planlar filtrede kimlikle ayrıştırılmıyor.
- Geçersiz URL filtreleri sessizce yok sayılıyor.
Bu maddeler P5 kabulünü engellemez; P7-04 erişilebilirlik/UX turunda ele alınabilir.
