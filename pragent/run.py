#!/usr/bin/env python3
"""
Agent 5 — PR / repo-structure coordinator (entry point).

In CI it runs on pull_request events. It:
  1. validates repo structure + branch/title conventions
  2. ingests other agents' reports from the reports dir
  3. posts/updates a single combined verdict comment on the PR
  4. sets a commit status (pass/fail) so the PR's checks reflect the verdict

Usage in Actions:
    python -m pragent.run --event "$GITHUB_EVENT_PATH"

Local dry-run (no GitHub calls, prints the comment it WOULD post):
    python -m pragent.run --repo-path . --branch feature/x --title "feat: y" --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import config as cfgmod
from . import validators as V
from .aggregate import decide_verdict, ingest_reports
from .report import COMMENT_MARKER, render


def _local_paths(root: str) -> list[str]:
    base = Path(root)
    skip = {".git", "node_modules", "__pycache__", ".venv", "venv"}
    out = []
    for p in base.rglob("*"):
        if p.is_file() and not (set(p.relative_to(base).parts) & skip):
            out.append(str(p.relative_to(base)))
    return out


def _structure_findings(cfg: dict, repo_paths: list[str],
                        branch: str, title: str,
                        changed_files: int, total_changes: int) -> list[V.Finding]:
    f: list[V.Finding] = []
    f += V.check_required_files(repo_paths, cfg["required_files"])
    f += V.check_forbidden_paths(repo_paths, cfg["forbidden_paths"])
    f += V.check_directory_layout(repo_paths, cfg["expected_dirs"])
    f += V.check_branch_name(branch, cfg["branch_pattern"])
    f += V.check_pr_title(title, cfg["pr_title_pattern"])
    f += V.check_pr_size(changed_files, total_changes, cfg["max_files"], cfg["max_changes"])
    return f


def run_dry(cfg: dict, repo_path: str, branch: str, title: str) -> int:
    repo_paths = _local_paths(repo_path)
    structure = _structure_findings(cfg, repo_paths, branch, title, len(repo_paths), 0)
    # reports_dir is relative to the repo being scanned, not the cwd.
    reports_dir = Path(repo_path) / cfg["reports_dir"]
    by_agent, notes = ingest_reports(reports_dir)
    all_f = list(structure) + [x for fs in by_agent.values() for x in fs]
    passed, reason = decide_verdict(all_f, cfg["fail_on"])
    print(render(structure, by_agent, notes, passed, reason))
    return 0 if passed else 1


def run_ci(cfg: dict, event_path: str) -> int:
    from .github import GitHubClient, PRRef  # imported here so dry-run needs no token

    event = json.loads(Path(event_path).read_text())
    pr = event.get("pull_request")
    repo = event.get("repository", {})
    if not pr:
        print("Not a pull_request event; nothing to do.")
        return 0

    owner = repo["owner"]["login"]
    name = repo["name"]
    number = pr["number"]
    branch = pr["head"]["ref"]
    title = pr.get("title", "")
    sha = pr["head"]["sha"]
    changed_files = pr.get("changed_files", 0)
    total_changes = pr.get("additions", 0) + pr.get("deletions", 0)

    gh = GitHubClient()
    ref = PRRef(owner, name, number)

    # Repo file list from the PR head branch.
    try:
        repo_paths = gh.get_repo_tree(owner, name, branch)
    except Exception as exc:  # fall back to changed files only
        repo_paths = [f["filename"] for f in gh.list_pr_files(ref)]
        print(f"note: tree fetch failed ({exc}); using changed files only", file=sys.stderr)

    structure = _structure_findings(cfg, repo_paths, branch, title,
                                    changed_files, total_changes)
    by_agent, notes = ingest_reports(cfg["reports_dir"])
    all_f = list(structure) + [x for fs in by_agent.values() for x in fs]
    passed, reason = decide_verdict(all_f, cfg["fail_on"])

    body = render(structure, by_agent, notes, passed, reason)

    # Optional: open a draft PR with safe mechanical fixes (off unless enabled).
    if cfg["auto_fix"].get("enabled"):
        from .autofix import open_fix_pr
        from .fixes import plan_fixes
        fixes, _unfixable = plan_fixes(structure, repo=name, existing_paths=set(repo_paths))
        if fixes:
            try:
                result = open_fix_pr(gh, owner, name, fixes, cfg)
                if result and result.get("html_url"):
                    body += f"\n\n> 🔧 Opened a draft fix PR: {result['html_url']}"
                elif result and result.get("skipped"):
                    body += f"\n\n> 🔧 Fix PR skipped: {result['reason']}"
            except Exception as exc:
                body += f"\n\n> ⚠️ Could not open fix PR: {exc}"

    gh.upsert_comment(ref, body, COMMENT_MARKER)
    gh.set_status(owner, name, sha,
                  state="success" if passed else "failure",
                  context=cfg["status_context"], description=reason)

    print(f"Verdict: {'PASS' if passed else 'FAIL'} — {reason}")
    return 0 if passed else 1


def run_sweep(cfg: dict) -> int:
    """
    Scheduled multi-repo mode. Operates on cfg['repos'] (owner/name strings),
    checking structure and optionally opening draft fix PRs. Reports to stdout
    (and the PR comment, if a fix PR is opened). Requires a fine-grained PAT
    scoped to those repos.
    """
    from .github import GitHubClient

    repos = cfg.get("repos") or []
    if not repos:
        print("No repos configured for sweep (set 'repos' in pragent.yml). Nothing to do.")
        return 0

    gh = GitHubClient()
    overall_ok = True

    # --- Preflight: verify every configured repo name before doing any work. ---
    # A typo'd repo name should produce an obvious "✗ not found" line, not a
    # silent skip. We resolve each name and only sweep the ones that check out.
    print("Preflight: verifying configured repos...")
    valid: list[tuple[str, str, str]] = []  # (full, owner, name)
    for full in repos:
        if "/" not in full:
            print(f"  ✗ {full!r}: expected 'owner/repo' format")
            overall_ok = False
            continue
        owner, name = full.split("/", 1)
        status = gh.check_repo(owner, name)
        if status["ok"]:
            vis = "private" if status["private"] else "public"
            print(f"  ✓ {full}  ({vis}, default={status['default_branch']})")
            valid.append((full, owner, name))
        elif status["reason"] == "not-found":
            print(f"  ✗ {full}: NOT FOUND — check the exact spelling/casing in the GitHub URL")
            overall_ok = False
        elif status["reason"] == "forbidden":
            print(f"  ✗ {full}: FORBIDDEN — the token isn't scoped to this repo "
                  f"(add it to the fine-grained PAT's repository access)")
            overall_ok = False
        else:
            print(f"  ✗ {full}: {status.get('detail', 'error')}")
            overall_ok = False

    if not valid:
        print("\nNo reachable repos to sweep. Fix the names/token above and re-run.")
        return 1
    print(f"\nSweeping {len(valid)} reachable repo(s)...\n")

    for full, owner, name in valid:
        try:
            default = gh.get_default_branch(owner, name)
            repo_paths = gh.get_repo_tree(owner, name, default)
        except Exception as exc:
            print(f"[{full}] could not read repo: {exc}")
            overall_ok = False
            continue

        structure = _structure_findings(cfg, repo_paths, branch="", title="",
                                        changed_files=0, total_changes=0)
        passed, reason = decide_verdict(structure, cfg["fail_on"])
        print(f"[{full}] {'PASS' if passed else 'FAIL'} — {reason} "
              f"({len(structure)} structural finding(s))")

        if cfg["auto_fix"].get("enabled"):
            from .autofix import open_fix_pr
            from .fixes import plan_fixes
            fixes, _ = plan_fixes(structure, repo=name, existing_paths=set(repo_paths))
            if fixes:
                try:
                    result = open_fix_pr(gh, owner, name, fixes, cfg)
                    if result and result.get("html_url"):
                        print(f"[{full}] opened draft fix PR: {result['html_url']}")
                    elif result and result.get("skipped"):
                        print(f"[{full}] fix PR skipped: {result['reason']}")
                except Exception as exc:
                    print(f"[{full}] could not open fix PR: {exc}")

        if not passed:
            overall_ok = False

    return 0 if overall_ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="PR / repo-structure coordinator")
    ap.add_argument("--config", default="pragent.yml")
    ap.add_argument("--event", default=os.environ.get("GITHUB_EVENT_PATH"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--sweep", action="store_true", help="multi-repo scheduled mode")
    ap.add_argument("--repo-path", default=".")
    ap.add_argument("--branch", default="")
    ap.add_argument("--title", default="")
    args = ap.parse_args()

    cfg = cfgmod.load(args.config)

    if args.sweep:
        return run_sweep(cfg)
    if args.dry_run or not args.event:
        return run_dry(cfg, args.repo_path, args.branch, args.title)
    return run_ci(cfg, args.event)


if __name__ == "__main__":
    raise SystemExit(main())
