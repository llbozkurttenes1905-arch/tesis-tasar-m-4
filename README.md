# Tesis Planlama Optimizasyonu — Güncelleme Notları

Bu sürüm, mevcut 3D tesis yerleşim aracına aşağıdaki yeni özellikleri ekler. Kurulum ve genel
kullanım için `facility-planner/facility-planner/README.md` dosyasındaki asıl belgeyi kullanın;
bu dosya sadece bu güncellemede eklenenleri özetler.

## Eklenen özellikler

- **Görsel (ikon tabanlı) eleman türü seçici**: "3D Yerleşim Editörü" panelinde artık açılır menü
  yerine ikonlu kartlar var (⚙️ Makine, 📦 Stok, 🏢 Ofis, 🔧 Teknik Ünite, 🚚 Forklift Park, 🏛️ Kolon).
  Her makine/eleman türünün 3D sahnedeki etiketinde de aynı ikon görünür.
- **Ölçeklendirme**: Sahnede bir elemana tıklayıp "Eleman Detayları" panelindeki kaydırıcıyla
  (0.4× – 3×) o elemanı büyütüp küçültebilirsiniz; tüm iç detaylar (raylar, kasa, etiket) yeniden
  çizilir ve verimlilik/alan metrikleri anında güncellenir.
- **Çoklu bağlantı farkındalı konum önerisi**: Bir makine/stok alanının birden fazla bağlantısı
  varsa (örn. hem malzeme akışı hem forklift rotası, ya da birden fazla makineye bağlantı), konum
  önerisi artık TÜM bağlantılara olan toplam mesafeyi en aza indirecek şekilde hesaplanır; ayrıca
  önerilen konum diğer makinelerle çakışmayacak şekilde otomatik olarak ayarlanır.
- **Taşıma aracı (forklift) farkındalığı**: Bağlantılardan biri forklift rotasıysa, öneri en yakın
  forklift/taşıma aracı park alanına erişimi koruyacak şekilde konumu hafifçe o yöne çeker.
- **Koyu renkli duvarlar + pencereler**: Fabrika duvarları artık koyu, katı (opak) panel görünümünde;
  "Yapısal Elemanlar" panelindeki yeni "Pencereler" anahtarıyla duvarlara parlayan cam pencere
  şeritleri ekleyip kaldırabilirsiniz.
- **Tasarımı Kaydet / Yükle (JSON)**: "Kaydet & Dışa Aktar" panelinden tüm serbest tasarımınızı
  (eleman konumları, ölçekleri, renkleri, bağlantıları, duvar/pencere ayarları, fabrika ölçüleri)
  bir `.json` dosyası olarak indirebilir, sonra aynı dosyayı "Yükle" ile birebir geri getirebilirsiniz.
- **Görsel olarak kaydet (PNG)**: Aynı panelden mevcut 3D görünümü tek tıkla PNG görsel olarak
  indirebilirsiniz (PDF rapor seçeneği de ayrıca korunmuştur).

## Değişmeyenler

Sürükle-bırak düzenleme, bağlantı kurma modu, alan/metrekare hesaplayıcı, simülasyon ayarları,
maliyet analizi, ölçüm aracı ve PDF rapor dışa aktarma gibi mevcut tüm özellikler aynen çalışmaya
devam eder.
