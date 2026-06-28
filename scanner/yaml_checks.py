"""
YAML security & correctness checks.

This module is the heart of Agent 1 (the YAML / security expert).
It is intentionally dependency-light (only PyYAML) so it runs fast in CI.

Design principle: DETECT and REPORT. Nothing here rewrites your files.
Findings are surfaced to a human who decides what to merge.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import yaml


# ---------------------------------------------------------------------------
# Finding model
# ---------------------------------------------------------------------------

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


@dataclass
class Finding:
    path: str
    line: int | None
    severity: str          # critical | high | medium | low | info
    rule: str              # short machine id, e.g. "yaml-syntax"
    message: str           # human explanation
    remediation: str = ""  # what to do about it

    def sort_key(self) -> tuple:
        return (SEVERITY_ORDER.get(self.severity, 99), self.path, self.line or 0)


# ---------------------------------------------------------------------------
# Rule: YAML must parse
# ---------------------------------------------------------------------------

def check_syntax(path: Path, text: str) -> list[Finding]:
    findings: list[Finding] = []
    try:
        # safe_load_all handles multi-document files (--- separators)
        list(yaml.safe_load_all(text))
    except yaml.YAMLError as exc:
        line = None
        mark = getattr(exc, "problem_mark", None)
        if mark is not None:
            line = mark.line + 1
        findings.append(
            Finding(
                path=str(path),
                line=line,
                severity="high",
                rule="yaml-syntax",
                message=f"YAML failed to parse: {getattr(exc, 'problem', exc)}",
                remediation="Fix the syntax error. A file that won't parse can't be deployed.",
            )
        )
    return findings


# ---------------------------------------------------------------------------
# Rule: secrets that look hard-coded
# ---------------------------------------------------------------------------

# Patterns are deliberately conservative to limit false positives.
# "high_confidence" patterns are specific enough that we report them even if
# the line also contains a word like "example" — a real AKIA-prefixed key is
# a real key regardless of what else is on the line.
_SECRET_PATTERNS: list[tuple[str, re.Pattern, bool]] = [
    ("aws-access-key", re.compile(r"AKIA[0-9A-Z]{16}"), True),
    ("private-key-block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"), True),
    ("github-token", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"), True),
    ("slack-token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), True),
    ("generic-api-key", re.compile(
        r"(?i)(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['\"]?[A-Za-z0-9/+=_\-]{16,}['\"]?"
    ), False),
]

# Things that look like secrets but are clearly placeholders / references.
_PLACEHOLDER = re.compile(
    r"(?i)(\$\{?[A-Z_]+\}?|<[^>]+>|your[-_]?\w+|example|changeme|placeholder|xxx+|\*{3,}|secrets\.[A-Z_]+|vault:|env:)"
)


def check_secrets(path: Path, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for i, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        for rule_id, pattern, high_confidence in _SECRET_PATTERNS:
            m = pattern.search(line)
            if not m:
                continue
            # Skip obvious placeholders / env references — unless the pattern is
            # specific enough that a match is almost certainly a real secret.
            if not high_confidence and _PLACEHOLDER.search(line):
                continue
            findings.append(
                Finding(
                    path=str(path),
                    line=i,
                    severity="critical",
                    rule=f"secret-{rule_id}",
                    message=f"Possible hard-coded secret ({rule_id}).",
                    remediation=(
                        "Move this value to a secret store (GitHub Secrets, Vault, env var) "
                        "and rotate it if it was ever committed."
                    ),
                )
            )
            break  # one finding per line is enough
    return findings


# ---------------------------------------------------------------------------
# Rule: GitHub Actions workflow hardening
# ---------------------------------------------------------------------------

def _iter_workflow_jobs(doc: dict) -> Iterable[tuple[str, dict]]:
    jobs = doc.get("jobs")
    if isinstance(jobs, dict):
        for name, job in jobs.items():
            if isinstance(job, dict):
                yield name, job


def check_github_actions(path: Path, text: str) -> list[Finding]:
    """Hardening checks that only apply to files under .github/workflows/."""
    findings: list[Finding] = []
    if ".github/workflows" not in str(path).replace("\\", "/"):
        return findings

    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError:
        return findings  # syntax check already reported this
    if not isinstance(doc, dict):
        return findings

    # 1. Top-level permissions should be set (least privilege).
    if "permissions" not in doc:
        findings.append(
            Finding(
                path=str(path),
                line=1,
                severity="medium",
                rule="actions-permissions-missing",
                message="Workflow has no explicit top-level 'permissions' block.",
                remediation="Add 'permissions: read-all' (or narrower) so the GITHUB_TOKEN isn't broadly writable by default.",
            )
        )
    elif doc.get("permissions") in ("write-all", {"contents": "write"}) and "write-all" == doc.get("permissions"):
        findings.append(
            Finding(
                path=str(path),
                line=1,
                severity="high",
                rule="actions-permissions-write-all",
                message="Workflow grants 'write-all' permissions.",
                remediation="Scope permissions to only what each job needs instead of write-all.",
            )
        )

    # 2. Actions pinned to a mutable tag instead of a commit SHA.
    for i, line in enumerate(text.splitlines(), start=1):
        m = re.search(r"uses:\s*([\w.\-]+/[\w.\-]+)@([\w.\-]+)", line)
        if not m:
            continue
        ref = m.group(2)
        # A full commit SHA is 40 hex chars; anything shorter is a mutable ref.
        if not re.fullmatch(r"[0-9a-f]{40}", ref):
            findings.append(
                Finding(
                    path=str(path),
                    line=i,
                    severity="low",
                    rule="actions-unpinned",
                    message=f"Action '{m.group(1)}' is pinned to '{ref}', a mutable tag.",
                    remediation="Pin third-party actions to a full commit SHA to prevent supply-chain tampering.",
                )
            )

    # 3. Dangerous use of untrusted input in run steps (script injection).
    #    Structural check: walk every job's steps and look at each step's
    #    `run:` STRING. Interpolation in `env:` is the recommended safe pattern
    #    (it's what we tell people to do in the remediation), so we explicitly
    #    don't flag it — only inlining into the shell command itself is risky.
    untrusted = re.compile(
        r"\$\{\{\s*github\.event\.(?:issue|pull_request|comment|review|head_ref|"
        r"pull_request\.title|pull_request\.body|pull_request\.head\.ref)[^}]*\}\}"
    )

    def _step_run_strings():
        for job_name, job in _iter_workflow_jobs(doc):
            steps = job.get("steps")
            if not isinstance(steps, list):
                continue
            for step in steps:
                if isinstance(step, dict) and isinstance(step.get("run"), str):
                    yield step["run"]

    # Locate the run: scalar in source to attach a line number. We search the
    # raw text for the matching content; a few false-line-number cases are
    # acceptable since the finding itself is precise.
    for run_text in _step_run_strings():
        if not untrusted.search(run_text):
            continue
        # Find the line where this run: block starts so the finding has a location.
        first_line = run_text.splitlines()[0] if run_text else ""
        line_no = None
        for i, line in enumerate(text.splitlines(), start=1):
            if first_line and first_line.strip() and first_line.strip() in line:
                line_no = i
                break
        findings.append(
            Finding(
                path=str(path),
                line=line_no,
                severity="high",
                rule="actions-script-injection",
                message="Untrusted github.event input interpolated directly into a run script.",
                remediation="Pass the value through an env: block on the step "
                            "(env vars are evaluated safely) instead of inlining ${{ ... }} "
                            "into the shell command.",
            )
        )

    return findings


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

ALL_CHECKS = (check_syntax, check_secrets, check_github_actions)


def scan_text(path: Path, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for check in ALL_CHECKS:
        try:
            findings.extend(check(path, text))
        except Exception as exc:  # a buggy rule should never crash the whole run
            findings.append(
                Finding(
                    path=str(path),
                    line=None,
                    severity="info",
                    rule="scanner-error",
                    message=f"Rule {check.__name__} errored: {exc}",
                )
            )
    return findings


def scan_file(path: Path) -> list[Finding]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return [Finding(str(path), None, "info", "read-error", f"Could not read file: {exc}")]
    return scan_text(path, text)
