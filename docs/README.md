# ProbeDesk belgeleri

Bu belge paketi, onaylanan ürün yaklaşımını, uygulama sözleşmelerini ve gerçek doğrulama
kanıtlarını repository içinde saklar. Uygulama artık yalnızca bir iskelet değildir: plan/sürüm
yönetimi, deterministik simülasyon, canlı SSE akışı, geçmiş/grafikler, run karşılaştırması ve
yerel Docker Compose teslimi çalışır durumdadır. Son güncelleme: **2026-11-04**.

## Okuma sırası

1. [Uygulamaya başlangıç rehberi](implementation-guide.md).
2. [Proje README'si](../README.md) — çalışan uygulama, kurulum ve demo hesapları.
3. [Gereksinimler ve yetkiler](requirements.md).
4. [Ölçüm kuralları](measurement-rules.md) ve [simülasyon](simulation.md).
5. [Mimari](architecture.md) ve [veri modeli](data-model.md).
6. [API ve SSE sözleşmesi](api.md).
7. [Frontend ekranları ve etkileşimleri](frontend.md).
8. [Yol haritası](roadmap.md) ve [görev kartları](tasks/README.md).
9. [Test ve teslim sözleşmesi](testing.md), [demo](demo.md), [nihai kabul](acceptance.md).
10. [Kanıt dizini](evidence/README.md) — gerçek test, CI, ekran görüntüsü ve teslim kayıtları.

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
| [testing.md](testing.md) | Test matrisi, doğrulanan komutlar, CI ve kanıt kuralları |
| [demo.md](demo.md) | Hazır veriler ve doğrulanan demo akışı |
| [acceptance.md](acceptance.md) | Nihai ürün kabul listesi |
| [decisions/](decisions/README.md) | Teknik karar kayıtları |
| [evidence/](evidence/README.md) | Gerçek doğrulama kanıtlarının dizini ve kayıt biçimi |

Bir sözleşme değiştiğinde bu tablodaki birincil belge önce güncellenir; ilgili görevler, testler ve
teknik kararlar birlikte uyarlanır. Çelişkiler sessizce yorumlanarak uygulamaya geçirilmez.

## Durum ve onay

- Ürün yaklaşımı kullanıcı tarafından onaylandı.
- P1–P6 görevleri bağımsız teknik incelemeden geçmiştir (`Accepted`, 2026-11-03/04).
- P7-01–P7-06 ile P8-01–P8-04 `In Review`; P8-05 ve P8-06 `Planned`. Görev kartındaki durum
  birincil kaynaktır.
- Yerel delivery temiz veritabanında migration + seed + API + web zinciriyle doğrulandı; kapat/aç
  sonrasında planlar ve run geçmişi korundu.
- Gerçek Chrome/Playwright ana demo ve karşılaştırma senaryoları geçti; API birim/entegrasyon ve
  Angular testleri gerçek PostgreSQL/TestBed üzerinde çalıştırıldı.
- Kayıtlı GitHub Actions koşusu `3d27f2f` commit'inde altı işin tamamını geçti
  ([CI kanıtı](evidence/phase-7-ci.md#gerçek-github-actions-koşusu-2026-11-04)). Nihai teslim
  commit'i için CI henüz çalıştırılmadı.
- Demo videosu yoktur; P8-05 tamamlanmadan README'ye video bağlantısı eklenmez.
- Nihai kapsam, aşama ve ürün kabulü kullanıcıya aittir; hiçbir aşama yalnızca kartı kapandı diye
  ürün kabulü sayılmaz.

README İngilizcedir; diğer plan belgeleri Türkçedir. Uygulama metinleri, kullanıcıya dönük API
mesajları ve örnek plan/adım adları İngilizcedir.
