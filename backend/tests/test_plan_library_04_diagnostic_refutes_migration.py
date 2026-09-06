"""Round-trip + constraint test for ``plan_library_04_diagnostic_refutes``.

PR A of ``2026-09-06-work-artifacts-kinds-and-edges-cannot-express-a-refutation``.

Both CHECKs on the plan-library tables are closed vocabularies, and this
revision widens each by one member plus adds a citation column. The
assertions are about the WIDENING and about what the widening must not
disturb:

* ``ck_work_artifacts_kind`` admits ``diagnostic`` and still rejects a kind
  that is in neither vocabulary — the widening is by one, not to anything;
* ``ck_work_artifact_edges_relation`` admits ``refutes``;
* a ``refutes`` edge with a null ``to_id`` is REJECTED: the relation is
  two-ended and inherits ``ck_work_artifact_edges_open_target`` from
  ``plan_library_03``. That guard mentions ``relation``, so the
  discover-and-drop loop removes it on every run; this pins that it came
  back;
* ``spawned_followup``'s own fences survive — a null target is still
  accepted for it, a blank note is still rejected;
* ``intent_refs`` exists as ``text[] NOT NULL DEFAULT '{}'`` with a GIN
  index, and containment (``@>``) is the query it answers;
* the round trip restores the six-kind and six-relation vocabularies and
  drops the column and index, and the downgrade's two destructive steps
  (``diagnostic`` rows, ``refutes`` edges) delete only what the old
  vocabulary cannot hold.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:<port>`` when 5432 is not the
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

_REVISION_ID = "plan_library_04_diagnostic_refutes"
_PARENT_REVISION_ID = "prcheckruns_base_sha_01"
_REVISION_FILENAME = "plan_library_04_diagnostic_refutes.py"

#: The vocabulary as it stood before this revision. Every member must still
#: be admitted afterwards, and ``diagnostic`` must not be among them.
_PRIOR_KINDS = (
    "investigation_prompt",
    "plan_authoring_prompt",
    "implementation_prompt",
    "investigation_report",
    "handoff",
    "plan",
)

_PRIOR_RELATIONS = (
    "produced_report",
    "feeds",
    "authored_plan",
    "supersedes",
    "depends_on",
    "spawned_followup",
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


def test_both_checks_are_discovered_not_assumed() -> None:
    """Both CHECKs are dropped via ``pg_constraint``, never by an assumed name.

    ``plan_library_01`` declared them inline; the names are an implementation
    detail. Two loops, one per table, each keyed on the column the constraint
    references.
    """
    source = _revision_source()
    assert "pg_constraint" in source
    assert source.count("DROP CONSTRAINT %I") == 2
    assert "to_regclass('agent.work_artifacts')" in source
    assert "to_regclass('agent.work_artifact_edges')" in source
    assert "WHERE att.attname = 'kind'" in source
    assert "WHERE att.attname = 'relation'" in source


def test_the_three_statements_are_present_in_both_directions() -> None:
    source = _revision_source()

    # 1. The kind vocabulary, widened then restored.
    assert source.count("ADD CONSTRAINT ck_work_artifacts_kind") == 2
    assert "'diagnostic'" in source

    # 2. The relation vocabulary, widened then restored — and the two guards
    #    from plan_library_03 re-added on BOTH sides, since the loop that
    #    drops the vocabulary CHECK drops them too.
    assert source.count("ADD CONSTRAINT ck_work_artifact_edges_relation") == 2
    assert "'refutes'" in source
    assert "ADD CONSTRAINT ck_work_artifact_edges_open_target" in source
    assert "ADD CONSTRAINT ck_work_artifact_edges_followup_note" in source
    assert source.count("    _add_relation_guards()\n") == 2, (
        "the guards must be re-added in upgrade() AND downgrade()"
    )

    # 3. The column and its index, both idempotent, spelled like ``repos``.
    assert "ADD COLUMN IF NOT EXISTS intent_refs TEXT[] NOT NULL DEFAULT '{}'" in source
    assert "CREATE INDEX IF NOT EXISTS ix_work_artifacts_intent_refs" in source
    assert "USING GIN (intent_refs)" in source
    assert "DROP INDEX IF EXISTS agent.ix_work_artifacts_intent_refs" in source
    assert "DROP COLUMN IF EXISTS intent_refs" in source

    # …and every ALTER TABLE names the schema, which the gate enforces.
    assert "ALTER TABLE IF EXISTS" not in source
    assert source.count("ALTER TABLE agent.work_artifacts") == 5
    assert source.count("ALTER TABLE agent.work_artifact_edges") == 5


def test_the_docstring_names_the_retro_label_door() -> None:
    """A row relabelled ``diagnostic`` without ``kind_locked`` forks on the
    next scan; the docstring must point at the door, not only the trap."""
    source = _revision_source()
    assert "patch_work_artifact_kind" in source
    assert "kind_locked" in source
    assert "uq_work_artifacts_identity" in source


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:<port> "
        "before running this test."
    ),
)


def _checks(engine: Engine, table: str) -> dict[str, str]:
    sql = text(
        """
        SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS clause
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'agent'
           AND rel.relname = :table
           AND con.contype = 'c'
        """
    )
    with engine.connect() as conn:
        return {row.name: row.clause for row in conn.execute(sql, {"table": table})}


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    sql = text(
        """
        SELECT indexname, indexdef
          FROM pg_indexes
         WHERE schemaname = 'agent' AND tablename = :table
        """
    )
    with engine.connect() as conn:
        return {r.indexname: r.indexdef for r in conn.execute(sql, {"table": table})}


def _column(engine: Engine, table: str, column: str) -> dict[str, str] | None:
    sql = text(
        """
        SELECT data_type, udt_name, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'agent'
           AND table_name = :table
           AND column_name = :column
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql, {"table": table, "column": column}).first()
    if row is None:
        return None
    return {
        "data_type": row.data_type,
        "udt_name": row.udt_name,
        "is_nullable": row.is_nullable,
        "column_default": row.column_default or "",
    }


def _seed_artifact(
    engine: Engine,
    slug: str,
    *,
    kind: str = "plan",
    intent_refs: list[str] | None = None,
) -> uuid.UUID:
    artifact_id = uuid.uuid4()
    with engine.begin() as conn:
        if intent_refs is None:
            conn.execute(
                text(
                    """
                    INSERT INTO agent.work_artifacts
                        (id, kind, slug, title, status, body, content_sha256)
                    VALUES (:id, :kind, :slug, 't', 'VETTED', 'b', :sha)
                    """
                ),
                {
                    "id": artifact_id,
                    "kind": kind,
                    "slug": slug,
                    "sha": uuid.uuid4().hex,
                },
            )
        else:
            conn.execute(
                text(
                    """
                    INSERT INTO agent.work_artifacts
                        (id, kind, slug, title, status, body, content_sha256,
                         intent_refs)
                    VALUES (:id, :kind, :slug, 't', 'VETTED', 'b', :sha,
                            :intent_refs)
                    """
                ),
                {
                    "id": artifact_id,
                    "kind": kind,
                    "slug": slug,
                    "sha": uuid.uuid4().hex,
                    "intent_refs": intent_refs,
                },
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


def _count(engine: Engine, sql: str) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text(sql)).scalar() or 0)


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    """head → downgrade to the PARENT BY NAME → head.

    The rewind target is ``_PARENT_REVISION_ID``, never ``-1``: a relative
    step is correct only while this revision is the head, which is a property
    of the branch on the day the test was written.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_diag") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        kind_checks = _checks(engine, "work_artifacts")
        assert "'diagnostic'" in kind_checks["ck_work_artifacts_kind"]
        for prior in _PRIOR_KINDS:
            assert f"'{prior}'" in kind_checks["ck_work_artifacts_kind"]
        # The other phase-1 CHECK references captured_by, not kind, and must
        # not have been swept up by the discover-and-drop loop.
        assert "ck_work_artifacts_captured_by" in kind_checks

        rel_checks = _checks(engine, "work_artifact_edges")
        assert "'refutes'" in rel_checks["ck_work_artifact_edges_relation"]
        for prior in _PRIOR_RELATIONS:
            assert f"'{prior}'" in rel_checks["ck_work_artifact_edges_relation"]
        assert "ck_work_artifact_edges_open_target" in rel_checks
        assert "ck_work_artifact_edges_followup_note" in rel_checks

        column = _column(engine, "work_artifacts", "intent_refs")
        assert column is not None, "intent_refs column did not land"
        assert column["data_type"] == "ARRAY"
        assert column["udt_name"] == "_text"
        assert column["is_nullable"] == "NO"
        assert "'{}'" in column["column_default"]

        indexes = _indexes(engine, "work_artifacts")
        assert "ix_work_artifacts_intent_refs" in indexes
        assert "gin" in indexes["ix_work_artifacts_intent_refs"].lower()
        # Spelled like the repos index it mirrors.
        assert "ix_work_artifacts_repos" in indexes
        assert "gin" in indexes["ix_work_artifacts_repos"].lower()

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)

        after_down_kinds = _checks(engine, "work_artifacts")
        assert "'diagnostic'" not in after_down_kinds["ck_work_artifacts_kind"]
        for prior in _PRIOR_KINDS:
            assert f"'{prior}'" in after_down_kinds["ck_work_artifacts_kind"]
        assert "ck_work_artifacts_captured_by" in after_down_kinds

        after_down_rels = _checks(engine, "work_artifact_edges")
        assert "'refutes'" not in after_down_rels["ck_work_artifact_edges_relation"]
        # plan_library_03 is an ancestor: its relation and BOTH its guards
        # must be exactly as it left them.
        assert (
            "'spawned_followup'" in after_down_rels["ck_work_artifact_edges_relation"]
        )
        assert "ck_work_artifact_edges_open_target" in after_down_rels
        assert "ck_work_artifact_edges_followup_note" in after_down_rels

        assert _column(engine, "work_artifacts", "intent_refs") is None
        assert "ix_work_artifacts_intent_refs" not in _indexes(engine, "work_artifacts")
        # Phase 1's own index is untouched by this revision's downgrade.
        assert "ix_work_artifacts_repos" in _indexes(engine, "work_artifacts")

        run_alembic(root, db_url, "upgrade", "head")
        assert (
            "'diagnostic'"
            in _checks(engine, "work_artifacts")["ck_work_artifacts_kind"]
        )
        assert _column(engine, "work_artifacts", "intent_refs") is not None
        assert "ix_work_artifacts_intent_refs" in _indexes(engine, "work_artifacts")


@_PG_SKIP
def test_the_kind_check_admits_diagnostic_and_nothing_else_new() -> None:
    """Widened by ONE. A kind in neither vocabulary is still rejected."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_diag_kind") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        _seed_artifact(engine, "a-diagnostic", kind="diagnostic")
        for prior in _PRIOR_KINDS:
            _seed_artifact(engine, f"a-{prior}", kind=prior)

        with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
            _seed_artifact(engine, "a-bogus", kind="not_a_kind")
        assert "ck_work_artifacts_kind" in str(excinfo.value)


@_PG_SKIP
def test_refutes_is_two_ended_and_the_followup_fences_survive() -> None:
    """The relation guard, from both sides, after the discover-and-drop.

    ``ck_work_artifact_edges_open_target`` and
    ``ck_work_artifact_edges_followup_note`` both mention ``relation``, so the
    loop that widens the vocabulary drops them. The re-add is what this pins:
    ``refutes`` refuses a null target, ``spawned_followup`` still accepts one,
    and a blank follow-up note is still refused.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_diag_edge") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        diagnostic = _seed_artifact(engine, "the-measurement", kind="diagnostic")
        claim = _seed_artifact(engine, "the-claim")

        # The new relation, two-ended: accepted.
        _insert_edge(
            engine,
            from_id=diagnostic,
            to_id=claim,
            relation="refutes",
            note="0 dispatched in 25,253 consults",
        )
        assert (
            _count(
                engine,
                "SELECT count(*) FROM agent.work_artifact_edges "
                "WHERE relation = 'refutes'",
            )
            == 1
        )

        # The new relation with no far end: refused by the re-added guard.
        with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
            _insert_edge(
                engine,
                from_id=diagnostic,
                to_id=None,
                relation="refutes",
                note="refutes nothing",
            )
        assert "open_target" in str(excinfo.value)

        # spawned_followup's relaxation survives …
        _insert_edge(
            engine,
            from_id=claim,
            to_id=None,
            relation="spawned_followup",
            note="worth its own plan",
        )
        # … and so does its note fence.
        with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
            _insert_edge(
                engine,
                from_id=claim,
                to_id=None,
                relation="spawned_followup",
                note="   \n\t ",
            )
        assert "followup_note" in str(excinfo.value)

        # And the vocabulary is widened by ONE.
        with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
            _insert_edge(
                engine,
                from_id=diagnostic,
                to_id=claim,
                relation="contradicts",
                note=None,
            )
        assert "ck_work_artifact_edges_relation" in str(excinfo.value)


@_PG_SKIP
def test_intent_refs_answers_containment() -> None:
    """The query the GIN index exists to serve, at the SQL level."""
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_diag_refs") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        _seed_artifact(
            engine,
            "cites-two",
            kind="diagnostic",
            intent_refs=["success_metric/development-speed", "domain_spec/merge-train"],
        )
        _seed_artifact(
            engine,
            "cites-one",
            kind="diagnostic",
            intent_refs=["success_metric/development-speed"],
        )
        # Default applies when the column is omitted.
        plain = _seed_artifact(engine, "cites-none")

        with engine.connect() as conn:
            default_refs = conn.execute(
                text("SELECT intent_refs FROM agent.work_artifacts WHERE id = :id"),
                {"id": plain},
            ).scalar_one()
        assert list(default_refs) == []

        def contains(ref: str) -> int:
            with engine.connect() as conn:
                return int(
                    conn.execute(
                        text(
                            "SELECT count(*) FROM agent.work_artifacts "
                            "WHERE intent_refs @> ARRAY[:ref]::text[]"
                        ),
                        {"ref": ref},
                    ).scalar_one()
                )

        assert contains("success_metric/development-speed") == 2
        assert contains("domain_spec/merge-train") == 1
        assert contains("success_metric/uncited") == 0
        # Exact member, not a prefix.
        assert contains("success_metric/dev") == 0


@_PG_SKIP
def test_the_downgrade_discards_only_what_the_old_vocabulary_cannot_hold() -> None:
    """The two destructive steps, asserted rather than left to be discovered.

    ``diagnostic`` rows and ``refutes`` edges go; every other row and edge
    stays. A downgrade that instead raised would leave the database
    un-rewindable, which is worse.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_diag_down") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        diagnostic = _seed_artifact(engine, "goes", kind="diagnostic")
        claim = _seed_artifact(engine, "stays")
        other = _seed_artifact(engine, "also-stays", kind="handoff")
        _insert_edge(
            engine, from_id=diagnostic, to_id=claim, relation="refutes", note=None
        )
        _insert_edge(engine, from_id=other, to_id=claim, relation="feeds", note=None)
        _insert_edge(
            engine,
            from_id=claim,
            to_id=None,
            relation="spawned_followup",
            note="still open after the rewind",
        )

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)

        assert (
            _count(
                engine,
                "SELECT count(*) FROM agent.work_artifacts WHERE kind = 'diagnostic'",
            )
            == 0
        )
        assert _count(engine, "SELECT count(*) FROM agent.work_artifacts") == 2
        with engine.connect() as conn:
            remaining = sorted(
                conn.execute(
                    text("SELECT relation FROM agent.work_artifact_edges")
                ).scalars()
            )
        assert remaining == ["feeds", "spawned_followup"]


@_PG_SKIP
def test_the_rejections_are_a_real_negative_control() -> None:
    """At the parent revision BOTH new values are refused.

    Without this the acceptance assertions above could pass against a schema
    that never had the CHECKs at all. Pinning that the parent refuses
    ``diagnostic`` and ``refutes`` is what makes the post-migration acceptance
    meaningful.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_diag_ctrl") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)

        assert _column(engine, "work_artifacts", "intent_refs") is None

        with pytest.raises((IntegrityError, DBAPIError)):
            _seed_artifact(engine, "not-yet", kind="diagnostic")

        plan = _seed_artifact(engine, "control-plan")
        peer = _seed_artifact(engine, "control-peer")
        with pytest.raises((IntegrityError, DBAPIError)):
            _insert_edge(
                engine, from_id=plan, to_id=peer, relation="refutes", note=None
            )
