"""``coordconv_01`` step 1: the chain gains production's ``coord.devices.metadata``.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. A fresh database gains exactly production's column on ``coord.devices``.
2. Production's shape keeps its column and its rows' values, and ends with the
   same ``coord.devices`` definitions as a fresh database.
3. A second run changes nothing; a downgrade returns the parent's chain shape.
4. A column of that name in a shape Phase 0 did not measure refuses step 1,
   and the column is left as it was.
5. The downgrade refuses to remove the column while a row holds a value in it,
   and refuses before it undoes anything: the stamp stays and so does every
   other object. A value written while the undo waits for its lock is counted.
"""

from __future__ import annotations

import threading
import time

import pytest
from sqlalchemy import text

from tests.test_coordconv_00_production_shape import (
    PARENT_REVISION_ID,
    PRODUCTION_ONLY_LINES,
    catalog_lines,
    clone_of,
    downgrade,
    downgrade_refused,
    insert_device,
    insert_tenant,
    object_lines,
    rerun,
    revision_module,
    run_in_revision,
    scalar_at,
    seed_devices_metadata,
    shared_template,
    upgrade,
    upgrade_refused,
)

_LINE = "column\tcoord.devices.metadata\tjsonb|t|'{}'::jsonb|||"


def test_step_1_targets_the_measured_production_column() -> None:
    assert revision_module("t01").METADATA_COLUMN == ("jsonb", True, "'{}'::jsonb")
    assert _LINE in PRODUCTION_ONLY_LINES


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_a_fresh_database_gains_exactly_the_production_column(parent: str) -> None:
    with clone_of(parent, "coordconv_01_fresh") as (engine, url):
        before = catalog_lines(engine)
        upgrade(url)
        after = catalog_lines(engine)
    assert object_lines(after - before, "coord.devices") == {_LINE}
    assert object_lines(before - after, "coord.devices") == set()


def test_production_shape_keeps_its_column_and_converges(parent: str) -> None:
    with (
        clone_of(parent, "coordconv_01_fresh") as (fresh, fresh_url),
        clone_of(parent, "coordconv_01_prod") as (prod, prod_url),
    ):
        with prod.begin() as conn:
            seed_devices_metadata(conn)
            device = insert_device(conn, insert_tenant(conn))
            conn.execute(
                text(
                    "UPDATE coord.devices SET metadata = '{\"kept\": true}' "
                    "WHERE device_id = :d"
                ),
                {"d": device},
            )
        before = object_lines(catalog_lines(prod), "coord.devices")
        upgrade(prod_url)
        upgrade(fresh_url)
        after = object_lines(catalog_lines(prod), "coord.devices")
        assert after == before
        assert after == object_lines(catalog_lines(fresh), "coord.devices")
        kept = scalar_at(
            prod, "SELECT metadata FROM coord.devices WHERE device_id = :d", d=device
        )
    assert kept == {"kept": True}


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_01_rerun") as (engine, url):
        upgrade(url)
        once = catalog_lines(engine, ("coord", "web"))
        rerun(url)
        assert catalog_lines(engine, ("coord", "web")) == once


def test_downgrade_returns_the_parent_chain_shape(parent: str) -> None:
    with clone_of(parent, "coordconv_01_down") as (engine, url):
        before = catalog_lines(engine, ("coord", "web"))
        upgrade(url)
        downgrade(url)
        assert catalog_lines(engine, ("coord", "web")) == before


def test_an_unmeasured_column_shape_refuses_step_1(parent: str) -> None:
    with clone_of(parent, "coordconv_01_odd") as (engine, url):
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE coord.devices ADD COLUMN metadata jsonb"))
        before = object_lines(catalog_lines(engine), "coord.devices")
        stderr = upgrade_refused(url)
        assert "coordconv_01 step 1:" in stderr, stderr
        assert "was never measured" in stderr, stderr
        assert object_lines(catalog_lines(engine), "coord.devices") == before


def test_the_downgrade_refuses_before_it_undoes_anything(parent: str) -> None:
    with clone_of(parent, "coordconv_01_valued") as (engine, url):
        upgrade(url)
        with engine.begin() as conn:
            device = insert_device(conn, insert_tenant(conn))
            conn.execute(
                text(
                    "UPDATE coord.devices SET metadata = '{\"k\": 1}' "
                    "WHERE device_id = :d"
                ),
                {"d": device},
            )
        upgraded = catalog_lines(engine, ("coord", "web"))
        stderr = downgrade_refused(url)
        assert "coordconv_01 step 1: undo: 1 coord.devices row(s)" in stderr, stderr
        assert catalog_lines(engine, ("coord", "web")) == upgraded
        stamp = scalar_at(engine, "SELECT version_num FROM public.alembic_version")
    assert stamp == "coordconv_01"


def test_a_value_written_while_the_undo_waits_for_its_lock_is_counted(
    parent: str,
) -> None:
    """The count runs after the table lock, so it cannot miss a value that
    commits in between and drop it with the column."""
    with clone_of(parent, "coordconv_01_race") as (engine, url):
        upgrade(url)
        with engine.begin() as conn:
            device = insert_device(conn, insert_tenant(conn))
        module = revision_module("race")
        writing = threading.Event()

        def write_a_value() -> None:
            with engine.connect() as writer:
                held = writer.begin()
                writer.execute(
                    text(
                        "UPDATE coord.devices SET metadata = '{\"late\": 1}' "
                        "WHERE device_id = :d"
                    ),
                    {"d": device},
                )
                writing.set()
                time.sleep(1.0)
                held.commit()

        thread = threading.Thread(target=write_a_value)
        thread.start()
        try:
            assert writing.wait(timeout=10)
            with pytest.raises(RuntimeError, match="step 1: undo: 1 coord.devices row"):
                run_in_revision(url, module._undo_01_devices_metadata)
        finally:
            thread.join(timeout=15)
        assert object_lines(catalog_lines(engine), "coord.devices.metadata") == {_LINE}
