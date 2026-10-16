"""Structural and round-trip test for alembic ``replident_01``.

Plan ``2026-10-15-coord-and-web-data-move-off-aws-by-logical-replication``
Phase 1a. The at-head guard is ``test_replica_identity_published_schemas.py``;
this file tests the revision itself.

Without a database (always runs):

1. Chain wiring: the parent is pinned and the ``Revises:`` header agrees.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

2. At the parent the five tables are ``DEFAULT`` with no primary key, and a
   publication refuses a DELETE on them; after the upgrade each uses its
   unique-constraint index and the same publication accepts it.
3. The upgrade is idempotent (re-run over an upgraded database), and
   up, down, up returns the parent's ``DEFAULT`` and then the identities.
4. Drift: a table whose unique constraint is missing gets ``FULL`` rather than
   failing the deploy, and a table that already has an identity is untouched.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "replident_01"
_REVISION_FILENAME = "replident_01_coord_no_pk_tables_replica_identity.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change.
_PARENT_REVISION_ID = "coord_pr_holds_01"

_EXPECTED_INDEX = {
    "worker_heartbeats": "worker_heartbeats_name_replica_id_uq",
    "pr_unlandable_attempts": "pr_unlandable_attempts_composite_key",
    "outbound_budget_observations": (
        "outbound_budget_observations_dependency_resource_uq"
    ),
    "webhook_pulse": "webhook_pulse_repo_event_type_uq",
    "credential_probe_specs": "uq_credential_probe_specs_tenant_token",
}


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    source = _revision_path().read_text(encoding="utf-8")
    assert (
        declared_parent_revision_id(source, _REVISION_FILENAME) == _PARENT_REVISION_ID
    )
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M), (
        "the docstring's Revises: line disagrees with down_revision"
    )
    assert {table for table, _ in module.TABLES} == set(_EXPECTED_INDEX)
    assert dict(module.TABLES) == _EXPECTED_INDEX


# ---------------------------------------------------------------------------
# database helpers
# ---------------------------------------------------------------------------


def _identities(engine: Engine) -> dict[str, tuple[str, str | None]]:
    """``table -> (relreplident, identity index name)`` for the five tables."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname, c.relreplident, ic.relname
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  LEFT JOIN pg_index i
                    ON i.indrelid = c.oid AND i.indisreplident
                  LEFT JOIN pg_class ic ON ic.oid = i.indexrelid
                 WHERE n.nspname = 'coord' AND c.relname = ANY(:names)
                """
            ),
            {"names": list(_EXPECTED_INDEX)},
        ).fetchall()
    return {row[0]: (row[1], row[2]) for row in rows}


def _has_primary_key(engine: Engine, table: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM pg_constraint "
                    "WHERE conrelid = to_regclass(:t) AND contype = 'p')"
                ),
                {"t": f"coord.{table}"},
            ).scalar_one()
        )


def _publication_refuses_delete(engine: Engine, table: str) -> bool:
    """Whether a publication over ``table`` refuses a DELETE on it (rolled back).

    The replica-identity check runs when the statement starts, so a zero-row
    ``DELETE … WHERE false`` is enough to trip it.
    """
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(
                text(f"CREATE PUBLICATION replident_01_probe FOR TABLE coord.{table}")
            )
            try:
                with conn.begin_nested():
                    conn.execute(text(f"DELETE FROM coord.{table} WHERE false"))
            except DBAPIError as exc:
                assert "does not have a replica identity" in str(exc.orig)
                return True
            return False
        finally:
            transaction.rollback()


_Identity = tuple[str, str | None]
_DEFAULT: dict[str, _Identity] = dict.fromkeys(_EXPECTED_INDEX, ("d", None))
_UPGRADED: dict[str, _Identity] = {
    table: ("i", index) for table, index in _EXPECTED_INDEX.items()
}


@pytest.fixture
def at_parent() -> Iterator[tuple[Engine, str]]:
    admin_url = admin_database_url()
    if not can_connect(admin_url):
        pytest.skip(f"no test Postgres reachable at {admin_url}")
    with ephemeral_database(admin_url, "replident_01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        yield engine, db_url


# ---------------------------------------------------------------------------
# 2–3. upgrade, idempotence, round trip
# ---------------------------------------------------------------------------


def test_upgrade_gives_each_table_its_unique_index_and_round_trips(
    at_parent: tuple[Engine, str],
) -> None:
    engine, db_url = at_parent
    cwd = backend_root()

    assert _identities(engine) == _DEFAULT
    for table in _EXPECTED_INDEX:
        assert not _has_primary_key(engine, table), table
        assert _publication_refuses_delete(engine, table), table

    run_alembic(cwd, db_url, "upgrade", _REVISION_ID)
    assert _identities(engine) == _UPGRADED
    for table in _EXPECTED_INDEX:
        assert not _publication_refuses_delete(engine, table), table

    # Idempotent: replay upgrade() over a database that already has it.
    run_alembic(cwd, db_url, "stamp", _PARENT_REVISION_ID)
    run_alembic(cwd, db_url, "upgrade", _REVISION_ID)
    assert _identities(engine) == _UPGRADED

    run_alembic(cwd, db_url, "downgrade", _PARENT_REVISION_ID)
    assert _identities(engine) == _DEFAULT

    run_alembic(cwd, db_url, "upgrade", _REVISION_ID)
    assert _identities(engine) == _UPGRADED


# ---------------------------------------------------------------------------
# 4. drift
# ---------------------------------------------------------------------------


def test_drift_falls_back_to_full_and_leaves_a_set_identity_alone(
    at_parent: tuple[Engine, str],
) -> None:
    engine, db_url = at_parent
    with engine.begin() as conn:
        # The constraint coord upserts on is missing in this "production".
        conn.execute(
            text(
                "ALTER TABLE coord.webhook_pulse "
                "DROP CONSTRAINT webhook_pulse_repo_event_type_uq"
            )
        )
        # Someone already set an identity by hand.
        conn.execute(
            text("ALTER TABLE coord.pr_unlandable_attempts REPLICA IDENTITY FULL")
        )

    run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

    expected = dict(_UPGRADED)
    expected["webhook_pulse"] = ("f", None)
    expected["pr_unlandable_attempts"] = ("f", None)
    assert _identities(engine) == expected
    assert not _publication_refuses_delete(engine, "webhook_pulse")
