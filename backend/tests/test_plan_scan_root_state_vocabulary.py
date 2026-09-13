"""The backend's four copies of the scan-root ``state`` vocabulary, pinned together.

Post-merge follow-up to qontinui-web#1310
(``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``).

``measured | not_scanning | not_a_git_work_tree | unknown`` is written out four
times in this backend, and until this module nothing connected any two of them:

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

The operator console holds a sixth (``SCAN_ROOT_STATES`` in
``frontend/src/app/(app)/admin/coord/plan-library/types.ts``), across a language
seam this suite does not parse. ``types.wire.test.ts`` beside it pins that copy
against the committed OpenAPI snapshots, which backend CI regenerates from this
app's schema and refuses to let drift.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import get_args
from uuid import uuid4

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


#: The two spellings a migration in this repo uses for a named CHECK. Twelve
#: migrations under ``alembic/versions/`` use the raw-SQL form and six use the
#: Alembic helper, so an extractor that knew only one would tell an author who
#: added a fifth state in the OTHER idiom to "add a migration ALTERing the
#: constraint" — the thing they had just done. That is the tripwire-rather-than-
#: guard shape this module was reworked to remove, and it would have come back
#: as "which spelling" instead of "which file".
_CHECK_NEEDLES = (
    f"CONSTRAINT {CONSTRAINT_NAME} CHECK (",
    f'op.create_check_constraint(\n        "{CONSTRAINT_NAME}"',
)


def _quoted_values_in_check(source: str) -> list[str] | None:
    """The quoted values inside ``source``'s ``state`` CHECK, or ``None``.

    ``None`` means "this file does not define the constraint" and is distinct
    from ``[]`` ("it defines one admitting nothing"). The distinction is what
    lets the emptiness guard in
    :func:`test_some_migration_admits_exactly_the_live_vocabulary` fire at all:
    were an absent constraint to return ``[]``, every migration in the tree
    would contribute an entry and "no migration defines this constraint" could
    never be true.

    Read as TEXT on purpose. A migration is a shipped historical record: this
    module exists to notice when the chain stops agreeing with the live
    vocabulary, not to give anyone a reason to edit one.

    Only the FIRST definition in a file is read. An ``ALTER`` migration
    normally spells the constraint twice — the new vocabulary in ``upgrade()``,
    the old one restored in ``downgrade()`` — and with the conventional
    ordering the first is the one that matters. Stated because it is a
    convention this relies on, not a property it enforces.
    """
    start, needle = -1, ""
    for candidate in _CHECK_NEEDLES:
        at = source.find(candidate)
        if at >= 0 and (start < 0 or at < start):
            start, needle = at, candidate
    if start < 0:
        return None
    # The clause ends at the `)` closing the match's own paren pair, so the
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
    """(1) ↔ (4). Some migration in the tree admits exactly this vocabulary.

    Read the heading literally: this is a LOWER BOUND ON HISTORY, not a
    statement about the chain's end state. It is satisfied by a frozen file
    that once defined the vocabulary, so it also passes if a later migration
    WIDENED the DB past the tuple, NARROWED it, or dropped the constraint
    outright. The end-state assertion needs a migrated database —
    ``pg_get_constraintdef`` after the whole chain — and belongs in the
    sibling DB-backed test. What this catches, and catches without ever
    skipping, is the mistake actually made: a state added to the code with no
    migration mentioning it anywhere.

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

    What the distinction protects is the EMPTINESS GUARD in
    ``test_some_migration_admits_exactly_the_live_vocabulary``, not the
    membership test beside it: ``list(...) in definitions.values()`` is
    unaffected by stray ``[]`` entries, but a tree where every silent file
    contributed one would make "no migration defines this constraint"
    unreachable — and that assertion is the only thing standing between a
    renamed constraint and a test that quietly measures nothing.
    """
    assert _quoted_values_in_check("def upgrade(): pass") is None
    assert _quoted_values_in_check(
        f"CONSTRAINT {CONSTRAINT_NAME} CHECK (state IN ('a', 'b'))"
    ) == ["a", "b"]


def test_the_extractor_reads_both_check_idioms_this_repo_uses() -> None:
    """Six migrations use the Alembic helper rather than raw SQL.

    An extractor blind to that spelling would fail the NEXT correct vocabulary
    change written in the idiomatic form, and tell its author to do what they
    had just done.
    """
    helper_form = (
        "    op.create_check_constraint(\n"
        f'        "{CONSTRAINT_NAME}",\n'
        '        "plan_scan_root_observations",\n'
        "        \"state IN ('measured', 'wedged')\",\n"
        '        schema="agent",\n'
        "    )\n"
    )
    assert _quoted_values_in_check(helper_form) == ["measured", "wedged"]

    # And the idiom is genuinely present in the tree, so this is not a test of
    # a spelling nobody uses.
    helper_users = sum(
        1
        for path in _versions_dir().glob("*.py")
        if "op.create_check_constraint(" in path.read_text(encoding="utf-8")
    )
    assert helper_users > 0, (
        "no migration uses op.create_check_constraint — if that is now true, "
        "the second needle is dead weight and can go"
    )


# ---------------------------------------------------------------------------
# The verdict-reason prefixes are a wire contract too, and the frontend reads
# them. Same defect class as the state vocabulary above, one seam over.
# ---------------------------------------------------------------------------

#: What `ScanSourcesPanel.tsx` matches on to decide TENSE.
#:
#: It is the one `unknown` reason compatible with the reading still being the
#: device's latest word — a 0-behind FLOOR, where the device reported moments
#: ago and it is the REF that is stale — so the panel keeps such a row in the
#: present tense while hedging every other `unknown`. The constant is spelled
#: out in TypeScript (`REF_STALE_PREFIX`), across a repo boundary no compiler
#: crosses.
#:
#: Rewording the detail to `ref_stale(0/0):` would therefore flip every
#: `ref_stale` row to "As reported:" on a live device — a wrong implication
#: introduced by an unrelated copy edit, with a green suite on both sides. This
#: pins the half that lives here. The mirror lives in
#: `ScanSourcesPanel.test.tsx`.
FRONTEND_REF_STALE_PREFIX = "ref_stale:"

#: The other two reasons the read route emits. The panel does not match on
#: these today — it treats "not the ref_stale prefix" as the hedged arm — but
#: they are the same wire contract and a reader keying on them is the obvious
#: next step, so they are pinned before that reader exists rather than after.
VERDICT_PREFIXES = ("observation_stale:", "reading_superseded:", "ref_stale:")


def test_the_ref_stale_prefix_is_what_the_route_actually_emits() -> None:
    """The frontend's tense rule depends on this string. Pin it here."""
    from app.services.plan_scan_root_health import (
        REF_STALE_ZERO_FLOOR_DETAIL,
        ref_stale_zero_behind_detail,
    )

    assert REF_STALE_ZERO_FLOOR_DETAIL.startswith(FRONTEND_REF_STALE_PREFIX)
    assert ref_stale_zero_behind_detail(3).startswith(FRONTEND_REF_STALE_PREFIX)


def test_every_verdict_detail_names_its_rule_with_a_known_prefix() -> None:
    """A reason with no recognised prefix reads as UNKNOWN currency downstream.

    That arm is deliberately conservative — it hedges rather than asserting a
    silence — but it is still a degraded rendering, and a reason that lands
    there because of a typo rather than a genuinely new rule is a silent
    regression. So each emitted detail is checked to start with one of the
    three the panel knows.
    """
    from app.services.plan_scan_root_health import (
        NO_OBSERVATION_DETAIL,
        REF_STALE_ZERO_FLOOR_DETAIL,
        ref_stale_zero_behind_detail,
    )

    for detail in (REF_STALE_ZERO_FLOOR_DETAIL, ref_stale_zero_behind_detail(7)):
        assert detail.startswith(VERDICT_PREFIXES), detail

    # The top-level no-rows detail is a different vocabulary (it describes the
    # ORGANIZATION, not a row) and must not be confused with a row verdict.
    assert NO_OBSERVATION_DETAIL.startswith("no_observation:")
    assert not NO_OBSERVATION_DETAIL.startswith(VERDICT_PREFIXES)


def _row(**overrides: object) -> PlanScanRootObservation:
    """An in-memory observation row. No session, no database, no skip."""
    now = datetime(2026, 9, 12, 5, 0, tzinfo=UTC)
    fields: dict[str, object] = {
        "device_id": uuid4(),
        "organization_id": None,
        "state": "measured",
        "detail": None,
        "plans_dir": "/w/qontinui-dev-notes/plans",
        "repo_root": "/w/qontinui-dev-notes",
        "source_repo": "qontinui-dev-notes/plans",
        "default_ref": "origin/main",
        "ref_sha": "d455ad5cb",
        "head_sha": "0d2390c07",
        "behind": 254,
        "ahead": 0,
        "ref_age_secs": 120,
        "counts_are_floors": False,
        "observed_at": now,
        "received_at": now,
        "last_report_applied": True,
        "last_report_observed_at": now,
    }
    fields.update(overrides)
    return PlanScanRootObservation(**fields)


def test_the_other_two_verdicts_also_name_their_rule_with_a_known_prefix() -> None:
    """``observation_stale:`` and ``reading_superseded:`` are built inline in
    ``render_row`` rather than as constants, so they are pinned by RENDERING a
    row that triggers each rule — which needs no database.

    Together with the two ``ref_stale`` constants above, that is every verdict
    detail the route can emit, each checked to carry a prefix the panel knows.
    A reason that lost its prefix would silently demote every affected row to
    the frontend's hedged arm.
    """
    from app.services.plan_scan_root_health import (
        FRESH_WITHIN_SECS,
        render_row,
    )

    now = datetime(2026, 9, 12, 5, 0, tzinfo=UTC)

    stale = render_row(
        _row(received_at=now - timedelta(seconds=FRESH_WITHIN_SECS + 60)),
        now=now,
    )
    assert stale.state == "unknown"
    assert stale.detail is not None
    assert stale.detail.startswith("observation_stale:")

    superseded = render_row(
        _row(
            last_report_applied=False,
            last_report_observed_at=now - timedelta(hours=6),
        ),
        now=now,
    )
    assert superseded.state == "unknown"
    assert superseded.detail is not None
    assert superseded.detail.startswith("reading_superseded:")

    ref_stale = render_row(
        _row(behind=0, ahead=0, counts_are_floors=True, ref_age_secs=None),
        now=now,
    )
    assert ref_stale.state == "unknown"
    assert ref_stale.detail is not None
    assert ref_stale.detail.startswith(FRONTEND_REF_STALE_PREFIX)

    # And the control: a row no rule fires on keeps the reported verdict, so
    # the three assertions above are not passing because every row is unknown.
    fine = render_row(_row(), now=now)
    assert fine.state == "measured"
    assert fine.detail is None
