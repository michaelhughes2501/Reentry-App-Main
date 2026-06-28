"""Load depagent.yml — controls what gets scanned and what fails the run."""

from __future__ import annotations

from pathlib import Path

import yaml

DEFAULTS = {
    "manifests": [                    # glob patterns to scan
        "**/requirements.txt",
        "**/pyproject.toml",
        "**/package.json",
        "**/package-lock.json",
    ],
    "skip_dirs": [".git", "node_modules", ".venv", "venv", "__pycache__",
                  "dist", "build", "vendor"],
    "check_vulns": True,              # query OSV.dev
    "check_outdated": True,           # compare against registry latest
    "fail_on": "high",                # fail CI if any vuln >= this severity
    "fail_on_outdated": False,        # outdated alone doesn't fail by default
    "reports_dir": "agent-reports",   # where to drop the JSON for the PR agent
    "report_name": "dependency-agent.json",
    "ignore": [],                     # package names to skip entirely
}


def load(path: str | Path = "depagent.yml") -> dict:
    cfg = dict(DEFAULTS)
    p = Path(path)
    if p.exists():
        loaded = yaml.safe_load(p.read_text()) or {}
        cfg.update(loaded)
    return cfg
