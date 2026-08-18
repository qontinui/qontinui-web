"""Round-trip + shape test for ``plan_library_01_work_artifacts``.

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``.

The revision's whole value is in constraints that a schema diff does not
read back as behaviour:

* the **functional** unique index — a plain UNIQUE over the raw nullable
  columns would admit unlimited duplicates for org-less / repo-less rows,
  which is exactly the shape a runner scan produces;
* the two **explicitly named** CHECKs (so a future widening never needs the
  ``pg_constraint`` discover-and-drop loop ``coord_prompt_docs_02`` had to
  write after ``coord_prompt_docs_01`` let PostgreSQL auto-name one);
* the **absence** of a CHECK on ``status`` — it must stay opaque;
* the **absence** of a foreign key on ``work_unit_slug`` — coord owns work
  units, and the soft link is allowed to dangle.

Substrate is ``tests/_alembic_harness`` (an ephemeral database inside the
test Postgres). ⚠️ A skip proves nothing — point it at a live instance with
``QONTINUI_TEST_PG=localhost:5433`` when 5432 is not the one accepting the
test credentials.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "plan_library_01_work_artifacts"
_PARENT_REVISION_ID = "coord_system_tenant_marker"
_REVISION_FILENAME = "plan_library_01_work_artifacts.py"

_NIL = "00000000-0000-0000-0000-000000000000"


def _revision_source() -> str:
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """The walk below rewinds to ``_PARENT_REVISION_ID``; keep the pin honest.

    Coord re-points ``down_revision`` at land time. If it moves and this pin
    does not, the rewind lands further back and ``upgrade`` replays a stretch
    of unrelated non-idempotent revisions — surfacing as a ``DuplicateTable``
    from a migration this test never meant to touch.
    """
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision="
        f"{match.group('parent')!r} but this test pins "
        f"_PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_revision_id_does_not_collide_with_the_prompt_docs_prefix() -> None:
    """``coord_prompt_docs_02`` is already shared by two files — don't add a third."""
    assert _REVISION_ID == "plan_library_01_work_artifacts"
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


def test_status_carries_no_check_in_the_ddl() -> None:
    """``status`` must stay opaque — a CHECK here would 500 on new vocabulary."""
    source = _revision_source()
    # The only CHECK constraints the revision creates, by explicit name.
    names = set(re.findall(r"CONSTRAINT (ck_\w+) CHECK", source))
    assert names == {
        "ck_work_artifacts_kind",
        "ck_work_artifacts_captured_by",
        "ck_work_artifact_edges_relation",
    }, names
    assert "status" not in " ".join(names)


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:5433 (or "
        "bring up a backend Postgres) before running this test."
    ),
)


def _index_defs(engine: Engine, table: str) -> dict[str, str]:
    sql = text(
        """
        SELECT indexname, indexdef
          FROM pg_indexes
         WHERE schemaname = 'agent' AND tablename = :table
        """
    )
    with engine.connect() as conn:
        return {r.indexname: r.indexdef for r in conn.execute(sql, {"table": table})}


def _constraint_names(engine: Engine, table: str, contype: str) -> set[str]:
    sql = text(
        """
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'agent'
           AND rel.relname = :table
           AND con.contype = :contype
        """
    )
    with engine.connect() as conn:
        return {r[0] for r in conn.execute(sql, {"table": table, "contype": contype})}


def _insert_artifact(
    engine: Engine,
    *,
    org_id: uuid.UUID | None,
    kind: str = "plan",
    slug: str,
    source_repo: str | None = None,
    status: str = "",
    body: str = "body",
) -> uuid.UUID:
    artifact_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO agent.work_artifacts
                    (id, organization_id, kind, slug, title, status, body,
                     content_sha256, source_repo)
                VALUES (:id, :org, :kind, :slug, :title, :status, :body,
                        :sha, :repo)
                """
            ),
            {
                "id": artifact_id,
                "org": org_id,
                "kind": kind,
                "slug": slug,
                "title": slug,
                "status": status,
                "body": body,
                "sha": uuid.uuid4().hex,
                "repo": source_repo,
            },
        )
    return artifact_id


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    """head → downgrade past THIS revision → head, tables come and go.

    The rewind target is ``_PARENT_REVISION_ID`` by NAME, not ``-1``. A
    relative step was correct only while this revision was the head; once a
    descendant lands (``plan_library_02_kind_lock`` did) ``-1`` unwinds the
    descendant instead and the assertions below would read a still-present
    table as a failed downgrade. Naming the target keeps the walk pinned to
    the revision this file is about.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_roundtrip") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        for table in (
            "work_artifacts",
            "work_artifact_versions",
            "work_artifact_edges",
        ):
            assert table_exists(engine, "agent", table), table

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        for table in (
            "work_artifacts",
            "work_artifact_versions",
            "work_artifact_edges",
        ):
            assert not table_exists(engine, "agent", table), (
                f"{table} survived the downgrade"
            )

        run_alembic(root, db_url, "upgrade", "head")
        for table in (
            "work_artifacts",
            "work_artifact_versions",
            "work_artifact_edges",
        ):
            assert table_exists(engine, "agent", table), table

        # ── shape ────────────────────────────────────────────────────────
        indexes = _index_defs(engine, "work_artifacts")
        assert "uq_work_artifacts_identity" in indexes
        identity = indexes["uq_work_artifacts_identity"]
        assert "UNIQUE" in identity
        assert "COALESCE" in identity.upper()
        assert _NIL in identity
        assert "ix_work_artifacts_kind_status" in indexes
        assert "ix_work_artifacts_work_unit_slug" in indexes
        assert "gin" in indexes["ix_work_artifacts_repos"].lower()
        assert "gin" in indexes["ix_work_artifacts_search"].lower()
        assert "to_tsvector" in indexes["ix_work_artifacts_search"]

        version_indexes = _index_defs(engine, "work_artifact_versions")
        assert "uq_work_artifact_versions_doc_version" in version_indexes
        assert "UNIQUE" in version_indexes["uq_work_artifact_versions_doc_version"]

        edge_indexes = _index_defs(engine, "work_artifact_edges")
        assert "uq_work_artifact_edges_from_to_relation" in edge_indexes
        assert "UNIQUE" in edge_indexes["uq_work_artifact_edges_from_to_relation"]

        # CHECKs carry the explicit names, so nobody needs a discover-and-drop
        # loop to widen them later.
        assert {"ck_work_artifacts_kind", "ck_work_artifacts_captured_by"} <= (
            _constraint_names(engine, "work_artifacts", "c")
        )
        assert "ck_work_artifact_edges_relation" in _constraint_names(
            engine, "work_artifact_edges", "c"
        )

        # work_unit_slug carries NO foreign key — coord owns work units.
        with engine.connect() as conn:
            fk_columns = {
                r[0]
                for r in conn.execute(
                    text(
                        """
                        SELECT att.attname
                          FROM pg_constraint con
                          JOIN pg_class rel ON rel.oid = con.conrelid
                          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                          JOIN unnest(con.conkey) AS k(attnum) ON true
                          JOIN pg_attribute att
                            ON att.attrelid = con.conrelid
                           AND att.attnum = k.attnum
                         WHERE nsp.nspname = 'agent'
                           AND rel.relname = 'work_artifacts'
                           AND con.contype = 'f'
                        """
                    )
                )
            }
        assert "work_unit_slug" not in fk_columns
        assert "organization_id" not in fk_columns


@_PG_SKIP
def test_functional_unique_index_binds_on_null_org_and_null_repo() -> None:
    """The whole reason the index is functional rather than plain UNIQUE."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_identity") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        _insert_artifact(engine, org_id=None, slug="dup", source_repo=None)
        with pytest.raises(IntegrityError):
            _insert_artifact(engine, org_id=None, slug="dup", source_repo=None)

        # A different source_repo is a DIFFERENT artifact.
        _insert_artifact(engine, org_id=None, slug="dup", source_repo="web")
        # A different organization is a DIFFERENT artifact.
        _insert_artifact(engine, org_id=uuid.uuid4(), slug="dup", source_repo=None)

        with engine.connect() as conn:
            total = conn.execute(
                text("SELECT count(*) FROM agent.work_artifacts WHERE slug = 'dup'")
            ).scalar()
        assert total == 3


@_PG_SKIP
def test_status_accepts_anything_and_kind_does_not() -> None:
    """``status`` is opaque; ``kind`` is CHECKed."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_checks") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        for i, weird in enumerate(
            ["VETTED", "IN PROGRESS", "🚧", "a status nobody defined", ""]
        ):
            _insert_artifact(engine, org_id=None, slug=f"status-{i}", status=weird)

        with pytest.raises(IntegrityError):
            _insert_artifact(engine, org_id=None, slug="bad-kind", kind="nope")


@_PG_SKIP
def test_versions_and_edges_cascade_on_artifact_delete() -> None:
    """ON DELETE CASCADE on both children, and the edge relation CHECK."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_cascade") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        parent = _insert_artifact(engine, org_id=None, slug="parent")
        child = _insert_artifact(engine, org_id=None, slug="child")

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO agent.work_artifact_versions
                        (document_id, version_number, body, content_sha256)
                    VALUES (:doc, 1, 'v1', 'sha1')
                    """
                ),
                {"doc": parent},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO agent.work_artifact_edges
                        (from_id, to_id, relation)
                    VALUES (:a, :b, 'produced_report')
                    """
                ),
                {"a": parent, "b": child},
            )

        # Duplicate (from, to, relation) is rejected.
        with engine.begin() as conn, pytest.raises(IntegrityError):
            conn.execute(
                text(
                    """
                    INSERT INTO agent.work_artifact_edges
                        (from_id, to_id, relation)
                    VALUES (:a, :b, 'produced_report')
                    """
                ),
                {"a": parent, "b": child},
            )

        # An unknown relation is rejected by the named CHECK.
        with engine.begin() as conn, pytest.raises(IntegrityError):
            conn.execute(
                text(
                    """
                    INSERT INTO agent.work_artifact_edges
                        (from_id, to_id, relation)
                    VALUES (:a, :b, 'not_a_relation')
                    """
                ),
                {"a": parent, "b": child},
            )

        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM agent.work_artifacts WHERE id = :id"),
                {"id": parent},
            )
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT count(*) FROM agent.work_artifact_versions")
                ).scalar()
                == 0
            )
            assert (
                conn.execute(
                    text("SELECT count(*) FROM agent.work_artifact_edges")
                ).scalar()
                == 0
            )
