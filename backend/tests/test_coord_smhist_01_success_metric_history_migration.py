"""Structural and round-trip test for alembic ``coord_smhist_01_success_metric_history``.

Plan ``2026-09-20-nothing-measures-the-product-against-its-declared-intent``
Phase 2 (schema half), with §3 as amended 2026-10-05 by plan
``2026-10-05-declared-intent-drives-autonomous-work-selection`` D4: the
executed prefix is ``named:``, ``sql:`` is not a type, and a ``named:`` id that
names no whitelist member resolves UNKNOWN ``unknown_named_query``.

Like ``cmtland_01``'s test, this does NOT pin the parent revision —
``down_revision`` is re-pointed at the merged head at land time — it asserts the
chain is WELL-FORMED instead.

Without a database (always runs): chain wiring, the two closed vocabularies
exactly as §3 states them, coord-qualified idempotent DDL, removals only in
``downgrade()``, no destructive token anywhere coord's re-point planner scans
(its clause E6 — the refusal that stranded qontinui-web#1828), and the
column-drop guard reading the upgrade as dropping nothing.

With a database (``QONTINUI_TEST_PG=host:port`` or ``QONTINUI_TEST_PG_DSN``;
skipped otherwise): column shape, every one of the nine CHECKs refusing its
violation and admitting its honest row, the series index, idempotent upgrade
and an up/down/up round-trip.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_smhist_01_success_metric_history"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_SCHEMA = "coord"
_TABLE = "success_metric_history"
_INDEX = "idx_success_metric_history_metric_observed"

# §3 as amended: the executed prefixes plus the two non-executed states.
_SOURCE_QUERY_TYPES = {"named", "http", "manual", "untyped", "absent"}
# §3/§4: one reason per remedy, including the amendment's unknown_named_query.
_UNKNOWN_REASONS = {
    "manual",
    "untyped_source_query",
    "absent_source_query",
    "unknown_named_query",
    "probe_error",
    "no_direction",
    "no_target",
}

# (name, information_schema data_type, nullable)
_COLUMNS: tuple[tuple[str, str, bool], ...] = (
    ("id", "uuid", False),
    ("tenant_id", "uuid", False),
    ("kind", "text", False),
    ("name", "text", False),
    ("metric", "text", True),
    ("value", "double precision", True),
    ("unit", "text", True),
    ("observed_at", "timestamp with time zone", False),
    ("source_query_type", "text", False),
    ("source_query_digest", "text", True),
    ("target_state", "text", False),
    ("unknown_reason", "text", True),
    ("baseline", "double precision", True),
    ("baseline_as_of", "timestamp with time zone", True),
    ("target", "double precision", True),
    ("direction", "text", True),
    ("detail", "jsonb", False),
)

# A Python transcription of coord's E6 destructive-token regex
# (qontinui-coord crates/coord/src/alembic_repoint_plan.rs DESTRUCTIVE_TOKENS),
# matched over lowercased, whitespace-collapsed text outside downgrade(). It
# omits that module's index-retry excuse, so it is at least as strict.
_E6_TOKENS = re.compile(
    r"\.drop_"
    r"|\bdrop_(?:table|column|index|constraint|schema)\("
    r"|\bdrop(?:table|index|constraint|schema|column|sequence)\b"
    r"|\bdrop (?:materialized view|table|column|schema|index|constraint|type|view"
    r"|sequence|function|procedure|trigger|extension|database)\b"
    r"|\btruncate\b"
    r"|\bdelete from\b"
    r"|\bdelete ?\("
    r"|\balter table\b[^;]{0,300}?\bdrop\b"
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _declared_parent() -> str:
    parent = load_revision_module(
        _revision_path(), "_test_coord_smhist_01_parent"
    ).down_revision
    assert isinstance(parent, str) and parent, f"down_revision is {parent!r}"
    return parent


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


def _check_values(constraint: str) -> set[str]:
    """The quoted literals of the ``IN (...)`` list inside one named CHECK."""
    up = "\n".join(_sql_literals(_function("upgrade")))
    m = re.search(
        rf"CONSTRAINT\s+{constraint}\s+CHECK\s*\((.*?)\)\s*,\s*\n\s*(?:--|CONSTRAINT)",
        up,
        re.S,
    )
    assert m, f"no CHECK named {constraint}"
    in_list = re.search(r"\bIN\s*\(([^)]*)\)", m.group(1), re.S)
    assert in_list, f"{constraint} has no IN list"
    return set(re.findall(r"'([^']*)'", in_list.group(1)))


def _outside_downgrade(source: str) -> str:
    """The text coord's E6 scans: everything but the column-0 downgrade() body."""
    out: list[str] = []
    in_downgrade = False
    for line in source.splitlines():
        if in_downgrade:
            if not line[:1] or line[0].isspace() or line.startswith("#"):
                continue
            in_downgrade = False
        if re.match(r"(?:async )?def downgrade\b", line):
            in_downgrade = True
            continue
        out.append(line)
    return "\n".join(out)


# ---------------------------------------------------------------------------
# without a database
# ---------------------------------------------------------------------------


def test_revision_id_is_wired() -> None:
    module = load_revision_module(_revision_path(), "_test_coord_smhist_01_wired")
    assert module.revision == _REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_the_declared_parent_is_exactly_one_real_sibling() -> None:
    parent = _declared_parent()
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, [f.name for f in siblings]


def test_docstring_header_agrees_with_the_declared_parent() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_declared_parent())}$", source, re.M)


def test_source_query_type_vocabulary_is_the_amended_one() -> None:
    got = _check_values("ck_success_metric_history_source_query_type")
    assert got == _SOURCE_QUERY_TYPES, got
    assert "sql" not in got  # §3 amendment 2026-10-05: sql: is untyped


def test_unknown_reason_vocabulary_carries_unknown_named_query() -> None:
    got = _check_values("ck_success_metric_history_unknown_reason")
    assert got == _UNKNOWN_REASONS, got


def test_ddl_is_coord_qualified_idempotent_and_removes_only_in_downgrade() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    down = "\n".join(_sql_literals(_function("downgrade")))
    assert not re.search(r"\bDROP\b", up, re.I)
    assert re.search(
        rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", up, re.I
    )
    assert re.search(
        rf"CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+{_INDEX}\b", up, re.I
    )
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down)
    assert re.search(rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{_INDEX}\b", down)


def test_nothing_outside_downgrade_trips_coords_repoint_e6() -> None:
    normalized = " ".join(_outside_downgrade(_revision_source()).lower().split())
    hits = [
        normalized[max(0, m.start() - 40) : m.end() + 20]
        for m in _E6_TOKENS.finditer(normalized)
    ]
    assert not hits, hits


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# with a database
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> dict[str, tuple[str, bool]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {r[0]: (r[1], r[2] == "YES") for r in rows}


def _insert(engine: Engine, **overrides: object) -> None:
    """Insert one row; the defaults are an honest on_target ``named:`` row."""
    params: dict[str, object] = {
        "tenant_id": str(uuid.uuid4()),
        "kind": "success_metric",
        "name": "merge-latency",
        "value": 3.0,
        "source_query_type": "named",
        "source_query_digest": "d" * 64,
        "target_state": "on_target",
        "unknown_reason": None,
        "target": 5.0,
        "direction": "down",
    }
    params.update(overrides)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_SCHEMA}.{_TABLE} "
                "(tenant_id, kind, name, value, source_query_type, "
                "source_query_digest, target_state, unknown_reason, target, direction) "
                "VALUES (:tenant_id, :kind, :name, :value, :source_query_type, "
                ":source_query_digest, :target_state, :unknown_reason, :target, "
                ":direction)"
            ),
            params,
        )


def _unknown(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "target_state": "unknown",
        "value": None,
        "unknown_reason": "probe_error",
    }
    row.update(overrides)
    return row


@_needs_pg
def test_table_shape_and_every_check() -> None:
    with ephemeral_database(admin_database_url(), "smhist01_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        assert set(got) == {c[0] for c in _COLUMNS}, set(got)
        for name, data_type, nullable in _COLUMNS:
            assert got[name] == (data_type, nullable), f"{name}: {got[name]}"
        assert index_exists(engine, _INDEX)
        assert scalar(
            engine,
            "SELECT indisvalid FROM pg_index WHERE indexrelid = "
            f"'{_SCHEMA}.{_INDEX}'::regclass",
        )
        # The DESC is what lets the latest-per-metric rollup be an index scan
        # (module docstring, "Index shape is the read's shape").
        indexdef = scalar(
            engine, f"SELECT pg_get_indexdef('{_SCHEMA}.{_INDEX}'::regclass)"
        )
        assert str(indexdef).endswith(
            "USING btree (tenant_id, kind, name, observed_at DESC)"
        ), indexdef

        # Honest rows, one per shape the docstring promises is storable.
        _insert(engine)
        _insert(engine, target_state="off_target", source_query_type="http")
        _insert(engine, **_unknown(source_query_type="manual", unknown_reason="manual"))
        _insert(engine, **_unknown(unknown_reason="manual", source_query_type="http"))
        _insert(
            engine,
            **_unknown(
                source_query_type="untyped", unknown_reason="untyped_source_query"
            ),
        )
        _insert(
            engine,
            **_unknown(
                source_query_type="absent",
                source_query_digest=None,
                unknown_reason="absent_source_query",
            ),
        )
        _insert(engine, **_unknown(unknown_reason="unknown_named_query"))
        _insert(
            engine, **_unknown(value=2.0, unknown_reason="no_direction", direction="  ")
        )
        _insert(engine, **_unknown(unknown_reason="no_target", target=None))

        refused: list[dict[str, object]] = [
            # 1. the closed prefix vocabulary — sql: is not a type any more
            {"source_query_type": "sql"},
            # 2. digest iff a query existed
            {"source_query_digest": None},
            _unknown(
                source_query_type="absent",
                unknown_reason="absent_source_query",
            ),
            # 3. three-valued verdict
            {"target_state": "maybe"},
            # 4. reason iff unknown, from the closed set
            _unknown(unknown_reason=None),
            {"unknown_reason": "manual"},
            _unknown(unknown_reason="sql_error"),
            # 5. no verdict without a value
            {"value": None},
            # 6. no verdict without target and a non-blank direction
            {"target": None},
            {"direction": None},
            {"direction": "   "},
            # 7. a reason that names the query type agrees with it
            _unknown(unknown_reason="absent_source_query"),
            _unknown(unknown_reason="untyped_source_query"),
            _unknown(unknown_reason="unknown_named_query", source_query_type="http"),
            # 8. a reason that names a verdict input agrees with it
            _unknown(unknown_reason="no_target"),
            _unknown(unknown_reason="no_direction"),
            # 9. a query that is never executed cannot carry a verdict
            {"source_query_type": "manual"},
            {"source_query_type": "untyped", "target_state": "off_target"},
            {"source_query_type": "absent", "source_query_digest": None},
        ]
        for overrides in refused:
            with pytest.raises(sqlalchemy.exc.IntegrityError):
                _insert(engine, **overrides)
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}") == 9


@_needs_pg
def test_upgrade_is_idempotent_and_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "smhist01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "stamp", parent)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}") == 1

        run_alembic(backend_root(), db_url, "downgrade", parent)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _INDEX)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX)
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}") == 0
