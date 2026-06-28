"""
Core types for Agent 3 — the Dependency & Health-Check agent.

This agent reads dependency manifests, asks the public registries (PyPI, npm)
what the latest version is, asks OSV.dev whether the pinned version has known
vulnerabilities, and reports findings. It can optionally open a PR bumping safe
versions — but like the other agents, a human merges.

Design: every network source degrades gracefully. If a registry or the vuln DB
is unreachable, that dimension is reported as "unknown" rather than crashing the
run — you still get the data that *did* come back.
"""

from __future__ import annotations

from dataclasses import dataclass, field

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


@dataclass
class Dependency:
    ecosystem: str            # "PyPI" | "npm"
    name: str
    current: str              # the pinned/declared version (best effort)
    source_file: str          # which manifest it came from
    raw_spec: str = ""        # original version spec text (e.g. "^1.2.0", ">=2,<3")


@dataclass
class Vulnerability:
    id: str                   # e.g. "GHSA-xxxx" or "CVE-2023-xxxx"
    severity: str             # critical|high|medium|low|info (best effort)
    summary: str
    fixed_in: str = ""        # first fixed version if OSV provides it


@dataclass
class DepFinding:
    dependency: Dependency
    latest: str | None = None             # latest version per registry (or None if unknown)
    is_outdated: bool = False
    vulns: list[Vulnerability] = field(default_factory=list)
    notes: str = ""                       # e.g. "registry unreachable"

    @property
    def worst_severity(self) -> str | None:
        if not self.vulns:
            return None
        return min((v.severity for v in self.vulns),
                   key=lambda s: SEVERITY_ORDER.get(s, 99))

    def to_report_finding(self) -> dict:
        """Shape consumed by the PR coordinator's agent-reports/ ingestion."""
        if self.vulns:
            sev = self.worst_severity or "high"
            vids = ", ".join(v.id for v in self.vulns[:3])
            fixed = next((v.fixed_in for v in self.vulns if v.fixed_in), "")
            rem = f"Upgrade {self.dependency.name} to {fixed or self.latest or 'a patched version'}."
            return {
                "severity": sev,
                "rule": "dependency-vulnerability",
                "message": f"{self.dependency.name} {self.dependency.current} "
                           f"({self.dependency.ecosystem}) has known vuln(s): {vids}",
                "remediation": rem,
            }
        # outdated-only finding
        return {
            "severity": "low",
            "rule": "dependency-outdated",
            "message": f"{self.dependency.name} {self.dependency.current} is behind "
                       f"latest {self.latest} ({self.dependency.ecosystem})",
            "remediation": f"Consider upgrading {self.dependency.name} to {self.latest}.",
        }
