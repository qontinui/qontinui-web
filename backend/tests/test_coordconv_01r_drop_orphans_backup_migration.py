"""``coordconv_01r``: coordconv_01's orphan backup is dropped only behind its guard.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
the retention follow-up of ``coordconv_01`` step 9):

1. The revision chains off the pinned parent.
2. No backup table (a fresh database): nothing happens.
3. A backup holding only rows whose tenant is still missing, or whose
   ``(device_id, repo)`` was re-created since, is dropped.
4. A backed-up row that is valid again (its tenant and device exist, its key is
   free) refuses the revision, and the backup survives untouched.
5. A live orphan in ``coord.primary_trees`` refuses the revision, and the backup
   survives.
6. The downgrade re-creates nothing.

The live tests skip without a reachable test Postgres (``QONTINUI_TEST_PG`` or
``QONTINUI_TEST_PG_DSN``); a skip proves nothing.
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from tests._alembic_harness import backend_root, load_revision_module, run_alembic
from tests.test_coordconv_00_production_shape import (
    clone_of,
    insert_device,
    insert_primary_tree,
    insert_tenant,
    scalar_at,
    shared_template,
)

_REVISION_ID = "coordconv_01r"
# MUST equal the revision's own down_revision (first test enforces it).
_PARENT_REVISION_ID = "capmodel_01"
_REVISION_FILENAME = "coordconv_01r_drop_primary_trees_orphans_backup.py"
_BACKUP = "web.coordconv_01_primary_trees_orphans"

# coordconv_01 step 9's own DDL for the backup.
_CREATE_BACKUP = """
    CREATE TABLE web.coordconv_01_primary_trees_orphans (
        device_id    uuid        NOT NULL,
        repo         text        NOT NULL,
        tenant_id    uuid        NOT NULL,
        row_data     jsonb       NOT NULL,
        backed_up_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (device_id, repo, backed_up_at)
    )
"""


def _module():
    return load_revision_module(
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME,
        f"_rev_{_REVISION_ID}",
    )


def test_pinned_parent_matches_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.ORPHAN_BACKUP == _BACKUP


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(_PARENT_REVISION_ID)


def _backup_present(engine: Engine) -> bool:
    return bool(
        scalar_at(
            engine,
            "SELECT to_regclass('web.coordconv_01_primary_trees_orphans') IS NOT NULL",
        )
    )


def _back_up(
    conn: Connection, device_id: uuid.UUID, repo: str, tenant_id: uuid.UUID
) -> None:
    conn.execute(
        text(
            "INSERT INTO web.coordconv_01_primary_trees_orphans "
            "(device_id, repo, tenant_id, row_data) VALUES (:d, :r, :t, CAST(:j AS jsonb))"
        ),
        {
            "d": device_id,
            "r": repo,
            "t": tenant_id,
            "j": json.dumps(
                {"device_id": str(device_id), "repo": repo, "tenant_id": str(tenant_id)}
            ),
        },
    )


def _upgrade(url: str, *, expect_success: bool = True) -> str:
    return run_alembic(
        backend_root(), url, "upgrade", _REVISION_ID, expect_success=expect_success
    ).stderr


def test_no_backup_is_a_no_op(parent: str) -> None:
    with clone_of(parent, "coordconv_01r_none") as (engine, url):
        assert not _backup_present(engine)
        _upgrade(url)
        assert not _backup_present(engine)
        run_alembic(backend_root(), url, "downgrade", _PARENT_REVISION_ID)
        assert not _backup_present(engine)


def test_dead_and_superseded_rows_are_dropped(parent: str) -> None:
    with clone_of(parent, "coordconv_01r_drop") as (engine, url):
        with engine.begin() as conn:
            tenant = insert_tenant(conn)
            device = insert_device(conn, tenant)
            insert_primary_tree(conn, device, tenant, "recreated")
            conn.execute(text(_CREATE_BACKUP))
            # Tenant still missing: an orphan, as step 9 moved it.
            _back_up(conn, device, "dead", uuid.uuid4())
            # Tenant exists, but the device re-created its row since.
            _back_up(conn, device, "recreated", tenant)
            # Tenant exists, device deleted since (would have cascaded).
            _back_up(conn, uuid.uuid4(), "gone", tenant)
        _upgrade(url)
        assert not _backup_present(engine)
        # The downgrade re-creates nothing.
        run_alembic(backend_root(), url, "downgrade", _PARENT_REVISION_ID)
        assert not _backup_present(engine)


def test_a_restorable_row_refuses_and_keeps_the_backup(parent: str) -> None:
    with clone_of(parent, "coordconv_01r_restorable") as (engine, url):
        with engine.begin() as conn:
            tenant = insert_tenant(conn)
            device = insert_device(conn, tenant)
            conn.execute(text(_CREATE_BACKUP))
            _back_up(conn, device, "free-again", tenant)
        stderr = _upgrade(url, expect_success=False)
        assert "no longer orphans" in stderr, stderr
        assert _backup_present(engine)
        assert scalar_at(engine, f"SELECT count(*) FROM {_BACKUP}") == 1
        assert (
            scalar_at(engine, "SELECT version_num FROM alembic_version")
            == _PARENT_REVISION_ID
        )


def test_a_live_orphan_refuses_and_keeps_the_backup(parent: str) -> None:
    with clone_of(parent, "coordconv_01r_live") as (engine, url):
        with engine.begin() as conn:
            tenant = insert_tenant(conn)
            device = insert_device(conn, tenant)
            conn.execute(text(_CREATE_BACKUP))
            _back_up(conn, device, "dead", uuid.uuid4())
            # A shape nobody measured: the key unchecked, an orphan admitted.
            conn.execute(
                text(
                    "ALTER TABLE coord.primary_trees "
                    "DROP CONSTRAINT primary_trees_tenant_id_fkey"
                )
            )
            insert_primary_tree(conn, device, uuid.uuid4(), "live-orphan")
            conn.execute(
                text(
                    "ALTER TABLE coord.primary_trees ADD CONSTRAINT "
                    "primary_trees_tenant_id_fkey FOREIGN KEY (tenant_id) "
                    "REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE NOT VALID"
                )
            )
        stderr = _upgrade(url, expect_success=False)
        assert "tenant missing from coord.tenants" in stderr, stderr
        assert _backup_present(engine)
        assert scalar_at(engine, f"SELECT count(*) FROM {_BACKUP}") == 1
        assert (
            scalar_at(engine, "SELECT version_num FROM alembic_version")
            == _PARENT_REVISION_ID
        )


def test_only_the_newest_copy_of_a_key_decides(parent: str) -> None:
    """Two copies of one ``(device_id, repo)``: the newer one is what a restore reads."""
    with clone_of(parent, "coordconv_01r_newest") as (engine, url):
        with engine.begin() as conn:
            tenant = insert_tenant(conn)
            device = insert_device(conn, tenant)
            conn.execute(text(_CREATE_BACKUP))
            # Older copy names a live tenant; the newer copy names a dead one.
            _back_up(conn, device, "twice", tenant)
            conn.execute(
                text(
                    "UPDATE web.coordconv_01_primary_trees_orphans "
                    "SET backed_up_at = backed_up_at - interval '1 day'"
                )
            )
            _back_up(conn, device, "twice", uuid.uuid4())
        _upgrade(url)
        assert not _backup_present(engine)
