# Security Policy

## Supported Versions

The latest commit on `main` is supported.

## Reporting a Vulnerability

Please open a private security advisory in this repository or email the maintainer. Do **not** open public issues for security problems.

## In-app protections

- HTTP responses set security headers via `helmet`.
- Requests are rate-limited (100/min per IP) via `express-rate-limit`.
- No user input is currently accepted; revisit this file when forms/APIs are added.
