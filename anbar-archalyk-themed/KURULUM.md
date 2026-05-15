# Anbar Ulgamy v5 — Kurulum Kılavuzu

## Gereksinimler
- Ubuntu 22.04 veya 24.04 (64-bit)
- En az 512 MB RAM, 5 GB disk
- İnternet bağlantısı

---

## 1. Hızlı Kurulum (Sunucuda)

Zip'i sunucuya yükledikten sonra:

```bash
cd anbar-server-fixed
sudo bash install.sh
```

Sorular sorulacak — doldurun ve bekleyin (~3-5 dakika).

---

## 2. Manuel Kurulum (yerel test)

```bash
# Node.js 18+ gerekli
cd anbar-server-fixed
npm install
cp .env.example .env
nano .env          # şifre ve API key'leri girin
node server.js
# → http://localhost:3000
```

---

## 3. Güncelleme (mevcut kurulum varsa)

```bash
cd anbar-server-fixed
sudo bash install.sh
# Aynı komutu çalıştırın — veritabanı korunur, sadece dosyalar güncellenir
```

---

## 4. Önemli Dosyalar

| Dosya | Açıklama |
|-------|----------|
| `/opt/anbar/.env` | Şifre, API key, şirket bilgileri |
| `/var/lib/anbar/anbar.db` | Veritabanı (yedekleyin!) |
| `/opt/anbar/server.js` | Sunucu kodu |
| `/opt/anbar/public/` | Arayüz dosyaları |

---

## 5. .env Ayarları

```env
ADMIN_PASSWORD=güçlü_şifre       # Admin girişi
ANTHROPIC_API_KEY=sk-ant-...     # AI fatura okuma (opsiyonel)
TELEGRAM_BOT_TOKEN=...           # Günlük yedekleme (opsiyonel)
TELEGRAM_ADMIN_ID=...            # Telegram kullanıcı ID'niz
COMPANY_NAME=Arcalyk Tejen       # Faturada görünür
COMPANY_ADDRESS=Tejen şäheri     # Faturada görünür
COMPANY_PHONE=+993 ...           # Faturada görünür
```

Değiştirdikten sonra: `sudo systemctl restart anbar`

---

## 6. Log & Sorun Giderme

```bash
sudo journalctl -u anbar -f          # canlı log
sudo systemctl status anbar          # servis durumu
sudo systemctl restart anbar         # yeniden başlat
```
