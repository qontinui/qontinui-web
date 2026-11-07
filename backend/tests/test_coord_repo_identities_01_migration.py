"""Behaviour test for the ``coord_repo_identities_01`` revision.

Pins the contract coord's enrollment write, ``repository`` webhook arm and
identity sweep (plan ``2026-11-02-coord-follows-a-repository-rename-or-transfer``
Phase 4) rely on:

1. **Shape**: the exact columns, every constraint by name and definition, the
   ``lower(repo)`` index by its exact definition, and the table comment. All of
   it is gone after downgrade.
2. **Contract**: ``observed_at`` defaults to now; a blank ``repo`` and a
   non-positive id are refused; a second row for one id is refused (primary
   key); two ids may share a name (the name index is not unique).
3. **Re-running is harmless**: with rows present, ``stamp <parent>`` then
   ``upgrade`` again changes nothing (every statement is ``IF NOT EXISTS``).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

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

_REVISION_ID = "coord_repo_identities_01"
_REVISION_FILENAME = "coord_repo_identities_01.py"
_TABLE = "repo_identities"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "github_repo_id": ("bigint", "NO"),
    "repo": ("text", "NO"),
    "observed_at": ("timestamp with time zone", "NO"),
}

_EXPECTED_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "repo_identities_pkey": ("p", "PRIMARY KEY (github_repo_id)"),
    "ck_repo_identities_github_repo_id_positive": (
        "c",
        "CHECK ((github_repo_id > 0))",
    ),
    "ck_repo_identities_repo_nonblank": ("c", "CHECK ((btrim(repo) <> ''::text))"),
}

_EXPECTED_INDEXES: dict[str, str] = {
    "repo_identities_pkey": (
        "CREATE UNIQUE INDEX repo_identities_pkey ON coord.repo_identities "
        "USING btree (github_repo_id)"
    ),
    "ix_repo_identities_repo_lower": (
        "CREATE INDEX ix_repo_identities_repo_lower ON coord.repo_identities "
        "USING btree (lower(repo))"
    ),
}

_INSERT = text(
    "INSERT INTO coord.repo_identities (github_repo_id, repo) VALUES (:id, :repo)"
)


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
                SELECT indexname, indexdef
                  FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine) == _EXPECTED_COLUMNS
    assert _constraints(engine) == _EXPECTED_CONSTRAINTS
    assert _indexes(engine) == _EXPECTED_INDEXES
    with engine.connect() as conn:
        comment = conn.execute(
            text(
                "SELECT obj_description(to_regclass('coord.repo_identities'), 'pg_class')"
            )
        ).scalar_one()
    assert comment and "2026-11-02-coord-follows-a-repository-rename" in comment


def _assert_absent(engine: Engine) -> None:
    assert not table_exists(engine, "coord", _TABLE), "coord.repo_identities is present"
    assert _indexes(engine) == {}, "coord.repo_identities left indexes behind"


def _count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM coord.repo_identities")
            ).scalar_one()
        )


def _insert(engine: Engine, github_repo_id: int, repo: str) -> None:
    with engine.begin() as conn:
        conn.execute(_INSERT, {"id": github_repo_id, "repo": repo})


def _refused(engine: Engine, github_repo_id: int, repo: str, constraint: str) -> None:
    """The insert is refused, and by the named constraint, not by another one."""
    with pytest.raises(IntegrityError) as refusal, engine.begin() as conn:
        conn.execute(_INSERT, {"id": github_repo_id, "repo": repo})
    refused_by = getattr(
        getattr(refusal.value.orig, "diag", None), "constraint_name", None
    )
    assert refused_by == constraint, (
        f"refused by {refused_by!r}, expected {constraint!r}"
    )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coord_repo_identities_01_creates_the_table_and_enforces_its_contract() -> None:
    """Shape, contract, re-run, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "repoidentities01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: the table does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 2. Apply: exact columns, constraints, indexes and table comment.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # 3. A row needs only id and name; observed_at defaults to now.
        _insert(engine, 1_234_567_890_123, "jspinak/qontinui-web")
        with engine.connect() as conn:
            observed = conn.execute(
                text(
                    "SELECT observed_at IS NOT NULL AND observed_at <= now() "
                    "FROM coord.repo_identities"
                )
            ).scalar_one()
        assert observed is True

        # 4. One row per id; a blank name and a non-positive id are refused.
        _refused(engine, 1_234_567_890_123, "jspinak/other", "repo_identities_pkey")
        _refused(engine, 42, "  ", "ck_repo_identities_repo_nonblank")
        _refused(
            engine, 0, "jspinak/zero", "ck_repo_identities_github_repo_id_positive"
        )

        # 5. Two ids may share a name (a stale row beside a newer repo), and the
        #    case-insensitive lookup finds both.
        _insert(engine, 43, "JSpinak/Qontinui-Web")
        with engine.connect() as conn:
            hits = conn.execute(
                text(
                    "SELECT count(*) FROM coord.repo_identities "
                    "WHERE lower(repo) = lower('jspinak/qontinui-web')"
                )
            ).scalar_one()
        assert hits == 2

        # 6. Re-running is harmless: rewind the stamp and apply again.
        rows_before = _count(engine)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert _count(engine) == rows_before

        # 7. Downgrade: the table, its constraints and index are gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 8. Re-apply: the downgrade left no residue.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
