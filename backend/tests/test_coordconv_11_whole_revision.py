"""``coordconv_01`` as a whole: order, convergence end to end, retry from any step, reversal.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. The revision chains off the pinned parent and runs its ten steps in order.
2. END TO END: production's measured shape, upgraded, holds exactly the
   ``coord`` definitions of a fresh database upgraded the same way.
3. RETRY: a run that fails at any step k (steps 1 to k-1 committed, nothing
   stamped) is finished by simply running the revision again, which redoes
   nothing already done; the end state is the fresh database's.
4. REVERSAL: on a fresh database, upgrade -> downgrade returns the parent's
   schema in ``coord`` and ``web``, and re-upgrading returns the upgraded one.
5. DOWNGRADE RETRY: a downgrade that fails at any undo (the undos before it
   committed, ``alembic_version`` still at the revision) is finished by running
   it again, on both shapes, including after step 9's undo has restored
   production's rows; so is one interrupted inside step 10's undo.
6. The mechanics: the undos run in reverse step order, and a statement that
   fails inside one of the revision's own transactions rolls that transaction
   back and leaves the connection usable.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from alembic import op
from tests._alembic_harness import declared_parent_revision_id
from tests.test_coordconv_00_production_shape import (
    PARENT_REVISION_ID,
    REVISION_FILENAME,
    REVISION_ID,
    UNDO_ORDER,
    catalog_lines,
    clone_of,
    downgrade,
    downgrade_failing_at,
    insert_device,
    insert_primary_tree,
    insert_tenant,
    migration_operations,
    primary_tree_rows,
    revision_module,
    revision_path,
    seed_orphaned_primary_trees,
    seed_production_shape,
    shared_template,
    upgrade,
    upgrade_failing_at,
)


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    source = revision_path().read_text(encoding="utf-8")
    declared = declared_parent_revision_id(source, REVISION_FILENAME)
    assert declared == PARENT_REVISION_ID, (
        f"{REVISION_FILENAME} declares down_revision={declared!r}; the tests pin "
        f"{PARENT_REVISION_ID!r} (tests/test_coordconv_00_production_shape.py). "
        "Re-point both together, and the Revises: line."
    )
    assert revision_module("id").revision == REVISION_ID


def test_the_ten_steps_run_in_order() -> None:
    steps = revision_module("order").STEPS
    assert [s.number for s in steps] == list(range(1, 11))
    assert [s.apply.__name__ for s in steps] == [
        "_step_01_devices_metadata",
        "_step_02_devices_tenant_key",
        "_step_03_memory_id_default",
        "_step_04_drop_idx_memories_name_version",
        "_step_05_drop_idx_memories_type",
        "_step_06_drop_idx_memories_written_at",
        "_step_07_idx_agent_questions_agent",
        "_step_08_idx_agent_questions_session",
        "_step_09_primary_trees_orphans_and_validation",
        "_step_10_primary_trees_key_cascades",
    ]


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


@pytest.fixture(scope="module")
def fresh_converged(parent: str) -> set[str]:
    """The ``coord`` definitions of a fresh database after the revision."""
    with clone_of(parent, "coordconv_11_fresh") as (engine, url):
        upgrade(url)
        return catalog_lines(engine)


def _production(engine) -> object:
    """Every measured drift, plus a kept tree row and two orphans; returns the device."""
    seed_production_shape(engine)
    with engine.begin() as conn:
        tenant = insert_tenant(conn)
        device = insert_device(conn, tenant)
        insert_primary_tree(conn, device, tenant, "kept")
        seed_orphaned_primary_trees(conn, device, ["orphan-a", "orphan-b"])
    return device


def test_production_converges_to_the_chain_end_to_end(
    parent: str, fresh_converged: set[str]
) -> None:
    with clone_of(parent, "coordconv_11_e2e") as (prod, url):
        device = _production(prod)
        assert catalog_lines(prod) != fresh_converged
        upgrade(url)
        assert catalog_lines(prod) == fresh_converged
        assert set(primary_tree_rows(prod, device)) == {"kept"}


@pytest.mark.parametrize("failing_step", range(1, 11))
def test_a_production_run_failing_at_any_step_finishes_on_retry(
    parent: str, fresh_converged: set[str], failing_step: int
) -> None:
    with clone_of(parent, f"coordconv_11_retry{failing_step}") as (prod, url):
        device = _production(prod)
        before = catalog_lines(prod)
        upgrade_failing_at(url, failing_step)
        # On production's shape step 1 changes nothing and step 2 is the first
        # to act, so a failure from step 3 on has committed work behind it.
        assert (catalog_lines(prod) != before) == (failing_step >= 3)
        upgrade(url)
        assert catalog_lines(prod) == fresh_converged
        assert set(primary_tree_rows(prod, device)) == {"kept"}


@pytest.mark.parametrize("failing_step", [8, 10])
def test_a_fresh_run_failing_late_finishes_on_retry(
    parent: str, fresh_converged: set[str], failing_step: int
) -> None:
    """Steps 1, 7 and 8 act only on a fresh database; their re-run must no-op."""
    with clone_of(parent, f"coordconv_11_fretry{failing_step}") as (engine, url):
        before = catalog_lines(engine)
        upgrade_failing_at(url, failing_step)
        assert catalog_lines(engine) != before
        upgrade(url)
        assert catalog_lines(engine) == fresh_converged


def test_upgrade_downgrade_upgrade_on_a_fresh_database(parent: str) -> None:
    with clone_of(parent, "coordconv_11_reversal") as (engine, url):
        before = catalog_lines(engine, ("coord", "web"))
        upgrade(url)
        after = catalog_lines(engine, ("coord", "web"))
        assert after != before
        downgrade(url)
        assert catalog_lines(engine, ("coord", "web")) == before
        upgrade(url)
        assert catalog_lines(engine, ("coord", "web")) == after


@pytest.fixture(scope="module")
def production_downgraded(parent: str) -> set[str]:
    """``coord`` and ``web`` after a clean upgrade and downgrade of production's shape."""
    with clone_of(parent, "coordconv_11_down_ref") as (prod, url):
        _production(prod)
        upgrade(url)
        downgrade(url)
        return catalog_lines(prod, ("coord", "web"))


@pytest.mark.parametrize("failing_undo", UNDO_ORDER)
def test_a_production_downgrade_failing_at_any_undo_finishes_on_retry(
    parent: str, production_downgraded: set[str], failing_undo: str
) -> None:
    with clone_of(parent, f"coordconv_11_dretry{failing_undo[6:8]}") as (prod, url):
        device = _production(prod)
        rows_before = primary_tree_rows(prod, device)
        upgrade(url)
        downgrade_failing_at(url, failing_undo)
        downgrade(url)
        assert catalog_lines(prod, ("coord", "web")) == production_downgraded
        assert primary_tree_rows(prod, device) == rows_before


@pytest.mark.parametrize("failing_undo", UNDO_ORDER)
def test_a_fresh_downgrade_failing_at_any_undo_finishes_on_retry(
    parent: str, failing_undo: str
) -> None:
    with clone_of(parent, f"coordconv_11_fdretry{failing_undo[6:8]}") as (engine, url):
        before = catalog_lines(engine, ("coord", "web"))
        upgrade(url)
        downgrade_failing_at(url, failing_undo)
        downgrade(url)
        assert catalog_lines(engine, ("coord", "web")) == before


def test_a_downgrade_interrupted_inside_step_10s_undo_validates_on_retry(
    parent: str,
) -> None:
    """Between that undo's swap and its VALIDATE the key is SET NULL, NOT VALID."""
    with clone_of(parent, "coordconv_11_undo10") as (engine, url):
        before = catalog_lines(engine, ("coord", "web"))
        upgrade(url)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE coord.primary_trees "
                    "DROP CONSTRAINT primary_trees_tenant_id_fkey, "
                    "ADD CONSTRAINT primary_trees_tenant_id_fkey "
                    "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
                    "ON DELETE SET NULL NOT VALID"
                )
            )
        downgrade(url)
        assert catalog_lines(engine, ("coord", "web")) == before


def test_the_undos_run_in_reverse_step_order(parent: str) -> None:
    with clone_of(parent, "coordconv_11_undo_order") as (_, url):
        module = revision_module("undo_order")
        calls: list[str] = []
        for name in UNDO_ORDER:
            vars(module)[name] = lambda name=name: calls.append(name)
        with migration_operations(url):
            module.downgrade()
    assert tuple(calls) == UNDO_ORDER


def test_a_failing_statement_rolls_back_its_own_transaction(parent: str) -> None:
    """What ran before the failure is undone, and no aborted block is left behind."""
    with clone_of(parent, "coordconv_11_tx") as (_, url):
        module = revision_module("tx")
        with migration_operations(url), op.get_context().autocommit_block():
            with pytest.raises(DBAPIError, match="division by zero"):
                with module._own_transaction():
                    op.execute("CREATE TABLE web.coordconv_01_tx_probe (id int)")
                    op.execute("SELECT 1 / 0")
            probe = op.get_bind().execute(
                text("SELECT to_regclass('web.coordconv_01_tx_probe') IS NULL")
            )
            assert probe.scalar_one() is True
