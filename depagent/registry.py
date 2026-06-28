"""
Registry clients — "what's the latest version of X?"

Uses only stdlib urllib. Results are cached in-process so a manifest listing the
same package twice doesn't hit the network twice. Every lookup degrades to None
on failure (network, 404, parse error) so a flaky registry never crashes a run.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from functools import lru_cache

_TIMEOUT = 15


def _get_json(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "dep-agent"})
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError):
        return None


@lru_cache(maxsize=2048)
def latest_pypi(name: str) -> str | None:
    data = _get_json(f"https://pypi.org/pypi/{name}/json")
    if not data:
        return None
    return (data.get("info") or {}).get("version")


@lru_cache(maxsize=2048)
def latest_npm(name: str) -> str | None:
    # The /latest dist-tag endpoint is the cheapest way to get the current version.
    data = _get_json(f"https://registry.npmjs.org/{name}/latest")
    if not data:
        return None
    return data.get("version")


def latest_version(ecosystem: str, name: str) -> str | None:
    if ecosystem == "PyPI":
        return latest_pypi(name)
    if ecosystem == "npm":
        return latest_npm(name)
    return None
