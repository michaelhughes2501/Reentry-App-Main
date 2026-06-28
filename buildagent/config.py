"""Load buildagent.yml."""

from __future__ import annotations

from pathlib import Path

import yaml

DEFAULTS = {
    "run_build": False,        # if False, validate-only (fast). True = actually run builds.
    "build_timeout_s": 300,    # per-build timeout
    "fail_on": "high",         # severity threshold that fails CI
    "reports_dir": "agent-reports",
    "report_name": "build-agent.json",
    "skip_kinds": [],          # e.g. ["python-package"] to opt out
}


def load(path: str | Path = "buildagent.yml") -> dict:
    cfg = dict(DEFAULTS)
    p = Path(path)
    if p.exists():
        loaded = yaml.safe_load(p.read_text()) or {}
        cfg.update(loaded)
    return cfg
