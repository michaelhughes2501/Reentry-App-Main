const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;
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

// Init DB
const dbPath = path.join(__dirname, 'reentry.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

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

// --- AUTH ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, location, release_date } = req.body;
    const name = req.body.name || req.body.displayName; // Handle both naming conventions
    if (!name || !email || !password) return res.status(400).json({ error: 'Registration failed: name, email, and password are all required.' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name, email, password_hash, location, release_date) VALUES (?, ?, ?, ?, ?)').run(name, email, hash, location || null, release_date || null);
    const user = { id: result.lastInsertRowid, name, email, location };
    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Login failed: Email and password are required.' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, location: user.location } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- RESOURCES ---
app.get('/api/resources', (req, res) => {
  const { category } = req.query;
  let rows;
  if (category) {
    rows = db.prepare('SELECT * FROM resources WHERE category = ? ORDER BY title').all(category);
  } else {
    rows = db.prepare('SELECT * FROM resources ORDER BY category, title').all();
  }
  res.json(rows);
});

// --- JOBS ---
app.get('/api/jobs', (req, res) => {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/jobs', (req, res) => {
  try {
    const { title, company, description, location, salary, felon_friendly } = req.body;
    if (!title || !company) return res.status(400).json({ error: 'Title and company required' });
    const result = db.prepare('INSERT INTO jobs (title, company, description, location, salary, felon_friendly) VALUES (?, ?, ?, ?, ?, ?)').run(title, company, description || '', location || '', salary || '', felon_friendly !== false ? 1 : 0);
    res.json({ id: result.lastInsertRowid, title, company, description, location, salary, felon_friendly: felon_friendly !== false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- HOUSING ---
app.get('/api/housing', (req, res) => {
  const rows = db.prepare('SELECT * FROM housing ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/housing', (req, res) => {
  try {
    const { title, address, city, rent, description, contact, felon_friendly } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const result = db.prepare('INSERT INTO housing (title, address, city, rent, description, contact, felon_friendly) VALUES (?, ?, ?, ?, ?, ?, ?)').run(title, address || '', city || '', rent || 0, description || '', contact || '', felon_friendly !== false ? 1 : 0);
    res.json({ id: result.lastInsertRowid, title, address, city, rent, description, contact });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    const { content, category } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });
    const result = db.prepare('INSERT INTO community_posts (content, category, user_id) VALUES (?, ?, ?)').run(content, category || 'general', req.user.id);
    const post = db.prepare('SELECT cp.*, u.name as username FROM community_posts cp LEFT JOIN users u ON cp.user_id = u.id WHERE cp.id = ?').get(result.lastInsertRowid);
    res.json(post || { id: result.lastInsertRowid, content, category: category || 'general' });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    const { location, notes } = req.body;
    db.prepare('INSERT INTO roll_calls (user_id, check_in_date, location, notes) VALUES (?, ?, ?, ?)').run(req.user.id, today, location || '', notes || '');
    res.json({ success: true, date: today, message: 'Check-in recorded!' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  sendError(req, res, 400, 'VALIDATION_ERROR', 'Please review the highlighted fields and try again.', {
    fields: errors.array().map((error) => ({
      field: error.path,
      message: error.msg
    }))
  });
}

function createApp(dbClient = supabase) {
  const app = express();

  // Middleware to verify Supabase JWT
  const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(req, res, 401, 'UNAUTHORIZED', 'Bearer token required.');
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await dbClient.auth.getUser(token);

    if (error || !user) {
      return sendError(req, res, 401, 'UNAUTHORIZED', 'Session invalid or expired.');
    }

    req.user = user; // Attach user to request for use in routes
    next();
  };

  app.use((req, res, next) => {
    req.requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  }));

  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    optionsSuccessStatus: 204
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(hpp());

  const limiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  });

  // Apply authentication and rate limiting to all /api routes
  app.use('/api', authenticate, limiter);
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/status', (req, res) => {
    sendSuccess(req, res, {
      status: 'secure',
      app: 'ReentryApp',
      environment: process.env.NODE_ENV || 'development',
      modules: ['The Yard', 'Kites', 'Roll Call', 'Commissary', 'Mail Room']
    });
  });

  app.get('/api/community', async (req, res) => {
    // Example: Fetching residents from Supabase 'participants' table
    const { data: residents, error } = await dbClient
      .from('participants')
      .select('*');

    if (error) {
      return sendError(req, res, 500, 'DATABASE_ERROR', error.message);
    }

    sendSuccess(req, res, {
      displayArea: 'The Yard',
      residents: residents || [],
      leaderboard: (residents || [])
        .sort((a, b) => (b.goodTimeCredits || 0) - (a.goodTimeCredits || 0)),
      activeBlocks: [
        { id: 'block-housing', name: 'Housing Readiness', residentCount: 18 },
        { id: 'block-work', name: 'Work Detail Prep', residentCount: 24 },
        { id: 'block-wellness', name: 'Rec Yard Reset', residentCount: 16 }
      ]
    });
  });

  app.get('/api/resources', async (req, res) => {
    const { data, error } = await dbClient
      .from('resources')
      .select('*');

    if (error) {
      return sendError(req, res, 500, 'DATABASE_ERROR', error.message);
    }

    sendSuccess(req, res, {
      displayArea: 'Commissary',
      resources: data || []
    });
  });

  app.get('/api/moderation/queue', async (req, res) => {
    const { data, error } = await dbClient
      .from('moderation_queue')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) {
      return sendError(req, res, 500, 'DATABASE_ERROR', error.message);
    }

    sendSuccess(req, res, {
      displayArea: 'Mail Room',
      pendingCount: (data || []).filter((item) => item.status === 'pending').length,
      items: data || []
    });
  });

  app.put(
    '/api/moderation/queue/:id',
    [
      body('status').isIn(['approved', 'rejected']).withMessage('Status must be approved or rejected.')
    ],
    validateRequest,
    async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      const { data, error } = await dbClient
        .from('moderation_queue')
        .update({ status })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return sendError(req, res, 500, 'DATABASE_ERROR', error.message);
      }

      if (!data) return sendError(req, res, 404, 'NOT_FOUND', 'Moderation item not found.');

      sendSuccess(req, res, data);
    }
  );

  app.get('/api/roll-call', async (req, res) => {
    const { data, error } = await dbClient
      .from('roll_call_log')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(5);

    if (error) return sendError(req, res, 500, 'DATABASE_ERROR', error.message);

    sendSuccess(req, res, {
      displayArea: 'Roll Call',
      latest: data || []
    });
  });

  app.post(
    '/api/roll-call',
    [
      body('participantId').isString().trim().notEmpty().withMessage('Resident selection is required.'),
      body('wellnessStatus').isIn(['steady', 'needs_support', 'urgent']).withMessage('Choose a current status.'),
      body('supportNeed').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }).withMessage('Keep support notes under 500 characters.')
    ],
    validateRequest,
    async (req, res) => {
      const { data: resident, error: checkError } = await dbClient
        .from('participants')
        .select('id')
        .eq('id', req.body.participantId)
        .single();

      if (checkError || !resident) {
        sendError(req, res, 404, 'RESIDENT_NOT_FOUND', 'That Resident could not be found.', {
          participantId: req.body.participantId
        });
        return;
      }

      const entry = {
        id: crypto.randomUUID(),
        participantId: resident.id,
        wellnessStatus: req.body.wellnessStatus,
        supportNeed: req.body.supportNeed || '',
        createdAt: new Date().toISOString()
      };

      const { error: insertError } = await dbClient.from('roll_call_log').insert(entry);

      if (insertError) {
        return sendError(req, res, 500, 'DATABASE_ERROR', insertError.message);
      }

      sendSuccess(req, res, entry, 201);
    }
  );

  app.post(
    '/api/messages',
    [
      body('senderId').isString().trim().notEmpty().withMessage('Sender is required.'),
      body('recipientId').isString().trim().notEmpty().withMessage('Recipient is required.'),
      body('body').isString().trim().isLength({ min: 1, max: 1000 }).withMessage('Kites must be 1 to 1000 characters.')
    ],
    validateRequest,
    async (req, res) => {
      const { data: actors, error: actorsError } = await dbClient
        .from('participants')
        .select('id')
        .in('id', [req.body.senderId, req.body.recipientId]);

      const sender = actors?.find(a => a.id === req.body.senderId);
      const recipient = actors?.find(a => a.id === req.body.recipientId);

      if (!sender || !recipient) {
        sendError(req, res, 404, 'RESIDENT_NOT_FOUND', 'Sender or recipient could not be found.', {
          senderId: req.body.senderId,
          recipientId: req.body.recipientId
        });
        return;
      }

      const scan = moderationScan(req.body.body);
      const message = {
        id: crypto.randomUUID(),
        senderId: sender.id,
        recipientId: recipient.id,
        body: req.body.body,
        moderation: scan,
        deliveryStatus: scan.action === 'allow' ? 'approved' : 'mail_room',
        createdAt: new Date().toISOString()
      };

      const { error: msgError } = await dbClient.from('messages').insert(message);
      if (msgError) {
        return sendError(req, res, 500, 'DATABASE_ERROR', msgError.message);
      }

      if (scan.action === 'requires_review') {
        const { error: revError } = await dbClient.from('moderation_queue').insert({
          id: crypto.randomUUID(),
          sourceType: 'message',
          submittedBy: sender.id,
          riskScore: scan.riskScore,
          status: 'pending',
          displayArea: 'Mail Room',
          reason: 'Automated Shakedown requested staff review.'
        });
      }

      sendSuccess(req, res, message, 201);
    }
  );

  app.get('/api/messages', async (req, res) => {
    const { data, error } = await dbClient
      .from('messages')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) return sendError(req, res, 500, 'DATABASE_ERROR', error.message);

    sendSuccess(req, res, {
      displayArea: 'Kites',
      messages: data || []
    });
  });

  app.use('/api', (req, res) => {
    sendError(req, res, 404, 'NOT_FOUND', 'That API route is not available.');
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
// SPA fallback — Express 5 / path-to-regexp v8 rejects the bare '*' string;
// use a RegExp catch-all instead.
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ReentryApp running on http://localhost:${PORT}`);
});

export default app;
