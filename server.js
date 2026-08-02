import express from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath, pathToFileURL } from 'url';

// ESM has no __dirname — derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Require JWT_SECRET in production to prevent use of an insecure default.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable must be set in production.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || 'reentry-app-dev-secret-2024';

// Middleware to log requests - this will help you see if the frontend hits /register instead of /login
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use(helmet());
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Init DB. DB_PATH lets tests use an in-memory database (':memory:').
const dbPath = process.env.DB_PATH || path.join(__dirname, 'reentry.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    location TEXT,
    parole_status TEXT DEFAULT 'active',
    release_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    phone TEXT,
    website TEXT,
    address TEXT,
    city TEXT
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    description TEXT,
    location TEXT,
    salary TEXT,
    felon_friendly INTEGER DEFAULT 1,
    posted_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS housing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    address TEXT,
    city TEXT,
    rent INTEGER,
    description TEXT,
    felon_friendly INTEGER DEFAULT 1,
    contact TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS community_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    likes INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS roll_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    check_in_date TEXT NOT NULL,
    location TEXT,
    notes TEXT,
    status TEXT DEFAULT 'checked_in',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, check_in_date)
  );
`);

// Seed resources if empty
const resCount = db.prepare('SELECT COUNT(*) as c FROM resources').get();
if (resCount.c === 0) {
  const insertRes = db.prepare('INSERT INTO resources (title, category, description, phone, website, city) VALUES (?, ?, ?, ?, ?, ?)');
  [
    ['Reentry Council', 'Legal', 'Free legal aid for formerly incarcerated', '1-800-555-0101', 'reentrycouncil.org', 'Nationwide'],
    ['Second Chance Jobs', 'Employment', 'Job placement for felons', '1-800-555-0102', 'secondchancejobs.org', 'Nationwide'],
    ['Fresh Start Housing', 'Housing', 'Transitional housing assistance', '1-800-555-0103', 'freshstarthousing.org', 'Nationwide'],
    ['Recovery Center', 'Mental Health', 'Counseling and support groups', '1-800-555-0104', 'recoverycenters.org', 'Nationwide'],
    ['GED + Skills Training', 'Education', 'Free education programs', '1-800-555-0105', 'adultlearning.org', 'Nationwide'],
    ['Food Bank Network', 'Food', 'Emergency food assistance', '1-800-555-0106', 'foodbank.org', 'Nationwide'],
  ].forEach(r => insertRes.run(...r));
}

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Input validation helpers
const MAX_STRING = 500;
const MAX_CONTENT = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeStr(val, maxLen = MAX_STRING) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function validEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim()) && email.trim().length <= 254;
}

// --- AUTH ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const email = sanitizeStr(req.body.email, 254);
    const password = req.body.password;
    const name = sanitizeStr(req.body.name || req.body.displayName);
    const location = sanitizeStr(req.body.location);
    const release_date = sanitizeStr(req.body.release_date, 10);

    if (!name || !email || !password) return res.status(400).json({ error: 'Registration failed: name, email, and password are all required.' });
    if (!validEmail(email)) return res.status(400).json({ error: 'Invalid email format.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name, email, password_hash, location, release_date) VALUES (?, ?, ?, ?, ?)').run(name, email, hash, location || null, release_date || null);
    const user = { id: result.lastInsertRowid, name, email, location };
    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = sanitizeStr(req.body.email, 254);
    const password = req.body.password;
    if (!email || !password) return res.status(400).json({ error: 'Login failed: Email and password are required.' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, location: user.location } });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- RESOURCES ---
app.get('/api/resources', (req, res) => {
  const { category } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  let rows;
  if (category) {
    rows = db.prepare('SELECT * FROM resources WHERE category = ? ORDER BY title LIMIT ? OFFSET ?').all(category, limit, offset);
  } else {
    rows = db.prepare('SELECT * FROM resources ORDER BY category, title LIMIT ? OFFSET ?').all(limit, offset);
  }
  res.json(rows);
});

// --- JOBS ---
app.get('/api/jobs', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json(rows);
});

app.post('/api/jobs', auth, (req, res) => {
  try {
    const title = sanitizeStr(req.body.title);
    const company = sanitizeStr(req.body.company);
    const description = sanitizeStr(req.body.description, MAX_CONTENT);
    const location = sanitizeStr(req.body.location);
    const salary = sanitizeStr(req.body.salary);
    const felon_friendly = req.body.felon_friendly;
    if (!title || !company) return res.status(400).json({ error: 'Title and company required' });
    const result = db.prepare('INSERT INTO jobs (title, company, description, location, salary, felon_friendly, posted_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(title, company, description, location, salary, felon_friendly !== false ? 1 : 0, req.user.id);
    res.json({ id: result.lastInsertRowid, title, company, description, location, salary, felon_friendly: felon_friendly !== false });
  } catch (e) {
    console.error('Create job error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- HOUSING ---
app.get('/api/housing', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const rows = db.prepare('SELECT * FROM housing ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json(rows);
});

app.post('/api/housing', auth, (req, res) => {
  try {
    const title = sanitizeStr(req.body.title);
    const address = sanitizeStr(req.body.address);
    const city = sanitizeStr(req.body.city);
    const rent = Math.max(0, parseInt(req.body.rent, 10) || 0);
    const description = sanitizeStr(req.body.description, MAX_CONTENT);
    const contact = sanitizeStr(req.body.contact);
    const felon_friendly = req.body.felon_friendly;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const result = db.prepare('INSERT INTO housing (title, address, city, rent, description, contact, felon_friendly) VALUES (?, ?, ?, ?, ?, ?, ?)').run(title, address, city, rent, description, contact, felon_friendly !== false ? 1 : 0);
    res.json({ id: result.lastInsertRowid, title, address, city, rent, description, contact });
  } catch (e) {
    console.error('Create housing error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- COMMUNITY ---
app.get('/api/community', (req, res) => {
  const rows = db.prepare(`
    SELECT cp.*, u.name as username, u.name as author_name, u.name as "displayName"
    FROM community_posts cp
    LEFT JOIN users u ON cp.user_id = u.id
    ORDER BY cp.created_at DESC
    LIMIT 50
  `).all();
  res.json(rows);
});

app.post('/api/community', auth, (req, res) => {
  try {
    const content = sanitizeStr(req.body.content, MAX_CONTENT);
    const category = sanitizeStr(req.body.category) || 'general';
    if (!content) return res.status(400).json({ error: 'Content required' });
    const result = db.prepare('INSERT INTO community_posts (content, category, user_id) VALUES (?, ?, ?)').run(content, category, req.user.id);
    const post = db.prepare('SELECT cp.*, u.name as username FROM community_posts cp LEFT JOIN users u ON cp.user_id = u.id WHERE cp.id = ?').get(result.lastInsertRowid);
    res.json(post || { id: result.lastInsertRowid, content, category });
  } catch (e) {
    console.error('Create community post error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- ROLL CALL ---
app.get('/api/rollcall', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM roll_calls WHERE user_id = ? ORDER BY check_in_date DESC LIMIT 30').all(req.user.id);
  res.json(rows);
});

app.post('/api/rollcall', auth, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const existing = db.prepare('SELECT id FROM roll_calls WHERE user_id = ? AND check_in_date = ?').get(req.user.id, today);
    if (existing) return res.status(409).json({ error: 'Already checked in today', date: today });
    const location = sanitizeStr(req.body.location);
    const notes = sanitizeStr(req.body.notes, MAX_CONTENT);
    db.prepare('INSERT INTO roll_calls (user_id, check_in_date, location, notes) VALUES (?, ?, ?, ?)').run(req.user.id, today, location, notes);
    res.json({ success: true, date: today, message: 'Check-in recorded!' });
  } catch (e) {
    console.error('Roll call error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unmatched /api routes return JSON 404 (not the SPA shell).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// SPA fallback — serve index.html for any non-API GET. Express 5 / path-to-regexp
// v8 rejects the bare '*' string, so match with a RegExp catch-all.
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Boot only when run directly (`node server.js`), not when imported by tests.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  app.listen(PORT, () => {
    console.log(`ReentryApp running on http://localhost:${PORT}`);
  });
}

export default app;
