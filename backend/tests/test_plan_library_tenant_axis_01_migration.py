"""Round-trip + shape test for ``plan_library_tenant_axis_01``.

Phase 1 of plan
``2026-09-22-the-plan-corpus-has-no-tenant-axis-so-a-multi-bound-device-cannot-scope-its-plans``.

What is worth asserting here, beyond "the columns exist":

* the round trip actually REMOVES both columns and the constraint — a
  downgrade that silently leaves them behind would let a re-upgrade pass on a
  schema that never round-tripped;
* ``tenant_source`` is ``NOT NULL`` with a ``'unknown'`` default, so the
  backfill is a property of the DDL rather than of a separate pass someone
  could forget. Every pre-existing row predates the notion of a tenant and
  none of them may claim an attribution;
* ``tenant_id`` is NULLABLE — the honest spelling of "no tenant established".
  A NOT NULL tenant would have forced the migration to guess one, which is
  the exact defect ``tenant_source`` exists to prevent;
* **``uq_work_artifacts_identity`` is UNCHANGED.** This is the assertion that
  keeps Phase 1 safe to land alone: re-keying identity is Phase 4, gated on a
  measurement, and it must move the crud lookups in the same commit. A
  migration that quietly added the tenant to the unique index would turn
  today's silent cross-tenant overwrite into an ``IntegrityError`` 500;
* the CHECK vocabulary is value-for-value the sibling
  ``ck_session_artifacts_tenant_source``'s. Two spellings of one vocabulary is
  drift.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=localhost:5433`` when 5432 is not
the one accepting the test credentials.
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
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "plan_library_tenant_axis_01"
_REVISION_FILENAME = "plan_library_tenant_axis_01_work_artifacts_tenant_axis.py"

_VOCABULARY = frozenset(
    {"declared", "derived_repo", "derived_sole_binding", "ambiguous", "unknown"}
)


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def _revision_code() -> str:
    """The revision file with its module docstring removed.

    ``ast`` rather than a regex: the docstring contains triple-quoted prose
    about the very identifiers the caller is asserting the ABSENCE of, so
    "everything after the first ``\"\"\"`` pair" is exactly the kind of
    approximate parse that would make the assertion meaningless.
    """
    import ast

    source = _revision_source()
    tree = ast.parse(source)
    body = tree.body
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
    ):
        body = body[1:]
    return chr(10).join(ast.unparse(node) for node in body)


def _parent_revision_id() -> str:
    """The parent read from the FILE, not pinned in this module.

    ``down_revision`` is re-pointed whenever another alembic PR lands first
    (branch protection serialises them), so a hard-coded parent here would
    fail this test for a reason that has nothing to do with the revision.
    """
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, "down_revision must name exactly one parent"
    return match.group("parent")


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


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
    assert "ADD COLUMN IF NOT EXISTS tenant_id" in source
    assert "ADD COLUMN IF NOT EXISTS tenant_source" in source
    assert "DROP COLUMN IF EXISTS tenant_id" in source
    assert "DROP COLUMN IF EXISTS tenant_source" in source
    assert source.count("CREATE INDEX IF NOT EXISTS") == 1
    assert source.count("DROP INDEX IF EXISTS") == 1
    # Dropped before it is added, so a re-run cannot die on the constraint.
    assert source.count("DROP CONSTRAINT IF EXISTS") == 2


def test_the_revision_does_not_touch_the_identity_index() -> None:
    """Phase 1 is additive. Re-keying identity is Phase 4 and is GATED.

    Asserted on the CODE as well as on the database because this is the
    property that makes the phase independently landable, and a reader
    tempted to "finish the job" in one migration should fail here first.

    The module docstring is stripped first: it NAMES both indexes in order to
    explain why it leaves them alone, and a test that could not tell an
    explanation from a statement would forbid the explanation.
    """
    code = _revision_code()
    assert "uq_work_artifacts_identity" not in code
    assert "ix_work_artifacts_scan_identity" not in code


def test_the_vocabulary_matches_the_sibling_store() -> None:
    """One vocabulary, two tables. A second spelling is drift, not design."""
    sibling = (backend_root() / "app" / "models" / "session_artifact.py").read_text(
        encoding="utf-8"
    )
    for value in _VOCABULARY:
        assert f"'{value}'" in sibling, (
            f"{value!r} is not in ck_session_artifacts_tenant_source's "
            "vocabulary — the two must not diverge"
        )
        assert f"'{value}'" in _revision_source()


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


def _check_clause(engine: Engine, name: str) -> str | None:
    sql = text(
        """
        SELECT pg_get_constraintdef(c.oid) AS def
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'agent'
           AND t.relname = 'work_artifacts'
           AND c.conname = :name
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql, {"name": name}).first()
    return (
        row.def_
        if row is not None and hasattr(row, "def_")
        else (row[0] if row is not None else None)
    )


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    """head → downgrade past THIS revision → head.

    The rewind target is the parent read from the file, never ``-1``: a
    relative step is correct only while this revision is the head, and the
    moment any PR chains a descendant on it would unwind THAT revision and
    blame this one.
    """
    admin_url = admin_database_url()
    root = backend_root()
    parent = _parent_revision_id()

    with ephemeral_database(admin_url, "planlib_tenantaxis") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        tenant_id = _column(engine, "tenant_id")
        assert tenant_id is not None, "tenant_id did not land"
        assert tenant_id["data_type"] == "uuid"
        assert tenant_id["is_nullable"] == "YES", (
            "tenant_id must be nullable — NOT NULL would have forced the "
            "migration to GUESS a tenant for every existing row"
        )

        tenant_source = _column(engine, "tenant_source")
        assert tenant_source is not None, "tenant_source did not land"
        assert tenant_source["data_type"] == "text"
        assert tenant_source["is_nullable"] == "NO"
        assert "unknown" in str(tenant_source["column_default"]), (
            "the backfill IS the default; without it a pre-existing row "
            "states no source at all"
        )

        clause = _check_clause(engine, "ck_work_artifacts_tenant_source")
        assert clause is not None, "the tenant_source CHECK did not land"
        for value in _VOCABULARY:
            assert value in clause, f"{value!r} missing from the CHECK"

        indexes = _index_defs(engine)
        assert "ix_work_artifacts_tenant_id" in indexes
        assert "UNIQUE" not in indexes["ix_work_artifacts_tenant_id"].upper()

        # The whole point of Phase 1: identity is UNTOUCHED.
        identity = indexes["uq_work_artifacts_identity"]
        assert "tenant_id" not in identity, (
            "Phase 1 must not re-key identity — that is Phase 4, gated on the "
            "cross-tenant measurement, and it must move the crud lookups in "
            "the same commit or the upsert 500s"
        )
        assert "tenant_id" not in indexes["ix_work_artifacts_scan_identity"]

        run_alembic(root, db_url, "downgrade", parent)
        assert _column(engine, "tenant_id") is None, "tenant_id survived"
        assert _column(engine, "tenant_source") is None, "tenant_source survived"
        assert _check_clause(engine, "ck_work_artifacts_tenant_source") is None
        after_down = _index_defs(engine)
        assert "ix_work_artifacts_tenant_id" not in after_down
        # Everything this revision did not create is still there.
        assert "uq_work_artifacts_identity" in after_down
        assert "ix_work_artifacts_scan_identity" in after_down

        run_alembic(root, db_url, "upgrade", "head")
        assert _column(engine, "tenant_id") is not None
        assert _column(engine, "tenant_source") is not None


@_PG_SKIP
def test_the_check_refuses_a_value_outside_the_vocabulary() -> None:
    """A CHECK nothing tests is a comment. This is the assertion that it bites."""
    from sqlalchemy.exc import IntegrityError

    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_tenantvocab") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO agent.work_artifacts "
                    "(kind, slug, title, status, body, content_sha256, "
                    " tenant_source) "
                    "VALUES ('plan', 'vocab-probe', '', '', '', "
                    f"'{'0' * 64}', 'unknown')"
                )
            )
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE agent.work_artifacts "
                        "SET tenant_source = 'guessed' WHERE slug = 'vocab-probe'"
                    )
                )
