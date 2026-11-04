"""Behaviour test for the ``depcensus_01`` revision.

Pins the contract coord's ``/coord/dependency-advisories`` route (plan
``2026-11-02-rust-advisories-have-no-fleet-consumer`` Phase 3, coord half) and
the advisory steward (Phase 4) rely on:

1. **Shape**: both tables with their exact column contracts, both keys and the
   ``state`` CHECK by definition, and every index by its exact definition. All
   of it is gone after downgrade.
2. **Closed state vocabulary**: ``clean`` / ``vulnerable`` / ``not_applicable``
   / ``unknown`` are stored; anything else is refused by
   ``ck_dependency_census_state``.
3. **Defaults**: ``advisory_count`` 0, ``updated_at`` now(), ``patched`` an
   empty array, ``ignored`` false, ``resolved_at`` NULL.
4. **Keys**: one census row per (tenant, repo, ecosystem) and one advisory row
   per (tenant, repo, ecosystem, advisory, package); the upsert the route will
   issue updates in place.
5. **Re-running is harmless**: with rows present, ``stamp <parent>`` then
   ``upgrade`` again changes nothing (every statement is ``IF NOT EXISTS``).

Without a database (always runs): chain wiring and the DDL text.
With a database (skipped when none is reachable; a skip proves nothing):
everything above, against an ephemeral database from ``_alembic_harness``.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import TextClause, text
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

_REVISION_ID = "depcensus_01"
_REVISION_FILENAME = "depcensus_01_dependency_census_and_advisories.py"


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_CENSUS = "dependency_census"
_ADVISORIES = "dependency_advisories"
_TIMESTAMPTZ = "timestamp with time zone"

_EXPECTED_CENSUS_COLUMNS: dict[str, tuple[str, str]] = {
    "tenant_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "ecosystem": ("text", "NO"),
    "sha": ("text", "YES"),
    "db_commit": ("text", "YES"),
    "state": ("text", "NO"),
    "reason": ("text", "YES"),
    "advisory_count": ("integer", "NO"),
    "observed_at": (_TIMESTAMPTZ, "NO"),
    "updated_at": (_TIMESTAMPTZ, "NO"),
}

_EXPECTED_ADVISORY_COLUMNS: dict[str, tuple[str, str]] = {
    "tenant_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "ecosystem": ("text", "NO"),
    "advisory_id": ("text", "NO"),
    "package": ("text", "NO"),
    "version": ("text", "NO"),
    "patched": ("ARRAY", "NO"),
    "severity": ("text", "YES"),
    "ignored": ("boolean", "NO"),
    "first_seen_at": (_TIMESTAMPTZ, "NO"),
    "last_seen_at": (_TIMESTAMPTZ, "NO"),
    "resolved_at": (_TIMESTAMPTZ, "YES"),
}

_EXPECTED_CENSUS_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "dependency_census_pkey": ("p", "PRIMARY KEY (tenant_id, repo, ecosystem)"),
    "ck_dependency_census_state": (
        "c",
        "CHECK ((state = ANY (ARRAY['clean'::text, 'vulnerable'::text, "
        "'not_applicable'::text, 'unknown'::text])))",
    ),
}

_EXPECTED_ADVISORY_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "dependency_advisories_pkey": (
        "p",
        "PRIMARY KEY (tenant_id, repo, ecosystem, advisory_id, package)",
    ),
}

_EXPECTED_CENSUS_INDEXES: dict[str, str] = {
    "dependency_census_pkey": (
        "CREATE UNIQUE INDEX dependency_census_pkey ON coord.dependency_census "
        "USING btree (tenant_id, repo, ecosystem)"
    ),
}

_EXPECTED_ADVISORY_INDEXES: dict[str, str] = {
    "dependency_advisories_pkey": (
        "CREATE UNIQUE INDEX dependency_advisories_pkey "
        "ON coord.dependency_advisories USING btree "
        "(tenant_id, repo, ecosystem, advisory_id, package)"
    ),
    "ix_dependency_advisories_tenant_resolved": (
        "CREATE INDEX ix_dependency_advisories_tenant_resolved "
        "ON coord.dependency_advisories USING btree (tenant_id, resolved_at)"
    ),
}

_TENANT = uuid.UUID("3b6f0e42-8d17-4c59-a2e8-71c4d9f05b3a")

_INSERT_CENSUS = text(
    """
    INSERT INTO coord.dependency_census
        (tenant_id, repo, ecosystem, sha, db_commit, state, reason, observed_at)
    VALUES (:tid, :repo, 'rust', :sha, :db_commit, :state, :reason,
            '2026-11-04T10:00:00+00:00')
    """
)

_INSERT_ADVISORY = text(
    """
    INSERT INTO coord.dependency_advisories
        (tenant_id, repo, ecosystem, advisory_id, package, version,
         first_seen_at, last_seen_at)
    VALUES (:tid, :repo, 'rust', :advisory, :package, :version,
            '2026-11-04T10:00:00+00:00', '2026-11-04T10:00:00+00:00')
    """
)


def _census(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "repo": "qontinui/qontinui-runner",
        "sha": "5b2803fb5",
        "db_commit": "a1b2c3d4",
        "state": "clean",
        "reason": None,
    }
    params.update(overrides)
    return params


def _advisory(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "repo": "qontinui/qontinui-runner",
        "advisory": "RUSTSEC-2026-0381",
        "package": "crypto-bigint",
        "version": "0.5.5",
    }
    params.update(overrides)
    return params


# ---------------------------------------------------------------------------
# Without a database
# ---------------------------------------------------------------------------


def test_depcensus_01_chains_off_a_single_parent() -> None:
    """A single string parent, never a merge tuple; and never itself."""
    assert isinstance(_PARENT_REVISION_ID, str)
    assert _PARENT_REVISION_ID
    assert _PARENT_REVISION_ID != _REVISION_ID
    assert f'revision: str = "{_REVISION_ID}"' in _revision_source()


def test_depcensus_01_ddl_is_coord_qualified_and_drops_only_in_downgrade() -> None:
    source = _revision_source()
    upgrade_body, downgrade_body = source.split("def downgrade() -> None:", 1)
    assert "DROP " not in upgrade_body.split("def upgrade() -> None:", 1)[1]
    assert "CREATE TABLE IF NOT EXISTS coord.dependency_census" in upgrade_body
    assert "CREATE TABLE IF NOT EXISTS coord.dependency_advisories" in upgrade_body
    assert "DROP TABLE IF EXISTS coord.dependency_advisories" in downgrade_body
    assert "DROP TABLE IF EXISTS coord.dependency_census" in downgrade_body
    assert (
        "CHECK (state IN ('clean', 'vulnerable', 'not_applicable', 'unknown'))"
        in upgrade_body
    )
    assert "ON coord.dependency_advisories (tenant_id, resolved_at)" in upgrade_body


# ---------------------------------------------------------------------------
# With a database
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _constraints(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
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
            {"table": table},
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef
                  FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": table},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine, _CENSUS) == _EXPECTED_CENSUS_COLUMNS
    assert _columns(engine, _ADVISORIES) == _EXPECTED_ADVISORY_COLUMNS
    assert _constraints(engine, _CENSUS) == _EXPECTED_CENSUS_CONSTRAINTS
    assert _constraints(engine, _ADVISORIES) == _EXPECTED_ADVISORY_CONSTRAINTS
    assert _indexes(engine, _CENSUS) == _EXPECTED_CENSUS_INDEXES
    assert _indexes(engine, _ADVISORIES) == _EXPECTED_ADVISORY_INDEXES
    with engine.connect() as conn:
        # patched is a text[], not some other array.
        udt = conn.execute(
            text(
                "SELECT udt_name FROM information_schema.columns WHERE "
                "table_schema = 'coord' AND table_name = :t AND column_name = 'patched'"
            ),
            {"t": _ADVISORIES},
        ).scalar_one()
        assert udt == "_text"
        for table in (_CENSUS, _ADVISORIES):
            comment = conn.execute(
                text("SELECT obj_description(to_regclass('coord.' || :t), 'pg_class')"),
                {"t": table},
            ).scalar_one()
            assert comment and "2026-11-02-rust-advisories" in comment, table


def _assert_absent(engine: Engine) -> None:
    for table in (_CENSUS, _ADVISORIES):
        assert not table_exists(engine, "coord", table), f"coord.{table} is present"
        assert _indexes(engine, table) == {}, f"coord.{table} left indexes behind"


def _count(engine: Engine, table: str, *, tenant: uuid.UUID) -> int:
    """Rows of ``table`` belonging to ``tenant`` (the test's own discriminator)."""
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(f"SELECT count(*) FROM coord.{table} WHERE tenant_id = :tid"),
                {"tid": tenant},
            ).scalar_one()
        )


def _insert(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(statement, params)


def _refused(
    engine: Engine,
    statement: TextClause,
    params: dict[str, object],
    constraint: str,
) -> None:
    """The insert is refused, and by the named constraint, not by another one."""
    with pytest.raises(IntegrityError) as refusal, engine.begin() as conn:
        conn.execute(statement, params)
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
        "postgres service; locally, set QONTINUI_TEST_PG=host:port at a "
        "throwaway Postgres before running this test."
    ),
)
def test_depcensus_01_creates_both_tables_and_enforces_their_contract() -> None:
    """Shape, state vocabulary, defaults, keys, re-run, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "depcensus01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: neither table exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 2. Apply: exact columns, constraints, indexes and table comments.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # 3. Every state in the vocabulary is stored, one row per repo.
        for i, state in enumerate(("clean", "vulnerable", "not_applicable")):
            _insert(engine, _INSERT_CENSUS, _census(repo=f"o/r{i}", state=state))
        # An unknown census establishes no sha / db_commit and says why.
        _insert(
            engine,
            _INSERT_CENSUS,
            _census(
                repo="o/unknown",
                state="unknown",
                sha=None,
                db_commit=None,
                reason="owner_unproven",
            ),
        )
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT advisory_count, updated_at IS NOT NULL, reason "
                    "FROM coord.dependency_census WHERE repo = 'o/unknown'"
                )
            ).one()
        assert row == (0, True, "owner_unproven")

        # 4. A state outside the vocabulary is refused.
        _refused(
            engine,
            _INSERT_CENSUS,
            _census(repo="o/bad", state="ok"),
            "ck_dependency_census_state",
        )

        # 5. One census row per (tenant, repo, ecosystem).
        _refused(
            engine,
            _INSERT_CENSUS,
            _census(repo="o/r0", state="vulnerable"),
            "dependency_census_pkey",
        )

        # 6. Advisory defaults: no fix published, not ignored, open.
        _insert(engine, _INSERT_ADVISORY, _advisory())
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT patched, ignored, severity, resolved_at "
                    "FROM coord.dependency_advisories"
                )
            ).one()
        assert row == ([], False, None, None)

        # 7. The same advisory on another package is a second row; the same
        #    (advisory, package) twice is refused, and the upsert updates it.
        _insert(engine, _INSERT_ADVISORY, _advisory(package="elliptic-curve"))
        _refused(
            engine,
            _INSERT_ADVISORY,
            _advisory(version="0.5.6"),
            "dependency_advisories_pkey",
        )
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.dependency_advisories
                        (tenant_id, repo, ecosystem, advisory_id, package,
                         version, patched, first_seen_at, last_seen_at)
                    VALUES (:tid, :repo, 'rust', :advisory, :package, '0.5.6',
                            ARRAY['>=0.6.0'], now(), now())
                    ON CONFLICT (tenant_id, repo, ecosystem, advisory_id, package)
                    DO UPDATE SET version = EXCLUDED.version,
                                  patched = EXCLUDED.patched,
                                  last_seen_at = EXCLUDED.last_seen_at
                    """
                ),
                _advisory(),
            )
            row = conn.execute(
                text(
                    "SELECT version, patched FROM coord.dependency_advisories "
                    "WHERE package = 'crypto-bigint'"
                )
            ).one()
        assert row == ("0.5.6", [">=0.6.0"])
        assert _count(engine, _ADVISORIES, tenant=_TENANT) == 2

        # 8. Re-running is harmless: rewind the stamp and apply again.
        rows_before = (
            _count(engine, _CENSUS, tenant=_TENANT),
            _count(engine, _ADVISORIES, tenant=_TENANT),
        )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert (
            _count(engine, _CENSUS, tenant=_TENANT),
            _count(engine, _ADVISORIES, tenant=_TENANT),
        ) == rows_before

        # 9. Downgrade: both tables, every constraint and index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 10. Re-apply: the downgrade left no residue.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
