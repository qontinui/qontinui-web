"""Structural tests for alembic ``coord_prepaid_balances_01``.

Plan ``2026-09-12-prepaid-balance-is-a-fleet-fact-with-no-ingest`` Phase 1.

Follows the house template ``test_ptbe_01_primary_tree_branch_events_migration``
for a ``coord.*`` table-creating revision, but deliberately keeps every
assertion here **Postgres-free** — they are AST and source assertions over the
revision file, so they run in any environment rather than skipping on the box
where a mistake is most likely to be introduced. The live up/down/up behaviour
of this DDL was verified separately against a throwaway ``postgres:16`` when the
revision was authored; the properties pinned below are the ones that would
silently regress under a later edit.

Two of these pins exist because the reviewed first draft got them wrong, and
both failures were invisible to ``ruff``:

* ``test_offline_safe_no_bind_in_either_direction`` — the draft guarded
  ``downgrade()`` with ``sa.inspect(op.get_bind())``, which has no connection
  under ``alembic ... --sql`` offline mode, instead of the house
  ``DROP TABLE IF EXISTS``.
* ``test_docstring_does_not_claim_a_multi_head_repo`` — the draft's docstring
  asserted the repo had SIX open alembic heads. It has exactly one, and
  ``scripts/ci/count_alembic_heads.py`` enforces that. A revision file is
  immutable history, so a false claim in one misleads every later reader.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

_REVISION_ID = "coord_prepaid_balances_01"
_PARENT_ID = "policy_rules_tombstone_01"
_FILENAME = "coord_prepaid_balances_01_create.py"

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _path() -> Path:
    return _VERSIONS / _FILENAME


def _source() -> str:
    return _path().read_text(encoding="utf-8")


def _tree() -> ast.Module:
    return ast.parse(_source())


def _function(name: str) -> ast.FunctionDef:
    for node in _tree().body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name}() not found in {_FILENAME}")


def _module_assignment(name: str) -> object:
    """Read a module-level literal assignment without importing the module."""
    for node in _tree().body:
        targets = []
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


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    """Every string constant inside `fn`, minus its own docstring."""
    doc = ast.get_docstring(fn)
    out = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if doc is not None and node.value == doc:
                continue
            out.append(node.value)
    return out


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    assert _module_assignment("revision") == _REVISION_ID
    parent = _module_assignment("down_revision")
    assert parent == _PARENT_ID
    # The parent must be a revision that actually exists in this directory —
    # a typo'd parent is a dangling chain alembic only complains about at
    # runtime, and never the literal string "head".
    assert parent != "head"
    siblings = {
        m.group(1)
        for p in _VERSIONS.glob("*.py")
        for m in [
            re.search(
                r'^revision(?::\s*str)?\s*=\s*["\']([^"\']+)["\']',
                p.read_text(encoding="utf-8", errors="replace"),
                re.M,
            )
        ]
        if m
    }
    assert parent in siblings, f"down_revision {parent!r} names no revision file"


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
    assert hits == [_FILENAME], f"revision id {_REVISION_ID} claimed by {hits}"


# ---------------------------------------------------------------------------
# 2. every DDL object is coord.-qualified
# ---------------------------------------------------------------------------


def test_every_ddl_object_is_coord_qualified() -> None:
    # A `coord.*` revision that forgets the schema prefix silently creates the
    # object in `public`, which `scripts/ci/check_forbidden_public_schema.py`
    # exists to catch — pinned here too so it fails at the unit level first.
    #
    # NOTE the asymmetry, which an earlier draft of this test got wrong: a
    # TABLE is named directly and must carry the prefix, but an INDEX name is
    # NOT schema-qualified in PG — it inherits the schema of the table in its
    # `ON` clause. So for CREATE INDEX the object to check is the ON target.
    # `coord_claude_acct_usage_01` does exactly the same thing.
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(fn_name)):
            for obj in re.findall(
                r"(?:CREATE TABLE|DROP TABLE|ALTER TABLE)"
                r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert obj.startswith("coord."), (
                    f"{fn_name}(): table {obj!r} is not coord.-qualified"
                )
            for target in re.findall(
                r"CREATE INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[A-Za-z_\"]+\s+"
                r"ON\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert target.startswith("coord."), (
                    f"{fn_name}(): index target {target!r} is not coord.-qualified"
                )


# ---------------------------------------------------------------------------
# 3. the only DROP lives in downgrade()
# ---------------------------------------------------------------------------


def test_every_drop_is_inside_downgrade() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function("downgrade")))
    assert re.search(r"DROP TABLE IF EXISTS coord\.prepaid_balances", down, re.I)


# ---------------------------------------------------------------------------
# 4. idempotent in both directions (re-runnable on a partial apply)
# ---------------------------------------------------------------------------


def test_upgrade_and_downgrade_are_idempotent_by_construction() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    assert re.search(r"CREATE TABLE IF NOT EXISTS", up, re.I)
    assert re.search(r"CREATE INDEX IF NOT EXISTS", up, re.I)
    down = "\n".join(_sql_literals(_function("downgrade")))
    assert re.search(r"DROP TABLE IF EXISTS", down, re.I)


def test_offline_safe_no_bind_in_either_direction() -> None:
    # Regression pin: the reviewed draft used sa.inspect(op.get_bind()) to
    # guard the DROP. op.get_bind() has no connection under
    # `alembic ... --sql`, and env.py implements run_migrations_offline(), so
    # both directions must stay pure op.execute.
    #
    # Scanned over the AST, not the raw text — an earlier draft grepped the
    # source and tripped on the docstring PROSE that explains why get_bind is
    # avoided, which is the opposite of a violation.
    tree = _tree()
    called = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert "get_bind" not in called, "op.get_bind() is not offline-safe"
    assert "inspect" not in called, "sa.inspect() needs a live bind"

    ops_used = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    }
    assert ops_used == {"execute"}, f"only op.execute is offline-safe, got {ops_used}"

    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "sqlalchemy" not in imported, "no sqlalchemy import is needed any more"


# ---------------------------------------------------------------------------
# 5. the schema decisions the plan rests on
# ---------------------------------------------------------------------------


def test_identity_is_tenant_device_provider() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    m = re.search(
        r"CONSTRAINT\s+uq_prepaid_balances_identity\s*\n?\s*UNIQUE\s*\(([^)]*)\)",
        up,
        re.I,
    )
    assert m, "the named unique constraint coord's ON CONFLICT needs is missing"
    cols = [c.strip() for c in m.group(1).split(",")]
    assert cols == ["tenant_id", "device_id", "provider"]


def test_money_columns_are_bigint_micros_and_nullable() -> None:
    # The point of the table: a money column must be able to hold NULL
    # (= NOT REPORTED) so it stays distinguishable from 0 (= out of credit).
    # A NOT NULL or a DEFAULT on any of these destroys that distinction, which
    # is the defect this table exists to avoid inheriting from
    # coord.claude_account_usage.weekly_utilization.
    up = "\n".join(_sql_literals(_function("upgrade")))
    for col in ("balance_micros", "granted_micros", "topped_up_micros"):
        m = re.search(rf"^\s*{col}\s+([^,\n]+)", up, re.I | re.M)
        assert m, f"{col} missing"
        decl = m.group(1).strip().rstrip(",")
        assert decl.upper().startswith("BIGINT"), f"{col} is {decl!r}, want BIGINT"
        assert "NOT NULL" not in decl.upper(), f"{col} must be nullable, got {decl!r}"
        assert "DEFAULT" not in decl.upper(), f"{col} must have no default: {decl!r}"


def test_scoping_columns_are_not_null_and_updated_at_defaults() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    for col in ("tenant_id", "device_id", "provider"):
        m = re.search(rf"^\s*{col}\s+([^,\n]+)", up, re.I | re.M)
        assert m and "NOT NULL" in m.group(1).upper(), f"{col} must be NOT NULL"
    m = re.search(r"^\s*updated_at\s+([^,\n]+)", up, re.I | re.M)
    assert m and "NOT NULL" in m.group(1).upper()
    assert "DEFAULT NOW()" in m.group(1).upper()


def test_tenant_scoped_freshness_index_exists() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    assert re.search(
        r"CREATE INDEX IF NOT EXISTS\s+ix_prepaid_balances_tenant_updated\s+"
        r"ON coord\.prepaid_balances\s*\(tenant_id,\s*updated_at DESC\)",
        up,
        re.I,
    ), "the tenant+freshness index mirroring the sibling table is missing"


# ---------------------------------------------------------------------------
# 6. the docstring must not assert things that are false
# ---------------------------------------------------------------------------


def test_docstring_does_not_claim_a_multi_head_repo() -> None:
    # Regression pin. The reviewed draft's docstring said this repo had SIX
    # open alembic heads; it has one, enforced by
    # scripts/ci/count_alembic_heads.py. A revision file is permanent, so a
    # false claim in it misleads forever.
    doc = ast.get_docstring(_tree()) or ""
    assert "SIX heads" not in doc
    assert re.search(r"\bsingle\b\s+head", doc, re.I), (
        "the head-choice section should state the single-head discipline"
    )


def test_docstring_records_the_producer_obligation() -> None:
    # The nullable columns are a contract the runner cannot satisfy yet
    # (PrepaidBalanceInfo's fields are f64/String, not Option<_>). Phase 1 must
    # say so, or the nullability is decorative and a false `0` ships.
    doc = ast.get_docstring(_tree()) or ""
    assert "prepaid_balance.rs" in doc
    assert "Option" in doc
