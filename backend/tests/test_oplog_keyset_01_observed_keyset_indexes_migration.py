"""Behaviour test for the ``oplog_keyset_01`` keyset-index revision.

The revision adds one index per effect oplog, keyed on the sort key coord's
page read walks, and retires the dominated ``idx_fs_observations_observed_at``::

    idx_commit_observations_observed_keyset
        ON coord.commit_observations (observed_at DESC, id DESC)
    idx_fs_observations_observed_keyset
        ON coord.fs_observations (observed_at DESC, id DESC)

Phase 5 of plan
``2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus``. The
contract is that **coord's ``GET /coord/commits`` and
``GET /coord/fs/observations`` page reads walk the keyset index in order
instead of sorting**, so that is what is pinned here.

What is asserted
================

1. At the parent revision neither keyset index exists, the old single-column
   fs index does, and the commits page read SORTS — read from the actual plan,
   so assertion 4's no-Sort check has a real opposite.
2. After upgrade both keyset indexes exist and are ``indisvalid`` (a killed
   ``CONCURRENTLY`` build leaves an INVALID index ``IF NOT EXISTS`` would skip
   forever), and ``idx_fs_observations_observed_at`` is gone.
3. Each key is ``(observed_at DESC, id DESC)``, non-partial, non-unique, and
   not repo-leading.
4. The planner rides each index with NO Sort node for coord's production
   statements — the first page and a cursor page carrying the row comparison
   ``(observed_at, id) < (ts, id)``.
5. The cursor page resumes exactly after the boundary row across an
   ``observed_at`` tie (the row an ``observed_at``-only cursor loses).
6. Downgrade restores the single-column index, drops both keyset indexes, and
   leaves the rows untouched.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

from datetime import datetime

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

_REVISION_ID = "oplog_keyset_01"
_PARENT_REVISION_ID = "cinode_04_runner_requires_windows"

_COMMITS_INDEX = "idx_commit_observations_observed_keyset"
_FS_INDEX = "idx_fs_observations_observed_keyset"
_FS_OLD_INDEX = "idx_fs_observations_observed_at"

_REPO = "qontinui/oplog-keyset-test"

# coord's production statements, VERBATIM in shape, with bound parameters
# written as literals for an unfiltered page of limit 2 (``LIMIT 3`` is the
# ``limit + 1`` probe). Source: qontinui-coord ``commit_effects.rs``
# ``load_commit_page`` and ``edit_effects.rs`` ``load_fs_observation_page``.
# tokio-postgres plans each ``query(&str, …)`` with its actual parameter values
# (a custom plan), so ``NULL::text IS NULL`` and the first page's
# ``NULL::timestamptz IS NULL`` keyset guard constant-fold exactly as here.
_COMMITS_SQL = """
    SELECT id, observed_at FROM coord.commit_observations
     WHERE (NULL::text IS NULL OR repo = NULL::text)
       AND (NULL::text IS NULL OR branch = NULL::text)
       AND (false IS TRUE OR provenance IS DISTINCT FROM 'restack:coord')
       AND ({ts} IS NULL OR (observed_at, id) < ({ts}, {bid}::bigint))
     ORDER BY observed_at DESC, id DESC
     LIMIT 3
"""

_FS_SQL = """
    SELECT id, observed_at FROM coord.fs_observations
     WHERE (NULL::text IS NULL OR repo = NULL::text)
       AND ({ts} IS NULL OR (observed_at, id) < ({ts}, {bid}::bigint))
     ORDER BY observed_at DESC, id DESC
     LIMIT 3
"""


def _page(sql: str, boundary: tuple[int, datetime] | None = None) -> str:
    """The first page (``$ts``/``$id`` NULL) or a cursor page after ``boundary``."""
    if boundary is None:
        return sql.format(ts="NULL::timestamptz", bid="NULL")
    bid, bts = boundary
    return sql.format(ts=f"'{bts.isoformat()}'::timestamptz", bid=int(bid))


def _index_is_valid(engine: Engine, index: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :idx
                    """
                ),
                {"idx": index},
            ).scalar()
        )


def _index_shape(engine: Engine, index: str) -> tuple[str, bool, bool]:
    """Return ``(definition, is_partial, is_unique)`` for ``index``."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid),
                       i.indpred IS NOT NULL,
                       i.indisunique
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": index},
        ).one()
    return str(row[0]), bool(row[1]), bool(row[2])


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised, so the tiny fixture's
    cost does not decide the question being asked: CAN the planner serve this
    ORDER BY from an index walk? At the parent revision nothing can, so the
    plan still sorts (assertion 1) and the penalty cannot manufacture a pass."""
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _has_sort_node(plan: str) -> bool:
    # A Sort / Incremental Sort node, not the "Sort Key" detail line.
    return any(
        line.strip().lstrip("-> ").startswith(("Sort", "Incremental Sort"))
        and not line.strip().startswith("Sort Key")
        for line in plan.splitlines()
    )


def _seed(engine: Engine) -> None:
    """Four rows per oplog, including an ``observed_at`` tie pair."""
    ages = ["0 minutes", "1 minutes", "2 minutes", "2 minutes"]
    with engine.begin() as conn:
        for i, age in enumerate(ages):
            observed = "date_trunc('second', now()) - CAST(:age AS interval)"
            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.commit_observations
                        (repo, head_sha, message, observed_at)
                    VALUES (:repo, :sha, 'seed', {observed})
                    """
                ),
                {"repo": _REPO, "sha": f"{i:040x}", "age": age},
            )
            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.fs_observations
                        (repo, path, post_sha, observed_at)
                    VALUES (:repo, :path, 'p', {observed})
                    """
                ),
                {"repo": _REPO, "path": f"src/{i}.rs", "age": age},
            )


def _rows(engine: Engine, sql: str) -> list[tuple[int, datetime]]:
    with engine.connect() as conn:
        return [(int(r[0]), r[1]) for r in conn.execute(text(sql)).all()]


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_oplog_keyset_01_indexes_serve_both_oplog_page_reads() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "oplog_keyset_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — no keyset index; the commits page read sorts.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _COMMITS_INDEX)
        assert not index_exists(engine, _FS_INDEX)
        assert index_exists(engine, _FS_OLD_INDEX)
        _seed(engine)
        parent_plan = _plan_for(engine, _page(_COMMITS_SQL))
        assert _has_sort_node(parent_plan), (
            "without the keyset index the commits page read must sort — "
            f"otherwise the no-Sort assertion below proves nothing:\n{parent_plan}"
        )

        # 2. Apply — both keyset indexes exist and are VALID; the old one is gone.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for index in (_COMMITS_INDEX, _FS_INDEX):
            assert index_exists(engine, index), index
            assert _index_is_valid(engine, index), index
        assert not index_exists(engine, _FS_OLD_INDEX)

        # 3. Key order and direction; not partial, not unique, not repo-leading.
        for index, table in (
            (_COMMITS_INDEX, "coord.commit_observations"),
            (_FS_INDEX, "coord.fs_observations"),
        ):
            definition, is_partial, is_unique = _index_shape(engine, index)
            assert f"ON {table}" in definition, definition
            assert definition.endswith("(observed_at DESC, id DESC)"), definition
            assert not is_partial, definition
            assert not is_unique, definition
            assert "repo" not in definition, definition

        # 4 + 5. First page and cursor page ride the index with no Sort, and the
        #        cursor resumes exactly after the boundary across the tie.
        for sql, index in ((_COMMITS_SQL, _COMMITS_INDEX), (_FS_SQL, _FS_INDEX)):
            first = _page(sql)
            plan = _plan_for(engine, first)
            assert index in plan, f"the page read must ride {index}:\n{plan}"
            assert not _has_sort_node(plan), f"the page read must not sort:\n{plan}"

            ordered = _rows(engine, first.replace("LIMIT 3", ""))
            assert len(ordered) == 4, ordered
            assert ordered[2][1] == ordered[3][1], "fixture must carry a tie"
            assert ordered[2][0] > ordered[3][0], "the tie is broken by id DESC"

            cursor_sql = _page(sql, ordered[2])
            cursor_plan = _plan_for(engine, cursor_sql)
            assert index in cursor_plan, cursor_plan
            assert not _has_sort_node(cursor_plan), cursor_plan
            assert _rows(engine, cursor_sql) == ordered[3:], (
                "the cursor page must resume with the boundary's tie partner"
            )

        # 6. Downgrade restores the parent's index set; rows survive.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _COMMITS_INDEX)
        assert not index_exists(engine, _FS_INDEX)
        assert index_exists(engine, _FS_OLD_INDEX)
        assert _index_is_valid(engine, _FS_OLD_INDEX)
        with engine.connect() as conn:
            for table in ("commit_observations", "fs_observations"):
                n = conn.execute(
                    text(f"SELECT count(*) FROM coord.{table} WHERE repo = :repo"),
                    {"repo": _REPO},
                ).scalar()
                assert n == 4, (table, n)
