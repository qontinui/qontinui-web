"""``coordconv_01`` step 6: production drops ``idx_memories_written_at``.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. A fresh database never has the index, before or after.
2. Production's shape loses it (an ``INVALID`` copy too) and ends with the same
   ``coord.memories`` definitions as a fresh database; the chain's own
   ``idx_memories_recent``, on the same key, stays.
3. An index of that name with another definition refuses step 6 and is left
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
    seed_idx_memories_written_at,
    shared_template,
    upgrade,
    upgrade_refused,
)

_STEP = 6
_INDEX = "idx_memories_written_at"
_DEFINITION = (
    "CREATE INDEX idx_memories_written_at ON coord.memories "
    "USING btree (written_at DESC)"
)
_TWIN = "idx_memories_recent"


def _index_lines(engine: Engine, name: str = _INDEX) -> set[str]:
    return object_lines(catalog_lines(engine), f"coord.{name}")


def test_step_6_targets_the_measured_production_index() -> None:
    indexes = revision_module("t06").PRODUCTION_ONLY_MEMORIES_INDEXES
    assert indexes[_INDEX] == _DEFINITION
    assert f"index\tcoord.{_INDEX}\t{_DEFINITION}|t" in PRODUCTION_ONLY_LINES


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_a_fresh_database_never_has_the_index(parent: str) -> None:
    with clone_of(parent, "coordconv_06_fresh") as (engine, url):
        assert _index_lines(engine) == set()
        upgrade(url)
        assert _index_lines(engine) == set()


def test_production_shape_loses_the_index_and_keeps_its_twin(parent: str) -> None:
    with (
        clone_of(parent, "coordconv_06_fresh") as (fresh, fresh_url),
        clone_of(parent, "coordconv_06_prod") as (prod, prod_url),
    ):
        with prod.begin() as conn:
            seed_idx_memories_written_at(conn)
        assert _index_lines(prod) == {f"index\tcoord.{_INDEX}\t{_DEFINITION}|t"}
        upgrade(prod_url)
        upgrade(fresh_url)
        assert _index_lines(prod) == set()
        memories = ("coord.memories", f"coord.{_INDEX}", f"coord.{_TWIN}")
        assert object_lines(catalog_lines(prod), *memories) == object_lines(
            catalog_lines(fresh), *memories
        )
        twin = _index_lines(prod, _TWIN)
    assert twin == {f"index\tcoord.{_TWIN}\t{_DEFINITION.replace(_INDEX, _TWIN)}|t"}


def test_an_invalid_copy_is_dropped_too(parent: str) -> None:
    with clone_of(parent, "coordconv_06_invalid") as (engine, url):
        if not scalar_at(
            engine, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
        ):
            pytest.skip("marking an index INVALID needs a superuser login")
        with engine.begin() as conn:
            seed_idx_memories_written_at(conn)
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false "
                    "WHERE indexrelid = 'coord.idx_memories_written_at'::regclass"
                )
            )
        assert _index_lines(engine) == {f"index\tcoord.{_INDEX}\t{_DEFINITION}|f"}
        upgrade(url)
        assert _index_lines(engine) == set()


def test_another_definition_refuses_step_6(parent: str) -> None:
    with clone_of(parent, "coordconv_06_odd") as (engine, url):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE INDEX idx_memories_written_at "
                    "ON coord.memories USING btree (written_at)"
                )
            )
        before = _index_lines(engine)
        stderr = upgrade_refused(url)
        assert f"coordconv_01 step {_STEP}:" in stderr, stderr
        assert "was never measured" in stderr, stderr
        assert _index_lines(engine) == before


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_06_rerun") as (engine, url):
        with engine.begin() as conn:
            seed_idx_memories_written_at(conn)
        upgrade(url)
        once = catalog_lines(engine, ("coord", "web"))
        rerun(url)
        assert catalog_lines(engine, ("coord", "web")) == once


def test_downgrade_recreates_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_06_down") as (engine, url):
        with engine.begin() as conn:
            seed_idx_memories_written_at(conn)
        upgrade(url)
        downgrade(url)
        assert _index_lines(engine) == set()
