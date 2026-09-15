"""Pins for alembic revision ``coord_ci_job_observations_02`` (two indexes).

The revision is a follow-up to ``coord_ci_job_observations_01``, which is
already applied in production and therefore frozen. What is pinned here:

1. the chain is wired (``down_revision`` names exactly one real sibling);
2. every object is ``coord.``-qualified and the two index names are exactly
   the ones the coord sampler's queries were written against;
3. ``upgrade()`` creates nothing but the two indexes, idempotently, and
   ``downgrade()`` drops nothing but them;
4. live: both indexes exist after upgrade, with the stated column order and
   no partial predicate, the ``_01`` objects are untouched by the downgrade,
   and up/down/up leaves no residue.

Structural tests always run; the live ones self-skip without a test Postgres
(``QONTINUI_TEST_PG=host:port``) and REPORT the skip.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest
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
    table_exists,
)

_REVISION_ID = "coord_ci_job_observations_02"
_REVISION_FILENAME = "coord_ci_job_observations_02_indexes.py"
# The single head of origin/main when this revision was authored. If coord's
# land-time re-point moves down_revision, update this literal with it.
_PARENT_REVISION_ID = "coord_ci_runner_quarantines_01"

_SCHEMA = "coord"
_TABLE = "ci_job_observations"
_RUN_INDEX = "ix_ci_job_obs_run"
_COMPLETED_INDEX = "ix_ci_job_obs_completed"
_INDEXES = (_RUN_INDEX, _COMPLETED_INDEX)
_EXPECTED_COLUMNS = {
    _RUN_INDEX: "repo,run_id,run_attempt",
    _COMPLETED_INDEX: "completed_at",
}
# The _01 objects this revision must leave alone.
_PRIOR_INDEXES = ("ix_ci_job_obs_runner_completed", "ix_ci_job_obs_key")

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
# structural (always run)
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
    src = _revision_source()
    assert f"Revision ID: {_REVISION_ID}" in src
    assert f"Revises: {_PARENT_REVISION_ID}" in src


_INDEX_OBJECT_RE = re.compile(
    r"(?:CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)\s+ON\s+"
    r"([A-Za-z_.\"]+)|DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+([A-Za-z_.\"]+))",
    re.I,
)


def test_upgrade_creates_exactly_the_two_indexes_idempotently() -> None:
    literals = _sql_literals(_function(_tree(), "upgrade"))
    created: list[tuple[str, str]] = []
    for sql in literals:
        assert not re.search(r"\b(DROP|ALTER|CREATE\s+TABLE|COMMENT)\b", sql, re.I), (
            f"upgrade() may only CREATE INDEX: {sql.strip()!r}"
        )
        for m in _INDEX_OBJECT_RE.finditer(sql):
            assert m.group(1) and m.group(2), f"unexpected statement {sql.strip()!r}"
            created.append((m.group(1), m.group(2)))
            assert re.search(
                rf"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{m.group(1)}\b", sql
            )
    assert sorted(created) == sorted(
        (name, f"{_SCHEMA}.{_TABLE}") for name in _INDEXES
    ), created


def test_downgrade_drops_exactly_the_two_indexes() -> None:
    literals = _sql_literals(_function(_tree(), "downgrade"))
    dropped: list[str] = []
    for sql in literals:
        assert not re.search(r"\b(CREATE|ALTER|COMMENT|TABLE)\b", sql, re.I), (
            f"downgrade() may only DROP INDEX: {sql.strip()!r}"
        )
        for m in _INDEX_OBJECT_RE.finditer(sql):
            assert m.group(3), f"unexpected statement {sql.strip()!r}"
            assert re.search(r"DROP\s+INDEX\s+IF\s+EXISTS\s+", sql, re.I)
            dropped.append(m.group(3))
    assert sorted(dropped) == sorted(f"{_SCHEMA}.{name}" for name in _INDEXES), dropped
    for prior in _PRIOR_INDEXES:
        assert prior not in " ".join(literals), f"downgrade() must not touch {prior}"


def test_every_statement_is_a_static_literal() -> None:
    tree = _tree()
    seen = 0
    for fn_name in ("upgrade", "downgrade"):
        for node in ast.walk(_function(tree, fn_name)):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "execute"
            ):
                seen += 1
                assert len(node.args) == 1 and isinstance(node.args[0], ast.Constant), (
                    f"op.execute at line {node.lineno} must take one static SQL literal"
                )
    # This count is the fence against a stray non-index statement (SET LOCAL,
    # INSERT, ...) that the verb regexes in the two tests above do not name.
    assert seen == 4, f"expected 2 creates + 2 drops, found {seen} op.execute calls"


# ---------------------------------------------------------------------------
# live (self-skip without a test Postgres)
# ---------------------------------------------------------------------------


def _index_columns(engine: Engine, index: str) -> str | None:
    with engine.connect() as conn:
        value = conn.execute(
            text(
                """
                SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                 WHERE n.nspname = :schema AND c.relname = :index
                """
            ),
            {"schema": _SCHEMA, "index": index},
        ).scalar_one_or_none()
    assert value is None or isinstance(value, str)
    return value


def _index_predicate(engine: Engine, index: str) -> str | None:
    with engine.connect() as conn:
        value = conn.execute(
            text(
                """
                SELECT pg_get_expr(i.indpred, i.indrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = :schema AND c.relname = :index
                """
            ),
            {"schema": _SCHEMA, "index": index},
        ).scalar_one()
    assert value is None or isinstance(value, str)
    return value


@_needs_pg
def test_indexes_exist_with_the_stated_columns_and_no_predicate() -> None:
    with ephemeral_database(admin_database_url(), "cjo02_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for index in _INDEXES:
            assert index_exists(engine, index), index
            assert _index_columns(engine, index) == _EXPECTED_COLUMNS[index], index
            assert _index_predicate(engine, index) is None, index
        for prior in _PRIOR_INDEXES:
            assert index_exists(engine, prior), f"{prior} must survive _02"


@_needs_pg
def test_up_down_up_leaves_no_residue_and_spares_the_01_objects() -> None:
    with ephemeral_database(admin_database_url(), "cjo02_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for index in _INDEXES:
            assert not index_exists(engine, index), index
        assert table_exists(engine, _SCHEMA, _TABLE), (
            "downgrade must not touch the table"
        )
        for prior in _PRIOR_INDEXES:
            assert index_exists(engine, prior), f"downgrade must not touch {prior}"
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for index in _INDEXES:
            assert index_exists(engine, index), index
        # IF NOT EXISTS is exercised for real: the module's own upgrade() SQL
        # run a second time against the already-indexed table must not raise.
        # (A second `alembic upgrade <rev>` would execute nothing, since
        # alembic_version already names the revision.)
        for sql in _sql_literals(_function(_tree(), "upgrade")):
            with engine.begin() as conn:
                conn.execute(text(sql))
        for index in _INDEXES:
            assert index_exists(engine, index), index
