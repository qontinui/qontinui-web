"""Shape + round-trip test for ``agent.session_artifacts``.

Phase 3a of ``2026-08-26-claude-code-session-repository-in-qontinui-web``.

Three classes of assertion live here, and the first two never touch a
database, so they never skip:

1. **The model declares what the plan says it declares** — the identity
   index is functional, NULL-collapsing and ORGANIZATION-FREE, the four CHECKs
   carry explicit stable names and the exact vocabularies, ``body_source`` is
   NULL-tolerant, and the columns/nullability match the design.

   The organization's ABSENCE from the identity index is asserted twice, in
   the model and again against live DDL, because it is the one thing about
   this key a future reader is most likely to "fix": the plan library keys on
   the organization and this store was copied from it. It must not, because
   ``app.jobs.session_archiver`` has no calling principal and can only ever
   write NULL — see :class:`app.models.session_artifact.SessionArtifact`.

2. **The full-text expression is spelled exactly once.** This is the
   regression guard for the documented trap: PostgreSQL will only use an
   expression index when the query predicate matches the indexed expression,
   so the ``?q=`` predicate and the ``CREATE INDEX`` body must be the SAME
   string. ``work_artifact.py`` avoids the trap with a module constant and
   this store copies that; the test below asserts the constant is
   byte-identical in the model, in the SQLAlchemy ``Index``, and in the
   migration — a drift that a schema diff reads back as "index present" while
   every search degrades to a sequential scan.

3. **The migration round-trips** — head → downgrade → head, with the
   constraints actually biting in Postgres. Skipped when no test Postgres is
   reachable; ⚠️ a skip proves nothing — point it at a live instance with
   ``QONTINUI_TEST_PG=localhost:5433`` when 5432 is not the one accepting the
   test credentials.
"""

from __future__ import annotations

import importlib.util
import re
import uuid
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.models.session_artifact import (
    SESSION_BODY_SOURCES,
    SESSION_CLOSEOUT_STATES,
    SESSION_SEARCH_TSVECTOR_SQL,
    SESSION_STATES,
    SESSION_TENANT_SOURCES,
    SessionArtifact,
)
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "session_repo_01_session_artifacts"
_PARENT_REVISION_ID = "pdtier_02"
_REVISION_FILENAME = "session_repo_01_session_artifacts.py"


def _revision_path():
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    """Import the revision file directly, so its constants can be compared.

    Loading by path (rather than re-parsing the source with a regex) is what
    makes the FTS assertion a BYTE comparison of the two Python strings
    instead of a comparison of two spellings that happen to look alike.
    """
    spec = importlib.util.spec_from_file_location(
        "_session_repo_01_revision_under_test", _revision_path()
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# The model — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_model_binds_to_the_web_owned_agent_schema() -> None:
    assert SessionArtifact.__tablename__ == "session_artifacts"
    assert SessionArtifact.__table__.schema == "agent"


def test_the_declared_columns_match_the_design() -> None:
    """Every column §3.2 names, with the nullability the design depends on."""
    columns = {c.name: c for c in SessionArtifact.__table__.columns}

    expected = {
        "id",
        "organization_id",
        "claude_session_id",
        "account_label",
        "tenant_id",
        "tenant_source",
        "device_id",
        "machine_hostname",
        "coord_session_id",
        "work_unit_slug",
        "task_run_id",
        "config_dir",
        "working_dir",
        "repo",
        "git_branch",
        "provider",
        "launch_command",
        "restore_tier",
        "machine_id",
        "permission_mode",
        "body_object_key",
        "content_sha256",
        "byte_count",
        "turn_count",
        "first_prompt",
        "last_prompt",
        "ai_title",
        "session_name",
        "name_source",
        "body_source",
        "started_at",
        "last_activity_at",
        "ended_at",
        "state",
        "closeout_state",
        "secret_finding_count",
        "secret_finding_kinds",
        "created_at",
        "updated_at",
    }
    assert set(columns) == expected

    # NOT NULL is a design statement in four places and only four.
    not_null = {name for name, col in columns.items() if not col.nullable}
    assert not_null == {
        "id",
        "claude_session_id",
        "tenant_source",
        "state",
        "closeout_state",
        "secret_finding_count",
        "created_at",
        "updated_at",
    }

    # A metadata-only head row (the archiver promotes sessions whose bytes
    # were never uploaded) must be insertable with no body at all.
    for name in ("body_object_key", "content_sha256", "byte_count", "body_source"):
        assert columns[name].nullable, f"{name} must be nullable"

    # NULL means "the detector never ran", '{}' means "ran and found nothing".
    # Collapsing the two would make an unscanned row read as a clean one.
    assert columns["secret_finding_kinds"].nullable


def test_the_vocabularies_are_the_ones_the_plan_declares() -> None:
    assert SESSION_TENANT_SOURCES == (
        "declared",
        "derived_repo",
        "derived_sole_binding",
        "ambiguous",
        "unknown",
    )
    assert SESSION_BODY_SOURCES == ("disk_verbatim", "coord_redacted")
    assert SESSION_STATES == ("open", "closed", "abandoned")
    assert SESSION_CLOSEOUT_STATES == ("clean", "unfinished", "unknown")


def test_the_checks_carry_explicit_names_and_the_full_vocabularies() -> None:
    """Named CHECKs so a widening can ``DROP CONSTRAINT <known name>``.

    The alternative — letting PostgreSQL auto-name an inline CHECK — is what
    forced ``coord_prompt_docs_02`` into a ``pg_constraint`` discover-and-drop
    loop.
    """
    checks = {
        c.name: str(c.sqltext)
        for c in SessionArtifact.__table__.constraints
        if c.__class__.__name__ == "CheckConstraint"
    }
    assert set(checks) == {
        "ck_session_artifacts_tenant_source",
        "ck_session_artifacts_body_source",
        "ck_session_artifacts_state",
        "ck_session_artifacts_closeout_state",
    }

    for value in SESSION_TENANT_SOURCES:
        assert f"'{value}'" in checks["ck_session_artifacts_tenant_source"]
    for value in SESSION_BODY_SOURCES:
        assert f"'{value}'" in checks["ck_session_artifacts_body_source"]
    for value in SESSION_STATES:
        assert f"'{value}'" in checks["ck_session_artifacts_state"]
    for value in SESSION_CLOSEOUT_STATES:
        assert f"'{value}'" in checks["ck_session_artifacts_closeout_state"]

    # NULL-tolerant on purpose — see the module docstring of the model.
    assert "IS NULL" in checks["ck_session_artifacts_body_source"].upper()


def _identity_index():
    return next(
        i
        for i in SessionArtifact.__table__.indexes
        if i.name == "uq_session_artifacts_identity"
    )


def test_the_identity_index_is_functional_and_null_collapsing() -> None:
    """A plain UNIQUE would not bind: in PostgreSQL ``NULL <> NULL``.

    Which is exactly the shape a scan of an unlabelled account home produces.
    """
    index = _identity_index()
    assert index.unique
    expressions = [str(e) for e in index.expressions]
    assert expressions == [
        "claude_session_id",
        "coalesce(account_label, '')",
    ]


def test_the_identity_index_does_not_carry_the_organization() -> None:
    """The organization is SCOPING, not identity — and this store's writers
    disagree about it.

    ``agent.session_artifacts`` has two legitimate writers (plan §5): the
    runner, which POSTs authenticated and therefore carries an organization,
    and ``app.jobs.session_archiver``, a scheduled job with NO calling
    principal that can only ever write NULL. With the organization in the key
    those two wrote TWO rows for one real session, and it did not self-heal —
    the archiver's next cycle saw two candidates, touched neither, and counted
    ``ambiguous_identity``.

    This assertion is the guard against "restoring" it, which is a tempting
    edit precisely because the plan-library store this one was copied from
    DOES key on the organization. Plans are per-organization; sessions are not.
    """
    expressions = [str(e) for e in _identity_index().expressions]
    assert not any("organization_id" in e for e in expressions), (
        "organization_id is back in uq_session_artifacts_identity — that makes "
        "the archiver (no principal, org NULL) and the runner (authenticated, "
        "org set) fork one session into two rows again"
    )


def test_the_plain_read_indexes_are_declared() -> None:
    names = {i.name for i in SessionArtifact.__table__.indexes}
    assert {
        "ix_session_artifacts_tenant_id",
        "ix_session_artifacts_state",
        "ix_session_artifacts_closeout_state",
        "ix_session_artifacts_last_activity_at",
        "ix_session_artifacts_repo",
        "ix_session_artifacts_account_label",
        "ix_session_artifacts_search",
    } <= names


# ---------------------------------------------------------------------------
# The full-text trap — the regression guard this file exists for.
# ---------------------------------------------------------------------------


def test_the_search_index_expression_is_the_module_constant_verbatim() -> None:
    """The index body and the ``?q=`` predicate must be the SAME string.

    PostgreSQL matches an expression index by the parsed expression, so a
    predicate that merely *resembles* the indexed expression yields a
    perfectly healthy-looking index that is never used. Spelling it once and
    reusing the constant is the only way that stays true under edits.
    """
    index = next(
        i
        for i in SessionArtifact.__table__.indexes
        if i.name == "ix_session_artifacts_search"
    )
    assert index.dialect_options["postgresql"]["using"] == "gin"

    expressions = [str(e) for e in index.expressions]
    assert expressions == [SESSION_SEARCH_TSVECTOR_SQL]

    # The predicate the API will build must embed the constant byte for byte.
    predicate = text(f"{SESSION_SEARCH_TSVECTOR_SQL} @@ plainto_tsquery('english', :q)")
    assert str(predicate).startswith(SESSION_SEARCH_TSVECTOR_SQL)


def test_the_constant_covers_the_four_searchable_columns_with_explicit_config() -> None:
    assert SESSION_SEARCH_TSVECTOR_SQL.startswith("to_tsvector('english', ")
    for column in ("ai_title", "session_name", "first_prompt", "last_prompt"):
        assert f"coalesce({column}, '')" in SESSION_SEARCH_TSVECTOR_SQL


def test_the_migration_spells_the_same_search_expression_byte_for_byte() -> None:
    """Model constant vs migration constant — one drifting is the whole trap."""
    assert _revision_module()._SEARCH_TSVECTOR_SQL == SESSION_SEARCH_TSVECTOR_SQL


# ---------------------------------------------------------------------------
# The revision file — still no database.
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


def test_the_revision_id_is_claimed_by_exactly_one_file() -> None:
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


def test_the_soft_links_carry_no_foreign_key() -> None:
    """coord owns those rows AND deletes them after 7 days — see plan §2.2.

    A cross-schema FK would both re-couple what the web↔coord decoupling
    separated and let coord's GC cascade into the archive built to survive it.
    """
    assert not SessionArtifact.__table__.foreign_keys


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


def _insert_session(
    engine: Engine,
    *,
    org_id: uuid.UUID | None,
    claude_session_id: str,
    account_label: str | None = None,
    tenant_source: str = "unknown",
    body_source: str | None = None,
    state: str = "open",
    closeout_state: str = "unknown",
) -> uuid.UUID:
    row_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO agent.session_artifacts
                    (id, organization_id, claude_session_id, account_label,
                     tenant_source, body_source, state, closeout_state)
                VALUES (:id, :org, :sid, :label, :tsrc, :bsrc, :state, :closeout)
                """
            ),
            {
                "id": row_id,
                "org": org_id,
                "sid": claude_session_id,
                "label": account_label,
                "tsrc": tenant_source,
                "bsrc": body_source,
                "state": state,
                "closeout": closeout_state,
            },
        )
    return row_id


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    """head → downgrade past THIS revision → head, and the table comes and goes.

    The rewind target is ``_PARENT_REVISION_ID`` by NAME, not ``-1``: once a
    descendant lands, a relative step unwinds the descendant instead and the
    assertions below would read a still-present table as a failed downgrade.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "sessionrepo_roundtrip") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        assert table_exists(engine, "agent", "session_artifacts")

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "agent", "session_artifacts"), (
            "session_artifacts survived the downgrade"
        )

        run_alembic(root, db_url, "upgrade", "head")
        assert table_exists(engine, "agent", "session_artifacts")

        # ── shape ────────────────────────────────────────────────────────
        indexes = _index_defs(engine, "session_artifacts")
        identity = indexes["uq_session_artifacts_identity"]
        assert "UNIQUE" in identity
        assert "COALESCE" in identity.upper()
        assert "claude_session_id" in identity
        assert "account_label" in identity
        # Read off the LIVE DDL, not the model: the migration is the copy that
        # will actually run, and the whole defect being guarded here is two
        # writers disagreeing about a column that must not be in the key.
        assert "organization_id" not in identity, (
            f"the migration put organization_id back in the identity index: {identity}"
        )

        for name in (
            "ix_session_artifacts_tenant_id",
            "ix_session_artifacts_state",
            "ix_session_artifacts_closeout_state",
            "ix_session_artifacts_last_activity_at",
            "ix_session_artifacts_repo",
            "ix_session_artifacts_account_label",
        ):
            assert name in indexes, name

        search = indexes["ix_session_artifacts_search"]
        assert "gin" in search.lower()
        assert "to_tsvector" in search
        # Every searchable column reached the indexed expression.
        for column in ("ai_title", "session_name", "first_prompt", "last_prompt"):
            assert column in search

        assert {
            "ck_session_artifacts_tenant_source",
            "ck_session_artifacts_body_source",
            "ck_session_artifacts_state",
            "ck_session_artifacts_closeout_state",
        } <= _constraint_names(engine, "session_artifacts", "c")

        # No FK on the coord soft links — they are allowed to dangle.
        assert _constraint_names(engine, "session_artifacts", "f") == set()

        # ── the identity index actually bites on NULLs ────────────────────
        _insert_session(engine, org_id=None, claude_session_id="sess-a")
        with pytest.raises(IntegrityError):
            _insert_session(engine, org_id=None, claude_session_id="sess-a")

        # ...but the SAME session id under a different account home is a
        # different session, which is why account_label is part of identity.
        _insert_session(
            engine,
            org_id=None,
            claude_session_id="sess-a",
            account_label="paktis-gmail",
        )

        # ── and a DIFFERENT organization is NOT a different session ───────
        #
        # This is the fork the identity change closes, asserted at the DDL
        # level: the web archiver inserts with organization_id NULL because it
        # has no calling principal, and the runner POSTs the same session with
        # one. While the organization was in the key those were two rows. Now
        # the database itself refuses the second, so no application-layer bug
        # can reintroduce the fork.
        with pytest.raises(IntegrityError):
            _insert_session(engine, org_id=uuid.uuid4(), claude_session_id="sess-a")
        with pytest.raises(IntegrityError):
            _insert_session(
                engine,
                org_id=uuid.uuid4(),
                claude_session_id="sess-a",
                account_label="paktis-gmail",
            )

        # ── the CHECKs bite ──────────────────────────────────────────────
        with pytest.raises(IntegrityError):
            _insert_session(
                engine,
                org_id=None,
                claude_session_id="sess-bad-tenant-source",
                tenant_source="guessed",
            )
        with pytest.raises(IntegrityError):
            _insert_session(
                engine,
                org_id=None,
                claude_session_id="sess-bad-body-source",
                body_source="disk_redacted",
            )
        with pytest.raises(IntegrityError):
            _insert_session(
                engine,
                org_id=None,
                claude_session_id="sess-bad-state",
                state="running",
            )
        with pytest.raises(IntegrityError):
            _insert_session(
                engine,
                org_id=None,
                claude_session_id="sess-bad-closeout",
                closeout_state="done",
            )

        # A metadata-only row — no body, no digest, no source — is legal.
        _insert_session(
            engine,
            org_id=None,
            claude_session_id="sess-metadata-only",
            body_source=None,
        )

        # ── defaults ─────────────────────────────────────────────────────
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT tenant_source, state, closeout_state,
                           secret_finding_count, secret_finding_kinds
                      FROM agent.session_artifacts
                     WHERE claude_session_id = 'sess-metadata-only'
                    """
                )
            ).one()
        assert row.closeout_state == "unknown"
        assert row.secret_finding_count == 0
        # NULL, not '{}': nothing has scanned this row yet.
        assert row.secret_finding_kinds is None


@_PG_SKIP
def test_the_search_index_is_actually_used_by_the_constant_predicate() -> None:
    """The trap, proven end to end: the planner must pick the GIN index.

    Asserting the strings match is necessary but not sufficient — this walks
    the whole path (migration → index → predicate built from the constant) and
    reads the plan back out of PostgreSQL.
    """
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "sessionrepo_search") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        with engine.begin() as conn:
            for n in range(200):
                conn.execute(
                    text(
                        """
                        INSERT INTO agent.session_artifacts
                            (id, claude_session_id, ai_title, first_prompt)
                        VALUES (gen_random_uuid(), :sid, :title, :prompt)
                        """
                    ),
                    {
                        "sid": f"sess-{n}",
                        "title": f"session about widget {n}",
                        "prompt": "implement the alembic migration",
                    },
                )
            # The planner will not consider an index on a table it believes is
            # tiny and has never analysed.
            conn.execute(text("ANALYZE agent.session_artifacts"))
            conn.execute(text("SET enable_seqscan = off"))
            plan = "\n".join(
                r[0]
                for r in conn.execute(
                    text(
                        "EXPLAIN SELECT id FROM agent.session_artifacts "
                        f"WHERE {SESSION_SEARCH_TSVECTOR_SQL} "
                        "@@ plainto_tsquery('english', 'alembic')"
                    )
                )
            )

        assert "ix_session_artifacts_search" in plan, plan
