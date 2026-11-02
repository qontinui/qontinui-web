"""``coordconv_01`` step 10: the ``primary_trees`` tenant key cascades.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. The key becomes ``ON DELETE CASCADE``, validated, on every database.
2. The behaviour, not only the declaration: before, deleting a tenant that a
   row still names fails with a NOT NULL violation; after, the delete succeeds
   and takes those rows with it.
3. A ``CASCADE`` key left ``NOT VALID`` by a run interrupted inside step 10 is
   validated, and step 9 lets it through on the retry.
4. Orphaned rows, or a tenant key of any other shape, refuse step 10 before it
   writes anything.
5. A second run changes nothing; a downgrade returns ``SET NULL``, validated.
   The swap, which locks ``coord.tenants``, gives up within a second.
6. The evidence the revision cites for CASCADE holds at ``image_assets_01``.
"""

from __future__ import annotations

import time
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError, IntegrityError

from alembic import op
from tests.test_coordconv_00_production_shape import (
    MEASURED_AT_REVISION,
    PARENT_REVISION_ID,
    catalog_lines,
    clone_of,
    downgrade,
    insert_device,
    insert_primary_tree,
    insert_tenant,
    migration_operations,
    primary_tree_rows,
    rerun,
    revision_module,
    run_step,
    scalar_at,
    seed_orphaned_primary_trees,
    shared_template,
    upgrade,
)

_KEY_PREFIX = "constraint\tcoord.primary_trees.primary_trees_tenant_id_fkey\t"
_CASCADE_LINE = (
    _KEY_PREFIX + "f|FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
    "ON DELETE CASCADE|t"
)
_SET_NULL_LINE = (
    _KEY_PREFIX + "f|FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
    "ON DELETE SET NULL|t"
)


def _key_line(engine: Engine) -> str:
    (line,) = (x for x in catalog_lines(engine) if x.startswith(_KEY_PREFIX))
    return line


def _row_of_a_second_tenant(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """A device of tenant A with one tree row naming tenant B; returns (B, device).

    The device's own key (``devices_tenant_id_fkey``, RESTRICT) would refuse
    deleting A, so the row names B: a device bound to two tenants, the shape
    production's rows have.
    """
    with engine.begin() as conn:
        owner = insert_tenant(conn)
        other = insert_tenant(conn)
        device = insert_device(conn, owner)
        insert_primary_tree(conn, device, other, "repo-of-b")
    return other, device


def _delete_tenant(engine: Engine, tenant: uuid.UUID) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM coord.tenants WHERE tenant_id = :t"), {"t": tenant}
        )


def _swap_key(engine: Engine, action: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE coord.primary_trees "
                "DROP CONSTRAINT primary_trees_tenant_id_fkey, "
                "ADD CONSTRAINT primary_trees_tenant_id_fkey "
                "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
                f"ON DELETE {action}"
            )
        )


def test_step_10_declares_both_definitions() -> None:
    module = revision_module("t10")
    assert module.TREE_KEY_CASCADE == (
        "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE"
    )
    assert module.TREE_KEY_SET_NULL == (
        "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL"
    )


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_the_key_cascades_on_a_fresh_database(parent: str) -> None:
    with clone_of(parent, "coordconv_10_fresh") as (engine, url):
        assert _key_line(engine) == _SET_NULL_LINE
        upgrade(url)
        assert _key_line(engine) == _CASCADE_LINE


def test_deleting_a_named_tenant_fails_before_and_cascades_after(parent: str) -> None:
    with clone_of(parent, "coordconv_10_behaviour") as (engine, url):
        tenant, device = _row_of_a_second_tenant(engine)
        with pytest.raises(IntegrityError, match="tenant_id"):
            _delete_tenant(engine, tenant)
        assert set(primary_tree_rows(engine, device)) == {"repo-of-b"}

        upgrade(url)
        _delete_tenant(engine, tenant)
        assert primary_tree_rows(engine, device) == {}
        gone = scalar_at(
            engine, "SELECT count(*) FROM coord.tenants WHERE tenant_id = :t", t=tenant
        )
    assert gone == 0


def test_a_cascade_key_left_not_valid_is_validated_on_the_retry(parent: str) -> None:
    with clone_of(parent, "coordconv_10_nv") as (engine, url):
        _swap_key(engine, "CASCADE NOT VALID")
        upgrade(url)
        assert _key_line(engine) == _CASCADE_LINE


def test_orphans_refuse_step_10_before_it_writes(parent: str) -> None:
    """Step 9 removes production's orphans, so only step 10 alone can meet one."""
    with clone_of(parent, "coordconv_10_orphan") as (engine, url):
        with engine.begin() as conn:
            device = insert_device(conn, insert_tenant(conn))
            seed_orphaned_primary_trees(conn, device, ["orphan"])
        before = _key_line(engine)
        with pytest.raises(RuntimeError, match="coordconv_01 step 10: 1 coord"):
            run_step(url, 10)
        assert _key_line(engine) == before
        assert set(primary_tree_rows(engine, device)) == {"orphan"}


def test_a_tenant_key_of_another_shape_refuses_step_10(parent: str) -> None:
    with clone_of(parent, "coordconv_10_odd") as (engine, url):
        _swap_key(engine, "RESTRICT")
        before = _key_line(engine)
        with pytest.raises(
            RuntimeError, match="coordconv_01 step 10: .*never measured"
        ):
            run_step(url, 10)
        assert _key_line(engine) == before


def test_the_tenant_key_swap_waits_at_most_a_second_for_its_lock(parent: str) -> None:
    """Dropping a key that references coord.tenants takes ACCESS EXCLUSIVE on it."""
    with clone_of(parent, "coordconv_10_lockwait") as (engine, url):
        (step,) = (s for s in revision_module("lockwait").STEPS if s.number == 10)
        holder = engine.connect()
        try:
            held = holder.begin()
            holder.execute(text("LOCK TABLE coord.tenants IN ACCESS SHARE MODE"))
            with migration_operations(url), op.get_context().autocommit_block():
                started = time.monotonic()
                with pytest.raises(DBAPIError, match="lock timeout"):
                    step.apply()
                waited = time.monotonic() - started
            held.rollback()
        finally:
            holder.close()
        assert waited < 2.0, f"the swap waited {waited:.1f}s for coord.tenants"
        assert _key_line(engine) == _SET_NULL_LINE


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_10_rerun") as (engine, url):
        upgrade(url)
        once = catalog_lines(engine, ("coord", "web"))
        rerun(url)
        assert catalog_lines(engine, ("coord", "web")) == once


def test_downgrade_returns_set_null_validated(parent: str) -> None:
    with clone_of(parent, "coordconv_10_down") as (engine, url):
        upgrade(url)
        downgrade(url)
        assert _key_line(engine) == _SET_NULL_LINE


@pytest.fixture(scope="module")
def measured() -> str:
    return shared_template(MEASURED_AT_REVISION)


def test_the_census_of_tenant_key_actions_the_revision_cites(measured: str) -> None:
    """Among keys from a NOT NULL ``tenant_id`` to ``coord.tenants``: CASCADE is
    the rule, RESTRICT guards identity and history, SET NULL is only the defect."""
    with clone_of(measured, "coordconv_10_census") as (engine, _):
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT c.confdeltype::text, c.conrelid::regclass::text
                      FROM pg_constraint c
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                     WHERE c.contype = 'f'
                       AND c.confrelid = 'coord.tenants'::regclass
                       AND a.attnotnull
                    """
                )
            ).fetchall()
    by_action: dict[str, set[str]] = {}
    for action, table in rows:
        by_action.setdefault(action, set()).add(table)
    assert {action: len(tables) for action, tables in by_action.items()} == {
        "c": 22,
        "r": 4,
        "n": 5,
    }
    assert by_action["r"] == {
        "coord.devices",
        "coord.sessions",
        "coord.memory_records",
        "coord.memory_links",
    }
    assert by_action["n"] == {
        "coord.agent_logs",
        "coord.agent_questions",
        "coord.agent_worktrees",
        "coord.memories",
        "coord.primary_trees",
    }
    assert {"coord.device_status", "coord.tenant_devices"} <= by_action["c"]
