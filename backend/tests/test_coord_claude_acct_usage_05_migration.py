"""Shape and round-trip test for the ``coord_claude_acct_usage_05`` revision.

Phase 1 of plan
``2026-11-17-coord-retires-claude-account-usage-rows-a-device-stopped-reporting``
adds ``coord.claude_account_usage.retired_at TIMESTAMPTZ NULL``.

What this pins is the CONTRACT coord's Phase 2 depends on:

1. **Source shapes coord's migration_classifier admits** — every upgrade
   ``op.execute`` is one static literal and the file never needs a live bind.
2. **Absent at the parent**, so the walk cannot pass vacuously.
3. **Nullable ``timestamp with time zone``, no default** — NULL means LIVE, so
   every pre-existing row stays served.
4. **The row identity is unchanged** — ``uq_claude_account_usage_identity``
   still keys ``(tenant_id, device_id, account_label)``.
5. **Idempotent re-run** after ``stamp`` back to the parent, and a downgrade
   that drops exactly the column.

The database-backed test skips when no test Postgres is reachable. A skip is
not a pass: point it at a live instance with ``QONTINUI_TEST_PG=host:port``.
"""

from __future__ import annotations

import ast
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    alter_statement,
    backend_root,
    backfill_statements,
    can_connect,
    column_info,
    declared_parent_revision_id,
    drop_statements,
    ephemeral_database,
    forbidden_add_clauses,
    load_revision_module,
    recorded_sql,
    run_alembic,
    upgrade_execute_calls,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision`; the first test enforces it.
_REVISION_ID = "coord_claude_acct_usage_05"
_PARENT_REVISION_ID = "cirscope_02_devices_ci_runner_scope_index"
_REVISION_FILENAME = "coord_claude_acct_usage_05_retired_at.py"

_TABLE = "claude_account_usage"
_COLUMN = "retired_at"
_IDENTITY = "uq_claude_account_usage_identity"


def _path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _source() -> str:
    return _path().read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Source-level pins (Postgres-free)
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins _PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_down_revision_is_on_one_line() -> None:
    """Coord's line-scoped alembic-graph parser must see the parent."""
    one_line = re.search(
        r'^down_revision[^=\n]*=\s*"' + re.escape(_PARENT_REVISION_ID) + r'"\s*$',
        _source(),
        re.MULTILINE,
    )
    assert one_line is not None, (
        "down_revision must be assigned its string literal on ONE line"
    )


def test_revision_id_is_unique_across_the_versions_dir() -> None:
    versions = _path().parent
    hits = [
        p.name
        for p in versions.glob("*.py")
        if re.search(
            rf'^revision(?::\s*str)?\s*=\s*["\']{re.escape(_REVISION_ID)}["\']',
            p.read_text(encoding="utf-8", errors="replace"),
            re.M,
        )
    ]
    assert hits == [_REVISION_FILENAME], f"revision id {_REVISION_ID} claimed by {hits}"


def test_upgrade_statements_are_static_and_add_one_nullable_column() -> None:
    calls = upgrade_execute_calls(_path())
    assert calls, "upgrade() must issue its DDL through op.execute"
    for call in calls:
        assert call.sql is not None, (
            "every upgrade op.execute must take ONE static string literal — "
            "coord's migration_classifier rejects anything dynamic"
        )
    upper = [(c.sql or "").upper() for c in calls]
    assert not any(re.search(r"\bDROP\b", s) for s in upper), (
        "upgrade() must not DROP anything"
    )
    adds = [s for s in upper if "ADD COLUMN" in s]
    assert len(adds) == 1 and "IF NOT EXISTS" in adds[0]
    assert "COORD.CLAUDE_ACCOUNT_USAGE" in adds[0]
    assert "RETIRED_AT TIMESTAMPTZ" in adds[0]
    assert "NOT NULL" not in adds[0] and "DEFAULT" not in adds[0], (
        "retired_at must be nullable with no default: NULL means live"
    )


def test_the_recorded_add_carries_no_forbidden_clause(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The harness's clause check, composed by hand: the revision also emits a
    lock bound, which ``assert_nullable_add_only`` does not admit."""
    module = load_revision_module(_path(), "coord_claude_acct_usage_05_under_test")
    statements = recorded_sql(module, "upgrade", monkeypatch)
    add = alter_statement(statements, "coord", _TABLE, "ADD")
    assert not forbidden_add_clauses(add), forbidden_add_clauses(add)
    assert not drop_statements(statements), drop_statements(statements)
    assert not backfill_statements(statements), "rows written before must keep NULL"
    others = [sql for sql in statements if sql is not add]
    assert others == ["SET LOCAL lock_timeout = '3s'"], others


def test_offline_safe_no_bind_in_either_direction() -> None:
    tree = ast.parse(_source())
    called = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert "get_bind" not in called, "op.get_bind() is not offline-safe"
    assert "inspect" not in called, "sa.inspect() needs a live bind"


# ---------------------------------------------------------------------------
# Database-backed round trip
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {r[0] for r in rows}


def _identity_def(engine: Engine) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(c.oid)
                  FROM pg_constraint c
                  JOIN pg_namespace n ON n.oid = c.connamespace
                 WHERE n.nspname = 'coord' AND c.conname = :name
                """
            ),
            {"name": _IDENTITY},
        ).scalar_one_or_none()


def _assert_present(engine: Engine, columns_at_parent: set[str]) -> None:
    assert column_info(engine, _TABLE, _COLUMN) == (
        "timestamp with time zone",
        "YES",
        None,
    ), f"{_COLUMN} must be a nullable timestamptz with no default"
    assert _columns(engine) == columns_at_parent | {_COLUMN}, (
        "the revision adds exactly one column"
    )
    identity = _identity_def(engine)
    assert identity == "UNIQUE (tenant_id, device_id, account_label)", (
        f"the row identity must be unchanged, got {identity!r}"
    )


def _assert_rows_behave(engine: Engine) -> None:
    """A new row is live (NULL); a stamped one is excluded; clearing it works."""
    tenant_id = uuid.uuid4()
    device_id = uuid.uuid4()
    with engine.connect() as conn:
        outer = conn.begin()
        try:
            for label in (".claude", ".claude-gmail"):
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.claude_account_usage
                            (tenant_id, device_id, account_label)
                        VALUES (:tenant_id, :device_id, :label)
                        """
                    ),
                    {"tenant_id": tenant_id, "device_id": device_id, "label": label},
                )
            conn.execute(
                text(
                    """
                    UPDATE coord.claude_account_usage SET retired_at = now()
                     WHERE tenant_id = :tenant_id AND account_label = '.claude'
                    """
                ),
                {"tenant_id": tenant_id},
            )
            live = (
                conn.execute(
                    text(
                        """
                    SELECT account_label FROM coord.claude_account_usage
                     WHERE tenant_id = :tenant_id AND retired_at IS NULL
                    """
                    ),
                    {"tenant_id": tenant_id},
                )
                .scalars()
                .all()
            )
            assert live == [".claude-gmail"]
            conn.execute(
                text(
                    """
                    UPDATE coord.claude_account_usage SET retired_at = NULL
                     WHERE tenant_id = :tenant_id
                    """
                ),
                {"tenant_id": tenant_id},
            )
            live_again = (
                conn.execute(
                    text(
                        """
                    SELECT account_label FROM coord.claude_account_usage
                     WHERE tenant_id = :tenant_id AND retired_at IS NULL
                     ORDER BY account_label
                    """
                    ),
                    {"tenant_id": tenant_id},
                )
                .scalars()
                .all()
            )
            assert live_again == [".claude", ".claude-gmail"]
        finally:
            outer.rollback()


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the retired_at column was "
        "NOT verified — only the revision source. This skip is not a pass. CI "
        "provisions a postgres service; locally, set QONTINUI_TEST_PG=host:port."
    ),
)
def test_coord_claude_acct_usage_05_round_trip() -> None:
    """Walk parent → revision → stamp+re-run → downgrade → re-upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_claude_acct_usage_05") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None, (
            f"{_COLUMN} must not exist before {_REVISION_ID} runs"
        )
        columns_at_parent = _columns(engine)
        assert columns_at_parent, "coord.claude_account_usage must exist at the parent"

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_present(engine, columns_at_parent)
        _assert_rows_behave(engine)

        # Re-run over its own output: `stamp` rewinds only the version marker.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_present(engine, columns_at_parent)

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        assert _columns(engine) == columns_at_parent, (
            "downgrade must leave every other column of the table in place"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_present(engine, columns_at_parent)
