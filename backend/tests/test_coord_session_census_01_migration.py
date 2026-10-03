"""Behaviour test for the ``coord_session_census_01`` session-census store.

Pins what a reviewer cannot read off the DDL at a glance:

1. **Shape** — both tables and the ``session_id`` index exist after upgrade and
   are gone after downgrade; the index is keyed on ``session_id`` alone.
2. **The column contract, EXACTLY** — names, types and nullability are the
   cross-repo contract coord's ingest and read are written against, and the set
   is a privacy contract too (no transcript content, no environment values, no
   credentials). Widening it must be a reviewed edit of this test.
3. **The key** — ``(device_id, session_id, pid)`` is enforced: the same session
   on two pids is two rows, the same triple twice is refused.
4. **The FK** — a session row without its device's freshness row is refused,
   and deleting the device row cascades to its sessions.
5. **Defaults** — ``received_at`` is server-stamped, ``runner_hosted`` defaults
   to false, ``observed_at`` has NO default (it is the runner's clock).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

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

_REVISION_ID = "coord_session_census_01"
_REVISION_FILENAME = "coord_session_census_01.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime.

    Never hardcode the parent: coord re-points ``down_revision`` at land when a
    peer revision lands first, and a pinned constant would then upgrade to a
    revision that is no longer this one's parent.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(r'^down_revision:.*=\s*"([^"]+)"', source, re.MULTILINE)
    assert match, f"{_REVISION_FILENAME} must declare a down_revision"
    return match.group(1)


_PARENT_REVISION_ID = _parent_revision_id()

_DEVICE_TABLE = "session_census_device"
_SESSION_TABLE = "session_census"
_INDEX = "ix_session_census_session_id"

_TS = "timestamp with time zone"

_EXPECTED_DEVICE_COLUMNS: dict[str, tuple[str, str]] = {
    "device_id": ("uuid", "NO"),
    "tenant_id": ("uuid", "YES"),
    "observed_at": (_TS, "NO"),
    "received_at": (_TS, "NO"),
    "row_count": ("integer", "NO"),
    "account_homes": ("integer", "NO"),
    "runner_build": ("text", "YES"),
}

_EXPECTED_SESSION_COLUMNS: dict[str, tuple[str, str]] = {
    "device_id": ("uuid", "NO"),
    "session_id": ("text", "NO"),
    "pid": ("integer", "NO"),
    "pid_alive": ("boolean", "NO"),
    "proc_start": ("text", "YES"),
    "started_at": (_TS, "YES"),
    "account": ("text", "YES"),
    "config_dir": ("text", "YES"),
    "cwd": ("text", "YES"),
    "entrypoint": ("text", "YES"),
    "kind": ("text", "YES"),
    "tmux_pane": ("text", "YES"),
    "window_name": ("text", "YES"),
    "window_name_source": ("text", "YES"),
    "registry_status": ("text", "YES"),
    "registry_status_updated_at": (_TS, "YES"),
    "last_acted_at": (_TS, "YES"),
    "runner_hosted": ("boolean", "NO"),
}

# Column NAMES that would signal content / environment / credentials are kept.
_FORBIDDEN_NAME = re.compile(
    r"content|transcript|message|prompt|payload|body|environ|env_|token|secret"
    r"|password|credential|jwt|key",
    re.IGNORECASE,
)

_DEVICE = uuid.UUID("7d3e9a10-4b2c-4f5e-9a81-2c6b0e1f3d44")
_SESSION = "9f6e4a55-80fe-490c-9235-a57ee24e5d96"
_OBSERVED = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


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


def _constraint_defs(engine: Engine, table: str) -> list[tuple[str, str]]:
    """Sorted ``(contype, pg_get_constraintdef)`` for every constraint on the table.

    A list, not a dict: two constraints of one type must both be visible.
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT contype::text, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = ('coord.' || :table)::regclass
                   AND contype <> 'n'
                """
            ),
            {"table": table},
        ).all()
    return sorted((contype, definition) for contype, definition in rows)


def _non_pk_index_columns(engine: Engine) -> dict[str, tuple[str, ...]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                   AND indexname <> 'session_census_pkey'
                """
            ),
            {"table": _SESSION_TABLE},
        ).all()
    parsed: dict[str, tuple[str, ...]] = {}
    for name, indexdef in rows:
        match = re.search(r"USING btree \(([^)]*)\)", indexdef)
        assert match, f"unexpected index definition for {name}: {indexdef}"
        parsed[name] = tuple(col.strip() for col in match.group(1).split(","))
    return parsed


_INSERT_DEVICE = text(
    """
    INSERT INTO coord.session_census_device
        (device_id, observed_at, row_count, account_homes)
    VALUES (:device, :observed, 2, 17)
    """
)
_INSERT_SESSION = text(
    """
    INSERT INTO coord.session_census (device_id, session_id, pid, pid_alive)
    VALUES (:device, :session, :pid, true)
    """
)


def _session_count(engine: Engine, *, device: uuid.UUID) -> int:
    """Session rows for ONE device — scoped to the test's own discriminator."""
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    """
                    SELECT COUNT(*) FROM coord.session_census
                     WHERE device_id = :device
                    """
                ),
                {"device": device},
            ).scalar_one()
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coord_session_census_01_shape_key_fk_and_reversal() -> None:
    """Shape, the column contract, the key, the FK cascade, and reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "sesscensus01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — neither table exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _DEVICE_TABLE)
        assert not table_exists(engine, "coord", _SESSION_TABLE)

        # 2. Apply — both tables and the session_id index.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _DEVICE_TABLE)
        assert table_exists(engine, "coord", _SESSION_TABLE)
        assert index_exists(engine, _INDEX)
        assert _non_pk_index_columns(engine) == {_INDEX: ("session_id",)}

        # 3. The column contract, exactly.
        assert _columns(engine, _DEVICE_TABLE) == _EXPECTED_DEVICE_COLUMNS
        session_columns = _columns(engine, _SESSION_TABLE)
        assert session_columns == _EXPECTED_SESSION_COLUMNS, (
            "coord.session_census' column set moved. It is a cross-repo contract "
            "and a privacy contract: no transcript content, no environment "
            "values, no credentials."
        )
        forbidden = sorted(
            c
            for c in (*session_columns, *_EXPECTED_DEVICE_COLUMNS)
            if _FORBIDDEN_NAME.search(c)
        )
        assert forbidden == [], f"content/credential-named column(s) {forbidden}"

        # Keys: device PK; session PK over the triple + FK with cascade.
        assert _constraint_defs(engine, _DEVICE_TABLE) == [
            ("p", "PRIMARY KEY (device_id)")
        ]
        assert _constraint_defs(engine, _SESSION_TABLE) == [
            (
                "f",
                "FOREIGN KEY (device_id) REFERENCES "
                "coord.session_census_device(device_id) ON DELETE CASCADE",
            ),
            ("p", "PRIMARY KEY (device_id, session_id, pid)"),
        ]

        # 4. Defaults.
        received = column_info(engine, _DEVICE_TABLE, "received_at")
        assert received is not None and received[2] == "now()"
        observed = column_info(engine, _DEVICE_TABLE, "observed_at")
        assert observed is not None and observed[2] is None, (
            "observed_at is the runner's clock and must have no server default"
        )
        hosted = column_info(engine, _SESSION_TABLE, "runner_hosted")
        assert hosted is not None and hosted[2] == "false"

        # 5. The FK refuses an orphan session row.
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    _INSERT_SESSION,
                    {"device": _DEVICE, "session": _SESSION, "pid": 100},
                )

        # 6. The same session on two pids is two rows; the same triple twice
        #    is refused.
        with engine.begin() as conn:
            conn.execute(_INSERT_DEVICE, {"device": _DEVICE, "observed": _OBSERVED})
            for pid in (100, 200):
                conn.execute(
                    _INSERT_SESSION,
                    {"device": _DEVICE, "session": _SESSION, "pid": pid},
                )
        assert _session_count(engine, device=_DEVICE) == 2
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    _INSERT_SESSION,
                    {"device": _DEVICE, "session": _SESSION, "pid": 100},
                )
        with engine.connect() as conn:
            stamped = conn.execute(
                text(
                    """
                    SELECT received_at IS NOT NULL
                      FROM coord.session_census_device WHERE device_id = :device
                    """
                ),
                {"device": _DEVICE},
            ).scalar_one()
        assert stamped is True

        # 7. Deleting the device row cascades to its sessions.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM coord.session_census_device WHERE device_id = :device"
                ),
                {"device": _DEVICE},
            )
        assert _session_count(engine, device=_DEVICE) == 0

        # 8. Downgrade — both tables and the index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _SESSION_TABLE)
        assert not table_exists(engine, "coord", _DEVICE_TABLE)
        assert not index_exists(engine, _INDEX)
