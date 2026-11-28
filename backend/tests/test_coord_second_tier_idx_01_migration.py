"""Behaviour test for the ``coord_second_tier_idx_01`` revision.

The revision adds three indexes for coord reads in the database's second load tier
(plan ``2026-11-27-coord-second-tier-db-load-consumers-have-no-owner``, Phase 2):

- rank 7, ``idx_pr_events_coord_land_repo_created``: coord's "last coord land" reads;
- rank 9, ``idx_pr_check_runs_repo_updated_details``: ``latest_details_url``;
- rank 10, ``idx_error_observations_surface_fp_window``: ``first_seen_by_fingerprint``.

What is asserted
================

1. The upgrade path is what coord's merge classifier auto-lands: three static
   ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literals in an autocommit block, no
   helper, no ``get_bind``. The downgrade drops all three ``CONCURRENTLY IF EXISTS``,
   in reverse order.
2. **Rank 7's predicate is coord's ``COORD_LAND_EVENT_WHERE`` verbatim.** A partial
   index serves a read only while the read can prove its predicate, so this reddens
   if the revision's side drifts from the literal copy of coord's constant below.
3. Nothing exists at the parent revision; after upgrade each index exists, is
   **``indisvalid``**, and is exactly the intended definition (columns, order,
   predicate) as Postgres renders it.
4. **A representative probe of each read plans on its index**: rank 7 as coord sends
   it today, rank 9 with the gate name inlined as a literal (Phase 3's shape), rank 10
   as the per-fingerprint ``LATERAL`` over ``unnest`` (Phase 3's shape).
5. **Sensitivity**: a rank-7 read carrying another ``source`` and a rank-9 read
   excluding another check name cannot use their partial indexes, so assertion 4 is
   measuring the predicates.

"Plans on" and "cannot use" are asserted with every other droppable index on the table
gone and sequential scans priced out, inside a rolled-back transaction: on tables this
small plain ``EXPLAIN`` would stay off an index on cost alone, whatever its definition.

6. A re-run leaves each VALID index alone (same oid).
7. Downgrade removes all three and leaves every row; a second upgrade re-applies.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it at a
non-default host:port).
"""

from __future__ import annotations

import ast
import re
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_definition,
    index_exists,
    index_oid,
    index_state,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_second_tier_idx_01"
_REVISION_FILENAME = "coord_second_tier_idx_01_land_check_errobs_indexes.py"
_REVISION_PATH = backend_root() / "alembic" / "versions" / _REVISION_FILENAME

_LAND_INDEX = "idx_pr_events_coord_land_repo_created"
_CHECK_INDEX = "idx_pr_check_runs_repo_updated_details"
_ERROBS_INDEX = "idx_error_observations_surface_fp_window"
_INDEXES = (_LAND_INDEX, _CHECK_INDEX, _ERROBS_INDEX)

# coord's `COORD_LAND_EVENT_WHERE` (crates/coord/src/land_status.rs), copied verbatim
# on purpose: the index serves coord's two last-land reads only while the two match.
_COORD_LAND_EVENT_WHERE = (
    "event_kind = 'state_change' AND state = 'MERGED' AND "
    "COALESCE(payload->>'source','coord_land') = 'coord_land'"
)
# coord's `CHECK_RUN_NAME` (crates/coord/src/github_checks.rs).
_CHECK_RUN_NAME = "Qontinui merge gate"

_EXPECTED_DEFINITIONS = {
    _LAND_INDEX: (
        f"CREATE INDEX {_LAND_INDEX} ON coord.pr_events USING btree "
        "(repo, created_at DESC) "
        "WHERE ((event_kind = 'state_change'::text) AND (state = 'MERGED'::text) AND "
        "(COALESCE((payload ->> 'source'::text), 'coord_land'::text) = "
        "'coord_land'::text))"
    ),
    _CHECK_INDEX: (
        f"CREATE INDEX {_CHECK_INDEX} ON coord.pr_check_runs USING btree "
        "(repo, updated_at DESC) "
        "WHERE ((details_url IS NOT NULL) AND "
        f"(name IS DISTINCT FROM '{_CHECK_RUN_NAME}'::text))"
    ),
    _ERROBS_INDEX: (
        f"CREATE INDEX {_ERROBS_INDEX} ON coord.error_observations USING btree "
        "(surface, fingerprint, window_start)"
    ),
}

_REPO = "o/second-tier-idx"

# Rank 7, as coord's `last_coord_land_at_for_repo_sql` sends its pr_events arm.
_RANK7_PROBE = (
    "SELECT MAX(created_at) FROM coord.pr_events "
    f"WHERE repo = :repo AND {_COORD_LAND_EVENT_WHERE}"
)
# Rank 9, with `CHECK_RUN_NAME` inlined as a literal (Phase 3's shape).
_RANK9_PROBE = (
    "SELECT details_url FROM coord.pr_check_runs "
    "WHERE repo = 'x' AND details_url IS NOT NULL "
    f"AND name IS DISTINCT FROM '{_CHECK_RUN_NAME}' "
    "ORDER BY updated_at DESC LIMIT 1"
)
# Rank 10, as the per-fingerprint LATERAL probe Phase 3 ships.
_RANK10_PROBE = (
    "SELECT f, (SELECT window_start FROM coord.error_observations "
    "WHERE surface = 'x' AND fingerprint = f ORDER BY window_start LIMIT 1) "
    "FROM unnest(ARRAY['a','b']) f"
)

_PROBES: tuple[tuple[str, str, str, dict[str, Any]], ...] = (
    ("coord.pr_events", _LAND_INDEX, _RANK7_PROBE, {"repo": _REPO}),
    ("coord.pr_check_runs", _CHECK_INDEX, _RANK9_PROBE, {}),
    ("coord.error_observations", _ERROBS_INDEX, _RANK10_PROBE, {}),
)


def _collapse(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def test_the_upgrade_path_is_classifier_safe() -> None:
    """Three static CONCURRENTLY literals in an autocommit block, and nothing else."""
    calls = upgrade_execute_calls(_REVISION_PATH)
    assert len(calls) == 3, "three CREATE INDEX statements, nothing else on upgrade"
    for call in calls:
        assert call.sql is not None, "each execute argument is one static literal"
        assert call.in_autocommit_block, "CONCURRENTLY cannot run in a transaction"
        create = _collapse(call.sql).upper()
        assert create.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), create
    created = [_collapse(c.sql or "").split()[6] for c in calls]
    assert created == list(_INDEXES), created

    module = ast.parse(_REVISION_PATH.read_text(encoding="utf-8"))
    functions = {
        n.name
        for n in module.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert functions == {"upgrade", "downgrade"}, (
        f"a module-level helper is read by the classifier as well: {sorted(functions)}"
    )
    assert not any(isinstance(n, ast.Lambda) for n in ast.walk(module))
    binds = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.Attribute) and node.attr == "get_bind"
    ]
    assert not binds, f"get_bind anywhere in the revision, at lines {binds}"


def test_the_downgrade_drops_each_index_concurrently_in_reverse_order() -> None:
    calls = upgrade_execute_calls(_REVISION_PATH, function="downgrade")
    assert all(c.in_autocommit_block for c in calls)
    drops = [_collapse(c.sql or "") for c in calls]
    assert drops == [
        f"DROP INDEX CONCURRENTLY IF EXISTS coord.{name}" for name in reversed(_INDEXES)
    ], drops


def test_the_revision_chains_onto_one_parent() -> None:
    source = _REVISION_PATH.read_text(encoding="utf-8")
    assert re.search(rf'^revision: str = "{_REVISION_ID}"$', source, re.M)
    declared_parent_revision_id(source, _REVISION_FILENAME)


def test_rank7_predicate_is_coords_land_constant_verbatim() -> None:
    """The partial predicate must be ``COORD_LAND_EVENT_WHERE`` and nothing more."""
    land = next(
        _collapse(c.sql or "")
        for c in upgrade_execute_calls(_REVISION_PATH)
        if _LAND_INDEX in (c.sql or "")
    )
    _, _, predicate = land.partition(" WHERE ")
    assert predicate == _COORD_LAND_EVENT_WHERE, (
        f"rank 7's predicate drifted from coord's COORD_LAND_EVENT_WHERE:\n"
        f"  revision: {predicate}\n  coord:    {_COORD_LAND_EVENT_WHERE}"
    )
    assert land.endswith(
        f"ON coord.pr_events (repo, created_at DESC) WHERE {predicate}"
    )


def test_rank9_predicate_excludes_coords_gate_row_by_literal() -> None:
    check = next(
        _collapse(c.sql or "")
        for c in upgrade_execute_calls(_REVISION_PATH)
        if _CHECK_INDEX in (c.sql or "")
    )
    assert check.endswith(
        "ON coord.pr_check_runs (repo, updated_at DESC) "
        f"WHERE details_url IS NOT NULL AND name IS DISTINCT FROM '{_CHECK_RUN_NAME}'"
    ), check


def _seed(engine: Engine) -> None:
    """A few rows on each table, so the builds run over data."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events
                    (repo, pr_number, event_kind, state, payload, created_at)
                SELECT CASE WHEN k % 3 = 0 THEN :repo ELSE 'o/other' END, k,
                       CASE WHEN k % 2 = 0 THEN 'state_change' ELSE 'ingest' END,
                       CASE WHEN k % 4 = 0 THEN 'MERGED' ELSE 'OPEN' END,
                       CASE WHEN k % 5 = 0
                            THEN jsonb_build_object('source', 'github_merge')
                            ELSE '{}'::jsonb END,
                       now() - make_interval(mins => k)
                  FROM generate_series(1, 2000) AS k
                """
            ),
            {"repo": _REPO},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_check_runs
                    (repo, head_sha, check_id, name, status, details_url, updated_at)
                SELECT CASE WHEN k % 2 = 0 THEN 'x' ELSE 'y' END, 'sha-' || k, k,
                       CASE WHEN k % 7 = 0 THEN :gate ELSE 'ci / test' END,
                       'completed',
                       CASE WHEN k % 3 = 0 THEN NULL
                            ELSE 'https://example.invalid/' || k END,
                       now() - make_interval(mins => k)
                  FROM generate_series(1, 2000) AS k
                """
            ),
            {"gate": _CHECK_RUN_NAME},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.error_observations
                    (window_start, window_end, surface, fingerprint, count,
                     provenance)
                SELECT now() - make_interval(mins => k * 5),
                       now() - make_interval(mins => k * 5 - 5),
                       CASE WHEN k % 2 = 0 THEN 'x' ELSE 'web' END,
                       chr(97 + (k % 6)), 1, 'test'
                  FROM generate_series(1, 2000) AS k
                """
            )
        )


def _analyze(engine: Engine) -> None:
    with engine.begin() as conn:
        for table in ("pr_events", "pr_check_runs", "error_observations"):
            conn.execute(text(f"ANALYZE coord.{table}"))


def _plan_with_no_alternative(
    engine: Engine, table: str, index: str, sql: str, params: dict[str, Any]
) -> str:
    """The plan of a read when ``index`` is the only useful path the planner has.

    Every other droppable index on ``table`` goes, inside a transaction that is rolled
    back, and a sequential scan is priced out. If the partial predicate can be proved
    from the read's clauses the plan names the index; if it cannot, no cost can make it.
    """
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            others = conn.execute(
                text(
                    """
                    SELECT i.indexrelid::regclass::text
                      FROM pg_index i
                     WHERE i.indrelid = CAST(:tbl AS regclass)
                       AND i.indexrelid <> CAST(:idx AS regclass)
                       AND NOT EXISTS (
                           SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
                    """
                ),
                {"tbl": table, "idx": f"coord.{index}"},
            ).scalars()
            for name in list(others):
                conn.execute(text(f"DROP INDEX {name}"))
            conn.execute(text("SET LOCAL enable_seqscan = off"))
            rows = conn.execute(text(f"EXPLAIN {sql}"), params).all()
            return "\n".join(str(r[0]) for r in rows)
        finally:
            tx.rollback()


def _row_counts(engine: Engine) -> tuple[int, int, int]:
    with engine.connect() as conn:
        counts = [
            int(conn.execute(text(f"SELECT count(*) FROM coord.{t}")).scalar_one())
            for t in ("pr_events", "pr_check_runs", "error_observations")
        ]
    return counts[0], counts[1], counts[2]


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)
def test_coord_second_tier_idx_01_serves_the_three_reads() -> None:
    root = backend_root()
    parent = declared_parent_revision_id(
        _REVISION_PATH.read_text(encoding="utf-8"), _REVISION_FILENAME
    )

    with ephemeral_database(admin_database_url(), "coord_second_tier_idx_test") as (
        engine,
        url,
    ):
        # 3. Parent revision: no index yet. Seed so the builds run over rows.
        run_alembic(root, url, "upgrade", parent)
        for name in _INDEXES:
            assert not index_exists(engine, name), name
        _seed(engine)
        rows = _row_counts(engine)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        for name in _INDEXES:
            assert index_exists(engine, name), name
            valid, unique, _ = index_state(engine, name)
            assert valid, (
                f"{name}: a killed CONCURRENTLY build leaves an INVALID index that "
                "IF NOT EXISTS would skip on re-run; existence is not enough"
            )
            assert not unique, name
            assert index_definition(engine, name) == _EXPECTED_DEFINITIONS[name]
        _analyze(engine)

        # 4. Each representative probe plans on its index.
        for table, index, probe, params in _PROBES:
            plan = _plan_with_no_alternative(engine, table, index, probe, params)
            assert index in plan, f"{index} must serve:\n{probe}\n{plan}"

        # 5. Sensitivity: the partial predicates are what is being proved.
        other_source = _RANK7_PROBE.replace(
            "'coord_land') = 'coord_land'", "'coord_land') = 'github_merge'"
        )
        assert other_source != _RANK7_PROBE
        plan = _plan_with_no_alternative(
            engine, "coord.pr_events", _LAND_INDEX, other_source, {"repo": _REPO}
        )
        assert _LAND_INDEX not in plan, (
            f"a read of another land source must NOT match the partial index:\n{plan}"
        )
        other_name = _RANK9_PROBE.replace(_CHECK_RUN_NAME, "some other check")
        plan = _plan_with_no_alternative(
            engine, "coord.pr_check_runs", _CHECK_INDEX, other_name, {}
        )
        assert _CHECK_INDEX not in plan, (
            f"a read excluding another check name must NOT match the index:\n{plan}"
        )

        # 6. A re-run leaves each VALID index untouched.
        oids = {name: index_oid(engine, name) for name in _INDEXES}
        run_alembic(root, url, "stamp", parent)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for name in _INDEXES:
            assert index_oid(engine, name) == oids[name], (
                f"{name}: a re-run must leave a VALID index untouched"
            )

        # 7. Downgrade removes all three; every row survives. Re-upgrade works.
        run_alembic(root, url, "downgrade", parent)
        for name in _INDEXES:
            assert not index_exists(engine, name), name
        assert _row_counts(engine) == rows, "downgrade must not touch a row"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for name in _INDEXES:
            assert index_state(engine, name)[0], f"re-applied {name} must be VALID"
