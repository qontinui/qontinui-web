"""Behaviour test for the ``coord_wu_list_order_01`` revision.

The revision adds, on ``coord.work_units``::

    ALTER TABLE ... ADD COLUMN IF NOT EXISTS derive_checked_at TIMESTAMPTZ NULL
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_coord_work_units_tenant_authored_slug
        ON coord.work_units (tenant_id, authored_at DESC NULLS LAST, slug)
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_coord_work_units_derive_checked_at
        ON coord.work_units (derive_checked_at ASC NULLS FIRST)

Phases 1 and 3 (alembic halves) of plan
``2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost``.

``migration-reversal.yml`` would only confirm the statements execute against an
empty database. What is worth pinning is the ORDER contract each index exists
for — key directions and NULL placement are the whole point, and a
``DESC`` key that silently defaulted to ``NULLS FIRST`` would still "exist".

What is asserted
================

1. The pinned parent is the revision's real ``down_revision`` (no DB needed).
2. Neither the column nor either index exists at the parent revision.
3. After upgrade the column is ``timestamptz``, nullable, no default, and
   carries a comment naming the derive worker.
4. Both indexes are ``indisvalid`` after a clean upgrade, and their definitions
   carry the exact key directions / NULL placement.
5. **The list page rides the authored index with no Sort node** —
   ``WHERE tenant_id = X ORDER BY authored_at DESC NULLS LAST, slug ASC LIMIT n``.
6. **Sensitivity:** the same order with ``NULLS FIRST`` cannot be served
   without a sort — otherwise assertion 5 would pass against an index whose
   NULL placement is wrong.
7. **The derive rotation lane, in the statement coord actually runs** — cited
   units only, the recency lane's ids excluded, ordered
   ``derive_checked_at ASC NULLS FIRST, id ASC``. Asserted: the scan the
   planner reaches for is the derive index, never-evaluated units come out
   first, the rest ascend, no uncited unit and no excluded id appears.
8. **The killed-``CONCURRENTLY`` hazard, exercised rather than described:** one
   index is marked ``indisvalid = false`` in the catalog, alembic is re-stamped
   at the parent and ``upgrade`` re-run — and the index is STILL invalid,
   because ``CREATE INDEX ... IF NOT EXISTS`` sees the name and skips. Then the
   operator's repair (``DROP INDEX`` + re-run) is shown to rebuild it valid.
   This is a test of its OWN because it needs a privilege the others do not —
   see "What this file requires" below.
9. Downgrade removes all three objects and leaves ``authored_at`` and every row.

What is deliberately NOT asserted
=================================

* **No plan-SHAPE claim for the rotation lane.** Its second sort key (``w.id``)
  is not in the single-column derive index, so no plan avoids a sort entirely —
  and whether PG puts an ``Incremental Sort`` or a full ``Sort`` above the same
  index scan is a COST decision on a ~120-row fixture, which can flip on a
  major-version bump or a stats change while the DDL is still exactly right.
  Assertion 7 therefore requires only that the scan ride the derive index; the
  ``Presorted Key: w.derive_checked_at`` check runs only when the planner did
  choose ``Incremental Sort``, where that key can only be the one this index
  supplies. Two earlier versions of this test are the reason it is written that
  way: one pinned a SYNTHETIC
  ``ORDER BY derive_checked_at ASC NULLS FIRST LIMIT 20`` and asserted
  "no Sort" — true of that statement, false of coord's; its replacement
  REQUIRED ``Presorted Key``, which is an Incremental Sort artifact rather than
  a property of the index.
* **Nothing about production plan CHOICE.** Every plan assertion here runs with
  ``enable_seqscan = off`` against ~120 rows: it shows an index is USABLE for an
  order, which is the DDL property this revision owns. Cardinality-driven plan
  selection on the real corpus is not in scope for a migration test.

What this file requires, and what it does when a requirement is missing
=======================================================================

* **The pinned-parent test requires nothing** beyond the revision file on disk;
  it always runs.
* **Every other test requires a reachable Postgres** at the URL ``conftest.py``
  resolves (``QONTINUI_TEST_PG=host:port`` points them elsewhere). Substrate is
  an ephemeral database inside it, created and dropped per test by
  ``_alembic_harness``. Unreachable => those tests SKIP, and the skip reason
  says the indexes were therefore NOT verified.
* **The killed-``CONCURRENTLY`` hazard test additionally requires that the
  connected role be a SUPERUSER**, because marking an index invalid is an
  ``UPDATE`` on ``pg_index``. Not a superuser => that ONE test skips with that
  reason, and assertions 2-7 and 9 still run. The gate is ``rolsuper`` for
  ``current_user``, re-checked by catching ``InsufficientPrivilege`` on the
  write itself, so a role that reads as a superuser and is still refused skips
  rather than errors. CI's ``POSTGRES_USER`` is a superuser and so is a local
  ``pgvector/pgvector:pg16``, so the hazard is really asserted there — this is
  a degradation path, not a permanent skip.
"""

from __future__ import annotations

import contextlib
import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from psycopg2 import errors as pg_errors
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_wu_list_order_01"
_PARENT_REVISION_ID = "plan_library_07_plan_difficulty"
_REVISION_FILENAME = "coord_wu_list_order_01_authored_index_and_derive_checked_at.py"

_IX_AUTHORED = "ix_coord_work_units_tenant_authored_slug"
_IX_DERIVE = "ix_coord_work_units_derive_checked_at"

_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000a0701")
_OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000a0702")
_EPOCH = datetime(2026, 5, 1, tzinfo=UTC)

# The Phase 1 list page: tenant filter, stable authored order, slug tiebreak.
_LIST_SQL = (
    "SELECT slug FROM coord.work_units "
    f"WHERE tenant_id = '{_TENANT}' "
    "ORDER BY authored_at DESC NULLS LAST, slug ASC LIMIT 50"
)

# Same keys, wrong NULL placement — the index cannot serve this without a sort.
_LIST_WRONG_NULLS_SQL = (
    "SELECT slug FROM coord.work_units "
    f"WHERE tenant_id = '{_TENANT}' "
    "ORDER BY authored_at DESC NULLS FIRST, slug ASC LIMIT 50"
)

# The Phase 3 rotation lane, in the shape coord runs it
# (`work_unit_derive_worker::select_candidates`): CITED units only, the recency
# lane's already-taken ids excluded, and a second sort key (`w.id`) this index
# does not carry. Two separate statements per tick, not a UNION — the recency
# lane is a query of its own and does not appear here.
_ROTATION_SQL = (
    "SELECT w.id, w.slug, w.derive_checked_at FROM coord.work_units w "
    "WHERE w.status NOT IN ('superseded', 'obsolete') "
    "AND NOT (w.id = ANY(:excluded ::uuid[])) "
    "AND EXISTS (SELECT 1 FROM coord.work_unit_pr_citations c "
    "WHERE c.work_unit_id = w.id) "
    "ORDER BY w.derive_checked_at ASC NULLS FIRST, w.id ASC "
    "LIMIT 100"
)

# How many ids coord's recency lane hands the rotation lane to exclude
# (`RECENT_CANDIDATES`). The fixture pads to that size for FIDELITY to the
# statement coord runs, not because the size steers the plan: `psycopg2`
# interpolates parameters CLIENT-side, so the planner here sees a 500-element
# literal array, whereas coord passes `$1` and is costed against a generic-plan
# estimate for an unknown array. The padding is harmless either way — it is not
# a control over the planned shape.
_RECENT_CANDIDATES = 500

_NO_POSTGRES_REASON = (
    "Postgres not reachable at the conftest URL, so the list-order and "
    "derive-rotation INDEXES were NOT verified — only the pinned parent. "
    "CI provisions a postgres service; locally, point QONTINUI_TEST_PG at a "
    "reachable instance."
)
_PG_REACHABLE = can_connect(admin_database_url())


def _superuser_skip_reason() -> str | None:
    """``None`` when the catalog-write step may run here; else why it may not.

    Marking an index ``indisvalid = false`` is an ``UPDATE`` on ``pg_index``,
    which only a SUPERUSER may do. Probed once at collection time, against the
    same credentials the ephemeral database is created with, so a REACHABLE but
    unprivileged Postgres skips that one test rather than erroring partway
    through it — that is the contract the module docstring states.
    """
    if not _PG_REACHABLE:
        return _NO_POSTGRES_REASON
    url = admin_database_url()
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            is_superuser = bool(
                conn.execute(
                    text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
                ).scalar()
            )
    except Exception as exc:  # pragma: no cover - a probe that cannot answer
        return f"could not read rolsuper for current_user: {exc!r}"
    finally:
        engine.dispose()
    if not is_superuser:
        return (
            "the connected role is NOT a superuser, so the killed-CONCURRENTLY "
            "hazard (which marks an index invalid via UPDATE pg_index) was not "
            "verified here. CI's POSTGRES_USER is a superuser and so is "
            "pgvector/pgvector:pg16's; connect as one to run this assertion."
        )
    return None


_SUPERUSER_SKIP_REASON = _superuser_skip_reason()


@contextlib.contextmanager
def _database_at_revision(revision: str) -> Iterator[tuple[Engine, str, Path]]:
    """An ephemeral database upgraded to ``revision``; yields (engine, url, root).

    Shared by the two database-backed tests so neither owns the substrate: the
    hazard test needs the same chain applied, and duplicating the setup is how
    the copies this suite's harness docstring complains about came about.
    """
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_wu_list_order_01_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", revision)
        yield engine, url, root


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
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins _PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. "
        "Re-point both together."
    )


def _indexdef(engine: Engine, name: str) -> tuple[str, bool]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid), i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": name},
        ).one()
    return str(row[0]), bool(row[1])


def _plan_for(engine: Engine, sql: str, params: dict[str, object] | None = None) -> str:
    """EXPLAIN with sequential scans penalised (the fixture is tiny).

    ``enable_seqscan = off`` makes this a test of whether an index CAN serve an
    order, not of what the planner would pick on the real corpus — see the
    module docstring's "deliberately NOT asserted".
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}"), params or {}).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """Dated, undated and other-tenant units; half derive-checked, 2/3 cited.

    Returns ``{slug: id}``. The rotation lane admits only CITED units, so the
    fixture has to contain uncited ones for that filter to be observable at all.
    """
    ids: dict[str, uuid.UUID] = {}
    with engine.begin() as conn:
        for tenant, prefix in ((_TENANT, "t"), (_OTHER_TENANT, "o")):
            for i in range(60):
                authored = None if i % 7 == 0 else _EPOCH + timedelta(days=i % 20)
                checked = None if i % 2 == 0 else _EPOCH + timedelta(hours=i)
                slug = f"{prefix}-unit-{i:03d}"
                ids[slug] = conn.execute(
                    text(
                        """
                        INSERT INTO coord.work_units
                            (slug, tenant_id, status, title,
                             authored_at, derive_checked_at)
                        VALUES (:slug, :tenant, 'draft', :slug, :authored, :checked)
                        RETURNING id
                        """
                    ),
                    {
                        "slug": slug,
                        "tenant": str(tenant),
                        "authored": authored,
                        "checked": checked,
                    },
                ).scalar_one()
                if _is_cited(slug):
                    conn.execute(
                        text(
                            """
                            INSERT INTO coord.work_unit_pr_citations
                                (tenant_id, work_unit_id, repo, pr_number, source)
                            VALUES (:tenant, :unit, 'qontinui/qontinui-web', :pr,
                                    'test_coord_wu_list_order_01')
                            """
                        ),
                        {"tenant": str(tenant), "unit": ids[slug], "pr": 1000 + i},
                    )
        conn.execute(text("ANALYZE coord.work_units"))
        conn.execute(text("ANALYZE coord.work_unit_pr_citations"))
    return ids


def _is_cited(slug: str) -> bool:
    """Two of every three seeded units carry a PR citation."""
    return int(slug.rsplit("-", 1)[1]) % 3 != 0


@pytest.mark.skipif(not _PG_REACHABLE, reason=_NO_POSTGRES_REASON)
def test_coord_wu_list_order_01_indexes_serve_both_orders_and_downgrade() -> None:
    # 2. Parent — nothing this revision adds exists yet.
    with _database_at_revision(_PARENT_REVISION_ID) as (engine, url, root):
        assert column_info(engine, "work_units", "derive_checked_at") is None
        assert not index_exists(engine, _IX_AUTHORED)
        assert not index_exists(engine, _IX_DERIVE)

        # 3. Apply — the column.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        info = column_info(engine, "work_units", "derive_checked_at")
        assert info is not None, "upgrade must add derive_checked_at"
        data_type, is_nullable, default = info
        assert data_type == "timestamp with time zone"
        assert is_nullable == "YES", "NULL = never evaluated by the derive worker"
        assert default is None, (
            "no default: now() would claim a check that never happened and push "
            "every existing unit to the back of the rotation"
        )
        with engine.connect() as conn:
            comment = conn.execute(
                text(
                    "SELECT col_description('coord.work_units'::regclass, attnum) "
                    "FROM pg_attribute WHERE attrelid = 'coord.work_units'::regclass "
                    "AND attname = 'derive_checked_at'"
                )
            ).scalar()
        assert comment and "derive worker" in comment, comment

        # 4. Both indexes valid, with the exact directions and NULL placement.
        authored_def, authored_valid = _indexdef(engine, _IX_AUTHORED)
        assert authored_valid, "INVALID index — a killed CONCURRENTLY build"
        assert "(tenant_id, authored_at DESC NULLS LAST, slug)" in authored_def, (
            authored_def
        )
        derive_def, derive_valid = _indexdef(engine, _IX_DERIVE)
        assert derive_valid, "INVALID index — a killed CONCURRENTLY build"
        assert "(derive_checked_at NULLS FIRST)" in derive_def, derive_def

        seeded = _seed(engine)

        # 5. The list page rides the authored index without sorting.
        plan = _plan_for(engine, _LIST_SQL)
        assert _IX_AUTHORED in plan, f"list page must ride the index:\n{plan}"
        assert "Sort" not in plan, f"the index must supply the order:\n{plan}"

        # 6. Sensitivity — wrong NULL placement needs a sort.
        wrong = _plan_for(engine, _LIST_WRONG_NULLS_SQL)
        assert "Sort" in wrong, (
            "NULLS FIRST must NOT be servable by this index without a sort — "
            f"otherwise assertion 5 proves nothing about NULL placement:\n{wrong}"
        )

        # The order itself: dated newest-first, slug tiebreak, undated last.
        with engine.connect() as conn:
            listed = conn.execute(
                text(
                    "SELECT slug, authored_at FROM coord.work_units "
                    f"WHERE tenant_id = '{_TENANT}' "
                    "ORDER BY authored_at DESC NULLS LAST, slug ASC"
                )
            ).all()
        assert len(listed) == 60
        assert all(r[0].startswith("t-") for r in listed), "tenant filter leaked"
        undated = [r for r in listed if r[1] is None]
        assert undated and listed[-len(undated) :] == undated, "undated sort last"

        # 7. The rotation lane — coord's own statement, not a synthetic one.
        # Excluded ids: three the fixture can check, padded to the 500 the
        # recency lane really passes, for fidelity to that statement rather than
        # to steer the plan (see `_RECENT_CANDIDATES`).
        excluded_slugs = ["t-unit-001", "t-unit-002", "o-unit-004"]
        assert all(_is_cited(s) for s in excluded_slugs), (
            "an uncited exclusion proves nothing — the EXISTS filters it anyway"
        )
        excluded = [str(seeded[s]) for s in excluded_slugs]
        excluded += [
            str(uuid.uuid4()) for _ in range(_RECENT_CANDIDATES - len(excluded))
        ]
        params: dict[str, object] = {"excluded": excluded}

        # The DDL property this index owns, and the ONLY plan requirement here:
        # the rotation statement can ride this index for its scan. A sort above
        # it IS expected and correct — `w.id` is not in this index — and whether
        # PG picks an Incremental Sort or a full Sort over the same scan is a
        # cost decision on ~120 rows, so it is not required either way. See
        # "deliberately NOT asserted" above.
        rotation_plan = _plan_for(engine, _ROTATION_SQL, params)
        assert _IX_DERIVE in rotation_plan, (
            f"the rotation statement must be able to ride the index:\n{rotation_plan}"
        )
        if "Incremental Sort" in rotation_plan:
            # Checked only on the arm where it exists: when the planner DID
            # presort, the only key this index can have supplied is the leading
            # one — a wrong key here would mean the DDL changed under us.
            assert "Presorted Key: w.derive_checked_at" in rotation_plan, (
                "an Incremental Sort over this index can only be presorted on "
                f"derive_checked_at:\n{rotation_plan}"
            )

        with engine.connect() as conn:
            rotation = conn.execute(text(_ROTATION_SQL), params).all()

        returned = [r[1] for r in rotation]
        checked_ats = [r[2] for r in rotation]
        assert returned, "the rotation fixture must return rows to assert on"
        assert not any(s in excluded_slugs for s in returned), (
            "a unit the recency lane already took must not be selected twice"
        )
        assert all(_is_cited(s) for s in returned), (
            "the rotation lane admits only CITED units — an uncited shipped unit "
            "would demote under the lane's Full derive authority"
        )
        never = [c for c in checked_ats if c is None]
        already = [c for c in checked_ats if c is not None]
        assert never and already, (
            "the fixture must contain both never-evaluated and evaluated cited "
            "units, or the NULLS FIRST ordering below asserts nothing"
        )
        assert checked_ats[: len(never)] == never, (
            f"never-evaluated units must come first in the rotation: {checked_ats}"
        )
        assert already == sorted(already), (
            f"the evaluated remainder must ascend (oldest first): {already}"
        )

        # 9. Downgrade — exactly this revision's three objects.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IX_AUTHORED)
        assert not index_exists(engine, _IX_DERIVE)
        assert column_info(engine, "work_units", "derive_checked_at") is None
        assert column_info(engine, "work_units", "authored_at") is not None, (
            "downgrade must NOT touch authored_at"
        )
        # Scoped to THIS fixture's two tenants, not `count(*)` over the table:
        # an unscoped exact count asserts over global state, so a peer test
        # inserting one row fails this one for a reason that has nothing to do
        # with the downgrade. The ratchet in `global-state-assertions.yml`
        # forbids it, and is right to.
        with engine.connect() as conn:
            count = conn.execute(
                text(
                    "SELECT count(*) FROM coord.work_units "
                    "WHERE tenant_id IN (:tenant, :other)"
                ),
                {"tenant": str(_TENANT), "other": str(_OTHER_TENANT)},
            ).scalar_one()
        assert count == 120, "downgrade must not delete this fixture's rows"

        # Re-upgrade is clean (idempotent DDL, no leftovers).
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _indexdef(engine, _IX_AUTHORED)[1]
        assert _indexdef(engine, _IX_DERIVE)[1]


def _mark_index_invalid(engine: Engine, index_name: str) -> None:
    """``indisvalid = false`` on one index — the stand-in for a killed build.

    ``pytest.skip`` rather than a failure when the write is REFUSED: this needs
    a superuser, ``_SUPERUSER_SKIP_REASON`` has already gated the test on
    ``rolsuper``, and this catch covers the remaining case where the role reads
    as privileged and the write is still denied. A privilege the environment
    does not grant is a skip; anything else propagates.
    """
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false "
                    f"WHERE indexrelid = 'coord.{index_name}'::regclass"
                )
            )
    except DBAPIError as exc:  # pragma: no cover - superuser-gated already
        if isinstance(exc.orig, pg_errors.InsufficientPrivilege):
            pytest.skip(
                "UPDATE pg_index was refused despite rolsuper, so the "
                f"killed-CONCURRENTLY hazard was NOT verified here: {exc.orig}"
            )
        raise


@pytest.mark.skipif(
    _SUPERUSER_SKIP_REASON is not None,
    reason=str(_SUPERUSER_SKIP_REASON),
)
def test_coord_wu_list_order_01_rerun_does_not_heal_an_invalid_index() -> None:
    """8. The killed-``CONCURRENTLY`` hazard, exercised rather than described.

    Separate from the order/downgrade test because it needs a privilege that
    test does not: an ``UPDATE`` on ``pg_index``. Keeping it here would make a
    reachable non-superuser Postgres ERROR halfway through the order assertions
    instead of skipping one test and running the rest.
    """
    with _database_at_revision(_REVISION_ID) as (engine, url, root):
        # An INVALID index is what a cancelled `CREATE INDEX CONCURRENTLY`
        # leaves behind; this poke is the deterministic stand-in for that kill.
        _mark_index_invalid(engine, _IX_DERIVE)
        assert not _indexdef(engine, _IX_DERIVE)[1], "the poke must have landed"

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert not _indexdef(engine, _IX_DERIVE)[1], (
            "re-running the revision must NOT be assumed to heal an INVALID "
            "index: CREATE INDEX ... IF NOT EXISTS sees the name and skips, so "
            "the table is left unindexed forever and no statement here notices. "
            "If this assertion now fails the behaviour changed — rewrite the "
            "revision's hazard note with it."
        )
        assert column_info(engine, "work_units", "derive_checked_at") is not None
        assert _indexdef(engine, _IX_AUTHORED)[1], "the other index stays valid"

        # The operator's recovery, also exercised: drop, then re-run.
        with engine.begin() as conn:
            conn.execute(text(f"DROP INDEX coord.{_IX_DERIVE}"))
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _indexdef(engine, _IX_DERIVE)[1], (
            "DROP INDEX then re-run is the documented recovery — it must rebuild "
            "the index valid"
        )
