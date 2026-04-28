# Marzban → Google Docs Sync

Marzban kullanıcılarının subscription linklerini **Google Docs** üzerinden sunan bir köprü sistemi. Engellenmiş VPS/CDN domainleri için alternatif sunum yolu sağlar — `doc.google.com` Türkmenistan gibi katı sansürlü ülkelerde dahi erişilebilir.

## Nasıl Çalışır

```
Marzban VPS                          Google Apps Script
┌──────────────┐                     ┌──────────────────┐
│ Python sync  │   POST keylar       │                  │
│ (her 60sn)   │ ─────────────────►  │ Docs oluştur     │
│              │                     │ İçeriği yaz      │
│ Note güncel  │ ◄─────────────────  │ doc.google.com   │
│ /api/user    │   doc link          │ link döndür      │
└──────────────┘                     └──────────────────┘
        │
        ▼
Marzban Note alanı:
https://doc.google.com/document/d/.../export?format=txt&h=hash#username
```

## Özellikler

- ✅ Otomatik kullanıcı senkronizasyonu (her 60 saniyede bir)
- ✅ Sub içerik değiştiğinde otomatik güncelleme (hash karşılaştırma)
- ✅ Çoklu VPS desteği (her VPS için VPS_NAME prefix)
- ✅ Hiddify, v2rayN, HAPP, FoXray gibi tüm istemcilerle uyumlu
- ✅ Profil adı olarak kullanıcı adı görünür
- ✅ Systemd service ile arkaplan çalışma

## Kurulum

### 1. Google Apps Script

1. https://script.google.com → **Yeni proje**
2. `apps_script.js` içeriğini yapıştır
3. Kaydet (`Ctrl+S`)
4. **Dağıt → Yeni dağıtım → Web uygulaması**
   - Şu kullanıcı olarak çalıştır: **Ben**
   - Erişimi olanlar: **Herkes**
5. Verilen URL'yi kopyala

### 2. VPS Kurulum (her VPS için)

```bash
curl -fsSL https://raw.githubusercontent.com/seyit474/marzban-docs-sync/main/install.sh | bash
```

Veya manuel:
```bash
git clone https://github.com/seyit474/marzban-docs-sync.git
cd marzban-docs-sync
bash install.sh
```

Script seni şu bilgileri girmeye yönlendirecek:
- Marzban URL
- Admin kullanıcı adı / şifre
- VPS adı (vps1, vps2, vps3 gibi)
- Apps Script URL

### 3. Kontrol

```bash
systemctl status marzban-sync
tail -f /var/log/marzban_sync.log
```

## Kullanım

Marzban'da kullanıcı oluştur veya düzenle. Servis 60 saniye içinde fark eder:
- Yeni kullanıcı → Google Docs oluşturur
- İçerik değişimi → Mevcut Docs'u günceller
- doc.google.com linkini Marzban Note alanına yazar

Sen panelde kullanıcının **Note** alanından linki kopyalar, müşteriye verirsin.

## Komutlar

```bash
# Durum
systemctl status marzban-sync

# Loglar
tail -f /var/log/marzban_sync.log

# Restart
systemctl restart marzban-sync

# Config düzenle
nano /opt/marzban-sync/.env
systemctl restart marzban-sync

# Tüm Note'ları sıfırla (yeniden oluştur)
bash /opt/marzban-sync/clear-notes.sh

# Kaldır
bash uninstall.sh
```

## Çoklu VPS Kullanımı

3 VPS'in hepsi aynı Apps Script URL'sini kullanır. Her VPS'in farklı bir `VPS_NAME`'i olur (vps1, vps2, vps3 gibi). Bu sayede aynı kullanıcı adı 3 farklı VPS'te olsa bile çakışma olmaz.

## Sorun Giderme

**"Token alınamadı"** → Marzban URL/şifre yanlış. `.env` kontrol et.

**"Sub içeriği alınamadı: 403"** → Marzban'da HWID özelliği açık. Kapat veya User-Agent ekle.

**"Doc create failed"** → Apps Script güncel değil veya URL yanlış. Apps Script'i yeniden deploy et.

**Hiddify'da uzun dosya adı** → Apps Script eski sürümde. Güncel `apps_script.js`'i deploy et, sonra `clear-notes.sh` çalıştır.

## Lisans

MIT
