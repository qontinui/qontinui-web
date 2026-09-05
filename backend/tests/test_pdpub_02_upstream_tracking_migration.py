"""Schema, data and round-trip test for the ``pdpub_02`` revision.

Phase 1 (second of two revisions) of plan
``2026-09-04-cross-tenant-policy-publishing`` adds the D3 receiving-end
bookkeeping — ``upstream_publication_version`` and ``upstream_tracking`` — to
**both** ``coord.prompt_documents`` and ``coord.prompt_document_versions``.

Why this file exists
====================

``pdpub_02`` landed in qontinui-web#1252 with no test, and the family it joins
(``pdaw_01``, ``pdtier_01``, ``pdtier_02``, ``pdann_01``) each ship one for the
reason ``test_pdaw_01`` states: ``migration-reversal.yml`` walks the chain
against an **empty** database, so it proves the SQL parses and nothing more. No
row exists there to survive a round-trip, and it asserts nothing about which
table gained which column. ``pdpub_02``'s central claim is precisely about rows
that already exist — that every one of them comes out ``'track'``, "which is the
behaviour those rows already have" — and the empty-database gate is the one
place that claim can never be observed.

What is asserted, and why each one can fail silently otherwise
==============================================================

1. **Both tables get both columns, asserted symmetrically.** The versions table
   is an append-only snapshot of what the parent looked like, and the revision's
   own rule — the same one ``pdaw_01`` and ``pdtier_01`` follow — is that the two
   are widened together from ONE list. A parent-only widening produces no error
   and no warning; it produces a restore that silently resets a document's
   tracked publication to whatever the parent happens to hold.
2. **The exact type, nullability and default.**
   ``upstream_publication_version`` is ``integer NULL`` with **no default**,
   because ``NULL`` is the meaningful "no upstream" state and a default would
   make every row claim a lineage it does not have. ``upstream_tracking`` is
   ``text NOT NULL DEFAULT 'track'``. ``ADD COLUMN IF NOT EXISTS`` matches on
   NAME ALONE and is type-blind, so a re-typed column is invisible to the DDL.
3. **The CHECK actually rejects a value outside the vocabulary — on both
   tables — and accepts both legal values.** A vocabulary column with no
   enforcing constraint is a text column with a docstring. Asserted alongside
   NOT NULL, because the revision states there is no "no opinion" state and the
   two constraints together are what make that true.
4. **Pre-existing rows are defaulted to ``'track'`` with a NULL upstream
   version.** Seeded at the parent revision and read back after the upgrade.
   This is the claim the reversal gate structurally cannot reach, and it is the
   one that decides whether an existing fleet keeps behaving as it did.
5. **The four comments land, compared against the revision's own source.** The
   parent's ``upstream_publication_version`` comment carries the degrade
   polarity — an unresolvable baseline digest is UNKNOWN and MUST read
   ``local_modified = true``, the OPPOSITE sign to
   ``is_unedited_seed_by_digest``'s ``None`` arm — which is the single sentence
   standing between a degraded read and an automatic overwrite of a customer's
   policy body. A missing or mangled ``COMMENT ON`` raises nothing.
6. **``upgrade()`` re-runs, and its drop-then-add pair really does REPAIR a
   CHECK that was added under a different definition.** That is the stated
   reason the revision uses drop-then-add instead of an inline constraint, and
   alembic will not re-run an applied revision for you — so it is exercised here
   by replacing the constraint with a deliberately wrong one and invoking
   ``upgrade()`` through alembic's ``Operations`` proxy.
7. **Up → down → up: the columns and CHECKs go and come back, and no ROW is
   destroyed in either direction.** The downgrade touches columns, never rows,
   and a document/version pair seeded before the walk must still be there after.
8. **The downgrade is lossy in exactly the documented direction.** A
   ``'pinned'`` document returns as ``'track'`` and its
   ``upstream_publication_version`` is gone. Asserted rather than merely
   commented, because the value of the claim is its DIRECTION: every row reading
   as having no upstream degrades to ``local_modified = true``, which resolves
   to *notify*, never to *adopt*. A downgrade that somehow preserved a stale
   version number would point the other way.

Also asserted without a database: the pinned parent equals the revision's own
``down_revision``, and ``scripts/ci/check_coord_column_drops.py`` reads the
upgrade path as dropping nothing. The second is the revision's own structural
claim — it builds its drop statements INSIDE ``downgrade()`` rather than from a
module-level template specifically because that scanner reads everything except
the ``downgrade()`` body, and hoisting them (which is what every other statement
in the file does) would demand a ``COORD_SCHEMA_DROPS`` declaration for a drop
the upgrade never makes. Nothing pinned that before this test, and the PR that
broke it would learn about it from a red gate rather than from a local run.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one
accepting the test credentials. (CI provisions one at 5432 and runs the whole
tree, so the skip is a local-run hazard only.)

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips — which looks
exactly like a green run in the summary line.
"""

from __future__ import annotations

import re
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

# Pinned explicitly rather than "head"; the first test enforces that it equals
# the revision's own `down_revision`, because a stale pin rewinds too far and
# replays unrelated non-idempotent revisions as someone else's `DuplicateTable`.
_REVISION_ID = "pdpub_02"
_PARENT_REVISION_ID = "pdpub_01"
_REVISION_FILENAME = "pdpub_02_prompt_document_upstream_tracking.py"

_PARENT_TABLE = "prompt_documents"
_VERSIONS_TABLE = "prompt_document_versions"
_TABLES = (_PARENT_TABLE, _VERSIONS_TABLE)

_VERSION_COLUMN = "upstream_publication_version"
_TRACKING_COLUMN = "upstream_tracking"

_CHECKS = {
    _PARENT_TABLE: "ck_prompt_documents_upstream_tracking",
    _VERSIONS_TABLE: "ck_prompt_document_versions_upstream_tracking",
}

# Spelled as LITERALS rather than read from the revision's `_TRACKING_VALUES`,
# so narrowing or widening the vocabulary reddens this test instead of moving
# with it.
_LEGAL_TRACKING = ("track", "pinned")
_ILLEGAL_TRACKING = "paused"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _seed_document(engine: Engine, *, name: str = "coordination") -> uuid.UUID:
    """One document plus its version-1 snapshot, using only pre-``pdpub_02`` columns.

    Deliberately written against the parent revision's shape so it can be called
    BEFORE the upgrade — which is the only way to observe what the new columns
    do to rows that already exist.
    """
    with engine.begin() as conn:
        document_id = conn.execute(
            text(
                """
                INSERT INTO coord.prompt_documents
                       (tenant_id, name, kind, body, current_version)
                VALUES (:tenant, :name, 'policy', :body, 1)
                RETURNING id
                """
            ),
            {"tenant": str(uuid.uuid4()), "name": name, "body": f"body of {name}"},
        ).scalar_one()
        conn.execute(
            text(
                """
                INSERT INTO coord.prompt_document_versions
                       (document_id, version_number, body)
                VALUES (:doc, 1, :body)
                """
            ),
            {"doc": document_id, "body": f"body of {name}"},
        )
    return document_id


def _tracking_of(engine: Engine, document_id: uuid.UUID) -> tuple[str, int | None]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                f"""
                SELECT {_TRACKING_COLUMN}, {_VERSION_COLUMN}
                  FROM coord.{_PARENT_TABLE} WHERE id = :id
                """
            ),
            {"id": document_id},
        ).one()
    return row[0], row[1]


def _has_constraint(engine: Engine, table: str, name: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT EXISTS(
                        SELECT 1 FROM pg_constraint
                         WHERE conrelid = to_regclass('coord.' || :t)
                           AND conname = :n
                    )
                    """
                ),
                {"t": table, "n": name},
            ).scalar()
        )


# ---------------------------------------------------------------------------
# 1. source-only: the pin, and what the coord drop guard reads
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_own_down_revision() -> None:
    source = _revision_source()
    assert re.search(rf'^revision: str = "{_REVISION_ID}"$', source, re.M), (
        f"{_REVISION_FILENAME} no longer declares revision {_REVISION_ID!r}"
    )
    match = re.search(
        r'^down_revision: str \| Sequence\[str\] \| None = "([^"]+)"$', source, re.M
    )
    assert match, "down_revision is no longer a plain string literal"
    assert match.group(1) == _PARENT_REVISION_ID


def test_the_upgrade_path_drops_no_coord_surface() -> None:
    """The revision's own structural claim, which nothing else pins.

    ``check_coord_column_drops.py`` scans the whole module MINUS the
    ``downgrade()`` body. ``pdpub_02`` builds its ``DROP COLUMN`` statements
    inside ``downgrade()`` — against the file's own house style, which hoists
    every other statement to a module-level constant — for exactly that reason.
    A module-level ``_DROP_COLUMNS`` template would be read as an upgrade-path
    drop of two ``coord.*`` columns and would demand a ``COORD_SCHEMA_DROPS``
    declaration for a drop the upgrade never makes.

    The ``ALTER TABLE … DROP CONSTRAINT`` pairs that DO live on the upgrade path
    are not column drops and must stay invisible to the scanner.
    """
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, (
        "the guard now reads an upgrade-path coord drop in this revision: "
        f"{[(d.table, d.column) for d in scan.drops]}"
    )
    assert not scan.unresolved, (
        "the guard now reads an UNRESOLVED drop site here, which is a violation "
        f"on its own before any manifest is consulted: {scan.unresolved}"
    )


# ---------------------------------------------------------------------------
# 2. the shape, on BOTH tables
# ---------------------------------------------------------------------------


@_needs_pg
def test_both_tables_get_both_columns_with_the_declared_type_and_default() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub02_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in _TABLES:
            version = column_info(engine, table, _VERSION_COLUMN)
            assert version is not None, f"coord.{table}.{_VERSION_COLUMN} is absent"
            assert version[0] == "integer", f"{table}: {version[0]} != integer"
            assert version[1] == "YES", (
                f"{table}.{_VERSION_COLUMN} must stay nullable — NULL is the "
                "meaningful 'no upstream' state, not a missing value"
            )
            assert version[2] is None, (
                f"{table}.{_VERSION_COLUMN} gained a default ({version[2]!r}); "
                "every row would then claim a lineage it does not have"
            )

            tracking = column_info(engine, table, _TRACKING_COLUMN)
            assert tracking is not None, f"coord.{table}.{_TRACKING_COLUMN} is absent"
            assert tracking[0] == "text", f"{table}: {tracking[0]} != text"
            assert tracking[1] == "NO", f"{table}.{_TRACKING_COLUMN} must be NOT NULL"
            assert tracking[2] == "'track'::text", (
                f"{table}.{_TRACKING_COLUMN} default is {tracking[2]!r}"
            )

            assert _has_constraint(engine, table, _CHECKS[table])


@_needs_pg
def test_the_check_enforces_the_vocabulary_on_both_tables() -> None:
    """A vocabulary column with no enforcing constraint is a text column with a docstring."""
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub02_check") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        document_id = _seed_document(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        parent_update = text(
            f"UPDATE coord.{_PARENT_TABLE} SET {_TRACKING_COLUMN} = :v WHERE id = :id"
        )
        versions_update = text(
            f"UPDATE coord.{_VERSIONS_TABLE} SET {_TRACKING_COLUMN} = :v "
            "WHERE document_id = :id"
        )

        for legal in _LEGAL_TRACKING:
            with engine.begin() as conn:
                conn.execute(parent_update, {"v": legal, "id": document_id})
                conn.execute(versions_update, {"v": legal, "id": document_id})

        for statement in (parent_update, versions_update):
            with pytest.raises(sqlalchemy.exc.IntegrityError):
                with engine.begin() as conn:
                    conn.execute(statement, {"v": _ILLEGAL_TRACKING, "id": document_id})

            # NOT NULL, not a third state: the revision states there is no
            # "no opinion" value, and the CHECK carries no IS NULL arm because
            # of it. Both halves have to hold or one of them is decorative.
            with pytest.raises(sqlalchemy.exc.IntegrityError):
                with engine.begin() as conn:
                    conn.execute(statement, {"v": None, "id": document_id})


@_needs_pg
def test_rows_that_already_existed_come_out_tracking_with_no_upstream() -> None:
    """The claim the empty-database reversal gate structurally cannot reach.

    'Every existing row is defaulted to 'track', which is the behaviour those
    rows already have (nothing has ever pinned them)' — and NULL rather than 0
    or 1 for the version, because ``upstream_publication_version IS NULL`` means
    *no upstream*, which is UNKNOWN and not "up to date".
    """
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub02_existing") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        document_id = _seed_document(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert _tracking_of(engine, document_id) == ("track", None)

        with engine.connect() as conn:
            snapshot = conn.execute(
                text(
                    f"""
                    SELECT {_TRACKING_COLUMN}, {_VERSION_COLUMN}
                      FROM coord.{_VERSIONS_TABLE} WHERE document_id = :id
                    """
                ),
                {"id": document_id},
            ).one()
        assert snapshot == ("track", None)


@_needs_pg
def test_the_comments_land_verbatim_from_the_revision_source() -> None:
    admin_url = admin_database_url()
    source = _revision_source()
    with ephemeral_database(admin_url, "pdpub02_comments") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in _TABLES:
            for column in (_VERSION_COLUMN, _TRACKING_COLUMN):
                assert column_comment(
                    engine, table, column
                ) == comment_body_from_source(source, f"coord.{table}.{column}"), (
                    f"coord.{table}.{column}'s comment does not match its author"
                )


# ---------------------------------------------------------------------------
# 3. the two walks: re-run (and repair), and up → down → up
# ---------------------------------------------------------------------------


@_needs_pg
def test_upgrade_re_runs_and_repairs_a_check_added_under_another_definition() -> None:
    """The stated reason for drop-then-add instead of an inline constraint.

    An inline ``CHECK`` on ``ADD COLUMN IF NOT EXISTS`` inherits that clause's
    no-op and would be unfixable by re-upgrade. The pair is fixable — but only
    if it really re-runs, and alembic will not re-run an applied revision, so
    the module's ``upgrade()`` is invoked directly here against a database whose
    CHECK has been replaced with a deliberately wrong one.
    """
    admin_url = admin_database_url()
    source = _revision_source()
    with ephemeral_database(admin_url, "pdpub02_rerun") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        document_id = _seed_document(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # Replace the parent's CHECK with one that admits the wrong vocabulary,
        # and strip a comment, so the re-run has both kinds of repair to make.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"ALTER TABLE coord.{_PARENT_TABLE} "
                    f"DROP CONSTRAINT {_CHECKS[_PARENT_TABLE]}"
                )
            )
            conn.execute(
                text(
                    f"ALTER TABLE coord.{_PARENT_TABLE} "
                    f"ADD CONSTRAINT {_CHECKS[_PARENT_TABLE]} "
                    f"CHECK ({_TRACKING_COLUMN} IN ('{_ILLEGAL_TRACKING}', 'track'))"
                )
            )
            conn.execute(
                text(
                    f"COMMENT ON COLUMN coord.{_PARENT_TABLE}.{_VERSION_COLUMN} IS NULL"
                )
            )

        module = load_revision_module(_revision_path(), "pdpub_02_rerun")
        with engine.begin() as conn:
            context = MigrationContext.configure(conn)
            with Operations.context(context):
                module.upgrade()

        # The wrong definition is gone: the illegal value is refused again and
        # both legal ones still pass.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE coord.{_PARENT_TABLE} SET {_TRACKING_COLUMN} = :v "
                        "WHERE id = :id"
                    ),
                    {"v": _ILLEGAL_TRACKING, "id": document_id},
                )
        for legal in _LEGAL_TRACKING:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE coord.{_PARENT_TABLE} SET {_TRACKING_COLUMN} = :v "
                        "WHERE id = :id"
                    ),
                    {"v": legal, "id": document_id},
                )

        assert column_comment(
            engine, _PARENT_TABLE, _VERSION_COLUMN
        ) == comment_body_from_source(
            source, f"coord.{_PARENT_TABLE}.{_VERSION_COLUMN}"
        )


@_needs_pg
def test_up_down_up_keeps_every_row_and_loses_only_the_documented_state() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub02_reverse") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        document_id = _seed_document(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    UPDATE coord.{_PARENT_TABLE}
                       SET {_TRACKING_COLUMN} = 'pinned', {_VERSION_COLUMN} = 7
                     WHERE id = :id
                    """
                ),
                {"id": document_id},
            )
        assert _tracking_of(engine, document_id) == ("pinned", 7)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        for table in _TABLES:
            assert column_info(engine, table, _VERSION_COLUMN) is None
            assert column_info(engine, table, _TRACKING_COLUMN) is None
            assert not _has_constraint(engine, table, _CHECKS[table])

        # The downgrade touches COLUMNS, never rows.
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(f"SELECT count(*) FROM coord.{_PARENT_TABLE} WHERE id = :id"),
                    {"id": document_id},
                ).scalar()
                == 1
            )
            assert (
                conn.execute(
                    text(
                        f"SELECT count(*) FROM coord.{_VERSIONS_TABLE} "
                        "WHERE document_id = :id"
                    ),
                    {"id": document_id},
                ).scalar()
                == 1
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in _TABLES:
            assert column_info(engine, table, _TRACKING_COLUMN) is not None
            assert _has_constraint(engine, table, _CHECKS[table])

        # Lossy in exactly the documented DIRECTION: 'pinned' comes back 'track'
        # and the tracked version is gone, so every row reads as having no
        # upstream. Under D3's degrade polarity that is local_modified = true,
        # which resolves to NOTIFY, never to adopt. A downgrade that preserved a
        # stale version number would point the other way — at an adopt against a
        # baseline nothing can resolve.
        assert _tracking_of(engine, document_id) == ("track", None)
