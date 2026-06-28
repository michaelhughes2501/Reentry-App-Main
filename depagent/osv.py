"""
Vulnerability lookup via OSV.dev — Google's free, public vulnerability database
covering PyPI, npm, and many other ecosystems.

API: POST https://api.osv.dev/v1/query
     {"package": {"ecosystem": "PyPI", "name": "..."}, "version": "..."}

Degrades gracefully: if OSV is unreachable, returns (None) and the caller marks
the vuln dimension "unknown" rather than failing — you still get outdated info.

NOTE: OSV may be blocked in some sandboxes; it is publicly reachable from GitHub
Actions runners, which is where this agent actually runs.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from .core import Vulnerability

_OSV_URL = "https://api.osv.dev/v1/query"
_TIMEOUT = 20

# Map OSV's severity hints to our scale. OSV severity is often a CVSS vector or
# a database_specific severity string; we normalize conservatively.
_SEV_WORDS = {
    "CRITICAL": "critical", "HIGH": "high", "MODERATE": "medium",
    "MEDIUM": "medium", "LOW": "low",
}


def _normalize_severity(vuln: dict) -> str:
    # 1) database_specific.severity (GHSA style)
    db = vuln.get("database_specific") or {}
    word = (db.get("severity") or "").upper()
    if word in _SEV_WORDS:
        return _SEV_WORDS[word]
    # 2) severity[].score CVSS — bucket by base score if present
    for s in vuln.get("severity") or []:
        score = s.get("score", "")
        # CVSS vector strings start with "CVSS:"; numeric handled below
        try:
            val = float(score)
            if val >= 9.0:
                return "critical"
            if val >= 7.0:
                return "high"
            if val >= 4.0:
                return "medium"
            return "low"
        except (TypeError, ValueError):
            continue
    # 3) affected ecosystem_specific severity words in the text
    return "high"  # OSV listed it as a vuln but gave no severity -> treat as high


def _first_fixed(vuln: dict, name: str) -> str:
    for aff in vuln.get("affected") or []:
        pkg = aff.get("package") or {}
        if pkg.get("name") != name:
            continue
        for rng in aff.get("ranges") or []:
            for ev in rng.get("events") or []:
                if "fixed" in ev:
                    return ev["fixed"]
    return ""


def query_vulns(ecosystem: str, name: str, version: str) -> list[Vulnerability] | None:
    """Returns list of Vulnerability, [] if clean, or None if OSV unreachable."""
    body = json.dumps({
        "package": {"ecosystem": ecosystem, "name": name},
        "version": version,
    }).encode()
    try:
        req = urllib.request.Request(
            _OSV_URL, data=body,
            headers={"Content-Type": "application/json", "User-Agent": "dep-agent"},
        )
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            data = json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError):
        return None  # unreachable -> "unknown", not "clean"

    out = []
    for v in data.get("vulns") or []:
        out.append(Vulnerability(
            id=v.get("id", "UNKNOWN"),
            severity=_normalize_severity(v),
            summary=(v.get("summary") or v.get("details") or "")[:200],
            fixed_in=_first_fixed(v, name),
        ))
    return out
