"""Data-semantics test for the ``coord_wu_authored_at_01`` revision (add + backfill).

Phase A of plan ``2026-09-02-coord-work-units-carry-no-authoring-date`` adds
``coord.work_units.authored_at`` and backfills it from the slug's ``YYYY-MM-DD-``
prefix in the SAME revision.

The ADD is trivial; a schema-shape assertion would prove nothing about the part
that matters. The revision's real contract is *data*: which rows receive a
date, which are deliberately left NULL, what instant is stored (and whether the
session time zone can bend it), what happens when the backfill re-runs over a
value another writer already put there, whether a malformed prefix aborts the
run, and what the downgrade is allowed to touch. So this test seeds the parent
revision, walks one step up, and asserts the resulting rows — the shape
``test_parkwuslug_01_park_work_unit_slug_migration`` uses for the sibling
expand+backfill.

Why this coverage matters
=========================

Two writers derive this value: the backfill here, once, and — after Phases B and
D — the runner's ``authored_at_from_stem`` on every ~68 s scan, upserted under
``COALESCE(EXCLUDED.authored_at, coord.work_units.authored_at)``. They must agree
on **which stems carry a date** and **what instant that date denotes**, or the
113-of-194 disagreement this plan removes simply moves to a new column. The
predicate cases below are the Rust function's own branches, and the time-zone
case is the one an ``UPDATE`` that "looks right" in a UTC dev shell gets wrong
in a migrator whose session zone is not UTC.

Cases covered (each is a distinct branch of the backfill)
=========================================================

1. **Dated** — ``2026-05-14-foo`` → ``2026-05-14T00:00:00Z``. Two such rows, so
   a single-row write would fail.
2. **Anchored** — ``feature-2026-01-01-x`` stays NULL. The regex is anchored at
   ``^`` because the Rust checks bytes 0-10; a date in the middle of a slug is
   not an authoring date.
3. **Trailing dash required** — a bare ``2026-05-14`` stays NULL, mirroring the
   Rust's ``len() < 11`` / ``b[10] != b'-'`` checks.
4. **Undated** — ``shepherd-abc`` stays NULL, and its tuple is NOT rewritten
   (``xmin`` unchanged): the loop must select only eligible rows, not visit
   every row and write NULL over NULL.
5. **Non-calendar prefix** — ``2026-02-30-bogus`` matches the shape but is not
   a date. It must stay NULL *and every other row must still be dated*: a
   plain ``UPDATE`` would raise ``datetime_field_overflow`` on this row and roll
   the whole backfill back, which on the pipeline-applied canonical RDS means
   a red migration on one slug's typo. The per-row exception guard is what
   this case pins.
6. **Session-time-zone independence** — the upgrade is run with
   ``PGTZ=America/Los_Angeles`` in the alembic subprocess's environment, and
   the stored instant must still be midnight **UTC**. ``to_timestamp(text,
   'YYYY-MM-DD')`` reads the text in the session zone and would store
   ``2026-05-14 07:00:00+00`` here; the ``...T00:00:00Z`` literal does not.
7. **No-clobber on re-run** — the ``WHERE authored_at IS NULL`` guard. After
   the first upgrade a row is given a deliberately different date (as Phase D's
   MCP input will allow an operator to do); ``stamp`` back and re-upgrade must
   not replace it with the slug-derived one.
8. **``created_at`` is not touched** in either direction. It is a truthful
   record of ingestion and the plan's stated non-goal.

Then three walks are asserted: **re-run** (case 7), **downgrade** (drops ONLY
``authored_at``; ``created_at`` and every other column survive), and
**re-upgrade** (the value is re-derivable from the slug — and the operator's
hand-set date from case 7 is NOT restored, which is the honest consequence of
a rollback and worth stating rather than asserting around).

Substrate comes from ``_alembic_harness`` (shared with the other migration
tests): an ephemeral DB inside the test Postgres, skipped when none is
reachable. Locally that means pointing ``QONTINUI_TEST_PG`` at a reachable
instance (``conftest.py`` builds ``DATABASE_URL`` from it); CI provisions one at
the default ``localhost:5432``.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

# The revision under test and its parent. Both are pinned explicitly rather
# than using "head" so a later migration landing on top cannot silently change
# what this test walks.
#
# `_PARENT_REVISION_ID` MUST stay equal to the revision's own `down_revision`;
# `test_the_pinned_parent_matches_the_revisions_down_revision` below enforces
# it. The walks rewind with `stamp`/`downgrade` to `_PARENT_REVISION_ID` and
# then `upgrade`, so too far a rewind REPLAYS every intervening revision and
# the test dies on a `DuplicateTable` raised by an unrelated migration.
_REVISION_ID = "coord_wu_authored_at_01"
_PARENT_REVISION_ID = "atu_02_atu_provenance"
_REVISION_FILENAME = "coord_wu_authored_at_01_work_units_authored_at.py"

_TENANT = uuid.uuid4()

# Slugs, one per case. The names say which branch each exercises.
_DATED_A = "2026-05-14-foo"
_DATED_B = "2026-06-10-bar-baz"
_ANCHORED_MISS = "feature-2026-01-01-x"
_NO_TRAILING_DASH = "2026-05-14"
_UNDATED = "shepherd-abc"
_NON_CALENDAR = "2026-02-30-bogus"

_EXPECTED_A = datetime(2026, 5, 14, tzinfo=UTC)
_EXPECTED_B = datetime(2026, 6, 10, tzinfo=UTC)

# What an operator (via Phase D's MCP input) puts on a row before the re-run —
# deliberately NOT the slug date, so a clobber is visible rather than a no-op.
_HAND_SET = datetime(2026, 6, 1, 15, 30, tzinfo=UTC)

# A fixed ingestion timestamp for every seeded row, so case 8 can assert it
# survives byte-for-byte rather than "is still some time".
_INGESTED_AT = datetime(2026, 6, 28, 9, 0, tzinfo=UTC)

# The zone the alembic subprocess runs under for the first upgrade (case 6).
# Chosen because its offset is never zero, in either half of the year.
_NON_UTC_SESSION_ZONE = "America/Los_Angeles"


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` is the revision's real parent — no database needed."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        source,
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision="
        f"{match.group('parent')!r} but this test pins "
        f"_PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_backfill_predicate_mirrors_the_runners_stem_parser() -> None:
    """The EXECUTED SQL carries the anchored, trailing-dash regex — no database.

    The eligibility predicate must be the runner's ``authored_at_from_stem``
    exactly (four digits, dash, two, dash, two, DASH, anchored at ``^``). A
    loosened regex would still pass every DB case that happens to be seeded
    below, so the literal is pinned here as well as exercised there.

    Read from the module's ``_BACKFILL_SQL`` constant rather than the file's
    text: the docstring legitimately NAMES ``to_timestamp`` while explaining why
    it is not used, and a whole-file scan would fail on the explanation.
    """
    module = load_revision_module(
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME,
        "coord_wu_authored_at_01_under_test",
    )
    sql: str = module._BACKFILL_SQL
    assert r"slug ~ '^\d{4}-\d{2}-\d{2}-'" in sql, (
        "the eligibility regex must stay anchored and require the trailing dash"
    )
    assert r"substring(slug from '^\d{4}-\d{2}-\d{2}')" in sql
    assert "to_timestamp(" not in sql, (
        "to_timestamp reads the text in the SESSION time zone; the value must be "
        "built from an explicit ...T00:00:00Z literal (see the module docstring)"
    )
    assert "'T00:00:00Z')::timestamptz" in sql
    assert "authored_at IS NULL" in sql, "the re-run / no-clobber guard"
    assert "datetime_field_overflow" in sql, (
        "a non-calendar prefix must be caught per row, never abort the backfill"
    )


def _seed(engine: Engine) -> None:
    """Seed one row per case at the PARENT revision, all with a fixed created_at.

    Seeding must happen before the revision runs: the backfill is a one-shot
    step, so rows inserted afterwards would never be dated by it.
    """
    with engine.begin() as conn:
        for slug in (
            _DATED_A,
            _DATED_B,
            _ANCHORED_MISS,
            _NO_TRAILING_DASH,
            _UNDATED,
            _NON_CALENDAR,
        ):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.work_units
                        (slug, tenant_id, status, title, created_at, updated_at)
                    VALUES (:slug, :tenant, 'draft', :slug, :ts, :ts)
                    """
                ),
                {"slug": slug, "tenant": _TENANT, "ts": _INGESTED_AT},
            )


def _authored(engine: Engine) -> dict[str, datetime | None]:
    """``{slug: authored_at}`` for every row, as tz-aware datetimes.

    Read back with the connection's zone forced to UTC so the comparison is
    against the INSTANT, not against however the server chose to render it.
    """
    with engine.connect() as conn:
        conn.execute(text("SET TIME ZONE 'UTC'"))
        rows = conn.execute(
            text("SELECT slug, authored_at FROM coord.work_units ORDER BY slug")
        ).all()
    return {r[0]: r[1] for r in rows}


def _created(engine: Engine) -> dict[str, datetime]:
    """``{slug: created_at}`` for every row."""
    with engine.connect() as conn:
        conn.execute(text("SET TIME ZONE 'UTC'"))
        rows = conn.execute(
            text("SELECT slug, created_at FROM coord.work_units ORDER BY slug")
        ).all()
    return {r[0]: r[1] for r in rows}


def _xmin(engine: Engine, slug: str) -> str:
    """The row's ``xmin`` — the txid that produced its current MVCC version.

    An UPDATE that matches a row writes a new tuple and therefore a new
    ``xmin``, whether or not the value it writes differs. That is what makes it
    readable as "was this row touched?", which no value assertion can answer
    for a write of NULL over NULL.
    """
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
        "Postgres not reachable at the conftest URL, so the authored_at BACKFILL "
        "was NOT verified — only that the revision file parses and carries the "
        "right regex. This skip is not a pass: the cases below are the guard "
        "against a session-zone-shifted instant, a clobbered operator value and "
        "a one-slug typo aborting the pipeline-applied migration. CI provisions "
        "a postgres service; locally, bring one up or point QONTINUI_TEST_PG at "
        "a reachable instance (e.g. QONTINUI_TEST_PG=localhost:15432)."
    ),
)
def test_coord_wu_authored_at_01_backfills_from_slug_and_downgrades(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Seed the parent revision, apply add+backfill, re-run, downgrade, re-upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_wu_authored_at_01_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Walk the chain to the PARENT revision, then seed.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        # Precondition, not decoration: if the column already existed at the
        # parent, every assertion below would pass vacuously against a column
        # this revision never created.
        assert column_info(engine, "work_units", "authored_at") is None, (
            "authored_at must not exist before coord_wu_authored_at_01 runs"
        )

        _seed(engine)
        created_before = _created(engine)
        undated_xmin = _xmin(engine, _UNDATED)

        # ----------------------------------------------------------------
        # 2. Apply the revision — under a NON-UTC session zone (case 6).
        #    libpq honours PGTZ; run_alembic copies os.environ into the child.
        # ----------------------------------------------------------------
        monkeypatch.setenv("PGTZ", _NON_UTC_SESSION_ZONE)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        monkeypatch.delenv("PGTZ")

        info = column_info(engine, "work_units", "authored_at")
        assert info is not None, "upgrade must add authored_at"
        data_type, is_nullable, default = info
        assert data_type == "timestamp with time zone"
        assert is_nullable == "YES", "NULL is the 'not recorded' value"
        assert default is None, (
            "authored_at must have NO default — defaulting to created_at (or "
            "now()) would re-manufacture the ingestion-date-as-authoring-date lie"
        )

        after = _authored(engine)

        # Case 1 — dated rows carry midnight UTC on the slug's date.
        dated_a = after[_DATED_A]
        assert dated_a is not None
        assert dated_a == _EXPECTED_A
        assert after[_DATED_B] == _EXPECTED_B

        # Case 6 — and it is midnight UTC even though the migrator's session
        # zone was Los Angeles. A to_timestamp-based expression would have
        # stored 07:00Z here; equality above already proves it did not, but
        # say so on its own line so a regression names the right cause.
        assert dated_a.utcoffset() is not None, "authored_at must come back tz-aware"
        assert dated_a.astimezone(UTC).hour == 0, (
            "the stored instant must be 00:00 UTC regardless of the session "
            "time zone the migration ran under"
        )

        # Case 2 — anchored: a date in the middle of the slug is not authoring.
        assert after[_ANCHORED_MISS] is None
        # Case 3 — the trailing dash is required (Rust: len() < 11 → None).
        assert after[_NO_TRAILING_DASH] is None
        # Case 4 — undated stays NULL...
        assert after[_UNDATED] is None
        # ...and was never visited: the loop selects eligible rows only.
        assert _xmin(engine, _UNDATED) == undated_xmin, (
            "an undated row must not be rewritten — the backfill must select "
            "only rows matching the anchored predicate"
        )
        # Case 5 — a non-calendar prefix is left NULL and did NOT abort the run
        # (every dated row above is proof the loop kept going past it).
        assert after[_NON_CALENDAR] is None, (
            "2026-02-30 is not a date; the row must stay NULL (not recorded)"
        )

        # Case 8 — created_at is untouched by the backfill.
        assert _created(engine) == created_before

        # ----------------------------------------------------------------
        # 3. Re-run over its OWN output, with an operator-set value in place.
        #    `stamp` rewinds only the version marker, so the backfill
        #    re-executes against rows that already carry a value. This is the
        #    prod-repair scenario AND the Phase-D overlap.
        # ----------------------------------------------------------------
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.work_units SET authored_at = :at WHERE slug = :slug"
                ),
                {"at": _HAND_SET, "slug": _DATED_B},
            )

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)

        rerun = _authored(engine)

        # Case 7 — the IS NULL guard: the hand-set value survives the re-run.
        assert rerun[_DATED_B] == _HAND_SET, (
            "the backfill must not clobber an authored_at another writer set"
        )
        # Everything else is unchanged by the second pass.
        assert rerun[_DATED_A] == _EXPECTED_A
        assert rerun[_ANCHORED_MISS] is None
        assert rerun[_NO_TRAILING_DASH] is None
        assert rerun[_UNDATED] is None
        assert rerun[_NON_CALENDAR] is None
        assert _xmin(engine, _UNDATED) == undated_xmin
        assert _created(engine) == created_before

        # ----------------------------------------------------------------
        # 4. Downgrade — drops the NEW column only.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)

        assert column_info(engine, "work_units", "authored_at") is None, (
            "downgrade drops authored_at"
        )
        assert column_info(engine, "work_units", "created_at") is not None, (
            "downgrade must NOT touch created_at"
        )
        assert _created(engine) == created_before, (
            "downgrade must leave every created_at value intact"
        )
        with engine.connect() as conn:
            count = conn.execute(
                text("SELECT count(*) FROM coord.work_units")
            ).scalar_one()
        assert count == 6, "downgrade must not delete rows"

        # ----------------------------------------------------------------
        # 5. Re-upgrade — the slug-derived value is re-derivable. The hand-set
        #    date is NOT restored: the downgrade dropped the column it lived
        #    in, and what comes back is the slug date — the honest consequence
        #    of a rollback, stated rather than asserted around.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        redone = _authored(engine)
        assert redone[_DATED_A] == _EXPECTED_A
        assert redone[_DATED_B] == _EXPECTED_B
        assert redone[_ANCHORED_MISS] is None
        assert redone[_NO_TRAILING_DASH] is None
        assert redone[_UNDATED] is None
        assert redone[_NON_CALENDAR] is None
        assert _created(engine) == created_before
