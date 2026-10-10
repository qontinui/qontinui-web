"""Tests for the alembic DATA revision ``fleet_policy_egress_01_transcript_sync``.

Plan ``2026-10-10-spec-front-end-phase-9-generic-boundary`` Phase 6 step 3(b):
copy every ``coord.tenant_policies.transcript_sync_enabled = false`` into
tenant-band ``off`` rows for BOTH ``egress_transcript_sync`` and
``egress_terminal_stream`` (the column governed both session-output streams),
each with its v1 snapshot; never overwrite a domain row a tenant already wrote;
on downgrade remove only the rows this revision wrote while still at version 1.

Two layers, as in ``test_cihost_01_migration``: source pins (no database), and
a DB-backed round trip through the real chain (skipped when the test Postgres
is unreachable; ``QONTINUI_TEST_PG`` / ``QONTINUI_TEST_PG_DSN`` point it at
one).
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

_REVISION_ID = "fleet_policy_egress_01_transcript_sync"
_PARENT_REVISION_ID = "census_idx_01_device_repo_path_observed"
_UPDATED_BY = "migration:fleet_policy_egress_01_transcript_sync"
_TRANSCRIPT = "egress_transcript_sync"
_TERMINAL = "egress_terminal_stream"
_DOMAINS = (_TERMINAL, _TRANSCRIPT)

_PATH: Path = backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py"


def _source() -> str:
    return _PATH.read_text(encoding="utf-8")


def _function_body(name: str) -> str:
    match = re.search(rf"^def {name}\(.*?(?=^def |\Z)", _source(), re.S | re.M)
    assert match, f"{name}() not found"
    return match.group(0)


def _normalised(sql: str) -> str:
    return re.sub(r"\s+", " ", sql)


def test_revision_chain() -> None:
    module = load_revision_module(_PATH, "fleet_policy_egress_01_under_test")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_copies_only_opted_out_tenants_into_both_stream_domains() -> None:
    body = _normalised(_function_body("upgrade"))
    assert "WHERE tp.transcript_sync_enabled = false" in body
    assert f"(VALUES ('{_TRANSCRIPT}'), ('{_TERMINAL}')) AS d(domain)" in body
    assert (
        f"SELECT tp.tenant_id, d.domain, 'tenant', NULL, 'off', true, 1, '{_UPDATED_BY}', now()"
        in body
    )


def test_upgrade_never_overwrites_an_existing_domain_row() -> None:
    body = _normalised(_function_body("upgrade"))
    assert (
        "ON CONFLICT (tenant_id, domain, scope_band, COALESCE(scope_key, '')) DO NOTHING"
        in body
    )
    assert "DO UPDATE" not in body


def test_upgrade_snapshots_only_rows_it_wrote() -> None:
    body = _normalised(_function_body("upgrade"))
    assert "WITH ins AS ( INSERT INTO coord.fleet_runtime_policy " in body
    assert "RETURNING id )" in body
    assert "SELECT ins.id, 1, 'off', true," in body
    assert body.count(f"'{_UPDATED_BY}'") == 2


def test_no_ddl() -> None:
    code = _source().split('"""', 2)[2]
    for keyword in ("CREATE", "ALTER", "DROP", "TRUNCATE"):
        assert not re.search(rf"\b{keyword}\b", code, re.I), keyword


def test_downgrade_is_bound_to_this_revisions_version_one_rows() -> None:
    body = _normalised(_function_body("downgrade"))
    statements = body.split("op.execute(")[1:]
    assert len(statements) == 2
    assert "DELETE FROM coord.fleet_runtime_policy_versions" in statements[0]
    assert "DELETE FROM coord.fleet_runtime_policy " in statements[1]
    for stmt in statements:
        assert f"domain IN ('{_TRANSCRIPT}', '{_TERMINAL}')" in stmt
        assert "scope_band = 'tenant'" in stmt
        assert f"updated_by = '{_UPDATED_BY}'" in stmt
        assert "current_version = 1" in stmt


# ---------------------------------------------------------------------------
# DB-backed round trip
# ---------------------------------------------------------------------------

_DOMAIN_ROWS_SQL = """
    SELECT tenant_id::text, domain, level, master_enabled, current_version, updated_by
      FROM coord.fleet_runtime_policy
     WHERE domain IN ('egress_transcript_sync', 'egress_terminal_stream')
       AND scope_band = 'tenant'
     ORDER BY tenant_id, domain
"""

_SNAPSHOTS_SQL = """
    SELECT p.tenant_id::text, p.domain, v.version, v.level, v.updated_by
      FROM coord.fleet_runtime_policy_versions v
      JOIN coord.fleet_runtime_policy p ON p.id = v.policy_id
     WHERE p.domain IN ('egress_transcript_sync', 'egress_terminal_stream')
     ORDER BY p.tenant_id, p.domain, v.version
"""


def _rows(engine: Engine, sql: str) -> list[tuple[object, ...]]:
    with engine.connect() as conn:
        return [tuple(r) for r in conn.execute(text(sql))]


def _insert_tenant(
    engine: Engine, tenant_id: str, *, sync_enabled: bool | None
) -> None:
    """A tenant, plus a ``tenant_policies`` row unless ``sync_enabled`` is None."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (CAST(:t AS uuid), :slug, 'egress_01 fixture tenant')"
            ),
            {"t": tenant_id, "slug": f"egress01-{uuid.uuid4().hex[:8]}"},
        )
        if sync_enabled is not None:
            conn.execute(
                text(
                    "INSERT INTO coord.tenant_policies (tenant_id, transcript_sync_enabled) "
                    "VALUES (CAST(:t AS uuid), :e)"
                ),
                {"t": tenant_id, "e": sync_enabled},
            )


def _insert_domain_row(
    engine: Engine,
    tenant_id: str,
    domain: str,
    *,
    level: str,
    version: int,
    updated_by: str,
) -> None:
    with engine.begin() as conn:
        policy_id = conn.execute(
            text(
                """
                INSERT INTO coord.fleet_runtime_policy
                    (tenant_id, domain, scope_band, scope_key, level,
                     master_enabled, current_version, updated_by)
                VALUES (CAST(:t AS uuid), :d, 'tenant', NULL, :l, true, :v, :by)
                RETURNING id
                """
            ),
            {"t": tenant_id, "d": domain, "l": level, "v": version, "by": updated_by},
        ).scalar_one()
        for v in range(1, version + 1):
            conn.execute(
                text(
                    "INSERT INTO coord.fleet_runtime_policy_versions "
                    "(policy_id, version, level, master_enabled, change_note, updated_by) "
                    "VALUES (:p, :v, :l, true, 'test fixture', :by)"
                ),
                {"p": policy_id, "v": v, "l": level, "by": updated_by},
            )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG=host:port or QONTINUI_TEST_PG_DSN."
    ),
)
def test_round_trip_copies_each_off_to_both_streams_and_removes_only_its_own_rows() -> (
    None
):
    root = backend_root()
    opted_out = str(uuid.uuid4())
    opted_in = str(uuid.uuid4())
    no_policy_row = str(uuid.uuid4())
    already_chose = str(uuid.uuid4())
    edited_later = str(uuid.uuid4())
    operator = "operator@example.com"

    with ephemeral_database(admin_database_url(), "egress01_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _insert_tenant(engine, opted_out, sync_enabled=False)
        _insert_tenant(engine, opted_in, sync_enabled=True)
        _insert_tenant(engine, no_policy_row, sync_enabled=None)
        # Column says off; the tenant already wrote the transcript domain ON.
        _insert_tenant(engine, already_chose, sync_enabled=False)
        _insert_domain_row(
            engine,
            already_chose,
            _TRANSCRIPT,
            level="on",
            version=1,
            updated_by=operator,
        )
        operator_row = (already_chose, _TRANSCRIPT, "on", True, 1, operator)
        operator_snap = (already_chose, _TRANSCRIPT, 1, "on", operator)

        # 1. Upgrade: both streams' rows for the opted-out tenant; for the tenant
        #    that already chose transcript, only the terminal row is new.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        copied = [(opted_out, d, "off", True, 1, _UPDATED_BY) for d in _DOMAINS] + [
            (already_chose, _TERMINAL, "off", True, 1, _UPDATED_BY)
        ]
        assert sorted(_rows(engine, _DOMAIN_ROWS_SQL)) == sorted(
            [*copied, operator_row]
        )
        assert sorted(_rows(engine, _SNAPSHOTS_SQL)) == sorted(
            [(t, d, 1, "off", _UPDATED_BY) for t, d, *_ in copied] + [operator_snap]
        )

        # 2. Re-run over its own output mints nothing new.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert sorted(_rows(engine, _DOMAIN_ROWS_SQL)) == sorted(
            [*copied, operator_row]
        )
        assert len(_rows(engine, _SNAPSHOTS_SQL)) == len(copied) + 1

        # 3. Downgrade removes the copied rows and their snapshots only.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _rows(engine, _DOMAIN_ROWS_SQL) == [operator_row]
        assert _rows(engine, _SNAPSHOTS_SQL) == [operator_snap]

        # 4. A migration row since edited to version 2 survives the downgrade.
        _insert_tenant(engine, edited_later, sync_enabled=False)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.fleet_runtime_policy SET current_version = 2, level = 'on' "
                    "WHERE tenant_id = CAST(:t AS uuid) AND domain = :d"
                ),
                {"t": edited_later, "d": _TERMINAL},
            )
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        remaining = {(r[0], r[1]) for r in _rows(engine, _DOMAIN_ROWS_SQL)}
        assert remaining == {(already_chose, _TRANSCRIPT), (edited_later, _TERMINAL)}
