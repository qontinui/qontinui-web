"""Behaviour test for the ``coord_computers_01`` revision (coord.computers).

``migration-reversal.yml`` only confirms the statements execute against an
empty database. The contracts pinned here are the ones coord's report route and
read door rely on, each a way the machine model could be quietly wrong:

1. **Shape** — the three tables, their indexes, and the new columns on
   ``coord.devices`` / ``coord.device_resource_samples`` exist after upgrade
   with the contracted types (``load_5m`` / ``load_15m`` match ``load_1m``), and
   are gone after downgrade; a second upgrade re-applies cleanly.
2. **identity_hash CHECK** — only 64 lowercase hex characters. A raw machine id
   must never be storable, and an uppercase digest would mint a second row for
   the same machine.
3. **kind CHECKs** on all three tables refuse words outside the contract.
4. **FK behaviour** — deleting a computer cascades its services and events,
   and SETs NULL on a WSL guest's ``parent_computer_id`` and on
   ``coord.devices.computer_id``. ``device_resource_samples.computer_id``
   carries NO FK (hot append-only table): a sample naming an unknown computer
   still inserts.
5. **Dedup** — ``(computer_id, client_event_id)`` is unique, so a report retry
   collapses to one event; the same client id on another computer is distinct.
6. **NULL is UNKNOWN** — new sample columns are nullable with no default, so an
   old publisher writes NULL, never 0.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_REVISION_ID = "coord_computers_01"
_REVISION_FILENAME = "coord_computers_01_create.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime — never pin it.

    ``alembic-heads-pr`` re-forks the chain whenever another revision lands
    first, and ``down_revision`` is then re-pointed; a pinned parent here would
    upgrade to a revision that is no longer this one's parent.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(r'^down_revision:?.*=\s*"([^"]+)"', source, re.MULTILINE)
    assert match, f"{_REVISION_FILENAME} must declare a down_revision"
    return match.group(1)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLES = ("computers", "computer_services", "computer_events")

_INDEXES = (
    "uq_computers_identity_hash",
    "ix_computers_parent_computer_id",
    "ix_computer_services_runner_name",
    "uq_computer_events_client_event",
    "ix_computer_events_computer_observed",
    "ix_computer_events_observed_at",
    "ix_devices_computer_id",
    "ix_device_resource_samples_computer_sampled",
)

_SAMPLE_INDEX = "ix_device_resource_samples_computer_sampled"

# Every NON-constraint index, by exact ``pg_get_indexdef``: key columns, sort
# direction and partial predicate. A same-named index over the wrong key would
# pass an existence check and serve no read.
_EXPECTED_INDEXDEFS: dict[str, str] = {
    "ix_computers_parent_computer_id": (
        "CREATE INDEX ix_computers_parent_computer_id ON coord.computers "
        "USING btree (parent_computer_id) WHERE (parent_computer_id IS NOT NULL)"
    ),
    "ix_computer_services_runner_name": (
        "CREATE INDEX ix_computer_services_runner_name ON coord.computer_services "
        "USING btree (runner_name) WHERE (runner_name IS NOT NULL)"
    ),
    "ix_computer_events_computer_observed": (
        "CREATE INDEX ix_computer_events_computer_observed ON coord.computer_events "
        "USING btree (computer_id, observed_at DESC)"
    ),
    "ix_computer_events_observed_at": (
        "CREATE INDEX ix_computer_events_observed_at ON coord.computer_events "
        "USING btree (observed_at)"
    ),
    "ix_devices_computer_id": (
        "CREATE INDEX ix_devices_computer_id ON coord.devices "
        "USING btree (computer_id) WHERE (computer_id IS NOT NULL)"
    ),
    _SAMPLE_INDEX: (
        "CREATE INDEX ix_device_resource_samples_computer_sampled "
        "ON coord.device_resource_samples "
        "USING btree (computer_id, sampled_at DESC) WHERE (computer_id IS NOT NULL)"
    ),
}

_EXPECTED_COMPUTER_COLUMNS: dict[str, tuple[str, str]] = {
    "computer_id": ("uuid", "NO"),
    "identity_hash": ("text", "NO"),
    "kind": ("text", "NO"),
    "parent_computer_id": ("uuid", "YES"),
    "hostname": ("text", "YES"),
    "os": ("text", "YES"),
    "os_version": ("text", "YES"),
    "kernel": ("text", "YES"),
    "arch": ("text", "YES"),
    "cpu_cores": ("integer", "YES"),
    "memory_total_bytes": ("bigint", "YES"),
    "swap_total_bytes": ("bigint", "YES"),
    "disk_total_bytes": ("bigint", "YES"),
    "gpus": ("jsonb", "YES"),
    "boot_id": ("text", "YES"),
    "booted_at": ("timestamp with time zone", "YES"),
    "access": ("jsonb", "YES"),
    "identity_conflict_at": ("timestamp with time zone", "YES"),
    "first_seen_at": ("timestamp with time zone", "NO"),
    "last_report_at": ("timestamp with time zone", "NO"),
}

_EXPECTED_SERVICE_COLUMNS: dict[str, tuple[str, str]] = {
    "computer_id": ("uuid", "NO"),
    "unit": ("text", "NO"),
    "kind": ("text", "NO"),
    "active_state": ("text", "YES"),
    "sub_state": ("text", "YES"),
    "result": ("text", "YES"),
    "restart_policy": ("text", "YES"),
    "oom_policy": ("text", "YES"),
    "memory_max": ("bigint", "YES"),
    "memory_peak": ("bigint", "YES"),
    "n_restarts": ("integer", "YES"),
    "state_changed_at": ("timestamp with time zone", "YES"),
    "observed_at": ("timestamp with time zone", "NO"),
    "runner_name": ("text", "YES"),
    "repo": ("text", "YES"),
}

_EXPECTED_EVENT_COLUMNS: dict[str, tuple[str, str]] = {
    "event_id": ("uuid", "NO"),
    "computer_id": ("uuid", "NO"),
    "client_event_id": ("text", "NO"),
    "kind": ("text", "NO"),
    "observed_at": ("timestamp with time zone", "NO"),
    "detail": ("jsonb", "NO"),
    "recorded_at": ("timestamp with time zone", "NO"),
}

_PSI_COLUMNS = tuple(
    f"psi_{resource}_{scope}_{window}"
    for resource in ("memory", "cpu", "io")
    for scope in ("some", "full")
    for window in ("avg10", "avg60")
)

# New sample columns -> data_type. Every one nullable, no default.
_EXPECTED_SAMPLE_COLUMNS: dict[str, str] = {
    "computer_id": "uuid",
    "load_5m": "real",
    "load_15m": "real",
    **dict.fromkeys(_PSI_COLUMNS, "real"),
    "oom_kill_total": "bigint",
    "boot_id": "text",
    "measured": "jsonb",
}

_HASH_A = "a" * 64
_HASH_B = "0123456789abcdef" * 4
_HASH_C = "fe" * 32
_NOW = datetime(2026, 9, 30, 1, 48, tzinfo=UTC)


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    """``{column_name: (data_type, is_nullable)}`` for ``coord.<table>``."""
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


def _fk_delete_rule(engine: Engine, constraint: str) -> str | None:
    """``confdeltype`` of the named FK in schema coord (``c`` cascade, ``n`` set null)."""
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT c.confdeltype::text FROM pg_constraint c
                  JOIN pg_namespace n ON n.oid = c.connamespace
                 WHERE n.nspname = 'coord' AND c.conname = :name AND c.contype = 'f'
                """
            ),
            {"name": constraint},
        ).scalar()


def _insert_computer(
    engine: Engine,
    identity_hash: str,
    kind: str = "host",
    parent: uuid.UUID | None = None,
) -> uuid.UUID:
    """Insert a computer row and return its coord-minted ``computer_id``."""
    with engine.begin() as conn:
        minted = conn.execute(
            text(
                """
                INSERT INTO coord.computers (identity_hash, kind, parent_computer_id)
                VALUES (:h, :k, :p) RETURNING computer_id
                """
            ),
            {"h": identity_hash, "k": kind, "p": parent},
        ).scalar_one()
    # psycopg2 hands a uuid column back as text unless a UUID type is bound.
    return uuid.UUID(str(minted))


def _refused(engine: Engine, constraint: str, sql: str, **params: object) -> None:
    """Assert the statement is refused by exactly the named constraint.

    Asserting only ``IntegrityError`` would let an unrelated violation (a NOT
    NULL, a different CHECK) stand in for the rule under test.
    """
    with pytest.raises(IntegrityError) as refused:
        with engine.begin() as conn:
            conn.execute(text(sql), params)
    diag = getattr(refused.value.orig, "diag", None)
    assert diag is not None, f"no diagnostics on {refused.value!r}"
    assert diag.constraint_name == constraint, (
        f"refused by {diag.constraint_name!r}, expected {constraint!r}"
    )


def _indexdefs(engine: Engine) -> dict[str, tuple[bool, str]]:
    """``{index_name: (indisvalid, pg_get_indexdef)}`` for the expected indexes."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname, i.indisvalid, pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = ANY(:names)
                """
            ),
            {"names": list(_EXPECTED_INDEXDEFS)},
        ).all()
    return {name: (valid, indexdef) for name, valid, indexdef in rows}


def _assert_absent(engine: Engine) -> None:
    for table in _TABLES:
        assert not table_exists(engine, "coord", table), f"coord.{table} present"
    for name in _INDEXES:
        assert not index_exists(engine, name), f"index {name} present"
    assert column_info(engine, "devices", "computer_id") is None
    for column in _EXPECTED_SAMPLE_COLUMNS:
        assert column_info(engine, "device_resource_samples", column) is None, (
            f"device_resource_samples.{column} present"
        )


def _assert_shape(engine: Engine) -> None:
    for table in _TABLES:
        assert table_exists(engine, "coord", table), f"coord.{table} missing"
    for name in _INDEXES:
        assert index_exists(engine, name), f"missing index {name}"
    assert _columns(engine, "computers") == _EXPECTED_COMPUTER_COLUMNS
    assert _columns(engine, "computer_services") == _EXPECTED_SERVICE_COLUMNS
    assert _columns(engine, "computer_events") == _EXPECTED_EVENT_COLUMNS

    assert column_info(engine, "devices", "computer_id") == ("uuid", "YES", None)
    load_1m = column_info(engine, "device_resource_samples", "load_1m")
    assert load_1m is not None and load_1m[0] == "real"
    for column, dtype in _EXPECTED_SAMPLE_COLUMNS.items():
        assert column_info(engine, "device_resource_samples", column) == (
            dtype,
            "YES",
            None,
        ), f"device_resource_samples.{column} must be nullable {dtype}, no default"

    assert _fk_delete_rule(engine, "fk_computers_parent_computer_id") == "n"
    assert _fk_delete_rule(engine, "fk_computer_services_computer_id") == "c"
    assert _fk_delete_rule(engine, "fk_computer_events_computer_id") == "c"
    assert _fk_delete_rule(engine, "fk_devices_computer_id") == "n"
    with engine.connect() as conn:
        sample_fks = conn.execute(
            text(
                """
                SELECT COUNT(*) FROM pg_constraint
                 WHERE conrelid = 'coord.device_resource_samples'::regclass
                   AND contype = 'f'
                """
            )
        ).scalar_one()
    assert sample_fks == 0, "the hot sample table must carry no FK"
    assert _indexdefs(engine) == {
        name: (True, indexdef) for name, indexdef in _EXPECTED_INDEXDEFS.items()
    }, "every index must exist, be VALID, and match its exact definition"


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coord_computers_01_models_the_machine_and_reverses_cleanly() -> None:
    """Shape, CHECKs, FK rules, the dedup key, honest NULLs, and reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coordcomputers01_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # -- identity_hash CHECK: exactly 64 lowercase hex characters. --------
        insert_computer = (
            "INSERT INTO coord.computers (identity_hash, kind) VALUES (:h, 'host')"
        )
        for bad in (
            "A" * 64,  # uppercase: would mint a second row for one machine
            "a" * 63,
            "a" * 65,
            "g" * 64,
            "4c4c4544-0042-3510-8052-b4c04f4e4d32",  # a raw machine id
        ):
            _refused(engine, "ck_computers_identity_hash", insert_computer, h=bad)

        host = _insert_computer(engine, _HASH_A)
        _refused(engine, "uq_computers_identity_hash", insert_computer, h=_HASH_A)

        # -- kind CHECKs on all three tables. ---------------------------------
        _refused(
            engine,
            "ck_computers_kind",
            "INSERT INTO coord.computers (identity_hash, kind) VALUES (:h, 'machine')",
            h=_HASH_C,
        )
        _refused(
            engine,
            "ck_computer_services_kind",
            """
            INSERT INTO coord.computer_services (computer_id, unit, kind, observed_at)
            VALUES (:c, 'x.service', 'systemd', :at)
            """,
            c=host,
            at=_NOW,
        )
        _refused(
            engine,
            "ck_computer_events_kind",
            """
            INSERT INTO coord.computer_events
                (computer_id, client_event_id, kind, observed_at)
            VALUES (:c, 'e0', 'oom', :at)
            """,
            c=host,
            at=_NOW,
        )

        guest = _insert_computer(engine, _HASH_B, kind="wsl_guest", parent=host)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.computer_services
                        (computer_id, unit, kind, active_state, result,
                         observed_at, runner_name, repo)
                    VALUES (:c, 'actions.runner.qontinui.box-1.service',
                            'gh_actions_runner', 'failed', 'oom-kill', :at,
                            'box-1', 'qontinui/qontinui-web')
                    """
                ),
                {"c": host, "at": _NOW},
            )
            detail = conn.execute(
                text(
                    """
                    INSERT INTO coord.computer_events
                        (computer_id, client_event_id, kind, observed_at)
                    VALUES (:c, 'oom:boot-1:17', 'oom_kill', :at)
                    RETURNING detail::text
                    """
                ),
                {"c": host, "at": _NOW},
            ).scalar_one()
        assert detail == "{}"

        # -- dedup: one client_event_id per computer. -------------------------
        insert_event = """
            INSERT INTO coord.computer_events
                (computer_id, client_event_id, kind, observed_at)
            VALUES (:c, 'oom:boot-1:17', 'oom_kill', :at)
        """
        _refused(
            engine, "uq_computer_events_client_event", insert_event, c=host, at=_NOW
        )
        with engine.begin() as conn:
            absorbed = conn.execute(
                text(
                    insert_event
                    + " ON CONFLICT (computer_id, client_event_id) DO NOTHING"
                ),
                {"c": host, "at": _NOW},
            )
            assert absorbed.rowcount == 0
            # The same client id on a DIFFERENT computer is a distinct event.
            conn.execute(text(insert_event), {"c": guest, "at": _NOW})

        # -- devices attach; samples carry no FK and NULL means UNKNOWN. ------
        tenant = uuid.uuid4()
        device = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (tenant_id, slug, display_name)
                    VALUES (:t, :slug, 'computers test')
                    """
                ),
                {"t": tenant, "slug": f"cc01-{tenant.hex[:8]}"},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.devices
                        (device_id, name, hostname, tenant_id, computer_id)
                    VALUES (:d, 'runner', 'box', :t, :c)
                    """
                ),
                {"d": device, "t": tenant, "c": host},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, source, computer_id)
                    VALUES (:d, 'host', 'runner', :orphan)
                    """
                ),
                {"d": device, "orphan": uuid.uuid4()},
            )
            unknown = conn.execute(
                text(
                    """
                    SELECT load_5m, psi_memory_full_avg10, oom_kill_total,
                           boot_id, measured
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": device},
            ).one()
        assert tuple(unknown) == (None, None, None, None, None)

        # -- deleting the host: cascade children, SET NULL references. --------
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.computers WHERE computer_id = :c"), {"c": host}
            )
            remaining = conn.execute(
                text(
                    """
                    SELECT
                      (SELECT COUNT(*) FROM coord.computer_services WHERE computer_id = :h),
                      (SELECT COUNT(*) FROM coord.computer_events WHERE computer_id = :h),
                      (SELECT COUNT(*) FROM coord.computer_events WHERE computer_id = :g),
                      (SELECT parent_computer_id FROM coord.computers WHERE computer_id = :g),
                      (SELECT computer_id FROM coord.devices WHERE device_id = :d)
                    """
                ),
                {"h": host, "g": guest, "d": device},
            ).one()
        assert tuple(remaining) == (0, 0, 1, None, None)

        # -- reversal, then re-apply. -----------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        _assert_invalid_sample_index_is_rebuilt(engine, root, url, device)


def _assert_invalid_sample_index_is_rebuilt(
    engine: Engine, root: Path, url: str, device: uuid.UUID
) -> None:
    """A retry after a failed concurrent build replaces the INVALID leftover.

    Simulates the partial failure the migration guards against: the DDL has
    committed, the concurrent sample-index build died and left an INVALID index
    under the right NAME (but, here, the wrong definition), and the version was
    never stamped. ``IF NOT EXISTS`` alone would keep that index forever; the
    upgrade must drop and rebuild it.
    """
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text(f"DROP INDEX coord.{_SAMPLE_INDEX}"))
        conn.execute(
            text(
                """
                INSERT INTO coord.device_resource_samples (device_id, lane, source)
                VALUES (:d, 'host', 'runner'), (:d, 'host', 'runner')
                """
            ),
            {"d": device},
        )
        # Two rows share device_id, so this UNIQUE build fails and leaves an
        # INVALID index behind under the migration index name.
        with pytest.raises(IntegrityError):
            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX CONCURRENTLY {_SAMPLE_INDEX} "
                    "ON coord.device_resource_samples (device_id)"
                )
            )
    leftover = _indexdefs(engine)[_SAMPLE_INDEX]
    assert leftover[0] is False, "the simulated failed build must leave INVALID"

    run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
    run_alembic(root, url, "upgrade", _REVISION_ID)
    _assert_shape(engine)
