"""Round-trip tests for ``coord_tenant_github_hosts_01``.

Plan ``2026-10-09-spec-front-end-of-the-software-factory`` Phase 9 item 4 —
the per-tenant GitHub host coord reads to support GitHub Enterprise Server.

What is asserted:

1. The pinned parent matches the revision (no database, never skips).
2. **Upgrade** creates the table; a github.com row and a GHES row insert.
3. **Shape CHECKs** refuse a non-https base, userinfo, a query, a trailing
   slash, and a ``web_base`` with a path.
4. **One row per tenant**, and the row cascades with its tenant.
5. **Downgrade** drops the table.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=host:port``.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION = "coord_tenant_github_hosts_01"
_PARENT = "devcred_01_credential_deny_and_bound_pair_codes"


def test_the_pinned_parent_matches_the_revision() -> None:
    source = (backend_root() / "alembic" / "versions" / f"{_REVISION}.py").read_text(
        encoding="utf-8"
    )
    assert declared_parent_revision_id(source, _REVISION) == _PARENT


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def _execute(engine: Engine, sql: str, **params: object) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _new_tenant(engine: Engine) -> str:
    tenant_id = str(uuid.uuid4())
    _execute(
        engine,
        "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
        "VALUES (CAST(:t AS uuid), :s, :s)",
        t=tenant_id,
        s=f"ghhost-{tenant_id[:8]}",
    )
    return tenant_id


def _insert_host(engine: Engine, tenant_id: str, api: str, web: str) -> None:
    _execute(
        engine,
        "INSERT INTO coord.tenant_github_hosts (tenant_id, api_base, web_base) "
        "VALUES (CAST(:t AS uuid), :a, :w)",
        t=tenant_id,
        a=api,
        w=web,
    )


def test_upgrade_shape_checks_cascade_and_downgrade(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "ghhosts") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION)
        assert table_exists(engine, "coord", "tenant_github_hosts")

        github_com = _new_tenant(engine)
        _insert_host(engine, github_com, "https://api.github.com", "https://github.com")
        ghes = _new_tenant(engine)
        _insert_host(
            engine,
            ghes,
            "https://ghe.example.com:8443/api/v3",
            "https://ghe.example.com:8443",
        )

        for api, web in [
            ("http://ghe.example.com/api/v3", "https://ghe.example.com"),
            ("https://ghe.example.com/api/v3", "http://ghe.example.com"),
            ("https://u@ghe.example.com/api/v3", "https://ghe.example.com"),
            ("https://ghe.example.com/api/v3?x=1", "https://ghe.example.com"),
            ("https://ghe.example.com/api/v3/", "https://ghe.example.com"),
            ("https://ghe.example.com/api/v3", "https://ghe.example.com/"),
            ("https://ghe.example.com/api/v3", "https://ghe.example.com/sub"),
        ]:
            tenant = _new_tenant(engine)
            with pytest.raises(IntegrityError):
                _insert_host(engine, tenant, api, web)

        # One row per tenant.
        with pytest.raises(IntegrityError):
            _insert_host(
                engine,
                ghes,
                "https://other.example.com/api/v3",
                "https://other.example.com",
            )

        # The row goes with its tenant.
        _execute(
            engine,
            "DELETE FROM coord.tenants WHERE tenant_id = CAST(:t AS uuid)",
            t=ghes,
        )
        with engine.connect() as conn:
            left = conn.execute(
                text("SELECT tenant_id::text FROM coord.tenant_github_hosts")
            ).scalars()
            assert list(left) == [github_com]

        run_alembic(backend_root(), db_url, "downgrade", _PARENT)
        assert not table_exists(engine, "coord", "tenant_github_hosts")
