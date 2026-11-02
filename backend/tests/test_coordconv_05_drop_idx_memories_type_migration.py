"""``coordconv_01`` step 5: production drops ``idx_memories_type``.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. A fresh database never has the index, before or after.
2. Production's shape loses it (an ``INVALID`` copy too) and ends with the same
   ``coord.memories`` definitions as a fresh database.
3. An index of that name with another definition refuses step 5 and is left
   as it was.
4. A second run changes nothing; the downgrade recreates nothing, because the
   parent chain has no such index.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests.test_coordconv_00_production_shape import (
    PARENT_REVISION_ID,
    PRODUCTION_ONLY_LINES,
    catalog_lines,
    clone_of,
    downgrade,
    object_lines,
    rerun,
    revision_module,
    scalar_at,
    seed_idx_memories_type,
    shared_template,
    upgrade,
    upgrade_refused,
)

_STEP = 5
_INDEX = "idx_memories_type"
_DEFINITION = (
    "CREATE INDEX idx_memories_type ON coord.memories "
    "USING btree (type) WHERE (NOT is_tombstone)"
)


def _index_lines(engine: Engine, name: str = _INDEX) -> set[str]:
    return object_lines(catalog_lines(engine), f"coord.{name}")


def test_step_5_targets_the_measured_production_index() -> None:
    indexes = revision_module("t05").PRODUCTION_ONLY_MEMORIES_INDEXES
    assert indexes[_INDEX] == _DEFINITION
    assert f"index\tcoord.{_INDEX}\t{_DEFINITION}|t" in PRODUCTION_ONLY_LINES


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_a_fresh_database_never_has_the_index(parent: str) -> None:
    with clone_of(parent, "coordconv_05_fresh") as (engine, url):
        assert _index_lines(engine) == set()
        upgrade(url)
        assert _index_lines(engine) == set()


def test_production_shape_loses_the_index(parent: str) -> None:
    with (
        clone_of(parent, "coordconv_05_fresh") as (fresh, fresh_url),
        clone_of(parent, "coordconv_05_prod") as (prod, prod_url),
    ):
        with prod.begin() as conn:
            seed_idx_memories_type(conn)
        assert _index_lines(prod) == {f"index\tcoord.{_INDEX}\t{_DEFINITION}|t"}
        upgrade(prod_url)
        upgrade(fresh_url)
        assert _index_lines(prod) == set()
        memories = ("coord.memories", f"coord.{_INDEX}")
        assert object_lines(catalog_lines(prod), *memories) == object_lines(
            catalog_lines(fresh), *memories
        )


def test_an_invalid_copy_is_dropped_too(parent: str) -> None:
    with clone_of(parent, "coordconv_05_invalid") as (engine, url):
        if not scalar_at(
            engine, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
        ):
            pytest.skip("marking an index INVALID needs a superuser login")
        with engine.begin() as conn:
            seed_idx_memories_type(conn)
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false "
                    "WHERE indexrelid = 'coord.idx_memories_type'::regclass"
                )
            )
        assert _index_lines(engine) == {f"index\tcoord.{_INDEX}\t{_DEFINITION}|f"}
        upgrade(url)
        assert _index_lines(engine) == set()


def test_another_definition_refuses_step_5(parent: str) -> None:
    with clone_of(parent, "coordconv_05_odd") as (engine, url):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE INDEX idx_memories_type "
                    "ON coord.memories USING btree (type)"
                )
            )
        before = _index_lines(engine)
        stderr = upgrade_refused(url)
        assert f"coordconv_01 step {_STEP}:" in stderr, stderr
        assert "was never measured" in stderr, stderr
        assert _index_lines(engine) == before


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_05_rerun") as (engine, url):
        with engine.begin() as conn:
            seed_idx_memories_type(conn)
        upgrade(url)
        once = catalog_lines(engine, ("coord", "web"))
        rerun(url)
        assert catalog_lines(engine, ("coord", "web")) == once


def test_downgrade_recreates_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_05_down") as (engine, url):
        with engine.begin() as conn:
            seed_idx_memories_type(conn)
        upgrade(url)
        downgrade(url)
        assert _index_lines(engine) == set()
