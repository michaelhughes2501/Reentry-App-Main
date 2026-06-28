#!/usr/bin/env python3
"""
Agent 1 — Security & YAML Scanner (entry point).

Usage:
    python -m scanner.run [PATH ...] [--fail-on SEVERITY] [--format text|markdown]

Walks the given paths (default: current dir), scans every .yml/.yaml file,
and prints findings. Exits non-zero if anything at or above --fail-on is found,
which is what makes the GitHub Actions check go red.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .yaml_checks import Finding, SEVERITY_ORDER, scan_file

YAML_SUFFIXES = {".yml", ".yaml"}
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build"}


def discover(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for p in paths:
        root = Path(p)
        if root.is_file() and root.suffix.lower() in YAML_SUFFIXES:
            files.append(root)
        elif root.is_dir():
            for f in root.rglob("*"):
                if f.suffix.lower() in YAML_SUFFIXES and not (set(f.parts) & SKIP_DIRS):
                    files.append(f)
    return sorted(set(files))


_ICON = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵", "info": "⚪"}


def render_text(findings: list[Finding], scanned: int) -> str:
    if not findings:
        return f"✅ Scanned {scanned} YAML file(s). No issues found."
    lines = [f"Scanned {scanned} YAML file(s). Found {len(findings)} issue(s):", ""]
    for f in sorted(findings, key=Finding.sort_key):
        loc = f"{f.path}:{f.line}" if f.line else f.path
        lines.append(f"{_ICON.get(f.severity, '•')} [{f.severity.upper()}] {loc}  ({f.rule})")
        lines.append(f"    {f.message}")
        if f.remediation:
            lines.append(f"    → {f.remediation}")
        lines.append("")
    return "\n".join(lines)


def render_markdown(findings: list[Finding], scanned: int) -> str:
    if not findings:
        return f"### 🛡️ Security & YAML Scan\n\n✅ Scanned **{scanned}** YAML file(s). No issues found."
    counts: dict[str, int] = {}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    summary = " · ".join(f"{_ICON[s]} {counts[s]} {s}" for s in SEVERITY_ORDER if s in counts)
    rows = ["### 🛡️ Security & YAML Scan", "",
            f"Scanned **{scanned}** file(s) — {summary}", "",
            "| Severity | Location | Rule | Issue |", "|---|---|---|---|"]
    for f in sorted(findings, key=Finding.sort_key):
        loc = f"`{f.path}:{f.line}`" if f.line else f"`{f.path}`"
        msg = f.message + (f"<br>→ _{f.remediation}_" if f.remediation else "")
        rows.append(f"| {_ICON.get(f.severity,'•')} {f.severity} | {loc} | `{f.rule}` | {msg} |")
    return "\n".join(rows)


def render_json(findings: list[Finding], scanned: int) -> str:
    """Emit the Agent-5 ingestion shape so the security findings flow into the
    PR coordinator's combined verdict."""
    import json
    out = {
        "agent": "security-scanner",
        "summary": f"{len(findings)} finding(s) across {scanned} file(s)",
        "findings": [
            {
                "severity": f.severity,
                "rule": f.rule,
                "message": f.message + (f" ({f.path}:{f.line})" if f.line else f" ({f.path})"),
                "remediation": f.remediation,
            }
            for f in sorted(findings, key=Finding.sort_key)
        ],
    }
    return json.dumps(out, indent=2)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Security & YAML scanner")
    ap.add_argument("paths", nargs="*", default=["."], help="files or dirs to scan")
    ap.add_argument("--fail-on", default="high",
                    choices=list(SEVERITY_ORDER), help="minimum severity that fails the run")
    ap.add_argument("--format", default="text", choices=["text", "markdown", "json"])
    args = ap.parse_args(argv)

    files = discover(args.paths or ["."])
    findings: list[Finding] = []
    for f in files:
        findings.extend(scan_file(f))

    if args.format == "json":
        report = render_json(findings, len(files))
    elif args.format == "markdown":
        report = render_markdown(findings, len(files))
    else:
        report = render_text(findings, len(files))
    print(report)

    threshold = SEVERITY_ORDER[args.fail_on]
    worst = min((SEVERITY_ORDER[f.severity] for f in findings), default=99)
    return 1 if worst <= threshold else 0


if __name__ == "__main__":
    sys.exit(main())
