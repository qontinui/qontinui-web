"""Round-trip test for ``devcredrev_01`` and ``paircode_bind_01``.

Plan ``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-
qontinui-web``. ``devcredrev_01`` adds the device-scoped credential deny
``coord.devices.credential_revoked_at`` that coord's refresh and service-mint
READ (coord ships a read of it, so the column must exist first);
``paircode_bind_01`` adds ``auth.pair_codes.bound_device_id`` /
``delivered_at``. Both must be nullable with no default — every existing row
means "not revoked" / "an ordinary unbound code" — and both must reverse.

Substrate: ``_alembic_harness`` (an ephemeral database migrated by the real
chain). Without a reachable Postgres the DB test skips; the chain test runs.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
)

_DEVCRED = "devcredrev_01_devices_credential_revoked_at"
_PAIRBIND = "paircode_bind_01_bound_device_delivered"
_VERSIONS = backend_root() / "alembic" / "versions"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _module(revision: str):
    path: Path = _VERSIONS / f"{revision}.py"
    return load_revision_module(path, f"_test_{revision}")


def test_the_two_revisions_chain_in_order() -> None:
    devcred = _module(_DEVCRED)
    pairbind = _module(_PAIRBIND)
    assert devcred.revision == _DEVCRED
    assert pairbind.revision == _PAIRBIND
    assert pairbind.down_revision == _DEVCRED
    assert isinstance(devcred.down_revision, str) and devcred.down_revision


@_needs_pg
def test_upgrade_adds_nullable_columns_and_downgrade_removes_them() -> None:
    with ephemeral_database(admin_database_url(), "dcr01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PAIRBIND)

        assert column_info(engine, "devices", "credential_revoked_at") == (
            "timestamp with time zone",
            "YES",
            None,
        )
        assert column_info(engine, "pair_codes", "bound_device_id", schema="auth") == (
            "uuid",
            "YES",
            None,
        )
        assert column_info(engine, "pair_codes", "delivered_at", schema="auth") == (
            "timestamp with time zone",
            "YES",
            None,
        )
        assert index_exists(
            engine, "idx_pair_codes_bound_device_pending", schema="auth"
        )

        run_alembic(backend_root(), db_url, "downgrade", _DEVCRED)
        assert (
            column_info(engine, "pair_codes", "bound_device_id", schema="auth") is None
        )
        assert column_info(engine, "pair_codes", "delivered_at", schema="auth") is None
        assert not index_exists(
            engine, "idx_pair_codes_bound_device_pending", schema="auth"
        )
        assert column_info(engine, "devices", "credential_revoked_at") is not None

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        assert column_info(engine, "devices", "credential_revoked_at") is None

        # And forward again — the pair is re-appliable after a reversal.
        run_alembic(backend_root(), db_url, "upgrade", _PAIRBIND)
        assert column_info(engine, "devices", "credential_revoked_at") is not None
        assert (
            column_info(engine, "pair_codes", "delivered_at", schema="auth") is not None
        )
