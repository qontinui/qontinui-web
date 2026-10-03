"""Pins for alembic revision ``overview_07_costs_authoring``.

Plan ``2026-09-20-overview-authoring-layer`` Phase 5. What is pinned:

1. the graph stays ONE head and this revision is on its chain (never a
   literal ``down_revision``: the land-time re-point moves it);
2. the upgrade path is the shape coord's migration classifier admits
   (``qontinui-coord`` ``pr_merge/migration_classifier.rs``): every
   ``op.execute`` one static literal, the added column nullable with a
   constant default, ``CREATE TABLE IF NOT EXISTS``, every index
   ``CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block`` — and no DROP;
3. live: down → up → down → up leaves the exact shape, an existing cost entry
   reads version 1 without a backfill, a re-run of the upgrade over objects
   that already exist is a no-op, and the effort table's CHECKs refuse a
   half-written rate snapshot.

The live tests build the PARENT revision's tables from the ORM (just the
``overview`` tables this revision touches, plus what their keys reference)
and stamp it, so they run on a Postgres without pgvector; a separate test
walks the whole chain from base where pgvector is installed (CI), and says
why it skipped where it is not.
"""

from __future__ import annotations

import ast
import contextlib
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_REVISION = "overview_07_costs_authoring"
_PARENT = "overview_06_spend_connectors"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (conftest.py derives it from "
        "QONTINUI_TEST_PG=host:port)"
    ),
)


def _path() -> Path:
    return backend_root() / "alembic" / "versions" / f"{_REVISION}.py"


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_path().read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"no def {name}()")


def _execute_literals(fn: ast.FunctionDef) -> list[str]:
    out: list[str] = []
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
        ):
            assert len(node.args) == 1 and isinstance(node.args[0], ast.Constant), (
                f"op.execute at line {node.lineno} must take one static literal"
            )
            out.append(" ".join(str(node.args[0].value).split()))
    return out


# ---------------------------------------------------------------------------
# structural
# ---------------------------------------------------------------------------


def test_the_graph_has_one_head_and_this_revision_is_on_it() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(backend_root() / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root() / "alembic"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1, f"revision graph forked: {heads}"
    chain = {rev.revision for rev in script.iterate_revisions(heads[0], "base")}
    assert _REVISION in chain
    assert script.get_revision(_REVISION).down_revision is not None


def test_the_upgrade_path_is_the_shape_the_classifier_admits() -> None:
    statements = _execute_literals(_function("upgrade"))
    upper = [s.upper() for s in statements]
    assert not any("DROP" in s for s in upper)
    [add] = [s for s in upper if s.startswith("ALTER TABLE")]
    assert add == (
        "ALTER TABLE OVERVIEW.COST_ENTRIES ADD COLUMN IF NOT EXISTS VERSION "
        "INTEGER DEFAULT 1"
    )
    assert "NOT NULL" not in add
    [table] = [s for s in upper if s.startswith("CREATE TABLE")]
    assert table.startswith("CREATE TABLE IF NOT EXISTS OVERVIEW.EFFORT_ENTRIES")
    indexes = [s for s in upper if s.startswith("CREATE") and "INDEX" in s]
    assert len(indexes) == 5
    assert all("CONCURRENTLY IF NOT EXISTS" in s for s in indexes)
    # …and every one of them runs inside the autocommit block.
    inside: list[str] = []
    for node in ast.walk(_function("upgrade")):
        if isinstance(node, ast.With) and any(
            isinstance(item.context_expr, ast.Call)
            and isinstance(item.context_expr.func, ast.Attribute)
            and item.context_expr.func.attr == "autocommit_block"
            for item in node.items
        ):
            fn = ast.FunctionDef(
                name="block",
                args=ast.arguments(
                    posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]
                ),
                body=node.body,
                decorator_list=[],
                type_params=[],
            )
            inside.extend(s.upper() for s in _execute_literals(fn))
    assert sorted(inside) == sorted(indexes)


def test_the_downgrade_removes_exactly_what_the_upgrade_adds() -> None:
    statements = [s.upper() for s in _execute_literals(_function("downgrade"))]
    assert statements == [
        "DROP TABLE IF EXISTS OVERVIEW.EFFORT_ENTRIES",
        "DROP INDEX IF EXISTS OVERVIEW.IX_OVERVIEW_COST_ENTRIES_PHASE",
        "DROP INDEX IF EXISTS OVERVIEW.IX_OVERVIEW_COST_ENTRIES_TENANT_PERIOD",
        "ALTER TABLE OVERVIEW.COST_ENTRIES DROP COLUMN IF EXISTS VERSION",
    ]


# ---------------------------------------------------------------------------
# live
# ---------------------------------------------------------------------------

_TOUCHED = ("cost_entries", "effort_entries")


def _closure() -> list[object]:
    """The ORM tables this revision touches, plus every table their keys
    reference (transitively)."""
    import app.models  # noqa: F401 — binds every table
    from app.db.base import Base

    by_name = {
        t.name: t for t in Base.metadata.tables.values() if t.schema == "overview"
    }
    wanted: dict[str, object] = {}
    stack = list(_TOUCHED)
    while stack:
        name = stack.pop()
        if name in wanted:
            continue
        table = by_name[name]
        wanted[name] = table
        for fk in table.foreign_keys:
            ref = fk.column.table
            if ref.schema == "overview":
                stack.append(ref.name)
            else:
                # A key outside the schema (e.g. a users table) is created too.
                wanted.setdefault(f"{ref.schema}.{ref.name}", ref)
    return list(wanted.values())


@contextlib.contextmanager
def _at_parent_shape(prefix: str):
    """A database holding this revision's tables as the ORM declares them,
    stamped at ``_REVISION`` and then DOWNGRADED to the parent — so the
    downgrade runs first, against the real model shape."""
    from app.db.base import Base

    with ephemeral_database(admin_database_url(), prefix) as (engine, db_url):
        with engine.begin() as conn:
            conn.execute(text("CREATE SCHEMA IF NOT EXISTS overview"))
            Base.metadata.create_all(conn, tables=_closure())  # type: ignore[arg-type]
        run_alembic(backend_root(), db_url, "stamp", _REVISION)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT)
        yield engine, db_url


def _shape(engine: Engine) -> dict[str, object]:
    insp = inspect(engine)
    tables = set(insp.get_table_names(schema="overview"))
    cols = {c["name"]: c for c in insp.get_columns("cost_entries", schema="overview")}
    indexes = {
        str(i["name"]) for i in insp.get_indexes("cost_entries", schema="overview")
    }
    effort_indexes: set[str] = set()
    effort_checks: set[str] = set()
    if "effort_entries" in tables:
        effort_indexes = {
            str(i["name"])
            for i in insp.get_indexes("effort_entries", schema="overview")
        }
        effort_checks = {
            str(c["name"])
            for c in insp.get_check_constraints("effort_entries", schema="overview")
        }
    version = cols.get("version")
    return {
        "effort_table": "effort_entries" in tables,
        "version": (
            None if version is None else (version["nullable"], str(version["default"]))
        ),
        "cost_indexes": sorted(
            i for i in indexes if "tenant_period" in i or "phase" in i
        ),
        "effort_indexes": sorted(effort_indexes),
        "effort_checks": sorted(effort_checks),
    }


_UP: dict[str, object] = {
    "effort_table": True,
    "version": (True, "1"),
    "cost_indexes": [
        "ix_overview_cost_entries_phase",
        "ix_overview_cost_entries_tenant_period",
    ],
    "effort_indexes": [
        "ix_overview_effort_entries_person",
        "ix_overview_effort_entries_phase",
        "ix_overview_effort_entries_tenant_date",
    ],
    "effort_checks": [
        "ck_overview_effort_entries_hours",
        "ck_overview_effort_entries_hours_per_day",
        "ck_overview_effort_entries_rate",
        "ck_overview_effort_entries_rate_amount",
    ],
}
_DOWN: dict[str, object] = {
    "effort_table": False,
    "version": None,
    "cost_indexes": [],
    "effort_indexes": [],
    "effort_checks": [],
}


@_needs_pg
def test_down_up_down_up_leaves_the_exact_shape_and_reads_old_rows_as_v1() -> None:
    with _at_parent_shape("ov07_rt") as (engine, db_url):
        assert _shape(engine) == _DOWN
        with engine.begin() as conn:
            vendor = conn.execute(
                text(
                    "INSERT INTO overview.vendors (tenant_id, name, category) "
                    "VALUES (gen_random_uuid(), 'v', 'saas') RETURNING id"
                )
            ).scalar_one()
            conn.execute(
                text(
                    "INSERT INTO overview.cost_entries (tenant_id, vendor_id, "
                    "amount_micros, currency, period_start, period_end, source) "
                    "VALUES (gen_random_uuid(), :v, 1, 'USD', '2026-09-01', "
                    "'2026-09-01', 'manual')"
                ),
                {"v": vendor},
            )
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        assert _shape(engine) == _UP
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT version FROM overview.cost_entries")
                ).scalar_one()
                == 1
            )
        run_alembic(backend_root(), db_url, "downgrade", _PARENT)
        assert _shape(engine) == _DOWN
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        assert _shape(engine) == _UP
        # Re-running the upgrade over objects that exist is a no-op.
        run_alembic(backend_root(), db_url, "stamp", _PARENT)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        assert _shape(engine) == _UP


@_needs_pg
def test_a_half_written_rate_snapshot_is_refused() -> None:
    with _at_parent_shape("ov07_ck") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        base = (
            "INSERT INTO overview.effort_entries (tenant_id, work_date, person, "
            "hours, rate_micros_used, rate_currency, hours_per_day_used) VALUES "
            "(gen_random_uuid(), '2026-09-01', 'a', {hours}, {rate}, {cur}, {hpd})"
        )
        bad = [
            {"hours": "8", "rate": "100", "cur": "NULL", "hpd": "8"},
            {"hours": "8", "rate": "100", "cur": "'EUR'", "hpd": "NULL"},
            {"hours": "0", "rate": "NULL", "cur": "NULL", "hpd": "NULL"},
            {"hours": "24.5", "rate": "NULL", "cur": "NULL", "hpd": "NULL"},
            {"hours": "8", "rate": "-1", "cur": "'EUR'", "hpd": "8"},
        ]
        for values in bad:
            with pytest.raises(IntegrityError), engine.begin() as conn:
                conn.execute(text(base.format(**values)))
        with engine.begin() as conn:
            conn.execute(text(base.format(hours="8", rate="100", cur="'EUR'", hpd="8")))
            conn.execute(
                text(base.format(hours="24", rate="NULL", cur="NULL", hpd="NULL"))
            )


def _has_pgvector(url: str) -> bool:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return bool(
                conn.execute(
                    text(
                        "SELECT EXISTS (SELECT 1 FROM pg_available_extensions "
                        "WHERE name = 'vector')"
                    )
                ).scalar()
            )
    except Exception:  # noqa: BLE001 — unreachable is answered by _needs_pg
        return False
    finally:
        engine.dispose()


@_needs_pg
def test_the_whole_chain_walks_through_it_both_ways() -> None:
    url = admin_database_url()
    if not _has_pgvector(url):
        pytest.skip(
            "pgvector is not installed on this Postgres; an earlier revision "
            "needs it to walk the chain from base (CI's Postgres has it)"
        )
    with ephemeral_database(url, "ov07_chain") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        assert _shape(engine) == _UP
        run_alembic(backend_root(), db_url, "downgrade", _PARENT)
        assert _shape(engine) == _DOWN
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        assert _shape(engine) == _UP
