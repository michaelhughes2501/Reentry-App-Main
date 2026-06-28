"""
Open auto-bump PRs on GitHub. Reuses Agent 5's GitHubClient so there's one
auth path, one place to maintain.

Safety rails:
  - Hard cap on open auto-bump PRs (config). Skip rather than pile on.
  - One branch per package (deterministic name). If the branch exists, update
    it in place rather than open a duplicate — that's how a 1.2.4 → 1.2.5
    refresh works without spawning a second PR.
  - NEVER auto-merge. Agent 4's build (wired in) decides whether it's safe.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

from .bumper import BumpProposal, is_vuln_priority
from .editor import apply_bump


# We import the PR-agent client lazily so the dep agent can be used without it.
def _load_client():
    try:
        # Same-process import works when both agents are installed in the env.
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "pr-agent"))
        from pragent.github import GitHubClient  # type: ignore
        return GitHubClient
    except ImportError:
        return None


def branch_name_for(proposal: BumpProposal, prefix: str = "deps") -> str:
    """Deterministic per-package branch — same proposal lands in the same branch."""
    pkg = proposal.finding.dependency.name.lower().replace("/", "-")
    return f"{prefix}/{pkg}-to-{proposal.to_version}"


def _pr_body(proposal: BumpProposal) -> str:
    f = proposal.finding
    d = f.dependency
    lines = [
        f"## Dependency bump proposed by the dependency agent",
        "",
        f"- **Package:** `{d.name}` ({d.ecosystem})",
        f"- **From:** `{d.current}`  →  **To:** `{proposal.to_version}`",
        f"- **Kind:** {proposal.kind.value}",
        f"- **Reason:** {proposal.reason}",
    ]
    if proposal.fixes_vulns:
        lines.append(f"- **Fixes vulnerabilities:** {', '.join(proposal.fixes_vulns)}")
    lines += [
        "",
        "### What happens next",
        "",
        "The build agent (Agent 4) runs the full production build against this "
        "PR's new version. If it breaks, the PR's status check will go red and "
        "this PR should not be merged. A human reviews and merges only after a "
        "green verdict.",
        "",
        "The dependency agent does **not** auto-merge.",
    ]
    return "\n".join(lines)


def open_bump_pr(client, owner: str, repo: str, proposal: BumpProposal,
                 manifest_path: str, new_content: str, *, branch_prefix: str,
                 labels: list[str], draft: bool) -> dict:
    """Open or update a per-package bump PR. Returns the PR dict (or status dict)."""
    branch = branch_name_for(proposal, branch_prefix)
    base = client.get_default_branch(owner, repo)
    base_sha = client.get_ref_sha(owner, repo, base)

    if client.branch_exists(owner, repo, branch):
        # Update existing branch's manifest in place; same PR refreshes.
        action = "updated"
    else:
        client.create_branch(owner, repo, branch, base_sha)
        action = "created"

    # Need the file's existing sha on the branch to update it.
    existing_sha = None
    try:
        # Use the contents API to fetch the current file on the branch.
        path_norm = manifest_path.replace("\\", "/")
        meta = client._request(
            "GET",
            f"/repos/{owner}/{repo}/contents/{path_norm}?ref={branch}",
        )
        if isinstance(meta, dict):
            existing_sha = meta.get("sha")
    except Exception:
        existing_sha = None

    content_b64 = base64.b64encode(new_content.encode()).decode()
    commit_msg = f"chore(deps): bump {proposal.finding.dependency.name} to {proposal.to_version}"
    client.put_file(
        owner, repo, manifest_path,
        content_b64=content_b64, message=commit_msg,
        branch=branch, existing_sha=existing_sha,
    )

    if action == "updated":
        # PR may already exist; find it.
        for p in client.list_open_prs(owner, repo):
            if p.get("head", {}).get("ref") == branch:
                return {"updated": True, "pr": p, "branch": branch}
        # No PR yet (rare — branch existed but no PR); fall through to open one.

    title = commit_msg
    if is_vuln_priority(proposal):
        title = f"security: {commit_msg}"
    pr = client.open_pr(
        owner, repo,
        title=title, head=branch, base=base,
        body=_pr_body(proposal), draft=draft,
    )
    if labels and pr.get("number"):
        try:
            client.add_labels(owner, repo, pr["number"], labels)
        except Exception:
            pass
    return {"created": True, "pr": pr, "branch": branch}


def count_open_bump_prs(client, owner: str, repo: str, branch_prefix: str) -> int:
    n = 0
    for p in client.list_open_prs(owner, repo):
        if p.get("head", {}).get("ref", "").startswith(f"{branch_prefix}/"):
            n += 1
    return n
