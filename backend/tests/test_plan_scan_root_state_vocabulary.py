"""The scan-root ``state`` vocabulary exists in four places. Pin them together.

Post-merge follow-up to qontinui-web#1310
(``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``).

``measured | not_scanning | not_a_git_work_tree | unknown`` is written out four
times, and until this module nothing connected any two of them:

1. ``app.models.plan_scan_root.SCAN_ROOT_STATES`` — which #1310 defined and
   then never read, from anywhere. Its own docstring said it was "enforced in
   Postgres" and "mirrored as a ``Literal``" while both of those were
   independent hand-written copies.
2. That model's ``ck_plan_scan_root_observations_state`` CHECK — now BUILT from
   (1) as ``STATE_CHECK_SQL``, which is the one copy the code could remove.
3. ``app.schemas.plan_library_scan_roots.ScanRootState`` — a ``typing.Literal``,
   which cannot be derived from a runtime tuple, so it is pinned here instead.
4. The shipped migration ``plan_library_05_scan_root_observations`` — history,
   and therefore the one copy that must NEVER be rewritten. It is read as text
   and compared, never edited.

Why this is worth a test rather than a comment. The schema's ``Literal`` is
what turns a fifth state into a 422; the migration's CHECK is what the database
actually enforces. Add a state to the schema and forget the migration and the
first device to report it takes an ``IntegrityError`` 500 — in the write path
of a diagnostic whose whole purpose is to be more reliable than the silence it
replaced. Nothing else in the suite would catch it: the route tests exercise
only states that already exist.

The runner is the fifth copy (``ScanDivergenceState`` in
``qontinui-runner/src-tauri/src/plan_workunit_adapter/trigger.rs``) and is out
of this repo's reach. The runner side pins it from there, in
``every_scan_root_report_state_satisfies_the_web_contract``.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from app.models.plan_scan_root import (
    SCAN_ROOT_STATES,
    STATE_CHECK_SQL,
    PlanScanRootObservation,
)
from app.schemas.plan_library_scan_roots import ScanRootState

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "plan_library_05_scan_root_observations.py"
)

CONSTRAINT_NAME = "ck_plan_scan_root_observations_state"


def _states_in_migration_check() -> list[str]:
    """The quoted values inside the migration's ``state`` CHECK, in order.

    Read as TEXT on purpose. The migration is a shipped historical record: this
    test exists to notice when it stops agreeing with the live vocabulary, not
    to give anyone a reason to edit it.
    """
    source = MIGRATION.read_text(encoding="utf-8")
    start = source.index(f"CONSTRAINT {CONSTRAINT_NAME} CHECK (")
    # The clause ends at the first `)` that closes the CHECK's own paren pair.
    depth = 0
    for i in range(start, len(source)):
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                clause = source[start : i + 1]
                break
    else:  # pragma: no cover — an unbalanced clause is a broken migration
        raise AssertionError(f"unterminated CHECK clause in {MIGRATION}")
    return re.findall(r"'([^']*)'", clause)


def test_the_model_check_is_built_from_the_vocabulary_not_restated() -> None:
    """(1) → (2). The CHECK must be derived, so it cannot drift on its own."""
    assert STATE_CHECK_SQL == "state IN ({})".format(
        ", ".join(f"'{state}'" for state in SCAN_ROOT_STATES)
    )
    constraint = next(
        c
        for c in PlanScanRootObservation.__table__.constraints
        if c.name == CONSTRAINT_NAME
    )
    assert str(constraint.sqltext) == STATE_CHECK_SQL


def test_the_request_schema_literal_matches_the_vocabulary() -> None:
    """(1) ↔ (3). A state the schema accepts that the model does not know —
    or vice versa — is a 500 in the write path, not a 422."""
    assert set(get_args(ScanRootState)) == set(SCAN_ROOT_STATES)
    # Ordered too, so the OpenAPI enum an api-client generates reads the same
    # way as the tuple and a reviewer diffing the two is not misled.
    assert list(get_args(ScanRootState)) == list(SCAN_ROOT_STATES)


def test_the_shipped_migration_check_matches_the_vocabulary() -> None:
    """(1) ↔ (4). What Postgres actually enforces.

    If this fails, the fix is a NEW migration altering the constraint — never
    an edit to this one. A deployed database already carries the old CHECK, and
    rewriting history would leave the two permanently out of step with nothing
    to notice it.
    """
    assert _states_in_migration_check() == list(SCAN_ROOT_STATES)


def test_the_extractor_actually_reads_the_migration() -> None:
    """The guard above is only as good as its parse — assert it found four
    values from the real file, so a silently-empty match cannot pass vacuously."""
    found = _states_in_migration_check()
    assert len(found) == 4, found
    assert "measured" in found
