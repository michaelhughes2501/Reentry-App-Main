"""
Validators for Agent 5. Each takes plain data (file lists, PR metadata) and
returns Findings — no network calls here, so everything is unit-testable.

Rules are driven by a config dict (loaded from pragent.yml) so you tune what
"correct structure" means without editing code.
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


@dataclass
class Finding:
    severity: str
    rule: str
    message: str
    remediation: str = ""

    def sort_key(self):
        return (SEVERITY_ORDER.get(self.severity, 99), self.rule)


# ---------------------------------------------------------------------------
# Required files
# ---------------------------------------------------------------------------

def check_required_files(repo_paths: list[str], required: list[str]) -> list[Finding]:
    """Each entry in `required` is a glob; at least one path must match it."""
    findings = []
    present = set(repo_paths)
    for pattern in required:
        matched = any(fnmatch.fnmatch(p, pattern) for p in present)
        if not matched:
            findings.append(Finding(
                severity="medium",
                rule="required-file-missing",
                message=f"Required file not found: `{pattern}`",
                remediation=f"Add a file matching `{pattern}` to the repo root or expected location.",
            ))
    return findings


# ---------------------------------------------------------------------------
# Forbidden / dangerous paths (things that shouldn't be committed)
# ---------------------------------------------------------------------------

def check_forbidden_paths(repo_paths: list[str], forbidden: list[str]) -> list[Finding]:
    findings = []
    for pattern in forbidden:
        for p in repo_paths:
            if fnmatch.fnmatch(p, pattern):
                findings.append(Finding(
                    severity="high",
                    rule="forbidden-path",
                    message=f"File should not be committed: `{p}` (matches `{pattern}`)",
                    remediation="Remove it from version control and add the pattern to .gitignore. "
                                "Rotate any secret it contained.",
                ))
    return findings


# ---------------------------------------------------------------------------
# Directory layout — declared top-level dirs should exist
# ---------------------------------------------------------------------------

def check_directory_layout(repo_paths: list[str], expected_dirs: list[str]) -> list[Finding]:
    findings = []
    top_dirs = {p.split("/", 1)[0] for p in repo_paths if "/" in p}
    for d in expected_dirs:
        clean = d.rstrip("/")
        if clean not in top_dirs:
            findings.append(Finding(
                severity="low",
                rule="layout-missing-dir",
                message=f"Expected directory not present: `{clean}/`",
                remediation=f"Create `{clean}/` or update the layout spec in pragent.yml.",
            ))
    return findings


# ---------------------------------------------------------------------------
# Branch naming convention
# ---------------------------------------------------------------------------

def check_branch_name(branch: str, pattern: str | None) -> list[Finding]:
    if not pattern or not branch:
        return []
    if re.fullmatch(pattern, branch):
        return []
    return [Finding(
        severity="low",
        rule="branch-name",
        message=f"Branch `{branch}` does not match convention `{pattern}`.",
        remediation="Rename the branch to match, e.g. feature/short-description or fix/issue-123.",
    )]


# ---------------------------------------------------------------------------
# PR title convention (e.g. Conventional Commits)
# ---------------------------------------------------------------------------

def check_pr_title(title: str, pattern: str | None) -> list[Finding]:
    if not pattern or not title:
        return []
    if re.match(pattern, title):
        return []
    return [Finding(
        severity="low",
        rule="pr-title",
        message=f"PR title does not match convention: \"{title}\"",
        remediation="Use a conventional prefix, e.g. `feat:`, `fix:`, `docs:`, `chore:`.",
    )]


# ---------------------------------------------------------------------------
# PR size guard — flag very large PRs (hard to review safely)
# ---------------------------------------------------------------------------

def check_pr_size(changed_files: int, total_changes: int,
                  max_files: int, max_changes: int) -> list[Finding]:
    findings = []
    if max_files and changed_files > max_files:
        findings.append(Finding(
            severity="info",
            rule="pr-large-filecount",
            message=f"PR touches {changed_files} files (soft limit {max_files}).",
            remediation="Consider splitting into smaller, focused PRs for easier review.",
        ))
    if max_changes and total_changes > max_changes:
        findings.append(Finding(
            severity="info",
            rule="pr-large-diff",
            message=f"PR changes {total_changes} lines (soft limit {max_changes}).",
            remediation="Large diffs are harder to review safely; consider splitting.",
        ))
    return findings
