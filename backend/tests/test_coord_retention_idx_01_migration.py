"""Behaviour test for ``coord_retention_idx_01`` and ``coord_test_results_autovac_01``.

``coord_retention_idx_01`` builds, ``CONCURRENTLY``::

    + coord.git_write_ledger  (created_at)                        idx_git_write_ledger_created_at
    + coord.test_coverage_map (repo, test_id, observed_at DESC)   idx_test_coverage_map_repo_test_observed

``coord_test_results_autovac_01`` sets two autovacuum storage parameters on
``coord.test_results``.

What is asserted
================

1. At the parent revision neither index exists (the revision adds, it does not
   rename something already there).
2. After upgrade both exist, are ``indisvalid``, and carry the intended column
   list and direction — the column ORDER is what makes them serve.
3. The retention sweep's batch subquery on ``git_write_ledger`` — which binds
   NO ``repo`` — is an ordered index scan on the new ``created_at`` index with
   no Sort node. The pre-existing ``(repo, created_at DESC)`` index cannot
   deliver that order, which is why this index exists.
4. The per-test newest-row probe on ``test_coverage_map`` (qontinui-coord
   ``credibility_scorer.rs``'s read; the sweep's guard is a GROUP BY aggregate
   that does not require this index)
   is an ordered index scan on the new composite with no Sort node.
5. The ``indisvalid`` guard refuses a leftover INVALID index, for each of
   the two index names, that
   ``IF NOT EXISTS`` would otherwise skip (driven by marking a pre-built index
   invalid in the catalog; skipped when the test role is not a superuser).
6. ``coord_test_results_autovac_01`` sets exactly the two ``reloptions`` and its
   downgrade RESETs them to none.
7. Downgrade to the parent removes both indexes.

``enable_seqscan = off`` and ``enable_bitmapscan = off`` for the plan
assertions: the tables are empty, so the
question asked is "CAN the planner serve this shape from this index without a
sort?", not a cost question — same device as ``test_coord_test_results_idx_01``.
"""

from __future__ import annotations

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

_PARENT_REVISION_ID = "coord_smckpt_01_success_metric_checkpoint_results"
_IDX_REVISION_ID = "coord_retention_idx_01"
_AUTOVAC_REVISION_ID = "coord_test_results_autovac_01"

_IDX_LEDGER_CREATED = "idx_git_write_ledger_created_at"
_IDX_COVERAGE = "idx_test_coverage_map_repo_test_observed"

# The retention sweep's batch subquery, as ``prune_test_results`` shapes it.
_LEDGER_BATCH_SQL = (
    "SELECT id FROM coord.git_write_ledger "
    "WHERE created_at < now() - interval '90 days' "
    "ORDER BY created_at LIMIT 5000"
)

# qontinui-coord ``credibility_scorer.rs`` ``cov`` CTE (the per-test newest-row
# read this index exists for; the sweep's guard is a GROUP BY aggregate).
_COVERAGE_PROBE_SQL = (
    "SELECT files_touched FROM coord.test_coverage_map "
    "WHERE repo = 'qontinui/qontinui-runner' AND test_id = 'bin::mod::t1' "
    "ORDER BY observed_at DESC LIMIT 1"
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
        # On an empty table a range predicate prefers a bitmap scan + Sort; the
        # question here is whether an ORDERED scan is available, so rule it out.
        conn.execute(text("SET enable_bitmapscan = off"))
        return "\n".join(str(r[0]) for r in conn.execute(text(f"EXPLAIN {sql}")).all())


def _test_results_reloptions(engine: Engine) -> list[str] | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT reloptions FROM pg_class WHERE oid = 'coord.test_results'::regclass"
            )
        ).scalar()


def _is_superuser(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
            ).scalar()
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_retention_idx_01_and_test_results_autovac_01() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_retention_idx_test") as (
        engine,
        url,
    ):
        # Claim 1 — parent: neither index exists.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IDX_LEDGER_CREATED)
        assert not index_exists(engine, _IDX_COVERAGE)
        assert index_exists(engine, "idx_git_write_ledger_repo_created"), (
            "twin_git_02 built (repo, created_at DESC); the docstring's argument "
            "is that it cannot serve an unbound-repo sweep — its absence means "
            "the premise moved"
        )

        # Claim 5 — a leftover INVALID index is refused, not skipped — for BOTH
        # index names (each has its own ``_require_valid`` call).
        if _is_superuser(engine):
            for name, ddl in (
                (
                    _IDX_LEDGER_CREATED,
                    f"CREATE INDEX {_IDX_LEDGER_CREATED} "
                    "ON coord.git_write_ledger (created_at)",
                ),
                (
                    _IDX_COVERAGE,
                    f"CREATE INDEX {_IDX_COVERAGE} "
                    "ON coord.test_coverage_map (repo, test_id, observed_at DESC)",
                ),
            ):
                with engine.begin() as conn:
                    conn.execute(text(ddl))
                    conn.execute(
                        text(
                            "UPDATE pg_index SET indisvalid = false "
                            f"WHERE indexrelid = 'coord.{name}'::regclass"
                        )
                    )
                refused = run_alembic(
                    root, url, "upgrade", _IDX_REVISION_ID, expect_success=False
                )
                output = refused.stdout + refused.stderr
                assert (
                    f"{name} is INVALID" in output
                    and f"DROP INDEX CONCURRENTLY coord.{name}" in output
                ), (
                    f"the revision must refuse an INVALID leftover {name} and name "
                    f"the recovery; got:\n{output}"
                )
                with engine.begin() as conn:
                    conn.execute(
                        text(f"DROP INDEX IF EXISTS coord.{_IDX_LEDGER_CREATED}")
                    )
                    conn.execute(text(f"DROP INDEX IF EXISTS coord.{_IDX_COVERAGE}"))

        # Claim 2 — upgrade: both exist, valid, as defined.
        run_alembic(root, url, "upgrade", _IDX_REVISION_ID)
        for name, expected_cols in (
            (_IDX_LEDGER_CREATED, "(created_at)"),
            (_IDX_COVERAGE, "(repo, test_id, observed_at DESC)"),
        ):
            assert index_exists(engine, name)
            assert _index_is_valid(engine, name), f"{name} is INVALID"
            definition = _index_def(engine, name)
            assert "USING btree" in definition and expected_cols in definition, (
                f"{name} must be a btree on {expected_cols}; got {definition!r}"
            )
            assert " WHERE " not in definition, (
                f"{name} must be a FULL index — a partial one cannot serve the "
                f"sweep's unqualified age predicate: {definition!r}"
            )

        # Claim 3 — the unbound-repo sweep batch rides the created_at index.
        plan = _plan_for(engine, _LEDGER_BATCH_SQL)
        assert _IDX_LEDGER_CREATED in plan and "Sort" not in plan, (
            f"the sweep batch must be an ordered scan of {_IDX_LEDGER_CREATED}:\n{plan}"
        )

        # Claim 4 — the per-test newest-row probe rides the composite.
        plan = _plan_for(engine, _COVERAGE_PROBE_SQL)
        assert _IDX_COVERAGE in plan and "Sort" not in plan, (
            f"the per-test probe must be an ordered scan of {_IDX_COVERAGE}:\n{plan}"
        )

        # Claim 6 — autovacuum parameters set, then reset.
        assert _test_results_reloptions(engine) is None
        run_alembic(root, url, "upgrade", _AUTOVAC_REVISION_ID)
        assert sorted(_test_results_reloptions(engine) or []) == [
            "autovacuum_vacuum_scale_factor=0.01",
            "autovacuum_vacuum_threshold=10000",
        ]
        run_alembic(root, url, "downgrade", _IDX_REVISION_ID)
        assert _test_results_reloptions(engine) is None, (
            "downgrade must RESET the two parameters, leaving no reloptions"
        )

        # Claim 7 — downgrade to the parent removes both indexes.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IDX_LEDGER_CREATED)
        assert not index_exists(engine, _IDX_COVERAGE)
        assert index_exists(engine, "idx_git_write_ledger_repo_created")
