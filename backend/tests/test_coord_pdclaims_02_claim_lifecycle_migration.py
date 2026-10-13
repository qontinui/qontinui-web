"""Structural and round-trip test for alembic ``coord_pdclaims_02_claim_lifecycle``.

Plan ``2026-09-20-nothing-measures-the-product-against-its-declared-intent``
Phase 1 (schema half): the claim ``lifecycle`` (``aspirational`` /
``established``), ``established_at`` and ``established_by`` on
``coord.prompt_document_claim_states``.

Like ``cmtland_01``'s test, this does NOT pin the parent revision —
``down_revision`` is re-pointed at the merged head at land time — it asserts the
chain is WELL-FORMED instead.

Without a database (always runs): chain wiring, the two-value vocabulary, no
backfill DML and no removal on the upgrade path, nothing coord's re-point
planner refuses (its clause E6 — the refusal that stranded qontinui-web#1624),
and the column-drop guard reading the upgrade as dropping nothing.

With a database (``QONTINUI_TEST_PG=host:port`` or ``QONTINUI_TEST_PG_DSN``;
skipped otherwise): column shape, existing rows land ``aspirational`` with no
promotion invented, both CHECKs refusing their violations, the promotion
written as one statement, and an up/down/up round-trip with no residue.
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
    load_revision_module,
    run_alembic,
    scalar,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_pdclaims_02_claim_lifecycle"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_SCHEMA = "coord"
_TABLE = "prompt_document_claim_states"
_CK_LIFECYCLE = "ck_prompt_document_claim_states_lifecycle"
_CK_ESTABLISHED = "ck_prompt_document_claim_states_established_at"

# (name, information_schema data_type, nullable, default-substring or None)
_NEW_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("lifecycle", "text", False, "'aspirational'"),
    ("established_at", "timestamp with time zone", True, None),
    ("established_by", "text", True, None),
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
        _revision_path(), "_test_coord_pdclaims_02_parent"
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


def _outside_downgrade(source: str) -> str:
    """The text coord's E6 scans: everything but the column-0 downgrade() body."""
    out: list[str] = []
    in_downgrade = False
    for line in source.splitlines():
        if in_downgrade:
            if not line[:1] or line[0].isspace() or line.startswith("#"):
                continue
            in_downgrade = False
        # Same predicate as coord's is_downgrade_def: `def downgrade` then `(`.
        if re.match(r"(?:async )?def downgrade\s*\(", line):
            in_downgrade = True
            continue
        out.append(line)
    return "\n".join(out)


# ---------------------------------------------------------------------------
# without a database
# ---------------------------------------------------------------------------


def test_revision_id_is_wired() -> None:
    module = load_revision_module(_revision_path(), "_test_coord_pdclaims_02_wired")
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


def test_upgrade_adds_the_three_columns_and_nothing_else() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    assert not re.search(r"\b(DROP|UPDATE|DELETE|INSERT|TRUNCATE)\b", up, re.I)
    added = re.findall(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)", up, re.I)
    assert added == [c[0] for c in _NEW_COLUMNS], added
    for stmt in re.findall(r"ALTER\s+TABLE\s+([\w.]+)", up, re.I):
        assert stmt == f"{_SCHEMA}.{_TABLE}", stmt
    vocab = re.search(r"lifecycle\s+IN\s*\(([^)]*)\)", up, re.I)
    assert vocab, "no lifecycle vocabulary CHECK"
    assert set(re.findall(r"'([^']*)'", vocab.group(1))) == {
        "aspirational",
        "established",
    }


def test_downgrade_reverses_every_column_and_the_invariant() -> None:
    down = "\n".join(_sql_literals(_function("downgrade")))
    for name, _, _, _ in _NEW_COLUMNS:
        assert re.search(rf"DROP\s+COLUMN\s+IF\s+EXISTS\s+{name}\b", down), name
    assert re.search(rf"DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+{_CK_ESTABLISHED}\b", down)


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


def _columns(engine: Engine) -> dict[str, tuple[str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}


def _insert(engine: Engine, claim_id: str, state: str = "confirmed") -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_SCHEMA}.{_TABLE} "
                "(tenant_id, kind, name, claim_id, anchor, state) "
                "VALUES (:tenant_id, 'domain_spec', 'spec', :claim_id, "
                "'{}'::jsonb, :state)"
            ),
            {"tenant_id": str(uuid.uuid4()), "claim_id": claim_id, "state": state},
        )


def _set(engine: Engine, claim_id: str, assignments: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(f"UPDATE {_SCHEMA}.{_TABLE} SET {assignments} WHERE claim_id = :c"),
            {"c": claim_id},
        )


@_needs_pg
def test_shape_existing_rows_and_both_checks() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "pdclaims02_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", parent)
        _insert(engine, "pre-confirmed", state="confirmed")
        _insert(engine, "pre-contradicted", state="contradicted")
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        for name, data_type, nullable, default in _NEW_COLUMNS:
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            if default is None:
                assert got_default is None, f"{name}: {got_default}"
            else:
                assert got_default is not None and default in got_default

        # No backfill: existing rows land aspirational with no invented
        # promotion, the confirmed one included (coord's catch-up promotes).
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"SELECT lifecycle, established_at, established_by "
                    f"FROM {_SCHEMA}.{_TABLE}"
                )
            ).all()
        assert sorted(rows) == [("aspirational", None, None)] * 2, rows

        # NOT VALID: the invariant checks writes but skipped the existing rows.
        assert (
            scalar(
                engine,
                "SELECT convalidated FROM pg_constraint "
                f"WHERE conname = '{_CK_ESTABLISHED}'",
            )
            is False
        )

        # A fresh write lands aspirational by default.
        _insert(engine, "c1")
        assert (
            scalar(
                engine,
                f"SELECT lifecycle FROM {_SCHEMA}.{_TABLE} WHERE claim_id = 'c1'",
            )
            == "aspirational"
        )

        refused = [
            "lifecycle = 'retired'",  # the closed vocabulary
            "lifecycle = NULL",  # NOT NULL
            "lifecycle = 'established'",  # established with no date
            "established_at = now()",  # aspirational with a date
        ]
        for assignment in refused:
            with pytest.raises(sqlalchemy.exc.IntegrityError):
                _set(engine, "c1", assignment)

        # The promotion is accepted only as one statement assigning the pair;
        # established_by is deliberately not tied to the invariant.
        _set(engine, "c1", "lifecycle = 'established', established_at = now()")
        _set(
            engine,
            "pre-confirmed",
            "lifecycle = 'established', established_at = now(), established_by = 'coord::claim_observer'",
        )
        assert (
            scalar(
                engine,
                f"SELECT count(*) FROM {_SCHEMA}.{_TABLE} "
                "WHERE lifecycle = 'established'",
            )
            == 2
        )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "pdclaims02_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, "c1")

        run_alembic(backend_root(), db_url, "downgrade", parent)
        got = _columns(engine)
        for name, _, _, _ in _NEW_COLUMNS:
            assert name not in got, name
        for ck in (_CK_LIFECYCLE, _CK_ESTABLISHED):
            assert (
                scalar(
                    engine, f"SELECT count(*) FROM pg_constraint WHERE conname = '{ck}'"
                )
                == 0
            ), ck
        assert scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}") == 1

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert set(_columns(engine)) >= {c[0] for c in _NEW_COLUMNS}
        assert (
            scalar(engine, f"SELECT lifecycle FROM {_SCHEMA}.{_TABLE}")
            == "aspirational"
        )
