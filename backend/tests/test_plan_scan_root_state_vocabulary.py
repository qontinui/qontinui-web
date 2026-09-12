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
4. The migrations — history, and therefore the copies that must NEVER be
   rewritten. They are read as text and compared, never edited.

Why this is worth a test rather than a comment. The schema's ``Literal`` is
what turns a fifth state into a 422; the migrations' CHECK is what the database
actually enforces. Add a state to the schema and forget the migration and the
first device to report it takes an ``IntegrityError`` 500 — in the write path
of a diagnostic whose whole purpose is to be more reliable than the silence it
replaced. Nothing else in the suite would catch it: the route tests exercise
only states that already exist, and the sibling migration test asserts the
constraint exists BY NAME (``test_plan_library_05_scan_root_observations_migration``)
without asserting which values it admits.

**How the migration assertion is framed, and why.** It asks whether SOME
migration in the tree defines this constraint with exactly the live vocabulary
— not whether ``plan_library_05`` in particular does. That distinction is the
difference between a guard and a tripwire. Adding a fifth state correctly means
a new migration ``ALTER``-ing the constraint, and a test pinned to the frozen
``plan_library_05`` file would go red on precisely that correct change, while
telling the author the one fix it names (edit that migration) is forbidden. The
looser form passes as soon as the new ``ALTER`` lands and still fails when no
migration mentions the new state at all, which is the mistake worth catching.

Its one blind spot, stated rather than papered over: a later migration that
NARROWED the vocabulary would leave an older matching definition behind and
this would still pass. The definitive assertion is over a migrated database —
``pg_get_constraintdef`` after the whole chain — and belongs in the sibling
DB-backed migration test. This module is the complement that never SKIPS: every
DB assertion there sits behind a "Postgres not reachable" skip, and on a
developer box without a database that is exactly no assertion at all.

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
from tests._alembic_harness import backend_root

CONSTRAINT_NAME = "ck_plan_scan_root_observations_state"

#: The migration that created the constraint. Named so the extractor's own
#: self-test has a file it can assert against; the vocabulary assertion
#: deliberately does NOT pin to it (see the module docstring).
CREATING_REVISION = "plan_library_05_scan_root_observations.py"


def _versions_dir() -> Path:
    return backend_root() / "alembic" / "versions"


def _quoted_values_in_check(source: str) -> list[str] | None:
    """The quoted values inside ``source``'s ``state`` CHECK, or ``None``.

    Read as TEXT on purpose. A migration is a shipped historical record: this
    module exists to notice when the chain stops agreeing with the live
    vocabulary, not to give anyone a reason to edit one.
    """
    needle = f"CONSTRAINT {CONSTRAINT_NAME} CHECK ("
    start = source.find(needle)
    if start < 0:
        return None
    # The clause ends at the `)` closing the CHECK's own paren pair, so the
    # nested `IN (...)` is stepped over rather than mistaken for the end.
    depth = 0
    for i in range(start, len(source)):
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                return re.findall(r"'([^']*)'", source[start : i + 1])
    raise AssertionError(f"unterminated CHECK clause near {needle!r}")


def _definitions_across_migrations() -> dict[str, list[str]]:
    """Every migration that defines this constraint → the values it admits."""
    found: dict[str, list[str]] = {}
    for path in sorted(_versions_dir().glob("*.py")):
        values = _quoted_values_in_check(path.read_text(encoding="utf-8"))
        if values is not None:
            found[path.name] = values
    return found


def test_the_model_check_is_built_from_the_vocabulary_not_restated() -> None:
    """(1) → (2). The CHECK must be DERIVED, so it cannot drift on its own.

    Asserted by parsing the constraint the model actually carries and comparing
    the values back to the tuple — not by re-running ``STATE_CHECK_SQL``'s own
    format expression, which would restate the implementation and pass just as
    happily against an empty vocabulary (``state IN ()`` on both sides).
    """
    constraint = next(
        c
        for c in PlanScanRootObservation.__table__.constraints
        if c.name == CONSTRAINT_NAME
    )
    assert re.findall(r"'([^']*)'", str(constraint.sqltext)) == list(SCAN_ROOT_STATES)
    assert str(constraint.sqltext) == STATE_CHECK_SQL


def test_the_request_schema_literal_matches_the_vocabulary() -> None:
    """(1) ↔ (3). A state the schema accepts that the model does not know —
    or vice versa — is a 500 in the write path, not a 422."""
    assert set(get_args(ScanRootState)) == set(SCAN_ROOT_STATES)
    # Ordered too, so the OpenAPI enum an api-client generates reads the same
    # way as the tuple and a reviewer diffing the two is not misled.
    assert list(get_args(ScanRootState)) == list(SCAN_ROOT_STATES)


def test_some_migration_admits_exactly_the_live_vocabulary() -> None:
    """(1) ↔ (4). What Postgres ends up enforcing.

    If this fails, the fix is a NEW migration ``ALTER``-ing the constraint —
    never an edit to a shipped one. A deployed database already carries the old
    CHECK, and rewriting history would leave the two permanently out of step
    with nothing to notice it. The assertion is deliberately "some migration",
    so making that correct fix is what turns this green again.
    """
    definitions = _definitions_across_migrations()
    assert definitions, (
        f"no migration under {_versions_dir()} defines {CONSTRAINT_NAME} — "
        "either the constraint was renamed or this test has lost its subject"
    )
    assert list(SCAN_ROOT_STATES) in definitions.values(), (
        f"no migration admits exactly {list(SCAN_ROOT_STATES)}. Found: "
        f"{definitions}. Add a migration ALTERing the constraint; do not edit "
        "a shipped one."
    )


def test_the_extractor_actually_reads_the_creating_migration() -> None:
    """The guard above is only as good as its parse.

    Pinned to the CREATING migration's content, which is frozen — so this
    asserts the extractor works on a real file rather than asserting anything
    about the live vocabulary. A silently-empty match cannot pass here, and
    without that the "some migration" assertion could be satisfied by a parse
    that never found anything.
    """
    values = _quoted_values_in_check(
        (_versions_dir() / CREATING_REVISION).read_text(encoding="utf-8")
    )
    assert values == [
        "measured",
        "not_scanning",
        "not_a_git_work_tree",
        "unknown",
    ]


def test_a_migration_without_the_constraint_parses_as_absent_not_empty() -> None:
    """``None`` (this file does not define it) must not read as ``[]``.

    The distinction is what lets ``_definitions_across_migrations`` walk every
    migration in the tree without a file that is silent about the constraint
    contributing an empty vocabulary that matches nothing.
    """
    assert _quoted_values_in_check("def upgrade(): pass") is None
    assert _quoted_values_in_check(
        f"CONSTRAINT {CONSTRAINT_NAME} CHECK (state IN ('a', 'b'))"
    ) == ["a", "b"]
