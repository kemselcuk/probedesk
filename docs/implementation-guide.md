# Uygulamaya başlangıç rehberi

Bu repository, onaylanan ürün sözleşmesini, görev paketini ve **çalışan uygulamayı** birlikte
içerir: NestJS API, Angular SPA, PostgreSQL/Prisma veri katmanı, deterministik simülatör, SSE canlı
akışı, run geçmişi/karşılaştırma, otomatik testler ve yerel Docker Compose teslimi. Belgeler
yalnızca niyeti değil, gerçekten çalıştırılmış kontrollerin kanıtlarını da kaydeder.

Durum (2026-11-04): P1–P7 görevleri bağımsız teknik incelemeden geçmiştir (`Accepted`). P8-01–P8-04
teslim görevleri `Accepted`; P8-05 demo videosu **kullanıcı kararıyla kapsam dışıdır**; P8-06 sürüm
adayı/nihai kabul paketi hazırlanmaktadır. **Nihai ürün kabulü kullanıcıya aittir ve henüz
verilmemiştir.** Bu belgenin varlığı ücretli hizmet kullanma talimatı değildir; ek altyapı maliyeti
hedefi €0'dır.

## Önce okunacaklar

1. [Belge dizini ve güncel durum](README.md).
2. [Proje README'si](../README.md): çalışan uygulama, kurulum, demo hesapları ve sınırlar.
3. [Ürün/roller](requirements.md), [ölçüm kuralları](measurement-rules.md),
   [simülasyon](simulation.md).
4. [Mimari](architecture.md), [veri modeli](data-model.md), [API](api.md),
   [frontend](frontend.md).
5. [Test sözleşmesi](testing.md), [demo](demo.md), [nihai kabul](acceptance.md).
6. [Yol haritası](roadmap.md), [görev dizini](tasks/README.md) ve ilgili görev kartları.
7. [Kanıt dizini](evidence/README.md): gerçek test, CI, ekran görüntüsü ve teslim kayıtları.

Uygulama İngilizce, README İngilizce, bu plan belgeleri Türkçedir. Kullanıcıyla Türkçe iletişim
kurulur. Öğretici dersler ve mülakat soru listeleri teslim kapsamına dahil değildir.

## Mevcut durum ve doğrulanan gerçekler

| Aşama | Durum | Not |
|---|---|---|
| P0 — ürün ve teknik sözleşmeler | In Review | Belgeler kullanımda; ürün kabulü değildir |
| P1 — iskelet, giriş, ilk CI | Accepted | Teknik inceleme tamamlandı |
| P2 — plan editörü ve sürümler | Accepted | v1/v2, publish ve immutable sürüm |
| P3 — simülasyon ve yürütme | Accepted | NORMAL/FORCED_FAILURE/RANDOM, snapshot, cancel/recovery |
| P4 — canlı durum ve SSE | Accepted | replay/cursor/reconnect ve oturum yaşam döngüsü |
| P5 — geçmiş ve grafikler | Accepted | History, Details, tolerans grafikleri |
| P6 — karşılaştırma | Accepted | Sürüm/kimlik/birim/örnekleme farkları |
| P7 — bütünleşik kalite | Accepted | P7-01–P7-06; gerçek E2E ve CI koşusu kayıtlı |
| P8 — yerel teslim | In Review | P8-01–P8-04 Accepted; P8-05 kapsam dışı; P8-06 kullanıcı kabulü bekliyor |

Doğrulanan başlıca çıktılar:

- Delivery profili boş bir veritabanında migration + seed + API + web zinciriyle açıldı; üç demo
  hesabı, bir plan, iki yayımlanmış sürüm ve dört run oluştu
  ([temiz kurulum](evidence/phase-8-clean-install.md)).
- `down`/`up` sonrasında planlar ve run geçmişi korundu; named volume kullanılıyor.
- Son yerel doğrulamada API birim `16` dosya / `118` test, web `36` dosya / `370` test, API
  entegrasyon `22` dosya / `197` test geçti; iki Playwright senaryosu gerçek stack üzerinde geçti
  ([verify kaydı](evidence/phase-8-docs.md), [E2E](evidence/phase-7-e2e.md)).
- Sürüm adayı `v0.1.0-rc.3` (`0d76dcf`) altı işin tamamını geçti
  ([run 41918727810](https://github.com/kemselcuk/probedesk/actions/runs/41918727810);
  önceki kayıtlar [CI kanıtı](evidence/phase-7-ci.md#gerçek-github-actions-koşusu-2026-11-04)).
- Delivery, aynı origin nginx proxy'si üzerinden deep link, SSE ve oturum yenilemeyi doğruladı
  ([Compose kanıtı](evidence/phase-8-compose.md)).

Açık işler:

- Kullanıcı nihai kapsam/ürün kabulü.
- P8-05 kısa demo videosu kullanıcı kararıyla kapsam dışıdır; yerine geçen bir zorunluluk yoktur.

## Başlangıç noktası

Yeni bir oturumda önce yukarıdaki durum tablosunu ve ilgili görev kartını oku; tamamlanmış işi
yeniden üretme. P1-01 tarihsel ilk uygulama göreviydi; mevcut sıradaki iş P8-06 ve açık
inceleme kayıtlarıdır. Yeni bir ürün davranışı gerekiyorsa roadmap sırası, görev bağımlılıkları ve
kabul ölçütleri izlenir; tek seferde bütün proje yeniden üretilmez.

Bir görev yalnızca kartındaki kabul ölçütleri, gerçek komut çıktıları ve ayrı inceleme kaydıyla
kapanır. "Çalışıyor" ifadesi, çalıştırılmış komutun gerçek çıktısına bağlanmalıdır. Çalışmayan veya
çalıştırılmamış kontrol gizlenmez.

## Her görev için çalışma sözleşmesi

1. Görev kartını, bağımlılık durumlarını ve bağlantılı birincil sözleşmeleri oku.
2. Mevcut repository'yi incele; kullanıcının değişikliklerini ve başka çalışanların dosyalarını
   koru.
3. İşi tek, incelenebilir davranışla sınırla; başka aşamanın ekranını/altyapısını kendiliğinden
   ekleme.
4. Görevin değişiklik alanını ve gerçek durumunu kartta güncelle.
5. İlgili davranışa anlamlı test yaz; DB/canvas/akış gerçekliğinin gerektiği kontrolleri mock ile
   ikame etme.
6. İlgili kontrolleri çalıştır; çalışmayanları dürüstçe kaydet. Gerçek çıktıyı commit/ortamla
   ilişkilendir.
7. İnceleme için diff, kabul maddeleri ve kanıt paketini hazırla. Kritik/yüksek bulguları kapat.
8. Ayrı inceleme kaydı olmadan görevi `Accepted` yapma. Aşama demosunu ayrıca doğrula.
9. Değişen sözleşme, görev durumu, indeks ve teknik kararları aynı değişiklikte güncelle.

Görev kendi başına incelenemeyecek kadar büyürse alt görevlere böl; bağımlılık ve kabul eşlemesini
koru. Teknik rutin kararlar mevcut sözleşme içinde çözülebilir; nihai kapsam ve ürün kabulü
kullanıcıdadır.

## Korunacak temel kurallar

- Tek profil, tek simülatör, tek API süreci ve tek aktif çalışma.
- Backend ölçüm doğrulama, durum ve sonuç kaynağıdır; Angular bileşenleri verdict hesaplamaz.
- Published planlar ve eski run kuralları immutable'dır.
- Aynı plan içindeki adımlar kalıcı `logicalStepId` ile eşleşir.
- İptal/kesinti kısmi veriyi korur; tekrar deneme yeni run'dır.
- SSE kopması testi durdurmaz; replay/dedup/gap uzlaştırması gerekir.
- Backend ve Angular görevleri aşamalar boyunca birlikte ilerler.
- Ek altyapı maliyeti €0 hedefi; onaysız ücretli hizmet açılmaz.
- Localhost demosu HTTP kullanabilir; üretim TLS/secure cookie kapsam dışıdır.
- Gerçek secret, cookie veya token commit edilmez; `.env` yalnızca yerel kalır.

## Sonraki uygulama oturumuna verilebilecek başlangıç metni

> ProbeDesk için `docs/implementation-guide.md` dosyasını ve gösterdiği sözleşmeleri oku. P1–P7
> teknik kabulden geçti; P8-01–P8-04 kabul edildi; P8-06 incelemede; P8-05 kullanıcı kararıyla kapsam
> dışı. Önce mevcut görev
> kartlarının durumunu ve kanıtlarını doğrula, tamamlanmış işi yeniden yapma. Yeni işi roadmap ve
> görev kartı sırasıyla, gerçek test/CI çıktısı ve ayrı inceleme kaydıyla ilerlet. Nihai ürün
> kabulünü kullanıcı verir. Ücretli hizmet kullanma; uygulama İngilizce, benimle iletişim Türkçe
> olsun.

## Teslim

Yerel teslim iki giriş noktası sunar:

- Geliştirme: Docker PostgreSQL + `npm run dev` (API `:3000`, Angular `:4200`).
- Tam demo: `docker compose --profile delivery up -d --build` → `http://127.0.0.1:8080`.

[acceptance.md](acceptance.md) tamamlanmadan ürün bitmiş sayılmaz. Nihai paket çalışan UI/API, hazır
veriler, doğrulanmış yerel kurulum, otomatik testler ve gerçek README kanıtlarını içerir. Kısa demo
videosu kullanıcı kararıyla kapsam dışıdır; README'de video bağlantısı yoktur. Kullanıcıya ait
yayın/nihai kabul kararı otomatik verilmez.
