# TeamBrief

React, TypeScript, Vite ve normal CSS ile geliştirilmiş, tarayıcıda çalışan pub ekip uygulaması.

## Çalıştırma

```sh
npm install
npm run dev
```

Terminalde gösterilen adresi açın. Kayıtları korumak için önceki kayıtları oluşturduğunuz tarayıcı ve adres/portu kullanın. localStorage cihaz, tarayıcı ve adres bazındadır; tarayıcı verileri silinirse kayıtlar kaybolur.

## Demo profilleri

Üst alandan **Müslüm — Çalışan** veya **Alex — Yönetici** seçilir. Bu yalnızca arayüz demosudur, gerçek yetkilendirme değildir. Profil değiştirmek kayıtları silmez. Yenilemede çalışan profili açılır; yönetici profili yeniden seçilebilir.

Bildirimler demo çalışanı Müslüm adına oluşturulur. Yönetim menüsü yalnızca Alex görünümünde bulunur. Aktif Kararlar her iki profilde de görünür.

## Akışı deneme

1. Müslüm profilinde **Olay Bildir** ekranından geçmiş tarihli bir olay oluşturun. Bildirim **İnceleme bekliyor** durumuyla Bildirimlerim ekranına gelir.
2. Üst alandan **Alex — Yönetici** seçin. **Yönetim → Bekleyenler** listesinden bildirimi açıp asıl metni okuyun.
3. **Servis yasağı oluştur** kararını seçin. Karar açıklaması, son önem derecesi, servis talimatı ve gelecekte bir gözden geçirme tarihi/saati girin. **Kararı kaydet** düğmesine basın.
4. Bildirim bekleyen listesinden çıkar; Ana Sayfa’daki bekleyen sayısı azalır, aktif yasak sayısı artar. **Yönetim → Karar geçmişi** içinde kararın açıklaması, Alex’in adı ve karar zamanı görünür. Asıl bildirim değişmez.
5. **Aktif Kararlar** ekranından yasağı açın. Servis talimatı, son önem derecesi ve gözden geçirme zamanı görünür. Müslüm profiline geçince aynı aktif karar görülebilir; karar verme ve kaldırma formu görünmez. **Bildirimlerim** içinde inceleme sonucu da görünür.
6. Alex’e dönün. **Aktif Kararlar** içinden yasağı açın, kaldırma gerekçesini yazıp **Gerekçeyle yasağı kaldır** düğmesine basın. Yasak aktif listeden çıkar. Yönetim’deki karar geçmişinde ve Bildirimlerim ayrıntılarında kaldırma gerekçesi, yönetici ve zaman bilgisi korunur.
7. İkinci bildirimde **Devam eden yasak gerekmiyor** kararını deneyin. Bu karar da açıklama gerektirir; aktif yasak oluşturmaz.
8. Sayfayı yenileyin ve profiller arasında geçin; bildirimler ve kararlar korunmalıdır.

Boş veya yalnızca boşluk içeren açıklama/talimat/kaldırma gerekçesi reddedilir. Gözden geçirme zamanı gelecekte olmalıdır. Kısa süre sonrasına bir zaman seçip bekleyerek **Gözden geçirme zamanı geldi** uyarısını deneyebilirsiniz; ekran en geç 15 saniye içinde güncellenir. Yasak otomatik kaldırılmaz. **Düşük önem derecesi servis izni anlamına gelmez.**

Telefonda alt gezinme, bilgisayarda sol menü kullanılır.

## Veri geçişi

- Önceki `teambrief.reports.v1` kayıtları ilk açılışta `teambrief.data.v2` yapısına taşınır; eski anahtar yedek olarak değiştirilmeden tutulur.
- Yeni yapı bildirimler ile kararları ayrı koleksiyonlarda saklar. Bildirimin orijinal `status` alanı korunur; ekrandaki güncel sonuç ve bekleyen sayaçları karar kayıtlarından hesaplanır.
- Sonraki açılışlarda v2 kullanılır. Kararlar yeniden başlatılmaz, eski bildirimler tekrar eklenmez.
- Kaldırılan yasaklar geçmişten silinmez. Bozuk veriler otomatik silinmez veya üzerlerine yazılmaz. Yazma başarısızsa form ve kayıtlar korunur, hata gösterilir.
- localStorage yalnızca bir demo saklama alanıdır. Gerçek giriş/yetkilendirme, backend, veritabanı ve fotoğraf yükleme bulunmaz.

## Kontroller

```sh
npm test
npm run build
```

Testler Node.js 22.19 veya uyumlu daha yeni sürümün yerleşik test çalıştırıcısıyla çalışır; ek paket gerektirmez. Veri geçişi, bozuk kayıt koruması, zorunlu karar alanları, demo rol kontrolleri, yasak oluşturma/kaldırma ve geçmişin korunması denetlenir.

Üretim çıktısı `dist/` klasöründedir. `npm run preview` ile yerelde incelenebilir.
