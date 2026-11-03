# ProbeDesk belgeleri

Bu belge paketi, kullanıcı tarafından seçilen ürün yaklaşımını ve ayrıntılı uygulama planını repository içinde saklar. Phase 1 uygulaması (iskelet, kimlik doğrulama, ortak API davranışları, CI) başlamıştır; ürün akışları henüz tamamlanmamıştır. Hazırlanma tarihi: **2026-11-03**.

## Okuma sırası

1. [Uygulamaya başlangıç rehberi](implementation-guide.md).
2. [Gereksinimler ve yetkiler](requirements.md).
3. [Ölçüm kuralları](measurement-rules.md) ve [simülasyon](simulation.md).
4. [Mimari](architecture.md) ve [veri modeli](data-model.md).
5. [API ve SSE sözleşmesi](api.md).
6. [Frontend ekranları ve etkileşimleri](frontend.md).
7. [Yol haritası](roadmap.md) ve [görev kartları](tasks/README.md).
8. [Test ve teslim sözleşmesi](testing.md), [demo](demo.md), [nihai kabul](acceptance.md).

## Dosya sorumlulukları

| Belge | Birincil kaynak olduğu konu |
|---|---|
| [requirements.md](requirements.md) | Onaylanan ürün kapsamı, roller, gereksinim kimlikleri |
| [measurement-rules.md](measurement-rules.md) | Sayılar, tolerans, sonuç ve durum geçişleri |
| [simulation.md](simulation.md) | Senaryolar, seed, üretim kuralları, örnek profil |
| [architecture.md](architecture.md) | Bileşen sınırları, teknoloji, güvenlik, maliyet |
| [data-model.md](data-model.md) | Tablolar, ilişkiler, snapshot, kısıtlar ve transaction sınırları |
| [api.md](api.md) | HTTP uçları, izinler, hatalar, idempotency ve SSE |
| [frontend.md](frontend.md) | Ekranlar, formlar, RxJS durumu, grafik etkileşimleri |
| [roadmap.md](roadmap.md) | Aşamalar, sıra ve aşama çıkış kontrolleri |
| [tasks/](tasks/README.md) | Tek görevin kapsamı, bağımlılığı ve kabulü |
| [testing.md](testing.md) | Test matrisi, planlanan komutlar, CI ve kanıt kuralları |
| [demo.md](demo.md) | Hazır veriler ve doğrulanacak demo/video akışı |
| [acceptance.md](acceptance.md) | Nihai ürün kabul listesi |
| [decisions/](decisions/README.md) | Teknik karar kayıtları |
| [evidence/](evidence/README.md) | Henüz üretilmemiş gerçek doğrulama kanıtlarının düzeni |

Bir sözleşme değiştiğinde bu tablodaki birincil belge önce güncellenir; ilgili görevler, testler ve teknik kararlar birlikte uyarlanır. Çelişkiler sessizce yorumlanarak uygulamaya geçirilmez.

## Durum ve onay

- Ürün yaklaşımı kullanıcı tarafından onaylandı.
- Teknik varsayılanlar ayrıntılı plandan aktarılmıştır; kurulumla doğrulanmış değildir.
- P0 belgeleri incelemeye hazırdır; görev kartlarında `In Review` durumundadır. P1 görevlerinin `Accepted` olması ürün kabulü anlamına gelmez.
- P1-01–P1-08 teknik kabulden geçmiştir (`Accepted`, 2026-11-03). P2-01–P2-08 teknik kabulden geçmiştir (`Accepted`, 2026-11-03); P3-01–P3-10 teknik kabulden geçmiştir (`Accepted`, 2026-11-03); P4 ve P5 görevleri teknik kabulden geçmiştir (`Accepted`, 2026-11-03); P6 kullanıcı isteğiyle duraklatılmıştır; P7–P8 `Planned` durumundadır.
- Phase 1 testleri ve GitHub Actions CI koşuları gerçek çıktılarla kaydedilmiştir; ürün demosu ve video henüz yoktur.
- Nihai kapsam, aşama ve ürün kabulü kullanıcıya aittir.

README İngilizcedir; diğer plan belgeleri Türkçedir. Uygulama metinleri, kullanıcıya dönük API mesajları ve örnek plan/adım adları İngilizce olacaktır.
