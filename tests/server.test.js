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

test('POST /api/jobs requires authentication', async () => {
  const res = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Test Job', company: 'TestCo' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/housing requires authentication', async () => {
  const res = await fetch(`${base}/api/housing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Test Place' }),
  });
  assert.equal(res.status, 401);
});

test('register rejects short passwords', async () => {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Short', email: 'short@example.com', password: '1234' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Password/);
});

test('register rejects invalid email format', async () => {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bad Email', email: 'not-an-email', password: 'validpass123' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /email/i);
});

test('GET /api/jobs supports pagination', async () => {
  const res = await fetch(`${base}/api/jobs?page=1&limit=10`);
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.ok(Array.isArray(rows));
});

test('SPA runs under helmet default CSP: no inline scripts or handlers', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'), 'utf8');
  // Any inline <script> body or on*="" attribute would be blocked by the CSP below.
  assert.ok(!/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html), 'index.html must not contain inline <script> blocks');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'index.html must not use inline on*="" event handlers');

  const res = await fetch(`${base}/`);
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'expected a Content-Security-Policy header');
  const directives = csp.split(';').map((d) => d.trim());
  const scriptSrc = directives.find((d) => d.startsWith('script-src '));
  const scriptSrcAttr = directives.find((d) => d.startsWith('script-src-attr '));
  assert.equal(scriptSrc, "script-src 'self'");
  assert.equal(scriptSrcAttr, "script-src-attr 'none'");

  const js = await fetch(`${base}/spa.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') || '', /javascript/);
});
