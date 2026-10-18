"""``coordconv_01`` step 2: production gains the chain's ``devices_tenant_id_fkey``.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. A fresh database's key is untouched.
2. Production's shape (no key) gains the chain's key, validated, rows intact,
   and ends with the same ``coord.devices`` definitions as a fresh database.
3. A key left ``NOT VALID`` by an interrupted run is validated.
4. A row naming a missing tenant refuses step 2 BEFORE the step writes
   anything: it repairs no data.
5. A tenant key of any other shape refuses step 2.
6. A second run changes nothing; the downgrade keeps the key, which the parent
   chain already has.
7. The count step 2 reads before writing waits at most 3 s for its lock.
"""

from __future__ import annotations

import threading
import time
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError

from alembic import op
from tests.test_coordconv_00_production_shape import (
    CHAIN_ONLY_LINES,
    PARENT_REVISION_ID,
    catalog_lines,
    clone_of,
    downgrade,
    insert_device,
    insert_tenant,
    migration_operations,
    object_lines,
    rerun,
    revision_module,
    scalar_at,
    seed_devices_without_tenant_key,
    shared_template,
    upgrade,
    upgrade_refused,
)

_KEY = "coord.devices.devices_tenant_id_fkey"
_CHAIN_LINE = (
    f"constraint\t{_KEY}\t"
    "f|FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
    "ON DELETE RESTRICT|t"
)


def _key_lines(engine: Engine) -> set[str]:
    return object_lines(catalog_lines(engine), _KEY)


def test_step_2_targets_the_chains_key() -> None:
    module = revision_module("t02")
    assert module.DEVICES_TENANT_KEY == "devices_tenant_id_fkey"
    assert module.DEVICES_TENANT_KEY_DEFINITION == (
        "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE RESTRICT"
    )
    assert _CHAIN_LINE in CHAIN_ONLY_LINES


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_a_fresh_databases_key_is_untouched(parent: str) -> None:
    with clone_of(parent, "coordconv_02_fresh") as (engine, url):
        assert _key_lines(engine) == {_CHAIN_LINE}
        upgrade(url)
        assert _key_lines(engine) == {_CHAIN_LINE}


def test_production_shape_gains_the_validated_key(parent: str) -> None:
    with (
        clone_of(parent, "coordconv_02_fresh") as (fresh, fresh_url),
        clone_of(parent, "coordconv_02_prod") as (prod, prod_url),
    ):
        with prod.begin() as conn:
            seed_devices_without_tenant_key(conn)
            tenant = insert_tenant(conn)
            devices = {insert_device(conn, tenant) for _ in range(3)}
        assert _key_lines(prod) == set()
        upgrade(prod_url)
        upgrade(fresh_url)
        assert _key_lines(prod) == {_CHAIN_LINE}
        assert object_lines(catalog_lines(prod), "coord.devices") == object_lines(
            catalog_lines(fresh), "coord.devices"
        )
        kept = scalar_at(
            prod, "SELECT count(*) FROM coord.devices WHERE tenant_id = :t", t=tenant
        )
    assert kept == len(devices)


def test_a_not_valid_leftover_is_validated(parent: str) -> None:
    with clone_of(parent, "coordconv_02_nv") as (engine, url):
        with engine.begin() as conn:
            seed_devices_without_tenant_key(conn)
            conn.execute(
                text(
                    "ALTER TABLE coord.devices ADD CONSTRAINT devices_tenant_id_fkey "
                    "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
                    "ON DELETE RESTRICT NOT VALID"
                )
            )
        upgrade(url)
        assert _key_lines(engine) == {_CHAIN_LINE}


def test_an_orphaned_row_refuses_step_2_before_it_writes(parent: str) -> None:
    with clone_of(parent, "coordconv_02_orphan") as (engine, url):
        with engine.begin() as conn:
            seed_devices_without_tenant_key(conn)
            missing = uuid.uuid4()
            orphan = insert_device(conn, missing)
        stderr = upgrade_refused(url)
        assert "coordconv_01 step 2:" in stderr, stderr
        assert "1 coord.devices row(s) name a tenant_id missing" in stderr, stderr
        assert _key_lines(engine) == set()
        still_there = scalar_at(
            engine, "SELECT tenant_id FROM coord.devices WHERE device_id = :d", d=orphan
        )
    assert still_there == missing


def test_a_tenant_key_of_another_shape_refuses_step_2(parent: str) -> None:
    with clone_of(parent, "coordconv_02_odd") as (engine, url):
        with engine.begin() as conn:
            seed_devices_without_tenant_key(conn)
            conn.execute(
                text(
                    "ALTER TABLE coord.devices ADD CONSTRAINT devices_tenant_id_fkey "
                    "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
                    "ON DELETE CASCADE"
                )
            )
        before = _key_lines(engine)
        stderr = upgrade_refused(url)
        assert "coordconv_01 step 2:" in stderr, stderr
        assert "was never measured" in stderr, stderr
        assert _key_lines(engine) == before


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_02_rerun") as (engine, url):
        with engine.begin() as conn:
            seed_devices_without_tenant_key(conn)
        upgrade(url)
        once = catalog_lines(engine, ("coord", "web"))
        rerun(url)
        assert catalog_lines(engine, ("coord", "web")) == once


def test_downgrade_keeps_the_parent_chains_key(parent: str) -> None:
    with clone_of(parent, "coordconv_02_down") as (engine, url):
        with engine.begin() as conn:
            seed_devices_without_tenant_key(conn)
        upgrade(url)
        downgrade(url)
        assert _key_lines(engine) == {_CHAIN_LINE}


def test_the_count_before_the_key_waits_at_most_three_seconds(parent: str) -> None:
    with clone_of(parent, "coordconv_02_readwait") as (engine, url):
        with engine.begin() as conn:
            seed_devices_without_tenant_key(conn)
        locked, release = threading.Event(), threading.Event()

        def hold() -> None:
            with engine.connect() as holder:
                held = holder.begin()
                holder.execute(
                    text("LOCK TABLE coord.devices IN ACCESS EXCLUSIVE MODE")
                )
                locked.set()
                release.wait(timeout=8)
                held.rollback()

        (step,) = (s for s in revision_module("readwait").STEPS if s.number == 2)
        thread = threading.Thread(target=hold)
        thread.start()
        try:
            assert locked.wait(timeout=10)
            with migration_operations(url), op.get_context().autocommit_block():
                started = time.monotonic()
                with pytest.raises(DBAPIError, match="lock timeout"):
                    step.apply()
                waited = time.monotonic() - started
        finally:
            release.set()
            thread.join(timeout=15)
        assert waited < 6.0, f"the count waited {waited:.1f}s for coord.devices"
        assert _key_lines(engine) == set()
