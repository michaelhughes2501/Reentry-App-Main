"""
The scanner: for each dependency, find latest version, check if outdated, and
query vulnerabilities. Produces DepFindings.

Version comparison:
  - PyPI: packaging.version (PEP 440)
  - npm:  a small semver-ish tuple compare (sufficient for outdated detection)
"""

from __future__ import annotations

import re

from .core import Dependency, DepFinding
from .osv import query_vulns
from .registry import latest_version


def _cmp_pypi(current: str, latest: str) -> bool:
    """Return True if current < latest (i.e. outdated)."""
    try:
        from packaging.version import Version
        return Version(current) < Version(latest)
    except Exception:
        return current != latest  # fall back to string inequality


_SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)")


def _cmp_npm(current: str, latest: str) -> bool:
    def parts(v):
        m = _SEMVER.match(v or "")
        return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
    try:
        return parts(current) < parts(latest)
    except Exception:
        return current != latest


def _is_outdated(ecosystem: str, current: str, latest: str) -> bool:
    if not latest:
        return False
    if ecosystem == "PyPI":
        return _cmp_pypi(current, latest)
    if ecosystem == "npm":
        return _cmp_npm(current, latest)
    return current != latest


def scan_dependency(dep: Dependency, *, check_vulns: bool = True) -> DepFinding:
    finding = DepFinding(dependency=dep)

    latest = latest_version(dep.ecosystem, dep.name)
    if latest is None:
        finding.notes = "registry lookup failed (latest unknown)"
    else:
        finding.latest = latest
        finding.is_outdated = _is_outdated(dep.ecosystem, dep.current, latest)

    if check_vulns:
        vulns = query_vulns(dep.ecosystem, dep.name, dep.current)
        if vulns is None:
            finding.notes = (finding.notes + "; " if finding.notes else "") + \
                            "vulnerability DB unreachable (vuln status unknown)"
        else:
            finding.vulns = vulns

    return finding


def scan_dependencies(deps: list[Dependency], *, check_vulns: bool = True) -> list[DepFinding]:
    # Deduplicate by (ecosystem, name, version) to avoid redundant network calls.
    seen: dict[tuple, DepFinding] = {}
    results: list[DepFinding] = []
    for dep in deps:
        key = (dep.ecosystem, dep.name, dep.current)
        if key in seen:
            # reuse the network result but keep the new source_file context
            base = seen[key]
            clone = DepFinding(dependency=dep, latest=base.latest,
                               is_outdated=base.is_outdated, vulns=base.vulns,
                               notes=base.notes)
            results.append(clone)
            continue
        f = scan_dependency(dep, check_vulns=check_vulns)
        seen[key] = f
        results.append(f)
    return results
