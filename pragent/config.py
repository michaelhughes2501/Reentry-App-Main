"""Load pragent.yml — the rules for structure, conventions, and gating."""

from __future__ import annotations

from pathlib import Path

import yaml

DEFAULTS = {
    "fail_on": "high",                # block PR if any finding >= this severity
    "reports_dir": "agent-reports",   # where other agents drop their JSON
    "required_files": ["README*", "LICENSE*", ".gitignore"],
    "forbidden_paths": ["*.env", "**/*.pem", "**/id_rsa", "**/secrets.*"],
    "expected_dirs": [],              # e.g. ["src", "tests"]
    "branch_pattern": None,           # e.g. r"(feature|fix|chore)/[a-z0-9._-]+"
    "pr_title_pattern": None,         # e.g. r"^(feat|fix|docs|chore|refactor)(\(.+\))?: .+"
    "max_files": 0,                   # 0 disables the soft size guard
    "max_changes": 0,
    "status_context": "pr-agent/verdict",

    # --- Auto-PR (option 3) — OFF by default, opt in explicitly ---
    "auto_fix": {
        "enabled": False,             # master switch; nothing opens a PR unless True
        "draft": False,               # open ready-for-review (set True for drafts)
        "labels": ["pr-agent", "automated-fix"],
        "branch_prefix": "pr-agent/fix",
    },

    # --- Multi-repo sweep (option from Q3) ---
    # When running a scheduled sweep instead of a single PR event, the agent
    # operates on exactly these repos. Empty = only the repo it runs in.
    "repos": [],                      # e.g. ["michaelhughes2501/be-yours-theme"]
}


def load(path: str | Path = "pragent.yml") -> dict:
    cfg = dict(DEFAULTS)
    p = Path(path)
    if p.exists():
        loaded = yaml.safe_load(p.read_text()) or {}
        cfg.update(loaded)
    return cfg
