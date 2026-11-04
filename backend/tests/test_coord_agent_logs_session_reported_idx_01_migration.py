"""Behaviour test for ``coord_agent_logs_session_reported_idx_01``.

The revision builds, ``CONCURRENTLY``::

    + coord.agent_logs (agent_id, occurred_at, log_id) INCLUDE (agent_session_id)
      WHERE event = 'session_reported' AND agent_session_id IS NOT NULL
                                                   idx_agent_logs_session_reported

What is asserted
================
1. The upgrade path is one static ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``
   literal in an autocommit block.
2. At the parent revision the index does not exist, and the
   ``idx_agent_logs_agent`` index it complements does.
3. After upgrade the index exists, is ``indisvalid``, and has exactly the
   intended definition: the key matches the probe's equality plus its
   ``ORDER BY``, the INCLUDE column is what it returns, and the predicate is the
   probe's filter.
4. The per-allocation probe inside qontinui-coord's
   ``BIND_REPORTED_SESSIONS_SQL`` (``agent_worktrees.rs``) is an Index Only
   Scan of the new index with no Sort node. That is the whole point of the
   index: ``idx_agent_logs_agent`` carries neither ``event`` nor ``log_id``, so
   it can only serve the probe by heap-reading every log row of the agent.
5. Downgrade to the parent removes it and leaves ``idx_agent_logs_agent``.

``enable_seqscan`` and ``enable_bitmapscan`` are off for assertion 4: the table
is empty, so the question asked is "CAN the planner serve this shape from this
index without a sort or a heap read?", not a cost question.
"""

from __future__ import annotations

import re

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
    upgrade_execute_calls,
)

_PARENT_REVISION_ID = "ci_job_res_02"
_IDX_REVISION_ID = "coord_agent_logs_session_reported_idx_01"
_REVISION_FILENAME = "coord_agent_logs_session_reported_idx_01.py"

_IDX = "idx_agent_logs_session_reported"
_EXPECTED_DEFINITION = (
    f"CREATE INDEX {_IDX} ON coord.agent_logs USING btree "
    "(agent_id, occurred_at, log_id) INCLUDE (agent_session_id) "
    "WHERE ((event = 'session_reported'::text) AND (agent_session_id IS NOT NULL))"
)

# The LATERAL body of qontinui-coord BIND_REPORTED_SESSIONS_SQL, with the
# allocation's agent_id bound to a literal.
_PROBE_SQL = (
    "SELECT l.agent_session_id AS sid "
    "FROM coord.agent_logs l "
    "WHERE l.agent_id = '00000000-0000-0000-0000-000000000001'::uuid "
    "AND l.event = 'session_reported' "
    "AND l.agent_session_id IS NOT NULL "
    "ORDER BY l.occurred_at ASC, l.log_id ASC "
    "LIMIT 1"
)


def _index_def(engine: Engine, index_name: str) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    "SELECT pg_get_indexdef(c.oid) FROM pg_class c "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'coord' AND c.relname = :n"
                ),
                {"n": index_name},
            ).scalar()
            or ""
        )


def _index_is_valid(engine: Engine, index_name: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT i.indisvalid FROM pg_index i "
                    "JOIN pg_class c ON c.oid = i.indexrelid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'coord' AND c.relname = :n"
                ),
                {"n": index_name},
            ).scalar()
        )


def _plan_for(engine: Engine, sql: str) -> str:
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        conn.execute(text("SET enable_bitmapscan = off"))
        return "\n".join(str(r[0]) for r in conn.execute(text(f"EXPLAIN {sql}")).all())


def test_the_upgrade_path_is_classifier_safe() -> None:
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    calls = upgrade_execute_calls(path)
    assert len(calls) == 1, "one CREATE INDEX"
    (call,) = calls
    assert call.sql is not None, "the execute argument is one static literal"
    assert call.in_autocommit_block, (
        "CONCURRENTLY cannot run in a transaction: the statement sits inside "
        "the autocommit block"
    )
    create = re.sub(r"\s+", " ", call.sql).strip().upper()
    assert create.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), (
        "coord.agent_logs takes every agent event, and coord's classifier "
        f"rejects a non-concurrent or unguarded build: {create}"
    )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_agent_logs_session_reported_idx_01() -> None:
    root = backend_root()
    with ephemeral_database(
        admin_database_url(), "coord_agent_logs_sessrep_idx_test"
    ) as (engine, url):
        # Claim 2 — parent: the index is absent, its complement present.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IDX)
        assert index_exists(engine, "idx_agent_logs_agent"), (
            "coord_agent_logs built (agent_id, occurred_at DESC); the docstring's "
            "argument is that it cannot serve the probe index-only — its absence "
            "means the premise moved"
        )

        # Claim 3 — upgrade: exists, valid, exactly as defined.
        run_alembic(root, url, "upgrade", _IDX_REVISION_ID)
        assert _index_is_valid(engine, _IDX), f"{_IDX} is INVALID"
        assert _index_def(engine, _IDX) == _EXPECTED_DEFINITION

        # Claim 4 — coord's per-allocation probe is index-only, unsorted.
        plan = _plan_for(engine, _PROBE_SQL)
        assert f"Index Only Scan using {_IDX}" in plan, (
            f"the session-report probe must be an index-only scan of {_IDX}:\n{plan}"
        )
        assert "Sort" not in plan, f"the probe must not sort:\n{plan}"

        # Claim 5 — downgrade removes it and only it.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IDX)
        assert index_exists(engine, "idx_agent_logs_agent")
