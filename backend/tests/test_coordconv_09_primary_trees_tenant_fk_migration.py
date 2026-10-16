"""``coordconv_01`` step 9: production's ``NOT VALID`` tenant key is repaired and validated.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1", bound by served policy production-and-cost prod-mutation):

1. A fresh database gets no backup table and keeps every row.
2. Production's shape: every orphaned row, and only those, leaves
   ``coord.primary_trees`` and lands whole in the backup; every other row is
   untouched; step 9 alone leaves the chain's key, validated.
3. Sized first: 49 orphans are repaired, 50 refuse step 9, and the refusal
   writes nothing at all; nor does a delete that outgrows the precount, whose
   rollback takes the new backup table with it.
4. A ``NOT VALID`` key with no orphans is validated without a backup.
5. A second run changes nothing and backs nothing up twice.
6. The downgrade puts back the backed-up rows, byte for byte, and the key
   ``NOT VALID``. It leaves out a row a device has re-created since (that row
   is newer, and is kept) and a row whose device has been deleted since (the
   device's delete would have cascaded it). When no row comes back the key is
   re-added validated, the parent chain's definition.
7. A tenant key of any other shape refuses step 9.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests.test_coordconv_00_production_shape import (
    CHAIN_ONLY_LINES,
    PARENT_REVISION_ID,
    PRODUCTION_ONLY_LINES,
    catalog_lines,
    clone_of,
    downgrade,
    insert_device,
    insert_primary_tree,
    insert_tenant,
    primary_tree_rows,
    rerun,
    revision_module,
    run_in_revision,
    run_step,
    scalar_at,
    seed_orphaned_primary_trees,
    shared_template,
    upgrade,
    upgrade_refused,
)

_KEY_PREFIX = "constraint\tcoord.primary_trees.primary_trees_tenant_id_fkey\t"
_VALID_LINE = (
    _KEY_PREFIX + "f|FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
    "ON DELETE SET NULL|t"
)
_NOT_VALID_LINE = (
    _KEY_PREFIX + "f|FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
    "ON DELETE SET NULL NOT VALID|f"
)
_BACKUP = "web.coordconv_01_primary_trees_orphans"


def _key_line(engine: Engine) -> str:
    (line,) = (x for x in catalog_lines(engine) if x.startswith(_KEY_PREFIX))
    return line


def _backup_present(engine: Engine) -> bool:
    return bool(
        scalar_at(
            engine,
            "SELECT to_regclass('web.coordconv_01_primary_trees_orphans') IS NOT NULL",
        )
    )


def _backup_rows(engine: Engine, device_id: uuid.UUID) -> dict[str, tuple]:
    """``repo -> (tenant_id, row_data)`` of one device's backed-up rows."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT repo, tenant_id, row_data "
                "FROM web.coordconv_01_primary_trees_orphans WHERE device_id = :d"
            ),
            {"d": device_id},
        ).fetchall()
    return {repo: (tenant, data) for repo, tenant, data in rows}


def _production_shape(engine: Engine, orphans: int) -> tuple[uuid.UUID, uuid.UUID]:
    """A device with two good rows and ``orphans`` rows of a missing tenant.

    Returns ``(device_id, missing_tenant_id)``; the key is left ``NOT VALID``.
    """
    with engine.begin() as conn:
        tenant = insert_tenant(conn)
        device = insert_device(conn, tenant)
        for repo in ("good-a", "good-b"):
            insert_primary_tree(conn, device, tenant, repo)
        missing = seed_orphaned_primary_trees(
            conn, device, [f"orphan-{i:02d}" for i in range(orphans)]
        )
    return device, missing


def test_step_9_declares_the_measured_key_and_the_policy_bound() -> None:
    module = revision_module("t09")
    assert module.TREE_KEY == "primary_trees_tenant_id_fkey"
    assert module.TREE_KEY_SET_NULL == (
        "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL"
    )
    assert module.ORPHAN_BOUND == 50
    assert module.ORPHAN_BACKUP == _BACKUP
    assert _VALID_LINE in CHAIN_ONLY_LINES
    assert _NOT_VALID_LINE in PRODUCTION_ONLY_LINES


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_a_fresh_database_gets_no_backup_and_keeps_every_row(parent: str) -> None:
    with clone_of(parent, "coordconv_09_fresh") as (engine, url):
        with engine.begin() as conn:
            tenant = insert_tenant(conn)
            device = insert_device(conn, tenant)
            insert_primary_tree(conn, device, tenant, "kept")
        rows_before = primary_tree_rows(engine, device)
        upgrade(url)
        assert primary_tree_rows(engine, device) == rows_before
        assert not _backup_present(engine)


def test_step_9_moves_exactly_the_orphans_and_validates(parent: str) -> None:
    with clone_of(parent, "coordconv_09_prod") as (engine, url):
        device, missing = _production_shape(engine, orphans=3)
        rows_before = primary_tree_rows(engine, device)
        assert _key_line(engine) == _NOT_VALID_LINE
        run_step(url, 9)
        assert _key_line(engine) == _VALID_LINE
        rows_after = primary_tree_rows(engine, device)
        assert set(rows_after) == {"good-a", "good-b"}
        assert {r: rows_before[r] for r in rows_after} == rows_after
        backup = _backup_rows(engine, device)
    assert set(backup) == {"orphan-00", "orphan-01", "orphan-02"}
    for repo, (tenant, data) in backup.items():
        assert tenant == missing
        assert data == rows_before[repo]


def test_the_whole_revision_converges_production_with_orphans(parent: str) -> None:
    with (
        clone_of(parent, "coordconv_09_fresh") as (fresh, fresh_url),
        clone_of(parent, "coordconv_09_prod") as (prod, prod_url),
    ):
        device, _ = _production_shape(prod, orphans=3)
        upgrade(prod_url)
        upgrade(fresh_url)
        assert _key_line(prod) == _key_line(fresh)
        assert catalog_lines(prod) == catalog_lines(fresh)
        assert set(primary_tree_rows(prod, device)) == {"good-a", "good-b"}
        assert set(_backup_rows(prod, device)) == {
            "orphan-00",
            "orphan-01",
            "orphan-02",
        }


@pytest.mark.parametrize(("orphans", "refused"), [(49, False), (50, True)])
def test_the_repair_is_sized_first(parent: str, orphans: int, refused: bool) -> None:
    with clone_of(parent, "coordconv_09_bound") as (engine, url):
        device, _ = _production_shape(engine, orphans=orphans)
        rows_before = primary_tree_rows(engine, device)
        if refused:
            stderr = upgrade_refused(url)
            assert (
                f"coordconv_01 step 9: refusing: {orphans} coord.primary_trees row(s)"
                in stderr
            ), stderr
            assert "fewer than 50" in stderr, stderr
            assert primary_tree_rows(engine, device) == rows_before
            assert _key_line(engine) == _NOT_VALID_LINE
            assert not _backup_present(engine)
        else:
            upgrade(url)
            assert set(primary_tree_rows(engine, device)) == {"good-a", "good-b"}
            assert len(_backup_rows(engine, device)) == orphans


def test_the_bound_is_rechecked_inside_the_deleting_transaction(parent: str) -> None:
    """A delete that outgrows the precount refuses, and its rollback takes the
    backup table it created with it."""
    with clone_of(parent, "coordconv_09_recheck") as (engine, url):
        device, _ = _production_shape(engine, orphans=60)
        rows_before = primary_tree_rows(engine, device)
        module = revision_module("recheck")
        vars(module)["_TREE_REFERENCES"] = text("SELECT 0 AS nulls, 10 AS orphans")
        with pytest.raises(
            RuntimeError,
            match="coordconv_01 step 9: refusing: 60 rows matched at delete time",
        ):
            run_in_revision(url, module._step_09_primary_trees_orphans_and_validation)
        assert primary_tree_rows(engine, device) == rows_before
        assert not _backup_present(engine)
        assert _key_line(engine) == _NOT_VALID_LINE


def test_a_not_valid_key_without_orphans_is_validated_without_a_backup(
    parent: str,
) -> None:
    with clone_of(parent, "coordconv_09_nv") as (engine, url):
        _production_shape(engine, orphans=0)
        assert _key_line(engine) == _NOT_VALID_LINE
        run_step(url, 9)
        assert _key_line(engine) == _VALID_LINE
        assert not _backup_present(engine)


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_09_rerun") as (engine, url):
        device, _ = _production_shape(engine, orphans=2)
        upgrade(url)
        once = (catalog_lines(engine, ("coord", "web")), _backup_rows(engine, device))
        rerun(url)
        again = (catalog_lines(engine, ("coord", "web")), _backup_rows(engine, device))
    assert again == once


def test_downgrade_puts_back_the_rows_and_the_not_valid_key(parent: str) -> None:
    with clone_of(parent, "coordconv_09_down") as (engine, url):
        device, _ = _production_shape(engine, orphans=3)
        rows_before = primary_tree_rows(engine, device)
        catalog_before = catalog_lines(engine, ("coord", "web"))
        upgrade(url)
        downgrade(url)
        assert primary_tree_rows(engine, device) == rows_before
        assert catalog_lines(engine, ("coord", "web")) == catalog_before
        assert _key_line(engine) == _NOT_VALID_LINE
        assert not _backup_present(engine)


def test_downgrade_keeps_a_row_the_device_re_created(parent: str) -> None:
    with clone_of(parent, "coordconv_09_superseded") as (engine, url):
        device, missing = _production_shape(engine, orphans=2)
        rows_before = primary_tree_rows(engine, device)
        upgrade(url)
        live_tenant = scalar_at(
            engine, "SELECT tenant_id FROM coord.devices WHERE device_id = :d", d=device
        )
        with engine.begin() as conn:
            insert_primary_tree(conn, device, live_tenant, "orphan-00")
        recreated = primary_tree_rows(engine, device)["orphan-00"]
        downgrade(url)
        rows = primary_tree_rows(engine, device)
    assert rows["orphan-00"] == recreated
    assert rows["orphan-01"] == rows_before["orphan-01"]
    assert str(missing) == rows["orphan-01"]["tenant_id"]


def test_downgrade_leaves_out_the_rows_of_a_device_deleted_since(parent: str) -> None:
    with clone_of(parent, "coordconv_09_gone") as (engine, url):
        kept, _ = _production_shape(engine, orphans=2)
        gone, _ = _production_shape(engine, orphans=2)
        rows_kept = primary_tree_rows(engine, kept)
        upgrade(url)
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.devices WHERE device_id = :d"), {"d": gone}
            )
        downgrade(url)
        assert primary_tree_rows(engine, gone) == {}
        assert primary_tree_rows(engine, kept) == rows_kept
        assert _key_line(engine) == _NOT_VALID_LINE
        assert not _backup_present(engine)


def test_a_downgrade_that_restores_nothing_leaves_the_key_validated(
    parent: str,
) -> None:
    with clone_of(parent, "coordconv_09_none_back") as (engine, url):
        gone, _ = _production_shape(engine, orphans=2)
        upgrade(url)
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.devices WHERE device_id = :d"), {"d": gone}
            )
        downgrade(url)
        assert primary_tree_rows(engine, gone) == {}
        assert _key_line(engine) == _VALID_LINE
        assert not _backup_present(engine)


def test_a_tenant_key_of_another_shape_refuses_step_9(parent: str) -> None:
    with clone_of(parent, "coordconv_09_odd") as (engine, url):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE coord.primary_trees "
                    "DROP CONSTRAINT primary_trees_tenant_id_fkey"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE coord.primary_trees ADD CONSTRAINT "
                    "primary_trees_tenant_id_fkey FOREIGN KEY (tenant_id) "
                    "REFERENCES coord.tenants(tenant_id) ON DELETE RESTRICT NOT VALID"
                )
            )
        before = _key_line(engine)
        stderr = upgrade_refused(url)
        assert "coordconv_01 step 9:" in stderr, stderr
        assert "was never measured" in stderr, stderr
        assert _key_line(engine) == before
