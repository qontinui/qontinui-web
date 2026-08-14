"""Schema + round-trip test for the ``pdaw_01`` revision.

P0 of plan
``D:/qontinui-root/plans/2026-08-04-per-document-agent-write-access.md`` adds
``agent_writable BOOLEAN NULL`` to ``coord.prompt_documents`` **and** to
``coord.prompt_document_versions``. The DDL is two ALTERs; the contract is
everything around them, and none of it is visible from a passing ``upgrade``.

Modelled on ``test_fleet_res_tel_03_control_columns_migration.py``, which exists
for the same reason and states it best: ``migration-reversal.yml`` walks the
chain against an EMPTY database, so it proves the SQL parses and nothing more —
no row exists there to survive a round-trip, and it asserts nothing about which
tables gained which columns.

What is asserted, and why each one can fail silently otherwise:

1. **Both tables get it.** The versions table's own ``COMMENT ON TABLE`` makes
   this a standing rule — *"a partial snapshot is an audit trail that lies while
   still reporting as versioned"* — and a parent-only widening produces no
   error, no warning, and no missing ``current_version``.
2. **The type is exactly ``boolean``.** coord reads it as ``Option[bool]``
   straight off the row. The revision's own docstring warns that
   ``ADD COLUMN IF NOT EXISTS`` is **type-blind** — it matches on name alone, so
   a pre-existing column of the wrong type makes the ADD a silent no-op — and
   that a type mismatch **panics** in ``tokio_postgres::Row::get`` rather than
   raising a SQLSTATE coord can degrade on. There is no recovery path, so the
   type is part of the interface and is asserted by name.
3. **Nullable, and no default.** ``NULL`` is a third state meaning "no operator
   opinion", which routes to coord's compile-time default. A
   ``NOT NULL DEFAULT false`` would collapse "unset" into "protected" and
   silently protect the entire corpus; a ``DEFAULT true`` would silently open
   the three meta-policies.
4. **No backfill.** Every pre-existing row must still read ``NULL`` after the
   upgrade. Writing ``false`` onto today's protected documents would freeze the
   code default into data, so a later edit to coord's constant would no longer
   take effect — and the constant would look inert to the next reader.
5. **Both tables can actually carry the value**, including ``False`` (distinct
   from ``NULL``) — the point of widening the child at all. Asserted on both,
   because they are two independent ALTERs and one passing is not evidence
   about the other.
6. **Up → down → up leaves no residue and does not touch data.** Downgrade must
   remove the column from *both* tables — leaving the child's behind gives a
   snapshot table that can hold payload the parent cannot, the same defect
   mirrored — while leaving both TABLES themselves alone, and a pre-existing
   document and version row must survive the walk.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one
accepting the test credentials.

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips — which looks
exactly like a green run in the summary line.
"""

from __future__ import annotations

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
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top cannot
# silently change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test enforces it, because a stale
# pin rewinds too far and replays unrelated non-idempotent revisions, surfacing
# as someone else's `DuplicateTable`.
_REVISION_ID = "pdaw_01"
_PARENT_REVISION_ID = "cisplit_01_devices_max_concurrent_ci_jobs"
_REVISION_FILENAME = "pdaw_01_prompt_document_agent_writable.py"

_PARENT_TABLE = "prompt_documents"
_VERSIONS_TABLE = "prompt_document_versions"
_COLUMN = "agent_writable"
_EXPECTED_TYPE = "boolean"

# Scoped to the DB-backed tests ONLY. A module-level `pytestmark` would also
# skip the two source-scanning tests below, which need no database — and a run
# that skips everything is indistinguishable from a run that proves everything.
_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _column(engine: Engine, table: str) -> tuple[str, str, str | None] | None:
    """``(data_type, is_nullable, column_default)`` for the column, or None."""
    sql = text(
        """
        SELECT data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'coord'
           AND table_name = :table
           AND column_name = :column
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql, {"table": table, "column": _COLUMN}).fetchone()
    return (row[0], row[1], row[2]) if row else None


def test_pin_matches_the_revisions_own_down_revision() -> None:
    """A stale `_PARENT_REVISION_ID` rewinds too far and replays foreign DDL."""
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    source = path.read_text(encoding="utf-8")
    assert (
        f'down_revision: str | Sequence[str] | None = "{_PARENT_REVISION_ID}"' in source
    ), (
        f"{_REVISION_FILENAME}'s down_revision no longer matches this test's pin "
        f"({_PARENT_REVISION_ID}); update the pin deliberately, not by guessing"
    )
    assert f'revision: str = "{_REVISION_ID}"' in source


def test_ddl_names_the_column_once_for_both_tables() -> None:
    """The single-list shape is what makes a partial widening unrepresentable."""
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    source = path.read_text(encoding="utf-8")
    assert '_COLUMN = "agent_writable"' in source
    assert '_SQL_TYPE = "BOOLEAN"' in source, (
        "the DDL type must stay BOOLEAN — coord reads Option[bool] and a mismatch "
        "panics in row.get rather than raising a degradable SQLSTATE"
    )
    assert '"coord.prompt_documents",' in source
    assert '"coord.prompt_document_versions",' in source

    # NULL is a third state; a DEFAULT would collapse it. Assert against the
    # ALTER template ONLY — the surrounding prose and both COMMENT bodies use
    # the word "default" constantly (that is what they are about), so scanning
    # the whole `upgrade()` body for the substring passes vacuously.
    # `ALTER TABLE` as well as `ADD COLUMN`: the module docstring discusses
    # `ADD COLUMN IF NOT EXISTS` in prose (it explains why the form is
    # type-blind), and matching that would make this count wrong for a reason
    # that has nothing to do with the DDL.
    alter_lines = [
        line
        for line in source.splitlines()
        if "ADD COLUMN IF NOT EXISTS" in line
        and "ALTER TABLE" in line
        and not line.lstrip().startswith("#")
    ]
    assert len(alter_lines) == 1, (
        "expected exactly ONE ALTER template, built once and applied to both "
        f"tables from a single list; found {len(alter_lines)}: {alter_lines!r}. "
        "Two hand-written ALTERs are how the tables drift apart."
    )
    assert "DEFAULT" not in alter_lines[0].upper(), (
        f"the ADD COLUMN template must not attach a DEFAULT: {alter_lines[0]!r}. "
        "NULL means 'no operator opinion' and routes to coord's compile-time "
        "default; DEFAULT false silently protects the whole corpus and DEFAULT "
        "true silently opens the three meta-policies."
    )
    assert "NOT NULL" not in alter_lines[0].upper(), (
        f"the ADD COLUMN template must stay nullable: {alter_lines[0]!r}"
    )


@_needs_pg
def test_column_lands_on_both_tables_with_the_right_shape() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdaw01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert table_exists(engine, "coord", table), f"coord.{table} missing"
            found = _column(engine, table)
            assert found is not None, (
                f"coord.{table}.{_COLUMN} was not added. A parent-only widening "
                "produces no error and no warning — this assertion is the only "
                "thing that catches it."
            )
            data_type, is_nullable, default = found
            assert data_type == _EXPECTED_TYPE, (
                f"coord.{table}.{_COLUMN} is {data_type!r}, expected "
                f"{_EXPECTED_TYPE!r}. ADD COLUMN IF NOT EXISTS is type-blind, and "
                "coord panics on a type mismatch with no degrade path."
            )
            assert is_nullable == "YES", (
                f"coord.{table}.{_COLUMN} must be NULLABLE: NULL is the third "
                "state ('no operator opinion') that routes to coord's "
                "compile-time default. NOT NULL collapses it into 'protected'."
            )
            assert default is None, (
                f"coord.{table}.{_COLUMN} must have NO default: a DEFAULT false "
                "silently protects the whole corpus, a DEFAULT true silently "
                "opens the three meta-policies."
            )


@_needs_pg
def test_existing_rows_are_not_backfilled_and_both_tables_carry_false() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdaw01_data") as (engine, db_url):
        # Walk to the PARENT first so the document exists before the column does
        # — that is the real-world ordering, and the only one where a backfill
        # would be observable.
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)

        tenant = uuid.uuid4()
        doc_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.prompt_documents
                        (id, tenant_id, kind, name, body, format, current_version)
                    VALUES (:id, :tenant, 'policy', 'session-protocol', 'body', 'markdown', 1)
                    """
                ),
                {"id": doc_id, "tenant": tenant},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.prompt_document_versions
                        (document_id, version_number, body)
                    VALUES (:doc, 1, 'body')
                    """
                ),
                {"doc": doc_id},
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.connect() as conn:
            # 4. No backfill — including on `session-protocol`, which coord's
            #    compile-time constant protects. Writing `false` here would turn
            #    the code default into data and make the constant inert.
            got = conn.execute(
                text(
                    "SELECT agent_writable FROM coord.prompt_documents WHERE id = :id"
                ),
                {"id": doc_id},
            ).scalar_one()
            assert got is None, (
                "pdaw_01 must not backfill: every pre-existing row keeps NULL so "
                "coord's compile-time default stays the authority for documents "
                "no operator has ruled on"
            )

        # 5. Both tables can actually hold the value, and FALSE is distinct from
        #    NULL on the way back out.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.prompt_documents SET agent_writable = FALSE WHERE id = :id"
                ),
                {"id": doc_id},
            )
            conn.execute(
                text(
                    """
                    UPDATE coord.prompt_document_versions
                       SET agent_writable = TRUE
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id},
            )
        with engine.connect() as conn:
            parent = conn.execute(
                text(
                    "SELECT agent_writable FROM coord.prompt_documents WHERE id = :id"
                ),
                {"id": doc_id},
            ).scalar_one()
            child = conn.execute(
                text(
                    """
                    SELECT agent_writable FROM coord.prompt_document_versions
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id},
            ).scalar_one()
        assert parent is False, (
            "the parent must round-trip FALSE, not coerce it to NULL"
        )
        assert child is True, "the snapshot must round-trip its own value independently"


@_needs_pg
def test_downgrade_removes_it_from_both_tables_and_keeps_the_data() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdaw01_reverse") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        tenant = uuid.uuid4()
        doc_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.prompt_documents
                        (id, tenant_id, kind, name, body, format, current_version, agent_writable)
                    VALUES (:id, :tenant, 'policy', 'git-operations', 'b', 'markdown', 1, FALSE)
                    """
                ),
                {"id": doc_id, "tenant": tenant},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.prompt_document_versions
                        (document_id, version_number, body, agent_writable)
                    VALUES (:doc, 1, 'b', FALSE)
                    """
                ),
                {"doc": doc_id},
            )

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table) is None, (
                f"downgrade left coord.{table}.{_COLUMN} behind. Removing it from "
                "only one table gives a snapshot that can hold payload the parent "
                "cannot — the partial-widening defect, mirrored."
            )
            assert table_exists(engine, "coord", table), (
                f"downgrade dropped coord.{table} itself; it belongs to an "
                "earlier revision and must survive"
            )

        # The rows survive the walk — this revision touches columns, not data.
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT count(*) FROM coord.prompt_documents WHERE id = :id"),
                    {"id": doc_id},
                ).scalar_one()
                == 1
            )
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM coord.prompt_document_versions "
                        "WHERE document_id = :doc"
                    ),
                    {"doc": doc_id},
                ).scalar_one()
                == 1
            )

        # And up again, cleanly — the column comes back on both.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            found = _column(engine, table)
            assert found is not None and found[0] == _EXPECTED_TYPE
