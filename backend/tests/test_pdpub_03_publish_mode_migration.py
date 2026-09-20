"""Schema, data and round-trip test for the ``pdpub_03`` revision.

Phase 1 of plan ``2026-09-19-policy-publish-all-and-auto-publish`` adds D2's
``publish_mode`` — ``auto`` / ``manual`` / ``never`` / ``NULL`` — to **both**
``coord.prompt_documents`` and ``coord.prompt_document_versions``.

Why this file exists
====================

The same reason ``test_pdpub_02`` and ``test_pdtier_01`` exist, and one more.

``migration-reversal.yml`` walks the chain against an **empty** database, so it
proves the SQL parses and nothing else. No row exists there to survive a
round-trip, and it asserts nothing about which table gained which column.

The extra reason is the column's meaning. ``publish_mode`` decides whether a
document distributes itself to every tenant in the fleet with no human action in
the loop, and its three failure modes are all silent ones: a column present on
the parent but missing from the snapshot (a restore that quietly re-decides the
question), a CHECK that does not actually constrain the vocabulary (a text
column with a docstring), and a default or backfill that rules on documents
nobody has ruled on. None of the three raises anything at migration time.

What is asserted, and why each one can fail silently otherwise
==============================================================

1. **Both tables get the column, asserted symmetrically.** D2 puts
   ``publish_mode`` on the VERSIONING path — setting it cuts a version — so the
   snapshot has to be able to hold it. A parent-only widening produces no error;
   it produces a version row that reports as a complete snapshot while omitting
   the authority decision in force at that version.
2. **The exact type, nullability and — critically — the ABSENCE of a default.**
   ``NULL`` is the undecided state. A ``DEFAULT 'auto'`` would opt the entire
   corpus into publishing itself in one statement; a ``DEFAULT 'never'`` would
   freeze the channel shut and hide that nobody had decided. Neither raises.
   ``ADD COLUMN IF NOT EXISTS`` matches on NAME ALONE and is type-blind, so a
   re-typed column is invisible to the DDL and has to be read back.
3. **The CHECK rejects a value outside the vocabulary on both tables, accepts
   all three legal values, and still accepts NULL.** The ``IS NULL`` arm is the
   contract that "unset is legal" — the state the whole conservative default
   rests on — and a CHECK that had lost it would make the column unset-hostile
   in a way no code path expects.
4. **Pre-existing rows come out NULL**, i.e. UNDECIDED, on both tables. This is
   the no-backfill claim, and it is the one the empty-database reversal gate
   structurally cannot reach.
5. **Both comments land, compared against the revision's own source.** The
   snapshot column's comment carries the settle-clock consequence — a
   ``publish_mode`` write cuts a version whose body is IDENTICAL to its
   predecessor's, so a clock keyed on the newest version lets a mode flip reset
   the wait it was meant to let run out. That sentence is the whole reason the
   next repo's worker keys its clock the way it does, and a mangled
   ``COMMENT ON`` raises nothing.
6. **``upgrade()`` re-runs, and its drop-then-add pair really does REPAIR a
   CHECK added under a different definition.** That is the stated reason the
   revision does not declare the constraint inline, and alembic will not re-run
   an applied revision for you.
7. **Up → down → up: the column and CHECKs go and come back, and no ROW is
   destroyed in either direction.**
8. **The downgrade is lossy in exactly the documented DIRECTION.** An ``auto``
   document comes back ``NULL``, not ``auto``. The direction is the point: every
   row returning as undecided distributes nothing until it is ruled on again,
   whereas a downgrade that somehow preserved ``auto`` would leave documents
   publishing themselves under a decision no longer visible anywhere.

Also asserted without a database: the pinned parent equals the revision's own
``down_revision``; ``scripts/ci/check_coord_column_drops.py`` reads the upgrade
path as dropping nothing (the revision builds its ``DROP COLUMN`` statements
inside ``downgrade()`` for exactly that reason); and every ``ALTER TABLE`` the
module spells is schema-qualified, which is
``.pre-commit-hooks/check_alembic_schema_args.py``'s rule — restated here
because that hook can only audit ``op.execute`` arguments it can read as
constants, so a formatted ALTER passes it vacuously.

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
_REVISION_ID = "pdpub_03"
_PARENT_REVISION_ID = "plan_library_07_plan_difficulty"
_REVISION_FILENAME = "pdpub_03_prompt_document_publish_mode.py"

_PARENT_TABLE = "prompt_documents"
_VERSIONS_TABLE = "prompt_document_versions"
_TABLES = (_PARENT_TABLE, _VERSIONS_TABLE)

_PUBLISH_MODE_COLUMN = "publish_mode"

_CHECKS = {
    _PARENT_TABLE: "ck_prompt_documents_publish_mode",
    _VERSIONS_TABLE: "ck_prompt_document_versions_publish_mode",
}

# Spelled as LITERALS rather than read from the revision's `_PUBLISH_MODES`, so
# narrowing or widening the vocabulary reddens this test instead of moving with
# it. Widening it is exactly the change that needs a human to look.
_LEGAL_MODES = ("auto", "manual", "never")
_ILLEGAL_MODE = "sometimes"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _seed_document(engine: Engine, *, name: str = "coordination") -> uuid.UUID:
    """One document plus its version-1 snapshot, using only pre-``pdpub_03`` columns.

    Deliberately written against the parent revision's shape so it can be called
    BEFORE the upgrade — which is the only way to observe what the new column
    does to rows that already exist.
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


def _mode_column_of(
    engine: Engine, table: str, where: str, key: uuid.UUID
) -> str | None:
    """``publish_mode`` for one row, narrowed rather than returned as ``Any``.

    The ``isinstance`` is not ceremony: ``scalar_one`` would happily return an
    int or a memoryview if the column were ever re-typed, and the assertions
    downstream compare against ``None`` and three strings, so a wrong type would
    read as "the mode is not what we set" rather than as "the column is not
    text".
    """
    with engine.connect() as conn:
        value = conn.execute(
            text(
                f"""
                SELECT {_PUBLISH_MODE_COLUMN}
                  FROM coord.{table} WHERE {where} = :id
                """
            ),
            {"id": key},
        ).scalar_one()
    assert value is None or isinstance(value, str), (
        f"coord.{table}.{_PUBLISH_MODE_COLUMN} read back as {type(value).__name__}"
    )
    return value


def _mode_of(engine: Engine, document_id: uuid.UUID) -> str | None:
    return _mode_column_of(engine, _PARENT_TABLE, "id", document_id)


def _snapshot_mode_of(engine: Engine, document_id: uuid.UUID) -> str | None:
    return _mode_column_of(engine, _VERSIONS_TABLE, "document_id", document_id)


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
# 1. source-only: the pin, the drop guard, and the schema-arg rule
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
    ``downgrade()`` body. ``pdpub_03`` builds its ``DROP COLUMN`` statements
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


def test_every_alter_table_in_the_revision_is_schema_qualified() -> None:
    """``check_alembic_schema_args.py``'s rule, restated non-vacuously.

    That hook audits raw SQL only inside an ``op.execute`` whose argument it can
    read as a CONSTANT — every formatted or looped statement is skipped in
    silence. This revision's CHECK and DROP statements are f-strings, so the
    hook never sees them; an unqualified ``ALTER TABLE prompt_documents`` there
    would resolve against ``search_path`` at apply time (usually ``public``) and
    the hook would still pass the file. Read the source directly instead.
    """
    source = _revision_source()
    unqualified = [
        match.group(0)
        for match in re.finditer(
            r"ALTER\s+TABLE\s+(?!\{)(?P<ident>[\w.]+)", source, re.I
        )
        if "." not in match.group("ident")
    ]
    assert not unqualified, (
        "these ALTER TABLE statements name an unqualified table, which resolves "
        f"against search_path at apply time: {unqualified}"
    )
    # And the ones built from `_TABLES` are qualified because that list is.
    assert re.search(
        r'_TABLES: tuple\[str, \.\.\.\] = \(\s*"coord\.prompt_documents",\s*'
        r'"coord\.prompt_document_versions",\s*\)',
        source,
    ), "the `_TABLES` list is no longer two schema-qualified coord tables"


# ---------------------------------------------------------------------------
# 2. the shape, on BOTH tables
# ---------------------------------------------------------------------------


@_needs_pg
def test_both_tables_get_the_column_with_no_default() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub03_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in _TABLES:
            info = column_info(engine, table, _PUBLISH_MODE_COLUMN)
            assert info is not None, f"coord.{table}.{_PUBLISH_MODE_COLUMN} is absent"
            assert info[0] == "text", f"{table}: {info[0]} != text"
            assert info[1] == "YES", (
                f"{table}.{_PUBLISH_MODE_COLUMN} must stay nullable — NULL is "
                "the meaningful UNDECIDED state, not a missing value"
            )
            assert info[2] is None, (
                f"{table}.{_PUBLISH_MODE_COLUMN} gained a default ({info[2]!r}); "
                "a default rules on every document nobody has ruled on"
            )

            assert _has_constraint(engine, table, _CHECKS[table])


@_needs_pg
def test_the_check_enforces_the_vocabulary_and_still_admits_unset() -> None:
    """A vocabulary column with no enforcing constraint is a text column with a docstring."""
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub03_check") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        document_id = _seed_document(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        parent_update = text(
            f"UPDATE coord.{_PARENT_TABLE} SET {_PUBLISH_MODE_COLUMN} = :v "
            "WHERE id = :id"
        )
        versions_update = text(
            f"UPDATE coord.{_VERSIONS_TABLE} SET {_PUBLISH_MODE_COLUMN} = :v "
            "WHERE document_id = :id"
        )

        for statement in (parent_update, versions_update):
            for legal in _LEGAL_MODES:
                with engine.begin() as conn:
                    conn.execute(statement, {"v": legal, "id": document_id})

            # Unset stays legal — the whole conservative default rests on a
            # document being able to say nothing at all.
            with engine.begin() as conn:
                conn.execute(statement, {"v": None, "id": document_id})

            with pytest.raises(sqlalchemy.exc.IntegrityError):
                with engine.begin() as conn:
                    conn.execute(statement, {"v": _ILLEGAL_MODE, "id": document_id})


@_needs_pg
def test_rows_that_already_existed_come_out_undecided() -> None:
    """The no-backfill claim, which the empty-database reversal gate cannot reach.

    Every pre-existing document arrives UNDECIDED rather than opted in or opted
    out, because nobody has ruled on it and the schema must not rule for them.
    """
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub03_existing") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        document_id = _seed_document(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert _mode_of(engine, document_id) is None
        assert _snapshot_mode_of(engine, document_id) is None


@_needs_pg
def test_the_comments_land_verbatim_from_the_revision_source() -> None:
    admin_url = admin_database_url()
    source = _revision_source()
    with ephemeral_database(admin_url, "pdpub03_comments") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in _TABLES:
            assert column_comment(
                engine, table, _PUBLISH_MODE_COLUMN
            ) == comment_body_from_source(
                source, f"coord.{table}.{_PUBLISH_MODE_COLUMN}"
            ), (
                f"coord.{table}.{_PUBLISH_MODE_COLUMN}'s comment does not match its author"
            )

        # The sentence the next repo's settle clock depends on. Read back from
        # the DATABASE, not the source, so a comment that failed to land fails
        # here rather than passing a source-to-source comparison.
        snapshot_comment = column_comment(engine, _VERSIONS_TABLE, _PUBLISH_MODE_COLUMN)
        assert snapshot_comment is not None
        assert "IDENTICAL to its predecessor's" in snapshot_comment, (
            "the snapshot comment no longer states that a publish_mode write "
            "cuts a body-identical version — the fact a settle clock keyed on "
            "the newest version would get wrong"
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
    with ephemeral_database(admin_url, "pdpub03_rerun") as (engine, db_url):
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
                    f"CHECK ({_PUBLISH_MODE_COLUMN} IS NULL OR "
                    f"{_PUBLISH_MODE_COLUMN} IN ('{_ILLEGAL_MODE}', 'auto'))"
                )
            )
            conn.execute(
                text(
                    f"COMMENT ON COLUMN "
                    f"coord.{_PARENT_TABLE}.{_PUBLISH_MODE_COLUMN} IS NULL"
                )
            )

        module = load_revision_module(_revision_path(), "pdpub_03_rerun")
        with engine.begin() as conn:
            context = MigrationContext.configure(conn)
            with Operations.context(context):
                module.upgrade()

        # The wrong definition is gone: the illegal value is refused again and
        # every legal one still passes.
        update = text(
            f"UPDATE coord.{_PARENT_TABLE} SET {_PUBLISH_MODE_COLUMN} = :v "
            "WHERE id = :id"
        )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            with engine.begin() as conn:
                conn.execute(update, {"v": _ILLEGAL_MODE, "id": document_id})
        for legal in _LEGAL_MODES:
            with engine.begin() as conn:
                conn.execute(update, {"v": legal, "id": document_id})

        assert column_comment(
            engine, _PARENT_TABLE, _PUBLISH_MODE_COLUMN
        ) == comment_body_from_source(
            source, f"coord.{_PARENT_TABLE}.{_PUBLISH_MODE_COLUMN}"
        )


@_needs_pg
def test_up_down_up_keeps_every_row_and_loses_only_the_documented_state() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub03_reverse") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        document_id = _seed_document(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_PARENT_TABLE} "
                    f"SET {_PUBLISH_MODE_COLUMN} = 'auto' WHERE id = :id"
                ),
                {"id": document_id},
            )
            conn.execute(
                text(
                    f"UPDATE coord.{_VERSIONS_TABLE} "
                    f"SET {_PUBLISH_MODE_COLUMN} = 'auto' WHERE document_id = :id"
                ),
                {"id": document_id},
            )
        assert _mode_of(engine, document_id) == "auto"
        assert _snapshot_mode_of(engine, document_id) == "auto"

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        for table in _TABLES:
            assert column_info(engine, table, _PUBLISH_MODE_COLUMN) is None
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
            assert column_info(engine, table, _PUBLISH_MODE_COLUMN) is not None
            assert _has_constraint(engine, table, _CHECKS[table])

        # Lossy in exactly the documented DIRECTION: an 'auto' document comes
        # back UNDECIDED, not 'auto'. Every row returning as undecided
        # distributes nothing until it is ruled on again; a downgrade that
        # preserved 'auto' would leave documents publishing themselves under a
        # decision no longer visible anywhere.
        assert _mode_of(engine, document_id) is None
        assert _snapshot_mode_of(engine, document_id) is None
