"""Tests for ``tenant_policies_03_drop_transcript_sync_enabled``.

Plan ``2026-10-10-spec-front-end-phase-9-generic-boundary`` Phase 6 step 3(d):
the upgrade drops ``coord.tenant_policies.transcript_sync_enabled`` and nothing
else; the downgrade re-adds it with its original default and restores ``false``
for EVERY tenant whose ``egress_transcript_sync`` or ``egress_terminal_stream``
resolves off — a tenant row, a system row, or (under
``COORD_DEPLOYMENT_PROFILE=self_hosted``) the deployment default — including a
tenant with no ``tenant_policies`` row.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "tenant_policies_03_drop_transcript_sync_enabled"
_PARENT_REVISION_ID = "fleet_policy_egress_01_transcript_sync"
_PATH: Path = backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py"

_DB_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG=host:port or QONTINUI_TEST_PG_DSN."
    ),
)


def test_revision_chain() -> None:
    module = load_revision_module(_PATH, "tenant_policies_03_under_test")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def _sync_flags(engine: Engine, tenants: set[str]) -> dict[str, bool]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT tenant_id::text, transcript_sync_enabled FROM coord.tenant_policies"
            )
        )
        return {r[0]: r[1] for r in rows if r[0] in tenants}


def _tenant(engine: Engine, *, policy_row: bool) -> str:
    tenant = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (CAST(:t AS uuid), :s, 'tp03 fixture')"
            ),
            {"t": tenant, "s": f"tp03-{uuid.uuid4().hex[:8]}"},
        )
        if policy_row:
            conn.execute(
                text(
                    "INSERT INTO coord.tenant_policies (tenant_id) VALUES (CAST(:t AS uuid))"
                ),
                {"t": tenant},
            )
    return tenant


def _row(
    engine: Engine, tenant: str, domain: str, band: str, level: str, master: bool
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.fleet_runtime_policy "
                "(tenant_id, domain, scope_band, scope_key, level, master_enabled, updated_by) "
                "VALUES (CAST(:t AS uuid), :d, :b, NULL, :l, :m, 'test')"
            ),
            {"t": tenant, "d": domain, "b": band, "l": level, "m": master},
        )


@_DB_SKIP
def test_round_trip_drops_the_column_and_downgrade_restores_each_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("COORD_DEPLOYMENT_PROFILE", raising=False)
    root = backend_root()
    with ephemeral_database(admin_database_url(), "tp03_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        transcript_off = _tenant(engine, policy_row=True)
        terminal_off = _tenant(engine, policy_row=True)
        master_off = _tenant(engine, policy_row=True)
        on_row = _tenant(engine, policy_row=True)
        no_row = _tenant(engine, policy_row=True)
        off_without_policy_row = _tenant(engine, policy_row=False)
        system_off = _tenant(engine, policy_row=False)
        tenant_on_beats_system_off = _tenant(engine, policy_row=True)
        _row(engine, transcript_off, "egress_transcript_sync", "tenant", "off", True)
        _row(engine, terminal_off, "egress_terminal_stream", "tenant", "off", True)
        _row(engine, master_off, "egress_transcript_sync", "tenant", "on", False)
        _row(engine, on_row, "egress_transcript_sync", "tenant", "on", True)
        _row(
            engine,
            off_without_policy_row,
            "egress_terminal_stream",
            "tenant",
            "off",
            True,
        )
        _row(engine, system_off, "egress_transcript_sync", "system", "off", True)
        _row(
            engine,
            tenant_on_beats_system_off,
            "egress_transcript_sync",
            "system",
            "off",
            True,
        )
        _row(
            engine,
            tenant_on_beats_system_off,
            "egress_transcript_sync",
            "tenant",
            "on",
            True,
        )
        assert (
            column_info(engine, "tenant_policies", "transcript_sync_enabled")
            is not None
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, "tenant_policies", "transcript_sync_enabled") is None
        assert (
            column_info(engine, "tenant_policies", "session_coordination_enabled")
            is not None
        )

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        mine = {
            transcript_off,
            terminal_off,
            master_off,
            on_row,
            no_row,
            off_without_policy_row,
            system_off,
            tenant_on_beats_system_off,
        }
        assert _sync_flags(engine, mine) == {
            transcript_off: False,
            terminal_off: False,
            master_off: False,
            on_row: True,
            no_row: True,
            # A tenant with no tenant_policies row gets one carrying its off.
            off_without_policy_row: False,
            system_off: False,
            tenant_on_beats_system_off: True,
        }


@_DB_SKIP
def test_self_hosted_downgrade_restores_off_for_tenants_with_no_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "tp03_sh_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        defaulted = _tenant(engine, policy_row=True)
        turned_on = _tenant(engine, policy_row=True)
        for domain in ("egress_transcript_sync", "egress_terminal_stream"):
            _row(engine, turned_on, domain, "tenant", "on", True)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        monkeypatch.setenv("COORD_DEPLOYMENT_PROFILE", "self_hosted")
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _sync_flags(engine, {defaulted, turned_on}) == {
            defaulted: False,
            turned_on: True,
        }
