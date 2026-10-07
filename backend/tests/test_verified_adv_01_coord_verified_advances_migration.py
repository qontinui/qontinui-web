"""Behaviour test for the ``verified_adv_01_coord_verified_advances`` revision.

Pins the contract coord's ``verified_ref`` evaluator writes against (plan
``2026-10-01-main-is-three-things-split-landed-from-verified`` Phase 1):

1. **Classifier shape** (static, no database) — every ``op.execute`` in
   ``upgrade()`` takes one static literal, the table is ``CREATE TABLE IF NOT
   EXISTS``, and the one index is ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``
   inside ``op.get_context().autocommit_block()``.
2. **Shape** — the table, its exact column contract, the named constraints,
   the table comment and the ``(repo, advanced_at DESC)`` index exist after
   upgrade and are gone after downgrade.
3. **basis vocabulary** is enforced by the schema.
4. **Idempotency key** — ``UNIQUE (repo, sha)`` refuses a duplicate and
   ``ON CONFLICT (repo, sha) DO NOTHING`` is a silent no-op.
5. **Defaults** — ``id``, ``evidence`` and ``advanced_at`` are server-generated.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

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
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REVISION_ID = "verified_adv_01_coord_verified_advances"
_REVISION_FILENAME = "verified_adv_01_coord_verified_advances.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLE = "verified_advances"
_INDEX = "verified_advances_repo_advanced_at_idx"

_CONSTRAINTS = {
    "ck_verified_advances_basis": "c",
    "uq_verified_advances_repo_sha": "u",
    "verified_advances_pkey": "p",
}

# The column contract shared with coord: name -> (data_type, nullable).
_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("bigint", "NO"),
    "tenant_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "sha": ("text", "NO"),
    "prev_sha": ("text", "YES"),
    "tree_sha": ("text", "YES"),
    "basis": ("text", "NO"),
    "evidence": ("jsonb", "NO"),
    "advanced_at": ("timestamp with time zone", "NO"),
}

_BASES = ("candidate", "pr_head", "main_push", "rerun", "path_inherited")

_TENANT = uuid.UUID("3b8f0a2e-6c41-4d9a-8e57-1f2c3d4e5a6b")
_REPO = "qontinui/qontinui-coord"

_INSERT = text(
    """
    INSERT INTO coord.verified_advances
        (tenant_id, repo, sha, prev_sha, tree_sha, basis)
    VALUES (:tid, :repo, :sha, :prev, :tree, :basis)
    """
)


def _sha() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex[:8]


def _row(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "repo": _REPO,
        "sha": _sha(),
        "prev": None,
        "tree": _sha(),
        "basis": "candidate",
    }
    params.update(overrides)
    return params


def _accepted(engine: Engine, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(_INSERT, params)


def _refused(engine: Engine, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(_INSERT, params)


def test_verified_adv_01_upgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: the call shapes qontinui-coord's migration_classifier admits."""
    calls = upgrade_execute_calls(
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    )
    assert calls, "upgrade() runs no op.execute"
    dynamic = [i for i, call in enumerate(calls) if call.sql is None]
    assert not dynamic, (
        f"op.execute call(s) {dynamic} in upgrade() do not take ONE inline static "
        "string literal — coord's classifier holds that as dynamic SQL"
    )
    statements = [(" ".join(c.sql.split()).upper(), c) for c in calls if c.sql]
    tables = [s for s, _ in statements if s.startswith("CREATE TABLE")]
    indexes = [(s, c) for s, c in statements if s.startswith("CREATE INDEX")]
    assert len(tables) == 1 and len(indexes) == 1, statements
    assert tables[0].startswith(
        "CREATE TABLE IF NOT EXISTS COORD.VERIFIED_ADVANCES ("
    ), tables[0]
    statement, call = indexes[0]
    assert statement.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), statement
    assert call.in_autocommit_block, (
        "the CONCURRENTLY build must sit inside op.get_context().autocommit_block()"
    )
    assert all(
        s.startswith("CREATE ") or s.startswith("COMMENT ON TABLE ")
        for s, _ in statements
    ), statements


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_verified_adv_01_creates_the_table_and_enforces_its_contract() -> None:
    """Shape, the basis vocabulary, the idempotency key, defaults, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "verifiedadv01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the table does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE), (
            "the table must be created by this revision, not an earlier one"
        )

        # 2. Apply — table, exact columns, named constraints, comment, index.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        with engine.connect() as conn:
            columns = {
                name: (dtype, nullable)
                for name, dtype, nullable in conn.execute(
                    text(
                        """
                        SELECT column_name, data_type, is_nullable
                          FROM information_schema.columns
                         WHERE table_schema = 'coord' AND table_name = :table
                        """
                    ),
                    {"table": _TABLE},
                ).all()
            }
            constraints = {
                name: str(kind)
                for name, kind in conn.execute(
                    text(
                        """
                        SELECT conname, contype
                          FROM pg_constraint
                         WHERE conrelid = 'coord.verified_advances'::regclass
                        """
                    )
                ).all()
            }
            comment = conn.execute(
                text("SELECT obj_description('coord.verified_advances'::regclass)")
            ).scalar_one()
            indexdef = conn.execute(
                text(
                    "SELECT indexdef FROM pg_indexes "
                    "WHERE schemaname = 'coord' AND indexname = :name"
                ),
                {"name": _INDEX},
            ).scalar_one()
            valid = conn.execute(
                text(
                    "SELECT indisvalid FROM pg_index "
                    "WHERE indexrelid = CAST(:qualified AS regclass)"
                ),
                {"qualified": f"coord.{_INDEX}"},
            ).scalar_one()
        assert columns == _EXPECTED_COLUMNS
        assert constraints == _CONSTRAINTS
        assert comment and "refs/heads/verified" in comment
        assert "(repo, advanced_at DESC)" in indexdef
        assert valid is True, "the CONCURRENTLY build left an INVALID index"

        # 3. Defaults — id, evidence and advanced_at are server-generated.
        sha = _sha()
        _accepted(engine, _row(sha=sha))
        with engine.connect() as conn:
            generated = conn.execute(
                text(
                    """
                    SELECT id IS NOT NULL, evidence = '{}'::jsonb,
                           advanced_at IS NOT NULL
                      FROM coord.verified_advances
                     WHERE repo = :repo AND sha = :sha
                    """
                ),
                {"repo": _REPO, "sha": sha},
            ).one()
        assert tuple(generated) == (True, True, True)

        # 4. Idempotency key: a duplicate (repo, sha) is refused, ON CONFLICT
        #    DO NOTHING on it is a silent no-op, and the same sha in another
        #    repo is a new row.
        _refused(engine, _row(sha=sha))
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.verified_advances
                        (tenant_id, repo, sha, basis)
                    VALUES (:tid, :repo, :sha, 'rerun')
                    ON CONFLICT (repo, sha) DO NOTHING
                    """
                ),
                {"tid": _TENANT, "repo": _REPO, "sha": sha},
            )
        _accepted(engine, _row(sha=sha, repo="qontinui/qontinui-runner"))

        # 5. basis vocabulary.
        for basis in _BASES:
            _accepted(engine, _row(basis=basis, prev=sha))
        for bad in ("merged", "manual", ""):
            _refused(engine, _row(basis=bad))

        # 6. Downgrade — table and index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        assert not index_exists(engine, _INDEX), "index survived downgrade"
