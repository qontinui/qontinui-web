"""Behaviour test for the ``repo_branches_repo_pr_idx_01`` revision.

The revision adds a partial index ``coord.repo_branches (repo, pr_number) WHERE
pr_number IS NOT NULL`` so coord's reads that resolve a PR to its branch rows stop
reading the whole table. The heaviest is the work-unit realizations read (plan
``2026-11-27-coord-work-unit-realizations-read-burns-two-db-cores``, Phase 3).

What is asserted
================

1. The upgrade path is what coord's merge classifier auto-lands: one static
   ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literal in an autocommit block.
2. Nothing exists at the parent revision.
3. After upgrade the index exists, is **``indisvalid``**, and is exactly the intended
   definition, the partial predicate included.
4. **Each coord consumer's read shape plans on it** on a table of production's size:
   ``gates.rs`` ``FRESHEST_PR_BRANCH_ROW_SQL``, ``pr_merge/author_feedback.rs``'s
   branch lookup, ``land_status.rs`` Query A (``pr_number = ANY($2)``), and the
   realizations row source's join of citations to the live-plus-archive ``UNION
   ALL``. The bound-parameter reads are also planned as a **generic** plan, which is
   what a prepared statement reuses: a partial predicate proved only from a constant
   would be lost there.
5. **A read with no ``pr_number`` clause cannot use it,** so assertion 4 is measuring
   the partial predicate rather than an index any ``repo`` read could ride.
   "Cannot use" is asserted with every other droppable index gone and sequential scans
   priced out, so it says the predicate cannot be proved from the read's clauses.
6. **A re-run leaves the VALID index alone (same oid), and keeps an INVALID one.** The
   revision carries no in-migration repair, because coord's classifier rejects one, so
   this pins what its docstring tells a reader to check after the deploy.
7. Downgrade removes the index and leaves every row; a second upgrade re-applies.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it at a
non-default host:port).
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

_REVISION_ID = "repo_branches_repo_pr_idx_01"
_PARENT_REVISION_ID = "coord_second_tier_idx_01"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_INDEX_NAME = "idx_repo_branches_repo_pr"
_EXPECTED_DEFINITION = (
    f"CREATE INDEX {_INDEX_NAME} ON coord.repo_branches USING btree "
    "(repo, pr_number) WHERE (pr_number IS NOT NULL)"
)
_REPOS = 12
_PRS_PER_REPO = 2500
_HOT_REPO = "o/repo-3"

# `gates.rs` FRESHEST_PR_BRANCH_ROW_SQL, as coord spells it.
_FRESHEST = """
    SELECT pr_state, close_cause, head_sha, merge_commit_sha, merged_at
      FROM coord.repo_branches
     WHERE repo = $1 AND pr_number = $2
     ORDER BY last_refreshed_at DESC NULLS LAST, created_at DESC NULLS LAST,
              branch DESC
     LIMIT 1
"""
# `pr_merge/author_feedback.rs`'s head-branch lookup.
_AUTHOR_FEEDBACK = """
    SELECT branch FROM coord.repo_branches WHERE repo = $1 AND pr_number = $2 LIMIT 1
"""
# `land_status.rs` resolve_land_status_batch, Query A.
_LAND_STATUS_A = """
    SELECT pr_number, pr_state, close_cause, merge_commit_sha
      FROM coord.repo_branches
     WHERE repo = $1 AND pr_number = ANY($2)
     ORDER BY pr_number, last_refreshed_at DESC NULLS LAST
"""
# The shape of coord's REALIZATIONS_ROW_SOURCE_WITH_ARCHIVE (displaced_pr_rows.rs):
# live rows not shadowed by an archived land, UNION ALL archived rows no live row
# covers. The land predicates are reduced to the columns they read; what matters here
# is the key and the anti-joins. `_REALIZATIONS_JOIN` is how coord sends it today, a
# plain LEFT JOIN on (repo, pr_number); `_REALIZATIONS_LATERAL` is the per-citation
# probe the plan's coord half switches to if the join stays off the index.
_LIVE_HALF = """
          SELECT live.repo, live.pr_number, live.branch, live.pr_state
            FROM coord.repo_branches live
           WHERE {live_key}NOT EXISTS (
                 SELECT 1 FROM coord.displaced_pr_rows landed
                  WHERE landed.repo = live.repo
                    AND landed.pr_number = live.pr_number
                    AND landed.merged_at IS NOT NULL)
"""
_ARCHIVE_HALF = """
          SELECT arch.repo, arch.pr_number, arch.branch, arch.pr_state
            FROM coord.displaced_pr_rows arch
           WHERE {arch_key}NOT EXISTS (
                 SELECT 1 FROM coord.repo_branches l
                  WHERE l.repo = arch.repo AND l.pr_number = arch.pr_number)
"""
_CITATIONS = "unnest(CAST(:repos AS text[]), CAST(:prs AS int[])) AS c(repo, pr_number)"
_REALIZATIONS_JOIN = (
    f"SELECT c.repo, c.pr_number, rb.branch, rb.pr_state FROM {_CITATIONS} "
    "LEFT JOIN ("
    + _LIVE_HALF.format(live_key="")
    + " UNION ALL "
    + _ARCHIVE_HALF.format(arch_key="")
    + ") rb ON rb.repo = c.repo AND rb.pr_number = c.pr_number"
)
_REALIZATIONS_LATERAL = (
    f"SELECT c.repo, c.pr_number, rb.branch, rb.pr_state FROM {_CITATIONS} "
    "LEFT JOIN LATERAL ("
    + _LIVE_HALF.format(
        live_key="live.repo = c.repo AND live.pr_number = c.pr_number AND "
    )
    + " UNION ALL "
    + _ARCHIVE_HALF.format(
        arch_key="arch.repo = c.repo AND arch.pr_number = c.pr_number AND "
    )
    + ") rb ON true"
)
# A read that names the repo but no PR: the partial predicate cannot be proved.
_REPO_ONLY = """
    SELECT branch FROM coord.repo_branches WHERE repo = :repo AND head_sha = 'x'
"""


def _seed(engine: Engine) -> None:
    """Production's row count (about 34k here against 32,332), not its distribution:
    PR rows across a dozen repos, interleaved in time so each PR's rows are spread
    across the heap, a PR occasionally on two branches, and a tail of branches that
    never had a PR.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.repo_branches
                    (repo, branch, head_sha, pr_number, pr_state, last_refreshed_at)
                SELECT 'o/repo-' || r, 'agent/b-' || r || '-' || pr, md5(r || ':' || pr),
                       pr, CASE WHEN pr % 5 = 0 THEN 'open' ELSE 'merged' END,
                       now() - make_interval(mins => pr)
                  FROM generate_series(1, :prs) AS pr,
                       generate_series(1, :repos) AS r
                 ORDER BY pr, r
                """
            ),
            {"prs": _PRS_PER_REPO, "repos": _REPOS},
        )
        # Re-opened PRs: a second branch row for the same (repo, pr_number).
        conn.execute(
            text(
                """
                INSERT INTO coord.repo_branches
                    (repo, branch, head_sha, pr_number, pr_state)
                SELECT 'o/repo-' || r, 'agent/b-' || r || '-' || pr || '-v2', 'v2',
                       pr, 'closed'
                  FROM generate_series(1, :prs, 50) AS pr,
                       generate_series(1, :repos) AS r
                """
            ),
            {"prs": _PRS_PER_REPO, "repos": _REPOS},
        )
        # Branches pushed but never opened as a PR: outside the partial predicate.
        conn.execute(
            text(
                """
                INSERT INTO coord.repo_branches (repo, branch, head_sha)
                SELECT 'o/repo-' || r, 'scratch/' || r || '-' || k, 'none'
                  FROM generate_series(1, 300) AS k,
                       generate_series(1, :repos) AS r
                """
            ),
            {"repos": _REPOS},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.displaced_pr_rows
                    (repo, pr_number, branch, pr_state, source)
                SELECT 'o/repo-' || r, 100000 + k, 'gone/' || k, 'merged', 'rebind'
                  FROM generate_series(1, 40) AS k,
                       generate_series(1, :repos) AS r
                """
            ),
            {"repos": _REPOS},
        )
        conn.execute(text("ANALYZE coord.repo_branches"))
        conn.execute(text("ANALYZE coord.displaced_pr_rows"))


def _explain(
    engine: Engine, sql: str, params: dict[str, Any], *, analyze: bool = False
) -> str:
    options = "(ANALYZE, BUFFERS) " if analyze else ""
    with engine.connect() as conn:
        rows = conn.execute(text(f"EXPLAIN {options}{sql}"), params).all()
    return "\n".join(str(r[0]) for r in rows)


def _explain_generic(
    engine: Engine, sql: str, types: str, args: str, *, analyze: bool = False
) -> str:
    """The generic plan of a prepared statement, as coord's bound reads reuse it."""
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(text("SET LOCAL plan_cache_mode = force_generic_plan"))
            conn.exec_driver_sql(f"PREPARE rbidx ({types}) AS {sql}")
            options = "(ANALYZE, BUFFERS) " if analyze else ""
            rows = conn.exec_driver_sql(
                f"EXPLAIN {options}EXECUTE rbidx ({args})"
            ).all()
            conn.exec_driver_sql("DEALLOCATE rbidx")
            return "\n".join(str(r[0]) for r in rows)
        finally:
            tx.rollback()


def _plan_with_no_alternative(engine: Engine, sql: str, params: dict[str, Any]) -> str:
    """The plan of a read when this index is the only droppable index left.

    Every other droppable index goes, inside a transaction that is rolled back, and a
    sequential scan is priced out. If the partial predicate can be proved from the
    read's clauses the planner may name this index; if it cannot, no cost can make it.
    """
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            others = conn.execute(
                text(
                    """
                    SELECT i.indexrelid::regclass::text
                      FROM pg_index i
                     WHERE i.indrelid = 'coord.repo_branches'::regclass
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
            conn.execute(text("SELECT count(*) FROM coord.repo_branches")).scalar_one()
        )


def test_the_upgrade_path_is_classifier_safe() -> None:
    """Coord's classifier rejects a read through ``op.get_bind().execute`` and a DROP on
    the upgrade path, and a Reject parks the PR on its author. An in-migration repair of
    an INVALID index is both, so this reddens if one comes back.
    """
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    calls = upgrade_execute_calls(path)
    assert len(calls) == 1, "one CREATE INDEX, and nothing else on the upgrade path"
    module = ast.parse(path.read_text(encoding="utf-8"))
    functions = {
        n.name
        for n in module.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert functions == {"upgrade", "downgrade"}, (
        f"a module-level helper is read by the classifier as well: {sorted(functions)}"
    )
    assert not any(isinstance(n, ast.Lambda) for n in ast.walk(module)), (
        "a lambda is a helper the classifier reads as well"
    )
    downgrade = [
        node
        for node in module.body
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade"
    ]
    in_downgrade = {id(n) for d in downgrade for n in ast.walk(d)}
    executes = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and id(node) not in in_downgrade
    ]
    assert len(executes) == 1, f"op.execute outside downgrade(), at lines {executes}"
    call = calls[0]
    assert call.sql is not None, "the execute argument is one static literal"
    assert call.in_autocommit_block, "CONCURRENTLY cannot run in a transaction"
    create = re.sub(r"\s+", " ", call.sql).strip().upper()
    assert create.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), create
    binds = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.Attribute) and node.attr == "get_bind"
    ]
    assert not binds, f"get_bind anywhere in the revision, at lines {binds}"


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)
def test_repo_branches_repo_pr_idx_01_serves_the_pr_reads() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "repo_branches_repo_pr_idx_test") as (
        engine,
        url,
    ):
        # 2. Parent revision: no index yet. Seed so the build runs over rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        _seed(engine)
        rows = _row_count(engine)

        # Before: the per-citation probe can narrow only by `repo` (the primary key's
        # prefix), so it reads every row of the repo. Measured for comparison below.
        targets = {"repos": [_HOT_REPO] * 3, "prs": [7, 1201, 2499]}
        buffers_before = _top_buffers(
            _explain(engine, _REALIZATIONS_LATERAL, targets, analyze=True)
        )

        # 3. Apply: valid, and exactly the definition the reads rely on.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert index_state(engine, _INDEX_NAME)[0], (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run; existence is not enough"
        )
        assert index_definition(engine, _INDEX_NAME) == _EXPECTED_DEFINITION
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.repo_branches"))

        # 4. Every consumer's read shape rides it, as a generic plan where coord binds.
        for name, sql, types, args in (
            (
                "FRESHEST_PR_BRANCH_ROW_SQL",
                _FRESHEST,
                "text, int",
                f"'{_HOT_REPO}', 1201",
            ),
            ("author_feedback", _AUTHOR_FEEDBACK, "text, int", f"'{_HOT_REPO}', 1201"),
            (
                "land_status Query A",
                _LAND_STATUS_A,
                "text, int[]",
                f"'{_HOT_REPO}', ARRAY[7, 51, 1201, 2499]",
            ),
        ):
            plan = _explain_generic(engine, sql, types, args, analyze=True)
            assert _INDEX_NAME in plan, f"{name} must plan on the index:\n{plan}"
            buffers = _top_buffers(plan)
            assert buffers < 40, (
                f"{name} touched {buffers} buffers: not index-bounded:\n{plan}"
            )

        # The realizations row source as a per-citation LATERAL probe rides it, both
        # halves' anti-joins included, and its cost is a few pages per citation.
        plan = _explain(engine, _REALIZATIONS_LATERAL, targets, analyze=True)
        assert plan.count(_INDEX_NAME) >= 2, (
            f"the live half and the archive half's anti-join must both probe the "
            f"index:\n{plan}"
        )
        buffers = _top_buffers(plan)
        assert buffers < 20 * len(targets["prs"]), (
            f"{buffers} buffers for {len(targets['prs'])} citations: the LATERAL "
            f"probe is not index-bounded:\n{plan}"
        )
        assert buffers * 5 < buffers_before, (
            f"{buffers} buffers with the index against {buffers_before} without it: "
            f"the index is not what makes the probe cheap:\n{plan}"
        )
        # Not asserted, recorded: on PostgreSQL 16 the plain LEFT JOIN coord sends
        # today (`_REALIZATIONS_JOIN`) stays a hash join over a sequential scan of the
        # live half, because a join clause is not pushed into a UNION ALL member that
        # carries its own anti-join. That is the case the plan's coord half switches
        # to the LATERAL shape for, after reading EXPLAIN on production.

        # 5. Sensitivity: a read with no pr_number clause cannot prove the predicate.
        plan = _plan_with_no_alternative(engine, _REPO_ONLY, {"repo": _HOT_REPO})
        assert _INDEX_NAME not in plan, (
            f"a read with no pr_number clause must NOT match this partial index:\n{plan}"
        )

        # 6. A re-run leaves the VALID index untouched...
        oid_before = index_oid(engine, _INDEX_NAME)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_state(engine, _INDEX_NAME)[0], "a re-run must leave a VALID index"
        assert index_oid(engine, _INDEX_NAME) == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # ...and keeps an INVALID one, reporting success, which is why the docstring
        # tells a reader to check `indisvalid` after the deploy. Marking the index
        # INVALID takes a superuser, which CI's database role is; elsewhere this step is
        # skipped and the rest still runs.
        if is_superuser(engine):
            invalidate_index(engine, _INDEX_NAME)
            run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
            run_alembic(root, url, "upgrade", _REVISION_ID)
            assert not index_state(engine, _INDEX_NAME)[0], (
                "IF NOT EXISTS keeps an INVALID index and the upgrade reports success: "
                "the post-deploy indisvalid read is the only thing that sees this"
            )
        else:
            warnings.warn(
                "not a superuser: the INVALID-index half of assertion 6 did not run",
                stacklevel=1,
            )

        # 7. Downgrade removes the index; every row survives. Re-upgrade works.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _row_count(engine) == rows, "downgrade must not touch a row"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_state(engine, _INDEX_NAME)[0], "re-applied index must be VALID"
