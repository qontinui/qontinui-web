"""Behaviour test for ``journey_02_explorations`` — one row per explorer run.

What this pins is the table the runner's explorer writes
(``src-tauri/src/journey/explorer.rs``): a drift here refuses the explorer's
INSERT on another repo's code path, where it surfaces only as the explore
answer's persistence state. So:

1. **Shape** — exactly the columns, types and nullability the explorer writes;
   the one index; the ``run_id`` primary key; nothing after downgrade.
2. **Closed vocabulary** — ``stopped_because`` refuses an unknown word and
   accepts every one of the six.
3. **The budget is never unset** — the three budget columns are NOT NULL and
   positive (depth may be 0), and spent never exceeds budget.
4. **Accounting** — ``edges_added`` is within ``[0, spent_actions]``.
5. **An auth wall names its node** — ``auth_wall`` with no ``stop_node`` is
   refused.
6. **JSONB shape** — a JSON ``null`` cannot pose as a start, a node or a
   reason map.
7. **The classifier's shape** (static, no database), as for journey_01.

Applied by ALEMBIC (``run_alembic``), never by replaying statements, so the
``autocommit_block`` runs exactly as it does in production. Substrate comes from
``_alembic_harness``: an ephemeral database inside the test Postgres, skipped
when none is reachable.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REVISION_ID = "journey_02_explorations"
_REVISION_FILENAME = "journey_02_explorations.py"
_TABLE = "journey_explorations"
_TS = "timestamp with time zone"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime — never pin it."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "run_id": ("text", "NO"),
    "app_id": ("text", "NO"),
    "runner_build_id": ("text", "NO"),
    "runner_instance": ("text", "NO"),
    "started_at": (_TS, "NO"),
    "finished_at": (_TS, "NO"),
    "start": ("jsonb", "NO"),
    "budget_max_actions": ("integer", "NO"),
    "budget_max_depth": ("integer", "NO"),
    "budget_max_wall_clock_s": ("integer", "NO"),
    "spent_actions": ("integer", "NO"),
    "spent_depth": ("integer", "NO"),
    "spent_wall_clock_ms": ("bigint", "NO"),
    "stopped_because": ("text", "NO"),
    "stop_node": ("jsonb", "YES"),
    "edges_added": ("integer", "NO"),
    "frontier_remaining_by_reason": ("jsonb", "NO"),
    "invalidated_at": (_TS, "YES"),
    "invalidated_reason": ("text", "YES"),
    "invalidated_by": ("text", "YES"),
    "invalidation_token": ("text", "YES"),
}

_EXPECTED_INDEXES: dict[str, str] = {
    "ix_journey_explorations_app_finished_at": (
        "(app_id, finished_at DESC) WHERE (invalidated_at IS NULL)"
    ),
}

_STOP_REASONS = (
    "budget_actions",
    "budget_depth",
    "budget_time",
    "frontier_exhausted",
    "app_unreachable",
    "auth_wall",
)

_NODE = json.dumps(
    {
        "specId": None,
        "stateIds": [],
        "modelled": False,
        "pathnameTemplate": "/login",
        "pageLabel": None,
    }
)
_START = json.dumps({"url": "http://localhost:3001/admin/coord"})
_REMAINING = json.dumps({"effect_write": 3, "effect_undeclared": 7})
_JSON_NULL = "null"

_INSERT = text(
    """
    INSERT INTO project.journey_explorations
        (run_id, app_id, runner_build_id, runner_instance, started_at,
         start, budget_max_actions, budget_max_depth, budget_max_wall_clock_s,
         spent_actions, spent_depth, spent_wall_clock_ms, stopped_because,
         stop_node, edges_added, frontier_remaining_by_reason)
    VALUES (:run_id, 'qontinui-web', 'build-1', 'primary', now(),
            CAST(:start AS jsonb), :max_actions, :max_depth, :max_wall,
            :spent_actions, :spent_depth, :spent_ms, :stopped_because,
            CAST(:stop_node AS jsonb), :edges_added, CAST(:remaining AS jsonb))
    RETURNING finished_at
    """
)

_counter = iter(range(1_000_000))


def _insert(engine: Engine, **overrides: Any) -> None:
    params: dict[str, Any] = {
        "run_id": f"run-{next(_counter)}",
        "start": _START,
        "max_actions": 60,
        "max_depth": 4,
        "max_wall": 300,
        "spent_actions": 10,
        "spent_depth": 2,
        "spent_ms": 12_345,
        "stopped_because": "frontier_exhausted",
        "stop_node": None,
        "edges_added": 10,
        "remaining": _REMAINING,
    }
    params.update(overrides)
    with engine.begin() as conn:
        conn.execute(_INSERT, params).scalar_one()


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'project' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _index_defs(engine: Engine) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'project' AND tablename = :table
                   AND indexname <> 'journey_explorations_pkey'
                """
            ),
            {"table": _TABLE},
        ).all()
    parsed: dict[str, str] = {}
    for name, indexdef in rows:
        _, sep, tail = indexdef.partition("USING btree ")
        assert sep, f"unexpected index definition for {name}: {indexdef}"
        parsed[name] = tail
    return parsed


def test_journey_02_upgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: the call shapes qontinui-coord's migration_classifier admits."""
    calls = upgrade_execute_calls(
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    )
    assert calls, "upgrade() runs no op.execute"
    dynamic = [i for i, call in enumerate(calls) if call.sql is None]
    assert not dynamic, (
        f"op.execute call(s) {dynamic} in upgrade() do not take ONE inline static "
        "string literal — coord's classifier holds that as dynamic SQL"
    )
    statements = [(" ".join(c.sql.split()).upper(), c) for c in calls if c.sql]
    tables = [s for s, _ in statements if s.startswith("CREATE TABLE")]
    indexes = [(s, c) for s, c in statements if s.startswith("CREATE INDEX")]
    assert len(tables) == 1 and len(indexes) == 1, statements
    assert tables[0].startswith("CREATE TABLE IF NOT EXISTS PROJECT."), tables[0]
    for statement, call in indexes:
        assert statement.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), (
            statement
        )
        assert call.in_autocommit_block, (
            f"{statement[:60]}… must sit inside op.get_context().autocommit_block()"
        )
    assert all(s.startswith("CREATE ") for s, _ in statements), statements


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_journey_02_creates_the_explorations_table_and_enforces_its_rules() -> None:
    """Shape, vocabulary, budget, accounting, auth-wall node, JSONB, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "journey02_test") as (engine, url):
        # 1. Parent — the table does not exist yet; the Phase 1 tables do.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "project", _TABLE)
        assert table_exists(engine, "project", "journey_edge_observations")

        # 2. Apply — exact shape.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _columns(engine) == _EXPECTED_COLUMNS
        assert _index_defs(engine) == _EXPECTED_INDEXES
        with engine.connect() as conn:
            valid = conn.execute(
                text(
                    """
                    SELECT bool_and(i.indisvalid) FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = ANY(:names)
                    """
                ),
                {"names": list(_EXPECTED_INDEXES)},
            ).scalar_one()
            primary_key = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT a.attname FROM pg_constraint c
                          JOIN pg_attribute a
                            ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
                         WHERE c.conrelid = 'project.journey_explorations'::regclass
                           AND c.contype = 'p'
                        """
                    )
                ).all()
            ]
        assert valid is True
        assert primary_key == ["run_id"]
        info = column_info(engine, _TABLE, "finished_at", schema="project")
        assert info is not None and info[2] == "now()", info

        # 3. Every stop reason is accepted; auth_wall only with a node.
        for reason in _STOP_REASONS:
            _insert(
                engine,
                stopped_because=reason,
                stop_node=_NODE if reason == "auth_wall" else None,
            )
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_stopped_because"
        ):
            _insert(engine, stopped_because="timeout")
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_auth_wall_names_node"
        ):
            _insert(engine, stopped_because="auth_wall", stop_node=None)

        # 4. The budget is never unset and never non-positive (depth may be 0).
        _insert(engine, max_depth=0, spent_depth=0)
        for column in ("max_actions", "max_depth", "max_wall"):
            with pytest.raises(IntegrityError, match="not-null|null value"):
                _insert(engine, **{column: None})
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_budget_positive"
        ):
            _insert(engine, max_actions=0, spent_actions=0, edges_added=0)
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_budget_positive"
        ):
            _insert(engine, max_wall=0)
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_spent_non_negative"
        ):
            _insert(engine, spent_ms=-1)

        # 5. Spent never exceeds budget (actions, depth).
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_spent_within_budget"
        ):
            _insert(engine, spent_actions=61, edges_added=0)
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_spent_within_budget"
        ):
            _insert(engine, spent_depth=5)

        # 6. One edge per activation, never more.
        with pytest.raises(IntegrityError, match="ck_journey_explorations_edges_added"):
            _insert(engine, edges_added=11)
        with pytest.raises(IntegrityError, match="ck_journey_explorations_edges_added"):
            _insert(engine, edges_added=-1)

        # 7. JSON null / non-objects never pose as a start, a node or a map.
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_start_object"
        ):
            _insert(engine, start=_JSON_NULL)
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_stop_node_object"
        ):
            _insert(engine, stop_node=_JSON_NULL)
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_frontier_remaining_object"
        ):
            _insert(engine, remaining="[]")

        # 8. finished_at never precedes started_at.
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_finished_after_started"
        ):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO project.journey_explorations
                            (run_id, app_id, runner_build_id, runner_instance,
                             started_at, finished_at, start, budget_max_actions,
                             budget_max_depth, budget_max_wall_clock_s,
                             spent_actions, spent_depth, spent_wall_clock_ms,
                             stopped_because, edges_added,
                             frontier_remaining_by_reason)
                        VALUES ('run-backwards', 'qontinui-web', 'b', 'primary',
                                now(), now() - interval '1 second', '{}'::jsonb,
                                1, 0, 1, 0, 0, 0, 'frontier_exhausted', 0,
                                '{}'::jsonb)
                        """
                    )
                )

        # 9. run_id is the key.
        _insert(engine, run_id="run-dup")
        with pytest.raises(IntegrityError, match="journey_explorations_pkey"):
            _insert(engine, run_id="run-dup")

        # 10. Downgrade — table and index gone; Phase 1 tables untouched.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "project", _TABLE)
        for name in _EXPECTED_INDEXES:
            assert not index_exists(engine, name, schema="project")
        assert table_exists(engine, "project", "journey_edge_observations")

        # 11. Re-apply cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "project", _TABLE)
