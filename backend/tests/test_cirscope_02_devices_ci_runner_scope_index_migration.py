"""Behaviour test for the ``cirscope_02_devices_ci_runner_scope_index`` revision.

Pins what coord's CI-runner retirement arm relies on (its per-scope read in
``ci_runner_registrar/retire.rs``):

1. **Shape** — ``coord.idx_devices_ci_runner_scope`` exists, is VALID and not
   unique, keys ``regexp_replace(hostname, '^.*@', '')`` and carries the partial
   predicate ``capabilities @> '["ci_runner"]'``.
2. **It serves coord's read** — with sequential scans disabled, coord's exact
   per-scope SELECT plans through the index, and it returns the CI-runner rows
   of that scope only: not another scope's, not a non-CI row of the same
   hostname, and the text after the LAST ``@`` is what is compared.
3. **Re-running is harmless** — ``stamp <parent>`` then ``upgrade`` again
   leaves the same index (same oid).
4. **A killed concurrent build is refused, not skipped** — an INVALID leftover
   makes the upgrade raise with the recovery instead of reporting success.
5. **Reversal** — downgrade removes only this index; re-applying works.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_definition,
    index_exists,
    index_oid,
    index_state,
    invalidate_index,
    is_superuser,
    run_alembic,
)

_REVISION_ID = "cirscope_02_devices_ci_runner_scope_index"
_REVISION_FILENAME = "cirscope_02_devices_ci_runner_scope_index.py"
_INDEX = "idx_devices_ci_runner_scope"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

#: coord's per-scope read, byte for byte the predicate half of
#: ``SCOPE_ROWS_SQL`` in qontinui-coord ``ci_runner_registrar/retire.rs``.
_COORD_SCOPE_READ = (
    "SELECT d.device_id, d.hostname FROM coord.devices d "
    "WHERE d.capabilities @> '[\"ci_runner\"]'::jsonb "
    "AND regexp_replace(d.hostname, '^.*@', '') = :scope"
)


def _assert_shape(engine: Engine) -> None:
    valid, unique, predicate = index_state(engine, _INDEX)
    assert valid, f"coord.{_INDEX} is INVALID"
    assert not unique, "two scopes' rows share a key: the index must not be unique"
    assert "capabilities @> '[\"ci_runner\"]'::jsonb" in predicate, predicate
    definition = index_definition(engine, _INDEX)
    assert "ON coord.devices USING btree" in definition, definition
    assert "regexp_replace(hostname, '^.*@'::text, ''::text)" in definition, definition


def _insert_tenant(engine: Engine) -> str:
    tenant_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (CAST(:t AS uuid), :slug, 'cirscope_02 test tenant')"
            ),
            {"t": tenant_id, "slug": f"cirscope02-{uuid4().hex[:8]}"},
        )
    return tenant_id


def _insert_device(engine: Engine, tenant_id: str, hostname: str, ci: bool) -> str:
    device_id = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.devices "
                "(device_id, name, hostname, tenant_id, capabilities) "
                "VALUES (CAST(:id AS uuid), :name, :host, CAST(:t AS uuid), "
                "CAST(:caps AS jsonb))"
            ),
            {
                "id": device_id,
                "name": hostname.split("@", 1)[0],
                "host": hostname,
                "t": tenant_id,
                "caps": '["ci_runner"]' if ci else '["coord_target"]',
            },
        )
    return device_id


def _scope_rows(engine: Engine, scope: str) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(text(_COORD_SCOPE_READ), {"scope": scope}).all()
    return {str(r[0]) for r in rows}


def _plan(engine: Engine, scope: str) -> str:
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(
            text("EXPLAIN " + _COORD_SCOPE_READ), {"scope": scope}
        ).all()
    return "\n".join(str(r[0]) for r in rows)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_cirscope_02_indexes_the_ci_runner_scope_scan() -> None:
    """Shape, serves coord's read, re-run, INVALID leftover refused, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "cirscope02_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — no index yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX)

        # 2. Apply — the exact key, predicate and validity.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        oid = index_oid(engine, _INDEX)

        # 3. coord's read: the right rows, through the index.
        tenant = _insert_tenant(engine)
        mine = _insert_device(engine, tenant, "gh-runner-box-1@acme/shop", ci=True)
        _insert_device(engine, tenant, "gh-runner-box-2@acme/other", ci=True)
        _insert_device(engine, tenant, "gh-runner-box-3@acme/shop", ci=False)
        # The text after the LAST `@` is the scope: this row is acme/shop's.
        odd = _insert_device(engine, tenant, "gh-runner-a@b@acme/shop", ci=True)
        _insert_device(engine, tenant, "gh-runner-box-4@org:acme", ci=True)
        assert _scope_rows(engine, "acme/shop") == {mine, odd}
        assert len(_scope_rows(engine, "org:acme")) == 1
        assert _scope_rows(engine, "shop") == set()
        plan = _plan(engine, "acme/shop")
        assert _INDEX in plan, plan

        # 4. Re-running is harmless: the same index, untouched.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert index_oid(engine, _INDEX) == oid

        # 5. An INVALID leftover of a killed CONCURRENTLY build is refused.
        if is_superuser(engine):
            invalidate_index(engine, _INDEX)
            run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
            with pytest.raises(Exception, match="INVALID"):
                run_alembic(root, url, "upgrade", _REVISION_ID)
            with engine.begin() as conn:
                conn.execute(text(f"DROP INDEX coord.{_INDEX}"))
            run_alembic(root, url, "upgrade", _REVISION_ID)
            _assert_shape(engine)

        # 6. Downgrade drops only this index; re-apply works.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX)
        assert _scope_rows(engine, "acme/shop") == {mine, odd}
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
