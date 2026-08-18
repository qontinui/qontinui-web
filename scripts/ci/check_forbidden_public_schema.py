#!/usr/bin/env python3
r"""Forbid ``public.*`` schema regressions.

THE single home of this gate's logic. Two lanes invoke this one script:

  * ``.github/workflows/forbid-public-schema.yml``, step
    "Scan for forbidden public.* references"
  * ``.qontinui/ci.toml``, step ``forbid-public-schema``

Phase 7 deliverable of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md`` 5.6).

Fails if any tracked source file (re-)introduces a ``public.<table>`` schema
reference. Post-Phase-7 the ``public`` schema contains only
``alembic_version`` (alembic's own bookkeeping); domain tables live in
project / coord / agent / auth / cloud / strategy / web — the canonical set
in ``.pre-commit-hooks/check_alembic_schema_args.py``'s ``ALLOWED_SCHEMAS``.
Keep this comment in sync with it.

The scan is a ``git grep`` over tracked files (subprocess argv, no shell), so
the regex dialect and the pathspec semantics are git's own — identical to the
``run:`` block this script replaced.

Exclusions (legitimate references that must not trigger) are
:data:`EXCLUDE_PATHSPECS` below; each carries its own reason. The
``public.alembic_version`` survivor is filtered from the match lines rather
than by pathspec, because it can legitimately appear in any file.

Exit codes: 0 clean, 1 forbidden reference found, 2 scanned nothing or
``git grep`` itself errored (vacuous — not a pass).
"""

from __future__ import annotations

import subprocess
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

# Conventional SQL/Python references to a public-schema object:
#   - FROM / JOIN / INTO / UPDATE / DELETE FROM  <public schema>.<table>
#   - ForeignKey("<public schema>.<table>...
#   - schema="public"  /  schema='public'
#   - secondary="<public schema>.<table>...
# (Spelled obliquely in this comment on purpose: the literal forms would match
# the pattern itself. The file is pathspec-excluded from its own scan anyway —
# see EXCLUDE_PATHSPECS — but a gate whose own docs trip it is a trap.)
PATTERN = (
    r"FROM public\.|JOIN public\.|INTO public\.|UPDATE public\.|"
    r"DELETE FROM public\.|ForeignKey\([^)]*public\.|"
    r"""secondary\s*=\s*["']public\.|schema\s*=\s*["']public["']"""
)

EXCLUDE_PATHSPECS = [
    # All Markdown documentation: historical context and plan archaeology.
    ":!*.md",
    # Phase 7 ALTER TABLE strings + the pre-consolidation chain history both
    # legitimately name the old schema inside op.execute() strings. Already
    # applied; not subject to regression gating.
    ":!backend/alembic/versions/*",
    # Staging copies of the Phase 7 revisions.
    ":!backend/alembic/_staged_phase7/*",
    # Self-reference: this file IS the pattern's home. Before Phase 5 of plan
    # 2026-08-08-ci-tool-registry-and-canonical-configuration-parity the
    # excluded path was .github/workflows/forbid-public-schema.yml, which held
    # the pattern inline; the workflow now only invokes this script and holds
    # no pattern text, so the exclusion moved here with it.
    ":!scripts/ci/check_forbidden_public_schema.py",
]

# The one legitimate post-Phase-7 survivor: alembic's own bookkeeping table.
ALEMBIC_VERSION_SURVIVOR = "public.alembic_version"


def _git(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def main() -> int:
    # Non-vacuity: prove the pathspec set actually selects files before
    # believing a no-match result. An empty scan is an unknown, not a green.
    listing = _git(["ls-files", "--", *EXCLUDE_PATHSPECS])
    if listing.returncode != 0:
        err(
            f"`git ls-files` failed (exit {listing.returncode}): {listing.stderr.strip()}"
        )
        return EXIT_VACUOUS
    in_scope = [ln for ln in listing.stdout.splitlines() if ln.strip()]
    require_nonempty(len(in_scope), "tracked files", "the gate's pathspec set")

    result = _git(["grep", "-nE", PATTERN, "--", *EXCLUDE_PATHSPECS])
    # git grep: 0 = matches found, 1 = no matches, >1 = real error. The shell
    # original ended in `|| true`, which turned a bad pathspec or a broken
    # regex into a silent pass. Distinguish them.
    if result.returncode > 1:
        err(f"`git grep` failed (exit {result.returncode}): {result.stderr.strip()}")
        err("The scan did not run, so this is NOT a clean result.")
        return EXIT_VACUOUS

    forbidden = [
        line
        for line in result.stdout.splitlines()
        if line.strip() and ALEMBIC_VERSION_SURVIVOR not in line
    ]

    if forbidden:
        err(
            "public.* schema reference detected in source. Post-Phase-7, the "
            "public schema contains only alembic_version; domain tables live in "
            "project / coord / agent / auth / cloud / strategy / web."
        )
        for line in forbidden:
            print(line, file=sys.stderr)
        err(
            "If this is a legitimate historical reference (docs, alembic chain "
            "history), add the file pattern to EXCLUDE_PATHSPECS in "
            "scripts/ci/check_forbidden_public_schema.py."
        )
        err(
            "If the reference is to the alembic bookkeeping table, the filter "
            "should already exclude it — surface to the gate maintainer if it "
            "is failing on that."
        )
        return EXIT_VIOLATION

    note(
        f"No forbidden public.* references found — scanned {len(in_scope)} "
        "tracked file(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
