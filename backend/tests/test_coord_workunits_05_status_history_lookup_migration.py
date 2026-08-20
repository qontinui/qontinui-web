"""Behaviour test for the ``coord_workunits_05_status_history_lookup`` index.

The revision creates one index::

    CREATE INDEX idx_wush_unit_status_time
    ON coord.work_unit_status_history(work_unit_id, to_status, transitioned_at)

``migration-reversal.yml`` would only confirm the statement executes against an
empty database. The contract worth pinning is stronger and has two halves:

1. **The planner chooses this index for the exact statement coord now issues**
   — the two ``LEFT JOIN LATERAL (… ORDER BY transitioned_at ASC LIMIT 1)``
   subqueries that derive ``first_in_progress_at`` / ``first_shipped_at``. The
   pre-existing ``idx_work_unit_status_history_unit`` covers ``(work_unit_id)``
   only, so without this revision each LATERAL fetches every history row for
   the unit and sorts it. Units are not small: sampled against production
   2026-08-20, shipped work-units carry **35-70** transitions each.
2. **The derived values are the FIRST transition, not the latest** — over a
   fixture that deliberately FLAPS. This is the regression the whole feature
   rests on, and it is a real production behaviour rather than a contrived
   case: ``harness-markdown-adapter`` re-stamps a unit to ``in_progress`` while
   ``coord::derive_worker`` re-derives ``shipped``, so a unit oscillates for as
   long as it exists. A ``last`` reading would make the shipped column jitter
   every few hours.

And one honesty check the migration's own docstring claims:

3. **Correctness does not depend on the index.** After ``downgrade`` the same
   statement must return the same rows. That is what makes this revision
   performance-only, and therefore what makes it safe for coord to deploy
   without waiting for the migration (unlike a new *column*, which would impose
   a hard ordering gate).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
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
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_workunits_05_status_history_lookup"
_PARENT_REVISION_ID = "coord_sessions_tool_activity"

_INDEX_NAME = "idx_wush_unit_status_time"
#: The index this revision supersedes for these reads. It is NOT dropped — other
#: reads still use it — so a plan naming it is the "before" state, not a failure.
_OLD_INDEX_NAME = "idx_work_unit_status_history_unit"

#: A MIRROR of the statement `work_unit_registry::list_work_units` issues in
#: qontinui-coord (`feat(work-units): derive first-in-progress/first-shipped`).
#: Quoted in full rather than paraphrased for the reason the sibling
#: ``pagedidx`` test gives: a simplified statement could ride the index while
#: the real one did not.
#:
#: **This mirror is NOT machine-checked, and nothing in this repo can check
#: it.** coord's SQL lives in another repository, so if it is reformulated —
#: `to_status = ANY($n)`, a `DISTINCT ON`, a different bind order — the
#: assertions below stay green while measuring a statement no process
#: executes. The drift detector that WOULD work has to live coord-side, next
#: to the SQL; treat a coord change to this query as obliging an update here.
#: The nesting is load-bearing and must be preserved when mirroring: the
#: filter/sort/limit run in an inner subquery so the LATERALs join the PAGE, not
#: every matching row. Flat, coord measured 1105x2 lateral loops / 69,536
#: buffers / 40.7 ms against this exact fixture shape versus 100x2 / 416 /
#: 0.48 ms nested. A mirror that "tidied" the subquery away would still ride the
#: index and still pass every assertion below while measuring the slow shape.
_LIST_SQL = """
    SELECT w.id, w.slug, w.tenant_id, w.status, w.title, w.metadata,
           w.created_at, w.updated_at,
           ip.transitioned_at AS first_in_progress_at,
           sh.transitioned_at AS first_shipped_at
      FROM (
           SELECT id, slug, tenant_id, status, title, metadata,
                  created_at, updated_at
             FROM coord.work_units
            WHERE ($1::text IS NULL OR status = $1)
              AND ($2::text IS NULL OR slug LIKE $2 || '%')
              AND ($6::text IS NULL OR slug NOT LIKE $6 || '%')
              AND tenant_id = $5
            ORDER BY updated_at DESC, id DESC
            LIMIT $3 OFFSET $4
      ) w
      LEFT JOIN LATERAL (
           SELECT h.transitioned_at
             FROM coord.work_unit_status_history h
            WHERE h.work_unit_id = w.id AND h.to_status = 'in_progress'
            ORDER BY h.transitioned_at ASC
            LIMIT 1
      ) ip ON TRUE
      LEFT JOIN LATERAL (
           SELECT h.transitioned_at
             FROM coord.work_unit_status_history h
            WHERE h.work_unit_id = w.id AND h.to_status = 'shipped'
            ORDER BY h.transitioned_at ASC
            LIMIT 1
      ) sh ON TRUE
     ORDER BY w.updated_at DESC, w.id DESC
"""

_TENANT = uuid.UUID("c231d9da-0ca8-4fe4-bd81-0e3d6c20339a")
_EPOCH = datetime(2026, 7, 1, tzinfo=UTC)

#: Enough rows that a sequential scan is not trivially the cheapest plan. Sized
#: from the production sample quoted in the module docstring (~40 transitions
#: per unit), not picked for convenience.
_UNITS = 150
_FLAPS = 20


def _index_columns(engine: Engine, index_name: str) -> list[str]:
    """The index's key columns, in order. Order is the whole point here."""
    sql = text(
        """
        SELECT a.attname
          FROM pg_index i
          JOIN pg_class c   ON c.oid = i.indexrelid
          JOIN pg_attribute a ON a.attrelid = i.indrelid
                             AND a.attnum = ANY(i.indkey)
         WHERE c.relname = :idx
         ORDER BY array_position(i.indkey, a.attnum)
        """
    )
    with engine.connect() as conn:
        return [r[0] for r in conn.execute(sql, {"idx": index_name})]


def _seed(engine: Engine) -> dict[str, tuple[datetime | None, datetime | None]]:
    """Seed units with FLAPPING history; return the expected first-transitions.

    Three shapes, because the honest answer differs for each:

    * ``flap-N``   — drafted, then oscillates in_progress/shipped ``_FLAPS``
      times. Expected: the FIRST of each, far earlier than the last.
    * ``never-N``  — draft only. Expected: ``(None, None)`` — absent, which is
      UNKNOWN, and must not be back-filled from ``created_at``.
    * ``started-N``— reached in_progress and stayed. Expected in_progress set,
      shipped ``None``.
    """
    expected: dict[str, tuple[datetime | None, datetime | None]] = {}
    with engine.begin() as conn:
        for n in range(_UNITS):
            if n % 3 == 0:
                slug, status = f"flap-{n}", "shipped"
            elif n % 3 == 1:
                slug, status = f"never-{n}", "draft"
            else:
                slug, status = f"started-{n}", "in_progress"

            unit_id = conn.execute(
                text(
                    """
                    INSERT INTO coord.work_units
                        (slug, tenant_id, status, title, created_at, updated_at)
                    VALUES (:slug, :tid, :st, :slug, :ts, :ts)
                    RETURNING id
                    """
                ),
                {"slug": slug, "tid": _TENANT, "st": status, "ts": _EPOCH},
            ).scalar_one()

            rows: list[tuple[str, datetime]] = [("draft", _EPOCH)]
            first_ip: datetime | None = None
            first_ship: datetime | None = None

            if slug.startswith("flap-"):
                for k in range(_FLAPS):
                    ip_at = _EPOCH + timedelta(hours=1 + 2 * k)
                    sh_at = _EPOCH + timedelta(hours=2 + 2 * k)
                    rows.append(("in_progress", ip_at))
                    rows.append(("shipped", sh_at))
                    if first_ip is None:
                        first_ip, first_ship = ip_at, sh_at
            elif slug.startswith("started-"):
                first_ip = _EPOCH + timedelta(hours=1)
                rows.append(("in_progress", first_ip))

            for to_status, at in rows:
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.work_unit_status_history
                            (work_unit_id, to_status, transitioned_at, by_actor)
                        VALUES (:uid, :st, :at, 'test')
                        """
                    ),
                    {"uid": unit_id, "st": to_status, "at": at},
                )
            expected[slug] = (first_ip, first_ship)

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("ANALYZE coord.work_units"))
        conn.execute(text("ANALYZE coord.work_unit_status_history"))
    return expected


def _generic_plan(engine: Engine) -> str:
    """EXPLAIN the real statement under a FORCED GENERIC plan.

    ``force_generic_plan`` is deliberate. coord issues this through
    tokio-postgres as a prepared statement, so the plan that actually runs in
    production is the generic one — and a custom plan built with the literal
    parameter values can pick an index the generic plan will not. Explaining
    with values substituted would measure a plan coord never executes.
    """
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("SET plan_cache_mode = force_generic_plan"))
        conn.execute(
            text(
                f"PREPARE wu_list(text, text, bigint, bigint, uuid, text) AS {_LIST_SQL}"
            )
        )
        # Five warmup executions. NOT because force_generic_plan needs them —
        # `choose_custom_plan()` returns false on FORCE_GENERIC_PLAN before it
        # ever reaches the "fewer than 5 custom plans so far" branch, so the
        # very first EXPLAIN is already generic. They are retained only so this
        # helper still measures a generic plan under the DEFAULT `auto` mode,
        # where the five-plan rule does apply — i.e. if the GUC above is ever
        # dropped, the assertions degrade to "still generic", not to silently
        # measuring a custom plan.
        for _ in range(5):
            conn.execute(
                text("EXECUTE wu_list(NULL, NULL, 500, 0, :tid, NULL)"),
                {"tid": _TENANT},
            )
        rows = conn.execute(
            text("EXPLAIN EXECUTE wu_list(NULL, NULL, 500, 0, :tid, NULL)"),
            {"tid": _TENANT},
        ).fetchall()
        conn.execute(text("DEALLOCATE wu_list"))
        # Leave the pooled connection as we found it — `plan_cache_mode` is
        # session state, and a later checkout of this connection inheriting
        # force_generic_plan would make the pool order-dependent.
        conn.execute(text("RESET plan_cache_mode"))
    return "\n".join(r[0] for r in rows)


def _named(sql: str) -> str:
    """Rewrite coord's ``$n`` placeholders to SQLAlchemy's ``:pn``.

    The ``$n::text`` casts are rewritten to ``CAST(:pn AS text)`` FIRST and on
    purpose: ``:p1::text`` is not a bind parameter to SQLAlchemy — the ``::``
    swallows it — so a naive ``$1`` → ``:p1`` pass leaves a literal in the SQL
    and the statement fails at execute time.
    """
    for n in (1, 2, 6):
        sql = sql.replace(f"${n}::text", f"CAST(:p{n} AS text)")
    for n in (1, 2, 3, 4, 5, 6):
        sql = sql.replace(f"${n}", f":p{n}")
    return sql


def _run_list(engine: Engine) -> dict[str, tuple[datetime | None, datetime | None]]:
    """Run the real statement and return ``{slug: (first_ip, first_shipped)}``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(_named(_LIST_SQL)),
            {
                "p1": None,
                "p2": None,
                "p3": 500,
                "p4": 0,
                "p5": _TENANT,
                "p6": None,
            },
        ).mappings()
        return {
            r["slug"]: (r["first_in_progress_at"], r["first_shipped_at"]) for r in rows
        }


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coord_workunits_05_index_serves_the_first_transition_laterals() -> None:
    """Build the index, prove the real LATERALs ride it and read FIRST."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_wu05_test") as (engine, url):
        # ----------------------------------------------------------------
        # 1. Parent revision — the index must not exist yet.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must be created by this revision, not an earlier one"
        )

        expected = _seed(engine)

        # The "before" state, recorded rather than asserted: on this fixture the
        # planner may already reach for the older single-column index. What must
        # change is WHICH index serves it, checked at step 3.
        before_plan = _generic_plan(engine)

        # ----------------------------------------------------------------
        # 2. Apply — the index exists, with the key columns IN ORDER.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_columns(engine, _INDEX_NAME) == [
            "work_unit_id",
            "to_status",
            "transitioned_at",
        ], (
            "column order is load-bearing: the two equality columns must precede "
            "the sort key, or ORDER BY transitioned_at LIMIT 1 needs a sort"
        )

        # ----------------------------------------------------------------
        # 3. The REAL statement rides the new index — once per LATERAL.
        # ----------------------------------------------------------------
        after_plan = _generic_plan(engine)
        assert after_plan.count(_INDEX_NAME) >= 2, (
            "each of the two LATERAL subqueries should be served by the new "
            f"index; plan was:\n{after_plan}"
        )
        assert "Seq Scan on work_unit_status_history" not in after_plan, (
            f"history table should not be sequentially scanned:\n{after_plan}"
        )
        assert _OLD_INDEX_NAME not in after_plan, (
            "the LATERALs should no longer fall back to the (work_unit_id)-only "
            f"index once the composite exists;\nbefore:\n{before_plan}\n"
            f"after:\n{after_plan}"
        )

        # ----------------------------------------------------------------
        # 4. FIRST transition, over a fixture that flaps.
        # ----------------------------------------------------------------
        got = _run_list(engine)
        assert got == expected, "derived timestamps must be the FIRST transition"

        # Guard the guard: if the fixture did not actually flap, assertion 4
        # would pass against a `last`-reading query too.
        flap = next(s for s in expected if s.startswith("flap-"))
        last_ship = _EPOCH + timedelta(hours=2 * _FLAPS)
        assert expected[flap][1] is not None and expected[flap][1] < last_ship, (
            "fixture is not exercising the first-vs-last distinction"
        )

        # An absent transition is UNKNOWN and must stay NULL — never
        # back-filled from created_at.
        never = next(s for s in expected if s.startswith("never-"))
        assert got[never] == (None, None)

        # ----------------------------------------------------------------
        # 5. Downgrade — index gone, ANSWERS UNCHANGED (performance-only).
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _run_list(engine) == expected, (
            "this revision is a performance change only; dropping it must not "
            "alter a single derived value, which is what lets coord's half "
            "deploy without waiting for the migration"
        )
