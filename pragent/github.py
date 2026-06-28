"""
A small GitHub REST client for Agent 5 (the PR / repo-structure agent).

Deliberately uses only the Python standard library (urllib) so the agent has
zero install footprint in CI beyond PyYAML.

AUTH — read this:
    The token is read from the environment (GITHUB_TOKEN). This agent NEVER
    contains, logs, or transmits the token anywhere except GitHub's API over
    HTTPS. You create the token; the code only consumes it. See README for the
    exact least-privilege permission checklist.

In a GitHub Actions run, GITHUB_TOKEN is provided automatically and is scoped
to the current repo. For multi-repo operation you supply a fine-grained PAT as
a secret instead.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass


GITHUB_API = "https://api.github.com"


class GitHubError(Exception):
    pass


class AuthError(GitHubError):
    """Raised on 401/403 — almost always a missing or under-scoped token."""


@dataclass
class PRRef:
    owner: str
    repo: str
    number: int


class GitHubClient:
    def __init__(self, token: str | None = None, *, base_url: str = GITHUB_API):
        self.token = token or os.environ.get("GITHUB_TOKEN", "")
        self.base_url = base_url.rstrip("/")
        if not self.token:
            raise AuthError(
                "No GitHub token found. Set GITHUB_TOKEN (the built-in Actions "
                "token, or a fine-grained PAT for multi-repo use)."
            )

    # -- low-level request -------------------------------------------------

    def _request(self, method: str, path: str, body: dict | None = None) -> object:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        req.add_header("User-Agent", "pr-agent")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if e.code in (401, 403):
                raise AuthError(
                    f"GitHub returned {e.code}. The token is missing a required "
                    f"permission or is invalid. Detail: {detail[:200]}"
                ) from e
            raise GitHubError(f"GitHub {method} {path} -> {e.code}: {detail[:200]}") from e
        except urllib.error.URLError as e:
            raise GitHubError(f"Network error talking to GitHub: {e}") from e

    # -- typed helpers -----------------------------------------------------

    def get_pr(self, ref: PRRef) -> dict:
        return self._request("GET", f"/repos/{ref.owner}/{ref.repo}/pulls/{ref.number}")

    def list_pr_files(self, ref: PRRef) -> list[dict]:
        files, page = [], 1
        while True:
            batch = self._request(
                "GET",
                f"/repos/{ref.owner}/{ref.repo}/pulls/{ref.number}/files?per_page=100&page={page}",
            )
            if not batch:
                break
            files.extend(batch)
            if len(batch) < 100:
                break
            page += 1
        return files

    def get_repo_tree(self, owner: str, repo: str, branch: str = "HEAD") -> list[str]:
        """Return all file paths in the repo at `branch` (recursive)."""
        info = self._request("GET", f"/repos/{owner}/{repo}/git/trees/{branch}?recursive=1")
        tree = info.get("tree", []) if isinstance(info, dict) else []
        return [item["path"] for item in tree if item.get("type") == "blob"]

    def upsert_comment(self, ref: PRRef, body: str, marker: str) -> dict:
        """
        Post a comment, or update the agent's previous one if it exists.
        `marker` is a hidden HTML token used to find our own prior comment so we
        don't spam a new comment on every run.
        """
        comments = self._request(
            "GET", f"/repos/{ref.owner}/{ref.repo}/issues/{ref.number}/comments?per_page=100"
        )
        existing = None
        if isinstance(comments, list):
            for c in comments:
                if marker in (c.get("body") or ""):
                    existing = c
                    break
        full_body = f"{body}\n\n<!-- {marker} -->"
        if existing:
            return self._request(
                "PATCH",
                f"/repos/{ref.owner}/{ref.repo}/issues/comments/{existing['id']}",
                {"body": full_body},
            )
        return self._request(
            "POST",
            f"/repos/{ref.owner}/{ref.repo}/issues/{ref.number}/comments",
            {"body": full_body},
        )

    def set_status(self, owner: str, repo: str, sha: str, *, state: str,
                   context: str, description: str) -> dict:
        """state: success | failure | pending | error"""
        return self._request(
            "POST", f"/repos/{owner}/{repo}/statuses/{sha}",
            {"state": state, "context": context, "description": description[:140]},
        )

    def list_open_prs(self, owner: str, repo: str) -> list[dict]:
        return self._request("GET", f"/repos/{owner}/{repo}/pulls?state=open&per_page=100")

    def check_repo(self, owner: str, repo: str) -> dict:
        """
        Preflight a repo before the sweep touches it. Returns a status dict:
          {"ok": True, "default_branch": "...", "private": bool}        -> reachable
          {"ok": False, "reason": "not-found"}                           -> wrong name (404)
          {"ok": False, "reason": "forbidden"}                           -> token lacks access (403)
          {"ok": False, "reason": "error", "detail": "..."}              -> something else
        This turns a silently-skipped typo into an explicit, actionable line.
        """
        try:
            info = self._request("GET", f"/repos/{owner}/{repo}")
            return {"ok": True,
                    "default_branch": info.get("default_branch", "main"),
                    "private": bool(info.get("private"))}
        except AuthError:
            return {"ok": False, "reason": "forbidden"}
        except GitHubError as exc:
            msg = str(exc)
            if "-> 404" in msg or "404" in msg:
                return {"ok": False, "reason": "not-found"}
            return {"ok": False, "reason": "error", "detail": msg[:120]}

    # -- write operations for auto-PR (used only when enabled in config) ----

    def get_default_branch(self, owner: str, repo: str) -> str:
        info = self._request("GET", f"/repos/{owner}/{repo}")
        return info.get("default_branch", "main")

    def get_ref_sha(self, owner: str, repo: str, branch: str) -> str:
        ref = self._request("GET", f"/repos/{owner}/{repo}/git/ref/heads/{branch}")
        return ref["object"]["sha"]

    def branch_exists(self, owner: str, repo: str, branch: str) -> bool:
        try:
            self._request("GET", f"/repos/{owner}/{repo}/git/ref/heads/{branch}")
            return True
        except GitHubError:
            return False

    def create_branch(self, owner: str, repo: str, new_branch: str, from_sha: str) -> dict:
        return self._request(
            "POST", f"/repos/{owner}/{repo}/git/refs",
            {"ref": f"refs/heads/{new_branch}", "sha": from_sha},
        )

    def put_file(self, owner: str, repo: str, path: str, *, content_b64: str,
                 message: str, branch: str, existing_sha: str | None = None) -> dict:
        """Create or update a single file on `branch` (Contents API)."""
        body = {"message": message, "content": content_b64, "branch": branch}
        if existing_sha:
            body["sha"] = existing_sha
        return self._request(
            "PUT", f"/repos/{owner}/{repo}/contents/{path}", body
        )

    def open_pr(self, owner: str, repo: str, *, title: str, head: str,
                base: str, body: str, draft: bool = True) -> dict:
        return self._request(
            "POST", f"/repos/{owner}/{repo}/pulls",
            {"title": title, "head": head, "base": base, "body": body, "draft": draft},
        )

    def add_labels(self, owner: str, repo: str, number: int, labels: list[str]) -> dict:
        return self._request(
            "POST", f"/repos/{owner}/{repo}/issues/{number}/labels",
            {"labels": labels},
        )
