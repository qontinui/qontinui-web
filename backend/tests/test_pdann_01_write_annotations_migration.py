"""Schema + round-trip test for the ``pdann_01`` revision.

The qontinui-web half of Phase 4's data path (plan
``D:/qontinui-root/plans/2026-08-27-tenant-level-agent-authorable-stores.md``)
adds two nullable annotation columns to ``coord.prompt_document_versions``::

    loosening         BOOLEAN  NULL
    notification_ref  UUID     NULL

Modelled on ``test_pdaw_01_agent_writable_migration.py``, and for the same
stated reason: ``migration-reversal.yml`` walks the chain against an EMPTY
database, so it proves the SQL parses and nothing more — no row exists there to
survive a round-trip, and it asserts nothing about which tables gained which
columns.

What is asserted here, and why each one can fail silently otherwise:

1. **The versions table gets them, and the PARENT does NOT.** This revision
   deliberately INVERTS ``pdaw_01``'s two-table shape. These are properties of
   one WRITE, and a parent copy could only mean "was the latest write a
   loosening" — a derived value that goes stale the moment another version
   lands, which is the two-columns-one-fact hazard ``pdtier_02``'s WARNING block
   is about. A stray parent column would produce no error and no warning, so the
   asymmetry is asserted in both directions.
2. **``notification_ref`` is exactly ``uuid``, ``loosening`` exactly
   ``boolean``.** ``ADD COLUMN IF NOT EXISTS`` is type-blind (it matches on name
   alone), and coord reads these into ``Option<Uuid>`` / ``Option<bool>`` where a
   mismatch **panics** in ``tokio_postgres::Row::get`` rather than raising a
   SQLSTATE it could degrade on. There is no recovery path, so the types are part
   of the interface and are asserted by name.
3. **Nullable, no default, no backfill.** ``NULL`` on ``loosening`` is a third
   state meaning *"no direction verdict exists for this write"* — a statement
   about what ran, not about the write, with several ordinary causes (a version
   produced by a path the classifier does not sit on: an operator PATCH, a
   clause recompile, a seed rewrite; or a coord build predating the
   classification). A ``DEFAULT false`` or a backfill would assert of every
   historical version that the classifier ran and cleared it, manufacturing
   verdicts that the operator feed then presents as real ones.
4. **``FALSE`` round-trips as ``FALSE``, distinct from ``NULL``.** This is the
   load-bearing case for the whole feature: the shipped frontend's
   ``looseningClassificationPresent`` distinguishes "classified, none was a
   loosening" from "never classified", and it can only do that if ``false``
   survives storage as something other than absence.
5. **No foreign key to ``coord.findings``.** Findings expire (~14 days) while a
   version row is immutable history, so an FK would either block TTL expiry or
   erase the annotation when it fired. Asserted behaviourally — the cited
   finding is DELETEd and the version row must survive with its ref intact — not
   by reading ``pg_constraint``, because the behaviour is the contract and a
   future ``ON DELETE SET NULL`` would satisfy a mere "no FK named X" check
   while silently destroying the annotation.
6. **Up → down → up leaves no residue and does not touch data.** The downgrade
   must remove both columns and neither the table nor its rows.

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
_REVISION_ID = "pdann_01"
_PARENT_REVISION_ID = "cgaudit_01"
_REVISION_FILENAME = "pdann_01_prompt_document_write_annotations.py"

_PARENT_TABLE = "prompt_documents"
_VERSIONS_TABLE = "prompt_document_versions"

# (column, expected ``information_schema`` data_type)
_COLUMNS = (("loosening", "boolean"), ("notification_ref", "uuid"))

# Scoped to the DB-backed tests ONLY. A module-level `pytestmark` would also
# skip the source-scanning tests below, which need no database — and a run that
# skips everything is indistinguishable from a run that proves everything.
_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _revision_source() -> str:
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    return path.read_text(encoding="utf-8")


def _column(
    engine: Engine, table: str, column: str
) -> tuple[str, str, str | None] | None:
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
        row = conn.execute(sql, {"table": table, "column": column}).fetchone()
    return (row[0], row[1], row[2]) if row else None


def test_pin_matches_the_revisions_own_down_revision() -> None:
    """A stale `_PARENT_REVISION_ID` rewinds too far and replays foreign DDL."""
    source = _revision_source()
    assert (
        f'down_revision: str | Sequence[str] | None = "{_PARENT_REVISION_ID}"' in source
    ), (
        f"{_REVISION_FILENAME}'s down_revision no longer matches this test's pin "
        f"({_PARENT_REVISION_ID}); update the pin deliberately, not by guessing"
    )
    assert f'revision: str = "{_REVISION_ID}"' in source


def test_ddl_targets_the_versions_table_only() -> None:
    """The single-table constant is what makes a stray parent column visible.

    Reading the parent's name out of the DDL constant would be the first sign
    that someone "restored symmetry" with ``pdaw_01`` without noticing that these
    annotations describe a write rather than a document.
    """
    source = _revision_source()
    assert '_TABLE = "coord.prompt_document_versions"' in source
    assert '"coord.prompt_documents"' not in source.split('"""', 2)[2], (
        "the DDL must not name coord.prompt_documents; a per-write annotation "
        "has no parent-level meaning, and a parent copy could only be a "
        "silently-staleable duplicate of the head snapshot's value"
    )


def test_ddl_declares_the_types_and_no_default() -> None:
    """Types are the interface (coord panics on a mismatch); NULL is a state."""
    source = _revision_source()
    assert '("loosening", "BOOLEAN"),' in source
    assert '("notification_ref", "UUID"),' in source, (
        "notification_ref must be UUID — coord.findings.finding_id is "
        "`UUID PRIMARY KEY`, and TEXT would admit an id no read can resolve"
    )

    # A DEFAULT would collapse the third state. Assert against the ALTER template
    # ONLY: the docstring discusses defaults and NULL constantly (that is what it
    # is about), so scanning the whole file for the substring passes vacuously.
    alter_lines = [
        line
        for line in source.splitlines()
        if "ADD COLUMN IF NOT EXISTS" in line
        and "ALTER TABLE" in line
        and not line.lstrip().startswith("#")
    ]
    assert len(alter_lines) == 1, (
        "expected exactly ONE ALTER template, built once and applied to both "
        f"columns from a single list; found {len(alter_lines)}: {alter_lines!r}"
    )
    assert "DEFAULT" not in alter_lines[0].upper(), (
        f"the ADD COLUMN template must not attach a DEFAULT: {alter_lines[0]!r}. "
        "DEFAULT false would assert of every historical version that coord "
        "classified it and cleared it."
    )
    assert "NOT NULL" not in alter_lines[0].upper(), (
        f"the ADD COLUMN template must stay nullable: {alter_lines[0]!r}"
    )


def test_ddl_declares_no_foreign_key() -> None:
    """Findings expire; a version row is immutable history and must outlive one."""
    body = _revision_source().split('"""', 2)[2]
    assert "REFERENCES" not in body.upper(), (
        "no FK to coord.findings: RESTRICT would block the ~14-day TTL and "
        "CASCADE/SET NULL would erase the annotation when it fires"
    )


@_needs_pg
def test_columns_land_on_the_versions_table_only() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdann01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, "coord", _VERSIONS_TABLE)
        for column, expected_type in _COLUMNS:
            found = _column(engine, _VERSIONS_TABLE, column)
            assert found is not None, f"coord.{_VERSIONS_TABLE}.{column} was not added"
            data_type, is_nullable, default = found
            assert data_type == expected_type, (
                f"coord.{_VERSIONS_TABLE}.{column} is {data_type!r}, expected "
                f"{expected_type!r}. ADD COLUMN IF NOT EXISTS is type-blind, and "
                "coord panics on a type mismatch with no degrade path."
            )
            assert is_nullable == "YES", (
                f"coord.{_VERSIONS_TABLE}.{column} must be NULLABLE — for "
                "`loosening` NULL is the third state ('no verdict exists for "
                "this write'), which is a statement about what ran and not "
                "about the write."
            )
            assert default is None, (
                f"coord.{_VERSIONS_TABLE}.{column} must have NO default: a "
                "DEFAULT manufactures a verdict coord never gave."
            )

            # The deliberate asymmetry, asserted rather than assumed.
            assert _column(engine, _PARENT_TABLE, column) is None, (
                f"coord.{_PARENT_TABLE}.{column} exists. These annotate a WRITE, "
                "not a document; a parent copy could only mean 'was the latest "
                "write a loosening', which goes stale on the next version."
            )


def _seed_document(engine: Engine) -> uuid.UUID:
    """One document + one version, inserted BEFORE the columns exist."""
    tenant = uuid.uuid4()
    doc_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.prompt_documents
                    (id, tenant_id, kind, name, body, format, current_version)
                VALUES (:id, :tenant, 'policy', 'operating-rules', 'body',
                        'markdown', 1)
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
    return doc_id


@_needs_pg
def test_no_backfill_and_false_is_distinct_from_null() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdann01_data") as (engine, db_url):
        # Walk to the PARENT first so the version exists before the columns do —
        # the real-world ordering, and the only one where a backfill would be
        # observable.
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        doc_id = _seed_document(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT loosening, notification_ref
                      FROM coord.prompt_document_versions
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id},
            ).one()
        assert row[0] is None and row[1] is None, (
            "pdann_01 must not backfill: nothing classified the writes that "
            "predate it, so any value written onto them is a manufactured "
            "verdict the operator feed would then present as a real one"
        )

        # 4. FALSE round-trips as FALSE. If it came back as NULL the frontend's
        #    `looseningClassificationPresent` could never tell "classified, none
        #    was a loosening" from "never classified".
        ref = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.prompt_document_versions
                       SET loosening = FALSE, notification_ref = :ref
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id, "ref": ref},
            )
        with engine.connect() as conn:
            got = conn.execute(
                text(
                    """
                    SELECT loosening, notification_ref
                      FROM coord.prompt_document_versions
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id},
            ).one()
        assert got[0] is False, (
            "FALSE must round-trip as FALSE, not coerce to NULL — absent and "
            "'classified, not a loosening' are different facts"
        )
        assert got[1] == ref


@_needs_pg
def test_an_expiring_finding_does_not_take_the_annotation_with_it() -> None:
    """The soft link, asserted behaviourally rather than by constraint name.

    A future ``ON DELETE SET NULL`` would satisfy a "no FK named X" check while
    silently erasing exactly the record this column exists to keep.
    """
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdann01_softlink") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        doc_id = _seed_document(engine)

        finding_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.findings
                        (finding_id, tenant_id, title, body, expires_at)
                    VALUES (:fid, :tenant, 'why this write', 'reasoning',
                            now() + interval '14 days')
                    """
                ),
                {"fid": finding_id, "tenant": uuid.uuid4()},
            )
            conn.execute(
                text(
                    """
                    UPDATE coord.prompt_document_versions
                       SET loosening = TRUE, notification_ref = :ref
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id, "ref": finding_id},
            )
            # The TTL sweep, in miniature.
            conn.execute(
                text("DELETE FROM coord.findings WHERE finding_id = :fid"),
                {"fid": finding_id},
            )

        with engine.connect() as conn:
            got = conn.execute(
                text(
                    """
                    SELECT loosening, notification_ref
                      FROM coord.prompt_document_versions
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id},
            ).one()
        assert got == (True, finding_id), (
            "the version row must survive its finding's expiry with the ref "
            "intact; past the TTL the ref still records that a notification "
            "existed, which an FK would have destroyed"
        )


@_needs_pg
def test_downgrade_removes_both_columns_and_keeps_the_data() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdann01_reverse") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        doc_id = _seed_document(engine)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.prompt_document_versions
                       SET loosening = TRUE, notification_ref = :ref
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id, "ref": uuid.uuid4()},
            )

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        for column, _type in _COLUMNS:
            assert _column(engine, _VERSIONS_TABLE, column) is None, (
                f"downgrade left coord.{_VERSIONS_TABLE}.{column} behind"
            )
        assert table_exists(engine, "coord", _VERSIONS_TABLE), (
            "downgrade dropped the table itself; it belongs to an earlier "
            "revision and must survive"
        )

        # The rows survive the walk — this revision touches columns, not data.
        with engine.connect() as conn:
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
            assert (
                conn.execute(
                    text("SELECT count(*) FROM coord.prompt_documents WHERE id = :id"),
                    {"id": doc_id},
                ).scalar_one()
                == 1
            )

        # And up again, cleanly — both columns come back, empty.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.connect() as conn:
            got = conn.execute(
                text(
                    """
                    SELECT loosening, notification_ref
                      FROM coord.prompt_document_versions
                     WHERE document_id = :doc AND version_number = 1
                    """
                ),
                {"doc": doc_id},
            ).one()
        assert got == (None, None), (
            "re-running upgrade restores the columns, not the annotations — "
            "which is what the downgrade's docstring says it costs"
        )
