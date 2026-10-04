"""Source-pinned test for the alembic DATA revision ``cihost_01``.

Plan ``2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting`` Phase 1
(design decision D2): seed the qontinui tenant's ``github_hosted_ci``
fleet-policy dial OFF, with its version-1 snapshot, and nothing else.

The revision authors no schema, so its whole contract is the SQL text: which
tenant, domain, band and level it writes; that it never overwrites a choice
already made; that it writes the snapshot only for a row it wrote; and that the
downgrade deletes only that row while it is still at version 1.

Two layers:

* **Source pins** (always run, no database): each of those facts is a bare
  string literal, so each is pinned against the revision source.
* **A DB-backed round-trip** (``_alembic_harness``; skipped when the test
  Postgres is unreachable, like every harness test — ``QONTINUI_TEST_PG``
  points it elsewhere). The source pins cannot see a column list whose names
  are swapped relative to its values; only reading the written rows back can.
  It walks: no tenant → no-op; tenant present → exactly the row and its v1
  snapshot; re-run → nothing new; downgrade → both gone; a pre-existing
  operator row → untouched by upgrade AND downgrade; another tenant → never
  written.
"""

from __future__ import annotations

import re
import uuid
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
)

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


# ---------------------------------------------------------------------------
# DB-backed round-trip
# ---------------------------------------------------------------------------

_CHANGE_NOTE = (
    "Operator directive 2026-10-04 (coord memory ed245b84): "
    "GitHub-hosted CI is OFF permanently for the Qontinui tenant"
)

_PARENT_ROWS_SQL = """
    SELECT tenant_id::text, domain, scope_band, scope_key, level,
           master_enabled, current_version, updated_by, id
      FROM coord.fleet_runtime_policy
     WHERE domain = 'github_hosted_ci'
     ORDER BY tenant_id
"""

_SNAPSHOTS_SQL = """
    SELECT v.policy_id, v.version, v.level, v.master_enabled,
           v.change_note, v.updated_by
      FROM coord.fleet_runtime_policy_versions v
      JOIN coord.fleet_runtime_policy p ON p.id = v.policy_id
     WHERE p.domain = 'github_hosted_ci'
     ORDER BY v.policy_id, v.version
"""


def _rows(engine: Engine, sql: str) -> list[tuple[object, ...]]:
    with engine.connect() as conn:
        return [tuple(r) for r in conn.execute(text(sql))]


def _insert_tenant(engine: Engine, tenant_id: str) -> None:
    # The chain mints its own system tenant (slug ``qontinui``, random id), so
    # the fixture tenant takes the production id under a unique test slug.
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (CAST(:t AS uuid), :slug, 'cihost_01 fixture tenant')
                """
            ),
            {"t": tenant_id, "slug": f"cihost-test-{uuid.uuid4().hex[:8]}"},
        )


def _assert_seeded(engine: Engine) -> None:
    """Exactly the qontinui row, every column read back, plus its v1 snapshot."""
    parents = _rows(engine, _PARENT_ROWS_SQL)
    assert len(parents) == 1, parents
    (tenant, domain, band, key, level, master, version, by, policy_id) = parents[0]
    assert tenant == _TENANT_ID
    assert domain == "github_hosted_ci"
    assert band == "tenant"
    assert key is None
    assert level == "off"
    assert master is True
    assert version == 1
    assert by == _UPDATED_BY

    snapshots = _rows(engine, _SNAPSHOTS_SQL)
    assert snapshots == [(policy_id, 1, "off", True, _CHANGE_NOTE, _UPDATED_BY)]


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=host:port to a "
        "backend Postgres before running this test."
    ),
)
def test_cihost_01_round_trip_writes_only_its_own_row() -> None:
    root = backend_root()
    other_tenant = str(uuid.uuid4())

    with ephemeral_database(admin_database_url(), "cihost_01_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        # 1. No qontinui tenant in this database: the upgrade is a no-op.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _rows(engine, _PARENT_ROWS_SQL) == []
        assert _rows(engine, _SNAPSHOTS_SQL) == []
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)

        # 2. Tenant present (plus an unrelated tenant): exactly one row + v1.
        _insert_tenant(engine, _TENANT_ID)
        _insert_tenant(engine, other_tenant)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_seeded(engine)

        # 3. Re-run over its own output mints nothing new.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_seeded(engine)

        # 4. Downgrade removes both the row and its snapshot.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _rows(engine, _PARENT_ROWS_SQL) == []
        assert _rows(engine, _SNAPSHOTS_SQL) == []

        # 5. A choice the operator already made survives upgrade AND downgrade.
        with engine.begin() as conn:
            policy_id = conn.execute(
                text(
                    """
                    INSERT INTO coord.fleet_runtime_policy
                        (tenant_id, domain, scope_band, scope_key, level,
                         master_enabled, current_version, updated_by)
                    VALUES (CAST(:t AS uuid), 'github_hosted_ci', 'tenant',
                            NULL, 'on', true, 2, 'operator@example.com')
                    RETURNING id
                    """
                ),
                {"t": _TENANT_ID},
            ).scalar_one()
            for version, level in ((1, "off"), (2, "on")):
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.fleet_runtime_policy_versions
                            (policy_id, version, level, master_enabled,
                             change_note, updated_by)
                        VALUES (:p, :v, :l, true, 'operator edit',
                                'operator@example.com')
                        """
                    ),
                    {"p": policy_id, "v": version, "l": level},
                )
        before_parents = _rows(engine, _PARENT_ROWS_SQL)
        before_snapshots = _rows(engine, _SNAPSHOTS_SQL)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _rows(engine, _PARENT_ROWS_SQL) == before_parents
        assert _rows(engine, _SNAPSHOTS_SQL) == before_snapshots

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _rows(engine, _PARENT_ROWS_SQL) == before_parents
        assert _rows(engine, _SNAPSHOTS_SQL) == before_snapshots

        # The unrelated tenant was never written, at any step.
        assert all(row[0] != other_tenant for row in before_parents)
