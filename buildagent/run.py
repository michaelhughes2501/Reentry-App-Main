#!/usr/bin/env python3
"""
Agent 4 — Build-Production agent (entry point).

Usage:
    python -m buildagent.run                # discover + validate (fast)
    python -m buildagent.run --build        # also run the real builds
    python -m buildagent.run --path .

Writes agent-reports/build-agent.json in the shape the PR coordinator (Agent 5)
ingests, so build status surfaces in the combined PR verdict.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config as cfgmod
from .builder import can_build_node, run_build
from .core import SEVERITY_ORDER, BuildResult, Finding, Phase, finding_to_report
from .detect import discover


def _icon(sev: str) -> str:
    return {"critical": "🔴", "high": "🟠", "medium": "🟡",
            "low": "🔵", "info": "⚪"}.get(sev, "•")


def _result_to_findings(r: BuildResult) -> list[Finding]:
    findings: list[Finding] = []
    rel = r.check.config_path
    if not r.success:
        findings.append(Finding(
            severity="high",
            rule="build-failed",
            message=f"Build failed: {r.check.name} (in {r.duration_s:.1f}s).",
            remediation=("Open the build log in the workflow run for the full trace. "
                         "This agent does not modify code to make builds pass — fix the cause "
                         "and push again."),
            phase="build",
        ))
        if r.missing_outputs:
            names = ", ".join(Path(p).name for p in r.missing_outputs)
            findings.append(Finding(
                severity="high",
                rule="build-output-missing",
                message=f"Expected output(s) not produced: {names}",
                remediation="The build completed without producing the artifacts declared "
                            "in the config. Check the build log for errors.",
                phase="build",
            ))
    if r.empty_outputs:
        names = ", ".join(Path(p).name for p in r.empty_outputs)
        findings.append(Finding(
            severity="low",
            rule="build-output-empty",
            message=f"Build produced empty (0-byte) artifact(s): {names}",
            remediation="An empty artifact may be intentional (e.g. CSS-only entry), but it's "
                        "often a sign the entry isn't doing what it looks like. Verify.",
            phase="build",
        ))
    return findings


def run(repo_root: str, cfg: dict) -> int:
    root = Path(repo_root)
    checks, validation_findings = discover(root)
    skip = set(cfg.get("skip_kinds") or [])
    checks = [c for c in checks if c.kind not in skip]

    print(f"Discovered {len(checks)} build target(s).")
    for c in checks:
        print(f"  - {c.name}")
    for f in validation_findings:
        print(f"  {_icon(f.severity)} [{f.severity}] {f.rule}: {f.message}")

    all_findings: list[Finding] = list(validation_findings)
    build_results: list[BuildResult] = []

    if cfg.get("run_build"):
        if not can_build_node() and any(c.kind in {"webpack", "npm-script"} for c in checks):
            print("note: Node/npm not available; skipping Node builds.")
        for c in checks:
            if c.kind in {"webpack", "npm-script"} and not can_build_node():
                continue
            print(f"\nRunning: {c.name}")
            r = run_build(c, root, timeout=cfg["build_timeout_s"])
            build_results.append(r)
            status = "PASS" if r.success else "FAIL"
            print(f"  {status} in {r.duration_s:.1f}s")
            if r.empty_outputs:
                print(f"  warning: empty output(s) {[Path(p).name for p in r.empty_outputs]}")
            if not r.success and r.log_tail:
                print(f"  --- log tail ---\n{r.log_tail}")
            all_findings.extend(_result_to_findings(r))

    # Write the report for Agent 5.
    reports_dir = root / cfg["reports_dir"]
    reports_dir.mkdir(parents=True, exist_ok=True)
    out_path = reports_dir / cfg["report_name"]
    summary_parts = []
    if build_results:
        passed = sum(1 for r in build_results if r.success)
        summary_parts.append(f"{passed}/{len(build_results)} builds passed")
    if validation_findings:
        summary_parts.append(f"{len(validation_findings)} validation issue(s)")
    summary = "; ".join(summary_parts) if summary_parts else "no build targets found"
    report = {
        "agent": "build-production",
        "summary": summary,
        "findings": [finding_to_report(f) for f in all_findings],
    }
    out_path.write_text(json.dumps(report, indent=2))
    print(f"\nReport written to {out_path}")

    # Exit code based on severity threshold.
    threshold = SEVERITY_ORDER.get(cfg["fail_on"], 1)
    worst = min((SEVERITY_ORDER.get(f.severity, 99) for f in all_findings), default=99)
    if worst <= threshold:
        print("::error::Build agent found issues at or above the fail-on threshold.")
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Build-production agent")
    ap.add_argument("--path", default=".")
    ap.add_argument("--config", default="buildagent.yml")
    ap.add_argument("--build", action="store_true",
                    help="run the real builds (overrides config.run_build)")
    ap.add_argument("--no-build", action="store_true",
                    help="validation only (overrides config.run_build)")
    args = ap.parse_args()
    cfg = cfgmod.load(args.config)
    if args.build:
        cfg["run_build"] = True
    if args.no_build:
        cfg["run_build"] = False
    return run(args.path, cfg)


if __name__ == "__main__":
    raise SystemExit(main())
