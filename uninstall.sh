#!/bin/bash
# ============================================================
# Marzban Docs Sync - Kaldırma
# ============================================================

set -e

R='\033[0;31m'
G='\033[0;32m'
Y='\033[1;33m'
N='\033[0m'

if [ "$EUID" -ne 0 ]; then
  echo -e "${R}Root gerek (sudo bash uninstall.sh)${N}"
  exit 1
fi

echo -e "${Y}Marzban Docs Sync kaldırılıyor...${N}"

systemctl stop marzban-sync 2>/dev/null || true
systemctl disable marzban-sync 2>/dev/null || true

rm -f /etc/systemd/system/marzban-sync.service
rm -rf /opt/marzban-sync
rm -f /var/log/marzban_sync.log

systemctl daemon-reload

echo -e "${G}✓ Kaldırma tamamlandı.${N}"
echo ""
echo "Not: Google Docs dosyaları Drive'da kaldı."
echo "Manuel silmek için: drive.google.com → arama: 'marzban'"
