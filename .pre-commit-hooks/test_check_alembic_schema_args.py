"""Tests for ``check_alembic_schema_args.py``.

Focused on the raw-SQL regex audit. Run with ``poetry run pytest
.pre-commit-hooks/test_check_alembic_schema_args.py`` from the
``qontinui-web`` repo root.

Coverage at first commit:

* ``INSERT ... ON CONFLICT (col)`` is NOT flagged (the 2026-05-21
  false positive that motivated the regex anchor fix).
* ``CREATE INDEX … ON <table>(col)`` with a bare table IS flagged.
* ``CREATE INDEX … ON <schema>.<table>(col)`` with a qualified table
  is NOT flagged.
* ``CREATE INDEX … ON … USING btree (col)`` is matched (USING path).
* ``CREATE UNIQUE INDEX``, ``CREATE INDEX CONCURRENTLY``, and
  ``CREATE INDEX IF NOT EXISTS`` shapes are all matched.
"""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

_THIS = Path(__file__).resolve().parent
_SPEC = importlib.util.spec_from_file_location(
    "check_alembic_schema_args",
    _THIS / "check_alembic_schema_args.py",
)
assert _SPEC is not None and _SPEC.loader is not None
_module = importlib.util.module_from_spec(_SPEC)
sys.modules["check_alembic_schema_args"] = _module
_SPEC.loader.exec_module(_module)


def _audit(sql: str) -> list[tuple[int, str]]:
    """Wrap ``_check_raw_sql`` so tests can pass a literal SQL string."""
    src = f'op.execute({sql!r})'
    tree = ast.parse(src)
    call = tree.body[0].value  # type: ignore[attr-defined]
    return _module._check_raw_sql(call)


# ---------------------------------------------------------------------------
# False-positive regression — `INSERT … ON CONFLICT (col)` should NOT match.
# ---------------------------------------------------------------------------


def test_insert_on_conflict_does_not_false_match():
    sql = (
        "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
        "VALUES ($1, 'personal-jspinak', 'Personal') "
        "ON CONFLICT (tenant_id) DO NOTHING"
    )
    assert _audit(sql) == []


def test_insert_on_conflict_do_update_does_not_false_match():
    sql = (
        "INSERT INTO coord.tenant_merge_settings (tenant_id, line_budget) "
        "VALUES ($1, $2) "
        "ON CONFLICT (tenant_id) DO UPDATE SET line_budget = EXCLUDED.line_budget"
    )
    assert _audit(sql) == []


# ---------------------------------------------------------------------------
# True positives — `CREATE INDEX … ON <bare>(col)` should still flag.
# ---------------------------------------------------------------------------


def test_create_index_bare_table_flags():
    sql = "CREATE INDEX idx_foo ON tenants (tenant_id)"
    violations = _audit(sql)
    assert len(violations) == 1
    assert "INDEX ON" in violations[0][1]
    assert "tenants" in violations[0][1]


def test_create_unique_index_bare_table_flags():
    sql = "CREATE UNIQUE INDEX idx_foo ON tenants (tenant_id)"
    violations = _audit(sql)
    assert len(violations) == 1


def test_create_index_if_not_exists_bare_table_flags():
    sql = "CREATE INDEX IF NOT EXISTS idx_foo ON tenants (tenant_id)"
    violations = _audit(sql)
    assert len(violations) == 1


def test_create_index_concurrently_bare_table_flags():
    sql = "CREATE INDEX CONCURRENTLY idx_foo ON tenants (tenant_id)"
    violations = _audit(sql)
    assert len(violations) == 1


def test_create_index_using_btree_bare_table_flags():
    sql = "CREATE INDEX idx_foo ON tenants USING btree (tenant_id)"
    violations = _audit(sql)
    assert len(violations) == 1


# ---------------------------------------------------------------------------
# True negatives — schema-qualified table is fine.
# ---------------------------------------------------------------------------


def test_create_index_schema_qualified_passes():
    sql = "CREATE INDEX idx_foo ON coord.tenants (tenant_id)"
    assert _audit(sql) == []


def test_create_index_using_btree_schema_qualified_passes():
    sql = "CREATE INDEX idx_foo ON coord.tenants USING btree (tenant_id)"
    assert _audit(sql) == []


def test_create_unique_index_schema_qualified_passes():
    sql = "CREATE UNIQUE INDEX idx_foo ON coord.tenants (tenant_id)"
    assert _audit(sql) == []


# ---------------------------------------------------------------------------
# Mixed cases — CREATE INDEX flags but the INSERT in the same SQL does not.
# ---------------------------------------------------------------------------


def test_mixed_insert_and_create_index_flags_only_index():
    sql = (
        "INSERT INTO coord.tenants VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING; "
        "CREATE INDEX idx_foo ON tenants (tenant_id)"
    )
    violations = _audit(sql)
    assert len(violations) == 1
    assert "INDEX ON" in violations[0][1]
    assert "tenants" in violations[0][1]
