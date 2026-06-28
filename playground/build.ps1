# ─────────────────────────────────────────────────────────────────────────────
# build.ps1  —  Local Option 4 / Option 5 companion script
#
# Run from the project root:
#   .\build.ps1
#
# What it does:
#   1.  Pulls the latest code from the current branch
#   2.  Installs / updates dependencies
#   3.  Lints the project
#   4.  Runs tests
#   5.  Builds the project
#   6.  Creates a timestamped ZIP (no node_modules / .git / .env)
#   7.  Stages all changes, commits, and pushes to GitHub
# ─────────────────────────────────────────────────────────────────────────────

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────
function Step($msg) { Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function OK($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

# ── 0. Confirm we're inside a git repo ───────────────────────────────────────
Step "Verifying git repository"
if (-not (Test-Path ".git")) { Fail "Not a git repository. Run this script from your project root." }
OK "Git repository found"

# ── 1. Pull latest ───────────────────────────────────────────────────────────
Step "Pulling latest code from remote"
git pull
if ($LASTEXITCODE -ne 0) { Fail "git pull failed" }
OK "Up to date"

# ── 2. Install dependencies ───────────────────────────────────────────────────
Step "Installing dependencies (npm ci)"
npm ci
if ($LASTEXITCODE -ne 0) { Fail "npm ci failed" }
OK "Dependencies installed"

# ── 3. Lint ───────────────────────────────────────────────────────────────────
Step "Running linter"
npm run lint
if ($LASTEXITCODE -ne 0) { Fail "Lint errors found — fix them before building" }
OK "Lint passed"

# ── 4. Tests ──────────────────────────────────────────────────────────────────
Step "Running tests (failures are reported but do not stop the build)"
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "  ⚠ Some tests failed" -ForegroundColor Yellow }
else                      { OK "All tests passed" }

# ── 5. Build ──────────────────────────────────────────────────────────────────
Step "Building project"
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed" }
OK "Build succeeded"

# ── 6. Create ZIP ─────────────────────────────────────────────────────────────
Step "Creating release ZIP"

$timestamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$zipName    = "project-build-$timestamp.zip"
$exclude    = @(".git", "node_modules", "coverage", ".env", "*.log", $zipName)

# Collect everything that is NOT excluded
$items = Get-ChildItem -Path "." -Force |
         Where-Object { $exclude -notcontains $_.Name }

Compress-Archive -Path $items -DestinationPath $zipName -Force
OK "Created: $zipName"

# ── 7. Commit and push ────────────────────────────────────────────────────────
Step "Committing and pushing to GitHub"

git add -A
$status = git status --porcelain
if ($status) {
    git commit -m "chore: automatic build $timestamp"
    if ($LASTEXITCODE -ne 0) { Fail "git commit failed" }
    git push
    if ($LASTEXITCODE -ne 0) { Fail "git push failed" }
    OK "Changes committed and pushed"
} else {
    OK "No changes to commit"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Build complete → $zipName" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
