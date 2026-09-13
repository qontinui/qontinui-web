"""Schema + round-trip test for the ``drr_01`` revision.

Phase 5 of plan ``2026-09-13-drained-runner-never-reaches-idle`` adds seven
readiness / wind-down columns to ``coord.device_resource_samples``. The DDL is
one ALTER; the contract is everything around it, and none of it is visible from
a passing ``upgrade``, because the consumer is coord and every way coord could
notice a violation is deliberately disabled:

1. **The column NAMES are an interface.** coord reads them over
   ``pg_error::is_missing_schema_object``, which swallows SQLSTATE 42703, so a
   typo idles forever with no error.
2. **The TYPES are an interface, and ``IF NOT EXISTS`` is type-blind.** coord's
   ``row.get::<Option<i32>>`` against a BIGINT panics rather than degrading.
3. **Every column nullable with no DEFAULT.** NULL is UNKNOWN; ``readiness_safe``
   defaulted to either boolean, or a counter defaulted to 0, fabricates a
   verdict on every row an older runner sends.
4. **NULL and ``[]`` stay distinct on ``wind_down_sessions``.**
5. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
6. **Every column carries its ``COMMENT``.**

``migration-reversal.yml`` walks the chain against an EMPTY database, so it
proves the SQL parses and nothing more.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. A skip proves nothing — point it at a
live instance with ``QONTINUI_TEST_PG=host:port`` (not ``DATABASE_URL``, which
``conftest.py`` overwrites at import time).
"""

from __future__ import annotations

import ast
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top cannot
# silently change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test below enforces it. When coord
# re-points the revision at land time, re-point BOTH together.
_REVISION_ID = "drr_01"
_PARENT_REVISION_ID = "presetprov01_allow_preset_provisional_profile_source"
_REVISION_FILENAME = "drr_01_readiness_on_resource_sample.py"

_TABLE = "device_resource_samples"
_QUALIFIED = f"coord.{_TABLE}"

# (column, information_schema.data_type) — PostgreSQL's own spellings.
_EXPECTED: tuple[tuple[str, str], ...] = (
    ("readiness_safe", "boolean"),
    ("readiness_reason", "text"),
    ("readiness_blocking", "integer"),
    ("readiness_finished", "integer"),
    ("wind_down_candidates", "integer"),
    ("wind_down_exit_stuck", "integer"),
    ("wind_down_sessions", "jsonb"),
)

# The same seven, spelled as the revision's own DDL spells them. Only THIS tuple
# is pinned to the revision's `_READINESS_COLUMNS`; the two are reconciled by
# `test_the_two_column_tables_describe_the_same_seven`.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (
    ("readiness_safe", "BOOLEAN"),
    ("readiness_reason", "TEXT"),
    ("readiness_blocking", "INTEGER"),
    ("readiness_finished", "INTEGER"),
    ("wind_down_candidates", "INTEGER"),
    ("wind_down_exit_stuck", "INTEGER"),
    ("wind_down_sessions", "JSONB"),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    """The comment body the REVISION emits, read out of its own source."""
    return comment_body_from_source(_revision_source(), f"{_QUALIFIED}.{column}")


def _revision_module():
    return load_revision_module(_revision_path(), f"_rev_{_REVISION_ID}")


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """The walk target below is only correct while this equality holds."""
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision was re-pointed onto a new chain head and "
        "`_PARENT_REVISION_ID` was not updated with it"
    )


def test_the_revision_names_the_columns_coord_reads_from_one_list() -> None:
    """The ADDs are generated, so the module constant IS the interface."""
    module = _revision_module()
    assert tuple(module._READINESS_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list changed; coord reads these names over a "
        "42703-swallowing degrade path, so a rename idles forever with no error"
    )
    assert module._TABLE == _QUALIFIED


def test_the_two_column_tables_describe_the_same_seven() -> None:
    """`_EXPECTED` and `_EXPECTED_DDL` cannot drift into different sets."""
    assert [name for name, _ in _EXPECTED] == [name for name, _ in _EXPECTED_DDL]
    for (name, pg_type), (_, ddl_type) in zip(_EXPECTED, _EXPECTED_DDL, strict=True):
        assert ddl_type.lower() == pg_type, (
            f"{name}: the DDL says {ddl_type} and the schema assertion expects "
            f"{pg_type}; IF NOT EXISTS is type-blind"
        )


def test_the_revision_comments_every_column_it_adds() -> None:
    """Seven generated ADDs, seven hand-written COMMENTs — pinned together."""
    source = _revision_source()
    for name, _ in _EXPECTED_DDL:
        marker = f"COMMENT ON COLUMN {_QUALIFIED}.{name} IS"
        assert marker in source, f"{name} is added but carries no COMMENT"
        assert "NULL" in _expected_comment(name), (
            f"{name}'s comment must state what NULL means"
        )


def test_the_readiness_safe_comment_forbids_defaulting_either_way() -> None:
    """NULL is UNKNOWN, not safe and not unsafe — the load-bearing rule."""
    body = _expected_comment("readiness_safe")
    assert "UNKNOWN" in body
    assert "true" in body and "false" in body


def test_the_revision_docstring_states_the_retention_posture() -> None:
    """The plan requires the retention finding to be written into the revision."""
    module = _revision_module()
    doc = module.__doc__ or ""
    assert "prune_samples" in doc
    assert "COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS" in doc
    assert "DEFAULT_CONTINUATION_SESSION_CAP" in doc


def test_the_revision_generates_its_drops_from_the_same_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Downgrade must be the exact inverse, over the one list."""
    module = _revision_module()
    adds = module._add_columns(_QUALIFIED)

    executed: list[str] = []

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

    monkeypatch.setattr(module, "op", _RecordingOp)
    module.downgrade()

    drops = "\n".join(executed)
    assert executed, "downgrade() emitted no SQL at all"
    assert f"ALTER TABLE {_QUALIFIED}" in drops
    for name, sql_type in _EXPECTED_DDL:
        assert f"ADD COLUMN IF NOT EXISTS {name} {sql_type}" in adds
        assert f"DROP COLUMN IF EXISTS {name}" in drops


def test_no_module_level_drop_template_reappears() -> None:
    """No DROP COLUMN text outside downgrade(), where the drop guard reads it."""
    tree = ast.parse(_revision_source())
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade":
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # the module docstring is prose
        for literal in (
            n.value
            for n in ast.walk(node)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
        ):
            assert "DROP COLUMN" not in literal.upper(), (
                "a DROP COLUMN template reappeared OUTSIDE downgrade()"
            )


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _assert_columns_present(engine: Engine) -> None:
    for name, pg_type in _EXPECTED:
        info = column_info(engine, _TABLE, name)
        assert info is not None, f"{name} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == pg_type, f"{name} is {data_type}, expected {pg_type}"
        assert is_nullable == "YES", f"{name} is NOT NULL; NULL must mean UNKNOWN"
        assert default is None, (
            f"{name} carries DEFAULT {default!r}; that fabricates a verdict into "
            "every row a pre-Phase-7 runner sends"
        )


def _assert_columns_commented(engine: Engine) -> None:
    for name, _ in _EXPECTED:
        live = column_comment(engine, _TABLE, name)
        assert live == _expected_comment(name), (
            f"{name}'s live comment differs from the one its revision emits"
        )


def _assert_columns_absent(engine: Engine) -> None:
    for name, _ in _EXPECTED:
        assert column_info(engine, _TABLE, name) is None, f"{name} survived downgrade"


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def test_an_older_runner_row_reads_unknown_and_a_wind_down_row_round_trips() -> None:
    """A row omitting the fields stays NULL; a draining row keeps NULL vs []."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "drr01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)

        older = uuid.uuid4()
        idle = uuid.uuid4()
        draining = uuid.uuid4()
        sessions = [
            {
                "claude_code_session_id": "s-1",
                "blocks_restart": True,
                "idle_state": "idle",
                "close_eligible_at": "2026-09-13T12:00:00Z",
                "exit_stuck": False,
            }
        ]
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:older, 'host', now(), 'test')
                    """
                ),
                {"older": str(older)},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source, readiness_safe,
                         readiness_reason, readiness_blocking, readiness_finished,
                         wind_down_candidates, wind_down_exit_stuck,
                         wind_down_sessions)
                    VALUES
                        (:idle, 'host', now(), 'test', true, 'idle',
                         0, 0, 0, 0, '[]'::jsonb),
                        (:draining, 'host', now(), 'test', false, 'sessions_open',
                         1, 1, 1, 0, CAST(:sessions AS jsonb))
                    """
                ),
                {
                    "idle": str(idle),
                    "draining": str(draining),
                    "sessions": json.dumps(sessions),
                },
            )
            rows = {
                str(r[0]): tuple(r[1:])
                for r in conn.execute(
                    text(
                        """
                        SELECT device_id, readiness_safe, readiness_reason,
                               readiness_blocking, readiness_finished,
                               wind_down_candidates, wind_down_exit_stuck,
                               wind_down_sessions
                          FROM coord.device_resource_samples
                         WHERE device_id IN (:older, :idle, :draining)
                        """
                    ),
                    {"older": str(older), "idle": str(idle), "draining": str(draining)},
                )
            }

        assert rows[str(older)] == (None,) * 7, (
            "a row from a runner that omits the fields must read UNKNOWN on all "
            "seven, never a fabricated verdict or zero"
        )
        assert rows[str(idle)] == (True, "idle", 0, 0, 0, 0, [])
        assert rows[str(draining)] == (False, "sessions_open", 1, 1, 1, 0, sessions)
        assert rows[str(older)][6] is None and rows[str(idle)][6] == [], (
            "NULL (not probed) and [] (nothing winding down) must stay distinct"
        )


def test_up_down_up_leaves_no_residue_and_keeps_the_sample_row() -> None:
    """Downgrade drops seven columns and touches nothing else."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "drr01r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        device_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:device_id, 'host', now(), 'test')
                    """
                ),
                {"device_id": str(device_id)},
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert table_exists(engine, "coord", _TABLE), (
            "downgrade dropped the TABLE; it belongs to fleet_res_tel_01"
        )
        with engine.connect() as conn:
            survived = conn.execute(
                text(
                    "SELECT count(*) FROM coord.device_resource_samples "
                    "WHERE device_id = :device_id"
                ),
                {"device_id": str(device_id)},
            ).scalar_one()
        assert survived == 1, "downgrade destroyed a pre-existing sample row"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)


def test_upgrade_is_idempotent() -> None:
    """Re-running the revision's own ADD is a no-op, not an error."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "drr01i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        module = _revision_module()
        with engine.begin() as conn:
            conn.execute(text(module._add_columns(_QUALIFIED)))

        _assert_columns_present(engine)
        _assert_columns_commented(engine)
