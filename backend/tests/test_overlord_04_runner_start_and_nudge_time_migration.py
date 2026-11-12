"""Schema + round-trip test for the ``overlord_04_runner_start_and_nudge_time`` revision.

Phase 1 of plan
``2026-11-02-overlord-flow-cannot-see-a-same-build-restart-and-credits-a-nudge-that-never-landed``
adds ``coord.overlord_passes.runner_started_at`` and
``coord.overlord_pass_rows.nudge_measured_at``, both nullable ``TIMESTAMPTZ``.
The contract around those ALTERs:

1. **Column NAMES and TYPES are an interface.** coord names them in its INSERTs
   and flow reads, and ``IF NOT EXISTS`` is type-blind, so a wrong type is
   never repaired by re-running the revision.
2. **Nullable with no DEFAULT.** NULL is UNKNOWN (no runner start read; no
   measured prompt), and the flow engine fails closed on it. A default would
   fabricate a reading.
3. **Every ``op.execute`` is one static literal** (coord's migration classifier
   reads nothing else), and DROPs live only in ``downgrade()``.
4. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
5. **The chain has exactly one head, and this revision is on it.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing.
"""

from __future__ import annotations

import ast
import re
import uuid
from datetime import UTC, datetime
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

# Pinned explicitly rather than "head". `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test enforces it. If the alembic
# head moves before landing, re-point BOTH together.
_REVISION_ID = "overlord_04_runner_start_and_nudge_time"
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"
_LOCK_BOUND = "SET LOCAL lock_timeout = '3s'"
_REVISION_FILENAME = "overlord_04_runner_start_and_nudge_time.py"
_PLAN_STEM = (
    "2026-11-02-overlord-flow-cannot-see-a-same-build-restart-and-credits-a-nudge"
    "-that-never-landed"
)

_SCHEMA = "coord"

# (table, column, DDL type) — spelled as the revision's own DDL spells it.
_EXPECTED_DDL: tuple[tuple[str, str, str], ...] = (
    ("overlord_passes", "runner_started_at", "TIMESTAMPTZ"),
    ("overlord_pass_rows", "nudge_measured_at", "TIMESTAMPTZ"),
)

# PostgreSQL's own `information_schema.columns.data_type` spelling.
_PG_TYPE = {"TIMESTAMPTZ": "timestamp with time zone"}


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), "_rev_overlord_04")


def _expected_comment(table: str, column: str) -> str:
    """The comment body the REVISION emits, read out of its own source."""
    return comment_body_from_source(_revision_source(), f"{_SCHEMA}.{table}.{column}")


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision was re-pointed onto a new chain head and "
        "`_PARENT_REVISION_ID` was not updated with it"
    )
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


def test_no_file_of_this_change_is_named_after_a_security_glob() -> None:
    for name in (_REVISION_FILENAME, Path(__file__).name):
        assert "token" not in name.lower(), name


def test_the_revision_names_the_columns_coord_reads_from_its_list() -> None:
    module = _revision_module()
    assert tuple(module._ADDED_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list changed; coord names these columns in its "
        "INSERTs and flow reads, so a rename or retype breaks the pass write"
    )
    for _, name, ddl_type in _EXPECTED_DDL:
        assert ddl_type in _PG_TYPE, f"{name}: unmapped {ddl_type}"


def _recorded_sql(monkeypatch: pytest.MonkeyPatch, step: str) -> list[str]:
    module = _revision_module()
    executed: list[str] = []

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

    monkeypatch.setattr(module, "op", _RecordingOp)
    getattr(module, step)()
    return executed


def _alter_statements(statements: list[str], verb: str) -> dict[str, str]:
    """table -> its ONE ``ALTER TABLE coord.<table> <verb> COLUMN`` statement."""
    found: dict[str, str] = {}
    for sql in statements:
        match = re.match(rf"^\s*ALTER TABLE {_SCHEMA}\.(\w+)\s", sql)
        if match and f"{verb} COLUMN" in sql.upper():
            assert match.group(1) not in found, f"two {verb}s on {match.group(1)}"
            found[match.group(1)] = sql
    return found


def test_upgrade_adds_exactly_the_listed_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adds = _alter_statements(_recorded_sql(monkeypatch, "upgrade"), "ADD")
    added = {
        (table, *pair)
        for table, sql in adds.items()
        for pair in re.findall(r"ADD COLUMN IF NOT EXISTS (\w+) (\w+)", sql)
    }
    assert added == set(_EXPECTED_DDL), added
    assert sum(sql.count("ADD COLUMN") for sql in adds.values()) == len(_EXPECTED_DDL)


def test_downgrade_drops_exactly_the_listed_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _recorded_sql(monkeypatch, "downgrade")
    assert statements[0] == _LOCK_BOUND, statements
    assert len(statements) == 1 + len(_EXPECTED_DDL), statements
    drops = _alter_statements(statements, "DROP")
    dropped = {
        (table, name)
        for table, sql in drops.items()
        for name in re.findall(r"DROP COLUMN IF EXISTS (\w+)", sql)
    }
    assert dropped == {(table, name) for table, name, _ in _EXPECTED_DDL}


def test_both_directions_open_with_the_lock_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for direction in ("upgrade", "downgrade"):
        statements = _recorded_sql(monkeypatch, direction)
        assert statements[0] == _LOCK_BOUND, (direction, statements[0])
        assert sum(1 for sql in statements if "lock_timeout" in sql) == 1


def test_upgrade_never_drops_defaults_or_constrains(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    up = "\n".join(_recorded_sql(monkeypatch, "upgrade"))
    ddl = "\n".join(line for line in up.split("\n") if "ADD COLUMN" in line)
    assert not re.search(r"\bDROP\b", up)
    assert not re.search(r"\bNOT NULL\b|\bDEFAULT\b|\bCHECK\b", ddl, re.I), (
        "an ADD carries NOT NULL / DEFAULT / CHECK; NULL is load-bearing (UNKNOWN)"
    )


def test_the_column_comments_state_their_null_contract() -> None:
    started = _expected_comment("overlord_passes", "runner_started_at")
    assert "uptimeSeconds" in started
    assert "UNKNOWN" in started, "a NULL start must read as UNKNOWN"
    measured = _expected_comment("overlord_pass_rows", "nudge_measured_at")
    assert "observed_at" in measured, "the comment must state coord's comparison"
    assert "NULL" in measured


def test_upgrade_comments_exactly_the_added_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commented = {
        (match.group(1), match.group(2))
        for sql in _recorded_sql(monkeypatch, "upgrade")
        for match in [
            re.match(rf"\s*COMMENT ON COLUMN {_SCHEMA}\.(\w+)\.(\w+) IS\s", sql)
        ]
        if match
    }
    assert commented == {(table, name) for table, name, _ in _EXPECTED_DDL}


def test_every_op_execute_takes_a_static_string_literal() -> None:
    """coord's migration classifier cannot read a dynamic ``op.execute`` argument."""
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


def test_the_docstring_states_the_plan_and_the_ordering() -> None:
    doc = _revision_module().__doc__ or ""
    assert _PLAN_STEM in doc
    assert "Phase 1" in doc
    assert "07ee0f09-ff6c-4247-8647-0e60757c3aa7" in doc
    assert "schema.manifest" in doc, "the deploy-ordering note names coord's pin"


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _assert_columns_present(engine: Engine) -> None:
    for table, name, ddl_type in _EXPECTED_DDL:
        info = column_info(engine, table, name)
        assert info is not None, f"{table}.{name} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == _PG_TYPE[ddl_type], data_type
        assert is_nullable == "YES", f"{table}.{name} is NOT NULL"
        assert default is None, f"{table}.{name} carries DEFAULT {default!r}"
        assert column_comment(engine, table, name) == _expected_comment(table, name)


def _assert_columns_absent(engine: Engine) -> None:
    for table, name, _ in _EXPECTED_DDL:
        assert column_info(engine, table, name) is None, f"{table}.{name} survived"


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def _insert_pass_and_row(engine: Engine) -> uuid.UUID:
    pass_id = uuid.uuid4()
    now = datetime.now(UTC)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.overlord_passes
                    (pass_id, tenant_id, runner_port, scope, filter, mode,
                     skipped_steps, started_at, step_counts, verdict_histogram,
                     overlord_versions, row_count)
                VALUES (:pass_id, :tenant_id, 9876, 'full', '{}'::jsonb, 'report',
                        ARRAY[]::text[], :now, '{}'::jsonb, '{}'::jsonb,
                        '{}'::jsonb, 1)
                """
            ),
            {"pass_id": str(pass_id), "tenant_id": str(uuid.uuid4()), "now": now},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.overlord_pass_rows
                    (pass_id, tenant_id, terminal_id, observed_at, verdict,
                     reason_codes, action, detail)
                SELECT pass_id, tenant_id, 't1', started_at, 'STOPPED',
                       ARRAY[]::text[], 'none', '{}'::jsonb
                  FROM coord.overlord_passes WHERE pass_id = :pass_id
                """
            ),
            {"pass_id": str(pass_id)},
        )
    return pass_id


def _row_count(engine: Engine, pass_id: uuid.UUID) -> tuple[int, int]:
    with engine.connect() as conn:
        passes = conn.execute(
            text("SELECT count(*) FROM coord.overlord_passes WHERE pass_id = :p"),
            {"p": str(pass_id)},
        ).scalar_one()
        rows = conn.execute(
            text("SELECT count(*) FROM coord.overlord_pass_rows WHERE pass_id = :p"),
            {"p": str(pass_id)},
        ).scalar_one()
    return int(passes), int(rows)


def test_up_down_up_leaves_no_residue_and_keeps_existing_rows() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "overlord04r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        pass_id = _insert_pass_and_row(engine)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        with engine.connect() as conn:
            started, measured = conn.execute(
                text(
                    """
                    SELECT p.runner_started_at, r.nudge_measured_at
                      FROM coord.overlord_passes p
                      JOIN coord.overlord_pass_rows r USING (pass_id)
                     WHERE p.pass_id = :p
                    """
                ),
                {"p": str(pass_id)},
            ).one()
        assert started is None and measured is None, (
            "a row written before the field existed must read NULL (UNKNOWN)"
        )

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        for table, _, _ in _EXPECTED_DDL:
            assert table_exists(engine, _SCHEMA, table)
        assert _row_count(engine, pass_id) == (1, 1), "downgrade destroyed rows"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
