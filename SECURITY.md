# Security Policy

## Supported Versions

The latest commit on `main` is supported.

## Reporting a Vulnerability

Please open a private security advisory in this repository or email the maintainer. Do **not** open public issues for security problems.

## In-app protections

- HTTP responses set security headers via `helmet`.
- API requests are rate-limited (100 req / 15 min per IP) via `express-rate-limit`.
- Passwords are hashed with bcrypt (cost factor 12).
- Authentication uses JWT with a required secret in production (`JWT_SECRET` env var must be set when `NODE_ENV=production`).
- Write endpoints (`POST /api/jobs`, `POST /api/housing`, `POST /api/community`, `POST /api/rollcall`) require a valid JWT.
- All user input is sanitized with length limits (500 chars for fields, 2000 for content/descriptions).
- Email format is validated on registration.
- Error responses do not expose internal details in production.
- SQLite foreign key constraints are enforced.
- List endpoints support pagination to prevent unbounded responses.
