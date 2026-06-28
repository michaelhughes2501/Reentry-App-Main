"""Render the combined verdict as a markdown PR comment."""

from __future__ import annotations

from .validators import Finding, SEVERITY_ORDER

_ICON = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵", "info": "⚪"}

COMMENT_MARKER = "pr-agent-verdict"  # hidden token to find/update our own comment


def _table(findings: list[Finding]) -> str:
    rows = ["| Severity | Rule | Issue |", "|---|---|---|"]
    for f in sorted(findings, key=Finding.sort_key):
        msg = f.message + (f"<br>→ _{f.remediation}_" if f.remediation else "")
        rows.append(f"| {_ICON.get(f.severity,'•')} {f.severity} | `{f.rule}` | {msg} |")
    return "\n".join(rows)


def render(structure_findings: list[Finding],
           findings_by_agent: dict[str, list[Finding]],
           notes: list[str],
           passed: bool,
           reason: str) -> str:
    header = "## 🤖 PR Agent — Combined Verdict\n"
    verdict = ("> ✅ **PASS** — " if passed else "> ❌ **FAIL** — ") + reason
    parts = [header, verdict, ""]

    # Count everything for a one-line summary.
    all_findings = list(structure_findings)
    for fs in findings_by_agent.values():
        all_findings.extend(fs)
    if all_findings:
        counts: dict[str, int] = {}
        for f in all_findings:
            counts[f.severity] = counts.get(f.severity, 0) + 1
        summary = " · ".join(f"{_ICON[s]} {counts[s]} {s}"
                             for s in SEVERITY_ORDER if s in counts)
        parts.append(f"**Totals:** {summary}\n")

    # Structure / convention section (this agent's own checks).
    parts.append("### 📁 Repository structure & conventions")
    if structure_findings:
        parts.append(_table(structure_findings))
    else:
        parts.append("✅ No structural or convention issues.")
    parts.append("")

    # One section per upstream agent.
    if findings_by_agent:
        parts.append("### 🧩 Findings from other agents")
        for agent, fs in sorted(findings_by_agent.items()):
            label = agent.replace("-", " ").title()
            if fs:
                parts.append(f"**{label}** — {len(fs)} finding(s)")
                parts.append(_table(fs))
            else:
                parts.append(f"**{label}** — ✅ clean")
            parts.append("")

    if notes:
        parts.append("### ⚠️ Coordinator notes")
        for n in notes:
            parts.append(f"- {n}")
        parts.append("")

    parts.append("<sub>This agent reports and coordinates — it does not modify your "
                 "code or merge anything. A human decides.</sub>")
    return "\n".join(parts)
