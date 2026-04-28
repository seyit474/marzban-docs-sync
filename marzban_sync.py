#!/usr/bin/env python3
# ============================================================
# Marzban → Google Docs Sync Service
# https://github.com/YOUR_USERNAME/marzban-docs-sync
# ============================================================
# Marzban kullanıcılarını Google Docs üzerinden subscription
# linki olarak sunar. Her kullanıcı için doc.google.com hostlu
# bir link oluşturur ve Marzban'ın Note alanına yazar.
# ============================================================

import requests
import time
import hashlib
import logging
import sys
import re
import os

# ============================================================
# CONFIG - install.sh otomatik dolduracak
# Manuel kurulumda buraları kendin doldur
# ============================================================
MARZBAN_URL  = os.getenv("MARZBAN_URL",  "CHANGE_ME")
MARZBAN_USER = os.getenv("MARZBAN_USER", "CHANGE_ME")
MARZBAN_PASS = os.getenv("MARZBAN_PASS", "CHANGE_ME")
VPS_NAME     = os.getenv("VPS_NAME",     "vps1")

APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL", "CHANGE_ME")
SECRET          = os.getenv("SECRET",          "marzban-secret-2024")

CHECK_INTERVAL  = int(os.getenv("CHECK_INTERVAL", "60"))
VERIFY_SSL      = os.getenv("VERIFY_SSL", "true").lower() == "true"

# ============================================================
# Logging
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('/var/log/marzban_sync.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
log = logging.getLogger("marzban_sync")

# ============================================================
# Marzban API
# ============================================================
class Marzban:
    def __init__(self):
        self.token = None
        self.token_expires = 0

    def get_token(self):
        if self.token and time.time() < self.token_expires:
            return self.token
        try:
            r = requests.post(
                f"{MARZBAN_URL}/api/admin/token",
                data={"username": MARZBAN_USER, "password": MARZBAN_PASS},
                timeout=10, verify=VERIFY_SSL
            )
            r.raise_for_status()
            self.token = r.json()["access_token"]
            self.token_expires = time.time() + 3000
            log.info("Marzban token alındı")
            return self.token
        except Exception as e:
            log.error(f"Token alınamadı: {e}")
            return None

    def headers(self):
        token = self.get_token()
        if not token: return None
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def get_users(self):
        try:
            h = self.headers()
            if not h: return []
            r = requests.get(f"{MARZBAN_URL}/api/users", headers=h, timeout=15, verify=VERIFY_SSL)
            r.raise_for_status()
            return r.json().get("users", [])
        except Exception as e:
            log.error(f"Kullanıcı listesi alınamadı: {e}")
            return []

    def get_sub_content(self, sub_url):
        try:
            r = requests.get(sub_url, timeout=15, verify=VERIFY_SSL,
                             headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            return r.text
        except Exception as e:
            log.error(f"Sub içeriği alınamadı: {e}")
            return None

    def update_note(self, username, note):
        try:
            h = self.headers()
            if not h: return False
            r = requests.put(f"{MARZBAN_URL}/api/user/{username}",
                             headers=h, json={"note": note},
                             timeout=10, verify=VERIFY_SSL)
            r.raise_for_status()
            return True
        except Exception as e:
            log.error(f"Note güncellenemedi ({username}): {e}")
            return False

# ============================================================
# Apps Script
# ============================================================
class AppsScript:
    @staticmethod
    def post(payload):
        try:
            payload["secret"] = SECRET
            r = requests.post(APPS_SCRIPT_URL, json=payload, timeout=60, allow_redirects=True)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            log.error(f"Apps Script error: {e}")
            return None

    @staticmethod
    def create_doc(username, content):
        return AppsScript.post({"action": "create", "username": username, "content": content})

    @staticmethod
    def update_doc(doc_id, content):
        return AppsScript.post({"action": "update", "doc_id": doc_id, "content": content})

# ============================================================
# Note parse/format
# Note formatı:
# https://doc.google.com/document/d/ID/export?format=txt&h=HASH#USERNAME
# ============================================================
def parse_note(note):
    if not note: return {}
    result = {}
    m = re.search(r'/document/d/([a-zA-Z0-9_-]+)', note)
    if m:
        result["id"] = m.group(1)
    m = re.search(r'[?&]h=([a-f0-9]+)', note)
    if m:
        result["hash"] = m.group(1)
    return result

def format_note(doc_link, content_hash, username):
    return f"{doc_link}&h={content_hash}#{username}"

def content_hash(content):
    return hashlib.md5(content.encode()).hexdigest()[:12]

# ============================================================
# Sync
# ============================================================
def sync_user(mz, user):
    username = user["username"]
    sub_url = user.get("subscription_url")
    note = user.get("note") or ""

    if not sub_url:
        return

    if sub_url.startswith("/"):
        sub_url = MARZBAN_URL + sub_url

    content = mz.get_sub_content(sub_url)
    if not content:
        return

    new_hash = content_hash(content)
    note_data = parse_note(note)
    old_hash = note_data.get("hash", "")
    doc_id = note_data.get("id", "")

    if not doc_id:
        log.info(f"{username}: yeni Docs oluşturuluyor...")
        result = AppsScript.create_doc(f"{VPS_NAME}_{username}", content)
        if not result or not result.get("ok"):
            log.error(f"{username}: Docs oluşturulamadı - {result}")
            return
        doc_id = result.get("doc_id")
        doc_link = result.get("doc_link")
        if not doc_id:
            log.error(f"{username}: doc_id boş")
            return
        new_note = format_note(doc_link, new_hash, username)
        if mz.update_note(username, new_note):
            log.info(f"{username}: ✓ {doc_link}")
        return

    if new_hash != old_hash:
        log.info(f"{username}: içerik değişti, güncelleniyor...")
        result = AppsScript.update_doc(doc_id, content)
        if result and result.get("ok"):
            doc_link = f"https://doc.google.com/document/d/{doc_id}/export?format=txt"
            new_note = format_note(doc_link, new_hash, username)
            mz.update_note(username, new_note)
            log.info(f"{username}: ✓ güncellendi")

def sync_all():
    mz = Marzban()
    users = mz.get_users()
    log.info(f"[{VPS_NAME}] Toplam kullanıcı: {len(users)}")
    for user in users:
        try:
            sync_user(mz, user)
            time.sleep(2)
        except Exception as e:
            log.error(f"{user.get('username')}: {e}")

def main():
    log.info("=" * 50)
    log.info(f"Marzban → Google Docs Sync [{VPS_NAME}]")
    log.info(f"Marzban: {MARZBAN_URL}")
    log.info("=" * 50)

    # Config kontrolü
    if "CHANGE_ME" in [MARZBAN_URL, MARZBAN_USER, MARZBAN_PASS, APPS_SCRIPT_URL]:
        log.error("CONFIG eksik! .env dosyasını veya environment variables'ları doldur.")
        sys.exit(1)

    while True:
        try:
            sync_all()
        except Exception as e:
            log.error(f"Sync error: {e}")
        time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    main()
