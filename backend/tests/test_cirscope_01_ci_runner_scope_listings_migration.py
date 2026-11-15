"""Behaviour test for the ``cirscope_01_ci_runner_scope_listings`` revision.

Pins the contract coord's CI-runner registrar and fleet roster (plan
``2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console``
Phase 2) rely on:

1. **Shape** — exactly three columns, all NOT NULL, ``scope`` the primary key,
   no other constraint or index, and a table comment; all gone after downgrade.
2. **No defaults** — omitting ``listed_names`` or ``listed_at`` is refused, so
   no row can carry evidence a listing did not produce.
3. **One row per scope** — a second insert for the same scope is refused; an
   upsert replaces the names and time; an empty name list is accepted.
4. **Re-running is harmless** — with a row present, ``stamp <parent>`` then
   ``upgrade`` again changes nothing.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

from datetime import UTC, datetime

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
    run_alembic,
    table_exists,
)

_REVISION_ID = "cirscope_01_ci_runner_scope_listings"
_REVISION_FILENAME = "cirscope_01_ci_runner_scope_listings.py"
_TABLE = "ci_runner_scope_listings"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_EXPECTED_COLUMNS = {
    "scope": ("text", "NO"),
    "listed_names": ("ARRAY", "NO"),
    "listed_at": ("timestamp with time zone", "NO"),
}
_EXPECTED_CONSTRAINTS = {
    "ci_runner_scope_listings_pkey": ("p", "PRIMARY KEY (scope)"),
}
_EXPECTED_INDEXES = {
    "ci_runner_scope_listings_pkey": (
        "CREATE UNIQUE INDEX ci_runner_scope_listings_pkey "
        "ON coord.ci_runner_scope_listings USING btree (scope)"
    ),
}

_T1 = datetime(2026, 11, 15, 10, 0, tzinfo=UTC)
_T2 = datetime(2026, 11, 15, 10, 5, tzinfo=UTC)


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _column_defaults(engine: Engine) -> dict[str, object]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {str(name): default for name, default in rows}


def _constraints(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype::text, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = to_regclass('coord.' || :table)
                   AND contype <> 'n'
                """
            ),
            {"table": _TABLE},
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _indexes(engine: Engine) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _table_comment(engine: Engine) -> str | None:
    with engine.connect() as conn:
        comment = conn.execute(
            text("SELECT obj_description(to_regclass('coord.' || :table), 'pg_class')"),
            {"table": _TABLE},
        ).scalar_one()
    return None if comment is None else str(comment)


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine) == _EXPECTED_COLUMNS
    assert _column_defaults(engine) == {
        "scope": None,
        "listed_names": None,
        "listed_at": None,
    }
    assert _constraints(engine) == _EXPECTED_CONSTRAINTS
    assert _indexes(engine) == _EXPECTED_INDEXES
    comment = _table_comment(engine)
    assert comment is not None and "COMPLETE" in comment
    assert "UNKNOWN" in comment


def _assert_absent(engine: Engine) -> None:
    assert not table_exists(engine, "coord", _TABLE), f"coord.{_TABLE} is present"
    assert _indexes(engine) == {}, f"coord.{_TABLE} left indexes behind"


def _execute(engine: Engine, sql: str, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


_SCOPES = ("org:o", "repo:o/r")


def _rows(engine: Engine) -> list[tuple[str, list[str], datetime]]:
    """The rows for the scopes this test writes — scoped, never the whole table."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT scope, listed_names, listed_at "
                "FROM coord.ci_runner_scope_listings "
                "WHERE scope = ANY(:scopes) ORDER BY scope"
            ),
            {"scopes": list(_SCOPES)},
        ).all()
    return [(scope, list(names), listed_at) for scope, names, listed_at in rows]


_INSERT = (
    "INSERT INTO coord.ci_runner_scope_listings (scope, listed_names, listed_at) "
    "VALUES (:scope, :names, :at)"
)
_UPSERT = (
    _INSERT + " ON CONFLICT (scope) DO UPDATE "
    "SET listed_names = EXCLUDED.listed_names, listed_at = EXCLUDED.listed_at"
)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_cirscope_01_creates_the_scope_listing_table_and_enforces_its_contract() -> (
    None
):
    """Shape, no defaults, one row per scope, re-run, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "cirscope01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the table does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 2. Apply — exact columns, constraint, index, comment.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # 3. No defaults: a row missing either evidence column is refused.
        with pytest.raises(IntegrityError):
            _execute(
                engine,
                "INSERT INTO coord.ci_runner_scope_listings (scope, listed_at) "
                "VALUES ('repo:o/r', now())",
                {},
            )
        with pytest.raises(IntegrityError):
            _execute(
                engine,
                "INSERT INTO coord.ci_runner_scope_listings (scope, listed_names) "
                "VALUES ('repo:o/r', '{}')",
                {},
            )

        # 4. One row per scope; an upsert replaces; an empty list is a real answer.
        _execute(engine, _INSERT, {"scope": "repo:o/r", "names": ["a", "b"], "at": _T1})
        with pytest.raises(IntegrityError):
            _execute(engine, _INSERT, {"scope": "repo:o/r", "names": ["a"], "at": _T2})
        _execute(engine, _UPSERT, {"scope": "repo:o/r", "names": ["b"], "at": _T2})
        _execute(engine, _INSERT, {"scope": "org:o", "names": [], "at": _T1})
        assert _rows(engine) == [
            ("org:o", [], _T1),
            ("repo:o/r", ["b"], _T2),
        ]

        # 5. Re-running is harmless with rows present.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert _rows(engine) == [
            ("org:o", [], _T1),
            ("repo:o/r", ["b"], _T2),
        ]

        # 6. Downgrade — the table and its index are gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 7. Re-apply — the downgrade left no residue.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
