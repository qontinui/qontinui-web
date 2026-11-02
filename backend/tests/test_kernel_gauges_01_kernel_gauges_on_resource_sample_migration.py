"""Schema + round-trip test for the ``kernel_gauges_01`` revision.

Phase 1 of plan
``2026-10-19-fleet-is-blind-to-kernel-object-leaks-and-os-process-creation-latency``
adds sixteen nullable kernel-gauge columns to ``coord.device_resource_samples``
and eight nullable S7-S9 control columns to BOTH
``coord.fleet_runtime_policy`` and ``coord.fleet_runtime_policy_versions``.
The contract around those ALTERs:

1. **Every column NAME and TYPE is an interface.** coord reads ``BIGINT`` as
   ``Option<i64>`` and ``INTEGER`` as ``Option<i32>``, and ``IF NOT EXISTS`` is
   type-blind, so a wrong type is never repaired by re-running the revision.
2. **Nullable with no DEFAULT, everywhere.** A NULL sample is "never read /
   read failed / not applicable", a NULL control is "use coord's compiled
   default"; a default of 0 would fabricate a healthy reading or a
   fire-on-everything threshold.
3. **The two policy tables carry the same list**, so a snapshot can never hold
   payload the parent cannot.
4. **Every ``op.execute`` is one static literal** (coord's migration
   classifier reads nothing else), and DROPs live only in ``downgrade()``.
5. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
6. **The chain has exactly one head, and this revision is on it.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing: point it
at a live instance with ``QONTINUI_TEST_PG=host:port`` or
``QONTINUI_TEST_PG_DSN``.
"""

from __future__ import annotations

import ast
import json
import re
import uuid
from pathlib import Path
from types import ModuleType

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST
# equal the revision's own `down_revision` — the first test below enforces
# it. If the alembic head moves before landing, re-point BOTH together.
_REVISION_ID = "kernel_gauges_01"
_PARENT_REVISION_ID = "coord_claude_acct_usage_04"
_LOCK_BOUND = "SET LOCAL lock_timeout = '3s'"
_REVISION_FILENAME = "kernel_gauges_01_kernel_gauges_on_resource_sample.py"
_PLAN_STEM = (
    "2026-10-19-fleet-is-blind-to-kernel-object-leaks-and-os-process-creation-latency"
)

_SCHEMA = "coord"
_SAMPLE_TABLE = "device_resource_samples"
_POLICY_TABLE = "fleet_runtime_policy"
_VERSIONS_TABLE = "fleet_runtime_policy_versions"

# (column, DDL type) — spelled as the revision's own DDL spells them. Pinned
# to the revision's `_KERNEL_GAUGE_COLUMNS` / `_KERNEL_CONTROL_COLUMNS`.
_EXPECTED_SAMPLE_DDL: tuple[tuple[str, str], ...] = (
    ("kernel_paged_bytes", "BIGINT"),
    ("kernel_nonpaged_bytes", "BIGINT"),
    ("kernel_handle_count", "BIGINT"),
    ("kernel_token_objects", "BIGINT"),
    ("kernel_process_objects", "BIGINT"),
    ("os_process_count", "INTEGER"),
    ("os_booted_at", "TIMESTAMPTZ"),
    ("kernel_pool_top_tags", "JSONB"),
    ("kernel_pool_tags_at", "TIMESTAMPTZ"),
    ("spawn_probe_p50_ms", "INTEGER"),
    ("spawn_probe_max_ms", "INTEGER"),
    ("spawn_probe_count", "INTEGER"),
    ("spawn_probe_timeouts", "INTEGER"),
    ("spawn_probe_errors", "INTEGER"),
    ("spawn_probe_error_code", "INTEGER"),
    ("kernel_source", "TEXT"),
)

_EXPECTED_CONTROL_DDL: tuple[tuple[str, str], ...] = (
    ("kernel_token_objects_warn", "BIGINT"),
    ("kernel_token_objects_breach", "BIGINT"),
    ("kernel_token_slope_warn_per_hour", "BIGINT"),
    ("kernel_pool_warn_bytes", "BIGINT"),
    ("kernel_pool_breach_bytes", "BIGINT"),
    ("kernel_nonpaged_warn_bytes", "BIGINT"),
    ("spawn_p50_warn_ms", "INTEGER"),
    ("spawn_p50_breach_ms", "INTEGER"),
)

# PostgreSQL's own `information_schema.columns.data_type` spelling of each
# DDL type. Kept separate so the live assertion does not derive its
# expectation from the thing under test.
_PG_TYPE = {
    "BIGINT": "bigint",
    "INTEGER": "integer",
    "TIMESTAMPTZ": "timestamp with time zone",
    "JSONB": "jsonb",
    "TEXT": "text",
}

# The compiled defaults plan D4 names; each control comment must state its own.
_COMPILED_DEFAULTS = {
    "kernel_token_objects_warn": "250000",
    "kernel_token_objects_breach": "1000000",
    "kernel_token_slope_warn_per_hour": "10000 per hour",
    "kernel_pool_warn_bytes": "8 GiB (8589934592)",
    "kernel_pool_breach_bytes": "16 GiB (17179869184)",
    "kernel_nonpaged_warn_bytes": "4 GiB (4294967296)",
    "spawn_p50_warn_ms": "250 ms",
    "spawn_p50_breach_ms": "1000 ms",
}

# Every (table, column list) pair the revision widens.
_TABLE_COLUMNS: tuple[tuple[str, tuple[tuple[str, str], ...]], ...] = (
    (_SAMPLE_TABLE, _EXPECTED_SAMPLE_DDL),
    (_POLICY_TABLE, _EXPECTED_CONTROL_DDL),
    (_VERSIONS_TABLE, _EXPECTED_CONTROL_DDL),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_rev_{_REVISION_ID}")


def _expected_comment(table: str, column: str) -> str:
    """The comment body the REVISION emits, read out of its own source."""
    return comment_body_from_source(_revision_source(), f"{_SCHEMA}.{table}.{column}")


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
    # The head gate's own parser must read the same single parent.
    assert (
        declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
        == _PARENT_REVISION_ID
    )
    assert module.branch_labels is None
    assert module.depends_on is None
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_the_chain_has_one_head_and_this_revision_is_on_it() -> None:
    """One head, and walking down from it reaches this revision and its parent.

    Asserting the head IS this revision would break the day a later revision
    lands on top; asserting it is an ANCESTOR of the one head stays true and
    still catches a fork (two heads) or an orphaned revision (not reachable).
    """
    config = Config(str(backend_root() / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root() / "alembic"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1, f"alembic has {len(heads)} heads: {sorted(heads)}"
    walked = [rev.revision for rev in script.walk_revisions("base", heads[0])]
    assert _REVISION_ID in walked, (
        f"{_REVISION_ID} is not an ancestor of the single head {heads[0]}"
    )
    revision = script.get_revision(_REVISION_ID)
    assert revision is not None
    assert revision.down_revision == _PARENT_REVISION_ID


def test_no_file_of_this_change_is_named_after_the_token_column() -> None:
    """Plan D2: the security-surface glob `**/*token*` matches file names."""
    for name in (_REVISION_FILENAME, Path(__file__).name):
        assert "token" not in name.lower(), name


def test_the_revision_names_the_columns_coord_reads_from_its_lists() -> None:
    """The static SQL is checked against these lists, so they ARE the interface."""
    module = _revision_module()
    assert tuple(module._KERNEL_GAUGE_COLUMNS) == _EXPECTED_SAMPLE_DDL, (
        "the revision's sample column list changed; coord names these columns "
        "in its INSERT and reads, so a rename or retype breaks the push"
    )
    assert tuple(module._KERNEL_CONTROL_COLUMNS) == _EXPECTED_CONTROL_DDL, (
        "the revision's control column list changed; coord's CONTROL_COLS and "
        "FleetPolicyControls read these names and types"
    )
    assert module._SAMPLE_TABLE == f"{_SCHEMA}.{_SAMPLE_TABLE}"
    assert tuple(module._POLICY_TABLES) == (
        f"{_SCHEMA}.{_POLICY_TABLE}",
        f"{_SCHEMA}.{_VERSIONS_TABLE}",
    )


def test_every_ddl_type_has_a_postgres_spelling_and_names_are_unique() -> None:
    """`_PG_TYPE` covers every DDL type, and no column is listed twice."""
    for table, columns in _TABLE_COLUMNS:
        names = [name for name, _ in columns]
        assert len(names) == len(set(names)), f"{table} lists a column twice"
        for name, ddl_type in columns:
            assert ddl_type in _PG_TYPE, f"{table}.{name}: unmapped {ddl_type}"
    sample_names = {name for name, _ in _EXPECTED_SAMPLE_DDL}
    control_names = {name for name, _ in _EXPECTED_CONTROL_DDL}
    assert sample_names.isdisjoint(control_names)
    assert set(_COMPILED_DEFAULTS) == control_names


def _recorded_sql(monkeypatch: pytest.MonkeyPatch, step: str) -> list[str]:
    """Run ``upgrade`` or ``downgrade`` against a recording ``op`` stub."""
    module = _revision_module()
    executed: list[str] = []

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

    monkeypatch.setattr(module, "op", _RecordingOp)
    getattr(module, step)()
    return executed


def _alter_statement(statements: list[str], table: str, verb: str) -> str:
    """The ONE ``ALTER TABLE coord.<table> <verb> COLUMN`` statement."""
    head = re.compile(rf"^\s*ALTER TABLE {_SCHEMA}\.{table}\s")
    found = [
        sql for sql in statements if head.match(sql) and f"{verb} COLUMN" in sql.upper()
    ]
    assert len(found) == 1, (
        f"expected one {verb} statement for {_SCHEMA}.{table}, got {len(found)}"
    )
    return found[0]


def test_upgrade_adds_exactly_the_listed_columns_to_each_table(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each table gets one ADD carrying exactly its list — no more, no fewer."""
    statements = _recorded_sql(monkeypatch, "upgrade")
    for table, columns in _TABLE_COLUMNS:
        add = _alter_statement(statements, table, "ADD")
        added = re.findall(r"ADD COLUMN IF NOT EXISTS (\w+) (\w+)", add)
        assert tuple(added) == columns, (
            f"{_SCHEMA}.{table}: the static ADD names {added}, the list says "
            f"{list(columns)}"
        )
        assert add.count("ADD COLUMN") == len(columns)


def test_downgrade_drops_exactly_the_listed_columns_from_each_table(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Downgrade is the exact reverse: one DROP per table over the same list."""
    statements = _recorded_sql(monkeypatch, "downgrade")
    # One lock bound first, then exactly one DROP per table.
    assert statements[0] == _LOCK_BOUND, statements
    assert len(statements) == len(_TABLE_COLUMNS) + 1, statements
    for table, columns in _TABLE_COLUMNS:
        drop = _alter_statement(statements, table, "DROP")
        dropped = re.findall(r"DROP COLUMN IF EXISTS (\w+)", drop)
        assert tuple(dropped) == tuple(name for name, _ in columns), (
            f"{_SCHEMA}.{table}: the static DROP names {dropped}"
        )
        assert drop.count("DROP COLUMN") == len(columns)


def test_both_directions_open_with_the_lock_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A queued ACCESS EXCLUSIVE request blocks every reader behind it, so the
    wait is bounded before the first ALTER in each direction."""
    for direction in ("upgrade", "downgrade"):
        statements = _recorded_sql(monkeypatch, direction)
        assert statements[0] == _LOCK_BOUND, (direction, statements[0])
        assert sum(1 for sql in statements if "lock_timeout" in sql) == 1


def test_upgrade_never_drops_defaults_or_constrains(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nullable, no DEFAULT, no CHECK (validated app-side), and no DROP."""
    up = "\n".join(_recorded_sql(monkeypatch, "upgrade"))
    ddl = "\n".join(sql for sql in up.split("\n") if "ADD COLUMN" in sql)
    assert not re.search(r"\bDROP\b", up)
    assert not re.search(r"\bNOT NULL\b|\bDEFAULT\b|\bCHECK\b", ddl, re.I), (
        "an ADD carries NOT NULL / DEFAULT / CHECK; NULL is load-bearing here "
        "and the control ranges are validated app-side by design"
    )


def test_every_sample_column_comment_states_its_null_contract() -> None:
    """NULL = never read / failed / not applicable per kernel_source."""
    for name, _ in _EXPECTED_SAMPLE_DDL:
        body = _expected_comment(_SAMPLE_TABLE, name)
        assert "NULL" in body, f"{name}'s comment must state what NULL means"
        assert "kernel_source" in body, (
            f"{name}'s comment must say kernel_source tells not-applicable from failed"
        )


def test_every_control_comment_states_its_compiled_default() -> None:
    """Parent comments name the plan D4 default; NULL is no override, not 0."""
    for name, default in _COMPILED_DEFAULTS.items():
        body = _expected_comment(_POLICY_TABLE, name)
        assert f"plan D4 at authoring: {default}" in body, (
            f"{name}'s comment must state the plan D4 default {default!r}"
        )
        assert "NULL = no override" in body


def test_every_snapshot_control_comment_points_at_its_parent() -> None:
    """The versions table carries one comment per column, naming its parent."""
    for name, _ in _EXPECTED_CONTROL_DDL:
        body = _expected_comment(_VERSIONS_TABLE, name)
        assert f"Snapshot of {_SCHEMA}.{_POLICY_TABLE}.{name};" in body
        assert _REVISION_ID in body
        assert "Immutable" in body


def test_upgrade_comments_exactly_the_added_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No COMMENT names a column the lists do not, and none is missing."""
    commented = {
        (match.group(1), match.group(2))
        for sql in _recorded_sql(monkeypatch, "upgrade")
        for match in [
            re.match(rf"\s*COMMENT ON COLUMN {_SCHEMA}\.(\w+)\.(\w+) IS\s", sql)
        ]
        if match
    }
    expected = {
        (table, name) for table, columns in _TABLE_COLUMNS for name, _ in columns
    }
    assert commented == expected


def test_every_op_execute_takes_a_static_string_literal() -> None:
    """coord's migration classifier cannot read a dynamic ``op.execute`` argument.

    ``qontinui-coord`` ``pr_merge/migration_classifier.rs`` (``classify_op``,
    the ``"execute"`` arm) rejects an ``op.execute`` whose argument carries no
    string literal: "op.execute with no static SQL string literal (dynamic =
    unsafe)". An f-string or a helper call here would hold the PR on the
    merge train.
    """
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "the revision makes no op.execute calls at all"
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"op.execute at line {call.lineno} is not a static string literal"
        )


def test_no_drop_column_text_outside_downgrade() -> None:
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
                "a DROP COLUMN template appeared OUTSIDE downgrade()"
            )


def test_the_docstring_states_why_deploy_ordering_and_retention() -> None:
    module = _revision_module()
    doc = module.__doc__ or ""
    assert _PLAN_STEM in doc
    assert "Phase 1" in doc
    assert "probe-runner-2026-10-18-typing-lag-is-process-creation" in doc
    assert "4.2M leaked Token objects" in doc
    assert "Present" in doc, "the deploy-ordering note names the readiness probe"
    assert "prune_samples" in doc
    assert "COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS" in doc


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _assert_columns_present(engine: Engine) -> None:
    for table, columns in _TABLE_COLUMNS:
        for name, ddl_type in columns:
            info = column_info(engine, table, name)
            assert info is not None, f"{table}.{name} missing after upgrade"
            data_type, is_nullable, default = info
            assert data_type == _PG_TYPE[ddl_type], (
                f"{table}.{name} is {data_type}, expected {_PG_TYPE[ddl_type]}"
            )
            assert is_nullable == "YES", f"{table}.{name} is NOT NULL"
            assert default is None, (
                f"{table}.{name} carries DEFAULT {default!r}; NULL is the "
                "honest record of no reading / no override"
            )


def _assert_columns_commented(engine: Engine) -> None:
    for table, columns in _TABLE_COLUMNS:
        for name, _ in columns:
            live = column_comment(engine, table, name)
            assert live == _expected_comment(table, name), (
                f"{table}.{name}'s live comment differs from the revision's"
            )


def _assert_columns_absent(engine: Engine) -> None:
    for table, columns in _TABLE_COLUMNS:
        for name, _ in columns:
            assert column_info(engine, table, name) is None, (
                f"{table}.{name} survived downgrade"
            )


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def test_up_down_up_leaves_no_residue_and_keeps_the_sample_row() -> None:
    """Downgrade drops exactly the added columns and touches nothing else."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "kgauges01r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
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
        _assert_columns_commented(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        for table in (_SAMPLE_TABLE, _POLICY_TABLE, _VERSIONS_TABLE):
            assert table_exists(engine, _SCHEMA, table), (
                f"downgrade dropped the TABLE {table}; it predates this revision"
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


def test_an_unread_row_is_null_and_real_readings_round_trip() -> None:
    """A row omitting the gauges reads NULL; zeros and the tag array round-trip."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "kgauges01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        unread = uuid.uuid4()
        measured = uuid.uuid4()
        top_tags = [
            {"tag": "File", "bytes": 9_700_000_000, "outstanding_allocs": 24_000_000},
            {"tag": "Toke", "bytes": 9_500_000_000, "outstanding_allocs": 4_222_956},
        ]
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:unread, 'host', now(), 'test')
                    """
                ),
                {"unread": str(unread)},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source,
                         kernel_paged_bytes, kernel_nonpaged_bytes,
                         kernel_handle_count, kernel_token_objects,
                         kernel_process_objects, os_process_count,
                         os_booted_at, kernel_pool_top_tags,
                         kernel_pool_tags_at, spawn_probe_p50_ms,
                         spawn_probe_max_ms, spawn_probe_count,
                         spawn_probe_timeouts, spawn_probe_errors,
                         spawn_probe_error_code, kernel_source)
                    VALUES
                        (:measured, 'host', now(), 'runner',
                         26900000000, 16500000000,
                         0, 4222956,
                         2930, 0,
                         '2026-10-15T08:00:00Z', CAST(:tags AS JSONB),
                         '2026-10-19T08:20:52Z', 2400,
                         30000, 10,
                         0, 0,
                         1450, 'windows:getperformanceinfo+objecttypes+pooltags')
                    """
                ),
                {"measured": str(measured), "tags": json.dumps(top_tags)},
            )
            columns = ", ".join(name for name, _ in _EXPECTED_SAMPLE_DDL)
            rows = {
                str(row[0]): row[1:]
                for row in conn.execute(
                    text(
                        f"SELECT device_id, {columns} "
                        "FROM coord.device_resource_samples "
                        "WHERE device_id IN (:unread, :measured)"
                    ),
                    {"unread": str(unread), "measured": str(measured)},
                )
            }

        assert all(value is None for value in rows[str(unread)]), (
            "a row from a publisher that omits the kernel gauges must read NULL "
            "(never read), never a fabricated 0"
        )
        reading = dict(
            zip(
                (name for name, _ in _EXPECTED_SAMPLE_DDL),
                rows[str(measured)],
                strict=True,
            )
        )
        assert reading["kernel_token_objects"] == 4_222_956
        assert reading["kernel_paged_bytes"] == 26_900_000_000, (
            "a 26.9 GB pool reading must fit; INTEGER would overflow"
        )
        assert reading["kernel_handle_count"] == 0
        assert reading["os_process_count"] == 0, "a real 0 stays distinct from NULL"
        assert reading["kernel_pool_top_tags"] == top_tags
        assert reading["spawn_probe_error_code"] == 1450
        assert reading["kernel_source"] == (
            "windows:getperformanceinfo+objecttypes+pooltags"
        )
        assert reading["os_booted_at"] is not None
        assert reading["os_booted_at"].tzinfo is not None


def test_upgrade_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-running the revision's own ADDs is a no-op, not an error."""
    statements = _recorded_sql(monkeypatch, "upgrade")
    adds = [_alter_statement(statements, table, "ADD") for table, _ in _TABLE_COLUMNS]
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "kgauges01i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        with engine.begin() as conn:
            for add in adds:
                conn.execute(text(add))

        _assert_columns_present(engine)
        _assert_columns_commented(engine)
