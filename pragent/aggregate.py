"""
The coordinator piece: aggregate findings from the OTHER agents so Agent 5 can
post a single combined verdict on the PR.

How other agents feed in: each writes a small JSON file into a shared directory
(default: ./agent-reports/). The PR agent reads them all. This keeps the agents
decoupled — they don't call each other, they just drop reports.

Expected report shape (any agent can emit this):

    {
      "agent": "security-scanner",
      "summary": "2 critical, 1 high",
      "findings": [
        {"severity": "critical", "rule": "secret-aws-access-key",
         "message": "Possible hard-coded secret", "remediation": "..."}
      ]
    }

Missing/malformed reports are noted, not fatal — a broken upstream agent should
degrade the verdict gracefully, not crash the coordinator.
"""

from __future__ import annotations

import json
from pathlib import Path

from .validators import Finding, SEVERITY_ORDER


def ingest_reports(reports_dir: str | Path) -> tuple[dict[str, list[Finding]], list[str]]:
    """
    Returns (findings_by_agent, notes).
    `notes` records any reports that couldn't be read.
    """
    d = Path(reports_dir)
    findings_by_agent: dict[str, list[Finding]] = {}
    notes: list[str] = []

    if not d.exists():
        return findings_by_agent, notes

    for f in sorted(d.glob("*.json")):
        try:
            data = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            notes.append(f"Could not read report {f.name}: {exc}")
            continue

        agent = data.get("agent", f.stem)
        raw_findings = data.get("findings", [])
        parsed: list[Finding] = []
        for rf in raw_findings:
            try:
                parsed.append(Finding(
                    severity=rf.get("severity", "info"),
                    rule=rf.get("rule", "unknown"),
                    message=rf.get("message", ""),
                    remediation=rf.get("remediation", ""),
                ))
            except Exception:
                notes.append(f"Skipped a malformed finding in {f.name}")
        findings_by_agent[agent] = parsed

    return findings_by_agent, notes


def worst_severity(findings: list[Finding]) -> str | None:
    if not findings:
        return None
    return min(findings, key=lambda f: SEVERITY_ORDER.get(f.severity, 99)).severity


def decide_verdict(all_findings: list[Finding], fail_on: str) -> tuple[bool, str]:
    """
    Returns (passed, reason). Fails if anything at or above `fail_on` is present.
    """
    threshold = SEVERITY_ORDER.get(fail_on, 1)
    blocking = [f for f in all_findings if SEVERITY_ORDER.get(f.severity, 99) <= threshold]
    if blocking:
        counts: dict[str, int] = {}
        for f in blocking:
            counts[f.severity] = counts.get(f.severity, 0) + 1
        summary = ", ".join(f"{counts[s]} {s}" for s in SEVERITY_ORDER if s in counts)
        return False, f"Blocking issues: {summary}"
    return True, "All checks passed (or only non-blocking issues found)."
