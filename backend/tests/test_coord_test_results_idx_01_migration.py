"""Behaviour test for ``coord_test_results_idx_01`` — ``(repo, observed_at DESC)``.

The revision adds one composite index::

    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_results_repo_observed_at
        ON coord.test_results (repo, observed_at DESC)

for coord's newest-heads walk (``test_run_effects::recent_heads``)::

    SELECT head_sha FROM coord.test_results
     WHERE repo = $1 AND head_sha IS NOT NULL
     ORDER BY observed_at DESC LIMIT n

An index migration is easy to green vacuously three ways, and each is closed
here:

1. **A killed ``CREATE INDEX CONCURRENTLY`` leaves an INVALID index** that
   ``pg_indexes`` lists, ``IF NOT EXISTS`` then skips, and the planner never
   uses. Existence is asserted AND ``indisvalid``.
2. **An index can exist and still not serve the read.** The revision's whole
   claim is "an ordered range scan on the repo prefix, no Sort node". That is
   pinned with ``EXPLAIN`` on the exact statement shape: the plan must name
   the index and must NOT contain a ``Sort`` node. A later edit to the coord
   SQL (a second ``ORDER BY`` key, say) would reintroduce the sort and fail
   here rather than silently in production.
3. **Sensitivity: a read the index cannot serve.** ``ORDER BY observed_at
   DESC`` with no ``repo`` predicate has no leading-column match, so the
   planner must NOT pick this index for it — otherwise assertion 2 would be
   satisfied by any index whose name happened to appear in a plan.

Then downgrade: the index is gone, the rows are not.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
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

_REVISION_ID = "coord_test_results_idx_01"
_PARENT_REVISION_ID = "plan_library_05_scan_root_observations"

_INDEX_NAME = "idx_test_results_repo_observed_at"

# The coord statement, verbatim in shape (a literal repo in place of $1).
_SERVED_SQL = (
    "SELECT head_sha FROM coord.test_results "
    "WHERE repo = 'qontinui/qontinui-runner' AND head_sha IS NOT NULL "
    "ORDER BY observed_at DESC LIMIT 20"
)

# No leading-column predicate: the composite index cannot serve this ordering
# from its repo prefix, so the planner must not choose it.
_COMPLEMENT_SQL = (
    "SELECT head_sha FROM coord.test_results ORDER BY observed_at DESC LIMIT 20"
)

# (repo, head_sha) — two repos interleaved, so the served read has rows to skip.
_SEED_ROWS = [
    ("qontinui/qontinui-runner", "aaa1"),
    ("qontinui/qontinui-web", "bbb1"),
    ("qontinui/qontinui-runner", "aaa2"),
    ("qontinui/qontinui-web", "bbb2"),
    ("qontinui/qontinui-runner", None),
]


def _index_is_valid(engine: Engine) -> bool:
    """``indisvalid`` for the index — the check existence cannot make."""
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relname = :idx AND n.nspname = 'coord'
                    """
                ),
                {"idx": _INDEX_NAME},
            ).scalar()
        )


def _index_def(engine: Engine) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = :idx AND n.nspname = 'coord'
                """
            ),
            {"idx": _INDEX_NAME},
        ).scalar()


def _plan_for(engine: Engine, sql: str, *, no_sort: bool = False) -> str:
    """EXPLAIN ``sql`` with sequential scans (and, optionally, sorts) penalised.

    The fixture is tiny, so on cost alone a seq scan — or a two-row Sort off
    any other index — wins regardless of index quality. Disabling those
    removes the cost question and leaves the one being asked: CAN the planner
    serve this statement from this index without a Sort node? At production
    scale that is also the cheapest plan; at five rows it is not, which is why
    the switches exist.
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        if no_sort:
            conn.execute(text("SET enable_sort = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed(engine: Engine) -> None:
    with engine.begin() as conn:
        # Explicit, strictly increasing observed_at: one transaction's `now()`
        # is one instant, and identical timestamps would make the newest-first
        # assertion below order-ambiguous.
        for i, (repo, head_sha) in enumerate(_SEED_ROWS):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.test_results
                        (repo, head_sha, test_id, outcome, provenance, observed_at)
                    VALUES (:repo, :head_sha, 'm::t', 'pass', 'test',
                            now() + make_interval(secs => :i))
                    """
                ),
                {"repo": repo, "head_sha": head_sha, "i": i},
            )
        conn.execute(text("ANALYZE coord.test_results"))


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_test_results_idx_01_serves_the_newest_heads_walk_without_a_sort() -> (
    None
):
    """Add a valid index the served read uses sort-free; downgrade removes it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_test_results_idx_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # Parent revision — the index MUST be absent, or the create is
        # vacuous (IF NOT EXISTS would skip it) and nothing below is proven.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must not exist before this revision creates it"
        )
        _seed(engine)

        # ----------------------------------------------------------------
        # 1. Apply — present AND valid. A cancelled CONCURRENTLY build
        #    satisfies the first and not the second.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "the index is INVALID — a cancelled CONCURRENTLY build leaves one "
            "that pg_indexes lists and the planner never uses"
        )
        index_def = _index_def(engine) or ""
        assert "(repo, observed_at DESC)" in index_def, (
            f"expected a (repo, observed_at DESC) composite; got: {index_def}"
        )

        # ----------------------------------------------------------------
        # 2. The served read: the plan names the index and carries no Sort
        #    node — the revision's actual claim.
        # ----------------------------------------------------------------
        served_plan = _plan_for(engine, _SERVED_SQL, no_sort=True)
        assert _INDEX_NAME in served_plan, (
            "the newest-heads walk must be served by the new index:\n" + served_plan
        )
        assert "Sort" not in served_plan, (
            "the whole point of the index is an ORDERED range scan; a Sort "
            "node means the planner is re-sorting the partition:\n" + served_plan
        )
        with engine.connect() as conn:
            heads = [r[0] for r in conn.execute(text(_SERVED_SQL)).all()]
        assert heads == ["aaa2", "aaa1"], (
            f"newest-first for the one repo, NULL head skipped; got {heads}"
        )

        # ----------------------------------------------------------------
        # 3. Sensitivity — with no repo predicate the composite cannot serve
        #    the ordering from its prefix, so it must not be the plan's
        #    choice. Without this, assertion 2 could pass against an index
        #    the planner uses for anything at all.
        # ----------------------------------------------------------------
        complement_plan = _plan_for(engine, _COMPLEMENT_SQL, no_sort=True)
        assert _INDEX_NAME not in complement_plan, (
            "a repo-less ORDER BY observed_at read has no leading-column match "
            "and must not pick the (repo, observed_at) index:\n" + complement_plan
        )

        # ----------------------------------------------------------------
        # 4. Downgrade — index gone, rows untouched.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.test_results")
            ).scalar() == len(_SEED_ROWS), "dropping an index must not remove rows"
