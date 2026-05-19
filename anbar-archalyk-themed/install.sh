#!/bin/bash
# Anbar Ulgamy v5 — Ubuntu 22.04/24.04 Otomatik Kurulum
set -e
[ "$EUID" -ne 0 ] && { echo "❌  sudo bash install.sh diýiň"; exit 1; }

APP_DIR="/opt/anbar"
DATA_DIR="/var/lib/anbar"
APP_USER="anbar"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ANBAR ULGAMY v5 — GURLUŞ BAŞLAÝAR      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Ulanyjy girişleri ──────────────────────────
read -p "Domeniňiz (boş = IP bilen işlär): " DOMAIN
read -p "Admin şifresi [admin123]: " ADMIN_PWD;   ADMIN_PWD=${ADMIN_PWD:-admin123}
read -p "Kompaniýa ady [Arcalyk Tejen]: " CO_NAME; CO_NAME=${CO_NAME:-Arcalyk Tejen}
read -p "Kompaniýa salgysy [Tejen şäheri]: " CO_ADDR; CO_ADDR=${CO_ADDR:-Tejen şäheri, Türkmenistan}
read -p "Kompaniýa telefony (boş bolup biler): " CO_PHONE
read -p "Anthropic API açary (boş = AI ýok): " API_KEY
read -p "Telegram Bot Token (boş = ýedek ýok): " TG_TOKEN
read -p "Telegram Admin ID: " TG_ADMIN

# ── 1. Ulgam täzelemesi ─────────────────────────
echo ""
echo "[1/8] Ulgam täzelenýär..."
apt-get update -y -q && apt-get upgrade -y -q

# ── 2. Node.js 20 ──────────────────────────────
echo "[2/8] Node.js 20 barlanýar / gurulýar..."
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -q
  apt-get install -y -q nodejs
fi
echo "    Node: $(node -v) | npm: $(npm -v)"

# ── 3. Gerekli paketler ─────────────────────────
echo "[3/8] Nginx, sqlite3, ufw gurulýar..."
apt-get install -y -q nginx build-essential python3 ufw sqlite3

# ── 4. Ulanyjy we bukja ─────────────────────────
echo "[4/8] Ulgam ulanyjysy we bukjalar..."
id "$APP_USER" &>/dev/null || useradd -r -s /bin/false -d "$APP_DIR" "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" "$DATA_DIR"

# ── 5. Faýllar göçürilýär ──────────────────────
echo "[5/8] Faýllar göçürilýär..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -f  "$SCRIPT_DIR/server.js"    "$APP_DIR/"
cp -f  "$SCRIPT_DIR/package.json" "$APP_DIR/"
cp -rf "$SCRIPT_DIR/public"       "$APP_DIR/"

# .env ýaz (öncekini üzerine yaz)
JWT=$(openssl rand -base64 64 | tr -d '\n/+=' | head -c 80)
cat > "$APP_DIR/.env" << ENV
PORT=3000
JWT_SECRET=$JWT
DB_PATH=$DATA_DIR/anbar.db
ADMIN_PASSWORD=$ADMIN_PWD
ANTHROPIC_API_KEY=$API_KEY
TELEGRAM_BOT_TOKEN=$TG_TOKEN
TELEGRAM_ADMIN_ID=$TG_ADMIN
COMPANY_NAME=$CO_NAME
COMPANY_ADDRESS=$CO_ADDR
COMPANY_PHONE=$CO_PHONE
TZ=Asia/Ashgabat
ENV
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

# ── 6. NPM paketlen ────────────────────────────
echo "[6/8] NPM paketlen gurulýar... (1-2 min)"
cd "$APP_DIR" && sudo -u "$APP_USER" npm install --omit=dev --loglevel=error

# ── 7. systemd servisi ─────────────────────────
echo "[7/8] Systemd servisi döredilýär..."
cat > /etc/systemd/system/anbar.service << SVC
[Unit]
Description=Anbar Ulgamy v5
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=TZ=Asia/Ashgabat
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable anbar
systemctl restart anbar
sleep 3

# Servis barla
if ! systemctl is-active --quiet anbar; then
  echo ""
  echo "❌  Servis başlamady! Log:"
  journalctl -u anbar -n 20 --no-pager
  exit 1
fi
echo "    ✓ Servis işleýär"

# ── 8. Nginx ──────────────────────────────────
echo "[8/8] Nginx sazlanýar..."
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/anbar << NGX
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;
    client_max_body_size 20M;
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }
}
NGX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/anbar /etc/nginx/sites-enabled/anbar
nginx -t && systemctl reload nginx
echo "    ✓ Nginx işleýär"

# ── UFW ──────────────────────────────────────
ufw allow OpenSSH   > /dev/null
ufw allow 'Nginx Full' > /dev/null
ufw --force enable  > /dev/null
echo "    ✓ Firewall sazlandy"

# ── SSL (isleg boýunça) ───────────────────────
if [ -n "$DOMAIN" ]; then
  read -p "SSL (Let's Encrypt) gurulsunmy? [y/N]: " SSL
  if [[ "$SSL" =~ ^[Yy]$ ]]; then
    apt-get install -y -q certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" \
      --non-interactive --agree-tos \
      --email "admin@${DOMAIN}" \
      --redirect || echo "⚠️  SSL üçin DNS dogry sazlanandygyny barlaň"
  fi
fi

# ── Netije ───────────────────────────────────
IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
URL="http://${DOMAIN:-$IP}"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅  GURLUŞ TAMAMLANDY!                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  🌐  Adres   : $URL"
echo "  👤  Ulanyjy : admin"
echo "  🔑  Şifre   : $ADMIN_PWD"
echo "  🤖  AI      : ${API_KEY:+✓ Aktif}${API_KEY:-✗ Sazlanylmadyk}"
echo "  📲  Telegram: ${TG_TOKEN:+✓ Aktif — bota /start basyň}${TG_TOKEN:-✗ Sazlanylmadyk}"
echo ""
echo "  ── Dolandyryş buýruklary ──────────────"
echo "  sudo systemctl status  anbar    # ýagdaý"
echo "  sudo systemctl restart anbar    # täzeden başla"
echo "  sudo journalctl -u anbar -f     # log"
echo "  sudo nano $APP_DIR/.env         # sazlamalar"
echo ""

# PDF resimlerini otomatik hazirla
if [ -f "/root/arcalyk_catalog_en.pdf" ]; then
    echo "PDF'den resimler hazirlaniyor..."
    mkdir -p /opt/anbar/public/img/products/pages
    pip3 install pdf2image Pillow 2>/dev/null
    python3 << 'PYEOF'
from pdf2image import convert_from_path
import os
pages = convert_from_path('/root/arcalyk_catalog_en.pdf', dpi=120, fmt='jpeg')
out = '/opt/anbar/public/img/products/pages'
os.makedirs(out, exist_ok=True)
for i, page in enumerate(pages):
    page.save(f'{out}/page-{i+1:03d}.jpg', 'JPEG', quality=85)
print(f'{len(pages)} sayfa hazir!')
PYEOF
    echo "Resimler hazir!"
fi
