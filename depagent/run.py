#!/usr/bin/env python3
"""
Agent 3 — Dependency & Health-Check agent (entry point).

Runs on a schedule (or on demand). It:
  1. discovers dependency manifests in the repo
  2. checks each dependency for outdated versions (registry) and known
     vulnerabilities (OSV.dev)
  3. writes a JSON report into agent-reports/ for the PR coordinator
  4. prints a human summary and sets an exit code for CI gating

Usage:
    python -m depagent.run                 # scan current dir, default config
    python -m depagent.run --path .        # explicit path
    python -m depagent.run --no-vulns      # skip OSV (faster, outdated-only)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config as cfgmod
from .core import SEVERITY_ORDER, DepFinding
from .parsers import parse_manifest
from .scanner import scan_dependencies


def discover_manifests(root: str, patterns: list[str], skip_dirs: list[str]) -> list[Path]:
    base = Path(root)
    skip = set(skip_dirs)
    found: set[Path] = set()
    for pat in patterns:
        for p in base.glob(pat):
            if p.is_file() and not (set(p.relative_to(base).parts) & skip):
                found.add(p)
    return sorted(found)


def _icon(sev: str) -> str:
    return {"critical": "🔴", "high": "🟠", "medium": "🟡",
            "low": "🔵", "info": "⚪"}.get(sev, "•")


def run(root: str, cfg: dict, check_vulns: bool) -> int:
    manifests = discover_manifests(root, cfg["manifests"], cfg["skip_dirs"])
    deps = []
    for m in manifests:
        try:
            deps.extend(parse_manifest(str(m.relative_to(root)),
                                       m.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue

    # Apply ignore list.
    ignore = set(cfg.get("ignore") or [])
    deps = [d for d in deps if d.name not in ignore]

    findings = scan_dependencies(deps, check_vulns=check_vulns and cfg["check_vulns"])

    # Build report findings (only things worth reporting).
    report_findings = []
    for f in findings:
        if f.vulns:
            report_findings.append(f.to_report_finding())
        elif f.is_outdated and cfg["check_outdated"]:
            report_findings.append(f.to_report_finding())

    # Summary counts.
    vuln_count = sum(1 for f in findings if f.vulns)
    outdated_count = sum(1 for f in findings if f.is_outdated)
    unknown = [f for f in findings if f.notes]

    print(f"Scanned {len(manifests)} manifest(s), {len(findings)} dependency entr(ies).")
    print(f"  {vuln_count} with known vulnerabilities, {outdated_count} outdated.")
    if unknown:
        print(f"  {len(unknown)} with incomplete data (registry/OSV unreachable).")

    # Print the notable findings.
    for f in sorted(findings, key=lambda x: SEVERITY_ORDER.get(x.worst_severity or "info", 99)):
        if f.vulns:
            for v in f.vulns:
                print(f"  {_icon(v.severity)} [{v.severity}] {f.dependency.name} "
                      f"{f.dependency.current}: {v.id} "
                      f"{'(fix: ' + v.fixed_in + ')' if v.fixed_in else ''}")
    # Write report for the PR coordinator.
    reports_dir = Path(root) / cfg["reports_dir"]
    reports_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "agent": "dependency-agent",
        "summary": f"{vuln_count} vulnerable, {outdated_count} outdated",
        "findings": report_findings,
    }
    out_path = reports_dir / cfg["report_name"]
    out_path.write_text(json.dumps(report, indent=2))
    print(f"Report written to {out_path}")

    # Decide exit code.
    threshold = SEVERITY_ORDER.get(cfg["fail_on"], 1)
    worst = min((SEVERITY_ORDER.get(f.worst_severity or "info", 99) for f in findings),
                default=99)
    fail = worst <= threshold
    if cfg.get("fail_on_outdated") and outdated_count:
        fail = True
    if fail:
        print("::error::Dependency check failed (vulnerabilities at/above threshold "
              "or outdated gate).")
    return 1 if fail else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Dependency & health-check agent")
    ap.add_argument("--path", default=".")
    ap.add_argument("--config", default="depagent.yml")
    ap.add_argument("--no-vulns", action="store_true", help="skip OSV vuln checks")
    args = ap.parse_args()
    cfg = cfgmod.load(args.config)
    return run(args.path, cfg, check_vulns=not args.no_vulns)


if __name__ == "__main__":
    raise SystemExit(main())
