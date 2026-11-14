"""Schema test for ``testing_runs_02_drop_unwritten_store``.

Phase 3 of plan
``2026-11-06-verification-stores-nothing-writes-are-deleted-and-their-open-write-doors-close``.
Source-level guards never skip. The live walks use ``_alembic_harness`` and
skip without a reachable Postgres (``QONTINUI_TEST_PG=host:port``); a skip
proves nothing.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REVISION_ID = "testing_runs_02_drop_unwritten_store"
# MUST equal the revision's own down_revision (first test enforces it).
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"

_DROPPED = frozenset(
    {
        "software_test_runs",
        "coverage_snapshots",
        "historical_results",
        "path_discoveries",
        "test_deficiencies",
        "test_screenshots",
        "transition_executions",
        "visual_baselines",
        "visual_comparison_results",
        "transition_reliability",
        "action_frames",
        "frame_index",
        "input_events",
        "video_capture_sessions",
    }
)

_DROPPED_ENUMS = frozenset(
    {
        "deficiencyseverity",
        "deficiencystatus",
        "deficiencytype",
        "reviewdecision",
        "testrunstatus",
        "testscreenshottype",
        "transitionexecutionstatus",
        "visualcomparisonstatus",
    }
)


def _path() -> Path:
    return backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py"


def _module():
    return load_revision_module(_path(), f"_rev_{_REVISION_ID}")


def test_pinned_parent_matches_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_drop_sets_and_drop_table_calls_agree() -> None:
    """Every table in the drop set is dropped by a literal ``op.drop_table``
    in schema ``project`` (the shape migrate.yml's lifecycle parser reads),
    and nothing else is."""
    module = _module()
    assert frozenset(module._DROPPED_TABLES) == _DROPPED
    assert len(module._DROPPED_TABLES) == len(_DROPPED)
    assert frozenset(module._DROPPED_ENUMS) == _DROPPED_ENUMS

    tree = ast.parse(_path().read_text(encoding="utf-8"))
    upgrade = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    dropped: set[str] = set()
    for node in ast.walk(upgrade):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "drop_table"
        ):
            assert isinstance(node.args[0], ast.Constant)
            schema = {k.arg: k.value for k in node.keywords}["schema"]
            assert isinstance(schema, ast.Constant) and schema.value == "project"
            dropped.add(node.args[0].value)
    assert dropped == _DROPPED


def test_upgrade_checks_emptiness_before_dropping_anything(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    calls: list[tuple[str, str]] = []

    class _Op:
        @staticmethod
        def execute(sql: object) -> None:
            calls.append(("execute", str(sql)))

        @staticmethod
        def drop_table(name: str, schema: str) -> None:
            calls.append(("drop_table", f"{schema}.{name}"))

    monkeypatch.setattr(module, "op", _Op)
    module.upgrade()
    first = calls[0][1]
    assert calls[0][0] == "execute" and "refusing to drop non-empty" in first
    assert first.index("ACCESS EXCLUSIVE") < first.index("SELECT count(*)")
    assert calls[1][0] == "execute" and "DROP CONSTRAINT" in calls[1][1]
    assert all(kind == "drop_table" for kind, _ in calls[2:-1])
    assert calls[-1][0] == "execute" and "DROP TYPE" in calls[-1][1]
    assert len(calls) == 3 + len(_DROPPED)


def test_downgrade_restores_every_dropped_object(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    executed: list[str] = []

    class _Op:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

    monkeypatch.setattr(module, "op", _Op)
    module.downgrade()
    assert executed == [module._RESTORE_SQL]
    for table in _DROPPED:
        assert f"CREATE TABLE project.{table} (" in module._RESTORE_SQL, table
    for enum in _DROPPED_ENUMS:
        assert f"CREATE TYPE public.{enum} AS ENUM (" in module._RESTORE_SQL, enum
    # Types before the tables that use them.
    assert module._RESTORE_SQL.index("CREATE TYPE") < module._RESTORE_SQL.index(
        "CREATE TABLE"
    )


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def _shape(engine: Engine) -> dict[str, object]:
    """Columns, constraints, indexes and enum labels of the drop set — what a
    restore must reproduce."""
    tables = sorted(_DROPPED)
    with engine.connect() as conn:
        columns = conn.execute(
            text(
                """
                SELECT table_name, ordinal_position, column_name, data_type,
                       udt_name, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = 'project' AND table_name = ANY(:t)
                ORDER BY 1, 2
                """
            ),
            {"t": tables},
        ).all()
        constraints = conn.execute(
            text(
                """
                SELECT c.relname, con.conname, pg_get_constraintdef(con.oid)
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace ns ON ns.oid = c.relnamespace
                WHERE ns.nspname = 'project' AND c.relname = ANY(:t)
                ORDER BY 1, 2
                """
            ),
            {"t": tables},
        ).all()
        indexes = conn.execute(
            text(
                """
                SELECT tablename, indexname, indexdef FROM pg_indexes
                WHERE schemaname = 'project' AND tablename = ANY(:t)
                ORDER BY 1, 2
                """
            ),
            {"t": tables},
        ).all()
        enums = conn.execute(
            text(
                """
                SELECT t.typname, e.enumsortorder, e.enumlabel
                FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                JOIN pg_namespace ns ON ns.oid = t.typnamespace
                WHERE ns.nspname = 'public' AND t.typname = ANY(:e)
                ORDER BY 1, 2
                """
            ),
            {"e": sorted(_DROPPED_ENUMS)},
        ).all()
        comments = conn.execute(
            text(
                """
                SELECT c.relname, d.objsubid, d.description
                FROM pg_description d
                JOIN pg_class c ON c.oid = d.objoid
                JOIN pg_namespace ns ON ns.oid = c.relnamespace
                WHERE d.classoid = 'pg_class'::regclass
                  AND ns.nspname = 'project' AND c.relname = ANY(:t)
                ORDER BY 1, 2
                """
            ),
            {"t": tables},
        ).all()
        sequences = conn.execute(
            text(
                """
                SELECT sequencename, data_type::text, start_value, increment_by,
                       cache_size
                FROM pg_sequences
                WHERE schemaname = 'project'
                  AND sequencename LIKE ANY(:p)
                ORDER BY 1
                """
            ),
            {"p": [f"{t}_%" for t in tables]},
        ).all()
    return {
        "columns": columns,
        "constraints": constraints,
        "indexes": indexes,
        "enums": enums,
        "comments": comments,
        "sequences": sequences,
    }


def test_live_walk_drops_restores_exactly_and_drops_again() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "tr02") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        before = _shape(engine)
        assert all(before.values()), {k: len(v) for k, v in before.items()}

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        after = _shape(engine)
        for table in _DROPPED:
            assert not table_exists(engine, "project", table), table
        assert all(not v for v in after.values()), after

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert _shape(engine) == before

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _DROPPED:
            assert not table_exists(engine, "project", table), table


def _insert_minimal_row(engine: Engine, table: str) -> None:
    """Insert one row filling only NOT NULL, default-less columns, with FK
    checks off (``session_replication_role = replica``) so no parent row is
    needed. Test-only: it builds the row from ``information_schema``."""
    cols_sql = text(
        """
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'project' AND table_name = :t
          AND is_nullable = 'NO' AND column_default IS NULL
        """
    )
    literal = {
        "uuid": "gen_random_uuid()",
        "integer": "0",
        "bigint": "0",
        "smallint": "0",
        "double precision": "0",
        "real": "0",
        "numeric": "0",
        "boolean": "false",
        "jsonb": "'{}'::jsonb",
        "json": "'{}'::json",
        "text": "'x'",
        "character varying": "'x'",
        "timestamp with time zone": "now()",
        "timestamp without time zone": "now()",
        "ARRAY": "'{}'",
    }
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL session_replication_role = replica"))
        names: list[str] = []
        values: list[str] = []
        for name, data_type, udt in conn.execute(cols_sql, {"t": table}):
            if data_type == "USER-DEFINED":
                label = conn.execute(
                    text(
                        "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t "
                        "ON t.oid = e.enumtypid WHERE t.typname = :u "
                        "ORDER BY e.enumsortorder LIMIT 1"
                    ),
                    {"u": udt},
                ).scalar_one()
                values.append(f"'{label}'")
            else:
                values.append(literal[data_type])
            names.append(f'"{name}"')
        conn.execute(
            text(
                f"INSERT INTO project.{table} ({', '.join(names)}) "
                f"VALUES ({', '.join(values)})"
            )
        )


def test_live_walk_refuses_when_a_table_holds_a_row() -> None:
    """A table that gained a row since the census is K-D4's rename arm, not
    this revision's: the upgrade fails and drops nothing."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "tr02neg") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _insert_minimal_row(engine, "transition_reliability")

        result = run_alembic(
            backend_root(), db_url, "upgrade", _REVISION_ID, expect_success=False
        )
        assert result.returncode != 0
        assert "refusing to drop non-empty" in result.stderr
        for table in _DROPPED:
            assert table_exists(engine, "project", table), table


def test_live_walk_refuses_when_another_table_uses_a_dropped_enum() -> None:
    """The enum guard names the user instead of dropping a type still in use."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "tr02enum") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE project.tr02_enum_user (status public.testrunstatus)"
                )
            )

        result = run_alembic(
            backend_root(), db_url, "upgrade", _REVISION_ID, expect_success=False
        )
        assert result.returncode != 0
        assert "enum public.testrunstatus is still used by" in result.stderr
        assert "tr02_enum_user.status" in result.stderr
        for table in _DROPPED:
            assert table_exists(engine, "project", table), table
