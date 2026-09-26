"""Behaviour test for the ``coord_ci_runs_push_walk_idx_01`` partial index.

The revision creates one index, ``CONCURRENTLY``::

    idx_ci_runs_push_completed_walk
        ON coord.ci_runs (repo, workflow_name, head_branch, run_id DESC)
        WHERE event = 'push' AND status = 'completed'

``migration-reversal.yml`` confirms the statement *executes* on an empty
database, and nothing more. The contract is that **the planner chooses this
index for the walk-back SQL the paired qontinui-coord change sends** (plan
``2026-09-12-red-main-alert-since-resets-mid-episode-and-a-non-required-gate-reds-main-through-the-fail-closed-arm``
Phase 2.1; that change is not landed as this test is written). That depends on
PostgreSQL proving the query's ``WHERE`` implies the partial predicate, a
syntactic proof that an innocent-looking edit on either side breaks silently.

What is asserted
================

1. **The revision adds.** At the parent revision the index does not exist.
2. **It exists, is ``indisvalid``, and has the intended definition**, read back
   exactly with ``pg_get_indexdef``. A killed ``CONCURRENTLY`` build leaves an
   INVALID index that ``IF NOT EXISTS`` skips, so existence is not the
   contract. It is the only index the revision adds.
3. **Self-maintenance.** Every row is seeded AFTER the build, with no
   ``REINDEX``.
4. **The walk-back rides it with no ``Sort``**, both as a custom plan (bound
   literals; what an unnamed ``tokio_postgres`` statement gets) and as a
   generic plan (``$1``..``$4``), and ``repo`` / ``workflow_name`` /
   ``head_branch`` are index conditions rather than filters. The rows come
   back newest-first and exclude pull-request and in-flight runs.
5. **Sensitivity.** The same read for ``event = 'pull_request'`` does NOT get
   the partial index. Without this, #4 would still pass against an index whose
   predicate had been widened or dropped.
6. **Downgrade removes exactly it**, and every row survives.

``enable_seqscan = off`` and ``enable_bitmapscan = off`` for the plan
assertions: the fixture is small, so a sequential scan, or a bitmap scan plus
a ``Sort`` of its few rows, wins on cost whatever the index. Turning both off
leaves the one question being asked: CAN the planner serve this query,
ORDER BY included, from this index? If the predicate implication or the key
order does not hold, no penalty makes the index usable, which is how the
near miss discriminates. On production's history the ordered index scan is
also the cheap plan: ``LIMIT`` stops it after the handful of rows the fold
consumes, where a bitmap scan must fetch and sort every matching run.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres. The test is skipped when no Postgres is reachable.
"""

from __future__ import annotations

import re
from collections.abc import Mapping

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
    scalar,
)

_REVISION_ID = "coord_ci_runs_push_walk_idx_01"
_PARENT_REVISION_ID = "coord_ci_runs_started_at_01"

_INDEX = "idx_ci_runs_push_completed_walk"

# Exactly as ``pg_get_indexdef`` renders it on PostgreSQL 16. Column order,
# the DESC on run_id and the predicate are all load-bearing.
_EXPECTED_INDEXDEF = (
    f"CREATE INDEX {_INDEX} ON coord.ci_runs USING btree "
    "(repo, workflow_name, head_branch, run_id DESC) "
    "WHERE ((event = 'push'::text) AND (status = 'completed'::text))"
)

# The walk-back as the paired coord change writes it
# (``data/ci_runs.rs`` ``completed_push_run_verdicts``), with coord's own
# ``$1``..``$4``. Transcribed close to character for character: the predicate
# proof is syntactic, so a simplified stand-in would prove nothing.
_WALK_SQL = (
    "SELECT run_id, conclusion, run_started_at, observed_at "
    "FROM coord.ci_runs "
    "WHERE repo = $1 AND head_branch = $2 AND workflow_name = $3 "
    "AND event = 'push' AND status = 'completed' "
    "ORDER BY run_id DESC LIMIT $4"
)
_WALK_SQL_BOUND = (
    _WALK_SQL.replace("$1", ":repo")
    .replace("$2", ":branch")
    .replace("$3", ":wf")
    .replace("$4", ":lim")
)
# The near miss: identical but for the event literal.
_NEAR_MISS_SQL = _WALK_SQL_BOUND.replace("event = 'push'", "event = 'pull_request'")

_REPO = "qontinui/qontinui-coord"
_WORKFLOW = "ci"
_BRANCH = "main"
_WALK_PARAMS: Mapping[str, object] = {
    "repo": _REPO,
    "branch": _BRANCH,
    "wf": _WORKFLOW,
    "lim": 500,
}

_SKIP_NO_PG = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)

_FULL_SORT_NODE = re.compile(r"(?:^|->)\s*Sort\s+\(")


def _plan(conn: Connection, sql: str, params: Mapping[str, object]) -> str:
    """EXPLAIN ``sql`` with seq and bitmap scans penalised; see the module docstring."""
    conn.execute(text("SET enable_seqscan = off"))
    conn.execute(text("SET enable_bitmapscan = off"))
    rows = conn.execute(text(f"EXPLAIN {sql}"), dict(params)).all()
    return "\n".join(str(r[0]) for r in rows)


def _index_def(engine: Engine) -> str:
    return str(
        scalar(engine, "SELECT pg_get_indexdef(to_regclass('coord.' || :n))", n=_INDEX)
        or ""
    )


def _index_is_valid(engine: Engine) -> bool:
    return bool(
        scalar(
            engine,
            "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('coord.' || :n)",
            n=_INDEX,
        )
    )


def _index_set(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'coord' AND tablename = 'ci_runs'"
            )
        ).all()
    return {r[0] for r in rows}


def _seed(conn: Connection) -> None:
    """Push runs on two workflows and two repos, plus PR, scheduled and in-flight runs."""
    rows: list[dict[str, object]] = []
    run_id = 1000
    for repo in (_REPO, "qontinui/qontinui-web"):
        for wf in (_WORKFLOW, "release"):
            for i in range(40):
                run_id += 1
                rows.append(
                    {
                        "repo": repo,
                        "run_id": run_id,
                        "wf": wf,
                        "branch": _BRANCH,
                        "event": "push",
                        "status": "completed",
                        "conclusion": "success" if i % 7 == 0 else "failure",
                    }
                )
            for event, status, branch in (
                ("pull_request", "completed", "feature"),
                ("pull_request", "completed", _BRANCH),
                ("schedule", "completed", _BRANCH),
                ("push", "in_progress", _BRANCH),
                ("push", "queued", _BRANCH),
            ):
                run_id += 1
                rows.append(
                    {
                        "repo": repo,
                        "run_id": run_id,
                        "wf": wf,
                        "branch": branch,
                        "event": event,
                        "status": status,
                        "conclusion": None if status != "completed" else "failure",
                    }
                )
    conn.execute(
        text(
            """
            INSERT INTO coord.ci_runs
                (repo, run_id, workflow_name, head_branch, event, status, conclusion)
            VALUES (:repo, :run_id, :wf, :branch, :event, :status, :conclusion)
            """
        ),
        rows,
    )


@_SKIP_NO_PG
def test_coord_ci_runs_push_walk_idx_01_serves_the_walk_back() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "cirpw_idx_test") as (engine, url):
        # Claim 1: the parent does not have it.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX), (
            f"{_INDEX} must be created by this revision, not an earlier one"
        )
        parent_indexes = _index_set(engine)

        # Claim 2: exists, VALID, exact definition, and the only addition.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX)
        assert _index_is_valid(engine), (
            f"{_INDEX} is INVALID - a killed CONCURRENTLY build leaves an index "
            "of the right name that IF NOT EXISTS skips on re-run"
        )
        definition = _index_def(engine)
        assert definition == _EXPECTED_INDEXDEF, (
            "definition drifted - column order, direction and predicate are "
            f"load-bearing.\nexpected: {_EXPECTED_INDEXDEF}\ngot:      {definition}"
        )
        assert _index_set(engine) == parent_indexes | {_INDEX}

        # Claim 3: rows arrive after the build.
        with engine.begin() as conn:
            _seed(conn)
            conn.execute(text("ANALYZE coord.ci_runs"))

        # Claim 4a: custom plan.
        with engine.connect() as conn:
            custom_plan = _plan(conn, _WALK_SQL_BOUND, _WALK_PARAMS)
        assert f"Index Scan using {_INDEX}" in custom_plan, custom_plan
        assert not any(_FULL_SORT_NODE.search(ln) for ln in custom_plan.splitlines()), (
            f"run_id DESC must supply the ORDER BY; got:\n{custom_plan}"
        )
        assert "Index Cond: ((repo = " in custom_plan, custom_plan
        for column in ("workflow_name", "head_branch"):
            assert f"({column} = " in custom_plan, custom_plan
        assert "Filter:" not in custom_plan, (
            f"every walk-back conjunct must be answered by the index; got:\n{custom_plan}"
        )

        # Claim 4b: generic plan, coord's own placeholders.
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            conn.execute(text("SET enable_bitmapscan = off"))
            conn.execute(
                text(f"PREPARE walk_back(text, text, text, bigint) AS {_WALK_SQL}")
            )
            conn.execute(text("SET plan_cache_mode = force_generic_plan"))
            generic_plan = "\n".join(
                str(r[0])
                for r in conn.execute(
                    text(
                        "EXPLAIN EXECUTE walk_back("
                        f"'{_REPO}', '{_BRANCH}', '{_WORKFLOW}', 500)"
                    )
                ).all()
            )
            walked = conn.execute(
                text(f"EXECUTE walk_back('{_REPO}', '{_BRANCH}', '{_WORKFLOW}', 500)")
            ).all()
            conn.execute(text("DEALLOCATE walk_back"))
            conn.execute(text("RESET plan_cache_mode"))
        assert f"Index Scan using {_INDEX}" in generic_plan, generic_plan
        assert "$1" in generic_plan, f"expected a generic plan; got:\n{generic_plan}"
        assert not any(
            _FULL_SORT_NODE.search(ln) for ln in generic_plan.splitlines()
        ), generic_plan

        # Values: the 40 completed push runs of this repo/workflow, newest first.
        run_ids = [r[0] for r in walked]
        assert len(run_ids) == 40, run_ids
        assert run_ids == sorted(run_ids, reverse=True)

        # Claim 5: the near miss does not match the predicate.
        with engine.connect() as conn:
            near_plan = _plan(conn, _NEAR_MISS_SQL, _WALK_PARAMS)
        assert _INDEX not in near_plan, (
            f"a pull_request read must not match the push-only predicate; got:\n{near_plan}"
        )

        # Claim 6: downgrade removes exactly it; rows survive.
        before = scalar(engine, "SELECT count(*) FROM coord.ci_runs")
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX)
        assert _index_set(engine) == parent_indexes
        assert scalar(engine, "SELECT count(*) FROM coord.ci_runs") == before
