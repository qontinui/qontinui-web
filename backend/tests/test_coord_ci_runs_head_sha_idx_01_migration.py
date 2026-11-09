"""Behaviour test for the ``coord_ci_runs_head_sha_idx_01`` revision.

The revision adds a plain index::

    CREATE INDEX CONCURRENTLY ix_ci_runs_repo_head_sha
    ON coord.ci_runs (repo, head_sha)

What is asserted
================

1. Nothing exists at the parent revision.
2. After upgrade the index exists, is **``indisvalid``**, is NOT unique (one
   commit has many runs), and is NOT partial.
3. **coord's per-commit read rides it.** Seeded with many repos and many runs
   per commit, then ANALYZEd, ``WHERE repo = $1 AND head_sha = $2`` plans on
   the index and returns exactly the seeded runs for that commit.
4. **Idempotency:** ``alembic stamp`` back to the parent and ``upgrade`` again
   leaves the same VALID index (same oid), rather than dropping and rebuilding
   it.
5. **A failed CONCURRENTLY build is repaired, not kept:** a genuinely failing
   ``CREATE UNIQUE INDEX CONCURRENTLY`` of the same name (several runs for one
   commit) leaves an INVALID index; a re-run drops it and rebuilds the
   revision's own, non-unique, valid index.
6. Downgrade removes the index and leaves every run; a second upgrade
   re-applies cleanly.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it
at a non-default host:port).
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_ci_runs_head_sha_idx_01"
_PARENT_REVISION_ID = "repair_rerun_01_partial_idx"

_INDEX_NAME = "ix_ci_runs_repo_head_sha"

_REPOS = 20
_COMMITS_PER_REPO = 200
_RUNS_PER_COMMIT = 4


def _index_row(engine: Engine) -> tuple[bool, bool, str | None]:
    """``(indisvalid, indisunique, predicate)`` for the index."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid, i.indisunique,
                       pg_get_expr(i.indpred, i.indrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": _INDEX_NAME},
        ).one()
    return bool(row[0]), bool(row[1]), row[2]


def _index_oid(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        )


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    ``enable_seqscan = off`` leaves the question being asked: which index does
    the planner choose for this predicate, given every other index on the
    table (the ``(repo, run_id)`` primary key among them)?
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _run_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text("SELECT count(*) FROM coord.ci_runs")).scalar_one()
        )


def _seed(engine: Engine) -> None:
    """Per repo, ``_COMMITS_PER_REPO`` commits with ``_RUNS_PER_COMMIT`` runs each."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.ci_runs
                    (repo, run_id, workflow_name, head_sha, head_branch,
                     event, status, conclusion)
                SELECT 'org/repo-' || r,
                       (c * 100 + w),
                       'wf-' || w,
                       'sha-' || r || '-' || c,
                       'main', 'push', 'completed', 'success'
                  FROM generate_series(1, :repos) AS r,
                       generate_series(1, :commits) AS c,
                       generate_series(1, :runs) AS w
                """
            ),
            {
                "repos": _REPOS,
                "commits": _COMMITS_PER_REPO,
                "runs": _RUNS_PER_COMMIT,
            },
        )
        conn.execute(text("ANALYZE coord.ci_runs"))


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)
def test_coord_ci_runs_head_sha_idx_01_indexes_per_commit_read() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "ci_runs_head_sha_idx_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: no index yet. Seed so the build runs over rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        _seed(engine)
        runs = _run_count(engine)
        assert runs == _REPOS * _COMMITS_PER_REPO * _RUNS_PER_COMMIT

        # 2. Apply: valid, non-unique, not partial.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        valid, unique, predicate = _index_row(engine)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run; existence is not enough"
        )
        assert not unique, "one commit has many runs; this is an access path"
        assert predicate is None, f"the index must not be partial, got {predicate!r}"
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.ci_runs"))

        # 3. coord's per-commit read rides the index and finds every run.
        per_commit = """
            SELECT workflow_name, head_branch, status, conclusion, observed_at
              FROM coord.ci_runs
             WHERE repo = 'org/repo-7' AND head_sha = 'sha-7-42'
        """
        plan = _plan_for(engine, per_commit)
        assert _INDEX_NAME in plan, f"the per-commit read must ride the index:\n{plan}"
        with engine.connect() as conn:
            found = conn.execute(text(per_commit)).all()
        assert len(found) == _RUNS_PER_COMMIT

        # 4. Idempotency: a re-run leaves the VALID index untouched.
        oid_before = _index_oid(engine)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine)[0], "a re-run must leave a VALID index"
        assert _index_oid(engine) == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # 5. A failed CONCURRENTLY build is repaired. Several runs per commit
        #    make a same-named UNIQUE build fail, leaving an INVALID index
        #    under our name.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("DROP INDEX CONCURRENTLY coord.ix_ci_runs_repo_head_sha"))
            with pytest.raises(IntegrityError):
                conn.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX CONCURRENTLY ix_ci_runs_repo_head_sha
                        ON coord.ci_runs (repo, head_sha)
                        """
                    )
                )
        assert index_exists(engine, _INDEX_NAME)
        assert not _index_row(engine)[0], "fixture must leave an INVALID index"

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        valid, unique, _ = _index_row(engine)
        assert valid, "the re-run must drop the INVALID index and rebuild it"
        assert not unique, "the rebuilt index must be the revision's own"

        # 6. Downgrade removes the index; runs survive. Re-upgrade works.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _run_count(engine) == runs, "downgrade must not delete runs"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine)[0], "re-applied index must be VALID"
