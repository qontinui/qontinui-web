#!/usr/bin/env python3
"""Alembic sibling-head gate: the chain must have exactly one head.

THE single home of this gate's logic. Two lanes invoke this one script:

  * ``.github/workflows/alembic-graph-pr.yml``, step "Count alembic heads"
  * ``.qontinui/ci.toml``, step ``alembic-single-head``

Offline head counter: it scans ``backend/alembic/versions/*.py`` textually
without importing ``env.py`` (which would pull in qontinui-web's full app and
its ML deps). A revision is a head if no other revision names it as a parent.
This is the same counter ``alembic-graph-check.yml`` uses post-merge; the
difference is that the PR gate FAILS instead of commenting.

Background: the 2026-05-07 multi-head divergence (cr01a2b3c4d5 +
7c5e4d3b2a1f) silently broke the canonical migrator container for four hours.
The post-merge informational workflow noticed it but did not block.

Exit codes: 0 exactly one head, 1 more than one head, 2 the scan proved
nothing (no revision files, no revisions parsed, or zero heads — a zero-head
chain means a cycle, which is a defect, not a pass).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _gate_lib import (  # noqa: E402
    EXIT_VACUOUS,
    EXIT_VIOLATION,
    REPO_ROOT,
    err,
    note,
    require_nonempty,
)

VERSIONS_DIR = "backend/alembic/versions"

# Match both the legacy `revision = "x"` and the modern `revision: str = "x"`
# syntaxes. The colon-prefixed type annotation can contain letters (e.g.
# `: str = `, `: str | None = `), so `[: ]+` is too narrow — use an optional
# `:<non-eq chars>` segment between the keyword and the `=`.
REV_RE = re.compile(r'^revision\s*(?::[^=]*)?\s*=\s*["\'](.+?)["\']', re.M)
DOWN_RE = re.compile(r"^down_revision\s*(?::[^=]*)?\s*=\s*(.+)$", re.M)
PARENT_REF_RE = re.compile(r'["\'](\w[\w]*)["\']')

REMEDIATION = """
Resolution: rebase onto the current head OR author a merge
revision before merging this PR.

    cd backend
    alembic merge -m "merge sibling heads" <head_a> <head_b>
    git add alembic/versions/<merge_file>.py
    git commit -m "chore(alembic): merge sibling heads"
    git push

The merge revision is empty bookkeeping (it just joins parents).
Nothing happens at upgrade time beyond stamping the new head.

Why this gate is blocking: a multi-head chain breaks
`alembic upgrade head` (which refuses to disambiguate), which
in turn breaks the canonical-stack migrator container's
one-shot startup. Since 2026-05-08, services in
qontinui-stack/docker-compose.yml gate on
`migrator: service_completed_successfully`, so a multi-head
merge to main also blocks `coord` from starting.
"""


def main() -> int:
    versions = REPO_ROOT / VERSIONS_DIR
    if not versions.is_dir():
        err(f"{VERSIONS_DIR}/ does not exist under {REPO_ROOT}.")
        return EXIT_VACUOUS

    files = sorted(versions.glob("*.py"))
    require_nonempty(len(files), "*.py revision files", f"{VERSIONS_DIR}/")

    revs: dict[str, str] = {}
    parents: set[str] = set()
    for path in files:
        source = path.read_text(encoding="utf-8", errors="replace")
        match = REV_RE.search(source)
        if not match:
            continue
        rev = match.group(1)
        down_match = DOWN_RE.search(source)
        down = down_match.group(1).strip() if down_match else "None"
        parents.update(PARENT_REF_RE.findall(down))
        revs[rev] = down

    # Non-vacuity: N files on disk but zero parsed revisions means the parse is
    # broken (a syntax change in the revision template, say), not a clean chain.
    require_nonempty(
        len(revs), "parseable `revision = ...` assignments", f"{VERSIONS_DIR}/"
    )

    heads = sorted(r for r in revs if r not in parents)

    note(f"HEAD_COUNT={len(heads)}")
    for head in heads:
        note(f"HEAD={head}")
    note(f"(scanned {len(files)} revision file(s), parsed {len(revs)} revision(s))")

    if not heads:
        err(
            f"Alembic chain has ZERO heads across {len(revs)} revisions — every "
            "revision is named as someone's parent, which means the chain has a "
            "cycle."
        )
        err("A zero-head chain cannot be upgraded; this is a defect, not a pass.")
        return EXIT_VACUOUS

    if len(heads) > 1:
        err(f"Alembic chain has {len(heads)} heads after this PR:")
        for head in heads:
            err(f"  - {head}")
        print(REMEDIATION, file=sys.stderr)
        return EXIT_VIOLATION

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
