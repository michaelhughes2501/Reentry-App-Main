const { createApp, moderationScan } = require('../server')

describe('moderationScan', () => {
  it('returns low risk for benign message', () => {
    const result = moderationScan('Hello, how are you doing today?')
    expect(result.riskScore).toBeLessThan(60)
    expect(result.action).toBe('allow')
  })

  it('flags self-harm content', () => {
    const result = moderationScan('I want to kill myself')
    expect(result.riskScore).toBeGreaterThanOrEqual(60)
    expect(result.action).toBe('requires_review')
    expect(result.flaggedCategories).toContain('self_harm')
  })

  it('flags violence content', () => {
    const result = moderationScan('I will attack them with a weapon')
    expect(result.riskScore).toBeGreaterThanOrEqual(60)
    expect(result.action).toBe('requires_review')
  })
})

describe('API routes', () => {
  let app, request

  // Define a mock Supabase client
  const mockSupabase = {
    auth: {
      getUser: (token) => {
        if (token === 'valid-token') {
          return Promise.resolve({ data: { user: { id: 'test-user-uuid' } }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'Invalid token' } });
      }
    },
    from: (table) => {
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: () => chain,
        single: () => Promise.resolve({ data: { id: 'review-701', status: 'approved' }, error: null }),
        in: () => chain,
        update: () => chain,
        insert: () => Promise.resolve({ error: null }),
        then: (onSuccess) => onSuccess({
          data: table === 'moderation_queue'
            ? [
                { id: 'rev-1', status: 'pending', sourceType: 'message', reason: 'Flagged word' },
                { id: 'rev-2', status: 'approved', sourceType: 'message', reason: 'Manual review' },
                { id: 'rev-3', status: 'pending', sourceType: 'message', reason: 'High risk score' }
              ]
            : [
                { id: 'res-101', displayName: 'Marcus J.', goodTimeCredits: 184 },
                { id: 'res-204', displayName: 'Tanya R.', goodTimeCredits: 142 },
                { id: 'res-319', displayName: 'Devon K.', goodTimeCredits: 221 }
              ],
          error: null
        })
      };
      return chain;
    }
  };

  beforeAll(() => {
    app = createApp(mockSupabase)
    request = require('supertest')(app)
  })

  it('GET /api/status returns 200', async () => {
    const res = await request.get('/api/status').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.app).toBe('ReentryApp')
  })

  it('GET /api/status returns 401 without token', async () => {
    const res = await request.get('/api/status')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('GET /api/community returns residents', async () => {
    const res = await request.get('/api/community').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
    expect(res.body.data.residents).toHaveLength(3)
  })

  it('GET /api/moderation/queue returns the current queue', async () => {
    const res = await request.get('/api/moderation/queue').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.displayArea).toBe('Mail Room')
    expect(res.body.data).toHaveProperty('pendingCount')
    expect(res.body.data.pendingCount).toBe(2) // We mocked 2 pending items
  })

  it('GET /api/resources returns resources', async () => {
    const res = await request.get('/api/resources').set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
    expect(res.body.data.resources.length).toBeGreaterThan(0)
  })

  it('POST /api/roll-call with valid data returns 201', async () => {
    const res = await request
      .post('/api/roll-call')
      .set('Authorization', 'Bearer valid-token')
      .send({
        participantId: 'res-101',
        wellnessStatus: 'steady',
        supportNeed: 'none'
      })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
  })

  it('POST /api/roll-call with invalid status returns 400', async () => {
    const res = await request
      .post('/api/roll-call')
      .set('Authorization', 'Bearer valid-token')
      .send({
        participantId: 'res-101',
        wellnessStatus: 'invalid-status'
      })
    expect(res.status).toBe(400)
  })

  it('PUT /api/moderation/queue/:id updates status', async () => {
    const res = await request
      .put('/api/moderation/queue/review-701')
      .set('Authorization', 'Bearer valid-token')
      .send({
        status: 'approved'
      })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('approved')
  })

  it('PUT /api/moderation/queue/:id with invalid status returns 400', async () => {
    const res = await request
      .put('/api/moderation/queue/review-701')
      .set('Authorization', 'Bearer valid-token')
      .send({
        status: 'invalid-status'
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('POST /api/messages with flagged content triggers moderation', async () => {
    const res = await request
      .post('/api/messages')
      .set('Authorization', 'Bearer valid-token')
      .send({
        senderId: 'res-101',
        recipientId: 'res-204',
        body: 'I will attack them with a weapon'
      })
    expect(res.status).toBe(201)
    expect(res.body.data.deliveryStatus).toBe('mail_room')
  })
})
