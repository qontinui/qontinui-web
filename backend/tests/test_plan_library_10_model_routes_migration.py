"""Round-trip + upsert-target test for ``plan_library_10_model_routes``.

Plan ``2026-10-08-operator-editable-model-family-per-plan-difficulty``.

The API suite runs against a ``create_all`` schema built from the MODEL, so it
cannot notice a migration that disagrees with the model. What would bite only
in production: the save's ``ON CONFLICT (organization_id, level)`` target (it
needs the migration's primary key) and the two CHECKs' vocabularies. Both are
exercised against the alembic-built table, then head → downgrade to the parent
BY NAME → head must leave no residue.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:<port>``.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.models.plan_model_route import (
    FAMILY_CHECK_SQL,
    LEVEL_CHECK_SQL,
    PlanDifficultyModelRoute,
)
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "plan_library_10_model_routes"
_PARENT_REVISION_ID = "prbody_citation_01"
_REVISION_FILENAME = "plan_library_10_model_routes.py"
_TABLE = "plan_difficulty_model_routes"


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_down_revision_pins_the_parent_on_one_line() -> None:
    source = _revision_source()
    assert re.search(r'^down_revision = "[^"]+"$', source, re.MULTILINE), (
        "down_revision must be one unannotated line"
    )
    assert declared_parent_revision_id(source, _REVISION_FILENAME) == (
        _PARENT_REVISION_ID
    )


def test_the_revision_id_is_unique_in_the_chain() -> None:
    versions = backend_root() / "alembic" / "versions"
    same_id = [
        path.name
        for path in versions.glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(_REVISION_ID)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert same_id == [_REVISION_FILENAME]


def test_the_migration_checks_are_the_models() -> None:
    # The migration spells its CHECKs as literals (coord's classifier refuses
    # dynamic SQL); the model builds them from the vocabulary tuples.
    source = _revision_source()
    assert LEVEL_CHECK_SQL in source
    assert FAMILY_CHECK_SQL in source


_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:<port> "
        "before running this test."
    ),
)


def _save(engine: Engine, org: uuid.UUID, level: str, family: str) -> None:
    """The service's exact upsert shape (``save_model_routing``)."""
    stmt = insert(PlanDifficultyModelRoute).values(
        organization_id=org, level=level, model_family=family
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[
            PlanDifficultyModelRoute.organization_id,
            PlanDifficultyModelRoute.level,
        ],
        set_={"model_family": stmt.excluded.model_family},
    )
    with engine.begin() as conn:
        conn.execute(stmt)


def _rows(engine: Engine, org: uuid.UUID) -> dict[str, str]:
    with engine.connect() as conn:
        return {
            r.level: r.model_family
            for r in conn.execute(
                text(
                    "SELECT level, model_family FROM agent.plan_difficulty_model_routes "
                    "WHERE organization_id = :o"
                ),
                {"o": org},
            )
        }


@_PG_SKIP
def test_upgrade_upsert_downgrade_upgrade_round_trip() -> None:
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_model_routes") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        assert table_exists(engine, "agent", _TABLE)

        org = uuid.uuid4()
        _save(engine, org, "high", "fable")
        _save(engine, org, "high", "opus")  # the PK is the conflict target
        _save(engine, org, "medium", "opus")
        assert _rows(engine, org) == {"high": "opus", "medium": "opus"}

        for level, family in (("extreme", "opus"), ("low", "gpt"), ("low", "Opus")):
            with pytest.raises(IntegrityError):
                _save(engine, org, level, family)

        with engine.begin() as conn, pytest.raises(IntegrityError):
            conn.execute(
                text(
                    "INSERT INTO agent.plan_difficulty_model_routes "
                    "(organization_id, level, model_family) VALUES (NULL, 'low', 'opus')"
                )
            )

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "agent", _TABLE)

        run_alembic(root, db_url, "upgrade", "head")
        assert table_exists(engine, "agent", _TABLE)
        assert _rows(engine, org) == {}
