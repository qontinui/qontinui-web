"""Round-trip + shape test for ``plan_library_02_kind_lock``.

Cross-phase correctness fix for ``2026-08-10-plan-and-prompt-library-in-web``.

What is worth asserting here, beyond "the column exists":

* the round trip actually REMOVES the column (a downgrade that silently
  leaves it behind would let a re-upgrade pass on a schema that never
  round-tripped);
* the default is ``false`` — every phase-1 row predates the notion of a
  deliberate kind and none of them may claim the lock;
* ``NOT NULL``, so no row can be "maybe locked";
* ``ix_work_artifacts_scan_identity`` is NOT unique — an already-forked
  corpus must keep loading so the API can report the fork, and a unique index
  here would fail the migration on exactly the databases that need it most.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=localhost:5433`` when 5432 is not
the one accepting the test credentials.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "plan_library_02_kind_lock"
_PARENT_REVISION_ID = "plan_library_01_work_artifacts"
_REVISION_FILENAME = "plan_library_02_kind_lock.py"


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_down_revision_pins_the_phase_one_revision() -> None:
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None
    assert match.group("parent") == _PARENT_REVISION_ID


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
    assert same_id == [_REVISION_FILENAME], (
        f"revision id {_REVISION_ID!r} is claimed by {same_id}"
    )


def test_the_ddl_is_hand_authored_and_idempotent() -> None:
    """``IF NOT EXISTS`` / ``IF EXISTS`` on every statement, both directions."""
    source = _revision_source()
    assert "ADD COLUMN IF NOT EXISTS kind_locked" in source
    assert "DROP COLUMN IF EXISTS kind_locked" in source
    assert source.count("CREATE INDEX IF NOT EXISTS") == 2
    assert source.count("DROP INDEX IF EXISTS") == 2


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:5433 "
        "before running this test."
    ),
)


def _column(engine: Engine, name: str) -> dict[str, object] | None:
    sql = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'agent'
           AND table_name = 'work_artifacts'
           AND column_name = :name
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql, {"name": name}).mappings().first()
    return dict(row) if row is not None else None


def _index_defs(engine: Engine) -> dict[str, str]:
    sql = text(
        """
        SELECT indexname, indexdef
          FROM pg_indexes
         WHERE schemaname = 'agent' AND tablename = 'work_artifacts'
        """
    )
    with engine.connect() as conn:
        return {r.indexname: r.indexdef for r in conn.execute(sql)}


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    """head → downgrade -1 → head. ``-1`` is correct: this IS the head."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_kindlock") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        col = _column(engine, "kind_locked")
        assert col is not None, "kind_locked did not land"
        assert col["data_type"] == "boolean"
        assert col["is_nullable"] == "NO"
        assert "false" in str(col["column_default"]).lower()

        indexes = _index_defs(engine)
        assert "ix_work_artifacts_scan_identity" in indexes
        scan_idx = indexes["ix_work_artifacts_scan_identity"]
        assert "UNIQUE" not in scan_idx.upper(), (
            "the scan-identity index must NOT be unique — an already-forked "
            "corpus has to keep loading so the fork can be reported"
        )
        assert "slug" in scan_idx
        assert "source_repo" in scan_idx
        assert "kind_locked" in indexes["ix_work_artifacts_kind_locked"]

        run_alembic(root, db_url, "downgrade", "-1")
        assert _column(engine, "kind_locked") is None, (
            "kind_locked survived the downgrade"
        )
        after_down = _index_defs(engine)
        assert "ix_work_artifacts_scan_identity" not in after_down
        assert "ix_work_artifacts_kind_locked" not in after_down
        # Phase 1's tables are untouched by this revision's downgrade.
        assert "uq_work_artifacts_identity" in after_down

        run_alembic(root, db_url, "upgrade", "head")
        assert _column(engine, "kind_locked") is not None
        assert "ix_work_artifacts_scan_identity" in _index_defs(engine)


@_PG_SKIP
def test_existing_rows_backfill_to_unlocked() -> None:
    """A pre-fix row must not come back claiming a deliberate kind."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_backfill") as (engine, db_url):
        # Stop at phase 1 — the schema as it was before this fix.
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        assert _column(engine, "kind_locked") is None

        artifact_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO agent.work_artifacts
                        (id, kind, slug, title, status, body, content_sha256)
                    VALUES (:id, 'handoff', 'legacy', 'legacy', 'VETTED',
                            'b', 'sha')
                    """
                ),
                {"id": artifact_id},
            )

        run_alembic(root, db_url, "upgrade", "head")
        with engine.connect() as conn:
            locked = conn.execute(
                text("SELECT kind_locked FROM agent.work_artifacts WHERE id = :id"),
                {"id": artifact_id},
            ).scalar()
        assert locked is False


@_PG_SKIP
def test_the_scan_identity_index_tolerates_a_forked_corpus() -> None:
    """Two kinds for one slug must still migrate — that is the broken state."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_forked") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            for kind in ("plan", "handoff"):
                conn.execute(
                    text(
                        """
                        INSERT INTO agent.work_artifacts
                            (kind, slug, title, status, body, content_sha256)
                        VALUES (:kind, 'forked', 't', '', 'b', :sha)
                        """
                    ),
                    {"kind": kind, "sha": uuid.uuid4().hex},
                )

        # The whole point: this must NOT raise.
        run_alembic(root, db_url, "upgrade", "head")
        with engine.connect() as conn:
            count = conn.execute(
                text("SELECT count(*) FROM agent.work_artifacts WHERE slug = 'forked'")
            ).scalar()
        assert count == 2
