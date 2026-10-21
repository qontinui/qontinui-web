"""Structural tests for alembic ``fpl_01`` (coord.fleet_placement_plans).

Plan ``2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr`` Phase 2.

Postgres-free, like ``test_coord_prepaid_balances_01_migration``: AST and
source assertions over the revision file, so they run in any environment. They
pin the properties coord's writer and reader rely on and that would silently
regress under a later edit.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

_REVISION_ID = "fpl_01"
_PARENT_REVISION_ID = "taste_inbox_01"
_FILENAME = "fpl_01_fleet_placement_plans.py"

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"

# The columns qontinui-coord's fleet_placement worker INSERTs and its read
# door SELECTs. A rename here breaks coord at query time, not at build time.
_COORD_COLUMNS = (
    "id",
    "tenant_id",
    "computed_at",
    "model_version",
    "mode",
    "inputs_digest",
    "inputs_coverage",
    "hosts",
    "repos",
    "advice",
    "predicted_ttm_delta_secs",
    "predicted_delta_basis",
)


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
    fn = _function(fn_name)
    doc = ast.get_docstring(fn)
    return "\n".join(
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    )


def _column_decl(col: str) -> str:
    m = re.search(rf"^\s*{col}\s+([^\n]+)", _sql("upgrade"), re.M)
    assert m, f"column {col} missing from CREATE TABLE"
    return m.group(1).strip().rstrip(",").upper()


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    assert _module_assignment("revision") == _REVISION_ID
    assert _module_assignment("down_revision") == _PARENT_REVISION_ID
    siblings = set()
    for p in _VERSIONS.glob("*.py"):
        m = re.search(
            r'^revision(?::\s*str)?\s*=\s*["\']([^"\']+)["\']',
            p.read_text(encoding="utf-8", errors="replace"),
            re.M,
        )
        if m:
            siblings.add(m.group(1))
    assert _PARENT_REVISION_ID in siblings


def test_revision_id_is_unique_across_the_versions_dir() -> None:
    hits = [
        p.name
        for p in _VERSIONS.glob("*.py")
        if re.search(
            rf'^revision(?::\s*str)?\s*=\s*["\']{re.escape(_REVISION_ID)}["\']',
            p.read_text(encoding="utf-8", errors="replace"),
            re.M,
        )
    ]
    assert hits == [_FILENAME]


def test_every_ddl_object_is_coord_qualified() -> None:
    for fn_name in ("upgrade", "downgrade"):
        sql = _sql(fn_name)
        for obj in re.findall(
            r"(?:CREATE TABLE|DROP TABLE|ALTER TABLE|COMMENT ON COLUMN)"
            r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
            sql,
            re.I,
        ):
            assert obj.startswith("coord."), (
                f"{fn_name}(): {obj!r} not coord.-qualified"
            )
        for target in re.findall(
            r"CREATE INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[A-Za-z_\"]+\s+ON\s+([A-Za-z_.\"]+)",
            sql,
            re.I,
        ):
            assert target.startswith("coord."), f"{fn_name}(): index on {target!r}"


def test_upgrade_never_drops_and_both_directions_are_idempotent() -> None:
    up = _sql("upgrade")
    assert not re.search(r"\bDROP\b", up, re.I)
    assert re.search(r"CREATE TABLE IF NOT EXISTS coord\.fleet_placement_plans", up)
    assert len(re.findall(r"CREATE INDEX IF NOT EXISTS", up)) == 2
    assert re.search(
        r"DROP TABLE IF EXISTS coord\.fleet_placement_plans", _sql("downgrade")
    )


def test_offline_safe_only_op_execute() -> None:
    ops_used = {
        node.func.attr
        for node in ast.walk(_tree())
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    }
    assert ops_used == {"execute"}, ops_used


def test_every_column_coord_reads_is_declared() -> None:
    for col in _COORD_COLUMNS:
        _column_decl(col)


def test_plan_payload_columns_are_not_null_jsonb() -> None:
    for col in ("inputs_coverage", "hosts", "repos", "advice"):
        decl = _column_decl(col)
        assert decl.startswith("JSONB"), f"{col}: {decl}"
        assert "NOT NULL" in decl, f"{col} must be NOT NULL: {decl}"


def test_predicted_delta_is_nullable_so_unknown_is_not_zero() -> None:
    # NULL = UNKNOWN. A NOT NULL or DEFAULT here would force the writer to
    # invent a number for a tenant whose inputs did not support a prediction.
    decl = _column_decl("predicted_ttm_delta_secs")
    assert decl.startswith("DOUBLE PRECISION"), decl
    assert "NOT NULL" not in decl and "DEFAULT" not in decl, decl


def test_identity_and_scoping_columns() -> None:
    assert "NOT NULL" in _column_decl("tenant_id")
    computed = _column_decl("computed_at")
    assert "NOT NULL" in computed and "DEFAULT NOW()" in computed
    assert "NOT NULL" in _column_decl("inputs_digest")
    assert "NOT NULL" in _column_decl("model_version")


def test_read_and_retention_indexes_exist() -> None:
    up = _sql("upgrade")
    assert re.search(
        r"ix_fleet_placement_plans_tenant_computed\s+ON coord\.fleet_placement_plans\s*"
        r"\(tenant_id,\s*computed_at DESC\)",
        up,
    )
    assert re.search(
        r"ix_fleet_placement_plans_computed\s+ON coord\.fleet_placement_plans\s*\(computed_at\)",
        up,
    )
