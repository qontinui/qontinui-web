"""Pins for alembic revision ``coord_conditions_02_honest_runs``.

Plan
``2026-11-06-a-regression-test-run-is-judged-by-what-it-covered-and-a-silent-run-reads-unknown``
Phase 3: six nullable columns on ``coord.condition_runs`` -- ``claimed_status``,
``coverage``, ``unknown_reason``, ``unknown_detail``, ``plan`` and
``plan_committed_at`` -- and nothing else. What is pinned:

1. the chain is wired: ``down_revision`` names a parent defined in exactly one
   file, and the docstring's ``Revises:`` line agrees with it (the PR re-chains
   onto ``main``'s single head at open and after every rebase, and a re-chain
   that moves one but not the other fails here);
2. ``upgrade()`` keeps the shape coord's merge-train migration classifier
   admits (``downgrade()`` is outside its scan): a bounded lock wait, then one
   ``op.add_column`` per column with an inline nullable ``sa.Column`` and
   ``if_not_exists=True``, plus the idempotency marker the classifier reads
   from the file's text. Both directions carry the ``schema="coord"`` the
   ``alembic-schema-arg-gate`` hook requires, and ``downgrade()`` reverses the
   adds as ``op.drop_column`` with ``if_exists=True``;
3. live: at the parent none of the six exist; after each upgrade all six do,
   with the planned type, nullable and with no default; after the downgrade
   they are gone, and re-applying ``downgrade()`` there is a no-op; the table
   gains no constraint and no index; a row written before the upgrade keeps
   every value through up/down/up and reads six NULLs; and re-applying
   ``upgrade()`` on top is a no-op.

The structural tests always run. The live one self-skips without a test
Postgres and REPORTS the skip (``pytest -rs``): set ``QONTINUI_TEST_PG_DSN``
(e.g. from ``ephemeral-db.sh start pgvector``) or ``QONTINUI_TEST_PG``.
"""

from __future__ import annotations

import ast
import re
import uuid
from collections.abc import Callable
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "coord_conditions_02_honest_runs"
_REVISION_FILENAME = f"{_REVISION_ID}.py"

_SCHEMA = "coord"
_TABLE = "condition_runs"
# (column, its type as written in the revision, information_schema data_type),
# in the order upgrade() adds them.
_COLUMNS = (
    ("claimed_status", "sa.Text()", "text"),
    ("coverage", "postgresql.JSONB()", "jsonb"),
    ("unknown_reason", "sa.Text()", "text"),
    ("unknown_detail", "sa.Text()", "text"),
    ("plan", "postgresql.JSONB()", "jsonb"),
    ("plan_committed_at", "sa.TIMESTAMP(timezone=True)", "timestamp with time zone"),
)
_COLUMN_NAMES = tuple(name for name, _, _ in _COLUMNS)
_LOCK_TIMEOUT = "SET LOCAL lock_timeout = '3s'"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG_DSN or QONTINUI_TEST_PG)"
    ),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """This revision's own ``down_revision``, read from the file at runtime.

    Never hardcoded: the PR re-chains ``down_revision`` onto ``main``'s single
    head, and a pinned constant would then walk back to a revision that is no
    longer this one's parent.
    """
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


def _op_calls(name: str) -> list[ast.Call]:
    """Every ``op.<method>(...)`` call in top-level ``def name()``, in source order."""
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    functions = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == name
    ]
    assert len(functions) == 1, f"{_REVISION_FILENAME} must define one {name}()"
    calls = [
        node
        for node in ast.walk(functions[0])
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    return sorted(calls, key=lambda call: (call.lineno, call.col_offset))


def _keywords(call: ast.Call) -> dict[str | None, object]:
    """A call's keyword arguments, each value read as a literal."""
    return {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords}


def _assert_bounded_lock_wait(call: ast.Call, direction: str) -> None:
    assert isinstance(call.func, ast.Attribute) and call.func.attr == "execute", (
        f"{direction}() must open with op.execute({_LOCK_TIMEOUT!r})"
    )
    assert [ast.literal_eval(arg) for arg in call.args] == [_LOCK_TIMEOUT], (
        f"{direction}() must bound its ACCESS EXCLUSIVE wait with {_LOCK_TIMEOUT!r}"
    )
    assert not call.keywords, direction


# ---------------------------------------------------------------------------
# structural (always run)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_defined_exactly_once() -> None:
    parent = _parent_revision_id()
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == parent
    assert module.branch_labels is None
    assert module.depends_on is None
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    versions_dir = backend_root() / "alembic" / "versions"
    parent_definitions = [
        path.name
        for path in versions_dir.glob("*.py")
        if path.name != _REVISION_FILENAME
        and pattern.search(path.read_text(encoding="utf-8"))
    ]
    assert len(parent_definitions) == 1, parent_definitions
    source = _revision_source()
    assert f"Revision ID: {_REVISION_ID}" in source
    assert f"Revises: {parent}" in source, (
        "the docstring's Revises: line disagrees with down_revision -- a "
        "re-chain must move both"
    )


def test_upgrade_adds_each_column_in_the_shape_the_classifier_admits() -> None:
    """A bounded lock wait, then six inline, nullable, default-free adds.

    coord's merge-train classifier (qontinui-coord
    ``crates/coord/src/pr_merge/migration_classifier.rs``) reads a column's
    options only from an inline ``sa.Column(...)``, and rejects a volatile
    default, a NOT NULL without a constant server default, or a key/index
    option. This test is stricter and allows no default at all.
    ``schema="coord"`` is what the ``alembic-schema-arg-gate`` pre-commit hook
    requires of every op.
    """
    calls = _op_calls("upgrade")
    assert len(calls) == 1 + len(_COLUMNS), [ast.unparse(c) for c in calls]
    _assert_bounded_lock_wait(calls[0], "upgrade")
    for call, (name, type_source, _) in zip(calls[1:], _COLUMNS, strict=True):
        where = f"line {call.lineno}: {ast.unparse(call)}"
        assert isinstance(call.func, ast.Attribute)
        assert call.func.attr == "add_column", where
        assert len(call.args) == 2, where
        assert ast.literal_eval(call.args[0]) == _TABLE, where
        assert _keywords(call) == {"schema": _SCHEMA, "if_not_exists": True}, where
        column = call.args[1]
        assert isinstance(column, ast.Call), where
        assert ast.unparse(column.func) == "sa.Column", where
        assert len(column.args) == 2, where
        assert ast.literal_eval(column.args[0]) == name, where
        assert ast.unparse(column.args[1]) == type_source, where
        assert _keywords(column) == {"nullable": True}, where


def test_downgrade_drops_the_six_columns_in_reverse_order() -> None:
    calls = _op_calls("downgrade")
    assert len(calls) == 1 + len(_COLUMNS), [ast.unparse(c) for c in calls]
    _assert_bounded_lock_wait(calls[0], "downgrade")
    for call, name in zip(calls[1:], reversed(_COLUMN_NAMES), strict=True):
        where = f"line {call.lineno}: {ast.unparse(call)}"
        assert isinstance(call.func, ast.Attribute)
        assert call.func.attr == "drop_column", where
        assert [ast.literal_eval(arg) for arg in call.args] == [_TABLE, name], where
        assert _keywords(call) == {"schema": _SCHEMA, "if_exists": True}, where


def test_the_file_carries_the_idempotency_marker_the_classifier_reads() -> None:
    """``has_idempotency_guard`` reads the guard from the file's TEXT.

    The classifier admits an ``op.add_column`` only in a file containing one of
    ``has_column``, ``has_table``, ``inspect(``, ``reflect(`` or
    ``if not exists`` (case-insensitive). It does not recognise the
    ``if_not_exists=True`` keyword on ``add_column``, so without the spelled-out
    ``IF NOT EXISTS`` this revision's PR would be Blocked on the escalate path.
    """
    assert "if not exists" in _revision_source().lower()


# ---------------------------------------------------------------------------
# live (self-skips without a test Postgres)
# ---------------------------------------------------------------------------


def _table_columns(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {row[0] for row in rows}


def _table_constraints(engine: Engine) -> set[tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = to_regclass(:qualified)
                """
            ),
            {"qualified": f"{_SCHEMA}.{_TABLE}"},
        ).all()
    return {(name, definition) for name, definition in rows}


def _table_indexes(engine: Engine) -> set[tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = :schema AND tablename = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {(name, definition) for name, definition in rows}


def _assert_the_six(engine: Engine, *, present: bool) -> None:
    for name, _, data_type in _COLUMNS:
        info = column_info(engine, _TABLE, name)
        if not present:
            assert info is None, f"{_SCHEMA}.{_TABLE}.{name} still exists: {info}"
            continue
        assert info == (data_type, "YES", None), (
            f"{_SCHEMA}.{_TABLE}.{name} must be a NULLABLE {data_type} with no "
            f"default (NULL is the not-yet-written arm), got {info}"
        )


def _seed_run(engine: Engine) -> uuid.UUID:
    """One group and one finished run, written at the parent revision."""
    tenant_id, group_id, run_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.condition_groups
                    (group_id, tenant_id, name, target_url)
                VALUES (:group_id, :tenant_id, 'checkout flow', 'https://app.test')
                """
            ),
            {"group_id": group_id, "tenant_id": tenant_id},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.condition_runs
                    (run_id, tenant_id, group_id, finished_at, status, trigger,
                     results, summary)
                VALUES (:run_id, :tenant_id, :group_id, now(), 'PASS', 'manual',
                        CAST(:results AS jsonb), 'agent reported PASS')
                """
            ),
            {
                "run_id": run_id,
                "tenant_id": tenant_id,
                "group_id": group_id,
                "results": '[{"condition_id": null, "verdict": "pass"}]',
            },
        )
    return run_id


def _row(engine: Engine, run_id: uuid.UUID, columns: list[str]) -> tuple[object, ...]:
    """The run's values for ``columns`` (names from the catalog, never input)."""
    select_list = ", ".join(f'"{column}"' for column in columns)
    with engine.connect() as conn:
        row = conn.execute(
            text(
                f"SELECT {select_list} FROM {_SCHEMA}.{_TABLE} WHERE run_id = :run_id"
            ),
            {"run_id": run_id},
        ).one()
    return tuple(row)


def _reapply(engine: Engine, step: Callable[[], None]) -> None:
    """Run one of the revision's own functions again, outside alembic's ledger.

    Once ``alembic_version`` names a revision, alembic will not re-run it, so
    this is the only way to exercise an ``IF [NOT] EXISTS`` guard for real.
    """
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()


@_needs_pg
def test_live_up_down_up_adds_and_drops_exactly_the_six_columns() -> None:
    root = backend_root()
    parent = _parent_revision_id()
    module = load_revision_module(_revision_path(), f"_rerun_{_REVISION_ID}")
    with ephemeral_database(admin_database_url(), "condruns02") as (engine, db_url):
        # 1. Parent revision: the table exists, none of the six columns do.
        run_alembic(root, db_url, "upgrade", parent)
        baseline_columns = _table_columns(engine)
        assert "report_token" in baseline_columns, (
            f"{_SCHEMA}.{_TABLE} is missing at the parent revision"
        )
        assert not baseline_columns & set(_COLUMN_NAMES)
        baseline_constraints = _table_constraints(engine)
        baseline_indexes = _table_indexes(engine)
        existing = sorted(baseline_columns)
        run_id = _seed_run(engine)
        seeded = _row(engine, run_id, existing)

        # 2. Upgrade: exactly the six, each nullable with no default; no row
        #    changes, no constraint, no index.
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_the_six(engine, present=True)
        assert _table_columns(engine) == baseline_columns | set(_COLUMN_NAMES)
        assert _table_constraints(engine) == baseline_constraints
        assert _table_indexes(engine) == baseline_indexes
        assert _row(engine, run_id, existing) == seeded
        assert _row(engine, run_id, list(_COLUMN_NAMES)) == (None,) * len(_COLUMNS)

        # 3. Downgrade: the six are gone and nothing else moved.
        run_alembic(root, db_url, "downgrade", parent)
        _assert_the_six(engine, present=False)
        assert _table_columns(engine) == baseline_columns
        assert _table_constraints(engine) == baseline_constraints
        assert _table_indexes(engine) == baseline_indexes
        assert _row(engine, run_id, existing) == seeded

        # 4. Re-applying downgrade() there is a no-op: if_exists=True is
        #    exercised for real, not only read off the source.
        _reapply(engine, module.downgrade)
        assert _table_columns(engine) == baseline_columns

        # 5. Re-upgrade: the six are back.
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_the_six(engine, present=True)
        assert _table_columns(engine) == baseline_columns | set(_COLUMN_NAMES)

        # 6. Re-applying upgrade() on top is a no-op: if_not_exists=True is
        #    exercised for real, not only read off the source.
        _reapply(engine, module.upgrade)
        _assert_the_six(engine, present=True)
        assert _table_columns(engine) == baseline_columns | set(_COLUMN_NAMES)
        assert _row(engine, run_id, existing) == seeded
