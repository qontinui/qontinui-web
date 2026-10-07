"""Structural tests for alembic ``coord_claude_acct_usage_03``.

Plan ``2026-10-07-mobile-account-usage-stale-tenant-feed-remediation`` #6(a):
``coord.claude_account_usage.weekly_utilization`` loses ``NOT NULL`` and
``DEFAULT 0`` so a failed probe can be stored as NULL (= no reading) instead of
a placeholder 0.0/1.0.

Postgres-free, like ``test_coord_prepaid_balances_01_migration``: AST and source
assertions over the revision file, pinning the properties a later edit could
silently regress.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

_REVISION_ID = "coord_claude_acct_usage_03"
_PARENT_ID = "coord_smckpt_01_success_metric_checkpoint_results"
_FILENAME = "coord_claude_acct_usage_03_nullable_weekly_utilization.py"

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_REVISION_RE = r'^revision(?::\s*str)?\s*=\s*["\']([^"\']+)["\']'


def _source() -> str:
    return (_VERSIONS / _FILENAME).read_text(encoding="utf-8")


def _tree() -> ast.Module:
    return ast.parse(_source())


def _function(name: str) -> ast.FunctionDef:
    for node in _tree().body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name}() not found in {_FILENAME}")


def _module_assignment(name: str) -> object:
    for node in _tree().body:
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        for t in targets:
            if isinstance(t, ast.Name) and t.id == name and node.value is not None:
                return ast.literal_eval(node.value)
    raise AssertionError(f"{name} not assigned at module level")


def _sql(fn_name: str) -> str:
    """Every string constant in the function except its docstring, joined and
    whitespace-collapsed so the assertions do not depend on line layout."""
    fn = _function(fn_name)
    doc = ast.get_docstring(fn)
    parts = [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]
    return re.sub(r"\s+", " ", " ".join(parts)).upper()


def test_revision_ids_are_wired_to_a_real_parent() -> None:
    assert _module_assignment("revision") == _REVISION_ID
    parent = _module_assignment("down_revision")
    assert parent == _PARENT_ID
    siblings = {
        m.group(1)
        for p in _VERSIONS.glob("*.py")
        for m in [
            re.search(
                _REVISION_RE, p.read_text(encoding="utf-8", errors="replace"), re.M
            )
        ]
        if m
    }
    assert parent in siblings, f"down_revision {parent!r} names no revision file"


def test_revision_id_is_unique_across_the_versions_dir() -> None:
    hits = [
        p.name
        for p in _VERSIONS.glob("*.py")
        if (m := re.search(_REVISION_RE, p.read_text("utf-8", "replace"), re.M))
        and m.group(1) == _REVISION_ID
    ]
    assert hits == [_FILENAME]


def test_upgrade_drops_not_null_and_default_on_the_coord_table() -> None:
    up = _sql("upgrade")
    assert "ALTER TABLE IF EXISTS COORD.CLAUDE_ACCOUNT_USAGE" in up
    assert "ALTER COLUMN WEEKLY_UTILIZATION DROP NOT NULL" in up
    # A surviving DEFAULT 0 would make an omitted value read as 0% — the very
    # placeholder this revision exists to stop.
    assert "ALTER COLUMN WEEKLY_UTILIZATION DROP DEFAULT" in up
    # The plan asks for no backfill: existing rows self-heal on the next report.
    assert "UPDATE" not in up


def test_downgrade_backfills_nulls_before_restoring_not_null() -> None:
    down = _sql("downgrade")
    backfill = down.find("SET WEEKLY_UTILIZATION = 0 WHERE WEEKLY_UTILIZATION IS NULL")
    restore = down.find("ALTER COLUMN WEEKLY_UTILIZATION SET NOT NULL")
    assert backfill != -1, "downgrade must fill NULL rows or SET NOT NULL fails"
    assert restore != -1
    assert backfill < restore
    assert "ALTER COLUMN WEEKLY_UTILIZATION SET DEFAULT 0" in down
    # The backfill is guarded so a missing table does not fail the downgrade.
    assert "TO_REGCLASS('COORD.CLAUDE_ACCOUNT_USAGE') IS NOT NULL" in down


def test_offline_safe_no_bind_in_either_direction() -> None:
    for name in ("upgrade", "downgrade"):
        body = ast.unparse(_function(name))
        assert "get_bind" not in body, f"{name}() needs a live connection"
        assert "inspect" not in body, f"{name}() needs a live connection"
