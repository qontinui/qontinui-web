"""Behaviour test for the ``coord_iops_idx_02`` give-up probe index.

The revision creates one index, ``CONCURRENTLY``::

    idx_alerts_giveup_raised_key ON coord.alerts (alert_key)
        WHERE kind = 'gate_continuation_abandoned' OR detail ? 'giveup_raised'

``migration-reversal.yml`` confirms that the statement *executes* on an empty
database, and nothing more. The contract is that **the planner chooses this
index for the exact give-up scan coord sends**
(``continuation_stall_watcher::giveup_scan_sql``). That depends on PostgreSQL
proving that the probe's ``WHERE`` implies the partial predicate. The proof is
syntactic, so an innocent-looking edit on either side breaks it silently.

What is asserted
================

1. **The revision adds.** At the parent revision the index does not exist.
2. **It exists, is ``indisvalid``, and has the intended definition**, read
   back with ``pg_get_indexdef``. The revision adds exactly this index.
3. **Self-maintenance.** Every row is seeded AFTER the build, with no
   ``REINDEX``.
4. **The give-up scan rides it.** The alerts probe is an ``Index Cond`` on
   ``alert_key`` through this index, and there is no scan of the whole alerts
   heap (``Seq Scan on alerts``).
5. **The scan's answer is right.** The fixture covers each way a give-up drops
   out of the scan: an alert of the give-up kind, open or resolved; the marker
   on a resolved row of ANOTHER kind (the merge case the marker exists for);
   and a discharged work unit. It also covers each near miss that must stay in
   the scan: an alert on the key of another kind with no marker, and a
   give-up kind alert on ANOTHER gate's key.
6. **Sensitivity.** The same scan with a different marker literal does NOT get
   the index. Without this, #4 would still pass against an index whose
   predicate had been widened or dropped.
7. **No unintended reader moves onto it.** The active-key lookup every alert
   upsert runs (``alert_key = $1 AND resolved_at IS NULL``) still rides
   ``uq_alerts_active_key``. The give-up resolver (``GIVEUP_RESOLVE_PREDICATE_SQL``)
   implies the predicate too, so it MAY move onto it (stated, not accidental);
   either way it reaches ``alerts`` through an index, never a heap scan.
8. **Downgrade removes exactly this index**, and every row survives.

``enable_seqscan = off`` for the plan assertions: the fixture is small, so a
sequential scan wins on cost whatever the index. Turning it off leaves the one
question being asked: CAN the planner use this index for this query?

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres. The test is skipped when no Postgres is reachable.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_iops_idx_02"
_PARENT_REVISION_ID = "pr_events_mergeability_head_idx_01"

_IDX = "idx_alerts_giveup_raised_key"
_EXPECTED_INDEXDEF = (
    f"CREATE INDEX {_IDX} ON coord.alerts USING btree (alert_key) "
    "WHERE ((kind = 'gate_continuation_abandoned'::text) "
    "OR (detail ? 'giveup_raised'::text))"
)

# ---------------------------------------------------------------------------
# Reader SQL, transcribed from qontinui-coord ``origin/main``
# ``continuation_stall_watcher.rs`` (``GIVEUP_PREDICATE_SQL``,
# ``GIVEUP_UNALERTED_SQL``, ``giveup_scan_sql``) close to character for
# character. The predicate proof is syntactic, so a simplified stand-in would
# prove nothing about the statement coord sends. ``:lim`` is coord's ``$1``.
# ---------------------------------------------------------------------------
_GIVEUP_PREDICATE_SQL = (
    "continuation_consumed_at IS NOT NULL "
    "AND (continuation_consumed_outcome = 'work_abandoned' "
    "OR continuation_consumed_outcome LIKE 'work_abandoned: %') "
    "AND archived_at IS NULL"
)
_GIVEUP_UNALERTED_SQL = (
    "NOT EXISTS ( "
    "SELECT 1 FROM coord.alerts a "
    "WHERE a.alert_key = 'gate:' || coord.gates.gate_id::text "
    "AND (a.kind = 'gate_continuation_abandoned' OR a.detail ? 'giveup_raised') "
    ") "
    "AND NOT EXISTS ( "
    "SELECT 1 FROM coord.work_units wu "
    "WHERE wu.id = coord.gates.work_unit_id "
    "AND wu.status IN ('shipped', 'superseded', 'obsolete') "
    ")"
)
_GIVEUP_SCAN_SQL = (
    "SELECT gate_id, claim_kind, resource_key, phase_name, work_unit_id, "
    "continuation_consumed_at, continuation_consumed_by, "
    "continuation_consumed_outcome, "
    "continuation_spawn->>'action' AS continuation_action "
    "FROM coord.gates "
    f"WHERE {_GIVEUP_PREDICATE_SQL} "
    f"AND {_GIVEUP_UNALERTED_SQL} "
    "ORDER BY continuation_consumed_at ASC "
    "LIMIT :lim"
)

# coord ``resolve_taken_up_giveups`` shadow count over
# ``GIVEUP_RESOLVE_PREDICATE_SQL``, transcribed the same way.
_GIVEUP_RESOLVE_COUNT_SQL = (
    "SELECT count(*) FROM coord.alerts a "
    "WHERE (a.kind = 'gate_continuation_abandoned' "
    "OR a.detail ? 'giveup_raised') "
    "AND a.resolved_at IS NULL "
    "AND EXISTS ( "
    "SELECT 1 FROM coord.gates g "
    "JOIN coord.work_units wu ON wu.id = g.work_unit_id "
    "WHERE a.alert_key = 'gate:' || g.gate_id::text "
    "AND wu.status IN ('shipped', 'superseded', 'obsolete') "
    ")"
)

# The lookup every coord alert upsert's ON CONFLICT arbiter and the alert
# readers make: one OPEN row by key. It must keep its own index.
_ACTIVE_KEY_SQL = (
    "SELECT id FROM coord.alerts WHERE alert_key = :key AND resolved_at IS NULL"
)

# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

_TENANT = "1a0d7fd8-0000-4000-8000-0000000000a2"
_BASE = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
_BACKGROUND_GATES = 120
# Give-up kind alerts on keys of gates outside the fixture. Production holds
# ~2.4k rows inside the predicate; a partial index this size makes a
# parameterized descent cheaper than walking it whole, as it is there.
_GIVEUP_HISTORY = 2000


def _gid(n: int) -> str:
    return str(uuid.UUID(int=0x1A0D7FD8_0000_4000_8000_000000100000 + n))


# Give-up gates, one per case. ``expected`` says whether the scan returns it.
_UNALERTED = _gid(1)  # no alert at all
_SUFFIXED = _gid(2)  # 'work_abandoned: <why>', no alert
_OTHER_KIND_ONLY = _gid(3)  # a resolved alert of another kind, no marker
_OTHER_GATE_ALERTED = _gid(4)  # the give-up kind exists, but on _gid(99)'s key
_KIND_OPEN = _gid(5)  # an open give-up kind alert
_KIND_RESOLVED = _gid(6)  # a RESOLVED give-up kind alert
_MARKER_RESOLVED = _gid(7)  # marker on a resolved row of another kind
_UNIT_SHIPPED = _gid(8)  # anchored work unit shipped
_ARCHIVED = _gid(9)  # archived give-up
_NOT_GIVEUP = _gid(10)  # consumed with work_completed

_EXPECTED_SCAN = [_UNALERTED, _SUFFIXED, _OTHER_KIND_ONLY, _OTHER_GATE_ALERTED]


def _seed(conn: Connection) -> None:
    conn.execute(
        text(
            "INSERT INTO coord.tenants (tenant_id, slug, display_name) VALUES "
            "(CAST(:t AS uuid), 'iops-idx-02-test', 'iops idx 02 test')"
        ),
        {"t": _TENANT},
    )
    shipped_unit = conn.execute(
        text(
            "INSERT INTO coord.work_units (slug, tenant_id, status) "
            "VALUES ('iops-idx-02-shipped', CAST(:t AS uuid), 'shipped') "
            "RETURNING id"
        ),
        {"t": _TENANT},
    ).scalar_one()

    gate = text(
        """
        INSERT INTO coord.gates
            (gate_id, claim_kind, resource_key, predicate, tenant_id,
             work_unit_id, phase_name,
             continuation_consumed_at, continuation_consumed_outcome,
             archived_at)
        VALUES (CAST(:g AS uuid), :ck, :rk, '{}'::jsonb, CAST(:t AS uuid),
                CAST(:wu AS uuid), :phase, :at, :outcome, :archived)
        """
    )

    def add_gate(
        gate_id: str,
        minutes: int,
        outcome: str | None,
        work_unit: object | None = None,
        archived: datetime | None = None,
    ) -> None:
        conn.execute(
            gate,
            {
                "g": gate_id,
                "ck": None if work_unit else "session",
                "rk": None if work_unit else f"session:{gate_id}",
                "wu": None if work_unit is None else str(work_unit),
                "phase": "Phase 1" if work_unit else None,
                "t": _TENANT,
                "at": None if outcome is None else _BASE - timedelta(minutes=minutes),
                "outcome": outcome,
                "archived": archived,
            },
        )

    # Consumption order = expected scan order (oldest first).
    add_gate(_UNALERTED, 100, "work_abandoned")
    add_gate(_SUFFIXED, 90, "work_abandoned: ran out of context")
    add_gate(_OTHER_KIND_ONLY, 80, "work_abandoned")
    add_gate(_OTHER_GATE_ALERTED, 70, "work_abandoned")
    add_gate(_KIND_OPEN, 60, "work_abandoned")
    add_gate(_KIND_RESOLVED, 50, "work_abandoned")
    add_gate(_MARKER_RESOLVED, 40, "work_abandoned")
    add_gate(_UNIT_SHIPPED, 30, "work_abandoned", work_unit=shipped_unit)
    add_gate(_ARCHIVED, 20, "work_abandoned", archived=_BASE)
    add_gate(_NOT_GIVEUP, 10, "work_completed")
    # Background: never-consumed gates.
    for n in range(_BACKGROUND_GATES):
        add_gate(_gid(1000 + n), 0, None)

    alert = text(
        """
        INSERT INTO coord.alerts
            (alert_key, severity, kind, summary, detail, first_seen_at,
             last_seen_at, resolved_at)
        VALUES (:key, 'warning', :kind, :key, CAST(:detail AS jsonb), :at, :at,
                :resolved)
        """
    )

    def add_alert(
        gate_id: str, kind: str, detail: str = "{}", resolved: bool = True
    ) -> None:
        conn.execute(
            alert,
            {
                "key": f"gate:{gate_id}",
                "kind": kind,
                "detail": detail,
                "at": _BASE,
                "resolved": _BASE if resolved else None,
            },
        )

    add_alert(_OTHER_KIND_ONLY, "gate_continuation_pending")
    add_alert(_gid(99), "gate_continuation_abandoned")
    add_alert(_KIND_OPEN, "gate_continuation_abandoned", resolved=False)
    add_alert(_KIND_RESOLVED, "gate_continuation_abandoned")
    add_alert(
        _MARKER_RESOLVED,
        "gate_continuation_pending",
        detail='{"giveup_raised": true}',
    )
    # Bulk: resolved and open gate-keyed alerts of other kinds, so the probe
    # has a large population to NOT read.
    for n in range(_BACKGROUND_GATES):
        add_alert(_gid(1000 + n), "gate_continuation_pending", resolved=n % 3 != 0)
        add_alert(_gid(1000 + n), "gate_unclearable_terminal")
    for n in range(_GIVEUP_HISTORY):
        add_alert(_gid(100_000 + n), "gate_continuation_abandoned")
    conn.execute(text("ANALYZE coord.gates"))
    conn.execute(text("ANALYZE coord.alerts"))
    conn.execute(text("ANALYZE coord.work_units"))


def _plan(engine: Engine, sql: str, params: dict[str, object]) -> str:
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}"), params).all()
    return "\n".join(str(r[0]) for r in rows)


def _index_def(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text("SELECT pg_get_indexdef(to_regclass('coord.' || :n))"),
                {"n": _IDX},
            ).scalar()
            or ""
        )


def _index_is_valid(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT indisvalid FROM pg_index "
                    "WHERE indexrelid = to_regclass('coord.' || :n)"
                ),
                {"n": _IDX},
            ).scalar()
        )


def _alerts_indexes(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'coord' AND tablename = 'alerts'"
            )
        ).all()
    return {r[0] for r in rows}


_SKIP_NO_PG = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)


@_SKIP_NO_PG
def test_coord_iops_idx_02_index_serves_the_giveup_scan() -> None:
    """Build it, prove the give-up scan rides it with the right answer, prove the near-misses don't."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_iops_idx_02_test") as (
        engine,
        url,
    ):
        # Claim 1. Parent revision: the index does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IDX), (
            f"{_IDX} must be created by this revision, not an earlier one"
        )
        parent_indexes = _alerts_indexes(engine)

        # Claim 2. Apply: exists, VALID, intended definition, nothing else.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _IDX)
        assert _index_is_valid(engine), (
            f"{_IDX} is INVALID - a killed CONCURRENTLY build leaves an index of "
            "the right name that IF NOT EXISTS skips on re-run"
        )
        definition = _index_def(engine)
        assert definition == _EXPECTED_INDEXDEF, (
            "the key and the predicate are both load-bearing: the predicate is "
            "the probe's own disjunction, so the planner can prove implication.\n"
            f"expected: {_EXPECTED_INDEXDEF}\n"
            f"got:      {definition}"
        )
        assert _alerts_indexes(engine) == parent_indexes | {_IDX}, (
            "the revision must add exactly this index on coord.alerts"
        )

        # Claim 3. Seed after the build.
        with engine.begin() as conn:
            _seed(conn)

        # Claim 4. The give-up scan rides the index.
        scan_plan = _plan(engine, _GIVEUP_SCAN_SQL, {"lim": 25})
        assert _IDX in scan_plan, (
            "the give-up scan's alert probe must ride the partial index - the "
            f"probe's disjunction must imply its predicate; got:\n{scan_plan}"
        )
        assert any(
            "Index Cond" in line and "alert_key" in line
            for line in scan_plan.splitlines()
        ), (
            "alert_key must be an Index Cond - one descent per give-up gate, "
            f"not a walk of the whole partial index; got:\n{scan_plan}"
        )
        assert "Seq Scan on alerts" not in scan_plan, scan_plan

        # Claim 5. The scan's answer.
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            got = [
                str(r.gate_id)
                for r in conn.execute(text(_GIVEUP_SCAN_SQL), {"lim": 25}).all()
            ]
        assert got == _EXPECTED_SCAN, (
            "the scan keeps exactly the unalerted give-ups, oldest first: an "
            "alert of the give-up kind (open or resolved), the marker on a "
            "resolved row of another kind, a shipped unit, an archived gate and "
            f"a non-give-up outcome each drop out. Got {got!r}"
        )
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            capped = conn.execute(text(_GIVEUP_SCAN_SQL), {"lim": 2}).all()
        assert [str(r.gate_id) for r in capped] == _EXPECTED_SCAN[:2]

        # Claim 6. Sensitivity: a probe that does not imply the predicate does
        # not get the index.
        near_sql = _GIVEUP_SCAN_SQL.replace(
            "a.detail ? 'giveup_raised'", "a.detail ? 'some_other_marker'"
        )
        assert near_sql != _GIVEUP_SCAN_SQL
        near_plan = _plan(engine, near_sql, {"lim": 25})
        assert _IDX not in near_plan, (
            "a probe on another marker does not imply the partial predicate, so "
            "it must NOT get the index - if it does, the predicate is wider than "
            "intended:\n" + near_plan
        )

        # Claim 7. The active-key lookup keeps its own index.
        active_plan = _plan(engine, _ACTIVE_KEY_SQL, {"key": f"gate:{_KIND_OPEN}"})
        assert "uq_alerts_active_key" in active_plan, active_plan
        assert _IDX not in active_plan, (
            "the open-row-by-key lookup every alert upsert makes must stay on "
            f"uq_alerts_active_key; got:\n{active_plan}"
        )

        # Claim 7b. The give-up resolver implies the predicate, so it MAY ride
        # this index; it may equally drive from gates and probe
        # uq_alerts_active_key (what PG16 picks on this fixture). Either is
        # fine - what it must never do is scan the alerts heap.
        resolve_plan = _plan(engine, _GIVEUP_RESOLVE_COUNT_SQL, {})
        assert "Seq Scan on alerts" not in resolve_plan, resolve_plan
        assert (_IDX in resolve_plan) or ("uq_alerts_active_key" in resolve_plan), (
            f"the resolver must reach alerts through an index; got:\n{resolve_plan}"
        )

        # Claim 8. Downgrade removes exactly this index; rows survive.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _alerts_indexes(engine) == parent_indexes
        with engine.connect() as conn:
            alerts = conn.execute(text("SELECT count(*) FROM coord.alerts")).scalar()
            gates = conn.execute(text("SELECT count(*) FROM coord.gates")).scalar()
        assert alerts == 5 + 2 * _BACKGROUND_GATES + _GIVEUP_HISTORY, alerts
        assert gates == 10 + _BACKGROUND_GATES, gates
