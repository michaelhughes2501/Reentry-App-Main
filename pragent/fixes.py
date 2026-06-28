"""
Auto-fix generation for Agent 5 — STRICTLY mechanical, safe, reversible fixes.

THE SAFETY BOUNDARY LIVES HERE. This module only ever proposes changes that:
  - add a missing scaffolding file (.gitignore, README stub, LICENSE stub), or
  - append an ignore entry for a forbidden path.

It NEVER rewrites application code, never "fixes" a security finding by editing
source, never changes logic. Anything outside this list is reported for a human,
not auto-fixed. That boundary is the whole point: an agent that silently edits
code to satisfy a scanner introduces risk rather than removing it.

Every fix returned here becomes a DRAFT pull request that a human must review
and merge. Nothing is auto-merged.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass

from .validators import Finding


@dataclass
class FileFix:
    path: str                 # repo-relative path to create/update
    content: str              # full new file content (small scaffolding only)
    reason: str               # human-readable why
    update_existing: bool = False  # False = create only (won't clobber)

    @property
    def content_b64(self) -> str:
        return base64.b64encode(self.content.encode()).decode()


_GITIGNORE_STUB = """\
# Added by PR Agent — review and extend as needed.
.env
*.pem
id_rsa
secrets.*
__pycache__/
node_modules/
dist/
build/
.venv/
"""

_README_STUB = """\
# {repo}

> Stub created by PR Agent. Replace this with a real description.

## Overview

_TODO: what this project does._

## Getting started

_TODO: setup steps._
"""

_LICENSE_NOTE = """\
PR Agent detected no LICENSE file. Licensing is a human/legal decision, so this
PR intentionally does NOT pick one for you. Add the license your project needs
(e.g. via GitHub's "Add file -> Create new file -> LICENSE" template chooser),
then close this PR.
"""


def plan_fixes(findings: list[Finding], *, repo: str,
               existing_paths: set[str]) -> tuple[list[FileFix], list[Finding]]:
    """
    Given structural findings, return:
      (fixable)  -> list of FileFix to put into a draft PR
      (unfixable)-> findings with no safe mechanical fix (reported only)

    We are deliberately conservative: when in doubt, it goes to `unfixable`.
    """
    fixable: list[FileFix] = []
    unfixable: list[Finding] = []
    planned_paths: set[str] = set()

    for f in findings:
        fix = _fix_for(f, repo=repo, existing_paths=existing_paths)
        if fix is None:
            unfixable.append(f)
            continue
        if fix.path in planned_paths or fix.path in existing_paths and not fix.update_existing:
            # Don't propose creating something that already exists or is dup-planned.
            unfixable.append(f)
            continue
        fixable.append(fix)
        planned_paths.add(fix.path)

    return fixable, unfixable


def _fix_for(f: Finding, *, repo: str, existing_paths: set[str]) -> FileFix | None:
    # Missing .gitignore -> create one.
    if f.rule == "required-file-missing" and ".gitignore" in f.message:
        return FileFix(".gitignore", _GITIGNORE_STUB,
                       reason="Add a starter .gitignore.")

    # Missing README -> create a stub.
    if f.rule == "required-file-missing" and "README" in f.message:
        return FileFix("README.md", _README_STUB.format(repo=repo),
                       reason="Add a README stub for a human to fill in.")

    # Missing LICENSE -> we DON'T pick a license; open an explanatory note file
    # so the PR carries context, but the human chooses the actual license.
    if f.rule == "required-file-missing" and "LICENSE" in f.message:
        return FileFix("LICENSE_TODO.md", _LICENSE_NOTE,
                       reason="Flag missing license without choosing one (a human/legal decision).")

    # Forbidden path committed -> we can't safely delete the file in a scaffolding
    # PR (it may be needed locally / may contain secrets to rotate). Instead we
    # ensure .gitignore covers it, and leave removal + rotation to the human.
    if f.rule == "forbidden-path":
        # only auto-handle if there's no .gitignore yet; otherwise report it
        if ".gitignore" not in existing_paths:
            return FileFix(".gitignore", _GITIGNORE_STUB,
                           reason="Add .gitignore so the forbidden path stops being tracked "
                                  "(you still need to git rm it and rotate any secret).")
        return None

    # Everything else (layout dirs, branch/title conventions, size, and ALL
    # findings from other agents) is reported, never auto-fixed.
    return None
