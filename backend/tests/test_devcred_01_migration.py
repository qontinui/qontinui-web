"""Round-trip test for ``devcred_01_credential_deny_and_bound_pair_codes``.

Plan ``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-
qontinui-web``. One revision adds the device-scoped credential deny
``coord.devices.credential_revoked_at`` that coord's refresh and service-mint
READ (coord ships a read of it, so the column must exist first), plus
``auth.pair_codes.bound_device_id`` / ``delivered_at`` and their index. Both must be nullable with no default — every existing row
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

_REVISION = "devcred_01_credential_deny_and_bound_pair_codes"
_VERSIONS = backend_root() / "alembic" / "versions"
_INDEX = "idx_pair_codes_bound_device_pending"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _module():
    path: Path = _VERSIONS / f"{_REVISION}.py"
    return load_revision_module(path, f"_test_{_REVISION}")


def test_the_revision_is_wired_to_one_real_parent() -> None:
    module = _module()
    assert module.revision == _REVISION
    parent = module.down_revision
    assert isinstance(parent, str) and parent
    assert any(
        f'revision: str = "{parent}"' in p.read_text(encoding="utf-8")
        or f'revision = "{parent}"' in p.read_text(encoding="utf-8")
        for p in _VERSIONS.glob("*.py")
        if p.name != f"{_REVISION}.py"
    ), f"down_revision {parent!r} names no sibling revision"


def _assert_present(engine) -> None:  # noqa: ANN001
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
    assert index_exists(engine, _INDEX, schema="auth")


@_needs_pg
def test_upgrade_adds_nullable_columns_and_downgrade_removes_them() -> None:
    with ephemeral_database(admin_database_url(), "dcr01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        _assert_present(engine)

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        assert column_info(engine, "devices", "credential_revoked_at") is None
        assert (
            column_info(engine, "pair_codes", "bound_device_id", schema="auth") is None
        )
        assert column_info(engine, "pair_codes", "delivered_at", schema="auth") is None
        assert not index_exists(engine, _INDEX, schema="auth")

        # And forward again — the revision is re-appliable after a reversal.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        _assert_present(engine)
