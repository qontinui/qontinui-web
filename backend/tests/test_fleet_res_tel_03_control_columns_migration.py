"""Schema + round-trip test for the ``fleet_res_tel_03`` revision.

§D1 of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-02-fleet-resource-telemetry-and-ci-allocation.md``
adds seven control columns to ``coord.fleet_runtime_policy`` **and** to
``coord.fleet_runtime_policy_versions``. The DDL is two ALTERs; the contract is
everything around them, and none of it is visible from a passing ``upgrade``:

1. **Both tables get all seven.** This is the whole revision. The versions
   table's own ``COMMENT ON TABLE`` makes it a standing rule — *"a partial
   snapshot is an audit trail that lies while still reporting as versioned"* —
   and a parent-only widening produces no error, no warning and no missing
   ``current_version``. Nothing but an explicit assertion catches it.
2. **Exact types.** coord reads the byte floors as ``i64`` and the counts as
   ``i32`` straight off the row (``FleetPolicyControls::from_row``). An
   ``INTEGER`` where the Rust expects ``BIGINT`` is a runtime type error in
   tokio-postgres, not a silent widening, so the types are part of the
   interface and are asserted by name.
3. **Every column nullable.** NULL means "no override"; 0 means "floor of
   zero" (i.e. guard disabled) or "admit no builds". A NOT NULL DEFAULT 0
   would collapse those into one value and silently disable a safety floor.
4. **A snapshot can actually carry the payload** — the point of widening the
   child at all. Asserted by writing a parent row and a version row with every
   control set, then reading them back, including a real ``drain`` map.
5. **Up → down → up leaves no residue and does not touch data.** Downgrade
   must remove the columns from *both* tables (leaving the child's behind gives
   a snapshot table that can hold payload the parent cannot — the same defect
   mirrored), and a pre-existing policy row must survive the walk.

``migration-reversal.yml`` walks the chain against an EMPTY database, so it
proves the SQL parses and nothing more: no row exists there to survive a
round-trip, and it asserts nothing about which tables gained which columns.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with
``DATABASE_URL=postgresql://qontinui_user:qontinui_dev_password@localhost:5433/qontinui_test``
if 5432 is not the one accepting the test credentials (on the MSI box the
canonical Postgres listens on **5433**).
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
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST equal
# the revision's own `down_revision` — the first test below enforces it,
# because a stale pin rewinds too far and replays unrelated non-idempotent
# revisions, surfacing as someone else's `DuplicateTable`.
_REVISION_ID = "fleet_res_tel_03"
_PARENT_REVISION_ID = "fleet_res_tel_02"
_REVISION_FILENAME = "fleet_res_tel_03_fleet_policy_control_columns.py"

_PARENT_TABLE = "fleet_runtime_policy"
_VERSIONS_TABLE = "fleet_runtime_policy_versions"

# (column, information_schema.data_type). The type strings are PostgreSQL's own
# spellings, so a BIGINT that regressed to INTEGER fails loudly here rather than
# at coord's first `row.get::<i64>`.
_EXPECTED: tuple[tuple[str, str], ...] = (
    ("min_free_mem_bytes_host", "bigint"),
    ("min_free_mem_bytes_wsl", "bigint"),
    ("min_free_disk_bytes", "bigint"),
    ("max_concurrent_builds_override", "integer"),
    ("sample_interval_secs", "integer"),
    ("sample_retention_days", "integer"),
    ("drain", "jsonb"),
)

# The same seven, spelled as the revision's own DDL spells them — this is what
# the module-constant guard compares against, so a type edited in one place and
# not the other cannot pass.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (
    ("min_free_mem_bytes_host", "BIGINT"),
    ("min_free_mem_bytes_wsl", "BIGINT"),
    ("min_free_disk_bytes", "BIGINT"),
    ("max_concurrent_builds_override", "INTEGER"),
    ("sample_interval_secs", "INTEGER"),
    ("sample_retention_days", "INTEGER"),
    ("drain", "JSONB"),
)

# A drain entry exactly as `fleet_drain::DrainEntry` serialises it.
_DEVICE_ID = "6f1d6d5e-2f4a-4a3a-9d3c-2b1f0e9a8c7d"
_DRAIN = {
    _DEVICE_ID: {
        "until": "2026-08-08T12:00:00Z",
        "reason": "rustc OOM triage",
        "drained_by": "operator@example.com",
        "drained_at": "2026-08-07T09:30:00Z",
    }
}


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
        "_fleet_res_tel_03_under_test",
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_revision_widens_both_tables_from_one_list() -> None:
    """Parent and versions table, same seven columns, one source list.

    A structural guard on top of the live-schema assertions, because this is
    the property the whole revision exists for and the one a later edit could
    drop while every other test still passes: the versions table would keep
    reporting `current_version` over snapshots missing a payload column, with
    no error anywhere. Reading the module's own constants (rather than grepping
    text) also pins that the two tables are widened from ONE list, which is
    what makes "widen both together" mechanical instead of a convention.
    """
    module = _revision_module()
    assert set(module._TABLES) == {
        f"coord.{_PARENT_TABLE}",
        f"coord.{_VERSIONS_TABLE}",
    }, (
        "the revision must widen BOTH the parent and the versions table — a "
        "parent-only widening is exactly the audit-trail-that-lies its "
        "COMMENT ON TABLE forbids"
    )
    assert tuple(module._CONTROL_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list drifted from what coord's "
        "FleetPolicyControls / d1_payload_cols read"
    )


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    """``{column: (data_type, is_nullable)}`` for ``coord.<table>``."""
    sql = text(
        """
        SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = :t
        """
    )
    with engine.connect() as conn:
        return {r[0]: (r[1], r[2]) for r in conn.execute(sql, {"t": table}).fetchall()}


def _assert_columns_present(engine: Engine) -> None:
    """All seven columns, right type, nullable — on BOTH tables."""
    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        cols = _columns(engine, table)
        for name, expected_type in _EXPECTED:
            assert name in cols, f"coord.{table} is missing {name}"
            data_type, nullable = cols[name]
            assert data_type == expected_type, (
                f"coord.{table}.{name} is {data_type}, expected {expected_type}"
            )
            assert nullable == "YES", (
                f"coord.{table}.{name} is NOT NULL; NULL is how the schema says "
                f"'no override', which 0 does not mean"
            )


def _assert_columns_absent(engine: Engine) -> None:
    """No residue on either table after downgrade."""
    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        cols = _columns(engine, table)
        for name, _ in _EXPECTED:
            assert name not in cols, f"coord.{table}.{name} survived downgrade()"


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


def test_upgrade_adds_all_seven_columns_to_both_tables(_admin_url: str) -> None:
    """The revision's whole job, asserted against a real database."""
    with ephemeral_database(_admin_url, "fleet_res_tel_03") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)


def test_a_snapshot_can_carry_the_new_payload(_admin_url: str) -> None:
    """A version row written after this revision holds every control.

    This is the point of widening the child. Written the way coord's
    `insert_version_snapshot_tx` writes it — parent and snapshot in one
    transaction, every payload column named — so a column that exists but
    cannot round-trip its value fails here rather than in production.
    """
    tenant_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_03_pl") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.begin() as conn:
            policy_id = conn.execute(
                text(
                    """
                    INSERT INTO coord.fleet_runtime_policy
                        (tenant_id, domain, scope_band, scope_key, level,
                         master_enabled, current_version, updated_by,
                         min_free_mem_bytes_host, min_free_mem_bytes_wsl,
                         min_free_disk_bytes, max_concurrent_builds_override,
                         sample_interval_secs, sample_retention_days, drain)
                    VALUES (:t, 'fleet_resources', 'tenant', NULL, 'controls',
                            true, 1, 'operator@example.com',
                            :host, :wsl, :disk, :builds, :interval, :retention,
                            CAST(:drain AS JSONB))
                    RETURNING id
                    """
                ),
                {
                    "t": str(tenant_id),
                    # Deliberately > 2^31 so an INTEGER column would overflow:
                    # 8 GiB is an ordinary host memory floor and does not fit.
                    "host": 8 * 1024**3,
                    "wsl": 4 * 1024**3,
                    "disk": 64 * 1024**3,
                    "builds": 2,
                    "interval": 30,
                    "retention": 14,
                    "drain": json.dumps(_DRAIN),
                },
            ).scalar_one()

            conn.execute(
                text(
                    """
                    INSERT INTO coord.fleet_runtime_policy_versions
                        (policy_id, version, level, master_enabled,
                         drain, min_free_mem_bytes_host, min_free_mem_bytes_wsl,
                         min_free_disk_bytes, max_concurrent_builds_override,
                         sample_interval_secs, sample_retention_days,
                         change_note, updated_by)
                    VALUES (:p, 1, 'controls', true,
                            CAST(:drain AS JSONB), :host, :wsl, :disk, :builds,
                            :interval, :retention,
                            'set the fleet floors', 'operator@example.com')
                    """
                ),
                {
                    "p": policy_id,
                    "host": 8 * 1024**3,
                    "wsl": 4 * 1024**3,
                    "disk": 64 * 1024**3,
                    "builds": 2,
                    "interval": 30,
                    "retention": 14,
                    "drain": json.dumps(_DRAIN),
                },
            )

        with engine.connect() as conn:
            snap = conn.execute(
                text(
                    """
                    SELECT min_free_mem_bytes_host, min_free_mem_bytes_wsl,
                           min_free_disk_bytes, max_concurrent_builds_override,
                           sample_interval_secs, sample_retention_days, drain
                      FROM coord.fleet_runtime_policy_versions
                     WHERE policy_id = :p AND version = 1
                    """
                ),
                {"p": policy_id},
            ).fetchone()

        assert snap is not None, "no snapshot row"
        assert snap[0] == 8 * 1024**3
        assert snap[1] == 4 * 1024**3
        assert snap[2] == 64 * 1024**3
        assert (snap[3], snap[4], snap[5]) == (2, 30, 14)
        drain = snap[6] if isinstance(snap[6], dict) else json.loads(snap[6])
        assert drain == _DRAIN, "the drain map did not round-trip"
        assert drain[_DEVICE_ID]["until"], "`until` is mandatory per entry"

        # The drain read path coord actually uses.
        with engine.connect() as conn:
            drained = conn.execute(
                text(
                    "SELECT drain FROM coord.fleet_runtime_policy "
                    "WHERE drain IS NOT NULL"
                )
            ).fetchall()
        assert len(drained) == 1, (
            "`WHERE drain IS NOT NULL` — fleet_drain::drained_device_ids_on's "
            "exact predicate — did not find the drained row"
        )


def test_a_null_control_is_distinguishable_from_zero(_admin_url: str) -> None:
    """NULL ("no override") and 0 ("floor of zero") stay two different values."""
    tenant_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_03_nz") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_policy_row(engine, tenant_id)

        with engine.connect() as conn:
            unset = conn.execute(
                text(
                    """
                    SELECT min_free_mem_bytes_host IS NULL,
                           max_concurrent_builds_override IS NULL,
                           drain IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """
                ),
                {"t": str(tenant_id)},
            ).fetchone()
        assert unset == (True, True, True), (
            "a row that set no control must read as NULL, not as a defaulted 0 "
            "— a 0 memory floor disables the guard it names"
        )

        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.fleet_runtime_policy "
                    "SET max_concurrent_builds_override = 0 WHERE tenant_id = :t"
                ),
                {"t": str(tenant_id)},
            )
        with engine.connect() as conn:
            value, is_null = conn.execute(
                text(
                    """
                    SELECT max_concurrent_builds_override,
                           max_concurrent_builds_override IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """
                ),
                {"t": str(tenant_id)},
            ).fetchone()
        assert (value, is_null) == (0, False), (
            "0 must be storable and distinct from NULL: 'admit no builds' is a "
            "legitimate setting, not the absence of one"
        )


def test_up_down_up_leaves_no_residue_and_keeps_the_policy_row(
    _admin_url: str,
) -> None:
    """The full walk: a live parent row survives, and downgrade cleans both."""
    tenant_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_03_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_policy_row(engine, tenant_id)
        _assert_columns_present(engine)
        before = _policy_row(engine, tenant_id)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert _policy_row(engine, tenant_id) == before, (
            "downgrade() disturbed the live policy row; it must drop columns, not data"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        assert _policy_row(engine, tenant_id) == before

        # The re-added columns are NULL for the row that predates them, which
        # is the honest record: while they did not exist no override could have
        # been in force, so there is nothing to backfill.
        with engine.connect() as conn:
            nulls = conn.execute(
                text(
                    """
                    SELECT min_free_mem_bytes_host IS NULL, drain IS NULL
                      FROM coord.fleet_runtime_policy WHERE tenant_id = :t
                    """
                ),
                {"t": str(tenant_id)},
            ).fetchone()
        assert nulls == (True, True)


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """`ADD COLUMN IF NOT EXISTS` — a re-run of upgrade() is a no-op.

    The house convention for `coord.*` tables, and worth an assertion because
    the guard is per-clause: one missing `IF NOT EXISTS` in a seven-clause
    ALTER makes the whole statement abort on the re-run.
    """
    with ephemeral_database(_admin_url, "fleet_res_tel_03_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
