"""``coordconv_01`` step 7: the chain gains production's ``idx_agent_questions_agent``.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. A fresh database gains exactly production's index, valid.
2. Production's shape keeps its index, and both end with the same definition.
3. An ``INVALID`` index of that definition (an interrupted build) is rebuilt;
   ``IF NOT EXISTS`` would have kept it.
4. An index of that name with another definition refuses step 7 and is left
   as it was.
5. A second run changes nothing; a downgrade removes it from a fresh database
   again.
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
    seed_idx_agent_questions_agent,
    shared_template,
    upgrade,
    upgrade_refused,
)

_OBJECT = "coord.idx_agent_questions_agent"
_DEFINITION = (
    "CREATE INDEX idx_agent_questions_agent ON coord.agent_questions "
    "USING btree (agent_id, created_at DESC)"
)
_LINE = f"index\t{_OBJECT}\t{_DEFINITION}|t"


def _index_lines(engine: Engine) -> set[str]:
    return object_lines(catalog_lines(engine), _OBJECT)


def test_step_7_targets_the_measured_production_index() -> None:
    assert revision_module("t07").AGENT_QUESTIONS_AGENT_DEFINITION == _DEFINITION
    assert _LINE in PRODUCTION_ONLY_LINES


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_a_fresh_database_gains_exactly_the_production_index(parent: str) -> None:
    with clone_of(parent, "coordconv_07_fresh") as (engine, url):
        before = catalog_lines(engine)
        upgrade(url)
        after = catalog_lines(engine)
    assert object_lines(after - before, _OBJECT, "coord.agent_questions") == {_LINE}
    assert object_lines(before - after, _OBJECT, "coord.agent_questions") == set()


def test_production_shape_keeps_its_index_and_converges(parent: str) -> None:
    with (
        clone_of(parent, "coordconv_07_fresh") as (fresh, fresh_url),
        clone_of(parent, "coordconv_07_prod") as (prod, prod_url),
    ):
        with prod.begin() as conn:
            seed_idx_agent_questions_agent(conn)
        assert _index_lines(prod) == {_LINE}
        upgrade(prod_url)
        upgrade(fresh_url)
        assert _index_lines(prod) == {_LINE}
        assert _index_lines(fresh) == {_LINE}


def test_an_invalid_index_is_rebuilt(parent: str) -> None:
    with clone_of(parent, "coordconv_07_invalid") as (engine, url):
        if not scalar_at(
            engine, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
        ):
            pytest.skip("marking an index INVALID needs a superuser login")
        with engine.begin() as conn:
            seed_idx_agent_questions_agent(conn)
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false "
                    "WHERE indexrelid = 'coord.idx_agent_questions_agent'::regclass"
                )
            )
        assert _index_lines(engine) == {f"index\t{_OBJECT}\t{_DEFINITION}|f"}
        upgrade(url)
        assert _index_lines(engine) == {_LINE}


def test_another_definition_refuses_step_7(parent: str) -> None:
    with clone_of(parent, "coordconv_07_odd") as (engine, url):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE INDEX idx_agent_questions_agent "
                    "ON coord.agent_questions USING btree (agent_id)"
                )
            )
        before = _index_lines(engine)
        stderr = upgrade_refused(url)
        assert "coordconv_01 step 7:" in stderr, stderr
        assert "was never measured" in stderr, stderr
        assert _index_lines(engine) == before


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_07_rerun") as (engine, url):
        upgrade(url)
        once = catalog_lines(engine, ("coord", "web"))
        rerun(url)
        assert catalog_lines(engine, ("coord", "web")) == once


def test_downgrade_removes_it_from_a_fresh_database(parent: str) -> None:
    with clone_of(parent, "coordconv_07_down") as (engine, url):
        upgrade(url)
        assert _index_lines(engine) == {_LINE}
        downgrade(url)
        assert _index_lines(engine) == set()
