// Unit tests for the inline SPA script embedded in public/index.html.
//
// This PR replaced a duplicated/malformed public/index.html (which had
// dragged in an unrelated "New Horizon" marketing page plus its
// public/app.js and public/styles.css) with a single valid document
// containing the real ReentryApp SPA. Along the way it fixed real bugs:
//   - calcStreak() was reading `rec.date`, a field that doesn't exist on
//     roll-call rows (the column is `check_in_date`), so the streak
//     counter was always 0.
//   - doLogin()/doRegister() posted {username, password} / {username,
//     email, password} bodies that don't match server.js's actual
//     contract ({email, password} / {name, email, password}), so every
//     auth attempt against the real backend failed.
//
// There's no bundler/module boundary for this code — it's a single
// <script> block designed to run directly in a browser. To unit test it
// without pulling in a DOM library (this repo intentionally uses only
// Node's built-in test runner, see tests/server.test.js), we extract the
// inline script text and execute it inside a `vm` context wired up with
// minimal fakes for `document`, `localStorage`, and `fetch`. This lets us
// call the script's top-level functions directly and assert on their
// real behavior instead of re-implementing/guessing at it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(indexHtmlPath, 'utf8');

function extractInlineScript(htmlSource) {
  const matches = [...htmlSource.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(matches.length > 0, 'expected at least one inline <script> block in public/index.html');
  // The app logic lives in the last (and, post-fix, only) inline script block.
  return matches[matches.length - 1][1];
}

const scriptSource = extractInlineScript(html);

// ---- Minimal DOM/browser fakes -------------------------------------------

class FakeClassList {
  constructor() { this._set = new Set(); }
  add(...names) { names.forEach((n) => this._set.add(n)); }
  remove(...names) { names.forEach((n) => this._set.delete(n)); }
  toggle(name, force) {
    const has = this._set.has(name);
    const next = force === undefined ? !has : force;
    if (next) this._set.add(name); else this._set.delete(name);
    return next;
  }
  contains(name) { return this._set.has(name); }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.style = {};
    this.disabled = false;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.onclick = null;
  }
  addEventListener() {}
  querySelectorAll() { return []; }
}

function defaultFetchImpl() {
  return Promise.resolve({ ok: true, status: 200, json: async () => [] });
}

// Builds a fresh vm context + runs the extracted script inside it, so every
// test starts from the SPA's real initial state (token/currentUser reset,
// etc.) with no cross-test bleed-through.
function loadApp({ fetchImpl } = {}) {
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const fetchCalls = [];
  const fetch = (url, options = {}) => {
    fetchCalls.push({ url, options });
    return (fetchImpl || defaultFetchImpl)(url, options);
  };

  const documentStub = {
    getElementById,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };

  const sandbox = {
    document: documentStub,
    localStorage,
    fetch,
    console,
    setTimeout,
    clearTimeout,
    JSON,
    Date,
    Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(scriptSource, sandbox, { filename: 'public/index.html (inline script)' });

  return { ctx: sandbox, fetchCalls, localStorage, el: getElementById };
}

// ---- esc() -----------------------------------------------------------------

test('esc() escapes HTML special characters (XSS prevention for rendered listings)', () => {
  const { ctx } = loadApp();
  assert.equal(ctx.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(ctx.esc(`"quoted" & 'apos'`), '&quot;quoted&quot; &amp; &#39;apos&#39;');
  assert.equal(ctx.esc('plain text'), 'plain text');
});

test('esc() returns an empty string for falsy input', () => {
  const { ctx } = loadApp();
  assert.equal(ctx.esc(''), '');
  assert.equal(ctx.esc(null), '');
  assert.equal(ctx.esc(undefined), '');
});

// ---- timeAgo() ---------------------------------------------------------------

test('timeAgo() buckets recent timestamps into minutes/hours/days', () => {
  const { ctx } = loadApp();
  const now = Date.now();
  assert.equal(ctx.timeAgo(new Date(now - 10 * 1000).toISOString()), 'just now');
  assert.equal(ctx.timeAgo(new Date(now - 5 * 60 * 1000).toISOString()), '5m ago');
  assert.equal(ctx.timeAgo(new Date(now - 3 * 60 * 60 * 1000).toISOString()), '3h ago');
  assert.equal(ctx.timeAgo(new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()), '2d ago');
});

test('timeAgo() falls back to a locale date string past 30 days, and handles empty input', () => {
  const { ctx } = loadApp();
  assert.equal(ctx.timeAgo(''), '');
  assert.equal(ctx.timeAgo(null), '');
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  assert.equal(ctx.timeAgo(old.toISOString()), old.toLocaleDateString());
});

// ---- calcStreak() — regression coverage for the reported bug fix -----------

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

test('calcStreak() counts consecutive check_in_date entries including today', () => {
  const { ctx } = loadApp();
  const records = [
    { check_in_date: isoDaysAgo(0) },
    { check_in_date: isoDaysAgo(1) },
    { check_in_date: isoDaysAgo(2) },
  ];
  assert.equal(ctx.calcStreak(records), 3);
});

test('calcStreak() stops counting at the first gap in days', () => {
  const { ctx } = loadApp();
  const records = [{ check_in_date: isoDaysAgo(0) }, { check_in_date: isoDaysAgo(2) }];
  assert.equal(ctx.calcStreak(records), 1);
});

test('calcStreak() returns 0 when there is no check-in for today', () => {
  const { ctx } = loadApp();
  const records = [{ check_in_date: isoDaysAgo(1) }, { check_in_date: isoDaysAgo(2) }];
  assert.equal(ctx.calcStreak(records), 0);
});

test('calcStreak() returns 0 for an empty history', () => {
  const { ctx } = loadApp();
  assert.equal(ctx.calcStreak([]), 0);
});

test('calcStreak() sorts unordered records before counting', () => {
  const { ctx } = loadApp();
  const records = [
    { check_in_date: isoDaysAgo(1) },
    { check_in_date: isoDaysAgo(0) },
    { check_in_date: isoDaysAgo(2) },
  ];
  assert.equal(ctx.calcStreak(records), 3);
});

test('regression: calcStreak() keys off check_in_date and ignores a stray `date` field', () => {
  const { ctx } = loadApp();
  // The reported bug was calcStreak() reading `rec.date`, a column that
  // doesn't exist on real /api/rollcall rows, which made the streak
  // always compute to 0. Add a misleading `date` field to each record to
  // confirm the fixed implementation keys off `check_in_date` instead.
  const records = [
    { check_in_date: isoDaysAgo(0), date: '1999-01-01' },
    { check_in_date: isoDaysAgo(1), date: '1999-01-02' },
  ];
  assert.equal(ctx.calcStreak(records), 2);
});

// ---- doLogin() — regression coverage for the auth contract fix ------------

test('doLogin() posts {email, password} to /api/auth/login and stores the session', async () => {
  const { ctx, fetchCalls, localStorage, el } = loadApp({
    fetchImpl: (url) => {
      if (url === '/api/auth/login') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'tok-123', user: { name: 'Ada Lovelace', email: 'ada@example.com' } }),
        });
      }
      return defaultFetchImpl();
    },
  });

  el('login-email').value = 'ada@example.com';
  el('login-password').value = 'supersecret';

  await ctx.doLogin();

  const loginCall = fetchCalls.find((c) => c.url === '/api/auth/login');
  assert.ok(loginCall, 'expected doLogin() to call /api/auth/login');
  assert.equal(loginCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(loginCall.options.body), {
    email: 'ada@example.com',
    password: 'supersecret',
  });

  assert.equal(localStorage.getItem('ra_token'), 'tok-123');
  assert.equal(JSON.parse(localStorage.getItem('ra_user')).email, 'ada@example.com');
});

test('doLogin() does not call the API when fields are empty', async () => {
  const { ctx, fetchCalls, el } = loadApp();
  el('login-email').value = '';
  el('login-password').value = '';

  await ctx.doLogin();

  assert.equal(fetchCalls.filter((c) => c.url === '/api/auth/login').length, 0);
  assert.equal(el('toast').textContent, 'Fill in all fields');
});

test('doLogin() surfaces the server error message on failed login', async () => {
  // Use a 400 (not 401) so apiFetch's "session expired" early-return path
  // doesn't swallow the server's error payload before doLogin can read it.
  const { ctx, el } = loadApp({
    fetchImpl: (url) => {
      if (url === '/api/auth/login') {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'Invalid credentials' }) });
      }
      return defaultFetchImpl();
    },
  });
  el('login-email').value = 'ada@example.com';
  el('login-password').value = 'wrong-password';

  await ctx.doLogin();

  assert.equal(el('toast').textContent, 'Invalid credentials');
});

// ---- doRegister() — regression coverage for the auth contract fix ---------

test('doRegister() posts {name, email, password} to /api/auth/register and stores the session', async () => {
  const { ctx, fetchCalls, localStorage, el } = loadApp({
    fetchImpl: (url) => {
      if (url === '/api/auth/register') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'tok-456', user: { name: 'Grace Hopper', email: 'grace@example.com' } }),
        });
      }
      return defaultFetchImpl();
    },
  });

  el('reg-name').value = 'Grace Hopper';
  el('reg-email').value = 'grace@example.com';
  el('reg-password').value = 'longenoughpassword';

  await ctx.doRegister();

  const regCall = fetchCalls.find((c) => c.url === '/api/auth/register');
  assert.ok(regCall, 'expected doRegister() to call /api/auth/register');
  assert.deepEqual(JSON.parse(regCall.options.body), {
    name: 'Grace Hopper',
    email: 'grace@example.com',
    password: 'longenoughpassword',
  });

  assert.equal(localStorage.getItem('ra_token'), 'tok-456');
});

test('doRegister() rejects passwords shorter than 6 characters before calling the API', async () => {
  const { ctx, fetchCalls, el } = loadApp();
  el('reg-name').value = 'Test User';
  el('reg-email').value = 't@example.com';
  el('reg-password').value = '123';

  await ctx.doRegister();

  assert.equal(fetchCalls.filter((c) => c.url === '/api/auth/register').length, 0);
  assert.equal(el('toast').textContent, 'Password must be 6+ characters');
});

test('doRegister() requires name, email, and password', async () => {
  const { ctx, fetchCalls, el } = loadApp();
  el('reg-name').value = '';
  el('reg-email').value = 'missing-name@example.com';
  el('reg-password').value = 'longenoughpassword';

  await ctx.doRegister();

  assert.equal(fetchCalls.filter((c) => c.url === '/api/auth/register').length, 0);
  assert.equal(el('toast').textContent, 'Name, email, and password required');
});
