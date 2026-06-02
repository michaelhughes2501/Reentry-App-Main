# CLAUDE.md

Guidance for Claude Code (and humans) when working in this repository.

## Project overview

**ReentryApp** — a web app supporting reentry into the community after incarceration. This repo currently holds a minimal Express scaffold that serves a static landing page; build the real product on top of it.

## Tech stack

- Node.js (CommonJS)
- Express + helmet + express-rate-limit
- Plain HTML/CSS/JS in `public/` until a frontend framework is chosen

## Commands

```bash
npm install
npm start          # http://localhost:3000
```

## Repo layout

- `server.js` — Express server, static file hosting, SPA fallback.
- `public/` — static assets shipped to the browser.
- `.vscode/` — editor config so the project opens cleanly in VS Code.

## Roadmap suggestions

- Pick a DB (Supabase / Firebase) and add `.env.example` keys.
- Add auth before any user data.
- Add a CI workflow (`.github/workflows/ci.yml`) that runs `npm test`.
