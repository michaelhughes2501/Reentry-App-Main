// Smoke tests for the ReentryApp API (better-sqlite3 + Express).
// Uses Node's built-in test runner — no jest/supertest needed:
//   npm test   ->   node --test
//
// DB_PATH=:memory: keeps the suite from touching the on-disk reentry.db.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

import test from 'node:test';
import assert from 'node:assert/strict';
// Dynamic import so the env vars above are set BEFORE server.js reads them at
// module load. A static `import` is hoisted and would run first, making the
// suite hit the on-disk reentry.db instead of the in-memory database.
const { default: app } = await import('../server.js');

// Start the app on an ephemeral port for the duration of the suite.
let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => server?.close());

test('GET /api/resources returns the seeded resources', async () => {
  const res = await fetch(`${base}/api/resources`);
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length >= 6, 'expected the seed rows to be present');
});

test('register + login issues a JWT', async () => {
  const creds = { name: 'Test User', email: 'test@example.com', password: 'pw-12345' };

  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds),
  });
  assert.equal(reg.status, 200);
  const regBody = await reg.json();
  assert.ok(regBody.token, 'register should return a token');

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.ok(loginBody.token, 'login should return a token');
  assert.equal(loginBody.user.email, creds.email);
});

test('register rejects missing fields with 400', async () => {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@example.com' }),
  });
  assert.equal(res.status, 400);
});

test('protected route /api/rollcall requires a token', async () => {
  const res = await fetch(`${base}/api/rollcall`);
  assert.equal(res.status, 401);
});

test('roll-call check-in works with a valid token, blocks duplicates', async () => {
  // Register a fresh user to get a token.
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Roll Caller', email: 'roll@example.com', password: 'pw-12345' }),
  });
  const { token } = await reg.json();
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  const first = await fetch(`${base}/api/rollcall`, { method: 'POST', headers, body: JSON.stringify({ location: 'Home' }) });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.success, true);

  // Second check-in on the same day is rejected as a duplicate.
  const second = await fetch(`${base}/api/rollcall`, { method: 'POST', headers, body: JSON.stringify({ location: 'Home' }) });
  assert.equal(second.status, 409);
});

test('unknown /api route returns JSON 404, not the SPA shell', async () => {
  const res = await fetch(`${base}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
});
