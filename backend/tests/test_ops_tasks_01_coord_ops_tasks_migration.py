"""Structural test for alembic ``ops_tasks_01_coord_ops_tasks``.

Plan ``2026-10-19-ci-nodes-run-the-tauri-runner-always-on-as-ci-node-role``
Phase 4 step 1 (D4 ops-task ledger). No database needed: it pins the chain
wiring, the table's columns and state vocabulary, idempotent DDL, and that the
upgrade drops nothing while the downgrade removes exactly the new table.
"""

from __future__ import annotations

import re

from tests._alembic_harness import backend_root

_FILENAME = "ops_tasks_01_coord_ops_tasks.py"
_PARENT = "journey_04_explorations_stop_detail_any_stop"
_COLUMNS = (
    "id",
    "tenant_id",
    "device_id",
    "task_id",
    "script_repo",
    "script_path",
    "script_sha",
    "args",
    "requested_by",
    "state",
    "exit_code",
    "log_tail",
    "created_at",
    "expires_at",
    "dispatched_at",
    "started_at",
    "completed_at",
)
_STATES = (
    "queued",
    "dispatched",
    "running",
    "succeeded",
    "failed",
    "expired",
    "cancelled",
)


def _src() -> str:
    return (backend_root() / "alembic" / "versions" / _FILENAME).read_text(
        encoding="utf-8"
    )


def _section(src: str, name: str) -> str:
    m = re.search(rf"def {name}\(\).*?(?=\ndef |\Z)", src, re.S)
    assert m, name
    return m.group(0)


def test_chain_wiring() -> None:
    src = _src()
    assert 'revision: str = "ops_tasks_01_coord_ops_tasks"' in src
    assert f'= "{_PARENT}"' in src
    assert f"Revises: {_PARENT}" in src


def test_table_shape() -> None:
    up = _section(_src(), "upgrade")
    assert "CREATE TABLE IF NOT EXISTS coord.ops_tasks" in up
    for col in _COLUMNS:
        assert re.search(rf"^\s+{col}\s+\w", up, re.M), col
    for state in _STATES:
        assert f"'{state}'" in up
    # NULL is not 0: result columns carry no default.
    assert re.search(r"exit_code\s+INTEGER NULL,", up)
    assert re.search(r"log_tail\s+TEXT NULL,", up)


def test_upgrade_idempotent_and_drops_nothing() -> None:
    up = _section(_src(), "upgrade")
    assert "DROP" not in up.upper().replace("DROPPED", "")
    for stmt in re.findall(r"CREATE (?:UNIQUE )?(?:TABLE|INDEX|SCHEMA)[^\n]*", up):
        assert "IF NOT EXISTS" in stmt, stmt


def test_downgrade_removes_only_the_table() -> None:
    down = _section(_src(), "downgrade")
    assert down.count("DROP") == 1
    assert "DROP TABLE IF EXISTS coord.ops_tasks" in down
