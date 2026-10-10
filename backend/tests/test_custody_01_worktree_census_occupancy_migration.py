"""Source-level guards for the ``custody_01_worktree_census_occupancy`` revision.

Phase 1a of plan ``2026-09-07-shared-checkout-occupancy-is-invisible-to-coord``.
coord's ``worktree_census.rs`` reads these columns over a tier that degrades on
SQLSTATE 42703, so a misspelled or mistyped column produces no error anywhere —
these pins are the only signal. No database needed, so they never skip.
"""

from __future__ import annotations

import re

from tests._alembic_harness import backend_root, load_revision_module

# `_PARENT_REVISION_ID` MUST equal the revision's own `down_revision`; re-point
# both together if a sibling lands underneath this revision.
_REVISION_ID = "custody_01_worktree_census_occupancy"
_PARENT_REVISION_ID = "cihost_01_ci_host_agent_fleet"

_EXPECTED: tuple[tuple[str, str], ...] = (
    ("custody_session_id", "TEXT"),
    ("custody_session_name", "TEXT"),
    ("custody_last_seen", "TIMESTAMPTZ"),
    ("custody_wip_state", "TEXT"),
    ("custody_wip_ref", "TEXT"),
    ("custody_work_unit_id", "TEXT"),
    ("custody_plan_slug", "TEXT"),
    ("custody_occupants", "JSONB"),
)


def _module():
    path = backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py"
    return load_revision_module(path, f"_rev_{_REVISION_ID}")


def _executed() -> list[str]:
    """Run upgrade() then downgrade() against a stub op; return the SQL each sent."""
    calls: list[str] = []
    module = _module()

    class _Op:
        @staticmethod
        def execute(sql: str) -> None:
            calls.append(sql)

    original = module.op
    module.op = _Op
    try:
        module.upgrade()
        module.downgrade()
    finally:
        module.op = original
    return calls


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_upgrade_and_downgrade_each_execute_one_statement() -> None:
    assert len(_executed()) == 2


def test_the_upgrade_adds_exactly_the_columns_coord_reads_idempotently() -> None:
    sql = _executed()[0]
    assert "ALTER TABLE coord.worktree_census" in sql
    added = re.findall(r"ADD COLUMN IF NOT EXISTS (\w+) (\w+)", sql)
    assert tuple(added) == _EXPECTED
    assert sql.count("ADD COLUMN") == len(_EXPECTED)
    assert "NOT NULL" not in sql and "REFERENCES" not in sql and "DEFAULT" not in sql


def test_the_downgrade_drops_exactly_those_columns_idempotently() -> None:
    sql = _executed()[1]
    assert "ALTER TABLE coord.worktree_census" in sql
    dropped = re.findall(r"DROP COLUMN IF EXISTS (\w+)", sql)
    assert dropped == [name for name, _ in reversed(_EXPECTED)]


def test_the_sql_is_written_inline_in_op_execute() -> None:
    """coord's classifier rejects op.execute(<name>) as dynamic SQL."""
    source = (
        backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py"
    ).read_text()
    assert re.findall(r"^\s+op\.execute\(\s*(\S)", source, re.MULTILINE) == ['"', '"']
