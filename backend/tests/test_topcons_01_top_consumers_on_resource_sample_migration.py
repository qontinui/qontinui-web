"""Schema + round-trip test for the ``topcons_01`` revision.

Phase 4 of plan
``2026-11-05-devops-a-host-commit-climb-to-99-7-percent-names-no-consumer-and-reads-ok-two-minutes-out``
adds one nullable ``top_consumers JSONB`` column to
``coord.device_resource_samples``. The contract around that ALTER:

1. **The column NAME and TYPE are an interface.** coord names the column in
   its INSERT and reads, and ``IF NOT EXISTS`` is type-blind, so a wrong type
   is never repaired by re-running the revision.
2. **Nullable with no DEFAULT.** A NULL is "publisher predates the field /
   read failed" and renders UNKNOWN; a default of ``'{}'`` or ``'[]'`` would
   fabricate "no consumers".
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
_REVISION_ID = "topcons_01"
_PARENT_REVISION_ID = "pr_events_mergeability_head_idx_01"
_LOCK_BOUND = "SET LOCAL lock_timeout = '3s'"
_REVISION_FILENAME = "topcons_01_top_consumers_on_resource_sample.py"
_PLAN_STEM = (
    "2026-11-05-devops-a-host-commit-climb-to-99-7-percent-names-no-consumer"
    "-and-reads-ok-two-minutes-out"
)

_SCHEMA = "coord"
_SAMPLE_TABLE = "device_resource_samples"

# (column, DDL type) — spelled as the revision's own DDL spells it. Pinned to
# the revision's `_TOP_CONSUMER_COLUMNS`.
_EXPECTED_SAMPLE_DDL: tuple[tuple[str, str], ...] = (("top_consumers", "JSONB"),)

# PostgreSQL's own `information_schema.columns.data_type` spelling. Kept
# separate so the live assertion does not derive its expectation from the
# thing under test.
_PG_TYPE = {"JSONB": "jsonb"}


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


def test_the_revision_names_the_column_coord_reads_from_its_list() -> None:
    """The static SQL is checked against this list, so it IS the interface."""
    module = _revision_module()
    assert tuple(module._TOP_CONSUMER_COLUMNS) == _EXPECTED_SAMPLE_DDL, (
        "the revision's column list changed; coord names this column in its "
        "INSERT and reads, so a rename or retype breaks the push"
    )
    assert module._SAMPLE_TABLE == f"{_SCHEMA}.{_SAMPLE_TABLE}"
    for name, ddl_type in _EXPECTED_SAMPLE_DDL:
        assert ddl_type in _PG_TYPE, f"{name}: unmapped {ddl_type}"


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


def test_upgrade_adds_exactly_the_listed_column(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _recorded_sql(monkeypatch, "upgrade")
    add = _alter_statement(statements, "ADD")
    added = re.findall(r"ADD COLUMN IF NOT EXISTS (\w+) (\w+)", add)
    assert tuple(added) == _EXPECTED_SAMPLE_DDL, added
    assert add.count("ADD COLUMN") == len(_EXPECTED_SAMPLE_DDL)


def test_downgrade_drops_exactly_the_listed_column(
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
    """Nullable, no DEFAULT, no CHECK (validated app-side), and no DROP."""
    up = "\n".join(_recorded_sql(monkeypatch, "upgrade"))
    ddl = "\n".join(sql for sql in up.split("\n") if "ADD COLUMN" in sql)
    assert not re.search(r"\bDROP\b", up)
    assert not re.search(r"\bNOT NULL\b|\bDEFAULT\b|\bCHECK\b", ddl, re.I), (
        "the ADD carries NOT NULL / DEFAULT / CHECK; NULL is load-bearing "
        "(UNKNOWN, never 'no consumers') and the shape is validated app-side"
    )


def test_the_column_comment_states_its_null_contract() -> None:
    body = _expected_comment("top_consumers")
    assert "NULL" in body
    assert "UNKNOWN" in body, "the comment must say NULL renders UNKNOWN"
    assert "22P05" in body, "the comment must carry the NUL-sanitize rule"
    assert "never a command line" in body


def test_upgrade_comments_exactly_the_added_column(
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
    assert "Phase 4" in doc
    assert "c79a07d5-7e40-49b4-87fa-554c749f9644" in doc
    assert "Present" in doc, "the deploy-ordering note names the readiness probe"
    assert "migration_order" in doc
    assert "prune_samples" in doc
    assert "COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS" in doc


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _assert_column_present(engine: Engine) -> None:
    for name, ddl_type in _EXPECTED_SAMPLE_DDL:
        info = column_info(engine, _SAMPLE_TABLE, name)
        assert info is not None, f"{name} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == _PG_TYPE[ddl_type], data_type
        assert is_nullable == "YES", f"{name} is NOT NULL"
        assert default is None, f"{name} carries DEFAULT {default!r}"


def _assert_column_commented(engine: Engine) -> None:
    for name, _ in _EXPECTED_SAMPLE_DDL:
        live = column_comment(engine, _SAMPLE_TABLE, name)
        assert live == _expected_comment(name), (
            f"{name}'s live comment differs from the revision's"
        )


def _assert_column_absent(engine: Engine) -> None:
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
    with ephemeral_database(admin_url, "topcons01r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_column_absent(engine)
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
        _assert_column_present(engine)
        _assert_column_commented(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_column_absent(engine)
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
        _assert_column_present(engine)
        _assert_column_commented(engine)


def test_an_unread_row_is_null_and_a_reading_round_trips() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "topcons01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        unread = uuid.uuid4()
        measured = uuid.uuid4()
        consumers = {
            "entries": [
                {
                    "pid": 1234,
                    "name": "node.exe",
                    "private_bytes": 61_234_567_890,
                    "started_at": "2026-11-05T14:16:02Z",
                }
            ],
            "scanned": 812,
            "unreadable": 37,
            "attributed_private_bytes": 98_765_432_100,
        }
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
                        (device_id, lane, sampled_at, source, top_consumers)
                    VALUES (:measured, 'host', now(), 'runner',
                            CAST(:consumers AS JSONB))
                    """
                ),
                {"measured": str(measured), "consumers": json.dumps(consumers)},
            )
            rows = {
                str(row[0]): row[1]
                for row in conn.execute(
                    text(
                        "SELECT device_id, top_consumers "
                        "FROM coord.device_resource_samples "
                        "WHERE device_id IN (:unread, :measured)"
                    ),
                    {"unread": str(unread), "measured": str(measured)},
                )
            }

        assert rows[str(unread)] is None, (
            "a row from a publisher that omits top_consumers must read NULL "
            "(UNKNOWN), never a fabricated empty list"
        )
        assert rows[str(measured)] == consumers


def test_upgrade_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-running the revision's own ADD is a no-op, not an error."""
    add = _alter_statement(_recorded_sql(monkeypatch, "upgrade"), "ADD")
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "topcons01i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_present(engine)
        with engine.begin() as conn:
            conn.execute(text(add))
        _assert_column_present(engine)
        _assert_column_commented(engine)
