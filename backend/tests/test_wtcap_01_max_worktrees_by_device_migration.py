"""Schema + round-trip test for the ``wtcap_01_max_worktrees_by_device`` revision.

Amendment A3 / Phase 4 of plan
``2026-09-18-coord-allocation-budgets-ignore-the-machine-they-gate`` adds one
device-keyed JSONB map to ``coord.fleet_runtime_policy`` **and** to
``coord.fleet_runtime_policy_versions``. The DDL is two ALTERs; the contract is
everything around them, and none of it is visible from a passing ``upgrade``.
This is the direct successor of ``fleet_res_tel_03``'s ``drain`` column — same
two tables, same one-shared-list shape, same NULL-means-no-override rule — so
this test is deliberately that revision's test with the column list swapped.

1. **Both tables get it.** This is the whole revision. The versions table's own
   ``COMMENT ON TABLE`` makes it a standing rule — *"a partial snapshot is an
   audit trail that lies while still reporting as versioned"* — and a
   parent-only widening produces no error, no warning and no missing
   ``current_version``. coord's ``ControlsSchema`` is a single
   ``Present``/``Absent`` flag precisely *because* payload columns land in one
   revision, so a parent-only widening yields a ``42703`` on the child alone: a
   state that flag says cannot exist.
2. **Exact type.** The reading build will read this column as
   ``Option<serde_json::Value>`` straight off the row, exactly as coord already
   reads ``drain``. Reading JSON off a ``TEXT`` column is a tokio-postgres
   **runtime panic** — no SQLSTATE, therefore no ``ControlsSchema`` degrade path
   and no 503 — so the type is part of the interface and is asserted by name.
   ``ADD COLUMN IF NOT EXISTS`` matches on NAME alone, so re-running
   ``upgrade()`` never repairs a column that landed as the wrong type: only an
   assertion here does.
3. **Nullable, no default.** NULL means "no override on any device", so coord
   derives the cap from the machine and floors it at ``MIN_DEVICE_WORKTREES``.
   A ``NOT NULL DEFAULT '{}'`` would be the same thing spelled less honestly and
   would make "nobody has ever set one" indistinguishable from "an operator
   cleared them all".
4. **Parent and snapshot can actually carry the payload** — the point of
   widening the child at all. Asserted by writing a parent row and a version row
   with the real entry shape and reading **both** back. Both, because they are
   two independent ALTERs: one passing is not evidence about the other.
5. **Up → down → up leaves no residue and does not touch data.** Downgrade must
   remove the column from *both* tables (leaving the child's behind gives a
   snapshot table that can hold payload the parent cannot — the same defect
   mirrored) while leaving the versions TABLE itself alone: it belongs to
   ``fleet_res_tel_02``.

The CI gates this revision passes today assert none of that:
``alembic-graph-check`` checks the graph shape; ``migration-reversal.yml`` walks
``upgrade head`` → ``downgrade -1`` → ``upgrade head`` against an EMPTY database,
so it proves the SQL parses and nothing more; ``forbid-public-schema.yml``
excludes ``backend/alembic/versions/*`` wholesale; and
``check_alembic_schema_args.py`` only checks that the DDL names a schema.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one
accepting the test credentials.

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is silently
discarded and every database-backed test below skips — which looks exactly like
a green run in the summary line.
"""

from __future__ import annotations

import importlib.util
import json
import re
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
# revision's own `down_revision` — the first test below enforces it. A stale pin
# rewinds too far and replays unrelated non-idempotent revisions, surfacing as
# someone else's `DuplicateTable`.
_REVISION_ID = "wtcap_01_max_worktrees_by_device"
_PARENT_REVISION_ID = "policy_rules_agent_name_uq_01"
_REVISION_FILENAME = "wtcap_01_max_worktrees_by_device.py"

_PARENT_TABLE = "fleet_runtime_policy"
_VERSIONS_TABLE = "fleet_runtime_policy_versions"

_COLUMN = "max_worktrees_by_device"

# (column, information_schema.data_type). PostgreSQL's own spelling, so a JSONB
# that regressed to TEXT or JSON fails loudly here rather than as a panic at
# coord's first `row.get::<Option<serde_json::Value>>`.
_EXPECTED_TYPE = "jsonb"

# The revision's own DDL spelling — what the module-constant guard compares
# against, so a type edited in one place and not the other cannot pass.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = ((_COLUMN, "JSONB"),)

# One entry in the real stored shape. The device key is a UUID string because
# that is what the precedent column does — `fleet_drain.rs` parses `drain`'s
# keys with `Uuid::parse_str` and skips (with a warning) anything else, and the
# reading build is specified to do the same here. `n` is above the derived floor
# so the value is visibly an override rather than a coincidence.
_DEVICE_ID = "eb2155ed-4152-4b8e-9a3a-000000000001"
_ENTRY = {
    "n": 40,
    "reason": "operator: hold this box at 40 while the disk sweep runs",
    "set_by": "operator@example.com",
    "set_at": "2026-09-30T12:00:00Z",
}
_PAYLOAD = {_DEVICE_ID: _ENTRY}


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` names the revision's real parent.

    `alembic-graph-pr.yml` re-points `down_revision` whenever another alembic PR
    lands first, so this pin goes stale by ordinary process rather than by
    mistake. Re-point both together.
    """
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together."
    )


def _revision_module():
    """Import the revision file directly — it only imports ``alembic.op``."""
    spec = importlib.util.spec_from_file_location(
        "_wtcap_01_under_test",
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_revision_widens_both_tables_from_one_list() -> None:
    """Parent and versions table, same column, one source list.

    A structural guard on top of the live-schema assertions, because this is the
    property the whole revision exists for and the one a later edit could drop
    while every other test still passes: the versions table would keep reporting
    `current_version` over snapshots missing a payload column, with no error
    anywhere, and coord's single `ControlsSchema` flag would report `Present` off
    the parent while the child raised `42703`.
    """
    module = _revision_module()
    assert set(module._TABLES) == {
        f"coord.{_PARENT_TABLE}",
        f"coord.{_VERSIONS_TABLE}",
    }, (
        "the revision must widen BOTH the parent and the versions table — a "
        "parent-only widening is exactly the audit-trail-that-lies its "
        "COMMENT ON TABLE forbids, and coord's one Present/Absent schema flag "
        "cannot represent the half-widened state it produces"
    )
    assert tuple(module._COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list drifted from what coord's payload projection reads"
    )


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str, str | None]]:
    """``{column: (data_type, is_nullable, column_default)}`` for ``coord.<table>``."""
    sql = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = :t
        """
    )
    with engine.connect() as conn:
        return {
            r[0]: (r[1], r[2], r[3]) for r in conn.execute(sql, {"t": table}).fetchall()
        }


def _assert_column_present(engine: Engine) -> None:
    """The column, right type, nullable, undefaulted — on BOTH tables."""
    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        cols = _columns(engine, table)
        assert _COLUMN in cols, (
            f"coord.{table} does not carry {_COLUMN}; a rename is invisible to "
            f"every CI gate this revision passes while being fatal to coord's "
            f'row.get("{_COLUMN}")'
        )
        data_type, nullable, default = cols[_COLUMN]
        assert data_type == _EXPECTED_TYPE, (
            f"coord.{table}.{_COLUMN} is {data_type}, expected {_EXPECTED_TYPE}; "
            f"coord reads it as Option<serde_json::Value>, and a JSON read off a "
            f"TEXT column is a tokio-postgres panic with no SQLSTATE and no "
            f"degrade path"
        )
        assert nullable == "YES", (
            f"coord.{table}.{_COLUMN} is NOT NULL; NULL is how the schema says "
            f"'no override is set on any device', which an empty map does not "
            f"distinguish from 'an operator cleared them all'"
        )
        assert default is None, (
            f"coord.{table}.{_COLUMN} has DEFAULT {default!r}; a defaulted map is "
            f"indistinguishable from an operator-set one"
        )


def _assert_column_absent(engine: Engine) -> None:
    """No residue on either table after downgrade."""
    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        assert _COLUMN not in _columns(engine, table), (
            f"coord.{table} still carries {_COLUMN} after downgrade(); downgrade "
            f"must be the exact inverse of upgrade on BOTH tables"
        )


def _seed_policy_row(engine: Engine, tenant_id: uuid.UUID) -> None:
    """One pre-existing parent row, as an already-live database would have."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.fleet_runtime_policy
                    (tenant_id, domain, scope_band, scope_key, level,
                     master_enabled, updated_by)
                VALUES (:t, 'install_interception', 'tenant', NULL, 'observe',
                        true, 'seed@example.com')
                """
            ),
            {"t": str(tenant_id)},
        )


def _seed_version_row(engine: Engine, tenant_id: uuid.UUID) -> None:
    """The version-1 snapshot the seeded parent row would already carry."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.fleet_runtime_policy_versions
                    (policy_id, version, level, master_enabled,
                     change_note, updated_by)
                SELECT id, 1, level, master_enabled,
                       'seeded before wtcap_01', updated_by
                  FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                """
            ),
            {"t": str(tenant_id)},
        )


def _version_rows(engine: Engine, tenant_id: uuid.UUID) -> list[tuple]:
    """The snapshot rows for a tenant's policy, identity columns only.

    Deliberately not the new column: it does not exist after downgrade, and the
    point of this read is that the columns which predate this revision survive
    the walk untouched.
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT v.version, v.level, v.master_enabled, v.change_note,
                       v.updated_by
                  FROM coord.fleet_runtime_policy_versions v
                  JOIN coord.fleet_runtime_policy p ON p.id = v.policy_id
                 WHERE p.tenant_id = :t
                 ORDER BY v.version
                """
            ),
            {"t": str(tenant_id)},
        ).fetchall()
    assert rows, "the seeded snapshot row vanished"
    return [tuple(r) for r in rows]


def _policy_row(engine: Engine, tenant_id: uuid.UUID) -> tuple:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT level, master_enabled, current_version, updated_by
                  FROM coord.fleet_runtime_policy
                 WHERE tenant_id = :t
                """
            ),
            {"t": str(tenant_id)},
        ).fetchone()
    assert row is not None, "the seeded policy row vanished"
    return tuple(row)


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_the_parent_and_the_snapshot_both_carry_the_override_map(
    _admin_url: str,
) -> None:
    """A parent row AND its version row hold the map, read back.

    This is the point of widening the child. Written the way coord's
    `upsert_policy_versioned_tx` writes it — parent and snapshot in one
    transaction, every payload column named — so a column that exists but cannot
    round-trip its value fails here rather than in production. Both sides are
    re-read: a parent column that accepted the write and returned something else
    would otherwise pass on the snapshot's evidence alone.

    There is deliberately no separate "upgrade adds the column" test: this one
    upgrades and asserts the same shape before doing more, and every
    database-backed test here replays the whole chain into its own ephemeral
    database, so a duplicate costs real wall-clock for nothing.
    """
    tenant_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "wtcap_01_pl") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_present(engine)

        with engine.begin() as conn:
            policy_id = conn.execute(
                text(
                    f"""
                    INSERT INTO coord.fleet_runtime_policy
                        (tenant_id, domain, scope_band, scope_key, level,
                         master_enabled, current_version, updated_by, {_COLUMN})
                    VALUES (:t, 'fleet_resources', 'tenant', NULL, 'controls',
                            true, 1, 'operator@example.com', CAST(:m AS JSONB))
                    RETURNING id
                    """  # f-string: the column name is a module constant, never input
                ),
                {"t": str(tenant_id), "m": json.dumps(_PAYLOAD)},
            ).scalar_one()

            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.fleet_runtime_policy_versions
                        (policy_id, version, level, master_enabled, {_COLUMN},
                         change_note, updated_by)
                    VALUES (:p, 1, 'controls', true, CAST(:m AS JSONB),
                            'set the per-device worktree cap',
                            'operator@example.com')
                    """  # f-string: the column name is a module constant, never input
                ),
                {"p": policy_id, "m": json.dumps(_PAYLOAD)},
            )

        with engine.connect() as conn:
            snap = conn.execute(
                text(
                    f"""
                    SELECT {_COLUMN}
                      FROM coord.fleet_runtime_policy_versions
                     WHERE policy_id = :p AND version = 1
                    """  # f-string: the column name is a module constant, never input
                ),
                {"p": policy_id},
            ).scalar_one()
            parent = conn.execute(
                text(
                    f"""
                    SELECT {_COLUMN} FROM coord.fleet_runtime_policy WHERE id = :p
                    """  # f-string: the column name is a module constant, never input
                ),
                {"p": policy_id},
            ).scalar_one()

        assert snap == _PAYLOAD, "the snapshot did not round-trip the override map"
        # The parent's own column, re-read. The snapshot passing is not evidence
        # about the parent: they are two independent ALTERs.
        assert parent == _PAYLOAD, "the parent row did not round-trip the override map"

        # JSONB, not JSON or TEXT: a key lookup has to work, because that is how
        # coord (and the operator door) reach ONE device's entry rather than
        # parsing the whole map.
        with engine.connect() as conn:
            n = conn.execute(
                text(
                    f"""
                    SELECT ({_COLUMN} -> :d ->> 'n')::int
                      FROM coord.fleet_runtime_policy WHERE id = :p
                    """  # f-string: the column name is a module constant, never input
                ),
                {"p": policy_id, "d": _DEVICE_ID},
            ).scalar_one()
        assert n == 40, (
            "a device-keyed lookup must work on the stored value; if this fails "
            "the column is not really JSONB whatever information_schema says"
        )

        # Both columns carry a COMMENT. That is where "NULL is no override, not
        # zero" and the >= 1 rule are written down at all; a column name cannot
        # say either.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            with engine.connect() as conn:
                comment = conn.execute(
                    text(
                        """
                        SELECT col_description(c.oid, a.attnum)
                          FROM pg_attribute a
                          JOIN pg_class c ON c.oid = a.attrelid
                          JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'coord' AND c.relname = :t
                           AND a.attname = :col
                        """
                    ),
                    {"t": table, "col": _COLUMN},
                ).scalar_one()
            assert comment, (
                f"coord.{table}.{_COLUMN} is uncommented. The COMMENT is where "
                f"'NULL = no override' and the >= 1 rule are recorded."
            )


def test_an_absent_map_reads_as_null_not_as_an_empty_object(_admin_url: str) -> None:
    """NULL ("nobody set one") and ``{}`` ("all cleared") stay two values."""
    tenant_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "wtcap_01_nz") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_policy_row(engine, tenant_id)

        with engine.connect() as conn:
            unset = conn.execute(
                text(
                    f"""
                    SELECT {_COLUMN} IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """  # f-string: the column name is a module constant, never input
                ),
                {"t": str(tenant_id)},
            ).scalar_one()
        assert unset is True, (
            "a row that set no override must read as NULL, not as a defaulted "
            "empty map — the reading build's specified predicate is WHERE the "
            "column IS NOT NULL, so a default would put every tenant row into "
            "that scan for nothing"
        )

        # The predicate the reading build is specified to use — the shape
        # `fleet_drain.rs` already uses for `drain` — executed here rather than
        # asserted about: NULL must not match it.
        def _matching_rows() -> int:
            with engine.connect() as c:
                return c.execute(
                    text(
                        f"""
                        SELECT count(*) FROM coord.fleet_runtime_policy
                         WHERE tenant_id = :t AND {_COLUMN} IS NOT NULL
                        """  # f-string: the column name is a module constant, never input
                    ),
                    {"t": str(tenant_id)},
                ).scalar_one()

        assert _matching_rows() == 0, (
            "an unset row must not match the WHERE ... IS NOT NULL predicate; "
            "if it does, every tenant row is scanned for nothing"
        )

        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.fleet_runtime_policy SET {_COLUMN} = '{{}}'::jsonb "
                    f"WHERE tenant_id = :t"  # f-string: module constant, never input
                ),
                {"t": str(tenant_id)},
            )
        with engine.connect() as conn:
            value, is_null = conn.execute(
                text(
                    f"""
                    SELECT {_COLUMN}, {_COLUMN} IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """  # f-string: the column name is a module constant, never input
                ),
                {"t": str(tenant_id)},
            ).fetchone()
        assert (value, is_null) == ({}, False), (
            "an empty map must be storable and distinct from NULL: it is what "
            "the last override being removed leaves behind, and the writer "
            "reaches it by deleting the last key"
        )
        # And an EMPTY map does match the predicate — it is NOT NULL. That is
        # the interesting half: the reader sees the row and finds no device in
        # it, which is "no override" reached by a different route than NULL.
        assert _matching_rows() == 1, (
            "an empty map is NOT NULL, so the reading build must still see the "
            "row; the map being empty is what tells it no device is overridden"
        )


def test_up_down_up_leaves_no_residue_and_keeps_the_policy_row(
    _admin_url: str,
) -> None:
    """The full walk: live rows on BOTH tables survive, and downgrade cleans both.

    `downgrade()` ALTERs the versions table too, so the snapshot table and its
    rows are asserted alongside the parent's — an over-broad drop there would
    otherwise be invisible until the next audit read.
    """
    tenant_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "wtcap_01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_policy_row(engine, tenant_id)
        _seed_version_row(engine, tenant_id)
        _assert_column_present(engine)
        before = _policy_row(engine, tenant_id)
        before_versions = _version_rows(engine, tenant_id)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_column_absent(engine)
        assert table_exists(engine, "coord", _VERSIONS_TABLE), (
            "downgrade() dropped the versions TABLE; it owns one column there, "
            "not the table — that belongs to fleet_res_tel_02"
        )
        assert _policy_row(engine, tenant_id) == before, (
            "downgrade() disturbed the live policy row; it must drop a column, not data"
        )
        assert _version_rows(engine, tenant_id) == before_versions, (
            "downgrade() disturbed an immutable snapshot row"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_present(engine)
        assert _policy_row(engine, tenant_id) == before
        assert _version_rows(engine, tenant_id) == before_versions

        # The re-added column is NULL for the row that predates it, which is the
        # honest record: while it did not exist no override could have been in
        # force, so there is nothing to backfill.
        with engine.connect() as conn:
            is_null = conn.execute(
                text(
                    f"""
                    SELECT {_COLUMN} IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """  # f-string: the column name is a module constant, never input
                ),
                {"t": str(tenant_id)},
            ).scalar_one()
        assert is_null is True


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """`ADD COLUMN IF NOT EXISTS` — a re-run of upgrade() is a no-op.

    The house convention for `coord.*` tables, and worth an assertion because the
    guard is per-clause. The re-run also replays the COMMENT statements, so this
    covers those being re-issuable too.
    """
    with ephemeral_database(_admin_url, "wtcap_01_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_present(engine)
