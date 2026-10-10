"""Round-trip + constraint test for ``plan_library_11_spec_artifacts``.

Phase 6 step 1 of ``2026-10-09-spec-front-end-of-the-software-factory``.

What this pins:

* the kind and relation CHECKs admit exactly the D4 additions on top of the
  prior vocabularies, and still reject a value in neither;
* every trace relation is TWO-ENDED — ``ck_work_artifact_edges_open_target``
  is dropped by the discover-and-drop loop and must come back;
* ``ck_work_artifacts_spec_ref``: a spec kind needs a ref with its OWN prefix,
  a non-spec kind must have none, and a NULL ref on a spec kind is refused
  (the ``IS NOT NULL AND`` arm — a bare regex on NULL would pass the CHECK);
* ``uq_work_artifacts_spec_ref`` is unique per organization scope, so the
  same ref may exist in two organizations;
* the migration's CHECK body is byte-identical to the model's
  ``SPEC_REF_CHECK_SQL`` (the test DB is built from the model, production
  from the migration — they must agree);
* the CHECK survives to ``head`` — a later kind widening that copies the
  discover-and-drop loop drops it, and this is the test that notices;
* the round trip deletes exactly what the old vocabulary cannot hold.

Substrate is ``tests/_alembic_harness``. A skip proves nothing — point it at a
live instance with ``QONTINUI_TEST_PG_DSN`` when 5432 is not the one
accepting the test credentials.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.work_artifact import (
    SPEC_ARTIFACT_KINDS,
    SPEC_REF_CHECK_SQL,
    SPEC_REF_PREFIXES,
    WORK_ARTIFACT_KINDS,
    WORK_ARTIFACT_RELATIONS,
)
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "plan_library_11_spec_artifacts"
_PARENT_REVISION_ID = "devcred_01_credential_deny_and_bound_pair_codes"
_REVISION_FILENAME = "plan_library_11_spec_artifacts.py"

_NEW_KINDS = (
    "request",
    "requirement",
    "interface_mapping",
    "story",
    "test_case",
    "doc_correction",
)
_NEW_RELATIONS = ("derives_from", "refines", "implements", "verifies", "traces_to")


def _revision_path():
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision():
    return load_revision_module(_revision_path(), "plan_library_11_under_test")


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


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


def test_the_vocabularies_match_the_model() -> None:
    """The migration's widened sets are exactly the model's constants."""
    module = _revision()
    assert module._SPEC_KINDS == _NEW_KINDS == SPEC_ARTIFACT_KINDS
    assert set(module._PRIOR_KINDS + module._SPEC_KINDS) == set(WORK_ARTIFACT_KINDS)
    assert module._TRACE_RELATIONS == _NEW_RELATIONS
    assert set(module._PRIOR_RELATIONS + module._TRACE_RELATIONS) == set(
        WORK_ARTIFACT_RELATIONS
    )
    assert set(SPEC_REF_PREFIXES) == set(SPEC_ARTIFACT_KINDS)


def test_the_spec_ref_check_is_the_models_byte_for_byte() -> None:
    assert _revision()._SPEC_REF_CHECK == SPEC_REF_CHECK_SQL


def test_checks_are_discovered_not_assumed() -> None:
    source = _revision_source()
    assert "pg_constraint" in source
    assert "DROP CONSTRAINT %I" in source
    assert "ALTER TABLE IF EXISTS" not in source


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG_DSN before running."
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


def _index_names(engine: Engine) -> set[str]:
    sql = text(
        "SELECT indexname FROM pg_indexes "
        "WHERE schemaname = 'agent' AND tablename = 'work_artifacts'"
    )
    with engine.connect() as conn:
        return {r.indexname for r in conn.execute(sql)}


def _has_column(engine: Engine, column: str) -> bool:
    sql = text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = 'agent' AND table_name = 'work_artifacts' "
        "AND column_name = :column"
    )
    with engine.connect() as conn:
        return conn.execute(sql, {"column": column}).first() is not None


def _has_counters(engine: Engine) -> bool:
    with engine.connect() as conn:
        return (
            conn.execute(
                text("SELECT to_regclass('agent.work_artifact_spec_ref_counters')")
            ).scalar()
            is not None
        )


def _seed(
    engine: Engine,
    slug: str,
    *,
    kind: str = "plan",
    spec_ref: str | None = None,
    org: uuid.UUID | None = None,
) -> uuid.UUID:
    artifact_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO agent.work_artifacts
                    (id, organization_id, kind, slug, spec_ref, title, status,
                     body, content_sha256)
                VALUES (:id, :org, :kind, :slug, :spec_ref, 't', 'draft', 'b',
                        :sha)
                """
            ),
            {
                "id": artifact_id,
                "org": org,
                "kind": kind,
                "slug": slug,
                "spec_ref": spec_ref,
                "sha": uuid.uuid4().hex,
            },
        )
    return artifact_id


def _edge(engine: Engine, from_id, to_id, relation: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO agent.work_artifact_edges (from_id, to_id, relation) "
                "VALUES (:f, :t, :r)"
            ),
            {"f": from_id, "t": to_id, "r": relation},
        )


def _count(engine: Engine, sql: str) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text(sql)).scalar() or 0)


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_spec") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        kinds = _checks(engine, "work_artifacts")
        for kind in WORK_ARTIFACT_KINDS:
            assert f"'{kind}'" in kinds["ck_work_artifacts_kind"], kind
        # At HEAD, not just at this revision: a later kind widening that
        # copies the discover-and-drop loop drops this CHECK too.
        assert "ck_work_artifacts_spec_ref" in kinds
        assert "ck_work_artifacts_captured_by" in kinds

        rels = _checks(engine, "work_artifact_edges")
        for relation in WORK_ARTIFACT_RELATIONS:
            assert f"'{relation}'" in rels["ck_work_artifact_edges_relation"]
        assert "ck_work_artifact_edges_open_target" in rels
        assert "ck_work_artifact_edges_followup_note" in rels

        assert _has_column(engine, "spec_ref")
        assert "uq_work_artifacts_spec_ref" in _index_names(engine)
        assert _has_counters(engine)

        # Rows the downgrade must remove, and rows it must keep.
        plan = _seed(engine, "a-plan")
        other_plan = _seed(engine, "another-plan")
        requirement = _seed(engine, "a-req", kind="requirement", spec_ref="REQ-0001")
        _edge(engine, plan, other_plan, "implements")  # trace edge, no spec end
        _edge(engine, plan, other_plan, "depends_on")  # prior relation, kept
        _edge(engine, plan, requirement, "implements")

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)

        down_kinds = _checks(engine, "work_artifacts")
        for kind in _NEW_KINDS:
            assert f"'{kind}'" not in down_kinds["ck_work_artifacts_kind"]
        assert "'diagnostic'" in down_kinds["ck_work_artifacts_kind"]
        assert "ck_work_artifacts_spec_ref" not in down_kinds
        assert "ck_work_artifacts_captured_by" in down_kinds

        down_rels = _checks(engine, "work_artifact_edges")
        for relation in _NEW_RELATIONS:
            assert f"'{relation}'" not in down_rels["ck_work_artifact_edges_relation"]
        assert "'refutes'" in down_rels["ck_work_artifact_edges_relation"]
        assert "ck_work_artifact_edges_open_target" in down_rels
        assert "ck_work_artifact_edges_followup_note" in down_rels

        assert not _has_column(engine, "spec_ref")
        assert "uq_work_artifacts_spec_ref" not in _index_names(engine)
        assert not _has_counters(engine)
        assert (
            _count(
                engine,
                "SELECT count(*) FROM agent.work_artifacts WHERE kind = 'requirement'",
            )
            == 0
        )
        assert _count(engine, "SELECT count(*) FROM agent.work_artifacts") == 2
        assert _count(engine, "SELECT count(*) FROM agent.work_artifact_edges") == 1, (
            "only the depends_on edge survives"
        )

        run_alembic(root, db_url, "upgrade", "head")
        assert "ck_work_artifacts_spec_ref" in _checks(engine, "work_artifacts")
        assert _has_column(engine, "spec_ref")
        assert _has_counters(engine)


@_PG_SKIP
def test_the_spec_ref_check_and_uniqueness() -> None:
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_spec_ref") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        # Every spec kind admits its own prefix.
        for kind, prefix in SPEC_REF_PREFIXES.items():
            _seed(engine, f"ok-{kind}", kind=kind, spec_ref=f"{prefix}-0001")
        # Wider numbers grow; four digits is a minimum, not a cap.
        _seed(engine, "wide", kind="requirement", spec_ref="REQ-12345")
        # A non-spec kind with no ref.
        _seed(engine, "plain-plan")

        refused = [
            # spec kind, no ref — the NULL arm a bare regex would admit
            {"slug": "no-ref", "kind": "requirement", "spec_ref": None},
            # another kind's prefix
            {"slug": "wrong-prefix", "kind": "requirement", "spec_ref": "STY-0002"},
            # too few digits
            {"slug": "short", "kind": "requirement", "spec_ref": "REQ-12"},
            # a non-spec kind may not carry one
            {"slug": "plan-with-ref", "kind": "plan", "spec_ref": "REQ-0003"},
        ]
        for row in refused:
            with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
                _seed(engine, **row)
            assert "ck_work_artifacts_spec_ref" in str(excinfo.value), row

        # Unique per organization scope …
        with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
            _seed(engine, "dup", kind="requirement", spec_ref="REQ-0001")
        assert "uq_work_artifacts_spec_ref" in str(excinfo.value)
        # … but the same number in another organization is a different ref.
        _seed(
            engine,
            "other-org",
            kind="requirement",
            spec_ref="REQ-0001",
            org=uuid.uuid4(),
        )

        # The counter numbers spec kinds only.
        with (
            pytest.raises((IntegrityError, DBAPIError)) as excinfo,
            engine.begin() as conn,
        ):
            conn.execute(
                text(
                    "INSERT INTO agent.work_artifact_spec_ref_counters "
                    "(organization_scope, kind, last_number) "
                    "VALUES (gen_random_uuid(), 'plan', 1)"
                )
            )
        assert "ck_spec_ref_counters_kind" in str(excinfo.value)

        # A kind in no vocabulary is still refused.
        with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
            _seed(engine, "bogus", kind="epic")
        assert "ck_work_artifacts_kind" in str(excinfo.value)


@_PG_SKIP
def test_trace_relations_are_two_ended() -> None:
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_spec_edges") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        request = _seed(engine, "rq", kind="request", spec_ref="RQ-0001")
        requirement = _seed(engine, "req", kind="requirement", spec_ref="REQ-0001")

        for relation in _NEW_RELATIONS:
            _edge(engine, requirement, request, relation)
            with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
                _edge(engine, requirement, None, relation)
            assert "open_target" in str(excinfo.value), relation

        with pytest.raises((IntegrityError, DBAPIError)) as excinfo:
            _edge(engine, requirement, request, "satisfies")
        assert "ck_work_artifact_edges_relation" in str(excinfo.value)
