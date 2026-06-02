const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const hpp = require('hpp');
const path = require('path');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const appVersion = 'v1';

const participants = [
  {
    id: 'res-101',
    displayName: 'Marcus J.',
    cohortName: 'North Unit',
    tier: 4,
    status: 'online',
    programGoal: 'Stable housing and peer mentorship',
    interests: ['housing', 'peer support', 'job readiness'],
    goodTimeCredits: 184,
    caseManagerName: 'PO Ellis',
    compatibilityNote: 'Shared focus on housing stability and steady check-ins.'
  },
  {
    id: 'res-204',
    displayName: 'Tanya R.',
    cohortName: 'East Unit',
    tier: 3,
    status: 'in_roll_call',
    programGoal: 'Family reunification and employment',
    interests: ['family', 'work detail', 'transportation'],
    goodTimeCredits: 142,
    caseManagerName: 'PO Rivera',
    compatibilityNote: 'Similar reentry goals and strong Roll Call consistency.'
  },
  {
    id: 'res-319',
    displayName: 'Devon K.',
    cohortName: 'South Unit',
    tier: 5,
    status: 'available',
    programGoal: 'Education plan and wellness routine',
    interests: ['law library', 'rec yard', 'education'],
    goodTimeCredits: 221,
    caseManagerName: 'PO Shah',
    compatibilityNote: 'Aligned learning goals and positive group participation.'
  }
];

const resources = [
  {
    id: 'resource-01',
    title: 'Housing appointment checklist',
    category: 'Commissary',
    displayArea: 'Commissary',
    format: 'PDF',
    savedCount: 38
  },
  {
    id: 'resource-02',
    title: 'Resume clinic sign-up',
    category: 'Employment',
    displayArea: 'Work Detail',
    format: 'Form',
    savedCount: 27
  },
  {
    id: 'resource-03',
    title: 'Record relief intake guide',
    category: 'Legal',
    displayArea: 'Law Library',
    format: 'Article',
    savedCount: 19
  },
  {
    id: 'resource-04',
    title: 'Grounding practice audio',
    category: 'Wellness',
    displayArea: 'Rec Yard',
    format: 'Audio',
    savedCount: 44
  }
];

const moderationQueue = [
  {
    id: 'review-701',
    sourceType: 'message',
    submittedBy: 'res-101',
    riskScore: 42,
    status: 'pending',
    displayArea: 'Mail Room',
    reason: 'Needs staff review before delivery.'
  }
];

const rollCallLog = [
  {
    id: 'roll-001',
    participantId: 'res-204',
    wellnessStatus: 'steady',
    supportNeed: 'transportation reminder',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString()
  }
];

const messages = [];

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

function createApp() {
  const app = express();

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

  app.use('/api', limiter);
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/status', (req, res) => {
    sendSuccess(req, res, {
      status: 'secure',
      app: 'ReentryApp',
      environment: process.env.NODE_ENV || 'development',
      modules: ['The Yard', 'Kites', 'Roll Call', 'Commissary', 'Mail Room']
    });
  });

  app.get('/api/community', (req, res) => {
    sendSuccess(req, res, {
      displayArea: 'The Yard',
      residents: participants,
      leaderboard: participants
        .map(({ id, displayName, goodTimeCredits }) => ({ id, displayName, goodTimeCredits }))
        .sort((a, b) => b.goodTimeCredits - a.goodTimeCredits),
      activeBlocks: [
        { id: 'block-housing', name: 'Housing Readiness', residentCount: 18 },
        { id: 'block-work', name: 'Work Detail Prep', residentCount: 24 },
        { id: 'block-wellness', name: 'Rec Yard Reset', residentCount: 16 }
      ]
    });
  });

  app.get('/api/resources', (req, res) => {
    sendSuccess(req, res, {
      displayArea: 'Commissary',
      resources
    });
  });

  app.get('/api/moderation/queue', (req, res) => {
    sendSuccess(req, res, {
      displayArea: 'Mail Room',
      pendingCount: moderationQueue.filter((item) => item.status === 'pending').length,
      items: moderationQueue
    });
  });

  app.get('/api/roll-call', (req, res) => {
    sendSuccess(req, res, {
      displayArea: 'Roll Call',
      latest: rollCallLog.slice(-5).reverse()
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
    (req, res) => {
      const resident = participants.find((participant) => participant.id === req.body.participantId);
      if (!resident) {
        sendError(req, res, 404, 'RESIDENT_NOT_FOUND', 'That Resident could not be found.', {
          participantId: req.body.participantId
        });
        return;
      }

      const entry = {
        id: `roll-${Date.now()}`,
        participantId: resident.id,
        wellnessStatus: req.body.wellnessStatus,
        supportNeed: req.body.supportNeed || '',
        createdAt: new Date().toISOString()
      };

      rollCallLog.push(entry);
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
    (req, res) => {
      const sender = participants.find((participant) => participant.id === req.body.senderId);
      const recipient = participants.find((participant) => participant.id === req.body.recipientId);

      if (!sender || !recipient) {
        sendError(req, res, 404, 'RESIDENT_NOT_FOUND', 'Sender or recipient could not be found.', {
          senderId: req.body.senderId,
          recipientId: req.body.recipientId
        });
        return;
      }

      const scan = moderationScan(req.body.body);
      const message = {
        id: `kite-${Date.now()}`,
        senderId: sender.id,
        recipientId: recipient.id,
        body: req.body.body,
        moderation: scan,
        deliveryStatus: scan.action === 'allow' ? 'approved' : 'mail_room',
        createdAt: new Date().toISOString()
      };

      messages.push(message);

      if (scan.action === 'requires_review') {
        moderationQueue.push({
          id: `review-${Date.now()}`,
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

  app.get('/api/messages', (req, res) => {
    sendSuccess(req, res, {
      displayArea: 'Kites',
      messages
    });
  });

  app.use('/api', (req, res) => {
    sendError(req, res, 404, 'NOT_FOUND', 'That API route is not available.');
  });

  app.get('*', (req, res) => {
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
