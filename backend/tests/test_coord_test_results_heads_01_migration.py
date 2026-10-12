"""Behaviour test for the ``coord_test_result_heads_01`` head-ledger revision.

Phase 2 of plan
``2026-09-28-coord-test-flakiness-history-read-still-hits-the-statement-timeout``.
The revision creates ``coord.test_result_heads`` — one row per
``(repo, head_sha)``, upserted by coord's ingest — so the flakiness read takes
its two newest heads from a tiny table instead of walking
``coord.test_results``.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent names exactly one real sibling, and the docstring's ``Revises:``
   header agrees with the assignment (a re-point is three coupled edits: the
   assignment, that header, and ``_PARENT_REVISION_ID`` here).
2. **Every statement is ``coord.``-qualified raw SQL, and the only DROPs are in
   ``downgrade()``** — checked with ``check_coord_column_drops``'s own scanner.
3. **The table is built in the transaction and the index CONCURRENTLY outside
   it.** coord's migration classifier (the auto-land gate) rejects a
   non-concurrent ``CREATE INDEX`` because it cannot see that the table is
   empty, and rejects ``op.get_bind()`` reads, so the index is built
   ``CONCURRENTLY`` in ``autocommit_block()`` with no validity read.

Against a real Postgres (skipped when none is reachable):

4. **Upgrade from the parent creates the table with the declared shape**: the
   surrogate ``GENERATED ALWAYS`` identity key, the NOT NULLs, the
   ``row_count`` default, the ``UNIQUE (repo, head_sha)`` constraint by name, and
   the ``(repo, last_observed_at DESC)`` index by definition.
5. **coord's Phase 3 upsert works against it** — ``ON CONFLICT (repo,
   head_sha)`` resolves to the unique constraint, accumulates ``row_count`` and
   advances ``last_observed_at`` without moving ``first_observed_at``.
6. **The two-newest-heads read is an ordered index probe on the ledger** with
   no Sort (under ``enable_seqscan = off``: on a fixture-sized table a seq scan
   rightly wins on cost, so the question asked is whether the index CAN serve
   the shape) and returns the right two heads for the right repo.
7. **Downgrade removes the table and index, and a re-upgrade restores them.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import ast
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_test_result_heads_01"
_PARENT_REVISION_ID = "coordprio_01_queued_at_priority_tier"
_REVISION_FILENAME = "coord_test_result_heads_01_head_ledger.py"

_SCHEMA = "coord"
_TABLE = "test_result_heads"
_UNIQUE = "uq_test_result_heads_repo_head"
_IDX_REPO_LAST = "idx_test_result_heads_repo_last"

_REPO = "qontinui/qontinui-runner"
_OTHER_REPO = "qontinui/qontinui-coord"

# (name, information_schema data_type, nullable, default-substring or None)
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "bigint", False, None),
    ("repo", "text", False, None),
    ("head_sha", "text", False, None),
    ("first_observed_at", "timestamp with time zone", False, None),
    ("last_observed_at", "timestamp with time zone", False, None),
    ("row_count", "bigint", False, "0"),
)

# The Phase 3 coord upsert, as the plan specifies it (``now()`` replaced by a
# bind so the test controls time).
_UPSERT_SQL = text(
    """
    INSERT INTO coord.test_result_heads
        (repo, head_sha, first_observed_at, last_observed_at, row_count)
    VALUES (:repo, :sha, :at, :at, :n)
    ON CONFLICT (repo, head_sha) DO UPDATE SET
        last_observed_at = greatest(test_result_heads.last_observed_at,
                                    EXCLUDED.last_observed_at),
        row_count = test_result_heads.row_count + EXCLUDED.row_count
    """
)

# The Phase 3 coord head read.
_HEADS_SQL = (
    "SELECT head_sha FROM coord.test_result_heads "
    "WHERE repo = '{repo}' ORDER BY last_observed_at DESC LIMIT 2"
)

_T0 = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, bring one up or set QONTINUI_TEST_PG=host:port."
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _function_sql(name: str) -> list[str]:
    """Every string constant inside the module-level function ``name`` except its docstring."""
    tree = ast.parse(_revision_source())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    doc = fn.body[0]
    doc_id = (
        id(doc.value)
        if isinstance(doc, ast.Expr) and isinstance(doc.value, ast.Constant)
        else None
    )
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) != doc_id
    ]


# ---------------------------------------------------------------------------
# 1-3. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_statement_is_coord_qualified_and_drops_live_in_downgrade() -> None:
    upgrade_sql = _function_sql("upgrade")
    downgrade_sql = _function_sql("downgrade")
    assert len(upgrade_sql) == 2 and len(downgrade_sql) == 2
    for sql in upgrade_sql:
        assert "coord.test_result_heads" in sql, sql
        assert "DROP" not in sql.upper(), sql
    for sql in downgrade_sql:
        assert sql.startswith("DROP ") and " coord." in sql, sql

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_table_in_transaction_index_concurrently_and_no_bind_reads() -> None:
    tree = ast.parse(_revision_source())
    fn = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    # The table: a top-level statement of upgrade(), i.e. inside alembic's transaction.
    top_level_sql = [
        node.value
        for stmt in fn.body
        if not isinstance(stmt, ast.With)
        for node in ast.walk(stmt)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]
    assert any(
        "CREATE TABLE IF NOT EXISTS coord.test_result_heads" in s for s in top_level_sql
    )
    assert not any("CREATE INDEX" in s.upper() for s in top_level_sql), (
        "coord's migration classifier rejects a non-concurrent CREATE INDEX"
    )
    # The index: CONCURRENTLY, inside get_context().autocommit_block().
    withs = [s for s in fn.body if isinstance(s, ast.With)]
    assert len(withs) == 1
    call = withs[0].items[0].context_expr
    assert isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
    assert call.func.attr == "autocommit_block"
    in_block = [
        node.value
        for node in ast.walk(withs[0])
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]
    assert (
        len(in_block) == 1 and "CREATE INDEX CONCURRENTLY IF NOT EXISTS" in in_block[0]
    )
    # No op.get_bind() anywhere: the classifier rejects bind reads on the upgrade path.
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "get_bind" not in attrs


# ---------------------------------------------------------------------------
# 4-7. real Postgres
# ---------------------------------------------------------------------------


def _is_identity_always(engine: Engine) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT is_identity, identity_generation
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :t
                   AND column_name = 'id'
                """
            ),
            {"t": _TABLE},
        ).one()
    return bool(row[0] == "YES" and row[1] == "ALWAYS")


def _constraint_def(engine: Engine, name: str) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
                    "JOIN pg_namespace n ON n.oid = c.connamespace "
                    "WHERE n.nspname = 'coord' AND c.conname = :n"
                ),
                {"n": name},
            ).scalar()
            or ""
        )


def _primary_key_def(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
                    "WHERE c.conrelid = 'coord.test_result_heads'::regclass "
                    "AND c.contype = 'p'"
                )
            ).scalar()
            or ""
        )


def _index_def(engine: Engine, name: str) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    "SELECT pg_get_indexdef(c.oid) FROM pg_class c "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'coord' AND c.relname = :n"
                ),
                {"n": name},
            ).scalar()
            or ""
        )


@_needs_pg
def test_ledger_round_trips_and_serves_the_two_newest_heads_read() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_trh01") as (engine, url):
        # Parent: the table does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        # Claim 4: shape.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for name, expected_type, nullable, default_fragment in _EXPECTED_COLUMNS:
            info = column_info(engine, _TABLE, name, schema=_SCHEMA)
            assert info is not None, f"{name} is missing"
            data_type, is_nullable, default = info
            assert data_type == expected_type, (name, info)
            assert (is_nullable == "YES") is nullable, (name, info)
            if default_fragment is None:
                assert default is None, (name, info)
            else:
                assert default is not None and default_fragment in default, (
                    name,
                    info,
                )
        assert _is_identity_always(engine), "id must be GENERATED ALWAYS AS IDENTITY"
        assert _primary_key_def(engine) == "PRIMARY KEY (id)", (
            "a SINGLE-column surrogate key: coord's retention prune_sql batches "
            "over one pk column"
        )
        assert _constraint_def(engine, _UNIQUE) == "UNIQUE (repo, head_sha)"
        assert index_exists(engine, _IDX_REPO_LAST)
        assert "(repo, last_observed_at DESC)" in _index_def(engine, _IDX_REPO_LAST)

        # Claim 5: the coord upsert, three chunks of one head plus two others.
        with engine.begin() as conn:
            for sha, minutes, n in (
                ("sha_old", 0, 1000),
                ("sha_mid", 10, 1000),
                ("sha_new", 20, 1000),
                ("sha_new", 21, 1000),
                ("sha_new", 22, 250),
                # Another repo, NEWER than everything above: must never leak in.
                ("other_sha", 60, 5),
            ):
                conn.execute(
                    _UPSERT_SQL,
                    {
                        "repo": _OTHER_REPO if sha == "other_sha" else _REPO,
                        "sha": sha,
                        "at": _T0 + timedelta(minutes=minutes),
                        "n": n,
                    },
                )
            # A late chunk carrying an OLDER timestamp must not move the head back.
            conn.execute(
                _UPSERT_SQL,
                {"repo": _REPO, "sha": "sha_new", "at": _T0, "n": 1},
            )
            conn.execute(text("ANALYZE coord.test_result_heads"))
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT first_observed_at, last_observed_at, row_count "
                    "FROM coord.test_result_heads WHERE repo = :r AND head_sha = 'sha_new'"
                ),
                {"r": _REPO},
            ).one()
            n_rows = conn.execute(
                text("SELECT count(*) FROM coord.test_result_heads WHERE repo = :r"),
                {"r": _REPO},
            ).scalar()
        assert n_rows == 3, "ON CONFLICT must fold a head's chunks into one row"
        assert row.first_observed_at == _T0 + timedelta(minutes=20)
        assert row.last_observed_at == _T0 + timedelta(minutes=22)
        assert row.row_count == 1000 + 1000 + 250 + 1

        # Claim 6: the head read — ordered probe, right answer.
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            plan = "\n".join(
                str(r[0])
                for r in conn.execute(
                    text(f"EXPLAIN {_HEADS_SQL.format(repo=_REPO)}")
                ).all()
            )
        assert _IDX_REPO_LAST in plan and "Sort" not in plan, (
            f"the two-newest-heads read must be an ordered probe on {_IDX_REPO_LAST}:\n"
            f"{plan}"
        )
        with engine.connect() as conn:
            heads = [
                r[0] for r in conn.execute(text(_HEADS_SQL.format(repo=_REPO))).all()
            ]
            coord_heads = [
                r[0]
                for r in conn.execute(text(_HEADS_SQL.format(repo=_OTHER_REPO))).all()
            ]
            none_heads = conn.execute(
                text(_HEADS_SQL.format(repo="qontinui/never-ingested"))
            ).all()
        assert heads == ["sha_new", "sha_mid"]
        assert coord_heads == ["other_sha"], (
            "a repo with ONE head returns that head (the zero-match `previous` case)"
        )
        assert none_heads == [], "a repo with no ledger row reads an empty roster"

        # Claim 7: downgrade removes both; re-upgrade restores both.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _IDX_REPO_LAST)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _IDX_REPO_LAST)
