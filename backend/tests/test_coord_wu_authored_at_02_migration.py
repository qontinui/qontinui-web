"""Data-semantics test for the ``coord_wu_authored_at_02`` revision (refill only).

``coord_wu_authored_at_02`` re-runs ``coord_wu_authored_at_01``'s slug-prefix
backfill for dated units created AFTER that revision ran — through the
``coord_work_unit_upsert`` MCP door, whose callers omit ``authored_at``, or by a
runner build predating Phase B. 29 such rows existed on 2026-09-13.

The column already exists at the parent revision, so the contract here is
entirely data:

1. **Dated, NULL** — ``2026-09-12-new-plan`` → ``2026-09-12T00:00:00Z``.
2. **Dated, already set** — a caller-supplied instant WITH a time of day
   survives, and its row is not rewritten. The refill must never replace a
   value another writer stored.
3. **Undated** — ``bodyless-unit`` stays NULL and its tuple is not rewritten.
4. **Non-calendar prefix** — ``2026-02-30-bogus`` stays NULL, and the run does
   not abort. Without the per-row handler the DO block raises and the upgrade
   fails outright; a second dated row seeded AFTER the bad one must still be
   dated, since the loop has no ``ORDER BY`` and table order usually follows
   insertion order.
5. **Anchored** — ``feature-2026-01-01-x`` stays NULL.
6. **Downgrade is a no-op** — every value, including the refilled ones,
   survives it. The refilled rows are indistinguishable from rows another
   writer dated, so nulling them would destroy real dates.

Plus two no-database checks: the pinned parent matches ``down_revision`` (read
with the CI head gate's own single-line pattern, so a formatter-wrapped
assignment the gate cannot parse fails here too), and the executed SQL is
byte-identical to ``coord_wu_authored_at_01``'s — the two revisions must agree
on which slugs carry a date and what instant it denotes, and that parity is
what the ``_01`` test's predicate cases already pin.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

# Pinned explicitly rather than "head", so a later migration cannot change what
# this test walks. `_PARENT_REVISION_ID` MUST equal the revision's own
# `down_revision`; the first test enforces it.
_REVISION_ID = "coord_wu_authored_at_02"
_PARENT_REVISION_ID = "devconn_inst_01_device_connections_instance"
_REVISION_FILENAME = "coord_wu_authored_at_02_refill_dated_slugs.py"
_FIRST_BACKFILL_FILENAME = "coord_wu_authored_at_01_work_units_authored_at.py"

_TENANT = uuid.uuid4()

# Seeded in this order; see case 4 for why the second dated row comes last.
_DATED_NULL = "2026-09-12-new-plan"
_DATED_SET = "2026-09-11-already-dated"
_UNDATED = "bodyless-unit"
_NON_CALENDAR = "2026-02-30-bogus"
_ANCHORED_MISS = "feature-2026-01-01-x"
_DATED_NULL_AFTER_BAD = "2026-09-13-seeded-after-the-bad-row"

_EXPECTED_DATED_NULL = datetime(2026, 9, 12, tzinfo=UTC)
_EXPECTED_DATED_NULL_AFTER_BAD = datetime(2026, 9, 13, tzinfo=UTC)
# Deliberately not the slug's midnight, so a clobber is visible.
_CALLER_SUPPLIED = datetime(2026, 9, 11, 14, 5, tzinfo=UTC)


def _versions_path(filename: str) -> Path:
    return backend_root() / "alembic" / "versions" / filename


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` is the revision's real parent — no database needed.

    The pattern deliberately admits no opening parenthesis: it is the shape the
    CI head gate (`scripts/ci/_alembic_graph.py`) can read. A wrapped
    assignment would parse here and still count as a second head there.
    """
    source = _versions_path(_REVISION_FILENAME).read_text(encoding="utf-8")
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        source,
        re.MULTILINE,
    )
    assert match is not None, (
        f"no single-line down_revision found in {_REVISION_FILENAME} — the CI "
        "head gate cannot read a wrapped assignment"
    )
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins _PARENT_REVISION_ID={_PARENT_REVISION_ID!r}."
    )


def test_the_refill_is_the_first_backfill_verbatim() -> None:
    """Both revisions execute the SAME backfill — no database needed.

    The ``_01`` test pins every eligibility branch (anchored, trailing dash,
    non-calendar guard, time-zone-independent literal) against ``_01``'s SQL.
    Requiring byte equality here extends that coverage to ``_02`` instead of
    duplicating it, and fails loudly if either copy drifts.
    """
    refill = load_revision_module(
        _versions_path(_REVISION_FILENAME), "coord_wu_authored_at_02_under_test"
    )
    first = load_revision_module(
        _versions_path(_FIRST_BACKFILL_FILENAME),
        "coord_wu_authored_at_01_parity_source",
    )
    assert refill._BACKFILL_SQL == first._BACKFILL_SQL, (
        "coord_wu_authored_at_02 must re-run coord_wu_authored_at_01's backfill "
        "unchanged, so the two agree on which slugs carry a date"
    )


def _seed(engine: Engine) -> None:
    with engine.begin() as conn:
        for slug, authored_at in (
            (_DATED_NULL, None),
            (_DATED_SET, _CALLER_SUPPLIED),
            (_UNDATED, None),
            (_NON_CALENDAR, None),
            (_ANCHORED_MISS, None),
            (_DATED_NULL_AFTER_BAD, None),
        ):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.work_units
                        (slug, tenant_id, status, title, authored_at, updated_at)
                    VALUES (:slug, :tenant, 'draft', :slug, :authored_at, now())
                    """
                ),
                {"slug": slug, "tenant": _TENANT, "authored_at": authored_at},
            )


def _authored(engine: Engine) -> dict[str, datetime | None]:
    with engine.connect() as conn:
        conn.execute(text("SET TIME ZONE 'UTC'"))
        rows = conn.execute(
            text("SELECT slug, authored_at FROM coord.work_units ORDER BY slug")
        ).all()
    return {r[0]: r[1] for r in rows}


def _xmin(engine: Engine, slug: str) -> str:
    with engine.connect() as conn:
        value = conn.execute(
            text("SELECT xmin::text FROM coord.work_units WHERE slug = :slug"),
            {"slug": slug},
        ).scalar()
    assert value is not None, f"no row for {slug}"
    return str(value)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the authored_at REFILL "
        "was NOT verified — only that the revision's parent pin and its SQL "
        "parity with coord_wu_authored_at_01 hold. This skip is not a pass. CI "
        "provisions a postgres service; locally point QONTINUI_TEST_PG at a "
        "reachable instance."
    ),
)
def test_coord_wu_authored_at_02_refills_null_dated_slugs_only() -> None:
    """Seed at the parent revision, apply the refill, then downgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_wu_authored_at_02_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _seed(engine)
        undated_xmin = _xmin(engine, _UNDATED)
        set_xmin = _xmin(engine, _DATED_SET)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        after = _authored(engine)

        # Case 1 — the hole this revision exists for.
        assert after[_DATED_NULL] == _EXPECTED_DATED_NULL
        # Case 2 — a stored value is never replaced, nor its row rewritten.
        assert after[_DATED_SET] == _CALLER_SUPPLIED
        assert _xmin(engine, _DATED_SET) == set_xmin, (
            "an already-dated row must not be visited by the refill"
        )
        # Case 3 — undated stays NULL and untouched.
        assert after[_UNDATED] is None
        assert _xmin(engine, _UNDATED) == undated_xmin
        # Case 4 — non-calendar prefix stays NULL, and the row seeded after it
        # is still dated.
        assert after[_NON_CALENDAR] is None
        assert after[_DATED_NULL_AFTER_BAD] == _EXPECTED_DATED_NULL_AFTER_BAD
        # Case 5 — anchored predicate.
        assert after[_ANCHORED_MISS] is None

        # Case 6 — downgrade touches nothing.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _authored(engine) == after, (
            "the downgrade is a no-op: refilled dates are indistinguishable from "
            "dates another writer stored, so it must not null them"
        )
