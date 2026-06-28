// =============================================================================
//  Portable API Gateway — drop-in, zero-dependency module
//  -----------------------------------------------------------------------------
//  Adds a scoped, rate-limited, logged API gateway to any Express app with a
//  single `app.use(createGatewayRouter())`. No new npm packages, no native
//  modules, no database engine required — keys and request logs persist to a
//  plain JSON file, so it never affects the host app's install or build.
//
//  Endpoints
//    Public (require header  X-API-Key: <key>)
//      GET  /gateway/v1/ping              -> { ok, key, scopes }
//      GET  /gateway/v1/status            -> { keys, requests } (scope: stats:read)
//      GET  /gateway/v1/data/:name        -> registered data provider (scope: <name>:read)
//    Admin (require header  X-Gateway-Admin: <adminToken>)
//      GET    /gateway/admin/keys
//      POST   /gateway/admin/keys         { name, scopes[], rate_limit }
//      PUT    /gateway/admin/keys/:id/toggle
//      DELETE /gateway/admin/keys/:id
//      GET    /gateway/admin/logs
//      GET    /gateway/admin/stats
//    Page
//      GET  /gateway                      -> self-contained HTML admin console
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';

const DEFAULT_SCOPES = ['stats:read'];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function loadStore(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { adminToken: raw.adminToken || null, keys: raw.keys || [], logs: raw.logs || [] };
  } catch {
    return { adminToken: null, keys: [], logs: [] };
  }
}

function saveStore(file, store) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('[gateway] failed to persist store:', e.message);
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.dataDir]    Where to store gateway.json (default: <cwd>/data)
 * @param {string} [options.adminToken] Admin token; falls back to env GATEWAY_ADMIN_TOKEN, then auto-generated
 * @param {Record<string, () => any>} [options.providers] scope -> function returning JSON-serialisable data
 * @returns {import('express').Router}
 */
export function createGatewayRouter(options = {}) {
  const dataDir = options.dataDir || path.join(process.cwd(), 'data');
  const storeFile = path.join(dataDir, 'gateway.json');
  const store = loadStore(storeFile);
  const providers = options.providers || {};
  const providerScopes = Object.keys(providers).map((n) => `${n}:read`);
  const ALL_SCOPES = [...new Set([...DEFAULT_SCOPES, ...providerScopes])];

  // Resolve the admin token: explicit option > env > persisted > freshly generated.
  store.adminToken =
    options.adminToken || process.env.GATEWAY_ADMIN_TOKEN || store.adminToken || crypto.randomBytes(16).toString('hex');
  saveStore(storeFile, store);
  console.log(`[gateway] admin console at /gateway — admin token: ${store.adminToken}`);

  const persist = () => saveStore(storeFile, store);
  const rateWindows = new Map();

  const router = express.Router();
  router.use(express.json());

  const logRequest = (keyId, req, status, ms) => {
    store.logs.unshift({
      id: crypto.randomUUID(),
      key_id: keyId,
      method: req.method,
      path: (req.originalUrl || req.url).split('?')[0],
      status,
      ip: req.headers['x-forwarded-for'] || req.ip || '',
      response_ms: ms,
      timestamp: new Date().toISOString(),
    });
    if (store.logs.length > 1000) store.logs.length = 1000;
    persist();
  };

  // ---- API-key auth + rate limiting (public endpoints) ----
  const apiKeyAuth = (requiredScope) => (req, res, next) => {
    const start = Date.now();
    const raw = req.headers['x-api-key'] || '';
    const fail = (status, body, keyId = null) => {
      logRequest(keyId, req, status, Date.now() - start);
      res.status(status).json(body);
    };
    if (!raw) return fail(401, { error: "Missing API key. Send it in the 'X-API-Key' header." });

    const key = store.keys.find((k) => k.key_hash === sha256(raw));
    if (!key) return fail(401, { error: 'Invalid API key.' });
    if (!key.is_active) return fail(403, { error: 'This API key has been revoked.' }, key.id);
    if (requiredScope && !key.scopes.includes(requiredScope))
      return fail(403, { error: `API key is missing required scope: ${requiredScope}` }, key.id);

    const now = Date.now();
    const hits = (rateWindows.get(key.id) || []).filter((t) => t > now - 60000);
    if (hits.length >= key.rate_limit) {
      res.setHeader('Retry-After', '60');
      return fail(429, { error: 'Rate limit exceeded. Try again in a minute.' }, key.id);
    }
    hits.push(now);
    rateWindows.set(key.id, hits);

    res.setHeader('X-RateLimit-Limit', String(key.rate_limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, key.rate_limit - hits.length)));

    key.request_count = (key.request_count || 0) + 1;
    key.last_used_at = new Date().toISOString();
    persist();

    req.apiKey = key;
    res.on('finish', () => logRequest(key.id, req, res.statusCode, Date.now() - start));
    next();
  };

  // ---- Admin auth ----
  const adminAuth = (req, res, next) => {
    const token = req.headers['x-gateway-admin'] || '';
    if (token !== store.adminToken) return res.status(401).json({ error: 'Invalid or missing admin token.' });
    next();
  };

  // ===== Public endpoints =====
  router.get('/gateway/v1/ping', apiKeyAuth(), (req, res) => {
    res.json({ ok: true, key: req.apiKey.name, scopes: req.apiKey.scopes, time: new Date().toISOString() });
  });

  router.get('/gateway/v1/status', apiKeyAuth('stats:read'), (req, res) => {
    res.json({ data: { keys: store.keys.length, requests: store.keys.reduce((n, k) => n + (k.request_count || 0), 0) } });
  });

  router.get('/gateway/v1/data/:name', (req, res, next) => {
    const name = req.params.name;
    if (!providers[name]) return res.status(404).json({ error: `No data provider named '${name}'.` });
    return apiKeyAuth(`${name}:read`)(req, res, () => {
      try {
        const data = providers[name]();
        res.json({ count: Array.isArray(data) ? data.length : undefined, data });
      } catch (e) {
        res.status(500).json({ error: 'Provider error: ' + e.message });
      }
    });
  });

  // ===== Admin endpoints =====
  const publicKey = (k) => ({
    id: k.id, name: k.name, key_prefix: k.key_prefix, scopes: k.scopes,
    rate_limit: k.rate_limit, is_active: k.is_active, request_count: k.request_count || 0,
    last_used_at: k.last_used_at || null, created_at: k.created_at,
  });

  router.get('/gateway/admin/keys', adminAuth, (req, res) => {
    res.json(store.keys.map(publicKey));
  });

  router.post('/gateway/admin/keys', adminAuth, (req, res) => {
    const { name, scopes, rate_limit } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'A key name is required.' });
    const requested = Array.isArray(scopes) && scopes.length ? scopes : ALL_SCOPES;
    const valid = requested.filter((s) => ALL_SCOPES.includes(s));
    if (!valid.length) return res.status(400).json({ error: 'Select at least one valid scope.', available: ALL_SCOPES });
    const limit = Math.min(Math.max(parseInt(rate_limit, 10) || 60, 1), 10000);

    const fullKey = 'gw_live_' + crypto.randomBytes(24).toString('hex');
    const record = {
      id: crypto.randomUUID(), name: String(name).trim(), key_prefix: fullKey.slice(0, 14),
      key_hash: sha256(fullKey), scopes: valid, rate_limit: limit, is_active: true,
      request_count: 0, last_used_at: null, created_at: new Date().toISOString(),
    };
    store.keys.unshift(record);
    persist();
    res.json({ ...publicKey(record), key: fullKey });
  });

  router.put('/gateway/admin/keys/:id/toggle', adminAuth, (req, res) => {
    const key = store.keys.find((k) => k.id === req.params.id);
    if (!key) return res.status(404).json({ error: 'Key not found.' });
    key.is_active = !key.is_active;
    persist();
    res.json({ success: true, is_active: key.is_active });
  });

  router.delete('/gateway/admin/keys/:id', adminAuth, (req, res) => {
    const before = store.keys.length;
    store.keys = store.keys.filter((k) => k.id !== req.params.id);
    store.logs = store.logs.filter((l) => l.key_id !== req.params.id);
    rateWindows.delete(req.params.id);
    persist();
    res.json({ success: store.keys.length < before });
  });

  router.get('/gateway/admin/logs', adminAuth, (req, res) => {
    const byId = Object.fromEntries(store.keys.map((k) => [k.id, k.name]));
    res.json(store.logs.slice(0, 100).map((l) => ({ ...l, key_name: byId[l.key_id] || null })));
  });

  router.get('/gateway/admin/stats', adminAuth, (req, res) => {
    const dayAgo = Date.now() - 86400000;
    const recent = store.logs.filter((l) => new Date(l.timestamp).getTime() >= dayAgo);
    const avg = store.logs.length ? Math.round(store.logs.reduce((n, l) => n + (l.response_ms || 0), 0) / store.logs.length) : 0;
    const counts = {};
    for (const l of store.logs) counts[l.path] = (counts[l.path] || 0) + 1;
    const topEndpoints = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, c]) => ({ path: p, c }));
    res.json({
      activeKeys: store.keys.filter((k) => k.is_active).length,
      totalKeys: store.keys.length,
      totalRequests: store.logs.length,
      requests24h: recent.length,
      avgResponseMs: avg,
      availableScopes: ALL_SCOPES,
      topEndpoints,
    });
  });

  // ===== Self-contained admin page =====
  router.get('/gateway', (req, res) => {
    res.type('html').send(ADMIN_PAGE);
  });

  return router;
}

const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>API Gateway</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f1115; color: #e7e9ee; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 64px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
  p.sub { color: #9aa3b2; margin: 0 0 24px; }
  .card { background: #171a21; border: 1px solid #262b36; border-radius: 12px; padding: 18px; margin-bottom: 18px; }
  label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9aa3b2; margin: 0 0 6px; }
  input, button { font: inherit; }
  input[type=text], input[type=password], input[type=number] { width: 100%; padding: 10px 12px; background: #0f1115; border: 1px solid #2b313d; border-radius: 8px; color: #e7e9ee; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .row > div { flex: 1; min-width: 160px; }
  button { cursor: pointer; border: 0; border-radius: 8px; padding: 10px 16px; background: #3b82f6; color: #fff; font-weight: 600; }
  button.ghost { background: #232834; color: #e7e9ee; border: 1px solid #2b313d; }
  button.sm { padding: 6px 10px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px; border-bottom: 1px solid #232834; }
  th { color: #9aa3b2; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: #232834; margin: 0 4px 4px 0; }
  .ok { color: #34d399; } .bad { color: #f87171; }
  code { background: #0f1115; padding: 2px 6px; border-radius: 6px; }
  .reveal { background: #0b2a17; border: 1px solid #14532d; color: #d1fae5; padding: 14px; border-radius: 10px; word-break: break-all; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat { background: #0f1115; border: 1px solid #232834; border-radius: 10px; padding: 14px; }
  .stat b { font-size: 24px; display: block; }
  .muted { color: #9aa3b2; font-size: 13px; }
  .tabs button { background: transparent; color: #9aa3b2; border-bottom: 2px solid transparent; border-radius: 0; }
  .tabs button.active { color: #e7e9ee; border-color: #3b82f6; }
</style></head>
<body><div class="wrap">
  <h1>API Gateway</h1>
  <p class="sub">Scoped, rate-limited, logged keys for programmatic access.</p>

  <div class="card" id="login">
    <label>Admin token</label>
    <div class="row">
      <div><input id="token" type="password" placeholder="Paste the GATEWAY_ADMIN_TOKEN printed in the server console"></div>
      <div style="flex:0"><button onclick="connect()">Connect</button></div>
    </div>
    <p class="muted" id="loginMsg"></p>
  </div>

  <div id="app" style="display:none">
    <div class="card grid" id="stats"></div>

    <div class="card">
      <div class="tabs" style="display:flex; gap:18px; margin-bottom:16px">
        <button class="active" data-tab="keys" onclick="tab('keys')">Keys</button>
        <button data-tab="new" onclick="tab('new')">New key</button>
        <button data-tab="logs" onclick="tab('logs')">Request log</button>
      </div>

      <div id="tab-keys"></div>

      <div id="tab-new" style="display:none">
        <div id="reveal"></div>
        <label>Key name</label>
        <input id="kname" type="text" placeholder="e.g. Partner integration">
        <label style="margin-top:14px">Scopes</label>
        <div id="scopes"></div>
        <div class="row" style="margin-top:14px">
          <div><label>Rate limit (req/min)</label><input id="klimit" type="number" value="60" min="1" max="10000"></div>
          <div style="flex:0; align-self:flex-end"><button onclick="createKey()">Generate key</button></div>
        </div>
        <p class="muted" id="newMsg"></p>
      </div>

      <div id="tab-logs" style="display:none"></div>
    </div>
  </div>
</div>
<script>
  let TOKEN = '';
  const H = () => ({ 'Content-Type': 'application/json', 'X-Gateway-Admin': TOKEN });
  const el = (id) => document.getElementById(id);

  async function connect() {
    TOKEN = el('token').value.trim();
    const r = await fetch('gateway/admin/stats', { headers: H() });
    if (!r.ok) { el('loginMsg').textContent = 'Invalid token.'; return; }
    el('login').style.display = 'none';
    el('app').style.display = 'block';
    refresh();
  }

  async function refresh() {
    const s = await (await fetch('gateway/admin/stats', { headers: H() })).json();
    el('stats').innerHTML = [
      ['Active keys', s.activeKeys + ' / ' + s.totalKeys],
      ['Total requests', s.totalRequests],
      ['Last 24h', s.requests24h],
      ['Avg response', s.avgResponseMs + ' ms'],
    ].map(([k, v]) => '<div class="stat"><span class="muted">' + k + '</span><b>' + v + '</b></div>').join('');
    el('scopes').innerHTML = s.availableScopes.map((sc) =>
      '<label style="display:inline-flex; gap:6px; align-items:center; text-transform:none; letter-spacing:0; margin:0 12px 6px 0; color:#e7e9ee"><input type="checkbox" class="scope" value="' + sc + '" checked> ' + sc + '</label>').join('');
    loadKeys();
  }

  async function loadKeys() {
    const keys = await (await fetch('gateway/admin/keys', { headers: H() })).json();
    el('tab-keys').innerHTML = keys.length ? '<table><thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Limit</th><th>Reqs</th><th>Status</th><th></th></tr></thead><tbody>' +
      keys.map((k) => '<tr><td>' + k.name + '</td><td><code>' + k.key_prefix + '…</code></td><td>' +
        k.scopes.map((s) => '<span class="pill">' + s + '</span>').join('') + '</td><td>' + k.rate_limit + '/min</td><td>' +
        k.request_count + '</td><td class="' + (k.is_active ? 'ok' : 'bad') + '">' + (k.is_active ? 'Active' : 'Revoked') + '</td><td>' +
        '<button class="ghost sm" onclick="toggleKey(\\'' + k.id + '\\')">' + (k.is_active ? 'Disable' : 'Enable') + '</button> ' +
        '<button class="ghost sm" onclick="delKey(\\'' + k.id + '\\')">Revoke</button></td></tr>').join('') +
      '</tbody></table>' : '<p class="muted">No keys yet. Create one under “New key”.</p>';
  }

  async function createKey() {
    const name = el('kname').value.trim();
    const scopes = [...document.querySelectorAll('.scope:checked')].map((c) => c.value);
    const rate_limit = parseInt(el('klimit').value, 10);
    const r = await fetch('gateway/admin/keys', { method: 'POST', headers: H(), body: JSON.stringify({ name, scopes, rate_limit }) });
    const d = await r.json();
    if (!r.ok) { el('newMsg').textContent = d.error || 'Failed.'; return; }
    el('reveal').innerHTML = '<div class="reveal"><b>Copy this key now — it is shown only once:</b><br>' + d.key + '</div>';
    el('kname').value = ''; el('newMsg').textContent = '';
    refresh();
  }

  async function toggleKey(id) { await fetch('gateway/admin/keys/' + id + '/toggle', { method: 'PUT', headers: H() }); refresh(); }
  async function delKey(id) { if (!confirm('Revoke this key permanently?')) return; await fetch('gateway/admin/keys/' + id, { method: 'DELETE', headers: H() }); refresh(); }

  async function loadLogs() {
    const logs = await (await fetch('gateway/admin/logs', { headers: H() })).json();
    el('tab-logs').innerHTML = logs.length ? '<table><thead><tr><th>Time</th><th>Key</th><th>Method</th><th>Path</th><th>Status</th><th>ms</th></tr></thead><tbody>' +
      logs.map((l) => '<tr><td class="muted">' + new Date(l.timestamp).toLocaleString() + '</td><td>' + (l.key_name || '—') + '</td><td>' +
        l.method + '</td><td><code>' + l.path + '</code></td><td>' + l.status + '</td><td>' + l.response_ms + '</td></tr>').join('') +
      '</tbody></table>' : '<p class="muted">No requests logged yet.</p>';
  }

  function tab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    ['keys', 'new', 'logs'].forEach((t) => el('tab-' + t).style.display = t === name ? 'block' : 'none');
    if (name === 'logs') loadLogs();
    if (name === 'keys') loadKeys();
  }
</script>
</body></html>`;

export default createGatewayRouter;
