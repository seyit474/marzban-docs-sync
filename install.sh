#!/bin/bash
# ============================================================
# Marzban Docs Sync - Otomatik Kurulum
# https://github.com/Seyit474/marzban-docs-sync
# ============================================================

set -e

G='\033[0;32m'
R='\033[0;31m'
Y='\033[1;33m'
C='\033[0;36m'
N='\033[0m'

REPO_URL="https://raw.githubusercontent.com/Seyit474/marzban-docs-sync/main"
INSTALL_DIR="/opt/marzban-sync"
SERVICE_NAME="marzban-sync"

echo -e "${C}"
echo "╔════════════════════════════════════════╗"
echo "║   Marzban → Google Docs Sync           ║"
echo "║   Kurulum Scripti                      ║"
echo "╚════════════════════════════════════════╝"
echo -e "${N}"

# Root kontrolü
if [ "$EUID" -ne 0 ]; then
  echo -e "${R}Bu script root olarak çalıştırılmalı (sudo bash install.sh)${N}"
  exit 1
fi

# Bağımlılıklar
echo -e "${Y}[1/5] Bağımlılıklar kuruluyor...${N}"
apt-get update -qq
apt-get install -y python3 python3-pip curl wget >/dev/null
pip3 install requests --break-system-packages >/dev/null 2>&1 || pip3 install requests >/dev/null

# Bilgileri al - interaktif
echo -e "${Y}[2/5] VPS bilgileri:${N}"
echo ""

read -p "Marzban URL (örn: https://panel.example.com): " MARZBAN_URL </dev/tty
read -p "Marzban admin kullanıcı adı: " MARZBAN_USER </dev/tty
read -sp "Marzban admin şifresi: " MARZBAN_PASS </dev/tty
echo ""
read -p "VPS kısa adı (vps1, vps2, cf1 vb.): " VPS_NAME </dev/tty
read -p "Apps Script URL: " APPS_SCRIPT_URL </dev/tty
read -p "Secret [marzban-secret-2024]: " SECRET </dev/tty
SECRET=${SECRET:-marzban-secret-2024}

# Boş kontrolü
if [ -z "$MARZBAN_URL" ] || [ -z "$MARZBAN_USER" ] || [ -z "$MARZBAN_PASS" ] || [ -z "$VPS_NAME" ] || [ -z "$APPS_SCRIPT_URL" ]; then
  echo -e "${R}HATA: Tüm alanları doldurmalısın!${N}"
  exit 1
fi

# Dosyaları indir
echo -e "${Y}[3/5] Dosyalar yükleniyor...${N}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if ! wget -q "$REPO_URL/marzban_sync.py" -O marzban_sync.py; then
  echo -e "${R}HATA: marzban_sync.py indirilemedi!${N}"
  echo "URL: $REPO_URL/marzban_sync.py"
  exit 1
fi

if ! wget -q "$REPO_URL/marzban-sync.service" -O /etc/systemd/system/${SERVICE_NAME}.service; then
  echo -e "${R}HATA: service dosyası indirilemedi!${N}"
  exit 1
fi

# Dosya boyut kontrolü
SIZE=$(stat -c%s "marzban_sync.py")
if [ "$SIZE" -lt 1000 ]; then
  echo -e "${R}HATA: marzban_sync.py boş veya çok küçük ($SIZE bytes)${N}"
  echo "GitHub repo'da dosya var mı kontrol et: $REPO_URL/marzban_sync.py"
  exit 1
fi

# .env oluştur
cat > "$INSTALL_DIR/.env" << EOF
MARZBAN_URL=$MARZBAN_URL
MARZBAN_USER=$MARZBAN_USER
MARZBAN_PASS=$MARZBAN_PASS
VPS_NAME=$VPS_NAME
APPS_SCRIPT_URL=$APPS_SCRIPT_URL
SECRET=$SECRET
CHECK_INTERVAL=60
VERIFY_SSL=true
EOF
chmod 600 "$INSTALL_DIR/.env"

# Service başlat
echo -e "${Y}[4/5] Servis başlatılıyor...${N}"
systemctl daemon-reload
systemctl enable ${SERVICE_NAME} >/dev/null 2>&1
systemctl restart ${SERVICE_NAME}

sleep 3

# Kontrol
echo -e "${Y}[5/5] Kontrol...${N}"
if systemctl is-active --quiet ${SERVICE_NAME}; then
  echo -e "${G}✓ Kurulum tamamlandı!${N}"
  echo ""
  echo -e "${C}Komutlar:${N}"
  echo "  Durum:    systemctl status $SERVICE_NAME"
  echo "  Loglar:   tail -f /var/log/marzban_sync.log"
  echo "  Restart:  systemctl restart $SERVICE_NAME"
  echo "  Config:   nano $INSTALL_DIR/.env"
  echo ""
  echo -e "${C}İlk loglar:${N}"
  sleep 2
  tail -n 15 /var/log/marzban_sync.log 2>/dev/null || echo "Log henüz oluşmadı"
else
  echo -e "${R}✗ Servis başlamadı!${N}"
  echo "Hata: journalctl -u $SERVICE_NAME -n 50 --no-pager"
  journalctl -u $SERVICE_NAME -n 20 --no-pager
  exit 1
fi
