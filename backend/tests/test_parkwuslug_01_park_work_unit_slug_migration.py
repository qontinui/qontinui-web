"""Data-semantics test for the ``parkwuslug_01`` revision (expand + backfill).

Stage 3a of plan
``D:/qontinui-root/plans/2026-07-28-coord-post-plan-slug-surfaces-rename.md``
adds ``coord.session_messages.park_work_unit_slug`` and backfills it from the
outgoing ``park_plan_slug`` in the SAME revision.

The ADD is trivial and a schema-shape assertion would prove nothing about the
part that matters. The revision's real contract is *data*: which rows receive a
copied slug, which are deliberately left NULL, what happens when it re-runs over
a value some other writer already put there, and what the downgrade is allowed
to touch. So this test seeds the parent revision, walks one step up, and asserts
the resulting rows — the shape ``test_coord_plan_pr_citations_3a_backfill_migration``
uses for the sibling rename's equivalent stage.

Why this coverage matters
=========================

``park_plan_slug`` binds a parked ``claim:``/``resource:`` message to the
SENDER's work-unit context, and coord's parked-delivery predicate is::

    (park_plan_slug IS NULL OR park_plan_slug = $5)

**NULL there does not mean "match nothing" — it means "deliver to ANY
acquirer."** That inverts the usual intuition about an un-backfilled column and
is the whole reason the backfill cannot be deferred to a later revision: the
moment coord's read moves to ``park_work_unit_slug`` (Stage 3c), every
historical row still holding NULL in the new column stops being context-bound
and starts delivering to **every** context. There is no error and no failed
delivery — just parked directives silently fanning out to acquirers they were
never addressed to, which is exactly the stale mis-targeted-directive leak the
column was introduced to prevent. A regression that drops or weakens the
``UPDATE`` is therefore invisible at runtime and expensive in effect, which is
what makes it worth pinning.

**Stage 3d drops ``park_plan_slug`` entirely, and that is the point of no
return.** After it lands the source column is gone, so this backfill can never
again be re-derived or checked against the data it came from. This test is the
last point at which the copy's semantics can be verified against a real source
column, and it is also the guard for every fresh substrate — CI, a developer
DB, a new tenant deployment — that still runs this revision over real rows.

Cases covered (each is a distinct branch of the migration's WHERE clause)
========================================================================

1. **Bound** — a row carrying a ``park_plan_slug`` gets it copied verbatim into
   ``park_work_unit_slug``. Two such rows, so a single-row UPDATE would fail.
2. **Unbound** — a row whose ``park_plan_slug`` is NULL stays NULL in the new
   column. The migration must not invent a binding for a message that was
   deliberately sent unbound; fabricating one would make a broadcast-parked row
   undeliverable instead of over-deliverable.
3. **No-clobber on re-run** — the ``WHERE park_work_unit_slug IS NULL`` guard.
   Once coord dual-writes (Stage 3b), a row can already carry a NEW-vocabulary
   slug that deliberately disagrees with the legacy one; re-running the backfill
   must not overwrite it with the stale value.
   The row bound ONLY through the new column (NULL source, populated target)
   is the same case, not a separate one: it is excluded by this same first arm.
4. **Both columns NULL** — the second arm (``park_plan_slug IS NOT NULL``).

   Be precise about what this arm does, because it is easy to over-claim: it is
   **REDUNDANT for correctness**. Every row it excludes is either already
   excluded by the first arm, or is a both-NULL row where the UPDATE would
   write NULL over NULL — and this table carries no trigger and no
   ``updated_at``, so that write changes no value anybody can read. Deleting
   ``AND park_plan_slug IS NOT NULL`` produces byte-identical column contents.

   What the arm actually buys is **avoided row-version churn**: without it,
   every unbound parked row takes a new MVCC tuple for no reason. So that is
   what is pinned here, via ``xmin`` — not a value assertion, which could not
   tell the two predicates apart. The check discriminates: with the arm the
   both-NULL row's ``xmin`` is unchanged across both upgrades; with the arm
   deleted it changes. (``ALTER TABLE ... ADD COLUMN <nullable, no default>`` is
   metadata-only on PG 11+, so the ADD itself does not disturb the baseline —
   verified, not assumed.)

Then three walks are asserted:

* **re-run** (``stamp`` back to the parent, upgrade again) — the UPDATE
  re-executes over its OWN prior output. This is the prod-repair scenario, and
  the case where case 3 actually bites.
* **downgrade** — drops ONLY ``park_work_unit_slug``. ``park_plan_slug`` is
  still the live column at this stage, so a downgrade that touched it (or its
  values) would take the running coord's parked delivery down with it.
* **re-upgrade** — the copy is re-derivable, which is only true because the
  downgrade left the source column populated.

Substrate comes from ``_alembic_harness`` (shared with the other migration
tests): an ephemeral DB inside the test Postgres, skipped when none is
reachable. Locally that means pointing ``QONTINUI_TEST_PG`` at a reachable
instance (``conftest.py`` builds ``DATABASE_URL`` from it); CI provisions one at
the default ``localhost:5432``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

# The revision under test and its parent. Both are pinned explicitly rather
# than using "head" so a later migration landing on top cannot silently change
# what this test walks.
_REVISION_ID = "parkwuslug_01"
_PARENT_REVISION_ID = "memhold_adjudicate_02"

# Addresses the seeded rows are keyed by. Parked rows are exactly the
# claim:/resource: ones — a session: address is resolved at send time and never
# parks, so it would carry no slug in either column.
_BOUND_A = "claim:file:backend/app/one.py"
_BOUND_B = "resource:pr:qontinui/qontinui-web#4242"
_UNBOUND = "claim:file:backend/app/broadcast.py"
_DUAL = "claim:file:backend/app/renamed.py"
_NEW_ONLY = "resource:plan:new-vocabulary-only"

# Legacy slugs as they sit in park_plan_slug before the revision runs.
_SLUG_A = "2026-07-28-coord-post-plan-slug-surfaces-rename"
_SLUG_B = "2026-07-06-coord-plan-slug-to-work-unit-slug-rename"
_SLUG_DUAL_LEGACY = "legacy-vocabulary-slug"

# What a dual-writing coord (Stage 3b) puts in the NEW column — deliberately
# different from the legacy value so a clobber is visible rather than a no-op.
_SLUG_DUAL_NEW = "new-vocabulary-slug"
_SLUG_NEW_ONLY = "born-after-the-rename"


def _seed(engine: Engine) -> None:
    """Seed five parked rows across the four cases, at the PARENT revision.

    Seeding must happen before the revision runs: the backfill is a one-shot
    DML step, so rows inserted afterwards would never be copied.
    """
    tenant_id = uuid.uuid4()
    expires_at = datetime.now(UTC) + timedelta(hours=24)

    rows: list[tuple[str, str | None]] = [
        # 1. Bound — two rows, so a single-row UPDATE would fail the assertion.
        (_BOUND_A, _SLUG_A),
        (_BOUND_B, _SLUG_B),
        # 2. Unbound — sent with no context binding; must STAY unbound.
        (_UNBOUND, None),
        # 3. Will be dual-written after the first upgrade (see the re-run walk).
        (_DUAL, _SLUG_DUAL_LEGACY),
        # 4. Bound only through the new column — no legacy value to copy.
        (_NEW_ONLY, None),
    ]

    with engine.begin() as conn:
        for to_address, park_plan_slug in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.session_messages
                        (tenant_id, to_address, body, expires_at,
                         park_plan_slug, park_expires_at)
                    VALUES (:tenant, :addr, :body, :expires, :slug, :park_expires)
                    """
                ),
                {
                    "tenant": tenant_id,
                    "addr": to_address,
                    "body": f"parked directive for {to_address}",
                    "expires": expires_at,
                    "slug": park_plan_slug,
                    "park_expires": expires_at,
                },
            )


def _column_exists(engine: Engine, column: str) -> bool:
    """True when ``coord.session_messages`` currently has ``column``."""
    sql = text(
        """
        SELECT EXISTS(
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'coord'
              AND table_name = 'session_messages'
              AND column_name = :column
        )
        """
    )
    with engine.connect() as conn:
        return bool(conn.execute(sql, {"column": column}).scalar())


def _slugs(engine: Engine) -> dict[str, tuple[str | None, str | None]]:
    """``{to_address: (park_plan_slug, park_work_unit_slug)}`` for every row."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT to_address, park_plan_slug, park_work_unit_slug
                  FROM coord.session_messages
                 ORDER BY to_address
                """
            )
        ).all()
    return {r[0]: (r[1], r[2]) for r in rows}


def _legacy_slugs(engine: Engine) -> dict[str, str | None]:
    """``{to_address: park_plan_slug}`` — readable while the new column is gone."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT to_address, park_plan_slug "
                "FROM coord.session_messages ORDER BY to_address"
            )
        ).all()
    return {r[0]: r[1] for r in rows}


def _xmin(engine: Engine, to_address: str) -> str:
    """The row's ``xmin`` — the txid that produced its current MVCC version.

    An UPDATE that matches the row writes a new tuple and therefore a new
    ``xmin``, whether or not the value it writes differs. That is exactly what
    makes this readable as "was this row touched?", which no value assertion
    can answer for a write of NULL over NULL.
    """
    with engine.connect() as conn:
        value = conn.execute(
            text(
                "SELECT xmin::text FROM coord.session_messages WHERE to_address = :addr"
            ),
            {"addr": to_address},
        ).scalar()
    assert value is not None, f"no row for {to_address}"
    return str(value)


def _indexes_mentioning(engine: Engine, column: str) -> list[str]:
    """Index names on ``session_messages`` whose definition references ``column``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname FROM pg_indexes
                 WHERE schemaname = 'coord'
                   AND tablename = 'session_messages'
                   AND indexdef LIKE '%%' || :column || '%%'
                 ORDER BY indexname
                """
            ),
            {"column": column},
        ).all()
    return [r[0] for r in rows]


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the park_work_unit_slug "
        "BACKFILL was NOT verified — only that the revision file parses. This "
        "skip is not a pass: an un-backfilled row reads as 'deliver to ANY "
        "acquirer' once coord switches its read, so the assertions below are "
        "the guard against a silent over-delivery leak. CI provisions a "
        "postgres service; locally, bring one up or point QONTINUI_TEST_PG at "
        "a reachable instance (e.g. QONTINUI_TEST_PG=localhost:15432)."
    ),
)
def test_parkwuslug_01_backfills_copies_and_downgrades() -> None:
    """Seed the parent revision, apply the expand+backfill, re-run, downgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "parkwuslug_01_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Walk the chain to the PARENT revision, then seed.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        # Precondition, not decoration: if the new column already existed at the
        # parent, every assertion below would pass vacuously against a column
        # this revision never created.
        assert not _column_exists(engine, "park_work_unit_slug"), (
            "park_work_unit_slug must not exist before parkwuslug_01 runs"
        )
        assert _column_exists(engine, "park_plan_slug"), (
            "park_plan_slug is the source column and must exist at the parent"
        )

        _seed(engine)

        # Case 4 baseline. _UNBOUND is the both-NULL row, so the second guard
        # arm is the only thing standing between it and a pointless rewrite.
        unbound_xmin = _xmin(engine, _UNBOUND)

        # ----------------------------------------------------------------
        # 2. Apply the revision — expand + backfill.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        after = _slugs(engine)

        # Case 1 — bound rows copied VERBATIM. Not normalised, not re-derived:
        # the value is the correlation key coord compares with `=`, so any
        # transformation would silently stop matching.
        assert after[_BOUND_A] == (_SLUG_A, _SLUG_A)
        assert after[_BOUND_B] == (_SLUG_B, _SLUG_B)

        # Case 2 — an unbound row stays unbound in BOTH columns. Inventing a
        # binding here would flip a deliberately-broadcast parked message from
        # over-deliverable to undeliverable, which is the opposite failure but a
        # failure all the same.
        assert after[_UNBOUND] == (None, None)

        # Case 4 — the second guard arm. A value assertion cannot see this: the
        # UPDATE would write NULL over NULL, so the columns read identically
        # either way. xmin can — an unmatched row keeps its tuple. The ADD
        # COLUMN above is metadata-only (nullable, no default), so an unchanged
        # xmin here means the UPDATE genuinely skipped the row.
        assert _xmin(engine, _UNBOUND) == unbound_xmin, (
            "the both-NULL row must not be rewritten: the second guard arm "
            "(park_plan_slug IS NOT NULL) exists to spare every unbound parked "
            "row a needless MVCC row version"
        )

        # The source column is read-only to this revision — Stage 3d drops it,
        # not 3a.
        assert after[_DUAL][0] == _SLUG_DUAL_LEGACY
        assert after[_NEW_ONLY][0] is None

        # No row is left with a populated source and a NULL target. This is the
        # property the whole stage exists for, asserted as a set rather than
        # row-by-row so a row added to the seed later cannot escape it.
        assert not [
            addr
            for addr, (legacy, renamed) in after.items()
            if legacy is not None and renamed is None
        ], "every row with a legacy slug must carry it in the new column"

        # The revision claims it adds no index (none exists on park_plan_slug
        # either — coord_sm_to_handle indexes to_handle, park_expires_at and
        # ((1)) WHERE action ? 'park_source_id' only). Pin that claim: an index
        # silently added here would need a matching drop in Stage 3d.
        assert _indexes_mentioning(engine, "park_work_unit_slug") == []
        assert _indexes_mentioning(engine, "park_plan_slug") == []

        # ----------------------------------------------------------------
        # 3. Re-run over its OWN output, with a dual-writing coord's values
        #    already in place. `stamp` rewinds only the version marker, so the
        #    UPDATE re-executes against rows that already carry a target value.
        #    This is the prod-repair scenario AND the Stage-3b overlap.
        # ----------------------------------------------------------------
        with engine.begin() as conn:
            dual_write = text(
                "UPDATE coord.session_messages SET park_work_unit_slug = :new "
                "WHERE to_address = :addr"
            )
            conn.execute(dual_write, {"new": _SLUG_DUAL_NEW, "addr": _DUAL})
            conn.execute(dual_write, {"new": _SLUG_NEW_ONLY, "addr": _NEW_ONLY})

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)

        rerun = _slugs(engine)

        # Case 3 — the WHERE ... IS NULL guard. Re-running must NOT overwrite a
        # value another writer put there with the stale legacy one.
        assert rerun[_DUAL] == (_SLUG_DUAL_LEGACY, _SLUG_DUAL_NEW), (
            "the backfill must not clobber a slug coord already dual-wrote"
        )

        # Still case 3, not a second arm: this row is bound only through the new
        # column, and `park_work_unit_slug IS NULL` is already false for it. The
        # first arm is what spares it; the second never gets to weigh in.
        assert rerun[_NEW_ONLY] == (None, _SLUG_NEW_ONLY), (
            "a NULL park_plan_slug must not erase an existing park_work_unit_slug"
        )

        # Everything else is unchanged by the second pass.
        assert rerun[_BOUND_A] == (_SLUG_A, _SLUG_A)
        assert rerun[_BOUND_B] == (_SLUG_B, _SLUG_B)
        assert rerun[_UNBOUND] == (None, None)

        # Case 4 again, and this is the pass that matters: the re-run is where a
        # missing second arm would rewrite every unbound row a SECOND time.
        assert _xmin(engine, _UNBOUND) == unbound_xmin, (
            "re-running must still leave the both-NULL row's tuple untouched"
        )

        # ----------------------------------------------------------------
        # 4. Downgrade — drops the NEW column only. park_plan_slug is still the
        #    column the running coord reads and writes, so a downgrade that
        #    touched it would take live parked delivery down with it.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)

        assert not _column_exists(engine, "park_work_unit_slug"), (
            "downgrade drops the new column"
        )
        assert _column_exists(engine, "park_plan_slug"), (
            "downgrade must NOT drop park_plan_slug — it is still the live column"
        )
        assert _legacy_slugs(engine) == {
            _BOUND_A: _SLUG_A,
            _BOUND_B: _SLUG_B,
            _UNBOUND: None,
            _DUAL: _SLUG_DUAL_LEGACY,
            _NEW_ONLY: None,
        }, "downgrade must leave every park_plan_slug value intact"

        # ----------------------------------------------------------------
        # 5. Re-upgrade — the copy is re-derivable, which is only true because
        #    the downgrade left the source column populated.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        redone = _slugs(engine)
        assert redone[_BOUND_A] == (_SLUG_A, _SLUG_A)
        assert redone[_BOUND_B] == (_SLUG_B, _SLUG_B)
        assert redone[_UNBOUND] == (None, None)
        # The dual-written value is NOT restored — the downgrade dropped the
        # column it lived in. What comes back is the legacy value, which is the
        # honest consequence of a rollback and worth stating rather than
        # asserting around.
        assert redone[_DUAL] == (_SLUG_DUAL_LEGACY, _SLUG_DUAL_LEGACY)
        assert redone[_NEW_ONLY] == (None, None)
