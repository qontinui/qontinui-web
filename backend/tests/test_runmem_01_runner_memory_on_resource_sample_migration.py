"""Schema + round-trip test for the ``runmem_01`` revision.

Phase 1 of plan
``2026-11-11-devops-runner-self-rss-is-absent-from-the-resource-sample``
adds three nullable runner self-memory columns to
``coord.device_resource_samples``: ``runner_private_bytes BIGINT``,
``runner_rss_bytes BIGINT`` and ``runner_started_at TIMESTAMPTZ``. The contract
around that ALTER:

1. **The column NAMES and TYPES are an interface.** coord names the columns in
   its INSERT and reads, and ``IF NOT EXISTS`` is type-blind, so a wrong type
   is never repaired by re-running the revision. A 65 GiB runner must fit, so
   the byte columns are BIGINT.
2. **Nullable with no DEFAULT, no constraint, and no grade column.** A NULL is
   "publisher predates the field / read failed / not the host lane" and renders
   UNKNOWN; a default of ``0`` would show a leaking runner as the leanest one
   in the fleet. The grade is computed by coord at read time, never stored.
   Checked on the WHOLE ADD statement, and live in ``pg_constraint``.
3. **Every ``op.execute`` is one static literal** (coord's migration
   classifier reads nothing else), and DROPs live only in ``downgrade()``.
4. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
5. **The chain has exactly one head, and this revision is on it.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing: point it
at a live instance with ``QONTINUI_TEST_PG=host:port`` or
``QONTINUI_TEST_PG_DSN``.
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

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST
# equal the revision's own `down_revision` — the first test below enforces
# it. If the alembic head moves before landing, re-point BOTH together.
_REVISION_ID = "runmem_01"
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"
_LOCK_BOUND = "SET LOCAL lock_timeout = '3s'"
_REVISION_FILENAME = "runmem_01_runner_memory_on_resource_sample.py"
_PLAN_STEM = "2026-11-11-devops-runner-self-rss-is-absent-from-the-resource-sample"

_SCHEMA = "coord"
_SAMPLE_TABLE = "device_resource_samples"

# (column, DDL type) — spelled as the revision's own DDL spells it. Pinned to
# the revision's `_RUNNER_MEMORY_COLUMNS`.
_EXPECTED_SAMPLE_DDL: tuple[tuple[str, str], ...] = (
    ("runner_private_bytes", "BIGINT"),
    ("runner_rss_bytes", "BIGINT"),
    ("runner_started_at", "TIMESTAMPTZ"),
)
_BYTE_COLUMNS = ("runner_private_bytes", "runner_rss_bytes")

# PostgreSQL's own `information_schema.columns.data_type` spelling. Kept
# separate so the live assertion does not derive its expectation from the
# thing under test.
_PG_TYPE = {"BIGINT": "bigint", "TIMESTAMPTZ": "timestamp with time zone"}

# Clauses that must appear nowhere in the ADD statement: each one either
# fabricates a reading or puts a second door on an input coord validates
# app-side. Matched on the statement's whole upper-cased text, so a clause on a
# continuation line, or a table constraint added in the same ALTER, is caught.
_FORBIDDEN_ADD_CLAUSES: tuple[str, ...] = (
    "NOT NULL",
    "DEFAULT",
    "CHECK",
    "CONSTRAINT",
    "REFERENCES",
    "UNIQUE",
)

# The plan's Evidence for nilan (device 4b426e2b-cc10-4870-80a5-524aaac70719),
# 2026-11-11T12:31Z: VmRSS 68093452 kB, and its Phase 2 fixture of about
# 67.0 GiB private. The start is the runner unit's ActiveEnterTimestamp,
# 2026-11-04 23:05:38 CET. Both byte values exceed INTEGER's 2**31 - 1.
_NILAN_VMRSS_BYTES = 68_093_452 * 1024
_NILAN_SCALE_PRIVATE_BYTES = 67 * 1024**3
_NILAN_RUNNER_STARTED_AT = datetime(2026, 11, 4, 22, 5, 38, tzinfo=UTC)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_rev_{_REVISION_ID}")


def _expected_comment(column: str) -> str:
    """The comment body the REVISION emits, read out of its own source."""
    return comment_body_from_source(
        _revision_source(), f"{_SCHEMA}.{_SAMPLE_TABLE}.{column}"
    )


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


def test_no_file_of_this_change_is_named_after_a_security_glob() -> None:
    """The security-surface glob `**/*token*` matches file names."""
    for name in (_REVISION_FILENAME, Path(__file__).name):
        assert "token" not in name.lower(), name


def test_the_revision_names_the_columns_coord_reads_from_its_list() -> None:
    """The static SQL is checked against this list, so it IS the interface."""
    module = _revision_module()
    assert tuple(module._RUNNER_MEMORY_COLUMNS) == _EXPECTED_SAMPLE_DDL, (
        "the revision's column list changed; coord names these columns in its "
        "INSERT and reads, so a rename or retype breaks the push"
    )
    assert module._SAMPLE_TABLE == f"{_SCHEMA}.{_SAMPLE_TABLE}"
    names = [name for name, _ in _EXPECTED_SAMPLE_DDL]
    assert len(names) == len(set(names)), "a column is listed twice"
    for name, ddl_type in _EXPECTED_SAMPLE_DDL:
        assert ddl_type in _PG_TYPE, f"{name}: unmapped {ddl_type}"
    for name in _BYTE_COLUMNS:
        assert dict(_EXPECTED_SAMPLE_DDL)[name] == "BIGINT", (
            f"{name} must be BIGINT: a 65 GiB runner overflows INTEGER"
        )


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


def _alter_statement(statements: list[str], verb: str) -> str:
    """The ONE ``ALTER TABLE coord.device_resource_samples <verb> COLUMN``."""
    head = re.compile(rf"^\s*ALTER TABLE {_SCHEMA}\.{_SAMPLE_TABLE}\s")
    found = [
        sql for sql in statements if head.match(sql) and f"{verb} COLUMN" in sql.upper()
    ]
    assert len(found) == 1, f"expected one {verb} statement, got {len(found)}"
    return found[0]


def test_upgrade_adds_exactly_the_listed_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exactly these three, so no grade column rides along."""
    statements = _recorded_sql(monkeypatch, "upgrade")
    add = _alter_statement(statements, "ADD")
    added = re.findall(r"ADD COLUMN IF NOT EXISTS (\w+) (\w+)", add)
    assert tuple(added) == _EXPECTED_SAMPLE_DDL, added
    assert add.count("ADD COLUMN") == len(_EXPECTED_SAMPLE_DDL)
    # One ALTER for the ADDs; everything else is the lock bound or a COMMENT.
    others = [sql for sql in statements if sql != add]
    assert len(others) == len(statements) - 1
    assert others[0] == _LOCK_BOUND
    assert all(sql.lstrip().startswith("COMMENT ON COLUMN") for sql in others[1:])


def test_downgrade_drops_exactly_the_listed_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Downgrade is the exact reverse: one lock bound, then one DROP."""
    statements = _recorded_sql(monkeypatch, "downgrade")
    assert statements[0] == _LOCK_BOUND, statements
    assert len(statements) == 2, statements
    drop = _alter_statement(statements, "DROP")
    dropped = re.findall(r"DROP COLUMN IF EXISTS (\w+)", drop)
    assert tuple(dropped) == tuple(name for name, _ in _EXPECTED_SAMPLE_DDL)


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
    """No NOT NULL, DEFAULT or constraint in the ADD, no DROP, and no backfill.

    The clause scan reads the WHOLE ADD statement. Reading only its
    ``ADD COLUMN`` lines let a clause on a continuation line, or an
    ``ADD CONSTRAINT`` in the same ALTER, pass.
    """
    statements = _recorded_sql(monkeypatch, "upgrade")
    assert not re.search(r"\bDROP\b", "\n".join(statements))
    add = _alter_statement(statements, "ADD").upper()
    for clause in _FORBIDDEN_ADD_CLAUSES:
        assert clause not in add, (
            f"the ADD statement carries {clause}; NULL is load-bearing "
            "(UNKNOWN, never 0) and the range is validated app-side"
        )
    backfills = [
        sql for sql in statements if re.match(r"\s*(UPDATE|INSERT)\b", sql, re.I)
    ]
    assert not backfills, (
        "the revision backfills; no historical reading exists, so rows written "
        "before it must keep NULL"
    )


def test_every_column_comment_states_its_null_contract() -> None:
    """NULL = publisher predates it / read failed / not the host lane."""
    for name, _ in _EXPECTED_SAMPLE_DDL:
        body = _expected_comment(name)
        assert "host lane only" in body, f"{name}'s comment must scope the lane"
        assert "NULL = the publisher predates the field" in body, name
        assert "UNKNOWN" in body, f"{name}'s comment must say NULL renders UNKNOWN"
    for name in _BYTE_COLUMNS:
        assert "never 0" in _expected_comment(name), (
            f"{name}'s comment must forbid a fabricated 0"
        )


def test_each_column_comment_names_its_basis_and_role() -> None:
    """Graded private basis, display-only RSS, restart-boundary start time."""
    private = _expected_comment("runner_private_bytes")
    assert "RssAnon + VmSwap" in private
    assert "PrivateUsage" in private
    assert "never a lane-pressure ranking input" in private
    rss = _expected_comment("runner_rss_bytes")
    assert "VmRSS" in rss
    assert "WorkingSetSize" in rss
    assert "DISPLAY ONLY" in rss
    assert "never graded" in rss
    started = _expected_comment("runner_started_at")
    assert "restart boundary" in started
    assert "runner_private_bytes" in started


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
    assert commented == {(_SAMPLE_TABLE, name) for name, _ in _EXPECTED_SAMPLE_DDL}


def test_every_op_execute_takes_a_static_string_literal() -> None:
    """coord's migration classifier cannot read a dynamic ``op.execute`` argument.

    ``qontinui-coord`` ``pr_merge/migration_classifier.rs`` rejects an
    ``op.execute`` whose argument carries no string literal, which would hold
    the PR on the merge train.
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
    assert "4b426e2b-cc10-4870-80a5-524aaac70719" in doc
    assert "RssAnon + VmSwap" in doc and "PrivateUsage" in doc
    assert "There is no grade column" in doc
    assert "lane_pressure()" in doc, "the docstring says it is not a ranking input"
    assert "runner_mem" in doc, "the deploy-ordering note names the readiness group"
    assert "Present" in doc, "the deploy-ordering note names the readiness probe"
    assert "migration_order" in doc
    assert "prune_samples" in doc
    assert "COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS" in doc


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _assert_no_constraint_covers_the_columns(engine: Engine) -> None:
    """No ``pg_constraint`` row (CHECK, FK, UNIQUE, ...) names the three columns.

    Asserted from the catalogue rather than from the DDL text, as
    ``test_ci_job_mem_01_memory_headroom_columns_migration.py`` does: the
    catalogue answers for every constraint at once, however it was spelled.
    """
    with engine.connect() as conn:
        covering = conn.execute(
            text(
                """
                SELECT c.conname
                  FROM pg_constraint c
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid
                   AND a.attnum = ANY (c.conkey)
                 WHERE c.conrelid = 'coord.device_resource_samples'::regclass
                   AND a.attname IN ('runner_private_bytes', 'runner_rss_bytes',
                                     'runner_started_at')
                """
            )
        ).fetchall()
    assert covering == [], (
        f"a constraint now covers a runner self-memory column ({covering}); "
        "the range is validated app-side by coord's lenient decoder, and a "
        "violating value would fail the whole multi-row INSERT"
    )


def _assert_columns_present(engine: Engine) -> None:
    for name, ddl_type in _EXPECTED_SAMPLE_DDL:
        info = column_info(engine, _SAMPLE_TABLE, name)
        assert info is not None, f"{name} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == _PG_TYPE[ddl_type], (
            f"{name} is {data_type}, expected {_PG_TYPE[ddl_type]}"
        )
        assert is_nullable == "YES", f"{name} is NOT NULL"
        assert default is None, f"{name} carries DEFAULT {default!r}"
    _assert_no_constraint_covers_the_columns(engine)


def _assert_columns_commented(engine: Engine) -> None:
    for name, _ in _EXPECTED_SAMPLE_DDL:
        live = column_comment(engine, _SAMPLE_TABLE, name)
        assert live == _expected_comment(name), (
            f"{name}'s live comment differs from the revision's"
        )


def _assert_columns_absent(engine: Engine) -> None:
    for name, _ in _EXPECTED_SAMPLE_DDL:
        assert column_info(engine, _SAMPLE_TABLE, name) is None, (
            f"{name} survived downgrade"
        )


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def test_up_down_up_leaves_no_residue_and_keeps_the_sample_row() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "runmem01r") as (engine, db_url):
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
        assert table_exists(engine, _SCHEMA, _SAMPLE_TABLE)
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


def _insert_rows(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """Insert one host row without the runner fields and one nilan-scale reading.

    Returns ``(unread, measured)``: the device id of the row a publisher that
    predates the fields would write, and of the row carrying all three.
    """
    unread = uuid.uuid4()
    measured = uuid.uuid4()
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
                     runner_private_bytes, runner_rss_bytes,
                     runner_started_at)
                VALUES (:measured, 'host', now(), 'runner',
                        :private_bytes, :rss_bytes, :started_at)
                """
            ),
            {
                "measured": str(measured),
                "private_bytes": _NILAN_SCALE_PRIVATE_BYTES,
                "rss_bytes": _NILAN_VMRSS_BYTES,
                "started_at": _NILAN_RUNNER_STARTED_AT,
            },
        )
    return unread, measured


def _read_runner_columns(engine: Engine, device_id: uuid.UUID) -> dict[str, object]:
    """The three runner columns of ``device_id``'s one sample row, by name."""
    names = tuple(name for name, _ in _EXPECTED_SAMPLE_DDL)
    with engine.connect() as conn:
        row = conn.execute(
            text(
                f"SELECT {', '.join(names)} "
                "FROM coord.device_resource_samples "
                "WHERE device_id = :device_id"
            ),
            {"device_id": str(device_id)},
        ).one()
    return dict(zip(names, row, strict=True))


def test_an_unread_row_is_null_and_a_reading_round_trips() -> None:
    """A row omitting the fields reads NULL; a nilan-scale reading round-trips."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "runmem01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unread, measured = _insert_rows(engine)
        unread_row = _read_runner_columns(engine, unread)
        reading = _read_runner_columns(engine, measured)

    assert all(value is None for value in unread_row.values()), (
        "a row from a publisher that sends no runner memory must read NULL "
        "(UNKNOWN), never a fabricated 0"
    )
    assert reading["runner_private_bytes"] == _NILAN_SCALE_PRIVATE_BYTES, (
        "a 67 GiB reading must fit; INTEGER would overflow"
    )
    assert reading["runner_rss_bytes"] == _NILAN_VMRSS_BYTES
    started_at = reading["runner_started_at"]
    assert started_at == _NILAN_RUNNER_STARTED_AT
    assert isinstance(started_at, datetime) and started_at.tzinfo is not None


def test_upgrade_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-running the revision's own ADD is a no-op, not an error."""
    add = _alter_statement(_recorded_sql(monkeypatch, "upgrade"), "ADD")
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "runmem01i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        with engine.begin() as conn:
            conn.execute(text(add))
        _assert_columns_present(engine)
        _assert_columns_commented(engine)
