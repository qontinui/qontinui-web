"""Source-pinned test for the alembic DATA revision ``ciorch_01``.

Plan ``2026-10-04-coord-managed-ci-for-every-tenant-with-an-actions-free-mode``
Phase 1 (design decision D1): seed every tenant existing at migration time with
an explicit tenant-band ``ci_orchestrator = github_actions`` fleet-policy row,
with its version-1 snapshot, so coord's later no-row ``coord`` default never
flips an existing tenant silently.

The revision authors no schema, so its whole contract is the SQL text: which
domain, band and level it writes; that it writes one row per ``coord.tenants``
row; that it never overwrites a choice already made; that it writes the
snapshot only for a row it wrote; and that the downgrade deletes only those
rows while they are still at version 1.

Two layers, mirroring ``test_cihost_01_migration.py``:

* **Source pins** (always run, no database).
* **A DB-backed round-trip** (``_alembic_harness``; skipped when the test
  Postgres is unreachable — ``QONTINUI_TEST_PG`` points it elsewhere). It walks:
  every tenant seeded except one holding an operator choice; the operator row
  untouched; re-run mints nothing; downgrade removes exactly the seeded rows and
  snapshots, keeping the operator row, a seeded row an operator has since
  edited (version 2), and decoys that each fail exactly one downgrade guard.
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

_REVISION_ID = "ciorch_01"
_PARENT_REVISION_ID = "coord_ci_pool_observations_01"
_REVISION_FILENAME = "ciorch_01_seed_ci_orchestrator_github_actions.py"
_TRIPLE_QUOTE = (
    chr(34) * 3
)  # spelled indirectly: a literal triple quote here confuses line-based code scanners
_DOMAIN = "ci_orchestrator"
_LEVEL = "github_actions"
_UPDATED_BY = "alembic:ciorch_01"

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
    module = load_revision_module(_PATH, "ciorch_01_under_test")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_writes_a_tenant_band_github_actions_row_per_tenant() -> None:
    body = _normalised(_function_body("upgrade"))
    assert "INSERT INTO coord.fleet_runtime_policy " in body
    assert (
        f"SELECT t.tenant_id, '{_DOMAIN}', 'tenant', NULL, '{_LEVEL}', "
        f"true, 1, '{_UPDATED_BY}', now() FROM coord.tenants t" in body
    )


def test_upgrade_names_no_specific_tenant() -> None:
    body = _function_body("upgrade")
    assert not re.search(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", body
    )
    assert (
        "WHERE"
        not in _normalised(body)
        .split("FROM coord.tenants t", 1)[1]
        .split("ON CONFLICT", 1)[0]
    )


def test_upgrade_never_overwrites_an_existing_choice() -> None:
    body = _normalised(_function_body("upgrade"))
    assert (
        "ON CONFLICT (tenant_id, domain, scope_band, COALESCE(scope_key, '')) DO NOTHING"
        in body
    )
    assert "DO UPDATE" not in body


def test_upgrade_snapshots_only_the_rows_it_wrote() -> None:
    body = _normalised(_function_body("upgrade"))
    assert "WITH ins AS ( INSERT INTO coord.fleet_runtime_policy " in body
    assert "RETURNING id )" in body
    assert "INSERT INTO coord.fleet_runtime_policy_versions" in body
    assert f"SELECT ins.id, 1, '{_LEVEL}', true," in body
    assert "FROM ins" in body
    assert body.count(f"'{_UPDATED_BY}'") == 2


def test_no_ddl() -> None:
    code = _source().split(_TRIPLE_QUOTE, 2)[2]
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


def test_downgrade_is_bound_to_this_revisions_version_one_rows() -> None:
    body = _normalised(_function_body("downgrade"))
    statements = body.split("op.execute(")[1:]
    assert len(statements) == 2
    versions_delete, parent_delete = statements
    assert "DELETE FROM coord.fleet_runtime_policy_versions" in versions_delete
    assert "DELETE FROM coord.fleet_runtime_policy " in parent_delete
    for stmt in statements:
        assert f"domain = '{_DOMAIN}'" in stmt
        assert "scope_band = 'tenant'" in stmt
        assert f"updated_by = '{_UPDATED_BY}'" in stmt
        assert "current_version = 1" in stmt


# ---------------------------------------------------------------------------
# DB-backed round-trip
# ---------------------------------------------------------------------------

_CHANGE_NOTE = (
    "Plan 2026-10-04-coord-managed-ci-for-every-tenant-with-an-actions-free-mode "
    "D1: existing tenant pinned to github_actions so the coord no-row "
    "default never flips it silently"
)

_ALL_PARENTS_SQL = """
    SELECT tenant_id::text, domain, scope_band, scope_key, level,
           master_enabled, current_version, updated_by
      FROM coord.fleet_runtime_policy
     ORDER BY tenant_id, domain, scope_band, COALESCE(scope_key, '')
"""

_ALL_SNAPSHOTS_SQL = """
    SELECT p.tenant_id::text, p.domain, p.scope_band, p.scope_key,
           v.version, v.level, v.master_enabled, v.change_note, v.updated_by
      FROM coord.fleet_runtime_policy_versions v
      JOIN coord.fleet_runtime_policy p ON p.id = v.policy_id
     ORDER BY p.tenant_id, p.domain, p.scope_band,
              COALESCE(p.scope_key, ''), v.version
"""

Row = tuple[object, ...]


def _canon(rows: list[Row]) -> list[Row]:
    """Order rows in Python, so no comparison depends on the DB's collation."""
    return sorted(rows, key=repr)


def _rows(engine: Engine, sql: str) -> list[Row]:
    with engine.connect() as conn:
        return _canon([tuple(r) for r in conn.execute(text(sql))])


def _tenant_ids(engine: Engine) -> list[str]:
    return sorted(
        str(r[0]) for r in _rows(engine, "SELECT tenant_id::text FROM coord.tenants")
    )


def _is_tenant_band_target(row: Row) -> bool:
    return row[1] == _DOMAIN and row[2] == "tenant"


def _insert_tenant(engine: Engine) -> str:
    tenant_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (CAST(:t AS uuid), :slug, 'ciorch_01 fixture tenant')
                """
            ),
            {"t": tenant_id, "slug": f"ciorch-test-{uuid.uuid4().hex[:8]}"},
        )
    return tenant_id


def _insert_policy(
    engine: Engine,
    *,
    tenant_id: str,
    domain: str,
    scope_band: str,
    scope_key: str | None,
    level: str,
    current_version: int,
    updated_by: str,
) -> None:
    """Insert a parent row plus a snapshot for each version 1..current_version."""
    with engine.begin() as conn:
        policy_id = conn.execute(
            text(
                """
                INSERT INTO coord.fleet_runtime_policy
                    (tenant_id, domain, scope_band, scope_key, level,
                     master_enabled, current_version, updated_by)
                VALUES (CAST(:t AS uuid), :d, :b, :k, :l, true, :v, :by)
                RETURNING id
                """
            ),
            {
                "t": tenant_id,
                "d": domain,
                "b": scope_band,
                "k": scope_key,
                "l": level,
                "v": current_version,
                "by": updated_by,
            },
        ).scalar_one()
        for version in range(1, current_version + 1):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.fleet_runtime_policy_versions
                        (policy_id, version, level, master_enabled,
                         change_note, updated_by)
                    VALUES (:p, :v, :l, true, 'test fixture', :by)
                    """
                ),
                {"p": policy_id, "v": version, "l": level, "by": updated_by},
            )


def _seeded_parent(tenant_id: str) -> Row:
    return (tenant_id, _DOMAIN, "tenant", None, _LEVEL, True, 1, _UPDATED_BY)


def _seeded_snapshot(tenant_id: str) -> Row:
    return (
        tenant_id,
        _DOMAIN,
        "tenant",
        None,
        1,
        _LEVEL,
        True,
        _CHANGE_NOTE,
        _UPDATED_BY,
    )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=host:port to a "
        "backend Postgres before running this test."
    ),
)
def test_ciorch_01_round_trip() -> None:
    """Seeds every tenant; downgrade removes only the rows this revision wrote."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "ciorch_01_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        plain_a = _insert_tenant(engine)
        plain_b = _insert_tenant(engine)
        chooser = _insert_tenant(engine)

        # An operator's existing tenant-band choice: must survive untouched.
        _insert_policy(
            engine,
            tenant_id=chooser,
            domain=_DOMAIN,
            scope_band="tenant",
            scope_key=None,
            level="coord",
            current_version=1,
            updated_by="operator@example.com",
        )
        # Decoys that each fail exactly one downgrade guard while matching the
        # others (domain; scope_band). The updated_by guard is probed by the
        # chooser row, the current_version guard by step 4's edited row.
        _insert_policy(
            engine,
            tenant_id=plain_a,
            domain="ciorch_test_other_domain",
            scope_band="tenant",
            scope_key=None,
            level=_LEVEL,
            current_version=1,
            updated_by=_UPDATED_BY,
        )
        _insert_policy(
            engine,
            tenant_id=plain_a,
            domain=_DOMAIN,
            scope_band="repo",
            scope_key="qontinui/ciorch-test",
            level=_LEVEL,
            current_version=1,
            updated_by=_UPDATED_BY,
        )

        tenants = _tenant_ids(engine)
        # The chain mints its own system tenant; ours are three more.
        assert {plain_a, plain_b, chooser} <= set(tenants)
        before_parents = _rows(engine, _ALL_PARENTS_SQL)
        before_snapshots = _rows(engine, _ALL_SNAPSHOTS_SQL)

        def expected_after_upgrade() -> tuple[list[Row], list[Row]]:
            seeded = [t for t in tenants if t != chooser]
            return (
                _canon(before_parents + [_seeded_parent(t) for t in seeded]),
                _canon(before_snapshots + [_seeded_snapshot(t) for t in seeded]),
            )

        # 1. Upgrade: every tenant without a tenant-band row gets the seed;
        #    the chooser's row and every decoy are untouched.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        exp_parents, exp_snapshots = expected_after_upgrade()
        assert _rows(engine, _ALL_PARENTS_SQL) == exp_parents
        assert _rows(engine, _ALL_SNAPSHOTS_SQL) == exp_snapshots
        tenant_band = [
            r for r in _rows(engine, _ALL_PARENTS_SQL) if _is_tenant_band_target(r)
        ]
        assert sorted(str(r[0]) for r in tenant_band) == tenants

        # 2. Re-run over its own output mints nothing new.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _rows(engine, _ALL_PARENTS_SQL) == exp_parents
        assert _rows(engine, _ALL_SNAPSHOTS_SQL) == exp_snapshots

        # 3. Downgrade removes exactly the seeded rows and their snapshots.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _rows(engine, _ALL_PARENTS_SQL) == before_parents
        assert _rows(engine, _ALL_SNAPSHOTS_SQL) == before_snapshots

        # 4. current_version guard: a seeded row an operator has since edited to
        #    version 2 (updated_by unchanged) survives the downgrade.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            policy_id = conn.execute(
                text(
                    """
                    UPDATE coord.fleet_runtime_policy
                       SET current_version = 2, level = 'coord'
                     WHERE tenant_id = CAST(:t AS uuid) AND domain = :d
                       AND scope_band = 'tenant'
                    RETURNING id
                    """
                ),
                {"t": plain_b, "d": _DOMAIN},
            ).scalar_one()
            conn.execute(
                text(
                    """
                    INSERT INTO coord.fleet_runtime_policy_versions
                        (policy_id, version, level, master_enabled,
                         change_note, updated_by)
                    VALUES (:p, 2, 'coord', true, 'test edit', :by)
                    """
                ),
                {"p": policy_id, "by": _UPDATED_BY},
            )
        edited = [r for r in _rows(engine, _ALL_PARENTS_SQL) if r[0] == plain_b]
        edited_snaps = [r for r in _rows(engine, _ALL_SNAPSHOTS_SQL) if r[0] == plain_b]
        assert len(edited_snaps) == 2

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _rows(engine, _ALL_PARENTS_SQL) == _canon(before_parents + edited)
        assert _rows(engine, _ALL_SNAPSHOTS_SQL) == _canon(
            before_snapshots + edited_snaps
        )
