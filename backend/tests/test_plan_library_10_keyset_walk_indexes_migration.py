"""Round-trip + shape test for ``plan_library_10_keyset_walk_indexes``.

Phase 4 of ``2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus``:
the indexes behind the plan-library keyset walks. Worth asserting:

* the work-artifact index LEADS with the org scope's NULL-collapsing
  expression (the one ``_org_scope`` filters on) and then the walk's
  ``(created_at, id)`` — in that order, or the org-scoped walk cannot range
  scan it;
* the edge index is PARTIAL on exactly the open-follow-up predicate;
* both are VALID after a ``CONCURRENTLY`` build, and the round trip removes
  and restores them.

Substrate is ``tests/_alembic_harness``. A skip proves nothing — point it at a
live instance with ``QONTINUI_TEST_PG`` / ``QONTINUI_TEST_PG_DSN``.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "plan_library_10_keyset_walk_indexes"
_PARENT_REVISION_ID = "coord_sessions_fleet_idx_01"
_REVISION_FILENAME = "plan_library_10_keyset_walk_indexes.py"
_ARTIFACT_INDEX = "ix_work_artifacts_org_created_id"
_EDGE_INDEX = "ix_work_artifact_edges_open_followups_created_id"


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_down_revision_pins_the_parent() -> None:
    declared = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID


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


def test_the_ddl_is_idempotent_and_concurrent() -> None:
    source = _revision_source()
    assert source.count("CREATE INDEX CONCURRENTLY IF NOT EXISTS") == 2
    assert source.count("DROP INDEX CONCURRENTLY IF EXISTS") == 2


def test_the_migration_org_expression_is_the_models() -> None:
    from app.models.work_artifact import _IDENTITY_ORG_EXPR

    assert _IDENTITY_ORG_EXPR in _revision_source()


_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:<port> "
        "before running this test."
    ),
)


def _index(engine: Engine, name: str) -> tuple[str, bool] | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT pg_get_indexdef(i.indexrelid), i.indisvalid "
                "FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'agent' AND c.relname = :name"
            ),
            {"name": name},
        ).first()
    return (str(row[0]), bool(row[1])) if row is not None else None


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_keyset") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        artifact = _index(engine, _ARTIFACT_INDEX)
        assert artifact is not None and artifact[1], artifact
        assert re.search(
            r"\(COALESCE\(organization_id, .*\), created_at, id\)", artifact[0]
        ), artifact[0]

        edge = _index(engine, _EDGE_INDEX)
        assert edge is not None and edge[1], edge
        assert "(created_at, id)" in edge[0]
        assert "spawned_followup" in edge[0] and "to_id IS NULL" in edge[0]

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        assert _index(engine, _ARTIFACT_INDEX) is None
        assert _index(engine, _EDGE_INDEX) is None

        run_alembic(root, db_url, "upgrade", "head")
        assert _index(engine, _ARTIFACT_INDEX) is not None
        assert _index(engine, _EDGE_INDEX) is not None
