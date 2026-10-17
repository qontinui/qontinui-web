"""Schema test for the ``wthr_01`` revision (worktree headroom mode + cpu_busy_permille).

Source-level guards never skip. The live walk uses ``_alembic_harness`` and
skips without a reachable Postgres (``QONTINUI_TEST_PG=host:port``); a skip
proves nothing.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from sqlalchemy import text

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "wthr_01"
# MUST equal the revision's own down_revision (first test enforces it).
_PARENT_REVISION_ID = "cihost_01_ci_host_agent_fleet"
_REVISION_FILENAME = "wthr_01_worktree_headroom_mode_cpu_busy_permille.py"

# (schema.table, column, information_schema.data_type)
_EXPECTED = (
    ("fleet_runtime_policy", "worktree_headroom_mode", "text"),
    ("fleet_runtime_policy_versions", "worktree_headroom_mode", "text"),
    ("device_resource_samples", "cpu_busy_permille", "smallint"),
)


def _path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module():
    return load_revision_module(_path(), f"_rev_{_REVISION_ID}")


def _recorded(monkeypatch: pytest.MonkeyPatch, step: str) -> list[str]:
    module = _module()
    out: list[str] = []

    class _Op:
        @staticmethod
        def execute(sql: object) -> None:
            out.append(str(sql))

    monkeypatch.setattr(module, "op", _Op)
    getattr(module, step)()
    return out


def test_pinned_parent_matches_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_column_list_is_the_interface() -> None:
    module = _module()
    assert tuple(module._COLUMNS) == (
        ("coord.fleet_runtime_policy", "worktree_headroom_mode", "TEXT"),
        ("coord.fleet_runtime_policy_versions", "worktree_headroom_mode", "TEXT"),
        ("coord.device_resource_samples", "cpu_busy_permille", "SMALLINT"),
    )


def test_upgrade_adds_columns_with_checks_and_downgrade_drops_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    up = "\n".join(_recorded(monkeypatch, "upgrade"))
    down = "\n".join(_recorded(monkeypatch, "downgrade"))
    for table, column, ddl in _module()._COLUMNS:
        assert f"ALTER TABLE {table}" in up
        assert f"ADD COLUMN IF NOT EXISTS {column} {ddl} NULL" in up
        assert f"ALTER TABLE {table}" in down
        assert f"DROP COLUMN IF EXISTS {column}" in down
    assert up.count("('off', 'shadow', 'enforce')") == 2
    assert "BETWEEN 0 AND 1000" in up


def test_every_op_execute_takes_a_static_string_literal() -> None:
    tree = ast.parse(_path().read_text(encoding="utf-8"))
    calls = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "execute"
        and isinstance(n.func.value, ast.Name)
        and n.func.value.id == "op"
    ]
    assert calls
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        assert isinstance(call.args[0], ast.Constant)
        assert isinstance(call.args[0].value, str)


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def test_live_walk_checks_nullability_and_up_down_up() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "wthr01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table, name, pg_type in _EXPECTED:
            info = column_info(engine, table, name)
            assert info is not None, f"{table}.{name} missing"
            assert info[0] == pg_type
            assert info[1] == "YES" and info[2] is None
            assert column_comment(engine, table, name)

        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO coord.device_resource_samples "
                    "(device_id, lane, sampled_at, source, cpu_busy_permille) "
                    "VALUES (gen_random_uuid(), 'host', now(), 'test', 1000)"
                )
            )
        for bad in ("-1", "1001"):
            with pytest.raises(Exception, match="(?i)check"):
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO coord.device_resource_samples "
                            "(device_id, lane, sampled_at, source, "
                            f"cpu_busy_permille) VALUES (gen_random_uuid(), "
                            f"'host', now(), 'test', {bad})"
                        )
                    )

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for table, name, _ in _EXPECTED:
            assert column_info(engine, table, name) is None
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table, name, _ in _EXPECTED:
            assert column_info(engine, table, name) is not None
