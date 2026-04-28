#!/bin/bash
# ============================================================
# Marzban Note Cleaner
# ============================================================
# Tüm kullanıcıların Note alanını boşaltır.
# Sync servisini restart edince yeni Docs oluşturulur.
# ============================================================

set -e

if [ ! -f /opt/marzban-sync/.env ]; then
  echo "Önce kurulumu yap (install.sh)"
  exit 1
fi

source /opt/marzban-sync/.env

echo "Marzban: $MARZBAN_URL"
read -p "Tüm kullanıcıların Note'ları silinecek. Devam? (yes/NO): " CONFIRM
[ "$CONFIRM" != "yes" ] && { echo "İptal edildi."; exit 0; }

TOKEN=$(curl -s -X POST "$MARZBAN_URL/api/admin/token" \
  -d "username=$MARZBAN_USER&password=$MARZBAN_PASS" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

if [ -z "$TOKEN" ]; then
  echo "Token alınamadı"
  exit 1
fi

curl -s -H "Authorization: Bearer $TOKEN" "$MARZBAN_URL/api/users" | \
TOKEN=$TOKEN URL=$MARZBAN_URL python3 -c "
import sys, json, requests, os
token = os.environ['TOKEN']
url = os.environ['URL']
users = json.load(sys.stdin)['users']
print(f'Toplam {len(users)} kullanıcı temizleniyor...')
for u in users:
    requests.put(f'{url}/api/user/{u[\"username\"]}',
                 headers={'Authorization': f'Bearer {token}'},
                 json={'note': ''})
    print('  ✓', u['username'])
"

echo ""
echo "Servisi restart et: systemctl restart marzban-sync"
