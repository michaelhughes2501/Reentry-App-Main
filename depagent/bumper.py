"""
Bump classification and policy.

Decides which dependency findings get an auto-PR proposed. The boundary is
deliberate: patch and minor bumps by default, major bumps reported only.
Vulnerabilities with a known fix version get priority regardless of bump size,
because leaving a known-vuln package pinned is worse than the small risk of a
minor-version surprise.

Nothing here touches the network — pure functions, fully testable offline.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from .core import DepFinding


class BumpKind(str, Enum):
    PATCH = "patch"          # x.y.Z
    MINOR = "minor"          # x.Y.0
    MAJOR = "major"          # X.0.0
    UNCLEAR = "unclear"      # versions don't parse cleanly


@dataclass
class BumpProposal:
    finding: DepFinding
    from_version: str
    to_version: str
    kind: BumpKind
    reason: str               # "vulnerability fix" | "outdated"
    fixes_vulns: list[str]    # CVE/GHSA ids this bump resolves


_SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)")


def _parts(version: str) -> tuple[int, int, int] | None:
    if not version:
        return None
    m = _SEMVER.match(version.strip())
    if not m:
        return None
    return tuple(int(x) for x in m.groups())  # type: ignore[return-value]


def classify(current: str, target: str) -> BumpKind:
    c = _parts(current)
    t = _parts(target)
    if c is None or t is None:
        return BumpKind.UNCLEAR
    if t[0] != c[0]:
        return BumpKind.MAJOR
    if t[1] != c[1]:
        return BumpKind.MINOR
    if t[2] != c[2]:
        return BumpKind.PATCH
    return BumpKind.UNCLEAR    # same version somehow


def plan_bumps(findings: list[DepFinding], *,
               allow_kinds: set[BumpKind] | None = None) -> tuple[list[BumpProposal], list[DepFinding]]:
    """
    Returns (proposed, deferred).
      proposed: bumps the agent will open PRs for.
      deferred: findings reported but NOT auto-bumped (e.g. major, unclear,
                vulnerabilities without a known fixed version).
    """
    if allow_kinds is None:
        allow_kinds = {BumpKind.PATCH, BumpKind.MINOR}

    proposed: list[BumpProposal] = []
    deferred: list[DepFinding] = []

    for f in findings:
        # Decide the target version.
        target = ""
        reason = ""
        fixes = []
        if f.vulns:
            # Prefer a vuln's fixed_in if present; else latest from registry.
            for v in f.vulns:
                if v.fixed_in:
                    target = v.fixed_in
                    fixes.append(v.id)
                    break
            if not target and f.latest:
                target = f.latest
                fixes = [v.id for v in f.vulns]
            reason = "vulnerability fix" if target else ""
        elif f.is_outdated and f.latest:
            target = f.latest
            reason = "outdated"

        if not target:
            deferred.append(f)
            continue

        kind = classify(f.dependency.current, target)
        if kind in allow_kinds:
            proposed.append(BumpProposal(
                finding=f, from_version=f.dependency.current,
                to_version=target, kind=kind, reason=reason,
                fixes_vulns=fixes,
            ))
        else:
            # Major / unclear → defer with a clear note in the finding's notes.
            deferred.append(f)

    return proposed, deferred


def is_vuln_priority(p: BumpProposal) -> bool:
    """Vuln fixes jump the queue even if they'd otherwise be skipped."""
    return bool(p.fixes_vulns)
