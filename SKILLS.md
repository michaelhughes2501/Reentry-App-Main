# SKILLS.md — Reusable Capabilities & Patterns

This catalogs the features, functions, and patterns to pull from on any new build. Each is something that has shipped in a FeloniousApps project — reuse the pattern, don't reinvent it.

## Frontend skills (React + Vite + TS)
- **App shell**: glass sticky navbar (active-link highlight + CTA), footer, `ThemeProvider`, `AuthProvider`.
- **Hero section**: gradient headline (clamp sizing), sub-copy, primary + secondary CTA, animated visual.
- **Feature grid**: 3-up cards, icon + title + copy, hover lift + border-glow.
- **Stats / social-proof band.**
- **Route code-splitting**: `React.lazy` + `Suspense` per page.
- **Skeletons, empty states, toasts** for every async surface.
- **Scroll-reveal** wrapper (Framer Motion / IntersectionObserver), reduced-motion aware.
- **Forms**: controlled inputs, inline validation, optimistic UI where safe. (No raw HTML `<form>` posts in artifacts — use handlers.)

## Auth & user
- Supabase email/password + OAuth; `useAuth` hook + `AuthProvider` context.
- `profiles` table keyed to `auth.users`, RLS so a user reads/writes only their row.
- Protected routes that redirect unauthenticated users.
- OIDC auth pattern available (see Last_stop) when Supabase auth isn't enough.

## Data / CRUD
- Typed Supabase helpers in `src/lib`; never query inline in components.
- Standard tables: `profiles`, `tasks`, `resources`, `messages`, `peer_posts`.
- **RLS policies on every table** — read/write scoped to `auth.uid()`.
- SQL migrations in `supabase/migrations/`.
- Drizzle ORM pattern available for Express/Postgres builds (see ImpactConnect).

## AI companion layer
- Persistent **per-user chatbot companion** as a core feature.
- Chat history in `messages` (keyed by `user_id`); send full history each call (model is stateless).
- Floating launcher → slide-in chat panel; streaming/typed responses.
- **Structured generation**: prompt for JSON-only, strip code fences, parse in try/catch (e.g. chat → task list).
- Proxy all AI calls server-side (Supabase Edge Function / Flask / Express) — keys never in the client.
- Models: `claude-sonnet-4-6` (in-app), `claude-opus-4-8` (heavy reasoning).

## Backend skills
- **Flask + SQLAlchemy** API (see ConvictCode): blueprints, models, Gunicorn for prod.
- **Express 5** API (see ReentryApp / conjigul): routed handlers, rate-limiting, `--watch` dev.
- **Full-stack Vite + Express** single-process serving built client (see ImpactConnect, remix_-the-yard) — read the server entry for the real port.
- **Next.js SSR** with Supabase SSR + rate-limiting (see Fifth_felony) when SEO/SSR matters.

## Resource directory pattern (reentry domain)
- Filterable, searchable directory of resources (housing, jobs, legal, banking).
- Decision flag: **Colorado-focused vs national** scope — set per project.
- Categories, tags, location filtering, detail views.

## Domain features available to reuse
- Task organizer / checklist with due dates and completion.
- Peer support board / messaging / prayer board (see Oakwood alumni platform).
- Events calendar, photo gallery, alumni/member directory.
- Second-chance banking / ACH info resources.

## Environment & tooling skills
- nvm-windows version management; one server per port.
- `gh auth login` + feature-branch PR workflow.
- Desktop Commander: absolute paths, `start_process` / `read_process_output`, the verification loop.
- VS Code + Git fundamentals; `netstat` for auditing connections; Windows AV/SSL troubleshooting.

## Verification skill (always last)
Dev server up → tail output clean → `curl` returns `200` → `tsc --noEmit` 0 errors → then ship.
