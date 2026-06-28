"""
Discover build systems in the repo and run cheap validation checks.

A "build system" is anything that takes source code and produces an artifact.
We currently detect:
  - webpack (any webpack.config.js / webpack.config.cjs)
  - npm scripts that look like builds (build, bundle, compile, dist)
  - Python package builds (setup.py / pyproject.toml with a build-system table)

Each detector returns BuildCheck objects with declared inputs/outputs so the
real-build phase can later confirm the outputs were produced.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from .core import BuildCheck, Finding

# ---------------------------------------------------------------------------
# webpack
# ---------------------------------------------------------------------------

# Tiny Node script that loads a webpack config and emits the resolved entry/output
# as JSON. We DON'T run the build here — we just inspect what the config claims.
# This requires `node` to be available, which it is in CI runners by default.
_WEBPACK_INSPECT_JS = r"""
const path = require('path');
const fs = require('fs');
try {
  const cfgPath = path.resolve(process.argv[2]);
  process.chdir(path.dirname(cfgPath));
  const cfg = require(cfgPath);
  const resolved = typeof cfg === 'function' ? cfg({}, {mode: 'production'}) : cfg;
  const configs = Array.isArray(resolved) ? resolved : [resolved];
  const out = configs.map(c => ({
    entry: c.entry,
    output_path: c.output && c.output.path,
    output_filename: c.output && c.output.filename,
    plugins: (c.plugins || []).map(p => (p && p.constructor && p.constructor.name) || 'Plugin'),
    has_css_rule: !!(c.module && c.module.rules || []).find(r =>
      r && r.test && r.test.toString().toLowerCase().includes('css')),
  }));
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stdout.write(JSON.stringify({error: String(e && e.message || e)}));
  process.exit(1);
}
"""


def _node_available() -> bool:
    return shutil.which("node") is not None


def _inspect_webpack(cfg_path: Path) -> tuple[list[dict] | None, str]:
    """Returns (configs, error). configs is None on failure; error is human text."""
    if not _node_available():
        return None, "node is not installed in this environment"
    try:
        # Write the inspector to a temp file next to the config so its require()
        # resolves the project's node_modules naturally.
        helper = cfg_path.parent / ".buildagent-inspect.js"
        helper.write_text(_WEBPACK_INSPECT_JS)
        try:
            res = subprocess.run(
                ["node", str(helper), str(cfg_path)],
                capture_output=True, text=True, timeout=30,
                cwd=cfg_path.parent,
            )
        finally:
            try:
                helper.unlink()
            except OSError:
                pass
        out = (res.stdout or "").strip()
        if res.returncode != 0:
            # Parse the JSON error if we wrote one; else fall back to stderr.
            try:
                err = json.loads(out).get("error", "")
            except (ValueError, json.JSONDecodeError):
                err = (res.stderr or "").strip()[:300]
            return None, err or "webpack config inspection failed"
        return json.loads(out), ""
    except subprocess.TimeoutExpired:
        return None, "webpack config inspection timed out"
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"


def _coerce_entries(entry) -> list[str]:
    """Webpack 'entry' can be a string, list, or object. Normalize to file paths."""
    if isinstance(entry, str):
        return [entry]
    if isinstance(entry, list):
        return [e for e in entry if isinstance(e, str)]
    if isinstance(entry, dict):
        out = []
        for v in entry.values():
            if isinstance(v, str):
                out.append(v)
            elif isinstance(v, dict) and isinstance(v.get("import"), str):
                out.append(v["import"])
        return out
    return []


def detect_webpack(repo_root: Path) -> tuple[list[BuildCheck], list[Finding]]:
    checks: list[BuildCheck] = []
    findings: list[Finding] = []
    candidates = list(repo_root.glob("**/webpack.config.js")) + \
                 list(repo_root.glob("**/webpack.config.cjs"))
    candidates = [c for c in candidates if "node_modules" not in c.parts]

    for cfg in candidates:
        rel = cfg.relative_to(repo_root)
        configs, err = _inspect_webpack(cfg)
        if configs is None:
            findings.append(Finding(
                severity="high",
                rule="webpack-config-invalid",
                message=f"`{rel}` could not be loaded: {err}",
                remediation="Fix the webpack config so it can be required by Node. "
                            "(Often: missing dependency in node_modules — run `npm install`.)",
                phase="validate",
            ))
            continue
        if isinstance(configs, dict) and configs.get("error"):
            findings.append(Finding(
                severity="high", rule="webpack-config-error",
                message=f"`{rel}` errored: {configs['error']}",
                remediation="Resolve the error reported by the webpack config loader.",
            ))
            continue

        for i, c in enumerate(configs):
            entries = _coerce_entries(c.get("entry"))
            out_dir = c.get("output_path") or ""
            out_name = c.get("output_filename") or ""
            outputs = []
            if out_dir and out_name:
                outputs.append(str(Path(out_dir, out_name)))
            # MiniCssExtractPlugin produces a CSS file; we can predict its name
            # if the plugin is present (the filename comes from plugin opts,
            # which we don't have here, but the convention bundle.css is common).
            if "MiniCssExtractPlugin" in (c.get("plugins") or []) and out_dir:
                outputs.append(str(Path(out_dir, "bundle.css")))

            name = f"webpack ({rel})" + (f" [config {i}]" if len(configs) > 1 else "")
            checks.append(BuildCheck(
                name=name, kind="webpack", config_path=str(rel),
                expected_entries=[str(Path(cfg.parent, e).resolve().relative_to(repo_root))
                                  if not Path(e).is_absolute() else e
                                  for e in entries],
                expected_outputs=outputs,
            ))

            # Cheap validation: do the declared entry files exist?
            for entry in entries:
                p = (cfg.parent / entry) if not Path(entry).is_absolute() else Path(entry)
                if not p.exists():
                    findings.append(Finding(
                        severity="high",
                        rule="webpack-entry-missing",
                        message=f"Webpack entry not found: `{entry}` (declared in `{rel}`).",
                        remediation="Create the entry file or fix the path in the webpack config.",
                    ))
    return checks, findings


# ---------------------------------------------------------------------------
# npm scripts
# ---------------------------------------------------------------------------

_BUILD_SCRIPT_NAMES = {"build", "build:prod", "bundle", "compile", "dist", "make"}


def detect_npm_scripts(repo_root: Path) -> tuple[list[BuildCheck], list[Finding]]:
    checks: list[BuildCheck] = []
    findings: list[Finding] = []
    for pkg in repo_root.glob("**/package.json"):
        if "node_modules" in pkg.parts:
            continue
        try:
            data = json.loads(pkg.read_text(encoding="utf-8", errors="replace"))
        except json.JSONDecodeError as exc:
            findings.append(Finding(
                severity="high",
                rule="package-json-invalid",
                message=f"`{pkg.relative_to(repo_root)}` is not valid JSON: {exc}",
                remediation="Fix the JSON syntax — broken package.json blocks every build tool.",
            ))
            continue
        scripts = (data.get("scripts") or {})
        for script_name in _BUILD_SCRIPT_NAMES:
            if script_name in scripts:
                checks.append(BuildCheck(
                    name=f"npm run {script_name} ({pkg.relative_to(repo_root)})",
                    kind="npm-script",
                    config_path=str(pkg.relative_to(repo_root)),
                ))
    return checks, findings


# ---------------------------------------------------------------------------
# Python builds
# ---------------------------------------------------------------------------

def detect_python_build(repo_root: Path) -> tuple[list[BuildCheck], list[Finding]]:
    checks: list[BuildCheck] = []
    findings: list[Finding] = []
    for pyproj in repo_root.glob("**/pyproject.toml"):
        if any(p in pyproj.parts for p in (".venv", "venv", "node_modules")):
            continue
        text = pyproj.read_text(encoding="utf-8", errors="replace")
        if "[build-system]" in text:
            checks.append(BuildCheck(
                name=f"python build ({pyproj.relative_to(repo_root)})",
                kind="python-package",
                config_path=str(pyproj.relative_to(repo_root)),
            ))
        # Light syntactic sanity: balanced brackets in build-system table only.
        if "[build-system]" in text and "requires" not in text.split("[build-system]", 1)[1]:
            findings.append(Finding(
                severity="medium",
                rule="pyproject-build-system-incomplete",
                message=f"`{pyproj.relative_to(repo_root)}` has [build-system] without `requires`.",
                remediation="Add a `requires = [...]` list to the [build-system] table.",
            ))
    for setup in repo_root.glob("**/setup.py"):
        if any(p in setup.parts for p in (".venv", "venv", "node_modules")):
            continue
        checks.append(BuildCheck(
            name=f"python build ({setup.relative_to(repo_root)})",
            kind="python-package",
            config_path=str(setup.relative_to(repo_root)),
        ))
    return checks, findings


# ---------------------------------------------------------------------------
# orchestrator
# ---------------------------------------------------------------------------

ALL_DETECTORS = (detect_webpack, detect_npm_scripts, detect_python_build)


def discover(repo_root: Path) -> tuple[list[BuildCheck], list[Finding]]:
    checks: list[BuildCheck] = []
    findings: list[Finding] = []
    for det in ALL_DETECTORS:
        c, f = det(repo_root)
        checks.extend(c)
        findings.extend(f)
    return checks, findings
