"""``coordconv_01`` step 3: production gains the chain's ``memory_id`` default.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. A fresh database's default is untouched.
2. Production's shape (no default) gains ``gen_random_uuid()``: an ``INSERT``
   that omits ``memory_id`` is refused before and gets an id after, as on a
   fresh database; existing rows keep their ids.
3. Any other default refuses step 3 and is left as it was.
4. A second run changes nothing; the downgrade keeps the default, which the
   parent chain already has.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests.test_coordconv_00_production_shape import (
    CHAIN_ONLY_LINES,
    PARENT_REVISION_ID,
    PRODUCTION_ONLY_LINES,
    catalog_lines,
    clone_of,
    downgrade,
    insert_tenant,
    object_lines,
    rerun,
    revision_module,
    scalar_at,
    seed_memory_id_without_default,
    shared_template,
    upgrade,
    upgrade_refused,
)

_COLUMN = "coord.memories.memory_id"
_CHAIN_LINE = f"column\t{_COLUMN}\tuuid|t|gen_random_uuid()|||"
_PRODUCTION_LINE = f"column\t{_COLUMN}\tuuid|t||||"


def _column_lines(engine: Engine) -> set[str]:
    return object_lines(catalog_lines(engine), _COLUMN)


def _insert_memory_without_id(engine: Engine, tenant: uuid.UUID, name: str) -> object:
    with engine.begin() as conn:
        return conn.execute(
            text(
                "INSERT INTO coord.memories (name, version, content, tenant_id) "
                "VALUES (:n, 1, 'c', :t) RETURNING memory_id"
            ),
            {"n": name, "t": tenant},
        ).scalar_one()


def test_step_3_targets_the_chains_default() -> None:
    assert revision_module("t03").MEMORY_ID_DEFAULT == "gen_random_uuid()"
    assert _CHAIN_LINE in CHAIN_ONLY_LINES
    assert _PRODUCTION_LINE in PRODUCTION_ONLY_LINES


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_a_fresh_databases_default_is_untouched(parent: str) -> None:
    with clone_of(parent, "coordconv_03_fresh") as (engine, url):
        upgrade(url)
        assert _column_lines(engine) == {_CHAIN_LINE}


def test_production_shape_gains_the_default(parent: str) -> None:
    with clone_of(parent, "coordconv_03_prod") as (prod, prod_url):
        with prod.begin() as conn:
            seed_memory_id_without_default(conn)
            tenant = insert_tenant(conn)
            existing = uuid.uuid4()
            conn.execute(
                text(
                    "INSERT INTO coord.memories "
                    "(memory_id, name, version, content, tenant_id) "
                    "VALUES (:m, 'kept', 1, 'c', :t)"
                ),
                {"m": existing, "t": tenant},
            )
        assert _column_lines(prod) == {_PRODUCTION_LINE}
        with pytest.raises(IntegrityError, match="memory_id"):
            _insert_memory_without_id(prod, tenant, "before")
        upgrade(prod_url)
        assert _column_lines(prod) == {_CHAIN_LINE}
        assert isinstance(_insert_memory_without_id(prod, tenant, "after"), uuid.UUID)
        kept = scalar_at(
            prod,
            "SELECT memory_id FROM coord.memories WHERE name = 'kept' AND tenant_id = :t",
            t=tenant,
        )
    assert kept == existing


def test_another_default_refuses_step_3(parent: str) -> None:
    with clone_of(parent, "coordconv_03_odd") as (engine, url):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE coord.memories ALTER COLUMN memory_id "
                    "SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid"
                )
            )
        before = _column_lines(engine)
        stderr = upgrade_refused(url)
        assert "coordconv_01 step 3:" in stderr, stderr
        assert "was never measured" in stderr, stderr
        assert _column_lines(engine) == before


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_03_rerun") as (engine, url):
        with engine.begin() as conn:
            seed_memory_id_without_default(conn)
        upgrade(url)
        once = catalog_lines(engine, ("coord", "web"))
        rerun(url)
        assert catalog_lines(engine, ("coord", "web")) == once


def test_downgrade_keeps_the_parent_chains_default(parent: str) -> None:
    with clone_of(parent, "coordconv_03_down") as (engine, url):
        with engine.begin() as conn:
            seed_memory_id_without_default(conn)
        upgrade(url)
        downgrade(url)
        assert _column_lines(engine) == {_CHAIN_LINE}
