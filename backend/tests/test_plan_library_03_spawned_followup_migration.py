"""Round-trip + constraint test for ``plan_library_03_spawned_followup``.

Phase 7 of ``2026-08-16-plan-corpus-authority-and-run-provenance``.

Dropping ``NOT NULL`` from ``agent.work_artifact_edges.to_id`` is the riskiest
change in the phase, so the assertions here are about the FENCES, not just the
relaxation:

* ``spawned_followup`` is admitted by the relation CHECK;
* a null ``to_id`` is accepted for it — the whole point;
* a null ``to_id`` is still REJECTED for each of the four shipped relations,
  tested one at a time. This is the regression that would corrupt
  ``/candidates``: it joins ``depends_on`` through ``to_id`` to compute unmet
  dependencies, and a null-target row silently drops out of that join, so a
  blocked plan reads as ready;
* a blank note on a follow-up is rejected — with no far end the note IS the row;
* two DIFFERENT follow-ups off one plan both insert (wanted: a plan can surface
  several), while the SAME note re-posted collides on the partial unique index;
* the round trip actually restores ``NOT NULL`` and the five-value vocabulary.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:5433`` when 5432 is not the
one accepting the test credentials.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "plan_library_03_spawned_followup"
_PARENT_REVISION_ID = "runprov_01_worktree_census_build_target"
_REVISION_FILENAME = "plan_library_03_spawned_followup.py"

#: The four relations that MUST keep requiring a target. ``spawned_followup``
#: is deliberately absent, and ``supersedes`` is in — all five pre-existing
#: members are checked, one at a time, so a failure names the relation.
_TWO_ENDED_RELATIONS = (
    "produced_report",
    "feeds",
    "authored_plan",
    "supersedes",
    "depends_on",
)


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_down_revision_pins_the_current_head() -> None:
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


def test_the_relation_check_is_discovered_not_assumed() -> None:
    """The CHECK is dropped via ``pg_constraint``, never by an assumed name.

    ``plan_library_01`` declared it inline; the name is an implementation
    detail. Dropping by a guessed name is how a migration fails on the one
    database whose constraint was auto-named.
    """
    source = _revision_source()
    assert "pg_constraint" in source
    assert "DROP CONSTRAINT %I" in source
    assert "to_regclass('agent.work_artifact_edges')" in source


def test_the_ddl_is_idempotent_in_both_directions() -> None:
    source = _revision_source()
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_open_followup" in (
        source
    )
    assert "DROP INDEX IF EXISTS agent.uq_work_artifact_edges_open_followup" in source
    # The nullability flip goes both ways, and each direction's form is a no-op
    # when already applied — which is what makes a re-run safe without an
    # ``IF EXISTS`` the schema-arg pre-commit gate cannot parse.
    assert "ALTER COLUMN to_id DROP NOT NULL" in source
    assert "ALTER COLUMN to_id SET NOT NULL" in source
    # The relation CHECK is re-added on BOTH sides (widened, then restored).
    assert source.count("ADD CONSTRAINT ck_work_artifact_edges_relation") == 2
    # …and every ALTER TABLE names the schema, which the gate enforces.
    assert "ALTER TABLE IF EXISTS" not in source
    assert source.count("ALTER TABLE agent.work_artifact_edges") == 7


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


def _to_id_is_nullable(engine: Engine) -> bool:
    sql = text(
        """
        SELECT is_nullable
          FROM information_schema.columns
         WHERE table_schema = 'agent'
           AND table_name = 'work_artifact_edges'
           AND column_name = 'to_id'
        """
    )
    with engine.connect() as conn:
        return conn.execute(sql).scalar_one() == "YES"


def _checks(engine: Engine) -> dict[str, str]:
    sql = text(
        """
        SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS clause
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'agent'
           AND rel.relname = 'work_artifact_edges'
           AND con.contype = 'c'
        """
    )
    with engine.connect() as conn:
        return {row.name: row.clause for row in conn.execute(sql)}


def _indexes(engine: Engine) -> dict[str, str]:
    sql = text(
        """
        SELECT indexname, indexdef
          FROM pg_indexes
         WHERE schemaname = 'agent' AND tablename = 'work_artifact_edges'
        """
    )
    with engine.connect() as conn:
        return {r.indexname: r.indexdef for r in conn.execute(sql)}


def _seed_artifact(engine: Engine, slug: str) -> uuid.UUID:
    artifact_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO agent.work_artifacts
                    (id, kind, slug, title, status, body, content_sha256)
                VALUES (:id, 'plan', :slug, 't', 'VETTED', 'b', :sha)
                """
            ),
            {"id": artifact_id, "slug": slug, "sha": uuid.uuid4().hex},
        )
    return artifact_id


def _insert_edge(
    engine: Engine,
    *,
    from_id: uuid.UUID,
    to_id: uuid.UUID | None,
    relation: str,
    note: str | None,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO agent.work_artifact_edges
                    (from_id, to_id, relation, note)
                VALUES (:from_id, :to_id, :relation, :note)
                """
            ),
            {
                "from_id": from_id,
                "to_id": to_id,
                "relation": relation,
                "note": note,
            },
        )


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    """head → downgrade to the PARENT BY NAME → head.

    The rewind target is ``_PARENT_REVISION_ID``, never ``-1``. A relative step
    is correct only while this revision is the head, and being the head is a
    property of the branch on the day the test was written. The moment anyone
    chains a descendant on, ``-1`` unwinds THAT revision instead and the
    assertions below fail while blaming plan-library for an unrelated change.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_followup") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        assert _to_id_is_nullable(engine), "to_id did not become nullable"

        checks = _checks(engine)
        assert "spawned_followup" in checks["ck_work_artifact_edges_relation"]
        assert "ck_work_artifact_edges_open_target" in checks
        assert "ck_work_artifact_edges_followup_note" in checks

        indexes = _indexes(engine)
        assert "uq_work_artifact_edges_open_followup" in indexes
        open_idx = indexes["uq_work_artifact_edges_open_followup"]
        assert "UNIQUE" in open_idx.upper()
        assert "btrim" in open_idx
        assert "to_id IS NULL" in open_idx

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        assert not _to_id_is_nullable(engine), (
            "to_id stayed nullable after the downgrade"
        )
        after_down = _checks(engine)
        assert "spawned_followup" not in after_down["ck_work_artifact_edges_relation"]
        assert "ck_work_artifact_edges_open_target" not in after_down
        assert "ck_work_artifact_edges_followup_note" not in after_down
        assert "uq_work_artifact_edges_open_followup" not in _indexes(engine)
        # Phase 1's own index is untouched by this revision's downgrade.
        assert "uq_work_artifact_edges_from_to_relation" in _indexes(engine)

        run_alembic(root, db_url, "upgrade", "head")
        assert _to_id_is_nullable(engine)
        assert "uq_work_artifact_edges_open_followup" in _indexes(engine)


@_PG_SKIP
def test_the_downgrade_discards_followup_rows() -> None:
    """The one destructive step, asserted rather than left to be discovered.

    The pre-revision vocabulary has no shape a ``spawned_followup`` could be
    rewritten into, so the downgrade deletes them. A downgrade that instead
    raised would leave the database un-rewindable, which is worse.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_fu_down") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        plan = _seed_artifact(engine, "origin-plan")
        _insert_edge(
            engine,
            from_id=plan,
            to_id=None,
            relation="spawned_followup",
            note="worth its own plan",
        )

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        with engine.connect() as conn:
            remaining = conn.execute(
                text("SELECT count(*) FROM agent.work_artifact_edges")
            ).scalar()
        assert remaining == 0

        # And the artifact itself survives — only the edge went.
        with engine.connect() as conn:
            artifacts = conn.execute(
                text("SELECT count(*) FROM agent.work_artifacts")
            ).scalar()
        assert artifacts == 1


@_PG_SKIP
def test_a_null_target_is_accepted_only_for_spawned_followup() -> None:
    """The guard, from both sides.

    Each two-ended relation is tried INDIVIDUALLY. A single loop assertion
    would still catch the regression, but a per-relation failure names the one
    that broke, and ``depends_on`` breaking is the one with teeth.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_fu_guard") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        plan = _seed_artifact(engine, "guard-plan")

        # The new relation: a null target is the whole point.
        _insert_edge(
            engine,
            from_id=plan,
            to_id=None,
            relation="spawned_followup",
            note="the surfaced work",
        )

        for relation in _TWO_ENDED_RELATIONS:
            with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
                _insert_edge(
                    engine,
                    from_id=plan,
                    to_id=None,
                    relation=relation,
                    note="should not be accepted",
                )
            assert "to_id" in str(excinfo.value) or "open_target" in str(excinfo.value)


@_PG_SKIP
def test_a_blank_note_is_rejected_for_a_followup() -> None:
    """With no far end the note is the payload — an empty one is a dead row."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_fu_note") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        plan = _seed_artifact(engine, "note-plan")

        for blank in (None, "", "   \n\t "):
            with pytest.raises((IntegrityError, DBAPIError)):
                _insert_edge(
                    engine,
                    from_id=plan,
                    to_id=None,
                    relation="spawned_followup",
                    note=blank,
                )


@_PG_SKIP
def test_two_different_followups_insert_but_a_repost_collides() -> None:
    """The duplicate guard's exact grain.

    A plan may surface SEVERAL follow-ups, so distinct notes must both land.
    The same note re-posted is a re-post, not a second finding, and collides on
    the partial unique index — which is what lets the CRUD layer make the write
    idempotent instead of stacking queue entries.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_fu_dupe") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        plan = _seed_artifact(engine, "dupe-plan")

        _insert_edge(
            engine,
            from_id=plan,
            to_id=None,
            relation="spawned_followup",
            note="first finding",
        )
        _insert_edge(
            engine,
            from_id=plan,
            to_id=None,
            relation="spawned_followup",
            note="second, different finding",
        )
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT count(*) FROM agent.work_artifact_edges")
                ).scalar()
                == 2
            )

        # ``btrim`` folds the whitespace variant onto the same key.
        with pytest.raises((IntegrityError, DBAPIError)):
            _insert_edge(
                engine,
                from_id=plan,
                to_id=None,
                relation="spawned_followup",
                note="  first finding  ",
            )


@_PG_SKIP
def test_the_null_target_rejections_are_a_real_negative_control() -> None:
    """The four-relation rejection must not be a vacuous pass.

    Before this revision ``to_id`` was ``NOT NULL``, so the rejections above
    would pass on the PRE-migration schema too — for a different reason, and
    without proving the new guard does anything. This pins that difference: at
    the parent revision even ``spawned_followup`` is rejected (the relation is
    not in the vocabulary AND the column is NOT NULL), which is exactly what
    makes the post-migration acceptance meaningful.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_fu_ctrl") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        plan = _seed_artifact(engine, "control-plan")

        assert not _to_id_is_nullable(engine)
        with pytest.raises((IntegrityError, DBAPIError)):
            _insert_edge(
                engine,
                from_id=plan,
                to_id=None,
                relation="spawned_followup",
                note="not yet expressible",
            )
