process.env.TZ = process.env.TZ || 'Asia/Ashgabat';
require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const fetch = require('node-fetch');
const FormData = require('form-data');
const Anthropic = require('@anthropic-ai/sdk');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'anbar-v5-' + Math.random();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'anbar.db');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const COMPANY_NAME = process.env.COMPANY_NAME || 'Arcalyk Tejen';
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || 'Tejen şäheri';
const COMPANY_PHONE = process.env.COMPANY_PHONE || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_ADMIN = process.env.TELEGRAM_ADMIN_ID || '';

// Roller: admin, patron, kassa, skladcy
const ROLES = { admin: 4, kassa: 3, skladcy: 2, patron: 1, satici: 1 };

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// ═══════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'skladcy' CHECK(role IN ('admin','patron','kassa','skladcy','satici')),
    permissions TEXT DEFAULT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT DEFAULT '💸',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    stock REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'sany',
    category TEXT,
    barcode TEXT,
    sort_order INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );


  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    notes TEXT,
    total_purchases REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('giris','cikis','iade')),
    user_id INTEGER NOT NULL,
    customer_id INTEGER,
    customer_name TEXT,
    customer_phone TEXT,
    total REAL NOT NULL DEFAULT 0,
    discount_total REAL DEFAULT 0,
    promo_total REAL DEFAULT 0,
    invoice_no TEXT,
    related_to INTEGER,
    partial_returned INTEGER DEFAULT 0,
    returned_fully INTEGER DEFAULT 0,
    notes TEXT,
    movement_date TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS movement_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movement_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    qty REAL NOT NULL,
    unit TEXT NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    discount_amt REAL DEFAULT 0,
    final_price REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL DEFAULT 0,
    is_promo INTEGER DEFAULT 0,
    stock_before REAL,
    stock_after REAL,
    FOREIGN KEY(movement_id) REFERENCES movements(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    position TEXT,
    monthly_salary REAL NOT NULL DEFAULT 0,
    start_date TEXT NOT NULL,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL DEFAULT 'payment' CHECK(type IN ('payment','advance')),
    note TEXT,
    paid_by INTEGER,
    payment_date TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    category_name TEXT NOT NULL DEFAULT 'Beýleki',
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    user_id INTEGER,
    expense_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES expense_categories(id)
  );

  CREATE INDEX IF NOT EXISTS idx_mov_date ON movements(movement_date);
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    phone TEXT,
    address TEXT,
    notes TEXT,
    total_purchases REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS factory_debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    debt_date TEXT NOT NULL,
    movement_id INTEGER REFERENCES movements(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS factory_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debt_id INTEGER REFERENCES factory_debts(id),
    amount REAL NOT NULL,
    note TEXT,
    payment_date TEXT NOT NULL,
    paid_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_fd_date ON factory_debts(debt_date);
  CREATE INDEX IF NOT EXISTS idx_fp_date ON factory_payments(payment_date);
    CREATE INDEX IF NOT EXISTS idx_mov_type ON movements(type);
  CREATE INDEX IF NOT EXISTS idx_mov_cust ON movements(customer_id);
  CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(expense_date);
  CREATE INDEX IF NOT EXISTS idx_sal_emp ON salary_payments(employee_id);
`);

try { db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`); } catch(e) {}

// permissions kolonunu users'a ekle (varsa atla)
try { db.exec('ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL'); } catch(e) {}

// Supplier_id kolonunu movements'a ekle (varsa atla)
try { db.exec('ALTER TABLE movements ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)'); } catch(e) {}

// factory_debts auto-link on giris movement
// (handled in POST /api/movements - movement_id reference)


// İlk kurulum veya şifre güncelleme
const adminPwd = process.env.ADMIN_PASSWORD || 'admin123';
if (!db.prepare('SELECT COUNT(*) as c FROM users').get().c) {
  // DB boş — yeni admin oluştur
  db.prepare('INSERT INTO users(username,password_hash,full_name,phone,role) VALUES(?,?,?,?,?)').run(
    'admin', bcrypt.hashSync(adminPwd, 10), 'Esasy Dolandyryjy', COMPANY_PHONE, 'admin'
  );
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║  Admin: admin / ${adminPwd.padEnd(17)}║`);
  console.log(`╚══════════════════════════════════╝\n`);
} else {
  // DB var — .env'deki şifre ile admin şifresini güncelle
  db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(
    bcrypt.hashSync(adminPwd, 10), 'admin'
  );
  console.log(`Admin şifresi güncellendi: admin / ${adminPwd}`);
}

// Varsayılan gider kategorileri
if (!db.prepare('SELECT COUNT(*) as c FROM expense_categories').get().c) {
  const cats = [
    ['Benzin we ýol pul', '⛽', 1],
    ['Zapçast we ussahana', '🔧', 2],
    ['Nahar we önümler', '🍽️', 3],
    ['Beýleki', '💸', 4]
  ];
  const ins = db.prepare('INSERT INTO expense_categories(name,icon,sort_order) VALUES(?,?,?)');
  cats.forEach(c => ins.run(...c));
}

// Varsayılan üpjünçi
if (!db.prepare('SELECT COUNT(*) as c FROM suppliers').get().c) {
  db.prepare("INSERT INTO suppliers(name,address,notes) VALUES(?,?,?)").run('Arcalyk Zawod','Arcalyk şäheri, Türkmenistan','Esasy üpjünçi');
  console.log('Arcalyk Zawod üpjünçisi goşuldy');
}

// Varsayılan ürünler
if (!db.prepare('SELECT COUNT(*) as c FROM products').get().c) {
  const defs = [
    ['Arassa suw 0.5 L', 19.80, 'BL'], ['Arassa suw 1.5 L', 18.00, 'BL'],
    ['1.5 L Fanta-pyrtykal', 27.00, 'BL'], ['1.5 L Kola', 27.60, 'BL'],
    ['0.5 L Powrize', 0, 'BL'], ['1.5 L Buratino', 0, 'BL'],
    ['1.5 L Gaymakly', 0, 'BL'], ['1.5 L Mineralny', 0, 'BL'],
    ['1.5 L Pyrtykal', 0, 'BL'], ['1.5 L Setdaly', 0, 'BL'],
    ['1.5 L Tarhun', 0, 'BL'], ['PROMA 0.5 L Powrize', 0, 'BL'],
    ['PROMA 1.5 L Limonad', 0, 'BL'], ['PROMA 1.5 L Mineralny', 0, 'BL'],
    ['Setka', 60.00, 'SAN'], ['Plasmas poddon', 500.00, 'SAN']
  ];
  const ins = db.prepare('INSERT INTO products(name,price,unit) VALUES(?,?,?)');
  defs.forEach(d => ins.run(...d));
  console.log('16 taýyn haryt goşuldy');
}

// ═══════════════════════════════════════
// TELEGRAM YEDEKLEME
// ═══════════════════════════════════════
async function sendTelegramBackup() {
  if (!TG_TOKEN || !TG_ADMIN) {
    console.log('Telegram ayarlanmamış, yedekleme atlandı');
    return;
  }
  try {
    const now = new Date();
    const dateStr = now.toLocaleDateString('tr-TR');
    const timeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // Önce text mesajı gönder
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_ADMIN,
        text: `🗄️ *Anbar Ulgamy — Gündelik Ýedek*\n\n📅 Sene: ${dateStr}\n🕐 Wagt: ${timeStr} (Aşgabat)\n🏢 ${COMPANY_NAME}\n\n✅ Doly maglumat bazasy aşakda`,
        parse_mode: 'Markdown'
      })
    });

    // DB dosyasını gönder
    const fd = new FormData();
    fd.append('chat_id', TG_ADMIN);
    fd.append('document', fs.createReadStream(DB_PATH), {
      filename: `anbar-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.db`,
      contentType: 'application/octet-stream'
    });
    fd.append('caption', `📦 Anbar.db — ${dateStr} — ${COMPANY_NAME}`);

    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendDocument`, {
      method: 'POST',
      body: fd
    });
    const result = await r.json();
    if (result.ok) console.log('✓ Telegram yedekleme gönderildi:', dateStr);
    else console.error('Telegram hata:', result.description);
  } catch (err) {
    console.error('Telegram yedekleme hatası:', err.message);
  }
}

// Gece 00:00 Aşgabat saatiyle cron
cron.schedule('0 0 * * *', () => {
  console.log('Gece 00:00 — Telegram yedekleme başlıyor...');
  sendTelegramBackup();
}, { timezone: 'Asia/Ashgabat' });

// ═══════════════════════════════════════
// EXPRESS
// ═══════════════════════════════════════
const app = express();
app.use(cors());
// Migration: sort_order kolonu ekle (eski DB'lerde yoksa)
try { db.prepare('ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0').run(); } catch {}
try { db.prepare('ALTER TABLE products ADD COLUMN img_no INTEGER DEFAULT NULL').run(); } catch {}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Şu anki Aşgabat zamanı
function nowAshgabat() {
  return new Date().toISOString();
}

function todayAshgabat() {
  const now = new Date();
  // UTC+5
  const ash = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return ash.toISOString().slice(0, 10);
}

// Auth middleware
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Giriş gerekli' });
  try { req.user = jwt.verify(h.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token geçersiz' }); }
}

function can(minRole) {
  return (req, res, next) => {
    const level = ROLES[req.user.role] || 0;
    if (level < ROLES[minRole]) return res.status(403).json({ error: `Bu işlem için ${minRole} yetkisi gerekli` });
    next();
  };
}

const adminOnly = can('admin');
const kassaMin = can('kassa');
const anyWorker = can('skladcy');
// saticiMin: satici + kassa + admin geçebilir (sadece cikis faturası için)
const saticiMin = (req, res, next) => {
  const r = req.user.role;
  if (r === 'admin' || r === 'kassa' || r === 'satici') return next();
  return res.status(403).json({ error: 'Bu işlem için satici yetkisi gerekli' });
};
const patronMin = (req, res, next) => {
  if (req.user.role === 'admin' || req.user.role === 'patron') return next();
  return res.status(403).json({ error: 'Bu amal diňe admin ýa-da baslyk üçin elýeterli' });
};

// ═══════════════════════════════════════
// AUTH
// ═══════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash))
    return res.status(401).json({ error: 'Ýalňyş ulanyjy ady ýa-da açar söz' });
  const userPerms = u.permissions ? JSON.parse(u.permissions) : null;
  const token = jwt.sign(
    { id: u.id, username: u.username, role: u.role, full_name: u.full_name, phone: u.phone },
    JWT_SECRET, { expiresIn: '30d' }
  );
  res.json({ token, user: { id: u.id, username: u.username, role: u.role, full_name: u.full_name, phone: u.phone, permissions: userPerms } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const u = db.prepare('SELECT id,username,full_name,phone,role,permissions FROM users WHERE id=?').get(req.user.id);
  res.json({ ...u, permissions: u.permissions ? JSON.parse(u.permissions) : null });
});

app.post('/api/auth/change-password', auth, (req, res) => {
  const { current_password, old_password, new_password, username } = req.body;
  const oldPw = current_password || old_password;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(oldPw, u.password_hash)) return res.status(401).json({ error: 'Häzirki açar söz ýalňyş' });
  if (new_password) {
    if (new_password.length < 4) return res.status(400).json({ error: 'Min 4 harp' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  }
  if (username && username.trim()) {
    const exists = db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username.trim(), req.user.id);
    if (exists) return res.status(400).json({ error: 'Bu ulanyjy ady eýýäm bar' });
    db.prepare('UPDATE users SET username=? WHERE id=?').run(username.trim(), req.user.id);
  }
  res.json({ success: true });
});

// ═══════════════════════════════════════
// USERS
// ═══════════════════════════════════════
app.get('/api/users', auth, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id,username,full_name,phone,role,permissions,active,created_at FROM users ORDER BY role DESC,created_at').all();
  res.json(users.map(u => ({ ...u, permissions: u.permissions ? JSON.parse(u.permissions) : null })));
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, full_name, phone, role, permissions } = req.body;
  if (!username || !password || password.length < 4) return res.status(400).json({ error: 'Ulanyjy ady we açar söz gerek' });
  if (!ROLES[role]) return res.status(400).json({ error: 'Ýalňyş rol' });
  try {
    const r = db.prepare('INSERT INTO users(username,password_hash,full_name,phone,role,permissions) VALUES(?,?,?,?,?,?)').run(
      username, bcrypt.hashSync(password, 10), full_name || username, phone || '', role,
      permissions ? JSON.stringify(permissions) : null
    );
    res.json({ id: r.lastInsertRowid, success: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'Bu ulanyjy ady eýýäm bar' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/users/:id', auth, adminOnly, (req, res) => {
  const { full_name, phone, role, active, password } = req.body;
  const sets = [], vals = [];
  if (full_name !== undefined) { sets.push('full_name=?'); vals.push(full_name); }
  if (phone !== undefined) { sets.push('phone=?'); vals.push(phone); }
  if (role !== undefined) { sets.push('role=?'); vals.push(role); }
  if (active !== undefined) { sets.push('active=?'); vals.push(active ? 1 : 0); }
  if (password) { sets.push('password_hash=?'); vals.push(bcrypt.hashSync(password, 10)); }
  if (req.body.permissions !== undefined) { sets.push('permissions=?'); vals.push(req.body.permissions ? JSON.stringify(req.body.permissions) : null); }
  if (!sets.length) return res.json({ success: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: 'Özüňizi pozup bilmersiňiz' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════
// EXPENSE CATEGORIES
// ═══════════════════════════════════════
app.get('/api/expense-categories', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM expense_categories ORDER BY sort_order,name').all());
});

app.post('/api/expense-categories', auth, adminOnly, (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'Ad gerek' });
  try {
    const r = db.prepare('INSERT INTO expense_categories(name,icon) VALUES(?,?)').run(name, icon || '💸');
    res.json({ id: r.lastInsertRowid, success: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'Bu at eýýäm bar' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/expense-categories/:id', auth, adminOnly, (req, res) => {
  const { name, icon, sort_order } = req.body;
  const sets = [], vals = [];
  if (name !== undefined) { sets.push('name=?'); vals.push(name); }
  if (icon !== undefined) { sets.push('icon=?'); vals.push(icon); }
  if (sort_order !== undefined) { sets.push('sort_order=?'); vals.push(sort_order); }
  if (!sets.length) return res.json({ success: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE expense_categories SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

app.delete('/api/expense-categories/:id', auth, adminOnly, (req, res) => {
  const used = db.prepare('SELECT COUNT(*) as c FROM expenses WHERE category_id=?').get(req.params.id).c;
  if (used > 0) return res.status(400).json({ error: 'Bu kategoriýada gider bar, pozup bolmaz' });
  db.prepare('DELETE FROM expense_categories WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════
app.get('/api/products', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY sort_order ASC, name ASC').all());
});

app.get('/api/products/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Tapylmady' });
  const { from, to } = req.query;
  let q = `SELECT mi.*, m.type, m.movement_date, m.created_at, u.full_name as user_name, m.customer_name, m.invoice_no
    FROM movement_items mi JOIN movements m ON mi.movement_id=m.id
    LEFT JOIN users u ON m.user_id=u.id WHERE mi.product_id=?`;
  const params = [req.params.id];
  if (from) { q += ' AND DATE(m.movement_date)>=?'; params.push(from); }
  if (to) { q += ' AND DATE(m.movement_date)<=?'; params.push(to); }
  q += ' ORDER BY m.movement_date DESC LIMIT 100';
  const history = db.prepare(q).all(...params);

  // Günlük satış özeti
  let dq = `SELECT DATE(m.movement_date) as day, SUM(mi.qty) as total_qty, SUM(mi.line_total) as total_amount,
    COUNT(DISTINCT m.id) as order_count
    FROM movement_items mi JOIN movements m ON mi.movement_id=m.id
    WHERE mi.product_id=? AND m.type='cikis' AND mi.is_promo=0`;
  const dp = [req.params.id];
  if (from) { dq += ' AND DATE(m.movement_date)>=?'; dp.push(from); }
  if (to) { dq += ' AND DATE(m.movement_date)<=?'; dp.push(to); }
  dq += ' GROUP BY day ORDER BY day DESC';
  const dailySales = db.prepare(dq).all(...dp);

  res.json({ ...p, history, daily_sales: dailySales });
});

app.post('/api/products', auth, kassaMin, (req, res) => {
  const { name, stock, price, unit, category } = req.body;
  if (!name) return res.status(400).json({ error: 'Haryt ady gerek' });
  try {
    const r = db.prepare('INSERT INTO products(name,stock,price,unit,category) VALUES(?,?,?,?,?)').run(
      name, stock || 0, price || 0, unit || 'sany', category || null
    );
    res.json({ id: r.lastInsertRowid, success: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'Bu isimde haryt bar' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/products/:id', auth, adminOnly, (req, res) => {
  const { name, stock, price, unit, category, sort_order, img_no } = req.body;
  const sets = ['updated_at=CURRENT_TIMESTAMP'], vals = [];
  if (name !== undefined) { sets.push('name=?'); vals.push(name); }
  if (stock !== undefined) { sets.push('stock=?'); vals.push(stock); }
  if (price !== undefined) { sets.push('price=?'); vals.push(price); }
  if (unit !== undefined) { sets.push('unit=?'); vals.push(unit); }
  if (category !== undefined) { sets.push('category=?'); vals.push(category); }
  if (sort_order !== undefined) { sets.push('sort_order=?'); vals.push(parseInt(sort_order)||0); }
  if (img_no !== undefined) { sets.push('img_no=?'); vals.push(img_no?parseInt(img_no):null); }
  vals.push(req.params.id);
  db.prepare(`UPDATE products SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

app.delete('/api/products/:id', auth, adminOnly, (req, res) => {
  const used = db.prepare('SELECT COUNT(*) as c FROM movement_items WHERE product_id=?').get(req.params.id).c;
  if (used > 0) return res.status(400).json({ error: 'Bu haryt geçmişde ulanylan, pozup bolmaz' });
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════

// ═══════════════════════════════════════
// SUPPLIERS (ÜPJÜNÇILER / ZAWODLAR)
// ═══════════════════════════════════════
app.get('/api/suppliers', auth, (req, res) => {
  const { q } = req.query;
  if (q) {
    const s = `%${q}%`;
    return res.json(db.prepare('SELECT * FROM suppliers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 20').all(s, s));
  }
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY total_purchases DESC').all());
});

app.get('/api/suppliers/:id', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Tapylmady' });
  const { from, to } = req.query;
  let q = `SELECT m.id,m.invoice_no,m.total,m.promo_total,m.movement_date,m.notes,
    u.full_name as buyer_name FROM movements m LEFT JOIN users u ON m.user_id=u.id
    WHERE m.supplier_id=? AND m.type='giris'`;
  const p = [req.params.id];
  if (from) { q += ' AND DATE(m.movement_date)>=?'; p.push(from); }
  if (to) { q += ' AND DATE(m.movement_date)<=?'; p.push(to); }
  q += ' ORDER BY m.movement_date DESC';
  const movs = db.prepare(q).all(...p).map(m => ({
    ...m,
    items: db.prepare(`SELECT product_name,qty,unit,unit_price,line_total,is_promo
      FROM movement_items WHERE movement_id=?`).all(m.id)
  }));
  // Ürün bazlı özet
  const prodSummary = {};
  movs.forEach(m => {
    m.items.forEach(it => {
      if (!prodSummary[it.product_name]) prodSummary[it.product_name] = { qty:0, promo_qty:0, total:0 };
      if (it.is_promo) prodSummary[it.product_name].promo_qty += it.qty;
      else { prodSummary[it.product_name].qty += it.qty; prodSummary[it.product_name].total += it.line_total; }
    });
  });
  const stats = {
    total_amount: movs.reduce((s, m) => s + m.total, 0),
    total_promo: movs.reduce((s, m) => s + (m.promo_total||0), 0),
    order_count: movs.length,
    product_summary: Object.entries(prodSummary).map(([name,v]) => ({ name, ...v })).sort((a,b) => b.total-a.total)
  };
  res.json({ ...s, movements: movs, stats });
});

app.post('/api/suppliers', auth, kassaMin, (req, res) => {
  const { name, phone, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Ad gerek' });
  try {
    const r = db.prepare('INSERT INTO suppliers(name,phone,address,notes) VALUES(?,?,?,?)').run(
      name, phone||null, address||null, notes||null
    );
    res.json({ id: r.lastInsertRowid, success: true, supplier: db.prepare('SELECT * FROM suppliers WHERE id=?').get(r.lastInsertRowid) });
  } catch(e) {
    if (e.code==='SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'Bu at eýýäm bar' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/suppliers/:id', auth, kassaMin, (req, res) => {
  const { name, phone, address, notes } = req.body;
  const sets = ['updated_at=CURRENT_TIMESTAMP'], vals = [];
  if (name !== undefined) { sets.push('name=?'); vals.push(name); }
  if (phone !== undefined) { sets.push('phone=?'); vals.push(phone); }
  if (address !== undefined) { sets.push('address=?'); vals.push(address); }
  if (notes !== undefined) { sets.push('notes=?'); vals.push(notes); }
  vals.push(req.params.id);
  db.prepare(`UPDATE suppliers SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

// CUSTOMERS
// ═══════════════════════════════════════
app.get('/api/customers', auth, (req, res) => {
  const { q } = req.query;
  if (q) {
    const s = `%${q}%`;
    return res.json(db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 20').all(s, s));
  }
  res.json(db.prepare('SELECT * FROM customers ORDER BY total_purchases DESC').all());
});

app.get('/api/customers/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Tapylmady' });
  const { from, to } = req.query;
  let q = `SELECT m.id,m.invoice_no,m.total,m.discount_total,m.promo_total,m.movement_date,m.notes,
    u.full_name as seller_name FROM movements m LEFT JOIN users u ON m.user_id=u.id
    WHERE m.customer_id=? AND m.type='cikis'`;
  const p = [req.params.id];
  if (from) { q += ' AND DATE(m.movement_date)>=?'; p.push(from); }
  if (to) { q += ' AND DATE(m.movement_date)<=?'; p.push(to); }
  q += ' ORDER BY m.movement_date DESC';
  const movs = db.prepare(q).all(...p).map(m => ({
    ...m,
    items: db.prepare(`SELECT product_name,qty,unit,final_price,line_total,discount_amt,is_promo
      FROM movement_items WHERE movement_id=?`).all(m.id)
  }));
  const stats = {
    total_amount: movs.reduce((s, m) => s + m.total, 0),
    total_discount: movs.reduce((s, m) => s + (m.discount_total || 0), 0),
    order_count: movs.length
  };
  res.json({ ...c, movements: movs, stats });
});

app.post('/api/customers', auth, kassaMin, (req, res) => {
  const { name, phone, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Ad gerek' });
  try {
    const r = db.prepare('INSERT INTO customers(name,phone,address,notes) VALUES(?,?,?,?)').run(
      name, phone || null, address || null, notes || null
    );
    res.json({ id: r.lastInsertRowid, success: true, customer: db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/customers/:id', auth, kassaMin, (req, res) => {
  const { name, phone, address, notes } = req.body;
  const sets = ['updated_at=CURRENT_TIMESTAMP'], vals = [];
  if (name !== undefined) { sets.push('name=?'); vals.push(name); }
  if (phone !== undefined) { sets.push('phone=?'); vals.push(phone); }
  if (address !== undefined) { sets.push('address=?'); vals.push(address); }
  if (notes !== undefined) { sets.push('notes=?'); vals.push(notes); }
  vals.push(req.params.id);
  db.prepare(`UPDATE customers SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

app.delete('/api/customers/:id', auth, adminOnly, (req, res) => {
  try {
    // Önce hareketlerinde customer_id null yap
    db.prepare('UPDATE movements SET customer_id=NULL WHERE customer_id=?').run(req.params.id);
    db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/suppliers/:id', auth, adminOnly, (req, res) => {
  try {
    db.prepare('UPDATE movements SET supplier_id=NULL WHERE supplier_id=?').run(req.params.id);
    db.prepare('DELETE FROM suppliers WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════
// MOVEMENTS
// ═══════════════════════════════════════
function getItems(movId) {
  return db.prepare(`SELECT id,product_id,product_name as name,qty,unit,unit_price,discount_amt,
    final_price,line_total,is_promo,stock_before,stock_after FROM movement_items WHERE movement_id=?`).all(movId);
}

function enrichMovs(rows) {
  return rows.map(r => ({ ...r, items: getItems(r.id) }));
}

app.get('/api/movements', auth, (req, res) => {
  const { limit = 300, type, search, from, to, invoice_date, user_id } = req.query;
  let q = `SELECT m.*, u.full_name as user_full_name, u.phone as user_phone,
    s.name as supplier_name_joined
    FROM movements m LEFT JOIN users u ON m.user_id=u.id
    LEFT JOIN suppliers s ON m.supplier_id=s.id WHERE 1=1`;
  const p = [];
  // Satici sadece kendi hareketlerini görür
  if (req.user.role === 'satici') { q += ' AND m.user_id=? AND m.type=\'cikis\''; p.push(req.user.id); }
  if (type) { q += ' AND m.type=?'; p.push(type); }
  if (from) { q += ' AND DATE(m.movement_date)>=?'; p.push(from); }
  if (to) { q += ' AND DATE(m.movement_date)<=?'; p.push(to); }
  if (invoice_date) { q += ' AND DATE(m.movement_date)=?'; p.push(invoice_date); }
  if (user_id && req.user.role !== 'satici') { q += ' AND m.user_id=?'; p.push(parseInt(user_id)); }
  q += ' ORDER BY m.movement_date DESC, m.created_at DESC LIMIT ?';
  p.push(parseInt(limit));
  let rows = enrichMovs(db.prepare(q).all(...p));
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(r =>
      r.items.some(i => i.name.toLowerCase().includes(s)) ||
      (r.customer_name || '').toLowerCase().includes(s) ||
      (r.invoice_no || '').toLowerCase().includes(s)
    );
  }
  res.json(rows);
});

app.get('/api/movements/:id', auth, (req, res) => {
  const r = db.prepare('SELECT m.*,u.full_name as user_full_name,u.phone as user_phone,s.name as supplier_name_joined FROM movements m LEFT JOIN users u ON m.user_id=u.id LEFT JOIN suppliers s ON m.supplier_id=s.id WHERE m.id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Tapylmady' });
  res.json({ ...r, items: getItems(r.id) });
});

function genInvoiceNo() {
  const y = new Date().getFullYear();
  const c = db.prepare("SELECT COUNT(*) as c FROM movements WHERE strftime('%Y',created_at)=?").get(String(y)).c;
  return `${y}-${String(c + 1).padStart(5, '0')}`;
}

// Çifte kayıt önleme
const _recentMovKeys = new Map();
function movIdempotencyKey(userId, type, items) {
  return userId+':'+type+':'+items.map(i=>i.productId+'x'+i.quantity).sort().join(',');
}

app.post('/api/movements', auth, saticiMin, (req, res) => {
  const { type, items, customer_id, customer_name, customer_phone, supplier_id, supplier_name, notes, movement_date } = req.body;
  if (!['giris', 'cikis', 'iade'].includes(type)) return res.status(400).json({ error: 'Ýalňyş görnüş' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Haryt ýok' });

  // Çifte kayıt koruması (8 saniye içinde aynı içerik)
  const ikey = movIdempotencyKey(req.user.id, type, items);
  const now = Date.now();
  if (_recentMovKeys.has(ikey) && now - _recentMovKeys.get(ikey) < 30000) {
    return res.status(429).json({ error: 'Bu amal eýýäm hasaba alyndy, gaýtadan basmak gerek däl' });
  }
  _recentMovKeys.set(ikey, now);
  setTimeout(() => _recentMovKeys.delete(ikey), 30000);

  // Satış: müşteri zorunlu
  if (type === 'cikis' && !customer_name && !customer_id) {
    return res.status(400).json({ error: 'Satuw üçin müşderi ady hökman gerek' });
  }
  // Alış: üpjünçi zorunlu
  if (type === 'giris' && !supplier_name && !supplier_id) {
    return res.status(400).json({ error: 'Satyn alyş üçin üpjünçi ady hökman gerek' });
  }

  // Satış: sadece skladcy ve kassa yapabilir
  if (type === 'cikis' && !['admin', 'kassa', 'skladcy'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Bu işlem için yetki yok' });
  }
  // Alış: sadece kassa ve admin
  if (type === 'giris' && !['admin', 'kassa'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Satyn alyş üçin kassa ýa-da admin gerek' });
  }

  // Geçmişe kayıt kontrolü (admin hariç)
  if (req.user.role !== 'admin' && movement_date) {
    const reqDate = movement_date.slice(0, 10);
    const todayStr = todayAshgabat();
    if (reqDate < todayStr) {
      return res.status(400).json({ error: 'Geçmiş güne kayıt yapılamaz. Sadece admin yapabilir.' });
    }
  }

  const txn = db.transaction(() => {
    let total = 0, discTotal = 0, promoTotal = 0;
    const enriched = [];

    items.forEach(it => {
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(it.productId);
      if (!p) throw new Error('Haryt tapylmady: ' + it.productId);

      const qty = parseFloat(it.quantity) || 0;
      const unitPrice = parseFloat(it.unit_price || it.price || p.price) || 0;
      const discAmt = parseFloat(it.discount_amt) || 0;
      const isPromo = it.is_promo ? 1 : 0;

      // Stok kontrolü (satışta)
      if (type === 'cikis' && !isPromo && p.stock < qty) {
        throw new Error(`"${p.name}" üçin ýeterlik stok ýok. Bar: ${p.stock} ${p.unit}, Gerek: ${qty}`);
      }

      const finalPrice = isPromo ? 0 : Math.max(0, unitPrice - (qty > 0 ? discAmt / qty : 0));
      const lineTotal = isPromo ? 0 : Math.max(0, unitPrice * qty - discAmt);

      const before = p.stock;
      let after = before;
      if (type === 'giris' || type === 'iade') after = before + qty;
      else after = Math.max(0, before - qty);

      db.prepare('UPDATE products SET stock=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(after, p.id);
      if (type === 'giris' && unitPrice > 0 && !isPromo) {
        db.prepare('UPDATE products SET price=? WHERE id=?').run(unitPrice, p.id);
      }

      total += lineTotal;
      discTotal += discAmt;
      if (isPromo) promoTotal += unitPrice * qty;

      enriched.push({ product_id: p.id, product_name: p.name, qty, unit: p.unit, unit_price: unitPrice, discount_amt: discAmt, final_price: finalPrice, line_total: lineTotal, is_promo: isPromo, stock_before: before, stock_after: after });
    });

    const invNo = type === 'cikis' ? genInvoiceNo() : (type === 'giris' ? `ALIŞ-${genInvoiceNo()}` : null);
    let finalSupplierId = supplier_id || null;
    if (type === 'giris' && supplier_name) {
      const ex = db.prepare('SELECT id FROM suppliers WHERE name=?').get(supplier_name);
      if (ex) {
        finalSupplierId = ex.id;
      } else {
        // Yeni üpjünçi — otomatik kaydet
        const nr = db.prepare('INSERT INTO suppliers(name) VALUES(?)').run(supplier_name);
        finalSupplierId = nr.lastInsertRowid;
      }
    }
    const movDate = movement_date || nowAshgabat();

    let finalCustId = customer_id || null;
    if (type === 'cikis' && customer_name && !customer_id) {
      const ex = db.prepare('SELECT id FROM customers WHERE name=?').get(customer_name);
      if (ex) finalCustId = ex.id;
    }

    const r = db.prepare('INSERT INTO movements(type,user_id,customer_id,customer_name,customer_phone,supplier_id,total,discount_total,promo_total,invoice_no,notes,movement_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
      type, req.user.id, finalCustId, customer_name || null, customer_phone || null,
      finalSupplierId, total, discTotal, promoTotal, invNo, notes || null, movDate
    );
    if (finalSupplierId && type === 'giris') {
      db.prepare('UPDATE suppliers SET total_purchases=total_purchases+?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(total, finalSupplierId);
    }

    if (finalCustId && type === 'cikis') {
      db.prepare('UPDATE customers SET total_purchases=total_purchases+?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(total, finalCustId);
    }

    const ins = db.prepare(`INSERT INTO movement_items(movement_id,product_id,product_name,qty,unit,unit_price,discount_amt,final_price,line_total,is_promo,stock_before,stock_after) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    enriched.forEach(e => ins.run(r.lastInsertRowid, e.product_id, e.product_name, e.qty, e.unit, e.unit_price, e.discount_amt, e.final_price, e.line_total, e.is_promo, e.stock_before, e.stock_after));

    const uRow = db.prepare('SELECT full_name, phone FROM users WHERE id=?').get(req.user.id);
    return { id: r.lastInsertRowid, total, discTotal, promoTotal, itemCount: enriched.length, invoice_no: invNo, user_full_name: uRow?.full_name||null, user_phone: uRow?.phone||null, customer_name: customer_name||null, customer_phone: customer_phone||null, movement_date: movDate, notes: notes||null, type };
  });

  let txnResult;
  try { txnResult = txn(); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  // Auto-create factory debt only for Arcalyk Zawod purchases
  if (type === 'giris' && txnResult.total > 0) {
    const supName = (req.body.supplier_name || '').trim() ||
      (supplier_id ? (db.prepare('SELECT name FROM suppliers WHERE id=?').get(supplier_id)?.name || '') : '');
    if (supName === 'Arcalyk Zawod') {
      try {
        db.prepare(`INSERT INTO factory_debts(supplier_name,description,amount,debt_date,movement_id,created_by) VALUES(?,?,?,?,?,?)`)
          .run(supName, 'Alyş fakturasy #' + txnResult.invoice_no, txnResult.total, (movement_date||'').slice(0,10)||todayAshgabat(), txnResult.id, req.user.id);
      } catch(e2) { /* non-fatal */ }
    }
  }

  res.json({ ...txnResult, success: true });
});

app.patch('/api/movements/:id', auth, kassaMin, (req, res) => {
  const { customer_name, customer_phone, customer_id, notes, items } = req.body;
  const txn = db.transaction(() => {
    const m = db.prepare('SELECT * FROM movements WHERE id=?').get(req.params.id);
    if (!m) throw new Error('Hereket tapylmady');

    // Items update - stock ayarlama
    if (Array.isArray(items)) {
      const oldItems = db.prepare('SELECT * FROM movement_items WHERE movement_id=?').all(req.params.id);
      // Önce eski kalemlerin stok etkilerini geri al
      oldItems.forEach(oi => {
        const p = db.prepare('SELECT * FROM products WHERE id=?').get(oi.product_id);
        if (p) {
          const newStock = p.stock + (m.type === 'giris' ? -oi.qty : oi.qty);
          db.prepare('UPDATE products SET stock=? WHERE id=?').run(Math.max(0, newStock), p.id);
        }
      });
      // Eski kalemleri sil
      db.prepare('DELETE FROM movement_items WHERE movement_id=?').run(req.params.id);
      // Yeni kalemleri ekle ve stok güncelle
      let subtotal = 0, discount_total = 0, promo_total = 0;
      items.forEach(it => {
        const qty = +it.qty || 0;
        const unit_price = +it.unit_price || 0;
        const discount_amt = +it.discount_amt || 0;
        const is_promo = it.is_promo ? 1 : 0;
        if (qty <= 0) return;
        const line_total = is_promo ? 0 : Math.max(0, qty * unit_price - discount_amt);
        const final_price = is_promo ? 0 : (qty > 0 ? line_total / qty : 0);

        if (is_promo) promo_total += qty * unit_price;
        else { subtotal += qty * unit_price; discount_total += discount_amt; }

        db.prepare(`INSERT INTO movement_items(movement_id,product_id,product_name,unit,qty,unit_price,discount_amt,is_promo,final_price,line_total)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
          req.params.id, it.product_id, it.product_name||'', it.unit||'sany',
          qty, unit_price, discount_amt, is_promo, final_price, line_total
        );

        // Stok güncelle
        const p = db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
        if (p) {
          const newStock = p.stock + (m.type === 'giris' ? qty : -qty);
          db.prepare('UPDATE products SET stock=? WHERE id=?').run(Math.max(0, newStock), p.id);
        }
      });
      const total = subtotal - discount_total;
      db.prepare('UPDATE movements SET discount_total=?,promo_total=?,total=? WHERE id=?')
        .run(discount_total, promo_total, total, req.params.id);

      // Müşteri toplam alış güncelle
      if (m.customer_id && m.type === 'cikis') {
        db.prepare('UPDATE customers SET total_purchases=MAX(0,total_purchases-?+?) WHERE id=?')
          .run(m.total, total, m.customer_id);
      }
    }

    // Müşteri/not bilgileri
    const sets = [], vals = [];
    if (customer_name !== undefined) { sets.push('customer_name=?'); vals.push(customer_name); }
    if (customer_phone !== undefined) { sets.push('customer_phone=?'); vals.push(customer_phone); }
    if (customer_id !== undefined) { sets.push('customer_id=?'); vals.push(customer_id); }
    if (notes !== undefined) { sets.push('notes=?'); vals.push(notes); }
    if (sets.length) {
      vals.push(req.params.id);
      db.prepare(`UPDATE movements SET ${sets.join(',')} WHERE id=?`).run(...vals);
    }
  });
  try { txn(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/movements/:id', auth, kassaMin, (req, res) => {
  const txn = db.transaction(() => {
    const m = db.prepare('SELECT * FROM movements WHERE id=?').get(req.params.id);
    if (!m) throw new Error('Tapylmady');
    const items = db.prepare('SELECT * FROM movement_items WHERE movement_id=?').all(req.params.id);
    items.forEach(it => {
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
      if (p) {
        const newStock = p.stock + (m.type === 'giris' || m.type === 'iade' ? -it.qty : it.qty);
        db.prepare('UPDATE products SET stock=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(Math.max(0, newStock), p.id);
      }
    });
    if (m.customer_id && m.type === 'cikis') {
      db.prepare('UPDATE customers SET total_purchases=MAX(0,total_purchases-?) WHERE id=?').run(m.total, m.customer_id);
    }
    db.prepare('DELETE FROM movements WHERE id=?').run(req.params.id);
  });
  try { txn(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/movements/:id/return', auth, kassaMin, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Gaýtaryş üçin haryt gerek' });
  const txn = db.transaction(() => {
    const orig = db.prepare('SELECT * FROM movements WHERE id=?').get(req.params.id);
    if (!orig || orig.type !== 'cikis') throw new Error('Ýalňyş hereket');
    let returnTotal = 0;
    const returnItems = [];
    items.forEach(ri => {
      if (!ri.qty || ri.qty <= 0) return;
      const oi = db.prepare('SELECT * FROM movement_items WHERE id=? AND movement_id=?').get(ri.movement_item_id, req.params.id);
      if (!oi || ri.qty > oi.qty) return;
      const p = db.prepare('SELECT * FROM products WHERE id=?').get(oi.product_id);
      if (!p) return;
      const before = p.stock;
      db.prepare('UPDATE products SET stock=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(before + ri.qty, p.id);
      db.prepare('UPDATE movement_items SET qty=?,line_total=? WHERE id=?').run(oi.qty - ri.qty, (oi.qty - ri.qty) * oi.final_price, oi.id);
      const lt = ri.qty * oi.final_price;
      returnTotal += lt;
      returnItems.push({ product_id: oi.product_id, product_name: oi.product_name, qty: ri.qty, unit: oi.unit, unit_price: oi.unit_price, discount_amt: 0, final_price: oi.final_price, line_total: lt, is_promo: 0, stock_before: before, stock_after: before + ri.qty });
    });
    if (!returnItems.length) throw new Error('Haryt saýlamadyňyz');
    const rem = db.prepare('SELECT * FROM movement_items WHERE movement_id=?').all(req.params.id);
    db.prepare('UPDATE movements SET total=?,partial_returned=?,returned_fully=? WHERE id=?').run(
      rem.reduce((s, i) => s + i.line_total, 0), rem.every(i => i.qty <= 0) ? 0 : 1, rem.every(i => i.qty <= 0) ? 1 : 0, req.params.id
    );
    const r = db.prepare('INSERT INTO movements(type,user_id,total,related_to,movement_date) VALUES(?,?,?,?,?)').run('iade', req.user.id, returnTotal, req.params.id, nowAshgabat());
    const ins = db.prepare(`INSERT INTO movement_items(movement_id,product_id,product_name,qty,unit,unit_price,discount_amt,final_price,line_total,is_promo,stock_before,stock_after) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    returnItems.forEach(ri => ins.run(r.lastInsertRowid, ri.product_id, ri.product_name, ri.qty, ri.unit, ri.unit_price, 0, ri.final_price, ri.line_total, 0, ri.stock_before, ri.stock_after));
    return { id: r.lastInsertRowid, total: returnTotal, itemCount: returnItems.length };
  });
  try { res.json({ ...txn(), success: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ═══════════════════════════════════════
// EMPLOYEES
// ═══════════════════════════════════════
app.get('/api/employees', auth, (req, res) => {
  const emps = db.prepare('SELECT * FROM employees ORDER BY status DESC,name').all();
  const now = new Date();

  // Helper: calculate total earned from start_date up to now across all months
  function calcTotalEarned(emp) {
    const start = new Date(emp.start_date);
    const end = emp.end_date ? new Date(emp.end_date) : now;
    let total = 0;
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const yr = cur.getFullYear(), mn = cur.getMonth();
      const dim = new Date(yr, mn + 1, 0).getDate();
      const mStart = new Date(yr, mn, 1);
      const mEnd = new Date(yr, mn, dim);
      const effStart = start > mStart ? start : mStart;
      const effEnd = end < mEnd ? end : mEnd;
      if (effStart <= effEnd) {
        const days = Math.floor((effEnd - effStart) / 86400000) + 1;
        total += (emp.monthly_salary / dim) * days;
      }
      cur = new Date(yr, mn + 1, 1);
    }
    return total;
  }

  res.json(emps.map(emp => {
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyRate = emp.monthly_salary / dim;

    // This month worked days
    let workedDays = 0;
    if (emp.status === 'active') {
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const sd = new Date(Math.max(new Date(emp.start_date), mStart));
      workedDays = Math.min(Math.floor((now - sd) / 86400000) + 1, now.getDate());
    }

    // This month earned
    const earned = dailyRate * workedDays;

    // This month paid
    const ms = now.toISOString().slice(0, 7);
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM salary_payments WHERE employee_id=? AND strftime('%Y-%m',payment_date)=?`).get(emp.id, ms).s;

    // ALL TIME: total earned vs total paid (cumulative balance)
    const totalEarned = calcTotalEarned(emp);
    const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM salary_payments WHERE employee_id=?`).get(emp.id).s;
    const cumulativeBalance = totalEarned - totalPaid; // pozitif = borç, negatif = fazla ödendi

    return { ...emp, daily_rate: dailyRate, worked_days: workedDays, earned, paid,
      balance: earned - paid,           // bu ayin balansi
      cumulative_balance: cumulativeBalance,  // tum zamanlar toplam
      total_earned: totalEarned,
      total_paid: totalPaid
    };
  }));
});

app.get('/api/employees/:id', auth, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id=?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Tapylmady' });
  const payments = db.prepare('SELECT sp.*,u.full_name as paid_by_name FROM salary_payments sp LEFT JOIN users u ON sp.paid_by=u.id WHERE sp.employee_id=? ORDER BY sp.payment_date DESC').all(req.params.id);
  const monthly = db.prepare(`SELECT strftime('%Y-%m',payment_date) m,SUM(amount) t,type FROM salary_payments WHERE employee_id=? GROUP BY m,type ORDER BY m DESC LIMIT 24`).all(req.params.id);
  res.json({ ...emp, payments, monthly });
});

app.post('/api/employees', auth, adminOnly, (req, res) => {
  const { name, phone, position, monthly_salary, start_date, notes } = req.body;
  if (!name || !start_date) return res.status(400).json({ error: 'Ad we gün gerek' });
  const r = db.prepare('INSERT INTO employees(name,phone,position,monthly_salary,start_date,notes) VALUES(?,?,?,?,?,?)').run(name, phone || null, position || null, monthly_salary || 0, start_date, notes || null);
  res.json({ id: r.lastInsertRowid, success: true });
});

app.patch('/api/employees/:id', auth, adminOnly, (req, res) => {
  const { name, phone, position, monthly_salary, start_date, end_date, status, notes } = req.body;
  const sets = [], vals = [];
  if (name !== undefined) { sets.push('name=?'); vals.push(name); }
  if (phone !== undefined) { sets.push('phone=?'); vals.push(phone); }
  if (position !== undefined) { sets.push('position=?'); vals.push(position); }
  if (monthly_salary !== undefined) { sets.push('monthly_salary=?'); vals.push(monthly_salary); }
  if (start_date !== undefined) { sets.push('start_date=?'); vals.push(start_date); }
  if (end_date !== undefined) { sets.push('end_date=?'); vals.push(end_date); }
  if (status !== undefined) { sets.push('status=?'); vals.push(status); }
  if (notes !== undefined) { sets.push('notes=?'); vals.push(notes); }
  if (!sets.length) return res.json({ success: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE employees SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ success: true });
});

app.post('/api/employees/:id/pay', auth, kassaMin, (req, res) => {
  const { amount, type, note, payment_date } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Mukdar gerek' });

  // Geçmişe kayıt kontrolü
  if (req.user.role !== 'admin' && payment_date) {
    const pd = payment_date.slice(0, 10);
    if (pd < todayAshgabat()) return res.status(400).json({ error: 'Geçmiş güne kayıt yapılamaz' });
  }

  const r = db.prepare('INSERT INTO salary_payments(employee_id,amount,type,note,paid_by,payment_date) VALUES(?,?,?,?,?,?)').run(
    req.params.id, amount, type || 'payment', note || null, req.user.id, payment_date || nowAshgabat()
  );
  res.json({ id: r.lastInsertRowid, success: true });
});

app.delete('/api/employees/:id', auth, adminOnly, (req, res) => {
  try {
    const payCount = db.prepare('SELECT COUNT(*) c FROM salary_payments WHERE employee_id=?').get(req.params.id).c;
    if (payCount > 0) {
      return res.status(400).json({ error: `Bu işgäriň ${payCount} sany töleg taryhy bar. Öçürip bolmaýar.` });
    }
    db.prepare('DELETE FROM employees WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/employees/:eid/pay/:pid', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM salary_payments WHERE id=? AND employee_id=?').run(req.params.pid, req.params.eid);
  res.json({ success: true });
});

// ═══════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════
app.get('/api/expenses', auth, (req, res) => {
  const { from, to, category_id } = req.query;
  let q = `SELECT e.*,u.full_name as user_name FROM expenses e LEFT JOIN users u ON e.user_id=u.id WHERE 1=1`;
  const p = [];
  if (from) { q += ' AND e.expense_date>=?'; p.push(from); }
  if (to) { q += ' AND e.expense_date<=?'; p.push(to); }
  if (category_id) { q += ' AND e.category_id=?'; p.push(category_id); }
  q += ' ORDER BY e.expense_date DESC,e.created_at DESC';
  res.json(db.prepare(q).all(...p));
});

app.post('/api/expenses', auth, kassaMin, (req, res) => {
  const { category_id, description, amount, expense_date } = req.body;
  if (!description || !amount) return res.status(400).json({ error: 'Beýan we mukdar gerek' });

  // Geçmişe kayıt kontrolü
  if (req.user.role !== 'admin' && expense_date) {
    if (expense_date < todayAshgabat()) return res.status(400).json({ error: 'Geçmiş güne kayıt yapılamaz' });
  }

  const cat = category_id ? db.prepare('SELECT * FROM expense_categories WHERE id=?').get(category_id) : null;
  const r = db.prepare('INSERT INTO expenses(category_id,category_name,description,amount,user_id,expense_date) VALUES(?,?,?,?,?,?)').run(
    category_id || null, cat ? cat.name : 'Beýleki', description, amount, req.user.id,
    expense_date || todayAshgabat()
  );
  res.json({ id: r.lastInsertRowid, success: true });
});

app.delete('/api/expenses/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════

// Ürün bazlı hareket raporu (admin+patron)
// ═══════════════════════════════════════
// FACTORY DEBT (Zawod Bergi)
// ═══════════════════════════════════════

// Get summary + list
app.get('/api/factory/debts', auth, patronMin, (req, res) => {
  const { from, to } = req.query;
  let debtQ = 'SELECT * FROM factory_debts ORDER BY debt_date DESC';
  let debtRows = db.prepare(debtQ).all();

  // Attach payments to each debt
  debtRows = debtRows.map(d => {
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM factory_payments WHERE debt_id=?').get(d.id).s;
    return { ...d, paid, remaining: d.amount - paid };
  });

  const payments = db.prepare(`
    SELECT fp.*, u.full_name as paid_by_name
    FROM factory_payments fp
    LEFT JOIN users u ON fp.paid_by = u.id
    ORDER BY fp.payment_date DESC
  `).all();

  const totalDebt = debtRows.reduce((s, d) => s + d.amount, 0);
  // Lump-sum payments have debt_id=NULL — must query table directly
  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM factory_payments').get().s;
  const totalRemaining = totalDebt - totalPaid;

  // Period summaries
  const td = todayAshgabat();
  const wStart = new Date(td); wStart.setDate(wStart.getDate() - wStart.getDay());
  const mStart = td.slice(0, 7) + '-01';
  const yStart = td.slice(0, 4) + '-01-01';

  function sumDebt(from, to) {
    return db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM factory_debts WHERE debt_date BETWEEN ? AND ?`).get(from, to).t;
  }
  function sumPaid(from, to) {
    return db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM factory_payments WHERE payment_date BETWEEN ? AND ?`).get(from, to).t;
  }

  res.json({
    debts: debtRows,
    payments,
    total_debt: totalDebt,
    total_paid: totalPaid,
    total_remaining: totalRemaining,
    summary: {
      today: { debt: sumDebt(td, td), paid: sumPaid(td, td) },
      week:  { debt: sumDebt(wStart.toISOString().slice(0,10), td), paid: sumPaid(wStart.toISOString().slice(0,10), td) },
      month: { debt: sumDebt(mStart, td), paid: sumPaid(mStart, td) },
      year:  { debt: sumDebt(yStart, td), paid: sumPaid(yStart, td) },
    }
  });
});

// Add manual debt
// ── Bildirim helper ─────────────────────────────────────────────
function sendNotif(message) {
  try {
    const admins = db.prepare("SELECT id FROM users WHERE role IN ('admin','patron') AND status='active'").all();
    const ins = db.prepare('INSERT INTO notifications(user_id,message) VALUES(?,?)');
    admins.forEach(u => ins.run(u.id, message));
  } catch(e) { console.error('notif err', e.message); }
  // Telegram (fire-and-forget)
  if (TG_TOKEN && TG_ADMIN) {
    fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_ADMIN, text: '🏭 ' + message, parse_mode: 'Markdown' })
    }).catch(() => {});
  }
}

app.post('/api/factory/debts', auth, patronMin, (req, res) => {
  const { supplier_name, description, amount, debt_date } = req.body;
  if (!supplier_name || !amount) return res.status(400).json({ error: 'Üpjünçi ady we mukdar gerek' });
  const r = db.prepare(`INSERT INTO factory_debts(supplier_name,description,amount,debt_date,created_by) VALUES(?,?,?,?,?)`)
    .run(supplier_name, description || '', +amount, debt_date || todayAshgabat(), req.user.id);
  const totalDebtN = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM factory_debts').get().s;
  const totalPaidN = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM factory_payments').get().s;
  const remN = totalDebtN - totalPaidN;
  sendNotif(`Zawod astatyk täzelendi\nTäze bergi: +${(+amount).toFixed(2)} TMT\nGalan bergi: *${remN.toFixed(2)} TMT*`);
  res.json({ id: r.lastInsertRowid });
});

// Delete debt (admin only)
app.delete('/api/factory/debts/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM factory_payments WHERE debt_id=?').run(req.params.id);
  db.prepare('DELETE FROM factory_debts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Make payment (lump sum against total remaining debt)
app.post('/api/factory/payments', auth, patronMin, (req, res) => {
  const { amount, note, payment_date } = req.body;
  if (!amount || +amount <= 0) return res.status(400).json({ error: 'Mukdar gerek' });
  const totalDebt = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM factory_debts').get().s;
  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM factory_payments').get().s;
  const remaining = totalDebt - totalPaid;
  if (+amount > remaining + 0.01) return res.status(400).json({ error: 'Töleg bergiden köp bolup bilmez (' + remaining.toFixed(2) + ' TMT galdy)' });
  const r = db.prepare(`INSERT INTO factory_payments(debt_id,amount,note,payment_date,paid_by) VALUES(?,?,?,?,?)`)
    .run(null, +amount, note || '', payment_date || todayAshgabat(), req.user.id);
  const remAfter = remaining - (+amount);
  sendNotif(`Zawod töleg edildi\nTöleg: ${(+amount).toFixed(2)} TMT\nGalan bergi: *${remAfter.toFixed(2)} TMT*`);
  res.json({ id: r.lastInsertRowid });
});

// ── Notifications ───────────────────────────────────────────────
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? AND is_read=0 ORDER BY created_at DESC LIMIT 20').all(req.user.id);
  res.json(rows);
});
app.post('/api/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// Delete payment (admin only)
app.delete('/api/factory/payments/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM factory_payments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════
app.get('/api/reports/products', auth, (req, res) => {
  const { from, to, product_id } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from/to gerek' });

  let q = `SELECT mi.product_id, mi.product_name,
    SUM(CASE WHEN m.type='giris' AND mi.is_promo=0 THEN mi.qty ELSE 0 END) as buy_qty,
    SUM(CASE WHEN m.type='giris' AND mi.is_promo=0 THEN mi.line_total ELSE 0 END) as buy_total,
    SUM(CASE WHEN m.type='giris' AND mi.is_promo=1 THEN mi.qty ELSE 0 END) as promo_in_qty,
    SUM(CASE WHEN m.type='cikis' AND mi.is_promo=0 THEN mi.qty ELSE 0 END) as sell_qty,
    SUM(CASE WHEN m.type='cikis' AND mi.is_promo=0 THEN mi.line_total ELSE 0 END) as sell_total,
    SUM(CASE WHEN m.type='cikis' AND mi.is_promo=1 THEN mi.qty ELSE 0 END) as promo_out_qty,
    SUM(CASE WHEN m.type='cikis' THEN mi.discount_amt ELSE 0 END) as total_discount,
    SUM(CASE WHEN m.type='iade' THEN mi.qty ELSE 0 END) as return_qty
    FROM movement_items mi JOIN movements m ON mi.movement_id=m.id
    WHERE DATE(m.movement_date) BETWEEN ? AND ?`;
  const p = [from, to];
  if (product_id) { q += ' AND mi.product_id=?'; p.push(product_id); }
  q += ' GROUP BY mi.product_id, mi.product_name ORDER BY sell_total DESC';
  const rows = db.prepare(q).all(...p);

  // Günlük satış (product_id verilmişse)
  let daily = [];
  if (product_id) {
    daily = db.prepare(`SELECT DATE(m.movement_date) d, m.type,
      SUM(mi.qty) qty, SUM(mi.line_total) total, SUM(mi.is_promo) promo_count
      FROM movement_items mi JOIN movements m ON mi.movement_id=m.id
      WHERE mi.product_id=? AND DATE(m.movement_date) BETWEEN ? AND ?
      GROUP BY d, m.type ORDER BY d DESC`).all(product_id, from, to);
  }
  res.json({ rows, daily });
});

// REPORTS
// ═══════════════════════════════════════
app.get('/api/reports/summary', auth, (req, res) => {
  const { from, to, category } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from/to gerek' });

  const sales = db.prepare(`SELECT COALESCE(SUM(total),0) t,COALESCE(SUM(discount_total),0) d,COALESCE(SUM(promo_total),0) pr,COUNT(*) c FROM movements WHERE type='cikis' AND DATE(movement_date) BETWEEN ? AND ?`).get(from, to);
  const purchases = db.prepare(`SELECT COALESCE(SUM(total),0) t,COALESCE(SUM(promo_total),0) pr,COUNT(*) c FROM movements WHERE type='giris' AND DATE(movement_date) BETWEEN ? AND ?`).get(from, to);
  const returns_ = db.prepare(`SELECT COALESCE(SUM(total),0) t,COUNT(*) c FROM movements WHERE type='iade' AND DATE(movement_date) BETWEEN ? AND ?`).get(from, to);
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) t,COUNT(*) c FROM expenses WHERE expense_date BETWEEN ? AND ?`).get(from, to);
  const advances = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM salary_payments WHERE type='advance' AND DATE(payment_date) BETWEEN ? AND ?`).get(from, to);
  const salaries = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM salary_payments WHERE type='payment' AND DATE(payment_date) BETWEEN ? AND ?`).get(from, to);
  const salaryByEmp = db.prepare(`
    SELECT e.name, e.position,
      COALESCE(SUM(CASE WHEN sp.type='payment' THEN sp.amount ELSE 0 END),0) salary,
      COALESCE(SUM(CASE WHEN sp.type='advance' THEN sp.amount ELSE 0 END),0) advance,
      COUNT(sp.id) cnt
    FROM salary_payments sp
    JOIN employees e ON sp.employee_id = e.id
    WHERE DATE(sp.payment_date) BETWEEN ? AND ?
    GROUP BY e.id, e.name, e.position
    ORDER BY (salary+advance) DESC
  `).all(from, to);

  const topProds = db.prepare(`SELECT mi.product_name,SUM(mi.qty) tq,SUM(mi.line_total) ta,COUNT(DISTINCT m.id) oc FROM movement_items mi JOIN movements m ON mi.movement_id=m.id WHERE m.type='cikis' AND mi.is_promo=0 AND DATE(m.movement_date) BETWEEN ? AND ? GROUP BY mi.product_name ORDER BY ta DESC LIMIT 10`).all(from, to);
  const expByCat = db.prepare(`SELECT category_name,COALESCE(SUM(amount),0) t FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category_name ORDER BY t DESC`).all(from, to);
  const dailySales = db.prepare(`SELECT DATE(movement_date) d,SUM(total) t,SUM(discount_total) disc,SUM(promo_total) prom FROM movements WHERE type='cikis' AND DATE(movement_date) BETWEEN ? AND ? GROUP BY d ORDER BY d DESC`).all(from, to);
  const topCusts = db.prepare(`SELECT customer_name,SUM(total) t,COUNT(*) c FROM movements WHERE type='cikis' AND customer_name IS NOT NULL AND DATE(movement_date) BETWEEN ? AND ? GROUP BY customer_name ORDER BY t DESC LIMIT 10`).all(from, to);

  res.json({
    from, to,
    sales: { total: sales.t, count: sales.c, discount: sales.d, promo: sales.pr },
    purchases: { total: purchases.t, count: purchases.c, promo: purchases.pr },
    returns: { total: returns_.t, count: returns_.c },
    expenses: { total: expenses.t, count: expenses.c },
    advances: advances.t, salaries: salaries.t, salary_by_emp: salaryByEmp,
    net_profit: sales.t - expenses.t - salaries.t - advances.t - sales.d - sales.pr,
    top_products: topProds, expense_by_category: expByCat,
    daily_sales: dailySales, top_customers: topCusts
  });
});

// ═══════════════════════════════════════
// STATS
// ═══════════════════════════════════════
app.get('/api/stats', auth, (req, res) => {
  const td = todayAshgabat();
  res.json({
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    total_value: db.prepare('SELECT COALESCE(SUM(stock*price),0) v FROM products').get().v,
    low_stock: db.prepare('SELECT COUNT(*) c FROM products WHERE stock>0 AND stock<10').get().c,
    out_stock: db.prepare('SELECT COUNT(*) c FROM products WHERE stock<=0').get().c,
    today_sales: db.prepare(`SELECT COALESCE(SUM(total),0) t FROM movements WHERE type='cikis' AND DATE(movement_date)=?`).get(td).t,
    today_discount: db.prepare(`SELECT COALESCE(SUM(discount_total),0) t FROM movements WHERE type='cikis' AND DATE(movement_date)=?`).get(td).t,
    today_expenses: db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE expense_date=?`).get(td).t,
    today_movements: db.prepare(`SELECT COUNT(*) c FROM movements WHERE DATE(movement_date)=?`).get(td).c,
    active_employees: db.prepare(`SELECT COUNT(*) c FROM employees WHERE status='active'`).get().c,
    customer_count: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
    ai_enabled: !!anthropic,
    company_name: COMPANY_NAME,
    company_address: COMPANY_ADDRESS,
    company_phone: COMPANY_PHONE,
    today: td,
    telegram_ok: !!(TG_TOKEN && TG_ADMIN)
  });
});

// ═══════════════════════════════════════
// TELEGRAM
// ═══════════════════════════════════════
// Manuel yedekleme endpoint'i
app.post('/api/telegram/backup', auth, adminOnly, async (req, res) => {
  try {
    await sendTelegramBackup();
    res.json({ success: true, message: 'Ýedek Telegram-a ugradyldy' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Telegram bot info
app.get('/api/telegram/info', auth, adminOnly, (req, res) => {
  res.json({
    configured: !!(TG_TOKEN && TG_ADMIN),
    admin_id: TG_ADMIN,
    bot_link: TG_TOKEN ? `https://t.me/${TG_TOKEN.split(':')[0]}` : null
  });
});

// Update telegram settings in .env
app.post('/api/telegram/settings', auth, adminOnly, (req, res) => {
  const { bot_token, admin_id } = req.body;
  const envPath = path.join(__dirname, '.env');
  try {
    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf8'); } catch { envContent = ''; }
    function setEnvVar(content, key, value) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      return regex.test(content) ? content.replace(regex, line) : content + '\n' + line;
    }
    if (bot_token !== undefined) envContent = setEnvVar(envContent, 'TELEGRAM_BOT_TOKEN', bot_token);
    if (admin_id  !== undefined) envContent = setEnvVar(envContent, 'TELEGRAM_ADMIN_ID',  admin_id);
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    res.json({ success: true, message: 'Sazlamalar ýazyldy. Ulgamy täzeden başlatmak gerek.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Restart service (systemd only)
app.post('/api/system/restart', auth, adminOnly, (req, res) => {
  res.json({ success: true, message: 'Ulgam täzeden başlaýar...' });
  setTimeout(() => {
    exec('systemctl restart anbar', (err) => {
      if (err) {
        // systemd yoksa process.exit ile yeniden başlat (PM2/nodemon yakalar)
        process.exit(0);
      }
    });
  }, 500);
});
// ═══════════════════════════════════════
app.post('/api/ocr/analyze', auth, kassaMin, upload.single('image'), async (req, res) => {
  if (!anthropic) return res.status(500).json({ error: 'AI aktif däl. ANTHROPIC_API_KEY gerek.' });
  if (!req.file) return res.status(400).json({ error: 'Surat gerek' });
  try {
    const products = db.prepare('SELECT id,name,unit,price FROM products ORDER BY name').all();
    const productList = products.map(p => `ID:${p.id}|"${p.name}"(${p.unit},${p.price})`).join('\n');
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5', max_tokens: 4096,
      system: `Türkmen depo sistemi üçin faktura analizçisi.\nSİSTEMDEKİ ÜRÜNLER:\n${productList}\n\nKURALLAR:\n1. Her satırdan: ürün adı, miktar, birim fiyat, toplamı çıkar\n2. parseInt(product_id) ile eşleştir\n3. PROMA satırları: is_promo:true yap ve ANA ÜRÜNLE eşleştir — BOYUTU DA EŞLEŞTİR (PROMO KOLA 0.5 LT → Kola 0.5 L, PROMO KOLA 1.5 L → 1.5 L Kola, PROMO SUW 1.5 L → Arassa suw 1.5 L), fiyat=0\n4. PROMO sistemdeki ürünle eşleşirse matched_products içine koy (is_promo:true), new_products içine KOYMA\n5. 0.5L ve 1.5L FARKLI ÜRÜNLER — boyutu kesinlikle eşleştir\n6. 1,330=1330 (binlik), 19,80=19.80 (ondalık)\n7. SADECE JSON dön\n\nFORMAT: {"matched_products":[{"product_id":1,"quantity":1330,"price":19.80,"line_total":26334,"is_promo":false}],"new_products":[{"name":"Ad","quantity":5,"price":0,"unit":"BL","is_promo":false}],"invoice_total":96939,"invoice_date":"02.05.2026","notes":""}`,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: req.file.mimetype || 'image/jpeg', data: req.file.buffer.toString('base64') } },
        { type: 'text', text: 'Analiz et. Sadece JSON.' }
      ]}]
    });
    let txt = msg.content[0].text.trim();
    const m = txt.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (m) txt = m[1];
    else { const s = txt.indexOf('{'), e = txt.lastIndexOf('}'); if (s >= 0 && e > s) txt = txt.slice(s, e + 1); }
    let parsed;
    try { parsed = JSON.parse(txt); }
    catch { return res.status(500).json({ error: 'AI cevabı işlenemedi', raw: txt.slice(0, 300) }); }
    const matched = (parsed.matched_products || []).map(m => {
      const pid = parseInt(m.product_id);
      const p = products.find(x => x.id === pid);
      if (!p) return null;
      const stk = db.prepare('SELECT stock FROM products WHERE id=?').get(p.id);
      return { ...m, product_id: p.id, name: p.name, unit: p.unit, currentStock: stk?.stock || 0 };
    }).filter(Boolean);
    res.json({ success: true, matched_products: matched, new_products: parsed.new_products || [], invoice_total: parsed.invoice_total || null, invoice_date: parsed.invoice_date || null, notes: parsed.notes || null });
  } catch (err) {
    res.status(500).json({ error: 'Surat seljerilmedi: ' + err.message });
  }
});

app.get('/api/health', (req, res) => res.json({
  status: 'ok', time: new Date().toISOString(), ai: !!anthropic,
  telegram: !!(TG_TOKEN && TG_ADMIN), company: COMPANY_NAME, tz: process.env.TZ
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\nAnbar Ulgamy v5: http://localhost:${PORT}`);
  console.log(`AI: ${anthropic ? '✓' : '✗'} | Telegram: ${TG_TOKEN && TG_ADMIN ? '✓' : '✗'} | TZ: ${process.env.TZ}`);
});
