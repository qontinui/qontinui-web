"""Schema + round-trip test for the ``sess_guard_01`` revision.

Part B item 1 of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-07-runner-resource-guard-and-session-protection.md``
adds four session-protection byte floors to ``coord.fleet_runtime_policy``
**and** to ``coord.fleet_runtime_policy_versions``. The DDL is two ALTERs; the
contract is everything around them, and none of it is visible from a passing
``upgrade``. This is the direct successor of ``fleet_res_tel_03`` — same two
tables, same one-shared-list shape, same NULL-means-no-override rule — so this
test is deliberately the same test, with the column list swapped.

1. **Both tables get all four.** This is the whole revision. The versions
   table's own ``COMMENT ON TABLE`` makes it a standing rule — *"a partial
   snapshot is an audit trail that lies while still reporting as versioned"* —
   and a parent-only widening produces no error, no warning and no missing
   ``current_version``. coord's ``ControlsSchema`` is a single
   ``Present``/``Absent`` flag precisely *because* these land in one revision,
   so a parent-only widening yields a ``42703`` on the child alone: a state
   that flag says cannot exist. Nothing but an explicit assertion catches it.
2. **Exact types.** coord reads these floors as ``Option<i64>`` straight off
   the row. An ``i64`` read off an ``INTEGER`` column is a tokio-postgres
   **runtime panic** — no SQLSTATE, therefore no ``ControlsSchema`` degrade
   path and no 503 — so the type is part of the interface and is asserted by
   name. ``ADD COLUMN IF NOT EXISTS`` matches on NAME alone, so re-running
   ``upgrade()`` never repairs a narrowed column: only an assertion here does.
3. **Every column nullable, with no default.** NULL means "no override"; 0
   means "floor of zero", i.e. *the guard this column names is disabled*. A
   ``NOT NULL DEFAULT 0`` would collapse those into one value and silently
   switch off both the warn toast and the spawn block.
4. **Parent and snapshot can actually carry the payload** — the point of
   widening the child at all. Asserted by writing a parent row and a version
   row with every floor set to a value above 2^31 and reading **both** back.
   Both, because they are two independent ALTERs: one passing is not evidence
   about the other.
5. **Up → down → up leaves no residue and does not touch data.** Downgrade
   must remove the columns from *both* tables (leaving the child's behind gives
   a snapshot table that can hold payload the parent cannot — the same defect
   mirrored) while leaving the versions TABLE itself alone — it belongs to
   ``fleet_res_tel_02`` — and a pre-existing policy row and snapshot row must
   both survive the walk.

The CI gates this revision passes today assert none of that:
``alembic-heads-pr`` checks for a single head; ``migration-reversal.yml`` walks
``upgrade head`` → ``downgrade -1`` → ``upgrade head`` against an EMPTY database,
so it proves the SQL parses and nothing more; ``forbid-public-schema.yml``
excludes ``backend/alembic/versions/*`` wholesale; and
``check_alembic_schema_args.py`` only checks that the DDL names a schema.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not
the one accepting the test credentials (on the MSI box the canonical Postgres
listens on **5433**).

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips against 5432 —
which looks exactly like a green run in the summary line.
"""

from __future__ import annotations

import importlib.util
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

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST equal
# the revision's own `down_revision` — the first test below enforces it, and it
# is not a theoretical guard on this branch: the immediately preceding commit
# (`bfd19ae2 fix(alembic): re-point the ci-node migration at the current head`)
# re-pointed a neighbouring revision's parent. A stale pin rewinds too far and
# replays unrelated non-idempotent revisions, surfacing as someone else's
# `DuplicateTable`.
_REVISION_ID = "sess_guard_01"
_PARENT_REVISION_ID = "devenv_08_ci_node_config"
_REVISION_FILENAME = "sess_guard_01_session_protection_floor_columns.py"

_PARENT_TABLE = "fleet_runtime_policy"
_VERSIONS_TABLE = "fleet_runtime_policy_versions"

# Every column this revision adds shares this prefix, and no column that
# predates it does — `fleet_res_tel_03`'s floors are `min_free_mem_bytes_*`.
# That makes the prefix a usable membership test, which is what lets the
# assertions below compare a column SET rather than a count: a count survives a
# rename, and a rename is exactly what breaks coord's `row.get("...")`.
_COLUMN_PREFIX = "min_free_bytes_sessions"

# (column, information_schema.data_type). The type strings are PostgreSQL's own
# spellings, so a BIGINT that regressed to INTEGER fails loudly here rather than
# as a panic at coord's first `row.get::<i64>`.
_EXPECTED: tuple[tuple[str, str], ...] = (
    ("min_free_bytes_sessions_host", "bigint"),
    ("min_free_bytes_sessions_wsl", "bigint"),
    ("min_free_bytes_sessions_critical_host", "bigint"),
    ("min_free_bytes_sessions_critical_wsl", "bigint"),
)
_EXPECTED_NAMES: tuple[str, ...] = tuple(name for name, _ in _EXPECTED)

# The same four, spelled as the revision's own DDL spells them — this is what
# the module-constant guard compares against, so a type edited in one place and
# not the other cannot pass.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (
    ("min_free_bytes_sessions_host", "BIGINT"),
    ("min_free_bytes_sessions_wsl", "BIGINT"),
    ("min_free_bytes_sessions_critical_host", "BIGINT"),
    ("min_free_bytes_sessions_critical_wsl", "BIGINT"),
)

# The four floors, written once and asserted on both tables. All are > 2^31 and
# all four differ, so a narrowed column dies on the write rather than surviving
# to panic in coord's `row.get::<i64>`, and a mis-mapped column cannot pass by
# coincidence. 8 GiB is an ordinary host warn floor on a 32 GiB box; the
# criticals sit below their warn partners, which is the documented pairing
# (validated app-side in `FleetPolicyControls::validate`, not by a CHECK).
_HOST_WARN = 8 * 1024**3  # 8589934592 — the canonical over-2^31 witness
_WSL_WARN = 6 * 1024**3
_HOST_CRITICAL = 4 * 1024**3
_WSL_CRITICAL = 3 * 1024**3
_PAYLOAD = (_HOST_WARN, _WSL_WARN, _HOST_CRITICAL, _WSL_CRITICAL)
_PAYLOAD_PARAMS = {
    "host": _HOST_WARN,
    "wsl": _WSL_WARN,
    "chost": _HOST_CRITICAL,
    "cwsl": _WSL_CRITICAL,
}

# Named so the arithmetic above cannot drift from the value the BIGINT range is
# actually being proven against.
_EIGHT_GIB = 8589934592

_FLOOR_COLUMN_LIST = ", ".join(_EXPECTED_NAMES)


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` names the revision's real parent."""
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
        "_sess_guard_01_under_test",
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_revision_widens_both_tables_from_one_list() -> None:
    """Parent and versions table, same four columns, one source list.

    A structural guard on top of the live-schema assertions, because this is
    the property the whole revision exists for and the one a later edit could
    drop while every other test still passes: the versions table would keep
    reporting `current_version` over snapshots missing a payload column, with
    no error anywhere, and coord's single `ControlsSchema` flag would report
    `Present` off the parent while the child raised `42703`. Reading the
    module's own constants (rather than grepping text) also pins that the two
    tables are widened from ONE list, which is what makes "widen both together"
    mechanical instead of a convention.
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
    assert tuple(module._SESSION_FLOOR_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list drifted from what coord's FleetPolicyControls reads"
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


def _floor_columns(engine: Engine, table: str) -> set[str]:
    """The session-floor columns actually present on ``coord.<table>``."""
    return {c for c in _columns(engine, table) if c.startswith(_COLUMN_PREFIX)}


def _assert_columns_present(engine: Engine) -> None:
    """All four columns, right type, nullable, undefaulted — on BOTH tables."""
    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        # A SET, not a count: a count of four is equally satisfied by a
        # renamed column, and a rename is invisible to every CI gate this
        # revision passes while being fatal to coord's `row.get("<name>")`.
        assert _floor_columns(engine, table) == set(_EXPECTED_NAMES), (
            f"coord.{table} does not carry exactly the four session floors — "
            f"found {sorted(_floor_columns(engine, table))}, "
            f"expected {sorted(_EXPECTED_NAMES)}"
        )

        cols = _columns(engine, table)
        for name, expected_type in _EXPECTED:
            data_type, nullable, default = cols[name]
            assert data_type == expected_type, (
                f"coord.{table}.{name} is {data_type}, expected {expected_type}; "
                f"coord reads it as Option<i64>, and an i64 off an INTEGER is a "
                f"tokio-postgres panic with no SQLSTATE and no degrade path"
            )
            assert nullable == "YES", (
                f"coord.{table}.{name} is NOT NULL; NULL is how the schema says "
                f"'no override', which 0 does not mean"
            )
            assert default is None, (
                f"coord.{table}.{name} has DEFAULT {default!r}; a defaulted "
                f"floor is indistinguishable from an operator-set one, and a "
                f"default of 0 would silently disable the guard it names"
            )


def _assert_columns_absent(engine: Engine) -> None:
    """No residue on either table after downgrade."""
    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        residue = _floor_columns(engine, table)
        assert residue == set(), (
            f"coord.{table} still carries {sorted(residue)} after downgrade(); "
            f"downgrade must be the exact inverse of upgrade on BOTH tables"
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
                       'seeded before sess_guard_01', updated_by
                  FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                """
            ),
            {"t": str(tenant_id)},
        )


def _version_rows(engine: Engine, tenant_id: uuid.UUID) -> list[tuple]:
    """The snapshot rows for a tenant's policy, identity columns only.

    Deliberately not the floor columns: they do not exist after downgrade, and
    the point of this read is that the columns which predate this revision
    survive the walk untouched.
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


def test_the_parent_and_the_snapshot_both_carry_the_new_floors(
    _admin_url: str,
) -> None:
    """A parent row AND its version row hold every floor, read back.

    This is the point of widening the child. Written the way coord's
    `upsert_policy_tx` + `insert_version_snapshot_tx` write it — parent and
    snapshot in one transaction, every payload column named — so a column that
    exists but cannot round-trip its value fails here rather than in
    production. Both sides are re-read: a parent column that accepted the write
    and returned something else would otherwise pass on the snapshot's evidence
    alone.

    The values are all above 2^31, so this also proves the BIGINT range in
    practice rather than only in `information_schema` — an 8 GiB floor is an
    ordinary setting and does not fit an INTEGER.

    There is deliberately no separate "upgrade adds the columns" test: this one
    upgrades and asserts the same shape before doing more, and every
    database-backed test here replays the whole chain into its own ephemeral
    database, so a duplicate costs real wall-clock for nothing.
    """
    tenant_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "sess_guard_01_pl") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        with engine.begin() as conn:
            policy_id = conn.execute(
                text(
                    f"""
                    INSERT INTO coord.fleet_runtime_policy
                        (tenant_id, domain, scope_band, scope_key, level,
                         master_enabled, current_version, updated_by,
                         {_FLOOR_COLUMN_LIST})
                    VALUES (:t, 'fleet_resources', 'tenant', NULL, 'controls',
                            true, 1, 'operator@example.com',
                            :host, :wsl, :chost, :cwsl)
                    RETURNING id
                    """  # f-string: the column list is a module constant, never input
                ),
                {"t": str(tenant_id), **_PAYLOAD_PARAMS},
            ).scalar_one()

            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.fleet_runtime_policy_versions
                        (policy_id, version, level, master_enabled,
                         {_FLOOR_COLUMN_LIST}, change_note, updated_by)
                    VALUES (:p, 1, 'controls', true,
                            :host, :wsl, :chost, :cwsl,
                            'set the session floors', 'operator@example.com')
                    """  # f-string: the column list is a module constant, never input
                ),
                {"p": policy_id, **_PAYLOAD_PARAMS},
            )

        with engine.connect() as conn:
            snap = conn.execute(
                text(
                    f"""
                    SELECT {_FLOOR_COLUMN_LIST}
                      FROM coord.fleet_runtime_policy_versions
                     WHERE policy_id = :p AND version = 1
                    """  # f-string: the column list is a module constant, never input
                ),
                {"p": policy_id},
            ).fetchone()

        assert snap is not None, "no snapshot row"
        assert tuple(snap) == _PAYLOAD, (
            "the snapshot did not round-trip the floors; the 8 GiB warn floor "
            "in particular does not fit an INTEGER, so a narrowed column dies "
            "here rather than as a panic in coord"
        )
        assert snap[0] == _EIGHT_GIB, (
            "8 GiB must survive a write and a read unchanged — this is the "
            "BIGINT range proven in practice, not just in information_schema"
        )

        # The parent's own columns, re-read. The snapshot passing is not
        # evidence about the parent: they are two independent ALTERs.
        with engine.connect() as conn:
            parent = conn.execute(
                text(
                    f"""
                    SELECT {_FLOOR_COLUMN_LIST}
                      FROM coord.fleet_runtime_policy WHERE id = :p
                    """  # f-string: the column list is a module constant, never input
                ),
                {"p": policy_id},
            ).fetchone()
        assert parent is not None and tuple(parent) == _PAYLOAD, (
            "the parent row did not round-trip the floors"
        )

        # Every one of the eight columns carries a COMMENT. Worth asserting
        # because the two halves are written differently: the versions table's
        # comments are GENERATED from the shared column list, while the
        # parent's four are hand-written blocks. A fifth column added to the
        # list would be commented on the child and bare on the parent, and
        # these comments are where "NULL is not zero" is recorded at all.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            with engine.connect() as conn:
                commented = {
                    r[0]
                    for r in conn.execute(
                        text(
                            """
                            SELECT a.attname
                              FROM pg_attribute a
                              JOIN pg_class c ON c.oid = a.attrelid
                              JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'coord'
                               AND c.relname = :t
                               AND a.attname LIKE :prefix
                               AND col_description(c.oid, a.attnum) <> ''
                               AND col_description(c.oid, a.attnum) IS NOT NULL
                            """
                        ),
                        {"t": table, "prefix": f"{_COLUMN_PREFIX}%"},
                    ).fetchall()
                }
            assert commented == set(_EXPECTED_NAMES), (
                f"coord.{table} has uncommented session-floor columns: "
                f"{sorted(set(_EXPECTED_NAMES) - commented)}. The COMMENT is "
                f"where 'NULL = no override, not zero' is written down; a "
                f"column name cannot say it."
            )


def test_a_null_floor_is_distinguishable_from_zero(_admin_url: str) -> None:
    """NULL ("no override") and 0 ("guard disabled") stay two different values."""
    tenant_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "sess_guard_01_nz") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_policy_row(engine, tenant_id)

        with engine.connect() as conn:
            unset = conn.execute(
                text(
                    """
                    SELECT min_free_bytes_sessions_host IS NULL,
                           min_free_bytes_sessions_wsl IS NULL,
                           min_free_bytes_sessions_critical_host IS NULL,
                           min_free_bytes_sessions_critical_wsl IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """
                ),
                {"t": str(tenant_id)},
            ).fetchone()
        assert unset == (True, True, True, True), (
            "a row that set no floor must read as NULL, not as a defaulted 0 — "
            "a 0 critical floor never blocks a spawn, which is the opposite of "
            "'use the built-in conservative default'"
        )

        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.fleet_runtime_policy "
                    "SET min_free_bytes_sessions_critical_host = 0 "
                    "WHERE tenant_id = :t"
                ),
                {"t": str(tenant_id)},
            )
        with engine.connect() as conn:
            value, is_null = conn.execute(
                text(
                    """
                    SELECT min_free_bytes_sessions_critical_host,
                           min_free_bytes_sessions_critical_host IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """
                ),
                {"t": str(tenant_id)},
            ).fetchone()
        assert (value, is_null) == (0, False), (
            "0 must be storable and distinct from NULL: 'never block a spawn' "
            "is a legitimate (if unwise) setting, not the absence of one"
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
    with ephemeral_database(_admin_url, "sess_guard_01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_policy_row(engine, tenant_id)
        _seed_version_row(engine, tenant_id)
        _assert_columns_present(engine)
        before = _policy_row(engine, tenant_id)
        before_versions = _version_rows(engine, tenant_id)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert table_exists(engine, "coord", _VERSIONS_TABLE), (
            "downgrade() dropped the versions TABLE; it owns four columns "
            "there, not the table — that belongs to fleet_res_tel_02"
        )
        assert _policy_row(engine, tenant_id) == before, (
            "downgrade() disturbed the live policy row; it must drop columns, not data"
        )
        assert _version_rows(engine, tenant_id) == before_versions, (
            "downgrade() disturbed an immutable snapshot row"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        assert _policy_row(engine, tenant_id) == before
        assert _version_rows(engine, tenant_id) == before_versions

        # The re-added columns are NULL for the row that predates them, which
        # is the honest record: while they did not exist no override could have
        # been in force, so there is nothing to backfill.
        with engine.connect() as conn:
            nulls = conn.execute(
                text(
                    """
                    SELECT min_free_bytes_sessions_host IS NULL,
                           min_free_bytes_sessions_critical_host IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """
                ),
                {"t": str(tenant_id)},
            ).fetchone()
        assert nulls == (True, True)


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """`ADD COLUMN IF NOT EXISTS` — a re-run of upgrade() is a no-op.

    The house convention for `coord.*` tables, and worth an assertion because
    the guard is per-clause: one missing `IF NOT EXISTS` in a four-clause ALTER
    makes the whole statement abort on the re-run. The re-run also replays the
    COMMENT statements, so this covers those being re-issuable too.
    """
    with ephemeral_database(_admin_url, "sess_guard_01_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
