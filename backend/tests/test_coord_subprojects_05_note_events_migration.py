"""Behaviour test for the ``coord_subprojects_05_note_events`` revision.

Phase 3 of plan
``2026-11-22-subproject-next-steps-note-refuses-scheduled-buckets-and-keeps-history``.
The revision creates ``coord.subproject_note_events``, the append-only history of
``coord.subprojects.next_steps_note``. Its shape is the contract coord's Phase 4
writer (``subprojects/note_events.rs``) is built against, so this module pins it.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent (read through the head gate's own parser) names exactly one real
   revision, and the docstring's ``Revision ID:`` / ``Revises:`` header agrees.
2. **Every statement is ONE static, ``coord.``-qualified SQL literal, and the
   only DROPs are in ``downgrade()``** — the upgrade path is also checked with
   ``check_coord_column_drops``'s own scanner.
3. **The table, its comment and its index are built in ONE transaction**, in
   the declared order: no ``autocommit_block()``, no ``CONCURRENTLY``, no
   ``op.get_bind()`` read.

Against a real Postgres (skipped when none is reachable — a skip proves
nothing; set ``DATABASE_URL`` to an admin URL of a test Postgres):

4. **Upgrade creates the declared shape**: every column's name, order, type,
   nullability and default; ``id`` an ALWAYS identity; the primary key and the
   NO ACTION foreign key by exact definition; the index valid with its exact
   definition; the table comment.
5. **A minimal insert** gets an identity id and a ``written_at`` equal to the
   transaction's ``now()`` — the instant coord also stamps on the subproject
   row's ``next_steps_note_at`` in the same transaction.
6. **The foreign key refuses** a row for an unknown subproject, and refuses
   deleting a subproject whose history the ledger holds.
7. **Downgrade removes the table and its index, and a re-upgrade restores
   them.**
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_subprojects_05_note_events"
_PARENT_REVISION_ID = "coord_conditions_02_honest_runs"
_REVISION_FILENAME = "coord_subprojects_05_note_events.py"

_SCHEMA = "coord"
_TABLE = "subproject_note_events"
_INDEX = "idx_subproject_note_events_tenant_subproject_written"
_TIMESTAMPTZ = "timestamp with time zone"

# (name, information_schema data_type, nullable, default substring or None), in
# the contract's declaration order. ``id``'s identity is checked separately.
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "bigint", False, None),
    ("tenant_id", "uuid", False, None),
    ("subproject_id", "uuid", False, None),
    ("written_at", _TIMESTAMPTZ, False, "now()"),
    ("written_by", "text", False, None),
    ("note", "text", True, None),
    ("prior_note", "text", True, None),
    ("prior_note_by", "text", True, None),
    ("prior_note_at", _TIMESTAMPTZ, True, None),
)

# Every constraint, by name -> pg_get_constraintdef. There is no CHECK.
_CONSTRAINTS: dict[str, str] = {
    "subproject_note_events_pkey": "PRIMARY KEY (id)",
    "fk_subproject_note_events_subproject": (
        "FOREIGN KEY (subproject_id) REFERENCES coord.subprojects(id)"
    ),
}

_UPGRADE_STATEMENTS: tuple[str, ...] = (
    "CREATE TABLE IF NOT EXISTS coord.subproject_note_events (",
    "COMMENT ON TABLE coord.subproject_note_events IS",
    f"CREATE INDEX IF NOT EXISTS {_INDEX} ON coord.subproject_note_events (",
)

_DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    f"DROP INDEX IF EXISTS coord.{_INDEX}",
    "DROP TABLE IF EXISTS coord.subproject_note_events",
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, bring one up or set DATABASE_URL."
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _collapsed(sql: str | None) -> str:
    """``sql`` with every whitespace run collapsed to one space."""
    assert sql is not None, "every op.execute takes ONE static string literal"
    return " ".join(sql.split())


# ---------------------------------------------------------------------------
# 1-3. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_revision() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    assert (
        declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
        == _PARENT_REVISION_ID
    ), "the head gate's own parser must read the same parent"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    parents = [
        f.name
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(parents) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {parents})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_statement_is_static_coord_sql_and_drops_live_in_downgrade() -> None:
    for call in upgrade_execute_calls(_revision_path()):
        sql = _collapsed(call.sql)
        assert " coord." in f" {sql}", sql
        assert "DROP" not in sql.upper(), sql
    downgrade_calls = upgrade_execute_calls(_revision_path(), function="downgrade")
    assert tuple(_collapsed(c.sql) for c in downgrade_calls) == _DOWNGRADE_STATEMENTS

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_table_comment_and_index_are_built_in_one_transaction() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert len(calls) == len(_UPGRADE_STATEMENTS), [_collapsed(c.sql) for c in calls]
    for call, head in zip(calls, _UPGRADE_STATEMENTS, strict=True):
        sql = _collapsed(call.sql)
        assert sql.startswith(head), (head, call.sql)
        assert "CONCURRENTLY" not in sql.upper(), sql
        assert call.in_autocommit_block is False, head

    tree = ast.parse(_revision_source())
    upgrade = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    assert not [n for n in ast.walk(upgrade) if isinstance(n, ast.With)]
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "get_bind" not in attrs, "coord's migration classifier rejects bind reads"


# ---------------------------------------------------------------------------
# 4-7. real Postgres
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def note_events_db() -> Iterator[Engine]:
    """One ephemeral database upgraded to the revision, shared by tests 4-6."""
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "coord_sp05") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


def _new_subproject(engine: Engine, tenant: str) -> str:
    with engine.begin() as conn:
        return str(
            conn.execute(
                text(
                    """
                    INSERT INTO coord.subprojects (tenant_id, slug, title, origin)
                    VALUES (:t, :slug, 'a subproject', 'operator_prompt')
                    RETURNING id
                    """
                ),
                {"t": tenant, "slug": f"sp-{uuid.uuid4().hex[:12]}"},
            ).scalar_one()
        )


@_needs_pg
def test_upgrade_creates_every_column_in_contract_order(
    note_events_db: Engine,
) -> None:
    with note_events_db.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default,
                       is_identity, identity_generation
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :t
                 ORDER BY ordinal_position
                """
            ),
            {"t": _TABLE},
        ).all()
    assert [r.column_name for r in rows] == [c[0] for c in _COLUMNS]
    for row, (name, data_type, nullable, default) in zip(rows, _COLUMNS, strict=True):
        assert row.data_type == data_type, (name, row)
        assert (row.is_nullable == "YES") is nullable, (name, row)
        if default is None:
            assert row.column_default is None, (name, row)
        else:
            assert default in (row.column_default or ""), (name, row)
        if name == "id":
            assert row.is_identity == "YES", row
            assert row.identity_generation == "ALWAYS", row
        else:
            assert row.is_identity == "NO", (name, row)


@_needs_pg
def test_upgrade_creates_the_keys_index_and_comment(note_events_db: Engine) -> None:
    with note_events_db.connect() as conn:
        constraints = {
            r.conname: (r.condef, r.confdeltype, r.confupdtype)
            for r in conn.execute(
                text(
                    """
                    SELECT conname, pg_get_constraintdef(oid) AS condef,
                           confdeltype, confupdtype
                      FROM pg_constraint
                     WHERE conrelid = to_regclass('coord.subproject_note_events')
                    """
                )
            )
        }
        index = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid) AS indexdef, i.indisvalid
                  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :name
                """
            ),
            {"name": _INDEX},
        ).one()
        comment = conn.execute(
            text(
                "SELECT obj_description(to_regclass('coord.subproject_note_events'), "
                "'pg_class')"
            )
        ).scalar_one()

    assert {k: v[0] for k, v in constraints.items()} == _CONSTRAINTS
    fk = constraints["fk_subproject_note_events_subproject"]
    assert fk[1:] == ("a", "a"), "the foreign key is NO ACTION on delete and update"
    assert index.indisvalid is True
    assert index.indexdef == (
        f"CREATE INDEX {_INDEX} ON coord.subproject_note_events USING btree "
        "(tenant_id, subproject_id, written_at DESC)"
    )
    assert comment and "next_steps_note" in comment


@_needs_pg
def test_a_minimal_insert_gets_an_identity_and_the_transaction_now(
    note_events_db: Engine,
) -> None:
    tenant = str(uuid.uuid4())
    subproject = _new_subproject(note_events_db, tenant)
    with note_events_db.begin() as conn:
        row = conn.execute(
            text(
                """
                INSERT INTO coord.subproject_note_events
                    (tenant_id, subproject_id, written_by)
                VALUES (:t, :s, 'operator')
                RETURNING id, written_at, written_at = now() AS is_txn_now,
                          note, prior_note, prior_note_by, prior_note_at
                """
            ),
            {"t": tenant, "s": subproject},
        ).one()
    assert isinstance(row.id, int)
    assert row.is_txn_now is True
    assert (row.note, row.prior_note, row.prior_note_by, row.prior_note_at) == (
        None,
        None,
        None,
        None,
    )


@_needs_pg
def test_the_foreign_key_refuses_an_unknown_subproject_and_an_orphaning_delete(
    note_events_db: Engine,
) -> None:
    tenant = str(uuid.uuid4())
    with pytest.raises(IntegrityError) as excinfo:
        with note_events_db.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.subproject_note_events
                        (tenant_id, subproject_id, written_by, note)
                    VALUES (:t, :s, 'operator', 'n')
                    """
                ),
                {"t": tenant, "s": str(uuid.uuid4())},
            )
    assert excinfo.value.orig.diag.constraint_name == (  # type: ignore[union-attr]
        "fk_subproject_note_events_subproject"
    )

    subproject = _new_subproject(note_events_db, tenant)
    with note_events_db.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.subproject_note_events
                    (tenant_id, subproject_id, written_by, note)
                VALUES (:t, :s, 'operator', 'n')
                """
            ),
            {"t": tenant, "s": subproject},
        )
    with pytest.raises(IntegrityError) as excinfo:
        with note_events_db.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.subprojects WHERE id = :s"), {"s": subproject}
            )
    assert excinfo.value.orig.diag.constraint_name == (  # type: ignore[union-attr]
        "fk_subproject_note_events_subproject"
    )


@_needs_pg
def test_downgrade_removes_the_table_and_re_upgrade_restores_it() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_sp05d") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _INDEX)
        assert table_exists(engine, _SCHEMA, "subprojects"), "the parent table stays"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX)
