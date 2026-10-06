"""Behaviour test for the ``spawnadm_01_spawn_admission_ledger`` revision.

Pins the contract coord's admission routes and the runner client rely on:

1. **Shape** — the table, its exact column contract, and all three indexes
   (including the partial open-grants index) exist after upgrade and are gone
   after downgrade.
2. **The vocabularies are enforced** — an unknown ``class`` / ``kind`` and a
   negative ``count`` are refused by the schema, not merely by coord.
3. **Defaults are honest** — ``count`` 1, ``work_keys`` ``[]``, nullable
   lease/report columns NULL; a report row with ``count`` 0 is accepted.
4. **The partial index is what the open-permit read uses** — its predicate is
   ``kind IN ('grant', 'shadow') AND verdict = 'admit' AND released_at IS NULL``
   (shadow-mode leases are admitted ``shadow`` rows).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_REVISION_ID = "spawnadm_01_spawn_admission_ledger"
_REVISION_FILENAME = "spawnadm_01_spawn_admission_ledger.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(r'^down_revision:.*=\s*"([^"]+)"', source, re.MULTILINE)
    assert match, f"{_REVISION_FILENAME} must declare a down_revision"
    return match.group(1)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLE = "spawn_admission_ledger"

_INDEXES = (
    "ix_spawn_admission_ledger_device_created_at",
    "ix_spawn_admission_ledger_tenant_created_at",
    "ix_spawn_admission_ledger_open_grants",
)

# The column contract shared with coord and the runner: name -> (data_type, nullable).
_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "device_id": ("uuid", "NO"),
    "class": ("text", "NO"),
    "origin": ("text", "NO"),
    "kind": ("text", "NO"),
    "count": ("integer", "NO"),
    "verdict": ("text", "YES"),
    "reason": ("text", "YES"),
    "lease_expires_at": ("timestamp with time zone", "YES"),
    "released_at": ("timestamp with time zone", "YES"),
    "boot_id": ("text", "YES"),
    "work_keys": ("jsonb", "NO"),
    "created_at": ("timestamp with time zone", "NO"),
}

_TENANT = uuid.UUID("3b8f2d61-7c4e-4a19-b5d2-8e1f6a0c9d47")
_DEVICE = uuid.UUID("c92e5a18-4d7b-4f36-a0e1-5b8d3c7f2e64")

_INSERT = text(
    """
    INSERT INTO coord.spawn_admission_ledger
        (id, tenant_id, device_id, class, origin, kind, count)
    VALUES (:id, :tid, :did, :class, :origin, :kind, :count)
    """
)


def _row(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "id": uuid.uuid4(),
        "tid": _TENANT,
        "did": _DEVICE,
        "class": "continuation",
        "origin": "continuation_pull",
        "kind": "grant",
        "count": 1,
    }
    params.update(overrides)
    return params


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


def _refused(engine: Engine, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(_INSERT, params)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_spawnadm_01_creates_the_ledger_and_enforces_vocabulary() -> None:
    """Shape, enforced vocabularies, defaults, partial index, and reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "spawnadm01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the ledger does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE), (
            "the ledger must be created by this revision, not an earlier one"
        )

        # 2. Apply — table, exact columns, indexes.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        assert _columns(engine) == _EXPECTED_COLUMNS
        for name in _INDEXES:
            assert index_exists(engine, name), f"missing index {name}"

        with engine.connect() as conn:
            indexdefs = {
                name: conn.execute(
                    text(
                        "SELECT indexdef FROM pg_indexes "
                        "WHERE schemaname = 'coord' AND indexname = :name"
                    ),
                    {"name": name},
                ).scalar_one()
                for name in _INDEXES
            }
        # Column lists and order, not just existence: a reordered or
        # ASC index would pass ``index_exists`` and serve none of the
        # per-device / per-tenant newest-first reads coord issues.
        assert (
            "(device_id, created_at DESC)"
            in indexdefs["ix_spawn_admission_ledger_device_created_at"]
        )
        assert (
            "(tenant_id, created_at DESC)"
            in indexdefs["ix_spawn_admission_ledger_tenant_created_at"]
        )
        open_grants_def = indexdefs["ix_spawn_admission_ledger_open_grants"]
        assert "(device_id, lease_expires_at)" in open_grants_def
        assert "WHERE" in open_grants_def
        # Shadow-mode leases are ``kind = 'shadow'`` rows with verdict
        # ``admit``; refused shadow rows never hold a lease, so the predicate
        # carries both kinds but only admitted rows.
        assert "'grant'::text" in open_grants_def
        assert "'shadow'::text" in open_grants_def
        assert "'admit'::text" in open_grants_def
        assert "released_at IS NULL" in open_grants_def

        # 3. Defaults: count 1, work_keys [], lease/report columns NULL.
        grant = _row()
        with engine.begin() as conn:
            inserted = conn.execute(
                text(
                    """
                    INSERT INTO coord.spawn_admission_ledger
                        (tenant_id, device_id, class, origin, kind)
                    VALUES (:tid, :did, :class, :origin, :kind)
                    RETURNING id
                    """
                ),
                {k: v for k, v in grant.items() if k not in ("count", "id")},
            )
            # ``id`` was omitted: the insert succeeding is what proves the
            # gen_random_uuid() default (``id`` is a NOT NULL primary key).
            generated_id = inserted.scalar_one()
            defaults = conn.execute(
                text(
                    """
                    SELECT count, work_keys, verdict, reason, lease_expires_at,
                           released_at, boot_id, created_at IS NOT NULL
                      FROM coord.spawn_admission_ledger WHERE id = :id
                    """
                ),
                {"id": generated_id},
            ).one()
        assert tuple(defaults) == (1, [], None, None, None, None, None, True)

        # A cumulative report row with count 0 is legitimate.
        with engine.begin() as conn:
            conn.execute(
                _INSERT,
                _row(
                    **{"class": "attended"},
                    origin="terminal_create",
                    kind="report",
                    count=0,
                ),
            )

        # 4. Every vocabulary is enforced by the schema.
        _refused(engine, _row(**{"class": "batch"}))
        _refused(engine, _row(kind="lease"))
        _refused(engine, _row(count=-1))
        for klass in ("autofix", "continuation", "local", "attended"):
            for kind in ("grant", "refusal", "report", "shadow"):
                with engine.begin() as conn:
                    conn.execute(_INSERT, _row(**{"class": klass}, kind=kind))

        # 5. Downgrade — the ledger and every index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        for name in _INDEXES:
            assert not index_exists(engine, name), f"index {name} survived downgrade"
