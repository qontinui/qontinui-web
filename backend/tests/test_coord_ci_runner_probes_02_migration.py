"""Pins for alembic revision ``coord_ci_runner_probes_02`` (one nullable column).

Plan ``2026-10-16-runner-canary-probe-mostly-not-acquired-and-its-ledger-has-no-agent-read-door``
Phase 1 item 0.

``coord.ci_runner_probes.poison_verdict_at_dispatch`` is the column
qontinui-coord's ``ci_runner_probe`` will write at insert and its agent read
door will render as ``clear_at_dispatch`` (qontinui-coord#3311, which ships
after this revision is applied). The one property that carries the plan's
honesty argument is that NULL stays UNKNOWN: no default, no CHECK, no backfill,
so a row written before the column existed can never read as ``clear``. What
is pinned here:

Without a database (always runs):

1. Chain wiring: ``down_revision`` names exactly one real sibling, and the
   ``Revises:`` header agrees.
2. ``upgrade()`` only adds and comments the one column, idempotently, with no
   default, CHECK or UPDATE; ``downgrade()`` drops nothing but it; the
   column-drop guard reads the upgrade path as dropping nothing.
3. Both directions are pure ``op.execute`` with static SQL.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. The column is nullable TEXT with no default; a row inserted without it,
   and a row that existed before the upgrade, both read NULL; any verdict
   label is accepted.
5. The comment lands as the source writes it.
6. Up, down, up leaves no residue and spares the table and its rows, and the
   module's own ``upgrade()`` SQL re-runs cleanly.
"""

from __future__ import annotations

import ast
import re
import sys
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
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_ci_runner_probes_02"
_REVISION_FILENAME = "coord_ci_runner_probes_02_poison_verdict.py"
# The single head of origin/main when this revision was re-chained. If coord's
# land-time re-point moves down_revision, update this literal with it.
_PARENT_REVISION_ID = "coord_tenant_github_hosts_01"

_SCHEMA = "coord"
_TABLE = "ci_runner_probes"
_COLUMN = "poison_verdict_at_dispatch"
_QUALIFIED = f"{_SCHEMA}.{_TABLE}"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _tree() -> ast.Module:
    return ast.parse(_revision_source(), filename=str(_revision_path()))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level def {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    """Every string constant inside ``fn`` except its own docstring."""
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
        re.M,
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"sibling (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. one column, added idempotently, NULL left as UNKNOWN
# ---------------------------------------------------------------------------


def test_upgrade_adds_and_comments_exactly_the_one_column() -> None:
    literals = _sql_literals(_function(_tree(), "upgrade"))
    up = "\n".join(literals)
    # The comment body is prose, so the vocabulary fences read the DDL only.
    ddl = "\n".join(s for s in literals if not re.match(r"\s*COMMENT\b", s, re.I))
    assert re.search(
        rf"ALTER\s+TABLE\s+{re.escape(_QUALIFIED)}\s+"
        rf"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+{_COLUMN}\s+TEXT\s*$",
        up,
        re.M,
    ), "upgrade() must ADD COLUMN IF NOT EXISTS poison_verdict_at_dispatch TEXT"
    assert re.search(
        rf"COMMENT\s+ON\s+COLUMN\s+{re.escape(_QUALIFIED)}\.{_COLUMN}\s+IS", up
    )
    # NULL must stay UNKNOWN: no default, no NOT NULL, no CHECK, no backfill.
    for forbidden in (
        r"\bDEFAULT\b",
        r"\bNOT\s+NULL\b",
        r"\bCHECK\s*\(",
        r"\bUPDATE\b",
    ):
        assert not re.search(forbidden, ddl, re.I), (
            f"upgrade() must not carry {forbidden!r}: NULL is UNKNOWN, never clear"
        )
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    assert len(re.findall(r"\bADD\s+COLUMN\b", up, re.I)) == 1
    # The fences above skip the COMMENT literal, so close it here without a
    # database: only string literals may follow its IS (the harness raises
    # otherwise), and no literal may smuggle a second statement past one
    # op.execute.
    comment_body_from_source(_revision_source(), f"{_QUALIFIED}.{_COLUMN}")
    for sql in literals:
        assert ";" not in sql, f"one statement per op.execute: {sql.strip()!r}"


def test_downgrade_drops_exactly_the_one_column() -> None:
    down = "\n".join(_sql_literals(_function(_tree(), "downgrade")))
    assert re.search(
        rf"ALTER\s+TABLE\s+{re.escape(_QUALIFIED)}\s+"
        rf"DROP\s+COLUMN\s+IF\s+EXISTS\s+{_COLUMN}\s*$",
        down,
        re.M,
    )
    assert not re.search(r"\bDROP\s+TABLE\b", down, re.I), "the table is not ours"
    assert len(re.findall(r"\bDROP\b", down, re.I)) == 1
    assert ";" not in down, "one statement per op.execute"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def _op_calls(node: ast.AST) -> list[ast.Call]:
    return [
        n
        for n in ast.walk(node)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and isinstance(n.func.value, ast.Name)
        and n.func.value.id == "op"
    ]


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = _tree()
    calls = _op_calls(tree)
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)
    # The fence against a stray statement the verb regexes above do not name,
    # counted per direction so a 2/1 split cannot hide a merged statement.
    up = len(_op_calls(_function(tree, "upgrade")))
    down = len(_op_calls(_function(tree, "downgrade")))
    assert (up, down) == (2, 1), f"expected add + comment / drop, found {up} / {down}"
    assert len(calls) == 3, f"op calls outside upgrade/downgrade: {len(calls)}"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------

_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")


def _insert_probe(engine: Engine, **overrides: object) -> object:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "runner_name": "merytshost-coorddb-4-1791468447",
        "repo": "qontinui/qontinui-coord",
        "probe_label": "coord-probe-merytshost-coorddb-4-1791468",
    }
    params.update(overrides)
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        return conn.execute(
            text(f"INSERT INTO {_QUALIFIED} ({cols}) VALUES ({binds}) RETURNING id"),
            params,
        ).scalar_one()


def _verdict(engine: Engine, probe_id: object) -> object:
    return scalar(
        engine,
        f"SELECT {_COLUMN} FROM {_QUALIFIED} WHERE id = :id",
        id=probe_id,
    )


@_needs_pg
def test_column_is_nullable_text_and_null_means_unknown() -> None:
    with ephemeral_database(admin_database_url(), "crp02_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        pre_column = _insert_probe(engine)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == ("text", "YES", None)

        # A row from before the column, and a row inserted without it, are
        # both UNKNOWN: nothing backfills or defaults them to a verdict.
        assert _verdict(engine, pre_column) is None
        assert _verdict(engine, _insert_probe(engine)) is None
        # Text with no CHECK: every PoisonVerdict label coord writes is taken.
        for label in (
            "suspected",
            "no_peer_baseline",
            "insufficient",
            "clear",
            "indeterminate",
        ):
            assert _verdict(engine, _insert_probe(engine, **{_COLUMN: label})) == label


@_needs_pg
def test_comment_lands_as_the_source_writes_it() -> None:
    with ephemeral_database(admin_database_url(), "crp02_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_comment(engine, _TABLE, _COLUMN) == comment_body_from_source(
            _revision_source(), f"{_QUALIFIED}.{_COLUMN}"
        )


@_needs_pg
def test_up_down_up_leaves_no_residue_and_spares_the_table() -> None:
    with ephemeral_database(admin_database_url(), "crp02_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        kept = _insert_probe(engine, **{_COLUMN: "clear"})

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        assert table_exists(engine, _SCHEMA, _TABLE), (
            "downgrade must not drop the table"
        )
        assert (
            scalar(engine, f"SELECT count(*) FROM {_QUALIFIED} WHERE id = :id", id=kept)
            == 1
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == ("text", "YES", None)
        # The dropped value does not come back: the re-added column is UNKNOWN.
        assert _verdict(engine, kept) is None

        # IF NOT EXISTS is exercised for real: the module's own upgrade() SQL
        # run a second time against the already-altered table must not raise.
        for sql in _sql_literals(_function(_tree(), "upgrade")):
            with engine.begin() as conn:
                conn.execute(text(sql))
        assert column_info(engine, _TABLE, _COLUMN) == ("text", "YES", None)
