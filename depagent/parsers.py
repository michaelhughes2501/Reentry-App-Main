"""
Manifest parsers. Each returns a list of Dependency objects.

Version specs are messy in the real world, so we extract a best-effort concrete
version for vuln/outdated checks and keep the raw spec for context:
  - requirements.txt: "flask==2.0.1", "requests>=2.20", "django~=4.1"
  - package.json:     "^1.2.3", "~1.2.3", "1.2.3", ">=1.0 <2.0"
  - package-lock.json / pyproject are handled where practical.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .core import Dependency

# --- Python: requirements.txt ----------------------------------------------

_REQ_LINE = re.compile(
    r"^\s*([A-Za-z0-9_.\-]+)\s*(?:\[[^\]]+\])?\s*"      # name (+ optional extras)
    r"(==|>=|<=|~=|!=|>|<)?\s*"                          # operator
    r"([0-9][0-9A-Za-z_.\-]*)?"                          # version
)


def parse_requirements(path: str, text: str) -> list[Dependency]:
    deps = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        line = line.split("#", 1)[0].strip()           # strip inline comments
        if ";" in line:                                 # drop env markers
            line = line.split(";", 1)[0].strip()
        m = _REQ_LINE.match(line)
        if not m:
            continue
        name, op, ver = m.group(1), m.group(2) or "", m.group(3) or ""
        if not ver:
            continue  # unpinned; nothing concrete to check
        deps.append(Dependency("PyPI", name, ver, path, raw_spec=f"{op}{ver}"))
    return deps


# --- Python: pyproject.toml (PEP 621 / poetry, light touch) ----------------

_PYPROJECT_DEP = re.compile(r'"?([A-Za-z0-9_.\-]+)"?\s*[=:]\s*"?\^?~?>=?\s*([0-9][0-9A-Za-z_.\-]*)')


def parse_pyproject(path: str, text: str) -> list[Dependency]:
    deps = []
    # crude but effective: find [tool.poetry.dependencies] or [project] deps lines
    in_deps = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("[") and "dependencies" in line.lower():
            in_deps = True
            continue
        if line.startswith("[") and "dependencies" not in line.lower():
            in_deps = False
        if in_deps and line and not line.startswith("#"):
            m = _PYPROJECT_DEP.search(line)
            if m and m.group(1).lower() != "python":
                deps.append(Dependency("PyPI", m.group(1), m.group(2), path, raw_spec=line))
    return deps


# --- Node: package.json -----------------------------------------------------

_VER_FROM_RANGE = re.compile(r"([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.\-]+)?)")


def _concrete_from_npm_range(spec: str) -> str:
    """Pull a concrete x.y.z out of an npm range like ^1.2.3 / ~1.2.3 / >=1.2.3."""
    m = _VER_FROM_RANGE.search(spec or "")
    return m.group(1) if m else ""


def parse_package_json(path: str, text: str) -> list[Dependency]:
    deps = []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return deps
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        block = data.get(section) or {}
        for name, spec in block.items():
            if not isinstance(spec, str):
                continue
            ver = _concrete_from_npm_range(spec)
            if not ver:
                continue  # e.g. "*", "latest", git URLs — skip concrete checks
            deps.append(Dependency("npm", name, ver, path, raw_spec=spec))
    return deps


# --- Node: package-lock.json (exact, authoritative) ------------------------

def parse_package_lock(path: str, text: str) -> list[Dependency]:
    deps = []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return deps
    # lockfile v2/v3: "packages": { "node_modules/foo": {"version": "..."} }
    packages = data.get("packages")
    if isinstance(packages, dict):
        for key, meta in packages.items():
            if not key or not isinstance(meta, dict):
                continue
            name = key.split("node_modules/")[-1]
            ver = meta.get("version", "")
            if name and ver:
                deps.append(Dependency("npm", name, ver, path, raw_spec=ver))
        return deps
    # lockfile v1: "dependencies": { "foo": {"version": "..."} }
    legacy = data.get("dependencies")
    if isinstance(legacy, dict):
        for name, meta in legacy.items():
            if isinstance(meta, dict) and meta.get("version"):
                deps.append(Dependency("npm", name, meta["version"], path, raw_spec=meta["version"]))
    return deps


# --- Dispatcher -------------------------------------------------------------

def parse_manifest(path: str, text: str) -> list[Dependency]:
    name = Path(path).name.lower()
    if name == "requirements.txt" or name.endswith(".requirements.txt"):
        return parse_requirements(path, text)
    if name == "pyproject.toml":
        return parse_pyproject(path, text)
    if name == "package-lock.json":
        return parse_package_lock(path, text)
    if name == "package.json":
        return parse_package_json(path, text)
    return []
