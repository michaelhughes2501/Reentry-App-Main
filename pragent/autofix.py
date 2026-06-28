"""
Turns planned FileFixes into a single draft PR. Used only when
auto_fix.enabled is True in config.

Flow:
  1. branch off the base (default) branch
  2. commit each scaffolding file to that branch
  3. open a DRAFT pull request, labeled, for a human to review
Nothing is merged. If the branch already exists (a prior run), we skip rather
than duplicate.
"""

from __future__ import annotations

import time

from .fixes import FileFix
from .github import GitHubClient


def open_fix_pr(gh: GitHubClient, owner: str, repo: str,
                fixes: list[FileFix], cfg: dict) -> dict | None:
    if not fixes:
        return None
    af = cfg["auto_fix"]
    base = gh.get_default_branch(owner, repo)
    base_sha = gh.get_ref_sha(owner, repo, base)

    # Deterministic-ish branch name; include a short time tag to avoid clashes.
    stamp = time.strftime("%Y%m%d")
    branch = f"{af['branch_prefix']}/structure-{stamp}"
    if gh.branch_exists(owner, repo, branch):
        # A fix PR for today already exists; don't pile on.
        return {"skipped": True, "reason": f"branch {branch} already exists"}

    gh.create_branch(owner, repo, branch, base_sha)

    for fx in fixes:
        gh.put_file(
            owner, repo, fx.path,
            content_b64=fx.content_b64,
            message=f"chore(pr-agent): {fx.reason}",
            branch=branch,
        )

    body_lines = [
        "## 🤖 PR Agent — proposed scaffolding fixes",
        "",
        "These are **mechanical, reversible** changes only. The agent does not "
        "touch application code or security logic.",
        "",
        "| File | Why |",
        "|---|---|",
    ]
    for fx in fixes:
        body_lines.append(f"| `{fx.path}` | {fx.reason} |")
    body_lines += [
        "",
        "**Review before merging.** This PR was opened by the agent and was not "
        "auto-merged — a human approves and merges.",
    ]
    body = "\n".join(body_lines)

    pr = gh.open_pr(owner, repo, title="chore(pr-agent): repository scaffolding fixes",
                    head=branch, base=base, body=body, draft=af.get("draft", True))

    labels = af.get("labels") or []
    if labels and pr.get("number"):
        try:
            gh.add_labels(owner, repo, pr["number"], labels)
        except Exception:
            pass  # labels are nice-to-have, not worth failing the run

    return pr
