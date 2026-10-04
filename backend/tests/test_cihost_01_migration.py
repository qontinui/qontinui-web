"""Source-pinned test for the alembic DATA revision ``cihost_01``.

Plan ``2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting`` Phase 1
(design decision D2): seed the qontinui tenant's ``github_hosted_ci``
fleet-policy dial OFF, with its version-1 snapshot, and nothing else.

The revision authors no schema, so its whole contract is the SQL text: which
tenant, domain, band and level it writes; that it never overwrites a choice
already made; that it writes the snapshot only for a row it wrote; and that the
downgrade deletes only that row while it is still at version 1. Each of those is
a bare string literal, so each is pinned here against the revision source. No
database is needed.
"""

from __future__ import annotations

import re
from pathlib import Path

from tests._alembic_harness import backend_root, load_revision_module

_REVISION_ID = "cihost_01"
_PARENT_REVISION_ID = "mdroles_01"
_REVISION_FILENAME = "cihost_01_qontinui_tenant_hosted_ci_off.py"
_TENANT_ID = "c231d9da-0ca8-4fe4-bd81-0e3d6c20339a"
_UPDATED_BY = "migration:cihost_01"

_PATH: Path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _source() -> str:
    return _PATH.read_text(encoding="utf-8")


def _function_body(name: str) -> str:
    """The text of one top-level ``def`` in the revision, up to the next one."""
    src = _source()
    match = re.search(rf"^def {name}\(.*?(?=^def |\Z)", src, re.S | re.M)
    assert match, f"{name}() not found in {_REVISION_FILENAME}"
    return match.group(0)


def _normalised(sql: str) -> str:
    return re.sub(r"\s+", " ", sql)


def test_revision_chain() -> None:
    module = load_revision_module(_PATH, "cihost_01_under_test")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_writes_the_qontinui_tenant_band_row_off() -> None:
    body = _normalised(_function_body("upgrade"))
    assert "INSERT INTO coord.fleet_runtime_policy " in body
    assert (
        f"'{_TENANT_ID}'::uuid, 'github_hosted_ci', 'tenant', NULL, 'off', true, 1, '{_UPDATED_BY}', now()"
        in body
    )


def test_upgrade_is_guarded_by_tenant_existence() -> None:
    body = _normalised(_function_body("upgrade"))
    assert (
        f"WHERE EXISTS ( SELECT 1 FROM coord.tenants WHERE tenant_id = '{_TENANT_ID}'::uuid )"
        in body
    )


def test_upgrade_never_overwrites_an_existing_choice() -> None:
    body = _normalised(_function_body("upgrade"))
    # The conflict target must be the functional unique index
    # uq_fleet_runtime_policy_scope's exact expression (fleet_policy_01).
    assert (
        "ON CONFLICT (tenant_id, domain, scope_band, COALESCE(scope_key, '')) DO NOTHING"
        in body
    )
    assert "DO UPDATE" not in body


def test_upgrade_snapshots_only_the_row_it_wrote() -> None:
    body = _normalised(_function_body("upgrade"))
    assert "WITH ins AS ( INSERT INTO coord.fleet_runtime_policy " in body
    assert "RETURNING id )" in body
    assert "INSERT INTO coord.fleet_runtime_policy_versions" in body
    assert "SELECT ins.id, 1, 'off', true," in body
    assert "FROM ins" in body
    assert "ed245b84" in body
    assert body.count(f"'{_UPDATED_BY}'") == 2


def test_upgrade_touches_no_other_tenant() -> None:
    body = _function_body("upgrade")
    uuids = set(
        re.findall(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", body
        )
    )
    assert uuids == {_TENANT_ID}


def test_no_ddl() -> None:
    src = _source()
    # Strip the docstring: it names the DDL this revision does NOT do.
    code = src.split('"""', 2)[2]
    for keyword in ("CREATE", "ALTER", "DROP", "TRUNCATE"):
        assert not re.search(rf"\b{keyword}\b", code, re.I), keyword
    for helper in (
        "create_table",
        "drop_table",
        "add_column",
        "drop_column",
        "create_index",
        "drop_index",
    ):
        assert f"op.{helper}" not in code, helper


def test_downgrade_is_bound_to_this_revisions_version_one_row() -> None:
    body = _normalised(_function_body("downgrade"))
    statements = body.split("op.execute(")[1:]
    assert len(statements) == 2
    versions_delete, parent_delete = statements
    assert "DELETE FROM coord.fleet_runtime_policy_versions" in versions_delete
    assert "DELETE FROM coord.fleet_runtime_policy " in parent_delete
    for stmt in statements:
        assert f"tenant_id = '{_TENANT_ID}'::uuid" in stmt
        assert "domain = 'github_hosted_ci'" in stmt
        assert "scope_band = 'tenant'" in stmt
        assert f"updated_by = '{_UPDATED_BY}'" in stmt
        assert "current_version = 1" in stmt
