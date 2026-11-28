"""Behaviour test for the ``pr_events_escalate_matched_idx_01`` revision.

The revision adds the partial index ``idx_pr_events_escalate_matched_repo_pr`` on
``coord.pr_events``. With it, the ``escalate_prs`` read of coord's
``stuck_pr_watcher`` detector 3 reads only the escalate-path-matched evaluations
instead of every ``predicate_eval`` row in history. The read is the first CTE of
``ESCALATE_BLOCKED_DWELL_SQL`` in ``crates/coord/src/stuck_pr_watcher.rs``. Plan
``2026-11-26-devops-stuck-pr-watcher-detector-3-query-hits-the-statement-timeout-every-tick``,
Phase 2a.

coord pins its side of the contract. Its
``hourly_detectors_2_3_4_9_never_take_a_fleet_wide_newest_event`` test fixes the
``escalate_prs`` text (``ESCALATE_PRS_READ``). This file pins the index's side
against a copy of that read, so if either side's literals change, a test goes
red.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` and ``down_revision`` match the pins below. The
   parent names exactly one real sibling, and the docstring's ``Revises:`` header
   agrees with the assignment.
2. **coord's merge classifier can auto-land the upgrade path.** It is one static
   ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literal in an autocommit block. It
   has no other ``op.*`` call, so no non-concurrent ``op.create_index``. It has no
   ``get_bind`` and no module-level helper. The downgrade is one ``DROP INDEX
   CONCURRENTLY IF EXISTS`` in an autocommit block. ``check_coord_column_drops``
   finds nothing.
3. **The partial predicate spells the literals of coord's ``escalate_prs``
   ``WHERE``.** The planner can use a partial index only when it can prove that
   the statement's ``WHERE`` implies the index's predicate.

Against a real Postgres (skipped when none is reachable):

4. Nothing exists at the parent revision.
5. After the upgrade the index exists, is **``indisvalid``**, and has exactly
   the intended definition, partial predicate included.
6. **coord's ``escalate_prs`` read is an ``Index Only Scan`` of it.** This is
   the shape the plan's post-deploy ``EXPLAIN`` must show in production.
7. **The index is what makes the read cheap.** The seed buries 600 escalate
   rows among 60,000 ``predicate_eval`` rows. With the index the read costs a
   handful of buffers. At the parent revision it costs many times more: it scans
   every entry of ``idx_pr_events_tenant_reason_created`` and then fetches each
   match from the heap, as production does. The cost no longer grows with the
   evaluation history, which is the defect the plan exists for.
8. **The whole detector-3 statement rides it,** under both a custom plan and a
   generic plan. The statement is the one coord sends today, at qontinui-coord
   ``4eb18740c``. It returns the seeded answer, so the plans are measured over
   rows it actually returns. That the statement's other filters are right is
   coord's own test (``detector_3_skips_twin_terminal_prs``), not this file's.
9. **The predicate is load-bearing.** Each of the following is checked with
   every other droppable index gone (constraint-backed ones, such as the
   primary key, stay) and sequential scans priced out, so "cannot use" means
   the predicate cannot be proved:

   - The same read with another block code cannot use the index.
   - The code bound as a parameter cannot use it under a generic plan, and can
     under a custom one. That is the shape of
     ``escalate_evidence_watch::window_clearances``, which the revision's
     docstring says may also move onto the index. It also shows the instrument
     can tell "cannot" from "did not".

10. **A re-run leaves a VALID index alone (same oid), and keeps an INVALID one.**
    The revision carries no in-migration repair, so this pins what its docstring
    tells a reader to check after the deploy.
11. Downgrade removes only this index and leaves every row. A second upgrade
    re-applies it.

The substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ``QONTINUI_TEST_PG`` (host:port)
or ``QONTINUI_TEST_PG_DSN`` points it at a non-default instance.
"""

from __future__ import annotations

import ast
import re
import sys
import warnings
from pathlib import Path
from types import ModuleType
from typing import cast
from uuid import uuid4

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
    load_revision_module,
    run_alembic,
    scalar,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "pr_events_escalate_matched_idx_01"
_PARENT_REVISION_ID = "overview_07_schedule_last_known"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_INDEX_NAME = "idx_pr_events_escalate_matched_repo_pr"

_REPO = "o/escalate-idx-test"
_ESCALATE = "escalate-path-matched"

_EXPECTED_DEFINITION = (
    f"CREATE INDEX {_INDEX_NAME} ON coord.pr_events USING btree "
    "(repo, pr_number) "
    "WHERE ((event_kind = 'predicate_eval'::text) AND "
    "((payload ->> 'block_reason_code'::text) = 'escalate-path-matched'::text))"
)

# The `escalate_prs` CTE of `ESCALATE_BLOCKED_DWELL_SQL` in coord's
# `stuck_pr_watcher.rs` (qontinui-coord `4eb18740c`), as coord spells it. This is
# a literal copy on purpose. The index serves coord only while the two match, and
# this copy is what goes red if the revision's side moves.
_ESCALATE_PRS_READ = (
    "SELECT DISTINCT repo, pr_number "
    "FROM coord.pr_events "
    "WHERE event_kind = 'predicate_eval' "
    "AND payload->>'block_reason_code' = 'escalate-path-matched'"
)

# The read's WHERE, for the no-database check.
_COORD_PREDICATE = _ESCALATE_PRS_READ.split(" WHERE ", 1)[1]

# The same read with the code bound, as `window_clearances` binds it.
_ESCALATE_PRS_BOUND_READ = _ESCALATE_PRS_READ.replace(f"= '{_ESCALATE}'", "= $1")
assert "$1" in _ESCALATE_PRS_BOUND_READ, "the bound variant lost its `$1`"

# The same read with another code, which the index must not serve.
_OTHER_CODE_READ = _ESCALATE_PRS_READ.replace(_ESCALATE, "ci-not-green")
assert "ci-not-green" in _OTHER_CODE_READ

# The whole of `ESCALATE_BLOCKED_DWELL_SQL` at qontinui-coord `4eb18740c`, with
# `pr_not_terminal_in_twin_sql!("ls")` expanded. coord binds `$1` to the dwell in
# seconds, as text. Phase 2b rewrites everything after `escalate_prs` and leaves
# `escalate_prs` unchanged. Assertion 8 asks only that this statement's
# `escalate_prs` scan uses the index.
_ESCALATE_BLOCKED_DWELL_SQL = (
    f"WITH escalate_prs AS ( {_ESCALATE_PRS_READ} ), "
    "latest_state AS ( "
    "SELECT p.repo, p.pr_number, s.state, s.tenant_id, s.created_at "
    "FROM escalate_prs p "
    "JOIN LATERAL ( "
    "SELECT e.state, e.tenant_id, e.created_at "
    "FROM coord.pr_events e "
    "WHERE e.repo = p.repo AND e.pr_number = p.pr_number "
    "AND e.event_kind = 'state_change' "
    "ORDER BY e.created_at DESC "
    "LIMIT 1 "
    ") s ON TRUE "
    ") "
    "SELECT ls.repo, ls.pr_number, ls.tenant_id, le.category, le.detail, "
    "EXTRACT(EPOCH FROM (NOW() - ls.created_at))::BIGINT AS dwell_secs, "
    "le.class_detail "
    "FROM latest_state ls "
    "JOIN LATERAL ( "
    "SELECT e.payload->>'block_reason_code' AS code, "
    "e.payload->'detail'->>'category' AS category, "
    "e.payload->'detail'->>'detail' AS detail, "
    "jsonb_build_object( "
    "'category', e.payload->'detail'->'category', "
    "'path', e.payload->'detail'->'path', "
    "'disposition', e.payload->'detail'->'disposition', "
    "'migration_block', e.payload->'detail'->'migration_block' "
    ") AS class_detail "
    "FROM coord.pr_events e "
    "WHERE e.repo = ls.repo AND e.pr_number = ls.pr_number "
    "AND e.event_kind = 'predicate_eval' "
    "ORDER BY e.created_at DESC "
    "LIMIT 1 "
    ") le ON TRUE "
    "WHERE ls.state = 'BLOCKED' "
    "AND le.code = 'escalate-path-matched' "
    "AND ls.created_at < NOW() - ($1 || ' seconds')::interval "
    "AND NOT EXISTS ( "
    "SELECT 1 FROM coord.pr_events e2 "
    "WHERE e2.repo = ls.repo "
    "AND e2.pr_number = ls.pr_number "
    "AND e2.created_at > ls.created_at "
    "AND e2.event_kind IN ( "
    "'author_override_reevaluate', 'state_change' "
    ") "
    ") "
    "AND NOT EXISTS (SELECT 1 FROM coord.repo_branches tw "
    "WHERE tw.repo = ls.repo AND tw.pr_number = ls.pr_number "
    "HAVING count(*) > 0 "
    "AND bool_and(COALESCE(tw.pr_state, '') IN ('closed', 'merged')))"
)

# `ESCALATE_BLOCKED_DWELL_SECS_DEFAULT` in coord, the value production binds.
_DWELL_SECS = "3600"

# Block codes coord writes on a predicate_eval row besides the escalate code.
_OTHER_CODES = ("ci-not-green", "layer-breach", "none", "main-red")

_MODES = ("force_custom_plan", "force_generic_plan")

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _squash(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


# ---------------------------------------------------------------------------
# 1-3. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None

    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_the_upgrade_and_downgrade_paths_are_classifier_safe() -> None:
    """coord's classifier rejects a non-concurrent ``CREATE INDEX``, a read
    through ``op.get_bind``, and a DROP on the upgrade path. A Reject parks the PR
    on its author. A killed build leaves an INVALID index that the revision
    deliberately does not repair, because that repair is a read plus a DROP.
    """
    path = _revision_path()
    module = ast.parse(_revision_source())
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
    binds = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.Attribute) and node.attr == "get_bind"
    ]
    assert not binds, f"get_bind anywhere in the revision, at lines {binds}"
    # Only `op.get_context()` and `op.execute(...)`. An added `op.create_index` (a
    # non-concurrent build) or `op.drop_index` is not an `op.execute`, and would
    # otherwise slip past the count below.
    op_calls = sorted(
        {
            node.attr
            for node in ast.walk(module)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "op"
        }
    )
    assert op_calls == ["execute", "get_context"], f"op.* calls: {op_calls}"

    up = upgrade_execute_calls(path)
    assert len(up) == 1, "one CREATE INDEX, and nothing else on the upgrade path"
    assert up[0].sql is not None, "the execute argument is one static literal"
    assert up[0].in_autocommit_block, "CONCURRENTLY cannot run in a transaction"
    create = _squash(up[0].sql).upper()
    assert create.startswith(
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX_NAME.upper()} "
        "ON COORD.PR_EVENTS "
    ), create
    assert "DROP" not in create, create

    down = upgrade_execute_calls(path, function="downgrade")
    assert len(down) == 1
    assert down[0].sql is not None
    assert down[0].in_autocommit_block, (
        "DROP ... CONCURRENTLY cannot run in a transaction"
    )
    assert _squash(down[0].sql) == (
        f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_INDEX_NAME}"
    ), "a plain DROP INDEX takes ACCESS EXCLUSIVE on a hot table"

    scan = guard.scan_source(_revision_source(), path)
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_the_partial_predicate_spells_coords_literals() -> None:
    """The index's WHERE is coord's ``escalate_prs`` WHERE.

    Postgres matches a partial index by proving implication from the query's
    clauses. A predicate that differs from the statement's (another literal, an
    added conjunct, a parameter) makes the index invisible to the read, with no
    error anywhere.
    """
    sql = upgrade_execute_calls(_revision_path())[0].sql
    assert sql is not None
    match = re.search(r"\bWHERE\b(.*)$", _squash(sql), re.S)
    assert match is not None, sql
    predicate = match.group(1).strip()
    assert predicate == _COORD_PREDICATE, (
        f"the index predicate {predicate!r} no longer matches coord's "
        f"escalate_prs WHERE {_COORD_PREDICATE!r}"
    )
    # The key is the read's projection. That is what lets the planner answer the
    # read from the index alone.
    key = re.search(r"\bON coord\.pr_events \(([^)]*)\)", _squash(sql))
    assert key is not None, sql
    assert key.group(1) == "repo, pr_number", key.group(1)


# ---------------------------------------------------------------------------
# 4-11. real Postgres
# ---------------------------------------------------------------------------


def _insert_tenants(engine: Engine, count: int) -> list[str]:
    tenants = [str(uuid4()) for _ in range(count)]
    with engine.begin() as conn:
        for tenant_id in tenants:
            conn.execute(
                text(
                    "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                    "VALUES (CAST(:t AS uuid), :slug, 'escalate idx test tenant')"
                ),
                {"t": tenant_id, "slug": f"escidx-{uuid4().hex[:8]}"},
            )
    return tenants


def _seed(engine: Engine) -> set[tuple[str, int]]:
    """An evaluation history shaped like production's, and the answer coord expects.

    The bulk is 300 PRs with 200 ``predicate_eval`` rows each, inserted in time
    order across three tenants, so each PR's rows are spread across the heap. On
    every third PR, six of its rows carry the escalate code: 600 rows among
    60,000, interleaved with the rest as production's are. Those PRs have no
    ``state_change``, so detector 3 reads them as candidates and drops them.

    Six PRs exercise the statement's other filters. Only 9001 (no twin row) and
    9002 (an open twin row) fire.
    """
    tenants = _insert_tenants(engine, 3)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events
                    (repo, pr_number, event_kind, payload, tenant_id, created_at)
                SELECT :repo, pr, 'predicate_eval',
                       jsonb_build_object(
                           'block_reason_code',
                           CASE WHEN pr % 3 = 0 AND k % 33 = 0 THEN :code
                                ELSE (CAST(:codes AS text[]))[1 + k % 4] END,
                           'detail', jsonb_build_object(
                               'note', 'filler-so-rows-are-realistically-wide')),
                       (CAST(:tenants AS uuid[]))[1 + pr % 3],
                       now() - make_interval(mins => k * 7)
                  FROM generate_series(1, 300) AS pr,
                       generate_series(1, 200) AS k
                 ORDER BY k DESC, pr
                """
            ),
            {
                "repo": _REPO,
                "code": _ESCALATE,
                "codes": list(_OTHER_CODES),
                "tenants": tenants,
            },
        )
        # The statement's own cases. Each blocked PR has an escalate evaluation
        # as its newest predicate_eval unless noted.
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events
                    (repo, pr_number, event_kind, state, payload, tenant_id,
                     created_at)
                VALUES
                  -- 9001: blocked 3 h, no twin row -> fires.
                  (:repo, 9001, 'state_change', 'BLOCKED', '{}'::jsonb,
                   CAST(:t AS uuid), now() - interval '3 hours'),
                  -- 9002: blocked 3 h, open twin row -> fires.
                  (:repo, 9002, 'state_change', 'BLOCKED', '{}'::jsonb,
                   CAST(:t AS uuid), now() - interval '3 hours'),
                  -- 9003: blocked 3 h, merged twin row -> dropped.
                  (:repo, 9003, 'state_change', 'BLOCKED', '{}'::jsonb,
                   CAST(:t AS uuid), now() - interval '3 hours'),
                  -- 9004: blocked 3 h, then an author re-evaluation -> dropped.
                  (:repo, 9004, 'state_change', 'BLOCKED', '{}'::jsonb,
                   CAST(:t AS uuid), now() - interval '3 hours'),
                  (:repo, 9004, 'author_override_reevaluate', NULL, '{}'::jsonb,
                   CAST(:t AS uuid), now() - interval '1 hour'),
                  -- 9005: blocked 10 min, under the dwell -> dropped.
                  (:repo, 9005, 'state_change', 'BLOCKED', '{}'::jsonb,
                   CAST(:t AS uuid), now() - interval '10 minutes'),
                  -- 9006: blocked 3 h, but the newest evaluation is another
                  -- code -> dropped.
                  (:repo, 9006, 'state_change', 'BLOCKED', '{}'::jsonb,
                   CAST(:t AS uuid), now() - interval '3 hours'),
                  (:repo, 9006, 'predicate_eval', NULL,
                   '{"block_reason_code": "ci-not-green"}'::jsonb,
                   CAST(:t AS uuid), now() - interval '30 minutes')
                """
            ),
            {"repo": _REPO, "t": tenants[0]},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events
                    (repo, pr_number, event_kind, payload, tenant_id, created_at)
                SELECT :repo, pr, 'predicate_eval',
                       jsonb_build_object(
                           'block_reason_code', :code,
                           'detail', jsonb_build_object(
                               'category', 'secrets', 'detail', 'touches .env')),
                       CAST(:t AS uuid), now() - interval '2 hours'
                  FROM generate_series(9001, 9006) AS pr
                """
            ),
            {"repo": _REPO, "code": _ESCALATE, "t": tenants[0]},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.repo_branches
                    (repo, branch, head_sha, pr_number, pr_state)
                VALUES (:repo, 'b-9002', 'sha-9002', 9002, 'open'),
                       (:repo, 'b-9003', 'sha-9003', 9003, 'merged')
                """
            ),
            {"repo": _REPO},
        )
    # Mark the heap all-visible so an index-only scan is a plan the planner can
    # price. This is a best case: coord.pr_events is not append-only (coord
    # UPDATEs a PR's newest predicate_eval row in place each tick, non-HOT), so
    # in production the live escalate rows' pages need heap fetches.
    _vacuum_analyze(engine)
    return {(_REPO, 9001), (_REPO, 9002)}


def _vacuum_analyze(engine: Engine) -> None:
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("VACUUM (ANALYZE) coord.pr_events"))
        conn.execute(text("ANALYZE coord.repo_branches"))


def _prepared(
    engine: Engine,
    *,
    sql: str,
    params: str | None,
    args: str | None,
    plan_cache_mode: str,
    explain: str | None,
    no_alternative: bool = False,
) -> list[tuple[object, ...]]:
    """Run ``sql`` as coord does, as a prepared statement, under ``plan_cache_mode``.

    ``explain`` is ``None`` to execute the statement, or the EXPLAIN options to
    plan it. With ``no_alternative``, every other droppable index on the table is
    dropped and sequential scans are priced out, inside a transaction that is
    rolled back. Then the plan names this index if the partial predicate can be
    proved from the statement's clauses, and no cost can make it name the index
    if it cannot.
    """
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.exec_driver_sql("DEALLOCATE ALL")
            if no_alternative:
                others = conn.execute(
                    text(
                        """
                        SELECT i.indexrelid::regclass::text
                          FROM pg_index i
                         WHERE i.indrelid = 'coord.pr_events'::regclass
                           AND i.indexrelid <> CAST(:idx AS regclass)
                           AND NOT EXISTS (
                               SELECT 1 FROM pg_constraint c
                                WHERE c.conindid = i.indexrelid)
                        """
                    ),
                    {"idx": f"coord.{_INDEX_NAME}"},
                ).scalars()
                for name in list(others):
                    conn.exec_driver_sql(f"DROP INDEX {name}")
                conn.exec_driver_sql("SET LOCAL enable_seqscan = off")
            conn.exec_driver_sql(f"SET LOCAL plan_cache_mode = {plan_cache_mode}")
            signature = f"({params})" if params is not None else ""
            conn.exec_driver_sql(f"PREPARE escalate_read{signature} AS {sql}")
            prefix = f"EXPLAIN ({explain}) " if explain is not None else ""
            arguments = f"({args})" if args is not None else ""
            rows = [
                tuple(r)
                for r in conn.exec_driver_sql(
                    f"{prefix}EXECUTE escalate_read{arguments}"
                ).all()
            ]
            conn.exec_driver_sql("DEALLOCATE escalate_read")
            return rows
        finally:
            tx.rollback()


def _plan(rows: list[tuple[object, ...]]) -> str:
    return "\n".join(str(r[0]) for r in rows)


def _top_buffers(plan: str) -> int:
    """The buffers the whole statement touched: the plan's first Buffers line."""
    first = re.search(r"Buffers: shared(?: hit=(\d+))?(?: read=(\d+))?", plan)
    assert first is not None, plan
    return int(first.group(1) or 0) + int(first.group(2) or 0)


def _escalate_read_cost(engine: Engine) -> tuple[int, str]:
    """Buffers, and the plan, of coord's ``escalate_prs`` read."""
    plan = _plan(
        _prepared(
            engine,
            sql=_ESCALATE_PRS_READ,
            params=None,
            args=None,
            plan_cache_mode="force_custom_plan",
            explain="ANALYZE, BUFFERS",
        )
    )
    return _top_buffers(plan), plan


def _forced_plan(
    engine: Engine,
    sql: str,
    *,
    mode: str = "force_custom_plan",
    params: str | None = None,
    args: str | None = None,
) -> str:
    return _plan(
        _prepared(
            engine,
            sql=sql,
            params=params,
            args=args,
            plan_cache_mode=mode,
            explain="COSTS OFF",
            no_alternative=True,
        )
    )


def _assert_shape(engine: Engine) -> None:
    valid, unique, _ = index_state(engine, _INDEX_NAME)
    assert valid, (
        "a killed CONCURRENTLY build leaves an INVALID index that "
        "IF NOT EXISTS would skip on re-run; existence is not enough"
    )
    assert not unique, "a PR is evaluated many times: the index must not be unique"
    assert index_definition(engine, _INDEX_NAME) == _EXPECTED_DEFINITION


def _pr_events_indexes(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'coord' AND tablename = 'pr_events'"
            )
        ).all()
    return {str(r[0]) for r in rows}


def _row_count(engine: Engine) -> int:
    return cast(int, scalar(engine, "SELECT count(*) FROM coord.pr_events"))


@_needs_pg
def test_pr_events_escalate_matched_idx_01_serves_detector_3() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "escalate_matched_idx_test") as (
        engine,
        url,
    ):
        # 4. Parent revision: no index yet. Seed so the build runs over rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        expected = _seed(engine)
        rows = _row_count(engine)

        # The read's cost before the index, for assertion 7.
        before, before_plan = _escalate_read_cost(engine)

        # 5. Apply: valid, and exactly the definition the read relies on.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        _assert_shape(engine)
        _vacuum_analyze(engine)

        # 6. coord's escalate_prs read is an index-only scan of it.
        after, plan = _escalate_read_cost(engine)
        assert f"Index Only Scan using {_INDEX_NAME}" in plan, (
            f"escalate_prs must be an Index Only Scan on the index:\n{plan}"
        )

        # 7. The index is what makes it cheap.
        assert after < 20, (
            f"{after} buffers for 600 escalate rows: the read still walks the "
            f"evaluation history:\n{plan}"
        )
        assert before > 10 * after, (
            f"{before} buffers at the parent against {after} with the index: the "
            f"seed no longer shows the walk the index removes:\n{before_plan}"
        )

        # 8. The whole detector-3 statement rides it, and returns the seeded
        #    answer, in both plan modes.
        for mode in _MODES:
            answer = {
                (cast(str, r[0]), cast(int, r[1]))
                for r in _prepared(
                    engine,
                    sql=_ESCALATE_BLOCKED_DWELL_SQL,
                    params="text",
                    args=f"'{_DWELL_SECS}'",
                    plan_cache_mode=mode,
                    explain=None,
                )
            }
            assert answer == expected, f"{mode}: {sorted(answer)}"
            plan = _plan(
                _prepared(
                    engine,
                    sql=_ESCALATE_BLOCKED_DWELL_SQL,
                    params="text",
                    args=f"'{_DWELL_SECS}'",
                    plan_cache_mode=mode,
                    explain="ANALYZE, BUFFERS",
                )
            )
            assert _INDEX_NAME in plan, (
                f"{mode}: detector 3's statement does not use the index:\n{plan}"
            )

        # 9. Sensitivity. The instrument sees the index when the read can use it...
        assert _INDEX_NAME in _forced_plan(engine, _ESCALATE_PRS_READ)
        # ...another code cannot use it...
        plan = _forced_plan(engine, _OTHER_CODE_READ)
        assert _INDEX_NAME not in plan, (
            f"another block code must NOT match this partial index:\n{plan}"
        )
        # ...and a bound code can use it only when its value is known at plan time.
        plan = _forced_plan(
            engine,
            _ESCALATE_PRS_BOUND_READ,
            mode="force_generic_plan",
            params="text",
            args=f"'{_ESCALATE}'",
        )
        assert _INDEX_NAME not in plan, (
            f"a bound code must NOT be provable under a generic plan:\n{plan}"
        )
        plan = _forced_plan(
            engine,
            _ESCALATE_PRS_BOUND_READ,
            mode="force_custom_plan",
            params="text",
            args=f"'{_ESCALATE}'",
        )
        assert _INDEX_NAME in plan, (
            f"a bound code known at plan time must be provable:\n{plan}"
        )

        # 10. A re-run leaves the VALID index untouched...
        oid_before = index_oid(engine, _INDEX_NAME)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert index_oid(engine, _INDEX_NAME) == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # ...and keeps an INVALID one while reporting success. That is why the
        # docstring tells a reader to check `indisvalid` after the deploy.
        # Marking the index INVALID needs a superuser. CI's database role is
        # one. Elsewhere this step is skipped and the rest still runs.
        if is_superuser(engine):
            invalidate_index(engine, _INDEX_NAME)
            run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
            run_alembic(root, url, "upgrade", _REVISION_ID)
            valid, _, _ = index_state(engine, _INDEX_NAME)
            assert not valid, (
                "IF NOT EXISTS keeps an INVALID index and the upgrade reports "
                "success: the post-deploy indisvalid read is the only thing that "
                "sees this"
            )
            # The recovery's SQL works: drop CONCURRENTLY, then the revision's
            # CREATE again (here by re-running the revision; in production the
            # docstring prescribes a follow-up revision carrying the same SQL).
            with engine.connect().execution_options(
                isolation_level="AUTOCOMMIT"
            ) as conn:
                conn.execute(text(f"DROP INDEX CONCURRENTLY coord.{_INDEX_NAME}"))
            run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
            run_alembic(root, url, "upgrade", _REVISION_ID)
            _assert_shape(engine)
        else:
            warnings.warn(
                "not a superuser: the INVALID-index half of assertion 10 did not run",
                stacklevel=1,
            )

        # 11. Downgrade drops only this index, and every row survives. Re-upgrade
        #     works.
        indexes = _pr_events_indexes(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _pr_events_indexes(engine) == indexes - {_INDEX_NAME}
        assert _row_count(engine) == rows, "downgrade must not touch a row"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
