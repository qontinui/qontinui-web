"""Behaviour test for ``coord_retention_idx_01``.

``coord_retention_idx_01`` builds, ``CONCURRENTLY``::

    + coord.git_write_ledger  (created_at)                        idx_git_write_ledger_created_at
    + coord.git_write_ledger  (created_at)
                              WHERE initiator = 'outbound_mirror' idx_git_write_ledger_mirror_created
    + coord.test_coverage_map (repo, test_id, observed_at DESC)   idx_test_coverage_map_repo_test_observed

What is asserted
================

1. The upgrade path is what coord's merge classifier auto-lands: three static
   ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literals in an autocommit block.
2. At the parent revision none of the three exists (the revision adds, it does
   not rename something already there).
3. After upgrade all three exist, are ``indisvalid``, and are exactly the intended
   definition: column order and direction make them serve, the first and last must
   be FULL, and the mirror one must be PARTIAL on exactly the predicate coord's
   scoped sweep inlines.
4. The whole-table sweep's batch subquery on ``git_write_ledger`` — which binds
   NO ``repo`` — is an ordered index scan on the new full ``created_at`` index
   with no Sort node. The pre-existing ``(repo, created_at DESC)`` index cannot
   deliver that order, which is why this index exists.
5. The scoped mirror sweep's batch subquery is an ordered scan of the partial
   index with no Sort node.
6. qontinui-coord ``credibility_scorer.rs``'s per-test newest-row read is an ordered
   scan of the composite with no Sort node.
7. The sweep guard's batch, exactly as ``prune_latest_per_key_index_probe_sql``
   renders it, plans as a nested loop probing the composite, on enough rows that the
   planner has a real choice. The hash semi-join coord's ``GuardAccess`` doc measures
   as the failure shape would fail this.
8. Downgrade to the parent removes all three.

``enable_seqscan = off`` and ``enable_bitmapscan = off`` for the plan assertions 4-6:
the tables are empty, so the question asked is "CAN the planner serve this shape from
this index without a sort?", not a cost question. Assertion 7 is the cost question.
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

_PARENT_REVISION_ID = "launch_budget_01"
_IDX_REVISION_ID = "coord_retention_idx_01"
_REVISION_FILENAME = "coord_retention_idx_01_git_write_ledger_and_test_coverage_map.py"

_IDX_LEDGER_CREATED = "idx_git_write_ledger_created_at"
_IDX_LEDGER_MIRROR = "idx_git_write_ledger_mirror_created"
_IDX_COVERAGE = "idx_test_coverage_map_repo_test_observed"

_EXPECTED_DEFINITIONS = {
    _IDX_LEDGER_CREATED: (
        f"CREATE INDEX {_IDX_LEDGER_CREATED} ON coord.git_write_ledger "
        "USING btree (created_at)"
    ),
    _IDX_LEDGER_MIRROR: (
        f"CREATE INDEX {_IDX_LEDGER_MIRROR} ON coord.git_write_ledger "
        "USING btree (created_at) WHERE (initiator = 'outbound_mirror'::text)"
    ),
    _IDX_COVERAGE: (
        f"CREATE INDEX {_IDX_COVERAGE} ON coord.test_coverage_map "
        "USING btree (repo, test_id, observed_at DESC)"
    ),
}

# The whole-table sweep's batch subquery, as ``prune_test_results`` shapes it.
_LEDGER_BATCH_SQL = (
    "SELECT id FROM coord.git_write_ledger "
    "WHERE created_at < now() - interval '90 days' "
    "ORDER BY created_at LIMIT 5000"
)

# The scoped mirror sweep's batch subquery, as ``prune_sql_where`` shapes it.
_LEDGER_MIRROR_BATCH_SQL = (
    "SELECT id FROM coord.git_write_ledger "
    "WHERE created_at < now() - interval '14 days' "
    "AND initiator = 'outbound_mirror' "
    "ORDER BY created_at LIMIT 5000"
)

# qontinui-coord ``credibility_scorer.rs`` ``cov`` CTE: the per-test newest-row read.
_COVERAGE_PROBE_SQL = (
    "SELECT files_touched FROM coord.test_coverage_map "
    "WHERE repo = 'qontinui/qontinui-runner' AND test_id = 'bin::mod::t1' "
    "ORDER BY observed_at DESC LIMIT 1"
)

# The sweep's batch selector, as ``prune_latest_per_key_index_probe_sql`` renders it
# with the ``(repo, test_id)`` key and ``observed_at`` preference.
_COVERAGE_GUARD_BATCH_SQL = (
    "SELECT o.id FROM coord.test_coverage_map o "
    "WHERE o.observed_at < now() - make_interval(days => 30) "
    "AND EXISTS (SELECT 1 FROM coord.test_coverage_map n "
    "WHERE n.repo = o.repo AND n.test_id = o.test_id "
    "AND n.observed_at > o.observed_at) "
    "ORDER BY o.observed_at LIMIT 5000"
)

# 2000 heads of 200 tests over 3 repos, one head per 6 hours: a candidate set far
# larger than the batch, so the planner weighs a stop-early probe against a hash.
_SEED_COVERAGE_SQL = (
    "INSERT INTO coord.test_coverage_map "
    "(repo, head_sha, test_id, provenance, observed_at) "
    "SELECT 'r' || (t % 3), 'sha' || h, 'bin::mod::t' || t, 'test', "
    "now() - make_interval(hours => 6 * h) "
    "FROM generate_series(1, 2000) h, generate_series(1, 200) t"
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


def _plan_for(engine: Engine, sql: str, *, force_index: bool = True) -> str:
    with engine.connect() as conn:
        if force_index:
            conn.execute(text("SET enable_seqscan = off"))
            # On an empty table a range predicate prefers a bitmap scan + Sort; the
            # question here is whether an ORDERED scan is available, so rule it out.
            conn.execute(text("SET enable_bitmapscan = off"))
        return "\n".join(str(r[0]) for r in conn.execute(text(f"EXPLAIN {sql}")).all())


def test_the_upgrade_path_is_classifier_safe() -> None:
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    calls = upgrade_execute_calls(path)
    assert len(calls) == 3, "one CREATE INDEX per index"
    for call in calls:
        assert call.sql is not None, "every execute argument is one static literal"
        assert call.in_autocommit_block, (
            "CONCURRENTLY cannot run in a transaction: every statement sits inside "
            "the autocommit block"
        )
        create = re.sub(r"\s+", " ", call.sql).strip().upper()
        assert create.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), (
            "both tables take continuous writes, and coord's classifier rejects a "
            f"non-concurrent or unguarded build: {create}"
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_retention_idx_01() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_retention_idx_test") as (
        engine,
        url,
    ):
        # Claim 2 — parent: none of the three exists.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for name in _EXPECTED_DEFINITIONS:
            assert not index_exists(engine, name)
        assert index_exists(engine, "idx_git_write_ledger_repo_created"), (
            "twin_git_02 built (repo, created_at DESC); the docstring's argument "
            "is that it cannot serve an unbound-repo sweep — its absence means "
            "the premise moved"
        )

        # Claim 3 — upgrade: all three exist, valid, exactly as defined.
        run_alembic(root, url, "upgrade", _IDX_REVISION_ID)
        for name, expected in _EXPECTED_DEFINITIONS.items():
            assert _index_is_valid(engine, name), f"{name} is INVALID"
            assert _index_def(engine, name) == expected

        # Claim 4 — the unbound-repo whole-table batch rides the created_at index.
        plan = _plan_for(engine, _LEDGER_BATCH_SQL)
        assert _IDX_LEDGER_CREATED in plan and "Sort" not in plan, (
            f"the sweep batch must be an ordered scan of {_IDX_LEDGER_CREATED}:\n{plan}"
        )

        # Claim 5 — the scoped mirror batch rides the partial index.
        plan = _plan_for(engine, _LEDGER_MIRROR_BATCH_SQL)
        assert _IDX_LEDGER_MIRROR in plan and "Sort" not in plan, (
            f"the mirror batch must be an ordered scan of {_IDX_LEDGER_MIRROR}:\n{plan}"
        )

        # Claim 6 — the per-test read rides the composite.
        plan = _plan_for(engine, _COVERAGE_PROBE_SQL)
        assert _IDX_COVERAGE in plan and "Sort" not in plan, (
            f"the per-test read must be an ordered scan of {_IDX_COVERAGE}:\n{plan}"
        )

        # Claim 7 — the guard's batch probes the composite, by cost.
        with engine.begin() as conn:
            conn.execute(text(_SEED_COVERAGE_SQL))
            conn.execute(text("ANALYZE coord.test_coverage_map"))
        plan = _plan_for(engine, _COVERAGE_GUARD_BATCH_SQL, force_index=False)
        assert "Nested Loop Semi Join" in plan and _IDX_COVERAGE in plan, (
            f"the guard's probe must be a nested loop over {_IDX_COVERAGE}:\n{plan}"
        )
        assert "Hash" not in plan, f"a hash semi-join is the failure shape:\n{plan}"

        # Claim 8 — downgrade to the parent removes all three.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for name in _EXPECTED_DEFINITIONS:
            assert not index_exists(engine, name)
        assert index_exists(engine, "idx_git_write_ledger_repo_created")
