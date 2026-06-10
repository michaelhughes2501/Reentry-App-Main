require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const hpp = require('hpp');
const path = require('path');
const { body, validationResult } = require('express-validator');
const { createClient } = require('@supabase/supabase-js');

const appVersion = 'v1';

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn('WARNING: SUPABASE_URL or SUPABASE_ANON_KEY is missing from .env');
}

// Initialize default Supabase client with placeholders if env vars are missing to prevent crash during testing
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

function createMeta(req) {
  return {
    request_id: req.requestId,
    timestamp: new Date().toISOString(),
    version: appVersion
  };
}

function sendSuccess(req, res, data, status = 200) {
  res.status(status).json({
    success: true,
    data,
    meta: createMeta(req),
    error: null
  });
}

function sendError(req, res, status, code, message, details = {}) {
  res.status(status).json({
    success: false,
    data: null,
    meta: createMeta(req),
    error: {
      code,
      message,
      details
    }
  });
}

function moderationScan(text) {
  const lowered = text.toLowerCase();
  const categories = [];
  let score = 8;

  const checks = [
    { category: 'self_harm', terms: ['suicide', 'self harm', 'kill myself'], score: 90 },
    { category: 'violence', terms: ['hurt them', 'attack', 'weapon'], score: 82 },
    { category: 'prohibited_content', terms: ['contraband', 'escape plan', 'illegal deal'], score: 76 },
    { category: 'harassment', terms: ['threaten', 'stalk', 'payback'], score: 62 }
  ];

  for (const check of checks) {
    if (check.terms.some((term) => lowered.includes(term))) {
      categories.push(check.category);
      score = Math.max(score, check.score);
    }
  }

  if (text.length > 800) {
    score = Math.max(score, 35);
    categories.push('long_message_review');
  }

  return {
    riskScore: Math.min(score, 100),
    flaggedCategories: [...new Set(categories)],
    confidence: categories.length ? 0.86 : 0.74,
    action: score >= 60 ? 'requires_review' : 'allow'
  };
}

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    next();
    return;
  }

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

  app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = { createApp, moderationScan };
