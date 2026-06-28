# API Gateway

A scoped, rate-limited, logged API gateway with a self-contained admin console.
Zero new dependencies — keys and request logs are stored in a JSON file, so it
adds no database engine or native modules to this project.

**Wiring:** Mounted in server.js via the portable Express module (gateway/gateway.js). Exposes resources and jobs as public data providers.
**Dev base URL:** `http://localhost:3001`
**Key store:** `gateway.json in the project root`

## Admin console

Start the app (`npm run dev`) and open:

```
http://localhost:3001/gateway
```

On first start the server console prints a line like:

```
[gateway] admin console at /gateway - admin token: <token>
```

Paste that token into the console to create keys, view usage stats, and read the
request log. Set your own stable token with the `GATEWAY_ADMIN_TOKEN` environment
variable instead of using the auto-generated one.

## Authentication

| Caller | Header |
|---|---|
| API client | `X-API-Key: <key>` |
| Admin (console) | `X-Gateway-Admin: <token>` |

## Public endpoints (require `X-API-Key`)

| Method | Path | Scope | Returns |
|---|---|---|---|
| GET | `/gateway/v1/ping` | any valid key | key name + scopes |
| GET | `/gateway/v1/status` | `stats:read` | key + request counts |
| GET | `/gateway/v1/data/:name` | `:name:read` | a registered data provider |

Responses include `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Exceeding a
key's per-minute limit returns `429`.

## Admin endpoints (require `X-Gateway-Admin`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/gateway/admin/keys` | list keys (no secret shown) |
| POST | `/gateway/admin/keys` | create a key — returns the full key **once** |
| PUT | `/gateway/admin/keys/:id/toggle` | enable / disable a key |
| DELETE | `/gateway/admin/keys/:id` | revoke a key |
| GET | `/gateway/admin/logs` | recent request log |
| GET | `/gateway/admin/stats` | usage summary |

## Quick start

```bash
# 1) create a key (admin token from the server console)
curl -X POST http://localhost:3001/gateway/admin/keys \
  -H "X-Gateway-Admin: <token>" -H "Content-Type: application/json" \
  -d '{"name":"My integration","scopes":["stats:read"],"rate_limit":60}'

# 2) call the API with the returned key
curl http://localhost:3001/gateway/v1/ping -H "X-API-Key: <key>"
```

> Keys are stored only as SHA-256 hashes; the full key is shown once at creation.
