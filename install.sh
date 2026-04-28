#!/bin/bash
# ============================================================
# Marzban Docs Sync - Otomatik Kurulum
# ============================================================
# Kullanım:
#   curl -fsSL https://raw.githubusercontent.com/USER/REPO/main/install.sh | bash
# veya:
#   wget https://raw.githubusercontent.com/USER/REPO/main/install.sh
#   bash install.sh
# ============================================================

set -e

# Renkler
G='\033[0;32m'
R='\033[0;31m'
Y='\033[1;33m'
C='\033[0;36m'
N='\033[0m'

# Repo (GitHub'a yükledikten sonra burayı düzenle)
REPO_URL="https://raw.githubusercontent.com/YOUR_USERNAME/marzban-docs-sync/main"

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

# Bağımlılıkları kur
echo -e "${Y}[1/5] Bağımlılıklar kuruluyor...${N}"
apt-get update -qq
apt-get install -y python3 python3-pip curl wget >/dev/null
pip3 install requests --break-system-packages >/dev/null 2>&1 || pip3 install requests >/dev/null

# Bilgileri al
echo -e "${Y}[2/5] VPS bilgileri:${N}"
read -p "Marzban URL (örn: https://panel.example.com): " MARZBAN_URL
read -p "Marzban admin kullanıcı adı: " MARZBAN_USER
read -sp "Marzban admin şifresi: " MARZBAN_PASS
echo ""
read -p "VPS kısa adı (örn: vps1, cf1, ru1): " VPS_NAME
read -p "Apps Script URL (https://script.google.com/macros/s/.../exec): " APPS_SCRIPT_URL
read -p "Secret [marzban-secret-2024]: " SECRET
SECRET=${SECRET:-marzban-secret-2024}

# Klasör hazırla
echo -e "${Y}[3/5] Dosyalar yükleniyor...${N}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Script ve service'i indir (GitHub'dan)
wget -q "$REPO_URL/marzban_sync.py" -O marzban_sync.py
wget -q "$REPO_URL/marzban-sync.service" -O /etc/systemd/system/${SERVICE_NAME}.service

# .env dosyası oluştur
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

# Durum kontrol
echo -e "${Y}[5/5] Kontrol...${N}"
if systemctl is-active --quiet ${SERVICE_NAME}; then
  echo -e "${G}✓ Kurulum tamamlandı!${N}"
  echo ""
  echo -e "${C}Kullanışlı komutlar:${N}"
  echo "  Durum:    systemctl status $SERVICE_NAME"
  echo "  Loglar:   tail -f /var/log/marzban_sync.log"
  echo "  Restart:  systemctl restart $SERVICE_NAME"
  echo "  Stop:     systemctl stop $SERVICE_NAME"
  echo "  Config:   nano $INSTALL_DIR/.env"
  echo ""
  echo -e "${C}İlk loglar:${N}"
  tail -n 10 /var/log/marzban_sync.log 2>/dev/null || echo "Log henüz oluşmadı"
else
  echo -e "${R}✗ Servis başlamadı!${N}"
  echo "Hata için: journalctl -u $SERVICE_NAME -n 50"
  exit 1
fi
