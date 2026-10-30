"""``coordconv_01`` step 8: the chain gains production's wider ``idx_agent_questions_session``.

What must hold (plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 "Before 6.1"):

1. A fresh database's narrow index becomes production's wide one.
2. Production's shape keeps its wide index.
3. A run interrupted at any point of the swap resumes there: after the staging
   build, after the old index's drop, with an ``INVALID`` staging index, or
   with a staging index left behind after the rename.
4. An index of that name that is neither definition refuses step 8 and is left
   as it was, and so does a database with no such index at all.
5. A second run changes nothing; a downgrade returns the narrow chain index.
"""

from __future__ import annotations

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
    object_lines,
    rerun,
    revision_module,
    scalar_at,
    seed_wide_idx_agent_questions_session,
    shared_template,
    upgrade,
    upgrade_refused,
)

_WIDE = (
    "CREATE INDEX idx_agent_questions_session ON coord.agent_questions "
    "USING btree (agent_session_id, created_at DESC) "
    "WHERE (agent_session_id IS NOT NULL)"
)
_NARROW = (
    "CREATE INDEX idx_agent_questions_session ON coord.agent_questions "
    "USING btree (agent_session_id) WHERE (agent_session_id IS NOT NULL)"
)
_WIDE_LINE = f"index\tcoord.idx_agent_questions_session\t{_WIDE}|t"
_NARROW_LINE = f"index\tcoord.idx_agent_questions_session\t{_NARROW}|t"
_STAGING = "idx_agent_questions_session_cc01"
_CREATE_WIDE_STAGING = (
    f"CREATE INDEX {_STAGING} ON coord.agent_questions "
    "USING btree (agent_session_id, created_at DESC) "
    "WHERE (agent_session_id IS NOT NULL)"
)


def _session_lines(engine: Engine) -> set[str]:
    return object_lines(
        catalog_lines(engine),
        "coord.idx_agent_questions_session",
        f"coord.{_STAGING}",
    )


def test_step_8_targets_the_measured_definitions() -> None:
    module = revision_module("t08")
    assert module.SESSION_WIDE_DEFINITION == _WIDE
    assert module.SESSION_NARROW_DEFINITION == _NARROW
    assert module.SESSION_STAGING == _STAGING
    assert _WIDE_LINE in PRODUCTION_ONLY_LINES
    assert _NARROW_LINE in CHAIN_ONLY_LINES


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(PARENT_REVISION_ID)


def test_a_fresh_database_gets_the_wide_index(parent: str) -> None:
    with clone_of(parent, "coordconv_08_fresh") as (engine, url):
        assert _session_lines(engine) == {_NARROW_LINE}
        upgrade(url)
        assert _session_lines(engine) == {_WIDE_LINE}


def test_production_shape_keeps_its_wide_index(parent: str) -> None:
    with clone_of(parent, "coordconv_08_prod") as (engine, url):
        with engine.begin() as conn:
            seed_wide_idx_agent_questions_session(conn)
        upgrade(url)
        assert _session_lines(engine) == {_WIDE_LINE}


@pytest.mark.parametrize(
    "interrupted_state",
    ["after_staging_build", "after_old_index_drop", "after_rename"],
)
def test_an_interrupted_swap_resumes(parent: str, interrupted_state: str) -> None:
    with clone_of(parent, "coordconv_08_resume") as (engine, url):
        with engine.begin() as conn:
            conn.execute(text(_CREATE_WIDE_STAGING))
            if interrupted_state == "after_old_index_drop":
                conn.execute(text("DROP INDEX coord.idx_agent_questions_session"))
            if interrupted_state == "after_rename":
                seed_wide_idx_agent_questions_session(conn)
        upgrade(url)
        assert _session_lines(engine) == {_WIDE_LINE}


def test_an_invalid_staging_index_is_rebuilt(parent: str) -> None:
    with clone_of(parent, "coordconv_08_invalid") as (engine, url):
        if not scalar_at(
            engine, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
        ):
            pytest.skip("marking an index INVALID needs a superuser login")
        with engine.begin() as conn:
            conn.execute(text(_CREATE_WIDE_STAGING))
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false WHERE indexrelid = "
                    "'coord.idx_agent_questions_session_cc01'::regclass"
                )
            )
        upgrade(url)
        assert _session_lines(engine) == {_WIDE_LINE}


def test_another_definition_refuses_step_8(parent: str) -> None:
    with clone_of(parent, "coordconv_08_odd") as (engine, url):
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX coord.idx_agent_questions_session"))
            conn.execute(
                text(
                    "CREATE INDEX idx_agent_questions_session "
                    "ON coord.agent_questions USING btree (agent_session_id)"
                )
            )
        before = _session_lines(engine)
        stderr = upgrade_refused(url)
        assert "coordconv_01 step 8:" in stderr, stderr
        assert "was never measured" in stderr, stderr
        assert _session_lines(engine) == before


def test_a_missing_index_refuses_step_8(parent: str) -> None:
    with clone_of(parent, "coordconv_08_missing") as (engine, url):
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX coord.idx_agent_questions_session"))
        stderr = upgrade_refused(url)
        assert "coordconv_01 step 8:" in stderr, stderr
        assert "does not exist" in stderr, stderr
        assert _session_lines(engine) == set()


def test_a_second_run_changes_nothing(parent: str) -> None:
    with clone_of(parent, "coordconv_08_rerun") as (engine, url):
        upgrade(url)
        once = catalog_lines(engine, ("coord", "web"))
        rerun(url)
        assert catalog_lines(engine, ("coord", "web")) == once


def test_downgrade_returns_the_narrow_chain_index(parent: str) -> None:
    with clone_of(parent, "coordconv_08_down") as (engine, url):
        upgrade(url)
        downgrade(url)
        assert _session_lines(engine) == {_NARROW_LINE}
