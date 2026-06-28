# AI → GitHub → ZIP Pipeline

Complete Option 5 workflow: ChatGPT designs → Codex edits code → GitHub Actions builds → ZIP artifact produced automatically.

---

## What's in this repo

```
.
├── .github/
│   └── workflows/
│       ├── build.yml       ← runs on every push: install, lint, test, build, ZIP, upload
│       ├── release.yml     ← runs when you push a version tag: creates a GitHub Release + ZIP
│       └── security.yml    ← weekly npm audit for vulnerabilities
└── build.ps1               ← local script: pull, install, lint, test, build, ZIP, push
```

---

## How the full pipeline works

```
You describe a change to ChatGPT
          │
          ▼
ChatGPT designs / plans the feature
          │
          ▼ (Codex / GitHub Copilot / Bob)
AI coding agent edits the repository
 ├── reads existing code
 ├── writes / modifies files
 ├── creates new files
 ├── fixes build errors
 └── opens a Pull Request
          │
          ▼
GitHub Actions runs automatically on the PR
 ├── npm ci          (install)
 ├── npm run lint    (code quality)
 ├── npm test        (tests)
 ├── npm run build   (compile)
 ├── zip project     (package)
 └── upload artifact (downloadable ZIP)
          │
          ▼
You review the PR in GitHub
          │
          ▼
Merge → main branch updated
          │
          ▼
build.yml runs again on main
          │
          ▼
Downloadable ZIP artifact available in Actions tab
```

---

## Workflow files

### [`build.yml`](.github/workflows/build.yml) — runs on every push

Triggers on pushes and pull requests to `main` and `development`.

| Step | Command | Fails build? |
|---|---|---|
| Checkout | `actions/checkout@v4` | Yes |
| Node setup | `actions/setup-node@v4` (v22) | Yes |
| Install | `npm ci` | Yes |
| Lint | `npm run lint` | Yes |
| Test | `npm test` | No (continue-on-error) |
| Build | `npm run build` | Yes |
| ZIP | `zip -r project-build.zip .` | Yes |
| Upload artifact | `actions/upload-artifact@v4` | Yes |

The artifact is kept for **7 days** and is downloadable from the **Actions** tab.

---

### [`release.yml`](.github/workflows/release.yml) — runs on version tags

Push a tag to trigger a full GitHub Release with the ZIP attached:

```powershell
git tag v1.0.0
git push --tags
```

GitHub automatically:
1. Builds the project
2. Creates `project-v1.0.0.zip`
3. Publishes a GitHub Release
4. Attaches the ZIP to the release page

---

### [`security.yml`](.github/workflows/security.yml) — weekly audit

Runs `npm audit --audit-level=high` every Monday and on every push to `main`.  
If a **high** or **critical** vulnerability is found the job fails and GitHub notifies you.

---

## Local build script

[`build.ps1`](build.ps1) replicates the full pipeline locally on Windows (PowerShell).

```powershell
.\build.ps1
```

Steps performed:
1. `git pull` — get latest code
2. `npm ci` — clean install
3. `npm run lint` — lint check
4. `npm test` — run tests
5. `npm run build` — compile
6. Creates a timestamped ZIP (`project-build-20250101-120000.zip`)
7. `git add -A && git commit && git push` — push changes

---

## Setup checklist

### 1. Copy workflows into your project

```powershell
# From this repo, copy the .github folder into your project root
Copy-Item -Recurse .\.github\ C:\path\to\your-project\
Copy-Item .\build.ps1 C:\path\to\your-project\
```

### 2. Make sure your `package.json` has these scripts

```json
{
  "scripts": {
    "lint":  "eslint .",
    "test":  "jest",
    "build": "vite build"
  }
}
```

> Adjust `lint`, `test`, and `build` commands to match your actual tooling.

### 3. Push to GitHub

```powershell
git add .github/ build.ps1
git commit -m "chore: add AI→GitHub→ZIP pipeline"
git push
```

### 4. Watch the Actions run

Go to your repository on GitHub → **Actions** tab → watch `Build & Package` run.  
When it finishes, click the run → scroll down to **Artifacts** → download the ZIP.

### 5. Connect an AI coding agent (optional but recommended)

| Agent | How to connect |
|---|---|
| **GitHub Copilot (Coding Agent)** | Enable in your GitHub repo settings → Copilot → Coding Agent |
| **OpenAI Codex** | Connect at platform.openai.com → link your GitHub repo |
| **Bob (this tool)** | Already working in your local workspace |

Once connected, the agent can open pull requests directly. GitHub Actions runs the build on every PR automatically.

---

## Branch strategy

```
main          ← production, protected
development   ← integration branch
feature/*     ← individual features
hotfix/*      ← urgent fixes
```

Example:
```powershell
git checkout -b feature/connect-messaging
# ... AI makes changes ...
git push -u origin feature/connect-messaging
# Open PR → Actions builds → merge → ZIP produced
```

---

## Recommended monorepo layout (for multiple projects)

```
FeloniousSuite/
├── apps/
│   ├── new-horizon-web/
│   ├── new-horizon-mobile/
│   └── admin-dashboard/
├── packages/
│   ├── auth/
│   ├── ai/
│   ├── connect/
│   ├── messaging/
│   ├── notifications/
│   ├── ui/
│   └── shared/
├── supabase/
│   ├── migrations/
│   ├── functions/
│   └── policies/
├── .github/
│   └── workflows/
│       ├── build.yml
│       ├── release.yml
│       └── security.yml
└── docs/
```

---

## Summary

| Trigger | Workflow | Output |
|---|---|---|
| Push to `main` or `development` | `build.yml` | Downloadable ZIP artifact (7-day retention) |
| Push a `v*.*.*` tag | `release.yml` | GitHub Release page + permanent ZIP |
| Every Monday / push to `main` | `security.yml` | Vulnerability report |
| Run `.\build.ps1` locally | — | Local ZIP + auto push to GitHub |
