"""Behaviour test for the ``coord_pr_events_merged_repo_created_idx`` revision.

The revision adds a partial index on ``coord.pr_events (repo, created_at)``
restricted to merged events, so coord's ``ALL_LANDED_ARMING_SQL`` ``win_ev``
CTE reads only merged rows of the asked repos instead of every ``ingest`` and
``state_change`` row in the window (plan
``2026-11-28-repo-intake-read-is-intermittent-and-step-0-47-proceeds-on-one-unknown``
Phase 2, finding ``1d20f493``).

What is asserted
================

1. The upgrade path is one static ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``
   literal in an autocommit block, and nothing else.
2. Nothing exists at the parent revision.
3. After upgrade the index exists, is **``indisvalid``**, and is exactly the
   intended definition, the partial predicate included.
4. **``win_ev`` rides it.** ``_WIN_EV`` below is a literal copy of the CTE's
   body from coord's ``crates/coord/src/pr_merge/economics.rs``. With every
   other index present and the table ANALYZEd, its plan names this index and
   its buffers stay bounded by the merged rows, not by the window's events.
5. **Implication, not cost.** With every other index dropped and sequential
   scans priced out, ``win_ev`` still plans on it (its predicate implies the
   index's), and a read whose merged filter differs from the index's — a
   lower-case ``'merged'`` on ``state_change``, the spelling coord does NOT
   use — cannot, so assertion 4 is measuring the partial predicate.
   A no-index baseline of the same read is measured first and must be at
   least 3x the indexed figure, so the bound is shown to separate.
6. A re-run leaves the VALID index untouched (same oid), and KEEPS an INVALID
   one while reporting success. There is deliberately no in-migration repair:
   coord's migration classifier rejects ``op.get_bind().execute`` and a
   ``DROP`` on the upgrade path, so assertion 1 also pins that none is added.
   The post-deploy ``indisvalid`` read owns the repair.
7. Downgrade removes the index and leaves every row; a second upgrade
   re-applies.

coord's Phase 3 test
(``all_landed_win_ev_predicate_implies_the_merged_partial_index``, plan
``2026-11-28-repo-intake-read-is-intermittent-and-step-0-47-proceeds-on-one-unknown``)
pins the same implication from its side once it lands, by EXPLAINing the real
statement. This test reddens if the revision's side moves.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it
at a non-default host:port).
"""

from __future__ import annotations

import ast
import re
import warnings
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_definition,
    index_exists,
    index_oid,
    index_state,
    invalidate_index,
    is_superuser,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_pr_events_merged_repo_created_idx"
_PARENT_REVISION_ID = "cinode_06_ci_node_directives"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_INDEX_NAME = "idx_pr_events_merged_repo_created"
_REPO = "o/merged-idx-test"

_EXPECTED_DEFINITION = (
    f"CREATE INDEX {_INDEX_NAME} ON coord.pr_events USING btree "
    "(repo, created_at) "
    "WHERE (((event_kind = 'ingest'::text) AND (state = 'merged'::text)) OR "
    "((event_kind = 'state_change'::text) AND (state = 'MERGED'::text)))"
)

# `win_ev` of coord's ALL_LANDED_ARMING_SQL (economics.rs, coord 77de964e0),
# spelled as coord spells it, with `$1` / `$2` as named binds. A literal copy on
# purpose: the index serves coord only while the two predicates match.
_WIN_EV = """
    SELECT e.repo, e.pr_number, e.created_at,
           NULLIF(btrim(CASE WHEN e.event_kind = 'state_change'
                             THEN e.payload->>'head_sha_pre'
                             ELSE e.payload->>'head_sha' END), '') AS head
      FROM coord.pr_events e
     WHERE e.repo = ANY(CAST(:repos AS text[]))
       AND e.created_at >= CAST(:cutoff AS timestamptz) - interval '1 hour'
       AND ((e.event_kind = 'ingest' AND e.state = 'merged')
         OR (e.event_kind = 'state_change' AND e.state = 'MERGED'))
"""

# Same shape, but the state_change arm spelled lower-case. Its rows are not a
# subset of the index's, so the planner must not be able to use it.
_NOT_IMPLIED = """
    SELECT e.repo, e.pr_number, e.created_at
      FROM coord.pr_events e
     WHERE e.repo = ANY(CAST(:repos AS text[]))
       AND e.created_at >= CAST(:cutoff AS timestamptz) - interval '1 hour'
       AND ((e.event_kind = 'ingest' AND e.state = 'merged')
         OR (e.event_kind = 'state_change' AND e.state = 'merged'))
"""

_PARAMS: dict[str, Any] = {"repos": [_REPO], "cutoff": "now"}


def _seed(engine: Engine) -> int:
    """A window of mostly non-merged events with a few merged ones per PR.

    The shape the plan's §Why describes on production — most window events are
    not merged, so without this index ``repo`` and ``state`` are heap filters —
    at test scale. Here the no-index baseline plans as an Index Scan on
    ``idx_pr_events_created_at`` with ``repo`` / ``state`` / ``event_kind`` as a
    heap ``Filter`` (production's plan, on ``idx_pr_events_event_kind``, differs
    in the index but not in the shape). 64,000 non-merged events, one every
    40 s, round-robin over four repos — ``_REPO`` and three others — so about
    15k fall in the 7-day window, about 3.8k of them ``_REPO``'s, interleaved
    row by row with the other repos' across the heap. Returns the number of
    merged rows for ``_REPO``.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events
                    (repo, pr_number, event_kind, state, payload, created_at)
                SELECT CASE WHEN k % 4 = 0 THEN :r ELSE 'o/repo-' || (k % 4) END,
                       k % 400,
                       CASE WHEN k % 3 = 0 THEN 'ingest' ELSE 'state_change' END,
                       CASE WHEN k % 3 = 0 THEN 'open' ELSE 'OPEN' END,
                       jsonb_build_object('head_sha', 'h-' || k,
                                          'filler', repeat('x', 200)),
                       now() - make_interval(secs => k * 40)
                  FROM generate_series(1, 64000) AS k
                 ORDER BY k DESC
                """
            ),
            {"r": _REPO},
        )
        # The merged rows: one ingest/merged and one state_change/MERGED per PR.
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events
                    (repo, pr_number, event_kind, state, payload, created_at)
                SELECT r, pr, kind, st,
                       jsonb_build_object('head_sha', 'm-' || pr,
                                          'head_sha_pre', 'm-' || pr),
                       now() - make_interval(mins => pr * 50)
                  FROM unnest(ARRAY[:r, 'o/repo-1']) AS r,
                       generate_series(1, 95) AS pr,
                       (VALUES ('ingest', 'merged'),
                               ('state_change', 'MERGED')) AS v(kind, st)
                """
            ),
            {"r": _REPO},
        )
        conn.execute(text("ANALYZE coord.pr_events"))
        return int(
            conn.execute(
                text(
                    """
                    SELECT count(*) FROM coord.pr_events
                     WHERE repo = :r
                       AND ((event_kind = 'ingest' AND state = 'merged')
                         OR (event_kind = 'state_change' AND state = 'MERGED'))
                    """
                ),
                {"r": _REPO},
            ).scalar_one()
        )


def _cutoff(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(text("SELECT (now() - interval '7 days')::text")).scalar_one()
        )


def _explain(engine: Engine, sql: str, params: dict[str, Any]) -> str:
    with engine.connect() as conn:
        rows = conn.execute(text(f"EXPLAIN (ANALYZE, BUFFERS) {sql}"), params).all()
    return "\n".join(str(r[0]) for r in rows)


def _plan_with_no_alternative(engine: Engine, sql: str, params: dict[str, Any]) -> str:
    """The plan when this index is the only index the planner has.

    Every other droppable index goes, inside a transaction that is rolled back,
    and a sequential scan is priced out. If the partial predicate can be proved
    from the read's clauses the plan names this index; if it cannot, no cost can
    make it.
    """
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            others = conn.execute(
                text(
                    """
                    SELECT i.indexrelid::regclass::text
                      FROM pg_index i
                     WHERE i.indrelid = 'coord.pr_events'::regclass
                       AND i.indexrelid <> CAST(:idx AS regclass)
                       AND NOT EXISTS (
                           SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
                    """
                ),
                {"idx": f"coord.{_INDEX_NAME}"},
            ).scalars()
            for name in list(others):
                conn.execute(text(f"DROP INDEX {name}"))
            conn.execute(text("SET LOCAL enable_seqscan = off"))
            rows = conn.execute(text(f"EXPLAIN {sql}"), params).all()
            return "\n".join(str(r[0]) for r in rows)
        finally:
            tx.rollback()


def _top_buffers(plan: str) -> int:
    """The buffers the whole statement touched: the plan's first Buffers line."""
    first = re.search(r"Buffers: shared(?: hit=(\d+))?(?: read=(\d+))?", plan)
    assert first is not None, plan
    return int(first.group(1) or 0) + int(first.group(2) or 0)


def _row_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text("SELECT count(*) FROM coord.pr_events")).scalar_one()
        )


def test_the_upgrade_path_is_one_concurrent_create() -> None:
    """One static CREATE INDEX CONCURRENTLY in an autocommit block, nothing else."""
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    calls = upgrade_execute_calls(path)
    assert len(calls) == 1, "one CREATE INDEX, and nothing else on the upgrade path"
    call = calls[0]
    assert call.sql is not None, "the execute argument is one static literal"
    assert call.in_autocommit_block, "CONCURRENTLY cannot run in a transaction"
    create = re.sub(r"\s+", " ", call.sql).strip().upper()
    assert create.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), create
    module = ast.parse(path.read_text(encoding="utf-8"))
    functions = {
        n.name
        for n in module.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert functions == {"upgrade", "downgrade"}, sorted(functions)
    binds = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.Attribute) and node.attr == "get_bind"
    ]
    assert not binds, f"get_bind anywhere in the revision, at lines {binds}"


_NEEDS_PG = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)


@_NEEDS_PG
def test_coord_pr_events_merged_repo_created_idx_serves_win_ev() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "pr_events_merged_idx_test") as (
        engine,
        url,
    ):
        # 2. Parent revision: no index yet. Seed so the build runs over rows, and
        #    measure win_ev without the index, the baseline assertion 4 beats.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        merged = _seed(engine)
        params = {**_PARAMS, "cutoff": _cutoff(engine)}
        baseline = _top_buffers(_explain(engine, _WIN_EV, params))

        # 3. Apply: valid, and exactly the definition win_ev relies on.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert index_state(engine, _INDEX_NAME)[0], (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run; existence is not enough"
        )
        assert index_definition(engine, _INDEX_NAME) == _EXPECTED_DEFINITION
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.pr_events"))

        # 4. With every index present, win_ev chooses this one, and it reads
        #    about the merged rows rather than the window's events.
        plan = _explain(engine, _WIN_EV, params)
        assert _INDEX_NAME in plan, f"win_ev must ride the merged index:\n{plan}"
        with engine.connect() as conn:
            found = conn.execute(text(_WIN_EV), params).all()
        assert len(found) == merged, (len(found), merged)
        buffers = _top_buffers(plan)
        assert buffers < 2 * merged, (
            f"{buffers} buffers for {merged} merged rows: win_ev is not reading "
            f"only merged events:\n{plan}"
        )
        # The bound must separate: without the index the same read costs far
        # more, or assertion 4 would pass on a seed too small to tell.
        assert baseline >= 3 * buffers, (
            f"baseline {baseline} buffers without the index vs {buffers} with "
            "it: the seed does not exercise the heap-filter shape"
        )

        # 5. Implication: win_ev can use it with no alternative; a read whose
        #    merged filter differs cannot.
        plan = _plan_with_no_alternative(engine, _WIN_EV, params)
        assert _INDEX_NAME in plan, (
            f"win_ev's predicate must imply the index predicate:\n{plan}"
        )
        plan = _plan_with_no_alternative(engine, _NOT_IMPLIED, params)
        assert _INDEX_NAME not in plan, (
            f"a lower-case state_change arm must NOT match this partial index:\n{plan}"
        )


@_NEEDS_PG
def test_coord_pr_events_merged_repo_created_idx_lifecycle() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "pr_events_merged_idx_lifecycle") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _seed(engine)
        rows = _row_count(engine)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_state(engine, _INDEX_NAME)[0]

        # 6. A re-run leaves the VALID index untouched...
        oid_before = index_oid(engine, _INDEX_NAME)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_state(engine, _INDEX_NAME)[0], "a re-run must leave a VALID index"
        assert index_oid(engine, _INDEX_NAME) == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # ...and KEEPS an INVALID one, reporting success. That is deliberate (no
        # in-migration repair: coord's classifier rejects one, see the
        # revision's docstring), and it is why the post-deploy step reads
        # `indisvalid`. Marking the index INVALID takes a superuser, which CI's
        # database role is; elsewhere this step is skipped and the rest runs.
        if is_superuser(engine):
            invalidate_index(engine, _INDEX_NAME)
            run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
            run_alembic(root, url, "upgrade", _REVISION_ID)
            assert not index_state(engine, _INDEX_NAME)[0], (
                "IF NOT EXISTS keeps an INVALID index and the upgrade reports "
                "success: the post-deploy indisvalid read is what sees this"
            )
        else:
            warnings.warn(
                "not a superuser: the INVALID-index half of assertion 6 did not run",
                stacklevel=1,
            )

        # 7. Downgrade removes the index (INVALID or not); every row survives.
        #    Re-upgrade builds a VALID one.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _row_count(engine) == rows, "downgrade must not touch a row"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_state(engine, _INDEX_NAME)[0], "re-applied index must be VALID"
