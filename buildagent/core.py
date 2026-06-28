"""
Core types for Agent 4 — the Build-Production agent.

Two layers of checks:
  - "validate" (cheap): is the build config syntactically valid? Do declared
    entry points exist? Are the scripts referenced in package.json present?
    Runs in seconds on every PR.
  - "build" (real): actually execute the build inside CI and confirm the
    declared output artifacts are produced. Runs on PRs that touch build files
    or on demand.

Design principle (same as the other agents): DETECT and REPORT. If a build is
broken, the agent says why. It does not edit source to make builds pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


class Phase(str, Enum):
    VALIDATE = "validate"      # config-only checks
    BUILD = "build"            # actually executed the build


@dataclass
class BuildCheck:
    """A single build system detected in the repo (webpack, npm script, etc.)."""
    name: str                  # human-readable, e.g. "webpack (webpack.config.js)"
    kind: str                  # "webpack" | "npm-script" | "python-package" | ...
    config_path: str           # the file this came from
    expected_entries: list[str] = field(default_factory=list)   # input files
    expected_outputs: list[str] = field(default_factory=list)   # output files/dirs


@dataclass
class Finding:
    severity: str
    rule: str
    message: str
    remediation: str = ""
    phase: str = "validate"

    def sort_key(self):
        return (SEVERITY_ORDER.get(self.severity, 99), self.rule)


@dataclass
class BuildResult:
    check: BuildCheck
    phase: Phase
    success: bool
    duration_s: float = 0.0
    log_tail: str = ""              # last N lines of build output (for the report)
    produced_outputs: list[str] = field(default_factory=list)
    missing_outputs: list[str] = field(default_factory=list)
    empty_outputs: list[str] = field(default_factory=list)   # 0-byte = suspicious


def finding_to_report(f: Finding) -> dict:
    """Shape consumed by Agent 5's agent-reports/ ingestion."""
    return {
        "severity": f.severity,
        "rule": f.rule,
        "message": f.message,
        "remediation": f.remediation,
    }
