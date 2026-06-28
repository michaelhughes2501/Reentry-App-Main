"""
The build executor: actually run each detected build and confirm the declared
output artifacts were produced.

Slower than validation, so it's gated:
  - Always available via --build flag.
  - In CI, run on PRs that touch build-relevant files (workflow filters that).

Every build runs with a timeout (default 5 min) and captures the tail of its
output so failures land in the report with enough context for a human to debug.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

from .core import BuildCheck, BuildResult, Phase

_DEFAULT_TIMEOUT = 300  # seconds
_LOG_TAIL_LINES = 40


def _tail(text: str, n: int = _LOG_TAIL_LINES) -> str:
    lines = text.splitlines()
    return "\n".join(lines[-n:])


def _run(cmd: list[str], cwd: Path, timeout: int) -> tuple[int, str, float]:
    start = time.perf_counter()
    try:
        res = subprocess.run(
            cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
        )
        elapsed = time.perf_counter() - start
        combined = (res.stdout or "") + ("\n" + res.stderr if res.stderr else "")
        return res.returncode, combined, elapsed
    except subprocess.TimeoutExpired as exc:
        elapsed = time.perf_counter() - start
        out = (exc.stdout or b"").decode("utf-8", "replace") + \
              (exc.stderr or b"").decode("utf-8", "replace")
        return 124, out + f"\n[BUILD TIMED OUT after {timeout}s]", elapsed
    except FileNotFoundError as exc:
        return 127, f"command not found: {exc}", time.perf_counter() - start


def _check_outputs(repo_root: Path, expected: list[str]) -> tuple[list[str], list[str], list[str]]:
    """Returns (produced, missing, empty). Empty = file exists but is 0 bytes."""
    produced, missing, empty = [], [], []
    for out in expected:
        p = Path(out)
        if not p.is_absolute():
            p = repo_root / out
        if not p.exists():
            missing.append(str(p))
        elif p.is_dir():
            produced.append(str(p))
        elif p.stat().st_size == 0:
            empty.append(str(p))
        else:
            produced.append(str(p))
    return produced, missing, empty


def _build_webpack(check: BuildCheck, repo_root: Path, timeout: int) -> BuildResult:
    cfg_path = repo_root / check.config_path
    cwd = cfg_path.parent
    # Prefer the project's own build script if it exists; otherwise call webpack directly.
    pkg_path = cwd / "package.json"
    cmd = ["npx", "--yes", "webpack", "--config", str(cfg_path.name), "--mode", "production"]
    if pkg_path.exists():
        try:
            import json
            scripts = (json.loads(pkg_path.read_text()).get("scripts") or {})
            for s in ("build", "build:prod", "bundle"):
                if s in scripts:
                    cmd = ["npm", "run", s, "--silent"]
                    break
        except (ValueError, OSError):
            pass

    rc, log, elapsed = _run(cmd, cwd, timeout)
    produced, missing, empty = _check_outputs(repo_root, check.expected_outputs)
    # Build succeeds when the process exited cleanly AND nothing is missing.
    # Empty outputs are a SIGNAL (reported separately) but don't fail the build —
    # an empty file can be intentional (e.g. CSS-only entry).
    return BuildResult(
        check=check, phase=Phase.BUILD,
        success=(rc == 0 and not missing),
        duration_s=elapsed, log_tail=_tail(log),
        produced_outputs=produced, missing_outputs=missing, empty_outputs=empty,
    )


def _build_npm_script(check: BuildCheck, repo_root: Path, timeout: int) -> BuildResult:
    pkg_path = repo_root / check.config_path
    cwd = pkg_path.parent
    # The script name is in the check's display name; pull it from there.
    script = check.name.split("npm run ", 1)[1].split(" ", 1)[0]
    rc, log, elapsed = _run(["npm", "run", script, "--silent"], cwd, timeout)
    # We don't know declared outputs for arbitrary npm scripts, so success ==
    # process exit code 0 only.
    return BuildResult(
        check=check, phase=Phase.BUILD,
        success=(rc == 0),
        duration_s=elapsed, log_tail=_tail(log),
    )


def _build_python(check: BuildCheck, repo_root: Path, timeout: int) -> BuildResult:
    cwd = (repo_root / check.config_path).parent
    rc, log, elapsed = _run(["python", "-m", "build", "--wheel", "--sdist"], cwd, timeout)
    # Look for dist/ output as the conventional artifact location.
    produced, missing, _empty = _check_outputs(cwd, ["dist"])
    return BuildResult(
        check=check, phase=Phase.BUILD,
        success=(rc == 0 and produced),
        duration_s=elapsed, log_tail=_tail(log),
        produced_outputs=produced, missing_outputs=missing,
    )


_BUILDERS = {
    "webpack": _build_webpack,
    "npm-script": _build_npm_script,
    "python-package": _build_python,
}


def run_build(check: BuildCheck, repo_root: Path,
              timeout: int = _DEFAULT_TIMEOUT) -> BuildResult:
    builder = _BUILDERS.get(check.kind)
    if builder is None:
        return BuildResult(check=check, phase=Phase.BUILD, success=False,
                           log_tail=f"no builder registered for kind={check.kind!r}")
    return builder(check, repo_root, timeout)


def can_build_node() -> bool:
    return shutil.which("node") is not None and shutil.which("npm") is not None
