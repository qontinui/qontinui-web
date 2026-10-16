"""Behaviour test for the ``route_serving_method_idx_01`` revision.

The revision creates, ``CONCURRENTLY``::

    idx_route_serving_observations_host_path_method_observed
        ON coord.route_serving_observations
        (host, route_path, method, observed_at DESC)

plus a ``COMMENT ON INDEX`` naming the plan and phase it serves.

Always run, with no database:

* the ``_PARENT_REVISION_ID`` pin and the one-line ``down_revision`` spelling
  coord's line-scoped graph parser needs;
* the upgrade path, as coord's migration classifier sees it: every
  ``op.execute`` argument is one static literal and sits inside an
  autocommit block, the build is ``CONCURRENTLY IF NOT EXISTS``, and there is no
  ``DROP``, no DML and no read through ``op.get_bind()``. Those are NECESSARY
  conditions for the AutoSafe classification the revision claims.

Against an ephemeral Postgres (skipped when none is reachable):

1. the index does not exist at the parent;
2. after upgrade it exists, is ``indisvalid``, has exactly the intended
   definition and carries its comment;
3. the Phase 4 per-``(route_path, method)`` latest reader is served by it with
   no full ``Sort`` node, and returns the newest row of each method, the NULL
   (pre-Phase-4) method included as its own key;
4. the widened ``table_retention`` guard's ``GROUP BY host, route_path,
   method`` aggregate is served by it with no full ``Sort`` node;
5. downgrade removes exactly this index (the parent's index set returns, every
   row survives), and a second upgrade re-applies cleanly.

``enable_seqscan`` / ``enable_bitmapscan`` are turned off for the plan
assertions: the fixture is small, so a sequential scan wins on cost whatever the
index. Turning them off leaves the one question being asked, which is whether
the index CAN supply the read's order. The ``coord_iops_idx_01`` test documents
the same choice.
"""

from __future__ import annotations

import ast
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "route_serving_method_idx_01"
_PARENT_REVISION_ID = "coord_pr_holds_01"
_REVISION_FILENAME = "route_serving_method_idx_01_host_path_method_observed.py"

_INDEX = "idx_route_serving_observations_host_path_method_observed"
_TABLE = "route_serving_observations"
_EXPECTED_INDEXDEF = (
    f"CREATE INDEX {_INDEX} ON coord.{_TABLE} "
    "USING btree (host, route_path, method, observed_at DESC)"
)

_HOST = "api.qontinui.io"
_OTHER_HOST = "coord.qontinui.io"

# The Phase 4 latest reader: newest row per (route_path, method) of one host.
_LATEST_PER_METHOD_SQL = """
    SELECT DISTINCT ON (route_path, method) route_path, method, drift_class
      FROM coord.route_serving_observations
     WHERE host = :host
     ORDER BY route_path, method, observed_at DESC
"""

# The derived table of the widened table_retention guard (its aggregate
# rendering, qontinui-coord ``table_retention.rs``), keyed on the full triple.
_GUARD_AGGREGATE_SQL = """
    SELECT host AS k1, route_path AS k2, method AS k3, max(observed_at) AS mx
      FROM coord.route_serving_observations
     GROUP BY host, route_path, method
"""

_FULL_SORT_NODE = re.compile(r"(?:^|->)\s*Sort\s+\(")


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _upgrade_source() -> str:
    """The body of ``upgrade()`` only, so the docstring and downgrade are out."""
    src = _revision_source()
    tree = ast.parse(src)
    (fn,) = [
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    ]
    segment = ast.get_source_segment(src, fn)
    assert segment is not None
    return segment


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_down_revision_is_on_one_line() -> None:
    """coord parses ``down_revision`` line by line (``enrichment.rs``)."""
    assert re.search(
        r'^down_revision[^=\n]*=\s*["\'][^"\'\n]+["\']\s*$',
        _revision_source(),
        re.MULTILINE,
    ), "down_revision must be a single-line string literal for coord's parser"


def test_the_upgrade_path_is_classifier_safe() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert len(calls) == 2, "one CREATE INDEX and one COMMENT ON INDEX"
    for call in calls:
        assert call.sql is not None, "every execute argument is one static literal"
        assert call.in_autocommit_block, (
            "every upgrade statement sits inside the autocommit block"
        )
    create = re.sub(r"\s+", " ", calls[0].sql or "").strip().upper()
    assert create.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), (
        "coord's classifier rejects a non-concurrent or unguarded index build"
    )
    assert (
        f"ON COORD.{_TABLE.upper()} ( HOST, ROUTE_PATH, METHOD, OBSERVED_AT DESC )"
        in create
    )
    comment = re.sub(r"\s+", " ", calls[1].sql or "").strip().upper()
    assert comment.startswith(f"COMMENT ON INDEX COORD.{_INDEX.upper()} IS '")

    body = _upgrade_source()
    ddl = re.sub(r"COMMENT ON .*? IS\s+'[^']*'", "", body, flags=re.DOTALL).upper()
    assert "DROP" not in ddl, "a DROP on the upgrade path makes coord Reject it"
    for dml in ("UPDATE ", "INSERT ", "DELETE "):
        assert dml not in ddl, f"the upgrade path must not run DML ({dml.strip()})"
    assert "GET_BIND" not in ddl, (
        "coord's classifier rejects a read through op.get_bind(); indisvalid is "
        "checked after the deploy instead (see the revision docstring)"
    )


def test_the_comment_names_the_plan_and_phase() -> None:
    body = comment_body_from_source(
        _revision_source(), f"coord.{_INDEX}", object_kind="INDEX"
    )
    assert "2026-09-25-route-serving-observer-probes-mutating-routes" in body
    assert "Phase 4" in body
    assert "table_retention" in body
    assert "'" not in body, "the body carries no apostrophe, so needs no escaping"


def _index_names(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'coord' AND tablename = :t"
            ),
            {"t": _TABLE},
        ).all()
    return {str(r[0]) for r in rows}


def _plan(engine: Engine, sql: str, params: dict[str, object] | None = None) -> str:
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        conn.execute(text("SET enable_bitmapscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}"), params or {}).all()
    return "\n".join(str(r[0]) for r in rows)


def _has_full_sort(plan: str) -> bool:
    return any(_FULL_SORT_NODE.search(line) for line in plan.splitlines())


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, bring up a backend Postgres before running this test."
    ),
)
def test_route_serving_method_idx_01_up_down_up() -> None:
    root = backend_root()
    t0 = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)

    with ephemeral_database(admin_database_url(), "route_serving_method_idx") as (
        engine,
        url,
    ):
        # 1. Parent: the index does not exist.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX)
        parent_indexes = _index_names(engine)

        # 2. Upgrade: valid, exact definition, commented.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        with engine.connect() as conn:
            indexdef, valid, comment = conn.execute(
                text(
                    "SELECT pg_get_indexdef(c.oid), i.indisvalid, "
                    "obj_description(c.oid, 'pg_class') "
                    "FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'coord' AND c.relname = :n"
                ),
                {"n": _INDEX},
            ).one()
        assert indexdef == _EXPECTED_INDEXDEF
        assert valid is True
        assert comment == comment_body_from_source(
            _revision_source(), f"coord.{_INDEX}", object_kind="INDEX"
        )

        # Seed AFTER the build: the index maintains itself, no REINDEX.
        insert = text(
            """
            INSERT INTO coord.route_serving_observations
                (host, route_path, method, drift_class, provenance, observed_at)
            VALUES (:host, :path, :method, :drift, 'test', :at)
            """
        )
        rows = [
            (_HOST, "/api/v1/a", None, "ok", t0),
            (_HOST, "/api/v1/a", None, "unknown", t0 + timedelta(minutes=5)),
            (_HOST, "/api/v1/a", "GET", "route_missing", t0),
            (_HOST, "/api/v1/a", "GET", "ok", t0 + timedelta(minutes=10)),
            (_HOST, "/api/v1/a", "POST", "shadow_route", t0 + timedelta(minutes=1)),
            (_HOST, "/api/v1/b", "GET", "divergent", t0 + timedelta(minutes=2)),
            (_OTHER_HOST, "/api/v1/a", "GET", "pending", t0 + timedelta(hours=1)),
        ]
        with engine.begin() as conn:
            for host, path, method, drift, at in rows:
                conn.execute(
                    insert,
                    {
                        "host": host,
                        "path": path,
                        "method": method,
                        "drift": drift,
                        "at": at,
                    },
                )

        # 3. The latest reader: served by the index, no full Sort, right rows.
        plan = _plan(engine, _LATEST_PER_METHOD_SQL, {"host": _HOST})
        assert _INDEX in plan, f"the latest reader must use the new index:\n{plan}"
        assert not _has_full_sort(plan), f"no full Sort node expected:\n{plan}"
        with engine.connect() as conn:
            latest = conn.execute(text(_LATEST_PER_METHOD_SQL), {"host": _HOST}).all()
        assert [tuple(r) for r in latest] == [
            ("/api/v1/a", "GET", "ok"),
            ("/api/v1/a", "POST", "shadow_route"),
            ("/api/v1/a", None, "unknown"),
            ("/api/v1/b", "GET", "divergent"),
        ], "the newest row of each (route_path, method), NULL as its own key"

        # 4. The widened retention guard's aggregate: presorted by the index.
        plan = _plan(engine, _GUARD_AGGREGATE_SQL)
        assert _INDEX in plan, f"the guard aggregate must use the new index:\n{plan}"
        assert not _has_full_sort(plan), f"no full Sort node expected:\n{plan}"

        # 5. Downgrade removes exactly this index; rows survive; re-upgrade.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _index_names(engine) == parent_indexes
        with engine.connect() as conn:
            kept = conn.execute(
                text("SELECT count(*) FROM coord.route_serving_observations")
            ).scalar_one()
        assert kept == len(rows), "downgrade must keep every observation row"

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX)
