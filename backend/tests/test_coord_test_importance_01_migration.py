"""Structural and round-trip test for alembic ``coord_test_importance_01``.

Plan ``2026-11-07-test-importance-scores-and-a-quarantine-that-still-runs``,
Phase 2. The revision creates five coord tables -- ``test_importance_counts``,
``test_importance``, ``test_importance_runs``, ``test_quarantines`` and
``test_quarantine_applications`` -- that coord's ``test_importance`` and
``test_quarantine`` modules code against.

Every expectation below is a LITERAL: column, type, index and constraint names
spelled out, definitions as PostgreSQL renders them. Nothing is read back from
the revision module as an expected value, so a change to the revision is a
change this file has to agree with.

Without a database (always runs):

1. Chain wiring: the parent is pinned here and names one real sibling, and the
   ``Revises:`` header agrees.
2. Every DDL object is one of the five ``coord.`` tables; the only DROPs are in
   ``downgrade()``, which drops all five; the column-drop guard reads the
   upgrade path as dropping nothing.
3. Both directions are static ``op.execute`` literals with no bind read.
4. Index placement: the identity-bearing unique indexes are built in the
   transaction with their tables, the three plain indexes ``CONCURRENTLY``
   inside ``autocommit_block()``.
5. The only CHECKs are the four named ones on ``test_quarantines``; no FK, no
   trigger.

With a database (skipped when none is reachable, and a skip proves nothing;
point the tests at a live instance with ``QONTINUI_TEST_PG_DSN``):

6. upgrade -> downgrade -> upgrade from the parent: every column (type,
   nullability, default), identity, constraint and index (by definition, and
   valid) exists after each upgrade; nothing named for these tables remains
   after the downgrade, and the parent's own table survives it.
7. ``ux_test_quarantines_active`` refuses a second unlifted row for a
   (tenant, repo, target, test) and admits one after a lift.
8. Each of the four CHECKs refuses its violating inserts, by name, and admits
   the valid twin.
9. The unique keys hold, an unnamed ``run_ref`` folds into one key, and an
   estimate row stores UNKNOWN (NULL) estimates.
10. The comments record each vocabulary and each table's owner module.
11. ``upgrade()`` is idempotent.
"""

from __future__ import annotations

import ast
import json
import re
import sys
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_test_importance_01"
_REVISION_FILENAME = "coord_test_importance_01_importance_and_quarantine_store.py"

# Pinned as literals, not read back from the module. A re-chain moves the
# revision's down_revision, its `Revises:` line and these two together.
_PARENT_REVISION_ID = "outbound_budget_windows_01"
_PARENT_TABLE = "outbound_budget_windows"

_SCHEMA = "coord"
_COUNTS = "test_importance_counts"
_IMPORTANCE = "test_importance"
_RUNS = "test_importance_runs"
_QUARANTINES = "test_quarantines"
_APPLICATIONS = "test_quarantine_applications"
_TABLES = (_COUNTS, _IMPORTANCE, _RUNS, _QUARANTINES, _APPLICATIONS)

_TS = "timestamp with time zone"
_F8 = "double precision"

# (name, information_schema data_type -- `text[]` for a text array --,
#  nullable, default-substring or None for "no default")
_COUNTS_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "bigint", False, None),
    ("tenant_id", "uuid", False, None),
    ("repo", "text", False, None),
    ("target", "text", False, None),
    ("test_id", "text", False, None),
    ("ref_class", "text", False, None),
    ("rel_class", "text", False, None),
    ("label_version", "text", False, None),
    ("day", "date", False, None),
    ("trials", _F8, False, None),
    ("pass_heads", _F8, False, None),
    ("mixed_heads", _F8, False, None),
    ("mixed_flaky_execs", "integer", False, None),
    ("mixed_pass_execs", "integer", False, None),
    ("exec_n", "integer", False, None),
    ("exec_fail", "integer", False, None),
    ("red_at_base", _F8, False, None),
    ("base_unknown", _F8, False, None),
    ("dur_n", "integer", False, None),
    ("allred_by_k", "jsonb", False, None),
    ("allred_heads", "jsonb", False, None),
    ("dur_p50", _F8, True, None),
    ("computed_at", _TS, False, "now()"),
)

_IMPORTANCE_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("tenant_id", "uuid", False, None),
    ("repo", "text", False, None),
    ("imp_version", "text", False, None),
    ("target", "text", False, None),
    ("test_id", "text", False, None),
    ("ref_class", "text", False, None),
    ("rel_class", "text", False, None),
    ("run_id", "uuid", False, None),
    ("n_runs", _F8, True, None),
    ("y_failures", _F8, True, None),
    ("p_hat", _F8, True, None),
    ("p_plus", _F8, True, None),
    ("evidence_basis", "text", True, None),
    ("prior_strength", _F8, True, None),
    ("q_hat", _F8, True, None),
    ("q_plus", _F8, True, None),
    ("q_lower", _F8, True, None),
    ("att", "integer", True, None),
    ("cf", _F8, True, None),
    ("cf_basis", "text", True, None),
    ("detection_share", _F8, True, None),
    ("shapley_credit", _F8, True, None),
    ("bad_heads", _F8, True, None),
    ("dur_p50_secs", _F8, True, None),
    ("crit_path_secs", _F8, True, None),
    ("slot_secs", _F8, True, None),
    ("nv_detect_lane_h", _F8, True, None),
    ("nv_lane_lane_h", _F8, True, None),
    ("nv_slot_lane_h", _F8, True, None),
    ("nv_spurious_lane_h", _F8, True, None),
    ("nv_lane_h", _F8, True, None),
    ("debt_m", _F8, True, None),
    ("debt_m_lands", "integer", True, None),
    ("lands_since_pass", "integer", True, None),
    ("negative_asset", "boolean", True, None),
    ("flake_onset_suspected", "boolean", True, None),
    ("quarantine_recommended", "boolean", True, None),
    ("computed_at", _TS, False, "now()"),
)

_RUNS_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("repo", "text", False, None),
    ("kind", "text", False, None),
    ("label_version", "text", False, None),
    ("imp_version", "text", True, None),
    ("day", "date", True, None),
    ("window_start", "date", True, None),
    ("window_end", "date", True, None),
    ("status", "text", False, None),
    ("degraded_reasons", "text[]", False, "'{}'"),
    ("heads", "integer", True, None),
    ("rows_written", "bigint", True, None),
    ("inputs", "jsonb", True, None),
    ("hyper", "jsonb", True, None),
    ("holdout", "jsonb", True, None),
    ("started_at", _TS, False, "now()"),
    ("finished_at", _TS, True, None),
)

_QUARANTINES_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("repo", "text", False, None),
    ("test_id", "text", False, None),
    ("target", "text", False, "'*'"),
    ("owner_kind", "text", False, None),
    ("owner_ref", "text", False, None),
    ("diagnosis", "text", False, None),
    ("diagnosis_detail", "text", False, None),
    ("evidence", "jsonb", False, None),
    ("finding_id", "uuid", False, None),
    ("notification_ref", "uuid", False, None),
    ("created_at", _TS, False, "now()"),
    ("created_by", "text", False, None),
    ("expires_at", _TS, False, None),
    ("renews_id", "uuid", True, None),
    ("lifted_at", _TS, True, None),
    ("lifted_by", "text", True, None),
    ("lift_reason", "text", True, None),
)

_APPLICATIONS_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "bigint", False, None),
    ("tenant_id", "uuid", False, None),
    ("repo", "text", False, None),
    ("head_sha", "text", False, None),
    ("target", "text", False, None),
    ("run_ref", "text", True, None),
    ("mode", "text", False, None),
    ("list_digest", "text", True, None),
    ("quarantined_test_ids", "text[]", False, None),
    ("quarantined_ran", "integer", True, None),
    ("quarantined_failed", "text[]", True, None),
    ("other_failed", "integer", True, None),
    ("verdict_flipped", "boolean", True, None),
    ("observed_at", _TS, False, None),
)

_COLUMNS = {
    _COUNTS: _COUNTS_COLUMNS,
    _IMPORTANCE: _IMPORTANCE_COLUMNS,
    _RUNS: _RUNS_COLUMNS,
    _QUARANTINES: _QUARANTINES_COLUMNS,
    _APPLICATIONS: _APPLICATIONS_COLUMNS,
}

# The surrogate keys coord's retention prune batches over.
_IDENTITY_COLUMNS = ((_COUNTS, "id"), (_APPLICATIONS, "id"))

# Every index on each table, exactly as pg_indexes renders it.
_INDEXES: dict[str, dict[str, str]] = {
    _COUNTS: {
        "test_importance_counts_pkey": (
            "CREATE UNIQUE INDEX test_importance_counts_pkey "
            "ON coord.test_importance_counts USING btree (id)"
        ),
        "uq_test_importance_counts_cell": (
            "CREATE UNIQUE INDEX uq_test_importance_counts_cell "
            "ON coord.test_importance_counts USING btree "
            "(tenant_id, repo, label_version, day, target, test_id, ref_class, rel_class)"
        ),
        "idx_test_importance_counts_tenant_repo_label_day": (
            "CREATE INDEX idx_test_importance_counts_tenant_repo_label_day "
            "ON coord.test_importance_counts USING btree "
            "(tenant_id, repo, label_version, day)"
        ),
        "idx_test_importance_counts_day": (
            "CREATE INDEX idx_test_importance_counts_day "
            "ON coord.test_importance_counts USING btree (day)"
        ),
    },
    _IMPORTANCE: {
        "test_importance_pkey": (
            "CREATE UNIQUE INDEX test_importance_pkey "
            "ON coord.test_importance USING btree "
            "(tenant_id, repo, imp_version, target, test_id, ref_class, rel_class)"
        ),
    },
    _RUNS: {
        "test_importance_runs_pkey": (
            "CREATE UNIQUE INDEX test_importance_runs_pkey "
            "ON coord.test_importance_runs USING btree (id)"
        ),
    },
    _QUARANTINES: {
        "test_quarantines_pkey": (
            "CREATE UNIQUE INDEX test_quarantines_pkey "
            "ON coord.test_quarantines USING btree (id)"
        ),
        "ux_test_quarantines_active": (
            "CREATE UNIQUE INDEX ux_test_quarantines_active "
            "ON coord.test_quarantines USING btree (tenant_id, repo, target, test_id) "
            "WHERE (lifted_at IS NULL)"
        ),
    },
    _APPLICATIONS: {
        "test_quarantine_applications_pkey": (
            "CREATE UNIQUE INDEX test_quarantine_applications_pkey "
            "ON coord.test_quarantine_applications USING btree (id)"
        ),
        "ux_test_quarantine_applications_run": (
            "CREATE UNIQUE INDEX ux_test_quarantine_applications_run "
            "ON coord.test_quarantine_applications USING btree "
            "(tenant_id, repo, head_sha, target, mode, COALESCE(run_ref, ''::text))"
        ),
        "idx_test_quarantine_applications_observed_at": (
            "CREATE INDEX idx_test_quarantine_applications_observed_at "
            "ON coord.test_quarantine_applications USING btree (observed_at)"
        ),
    },
}
_ALL_INDEX_NAMES = tuple(name for by_table in _INDEXES.values() for name in by_table)

# Every constraint on each table, exactly as pg_get_constraintdef renders it.
# The exact sets are also the "no vocabulary CHECK, no FK" rule.
_CONSTRAINTS: dict[str, dict[str, str]] = {
    _COUNTS: {
        "test_importance_counts_pkey": "PRIMARY KEY (id)",
        "uq_test_importance_counts_cell": (
            "UNIQUE (tenant_id, repo, label_version, day, target, test_id, "
            "ref_class, rel_class)"
        ),
    },
    _IMPORTANCE: {
        "test_importance_pkey": (
            "PRIMARY KEY (tenant_id, repo, imp_version, target, test_id, "
            "ref_class, rel_class)"
        ),
    },
    _RUNS: {"test_importance_runs_pkey": "PRIMARY KEY (id)"},
    _QUARANTINES: {
        "test_quarantines_pkey": "PRIMARY KEY (id)",
        "ck_test_quarantines_expires_after_created": "CHECK ((expires_at > created_at))",
        "ck_test_quarantines_owner_ref_not_blank": (
            "CHECK ((owner_ref ~ '[^[:space:]]'::text))"
        ),
        "ck_test_quarantines_diagnosis_detail_not_blank": (
            "CHECK ((diagnosis_detail ~ '[^[:space:]]'::text))"
        ),
        "ck_test_quarantines_lifted_at_iff_lift_reason": (
            "CHECK (((lifted_at IS NULL) = (lift_reason IS NULL)))"
        ),
    },
    _APPLICATIONS: {"test_quarantine_applications_pkey": "PRIMARY KEY (id)"},
}

_CHECK_NAMES = (
    "ck_test_quarantines_diagnosis_detail_not_blank",
    "ck_test_quarantines_expires_after_created",
    "ck_test_quarantines_lifted_at_iff_lift_reason",
    "ck_test_quarantines_owner_ref_not_blank",
)
_CONCURRENT_INDEXES = (
    "idx_test_importance_counts_day",
    "idx_test_importance_counts_tenant_repo_label_day",
    "idx_test_quarantine_applications_observed_at",
)
_IN_TRANSACTION_INDEXES = (
    "ux_test_quarantine_applications_run",
    "ux_test_quarantines_active",
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (conftest.py derives it from "
        "QONTINUI_TEST_PG_DSN or QONTINUI_TEST_PG; ephemeral-db.sh start pgvector "
        "supplies a DSN)"
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


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(name: str) -> list[str]:
    """Every string constant inside the function ``name`` except its docstring."""
    fn = _function(name)
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
        f"down_revision is {module.down_revision!r}; a re-chain moves "
        "down_revision, the `Revises:` line and _PARENT_REVISION_ID together"
    )
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f.name
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {siblings})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROPs are in downgrade()
# ---------------------------------------------------------------------------

_TABLE_STATEMENT_RE = re.compile(
    r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE)"
    r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
    re.I,
)
_COLUMN_COMMENT_RE = re.compile(r"COMMENT\s+ON\s+COLUMN\s+([A-Za-z_.\"]+)", re.I)
_INDEX_STATEMENT_RE = re.compile(
    r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"
    r"(\w+)\s+ON\s+([A-Za-z_.\"]+)",
    re.I,
)
_OWNED_TABLES = {f"{_SCHEMA}.{table}" for table in _TABLES}


def test_every_ddl_object_is_one_of_the_five_coord_tables() -> None:
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(fn_name):
            for obj in _TABLE_STATEMENT_RE.findall(sql):
                assert obj in _OWNED_TABLES, (
                    f"{fn_name}(): table object {obj!r} is not one of {sorted(_OWNED_TABLES)}"
                )
            for obj in _COLUMN_COMMENT_RE.findall(sql):
                table, _, column = obj.rpartition(".")
                assert table in _OWNED_TABLES and column, (
                    f"{fn_name}(): column comment target {obj!r} is not a column "
                    "of one of the five coord tables"
                )
            for index, target in _INDEX_STATEMENT_RE.findall(sql):
                assert target in _OWNED_TABLES, (
                    f"{fn_name}(): index {index} is built on {target!r}"
                )
                assert index in _ALL_INDEX_NAMES, f"unexpected index {index}"
    up = "\n".join(_sql_literals("upgrade"))
    for table in _TABLES:
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+coord\.{table}\s*\(", up
        ), f"upgrade() must create coord.{table} under IF NOT EXISTS"


def test_every_drop_is_in_downgrade_which_drops_all_five() -> None:
    up = "\n".join(_sql_literals("upgrade"))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    drops = sorted(
        re.findall(
            r"DROP\s+TABLE\s+IF\s+EXISTS\s+([\w.]+)",
            "\n".join(_sql_literals("downgrade")),
        )
    )
    assert drops == sorted(_OWNED_TABLES), f"downgrade() drops {drops}"

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    methods = {call.func.attr for call in calls}  # type: ignore[attr-defined]
    assert methods == {"execute", "get_context"}, methods
    for call in calls:
        if call.func.attr != "execute":  # type: ignore[attr-defined]
            continue
        arg = call.args[0] if len(call.args) == 1 and not call.keywords else None
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
    attributes = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "get_bind" not in attributes, "no bind reads: the classifier rejects them"


# ---------------------------------------------------------------------------
# 4. index build placement
# ---------------------------------------------------------------------------


def test_unique_indexes_in_the_transaction_plain_ones_concurrently() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert all(call.sql is not None for call in calls)
    in_block = [call.sql or "" for call in calls if call.in_autocommit_block]
    in_txn = [call.sql or "" for call in calls if not call.in_autocommit_block]

    concurrent = sorted(
        name
        for sql in in_block
        for name in re.findall(
            r"CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON", sql
        )
    )
    assert concurrent == list(_CONCURRENT_INDEXES), concurrent
    assert len(in_block) == len(_CONCURRENT_INDEXES), (
        "the autocommit block holds the three concurrent builds and nothing else"
    )

    txn_sql = "\n".join(in_txn)
    assert "CONCURRENTLY" not in txn_sql, "CONCURRENTLY fails inside a transaction"
    assert not re.search(r"CREATE\s+INDEX\b", txn_sql), (
        "a plain index belongs in the autocommit block, built CONCURRENTLY"
    )
    unique = sorted(
        re.findall(r"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON", txn_sql)
    )
    assert unique == list(_IN_TRANSACTION_INDEXES), unique
    for table in _TABLES:
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+coord\.{table}\b", txn_sql
        )


# ---------------------------------------------------------------------------
# 5. CHECKs only where the plan puts them; no FK, no trigger
# ---------------------------------------------------------------------------


def test_only_the_four_named_checks_and_no_fk_or_trigger() -> None:
    up = "\n".join(_sql_literals("upgrade"))
    assert sorted(re.findall(r"CONSTRAINT\s+(\w+)\s+CHECK\b", up)) == list(_CHECK_NAMES)
    assert len(re.findall(r"\bCHECK\s*\(", up)) == len(_CHECK_NAMES), (
        "a vocabulary column carries no CHECK: the Rust enum owns the closed set"
    )
    assert not re.search(r"\bREFERENCES\b", up, re.I), (
        "tenant_id and run ids take no FK"
    )
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database: catalog readers
# ---------------------------------------------------------------------------


def _columns(
    engine: Engine, table: str
) -> dict[str, tuple[str, str, bool, str | None]]:
    """``{column: (data_type, udt_name, nullable, column_default)}``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, udt_name, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {r[0]: (r[1], r[2], r[3] == "YES", r[4]) for r in rows}


def _constraints(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = to_regclass('coord.' || :table)
                """
            ),
            {"table": table},
        ).all()
    return {r[0]: r[1] for r in rows}


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef
                  FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": table},
        ).all()
    return {r[0]: r[1] for r in rows}


def _invalid_indexes(engine: Engine) -> list[str]:
    """Every index of these tables that is not valid and ready."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord'
                   AND c.relname = ANY(:names)
                   AND NOT (i.indisvalid AND i.indisready)
                """
            ),
            {"names": list(_ALL_INDEX_NAMES)},
        ).all()
    return sorted(r[0] for r in rows)


def _residue(engine: Engine) -> list[str]:
    """Every coord relation, constraint or type still named for these tables."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT 'relation ' || c.relname
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord'
                   AND (strpos(c.relname, 'test_importance') > 0
                        OR strpos(c.relname, 'test_quarantine') > 0)
                UNION ALL
                SELECT 'constraint ' || co.conname
                  FROM pg_constraint co
                  JOIN pg_namespace n ON n.oid = co.connamespace
                 WHERE n.nspname = 'coord'
                   AND (strpos(co.conname, 'test_importance') > 0
                        OR strpos(co.conname, 'test_quarantine') > 0)
                UNION ALL
                SELECT 'type ' || t.typname
                  FROM pg_type t
                  JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'coord'
                   AND (strpos(t.typname, 'test_importance') > 0
                        OR strpos(t.typname, 'test_quarantine') > 0)
                """
            )
        ).all()
    return sorted(r[0] for r in rows)


def _assert_full_shape(engine: Engine, when: str) -> None:
    """Every column, identity, constraint and index of the five tables, literally."""
    for table, expected in _COLUMNS.items():
        got = _columns(engine, table)
        want = {c[0] for c in expected}
        assert set(got) == want, (
            f"{when}: coord.{table} is missing {sorted(want - set(got))} and has "
            f"unexpected {sorted(set(got) - want)}"
        )
        for name, data_type, nullable, default in expected:
            got_type, got_udt, got_nullable, got_default = got[name]
            if data_type.endswith("[]"):
                assert (got_type, got_udt) == ("ARRAY", f"_{data_type[:-2]}"), (
                    f"{when}: {table}.{name} is {got_type}/{got_udt}, not {data_type}"
                )
            else:
                assert got_type == data_type, (
                    f"{when}: {table}.{name} is {got_type}, not {data_type}"
                )
            assert got_nullable is nullable, (
                f"{when}: {table}.{name} nullable={got_nullable}, expected {nullable}"
            )
            if default is None:
                assert got_default is None, (
                    f"{when}: {table}.{name} has an unexpected default {got_default!r}"
                )
            else:
                assert got_default is not None and default in got_default, (
                    f"{when}: {table}.{name} default {got_default!r} lacks {default!r}"
                )

    for table, column in _IDENTITY_COLUMNS:
        identity = scalar(
            engine,
            """
            SELECT is_identity || '/' || coalesce(identity_generation, '')
              FROM information_schema.columns
             WHERE table_schema = 'coord' AND table_name = :t AND column_name = :c
            """,
            t=table,
            c=column,
        )
        assert identity == "YES/ALWAYS", (
            f"{when}: {table}.{column} must be GENERATED ALWAYS AS IDENTITY ({identity})"
        )

    for table, expected_constraints in _CONSTRAINTS.items():
        assert _constraints(engine, table) == expected_constraints, (
            f"{when}: coord.{table} constraints differ"
        )
    for table, expected_indexes in _INDEXES.items():
        assert _indexes(engine, table) == expected_indexes, (
            f"{when}: coord.{table} indexes differ"
        )
    assert _invalid_indexes(engine) == [], f"{when}: invalid or unready indexes"


# ---------------------------------------------------------------------------
# live database: rows
# ---------------------------------------------------------------------------

_T0 = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
_COORD_REPO = "qontinui/qontinui-coord"
_A_TEST = (
    "qontinui-coord::bin/qontinui-coord::merge_scheduler::tests::requeue_keeps_order"
)
_JSONB_COLUMNS = frozenset(
    {"allred_by_k", "allred_heads", "evidence", "inputs", "hyper", "holdout"}
)


def _insert_sql(table: str, params: dict[str, object], returning: str | None) -> str:
    columns = ", ".join(params)
    binds = ", ".join(
        f"CAST(:{name} AS jsonb)" if name in _JSONB_COLUMNS else f":{name}"
        for name in params
    )
    tail = f" RETURNING {returning}" if returning else ""
    return f"INSERT INTO coord.{table} ({columns}) VALUES ({binds}){tail}"


def _insert(
    engine: Engine, table: str, params: dict[str, object], returning: str | None = None
) -> object:
    """Insert one row; return the ``returning`` column's value when asked."""
    with engine.begin() as conn:
        result = conn.execute(text(_insert_sql(table, params, returning)), params)
        return result.scalar_one() if returning else None


def _assert_refused(
    engine: Engine,
    table: str,
    params: dict[str, object],
    constraint: str,
    pgcode: str,
    label: str,
) -> None:
    """The insert must be refused by ``constraint`` with SQLSTATE ``pgcode``.

    The verdict is asserted OUTSIDE the ``except`` block, so a red names the
    property first instead of opening on the driver's chained traceback.
    """
    got: tuple[object, object] | None = None
    try:
        _insert(engine, table, params)
    except IntegrityError as exc:
        orig = exc.orig
        got = (
            getattr(orig, "pgcode", None),
            getattr(getattr(orig, "diag", None), "constraint_name", None),
        )
    if got is None:
        pytest.fail(f"{label}: the insert was ADMITTED; {constraint} must refuse it")
    assert got == (pgcode, constraint), (
        f"{label}: refused as {got}, expected ({pgcode!r}, {constraint!r})"
    )


def _assert_admitted(
    engine: Engine, table: str, params: dict[str, object], label: str
) -> None:
    """The insert must succeed; a refusal fails naming the constraint that refused."""
    refusal: str | None = None
    try:
        _insert(engine, table, params)
    except IntegrityError as exc:
        name = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        refusal = f"{name!r} ({str(exc.orig).splitlines()[0]})"
    if refusal is not None:
        pytest.fail(f"{label}: REFUSED by {refusal}; it must be admitted")


def _quarantine(tenant: uuid.UUID, **overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tenant_id": tenant,
        "repo": _COORD_REPO,
        "test_id": _A_TEST,
        "owner_kind": "session",
        "owner_ref": "019a4c2e-7d10-7f3a-9c1e-5b2f8a6d4e01",
        "diagnosis": "nondeterministic_test",
        "diagnosis_detail": "same-head attempts disagree on 3 of 40 heads",
        "evidence": json.dumps({"q_lower": 0.021, "p_plus": 0.0004}),
        "finding_id": uuid.uuid4(),
        "notification_ref": uuid.uuid4(),
        "created_by": "device:merytshost",
        "created_at": _T0,
        "expires_at": _T0 + timedelta(days=14),
    }
    params.update(overrides)
    return params


def _counts(tenant: uuid.UUID, **overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tenant_id": tenant,
        "repo": _COORD_REPO,
        "target": "rust-ci",
        "test_id": _A_TEST,
        "ref_class": "candidate",
        "rel_class": "own",
        "label_version": "label-v1",
        "day": date(2026, 11, 6),
        "trials": 35.25,
        "pass_heads": 33.25,
        "mixed_heads": 1.0,
        "mixed_flaky_execs": 1,
        "mixed_pass_execs": 2,
        "exec_n": 106,
        "exec_fail": 4,
        "red_at_base": 0.0,
        "base_unknown": 0.0,
        "dur_n": 35,
        "allred_by_k": json.dumps({"3": 1.0}),
        "allred_heads": json.dumps([{"head_sha": "4f1e2d3c", "k": 3}]),
        "dur_p50": 0.84,
    }
    params.update(overrides)
    return params


def _run(tenant: uuid.UUID) -> dict[str, object]:
    return {
        "tenant_id": tenant,
        "repo": _COORD_REPO,
        "kind": "score",
        "label_version": "label-v1",
        "imp_version": "imp-v1",
        "window_start": date(2026, 10, 8),
        "window_end": date(2026, 11, 6),
        "status": "ok",
    }


def _estimate(
    tenant: uuid.UUID, run_id: object, **overrides: object
) -> dict[str, object]:
    params: dict[str, object] = {
        "tenant_id": tenant,
        "repo": _COORD_REPO,
        "imp_version": "imp-v1",
        "target": "rust-ci",
        "test_id": _A_TEST,
        "ref_class": "candidate",
        "rel_class": "own",
        "run_id": run_id,
    }
    params.update(overrides)
    return params


def _application(tenant: uuid.UUID, **overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tenant_id": tenant,
        "repo": _COORD_REPO,
        "head_sha": "4f1e2d3c5b6a79880123456789abcdef01234567",
        "target": "rust-ci",
        "run_ref": None,
        "mode": "shadow",
        "quarantined_test_ids": [_A_TEST],
        "quarantined_ran": 1,
        "quarantined_failed": [_A_TEST],
        "other_failed": 0,
        "verdict_flipped": True,
        "observed_at": _T0,
    }
    params.update(overrides)
    return params


@pytest.fixture(scope="module")
def migrated() -> Iterator[Engine]:
    """One database at this revision for the row-level tests.

    Each test writes under its own fresh tenant id and reads back through it,
    so the tests share no rows.
    """
    with ephemeral_database(admin_database_url(), "cti01_rows") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


# ---------------------------------------------------------------------------
# 6. upgrade -> downgrade -> upgrade
# ---------------------------------------------------------------------------


@_needs_pg
def test_up_down_up_creates_every_object_and_leaves_no_residue() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "cti01_rt") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert table_exists(engine, _SCHEMA, _PARENT_TABLE)
        assert _residue(engine) == [], "the parent already carries these names"

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_full_shape(engine, "after the first upgrade")

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _residue(engine) == [], "the downgrade left objects behind"
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table), table
        for index in _ALL_INDEX_NAMES:
            assert not index_exists(engine, index), index
        assert table_exists(engine, _SCHEMA, _PARENT_TABLE), (
            "the parent revision's table must survive this downgrade"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_full_shape(engine, "after the re-upgrade")


# ---------------------------------------------------------------------------
# 7. at most one unlifted quarantine per (tenant, repo, target, test)
# ---------------------------------------------------------------------------


def _rows_for_key(
    engine: Engine, tenant: uuid.UUID, target: str, test_id: str
) -> object:
    return scalar(
        engine,
        """
        SELECT count(*) FROM coord.test_quarantines
         WHERE tenant_id = :tenant AND repo = :repo
           AND target = :target AND test_id = :test_id
        """,
        tenant=tenant,
        repo=_COORD_REPO,
        target=target,
        test_id=test_id,
    )


@_needs_pg
def test_active_index_refuses_a_second_unlifted_row_and_admits_one_after_a_lift(
    migrated: Engine,
) -> None:
    tenant = uuid.uuid4()
    first = _insert(migrated, _QUARANTINES, _quarantine(tenant), "id")
    target = scalar(
        migrated, "SELECT target FROM coord.test_quarantines WHERE id = :id", id=first
    )
    assert target == "*", "target defaults to * (every target of the test)"

    _assert_refused(
        migrated,
        _QUARANTINES,
        _quarantine(tenant),
        "ux_test_quarantines_active",
        "23505",
        "a second unlifted row for the same (tenant, repo, target, test)",
    )

    # Everything else coexists with the active row.
    _assert_admitted(
        migrated, _QUARANTINES, _quarantine(tenant, target="rust-ci"), "one target"
    )
    _assert_admitted(
        migrated,
        _QUARANTINES,
        _quarantine(tenant, test_id=f"{_A_TEST}_2"),
        "another test",
    )
    _assert_admitted(
        migrated,
        _QUARANTINES,
        _quarantine(tenant, repo="qontinui/qontinui-runner"),
        "another repo",
    )
    _assert_admitted(
        migrated, _QUARANTINES, _quarantine(uuid.uuid4()), "another tenant"
    )

    with migrated.begin() as conn:
        conn.execute(
            text(
                "UPDATE coord.test_quarantines SET lifted_at = :at, "
                "lifted_by = 'session-7', lift_reason = 'fixed' WHERE id = :id"
            ),
            {"at": _T0 + timedelta(days=2), "id": first},
        )
    _assert_admitted(
        migrated, _QUARANTINES, _quarantine(tenant), "a new unlifted row after the lift"
    )
    _assert_refused(
        migrated,
        _QUARANTINES,
        _quarantine(tenant),
        "ux_test_quarantines_active",
        "23505",
        "a second unlifted row beside the re-opened one",
    )
    assert _rows_for_key(migrated, tenant, "*", _A_TEST) == 2, (
        "the lifted row stays as history beside the active one"
    )


# ---------------------------------------------------------------------------
# 8. each CHECK refuses its violating insert
# ---------------------------------------------------------------------------

# Violating overrides per CHECK, and the admitted twin of each: the twin proves
# the refusal is this CHECK's, not a neighbouring rule's.
_CHECK_CASES: dict[str, tuple[tuple[tuple[str, dict[str, object]], ...], ...]] = {
    "ck_test_quarantines_expires_after_created": (
        (
            ("expires_at equal to created_at", {"expires_at": _T0}),
            (
                "expires_at before created_at",
                {"expires_at": _T0 - timedelta(seconds=1)},
            ),
        ),
        (("expires_at one second after", {"expires_at": _T0 + timedelta(seconds=1)}),),
    ),
    "ck_test_quarantines_owner_ref_not_blank": (
        (
            ("owner_ref empty", {"owner_ref": ""}),
            ("owner_ref spaces", {"owner_ref": "   "}),
            ("owner_ref tab and newline", {"owner_ref": "\t\n"}),
        ),
        (("owner_ref padded", {"owner_ref": "  session-7 "}),),
    ),
    "ck_test_quarantines_diagnosis_detail_not_blank": (
        (
            ("diagnosis_detail empty", {"diagnosis_detail": ""}),
            ("diagnosis_detail whitespace", {"diagnosis_detail": " \t "}),
        ),
        (("diagnosis_detail one visible character", {"diagnosis_detail": " x "}),),
    ),
    "ck_test_quarantines_lifted_at_iff_lift_reason": (
        (
            (
                "lifted_at without lift_reason",
                {"lifted_at": _T0 + timedelta(hours=1), "lifted_by": "session-7"},
            ),
            ("lift_reason without lifted_at", {"lift_reason": "fixed"}),
        ),
        (
            (
                "lifted with a reason",
                {
                    "lifted_at": _T0 + timedelta(hours=1),
                    "lifted_by": "session-7",
                    "lift_reason": "fixed",
                },
            ),
            ("active: neither set", {}),
        ),
    ),
}


@_needs_pg
@pytest.mark.parametrize("constraint", sorted(_CHECK_CASES))
def test_each_check_refuses_its_violating_insert(
    migrated: Engine, constraint: str
) -> None:
    tenant = uuid.uuid4()
    violating, admitted = _CHECK_CASES[constraint]
    for label, override in violating:
        params = _quarantine(tenant, test_id=f"check::{uuid.uuid4().hex}", **override)
        _assert_refused(migrated, _QUARANTINES, params, constraint, "23514", label)
    for label, override in admitted:
        params = _quarantine(tenant, test_id=f"check::{uuid.uuid4().hex}", **override)
        _assert_admitted(migrated, _QUARANTINES, params, label)


# ---------------------------------------------------------------------------
# 9. unique keys, the unnamed run_ref, UNKNOWN estimates, defaults
# ---------------------------------------------------------------------------


@_needs_pg
def test_unique_keys_hold_and_unknown_estimates_store(migrated: Engine) -> None:
    tenant = uuid.uuid4()

    _insert(migrated, _COUNTS, _counts(tenant))
    _assert_refused(
        migrated,
        _COUNTS,
        _counts(tenant),
        "uq_test_importance_counts_cell",
        "23505",
        "a second counts row for the same cell and day",
    )
    _assert_admitted(
        migrated, _COUNTS, _counts(tenant, rel_class="near"), "another cell"
    )
    _assert_admitted(
        migrated,
        _COUNTS,
        _counts(tenant, label_version="label-v2"),
        "another label_version",
    )
    trials = scalar(
        migrated,
        """
        SELECT trials FROM coord.test_importance_counts
         WHERE tenant_id = :t AND rel_class = 'own' AND label_version = 'label-v1'
        """,
        t=tenant,
    )
    assert trials == 35.25, "a 1/pi-weighted trial count is stored unrounded"

    run_id = _insert(migrated, _RUNS, _run(tenant), "id")
    assert isinstance(run_id, uuid.UUID)
    with migrated.connect() as conn:
        run = conn.execute(
            text(
                """
                SELECT degraded_reasons, started_at IS NOT NULL, finished_at, day,
                       heads, rows_written
                  FROM coord.test_importance_runs WHERE id = :id
                """
            ),
            {"id": run_id},
        ).one()
    assert (list(run[0]), *run[1:]) == ([], True, None, None, None, None)

    _insert(migrated, _IMPORTANCE, _estimate(tenant, run_id))
    with migrated.connect() as conn:
        estimate = conn.execute(
            text(
                """
                SELECT n_runs, p_hat, p_plus, q_lower, evidence_basis, cf,
                       negative_asset, flake_onset_suspected, quarantine_recommended,
                       computed_at IS NOT NULL
                  FROM coord.test_importance WHERE tenant_id = :t
                """
            ),
            {"t": tenant},
        ).one()
    assert tuple(estimate) == (None,) * 9 + (True,), (
        "a key and run_id alone store, every estimate NULL (UNKNOWN)"
    )
    _assert_refused(
        migrated,
        _IMPORTANCE,
        _estimate(tenant, run_id),
        "test_importance_pkey",
        "23505",
        "a second estimate row for the same key",
    )
    _assert_admitted(
        migrated, _IMPORTANCE, _estimate(tenant, run_id, rel_class="all"), "the all row"
    )

    _insert(migrated, _APPLICATIONS, _application(tenant))
    _assert_refused(
        migrated,
        _APPLICATIONS,
        _application(tenant),
        "ux_test_quarantine_applications_run",
        "23505",
        "a second application for the same unnamed run",
    )
    _assert_refused(
        migrated,
        _APPLICATIONS,
        _application(tenant, run_ref=""),
        "ux_test_quarantine_applications_run",
        "23505",
        "an empty run_ref is the unnamed run",
    )
    _assert_admitted(
        migrated,
        _APPLICATIONS,
        _application(tenant, run_ref="gh-run-19000000001/attempt-1"),
        "a named run",
    )
    _assert_admitted(
        migrated,
        _APPLICATIONS,
        _application(tenant, mode="enforced"),
        "the enforced mode",
    )


# ---------------------------------------------------------------------------
# 10. comments: vocabularies and owners
# ---------------------------------------------------------------------------

_VOCABULARIES = {
    (_COUNTS, "ref_class"): (
        "pr_merge_ref | candidate | main_push | schedule | dispatch | other"
    ),
    (_COUNTS, "rel_class"): "own | foot | near | far | unknown",
    (_IMPORTANCE, "ref_class"): (
        "pr_merge_ref | candidate | main_push | schedule | dispatch | other"
    ),
    (_IMPORTANCE, "rel_class"): "own | foot | near | far | unknown | all",
    (_IMPORTANCE, "evidence_basis"): "module | test | population | prior_only",
    (_RUNS, "kind"): "count_day | score",
    (_QUARANTINES, "diagnosis"): (
        "nondeterministic_test | environment_dependent | external_dependency | "
        "timeout_shaped | order_dependent | unknown_flake"
    ),
    (_QUARANTINES, "lift_reason"): "fixed | owner_lifted | superseded | expired",
    (_APPLICATIONS, "mode"): "shadow | enforced",
}

_TABLE_OWNERS = {
    _COUNTS: "coord module test_importance",
    _IMPORTANCE: "coord module test_importance",
    _RUNS: "coord module test_importance",
    _QUARANTINES: "coord module test_quarantine",
    _APPLICATIONS: "coord module test_quarantine",
}

# What a reader relies on beyond the vocabularies.
_COMMENT_PHRASES = {
    (_COUNTS, "label_version"): "trial and cell definition",
    (_IMPORTANCE, "imp_version"): "posterior math and the label rule",
    (_IMPORTANCE, "p_plus"): "NULL when n is 0, never 0",
    (_IMPORTANCE, "quarantine_recommended"): "NULL = UNKNOWN",
    (_RUNS, "imp_version"): "NULL for a count_day run",
    (_QUARANTINES, "target"): "* for every target",
    (_APPLICATIONS, "quarantined_ran"): "still-runs evidence",
    (_APPLICATIONS, "verdict_flipped"): "NULL = UNKNOWN",
}


@_needs_pg
def test_comments_record_each_vocabulary_and_owner(migrated: Engine) -> None:
    for table, owner in _TABLE_OWNERS.items():
        comment = scalar(
            migrated,
            "SELECT obj_description(to_regclass(:name), 'pg_class')",
            name=f"coord.{table}",
        )
        assert isinstance(comment, str) and owner in comment, (
            f"coord.{table} comment must name its owner ({owner}): {comment!r}"
        )
    for (table, column), vocabulary in _VOCABULARIES.items():
        comment = column_comment(migrated, table, column)
        # The list opens the comment and ends there: no token added or dropped.
        assert comment is not None and re.match(
            re.escape(vocabulary) + r"(?! \|)", comment
        ), f"{table}.{column} comment must open with {vocabulary!r}: {comment!r}"
    for (table, column), phrase in _COMMENT_PHRASES.items():
        comment = column_comment(migrated, table, column)
        assert comment is not None and phrase in comment, (
            f"{table}.{column} comment must say {phrase!r}: {comment!r}"
        )


# ---------------------------------------------------------------------------
# 11. idempotent
# ---------------------------------------------------------------------------


def _tenant_rows(engine: Engine, table: str, tenant: uuid.UUID) -> object:
    return scalar(
        engine, f"SELECT count(*) FROM coord.{table} WHERE tenant_id = :t", t=tenant
    )


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "cti01_idem") as (engine, url):
        run_alembic(root, url, "upgrade", _REVISION_ID)
        tenant = uuid.uuid4()
        _insert(engine, _QUARANTINES, _quarantine(tenant))
        _insert(engine, _COUNTS, _counts(tenant))

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)

        _assert_full_shape(engine, "after re-running upgrade() over existing tables")
        assert _tenant_rows(engine, _QUARANTINES, tenant) == 1
        assert _tenant_rows(engine, _COUNTS, tenant) == 1
