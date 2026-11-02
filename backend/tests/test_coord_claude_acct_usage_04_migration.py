"""Shape and round-trip test for the ``coord_claude_acct_usage_04`` revision.

Phase 1 of plan ``2026-10-14-mobile-account-usage-iter5-claude-dir-alias-duplicate``
adds ``coord.claude_account_usage.account_hash TEXT NULL`` and the NON-unique
index ``ix_claude_account_usage_tenant_account_hash`` on
``(tenant_id, account_hash)``.

What this pins is the CONTRACT coord's Phase 2 read/write depends on:

1. **Source shapes coord's migration_classifier admits** — every upgrade
   ``op.execute`` is one static literal, the CONCURRENTLY build sits inside an
   ``autocommit_block``, and the file never needs a live bind (offline-safe).
2. **Absent at the parent**, so the walk cannot pass vacuously.
3. **Nullable ``text``, no default** — NULL is UNKNOWN ("no identity was
   readable"), never a value two rows can share by accident.
4. **The index is NON-unique, VALID and keyed ``(tenant_id, account_hash)``**
   — two homes on one device signed into one account are still two rows, so a
   unique index would reject a legitimate report. Asserted from ``pg_index``.
5. **The row identity is unchanged** — ``uq_claude_account_usage_identity``
   still keys ``(tenant_id, device_id, account_label)``, and two labels with the
   same hash coexist.
6. **Idempotent re-run** after ``stamp`` back to the parent, and a downgrade
   that drops exactly the column and the index.

The database-backed test skips when no test Postgres is reachable. A skip is
not a pass: point it at a live instance with ``QONTINUI_TEST_PG=host:port``
(``conftest.py`` overwrites ``DATABASE_URL`` from that variable at import).
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
    backend_root,
    can_connect,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    upgrade_execute_calls,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision`; the first test enforces it. It is the repo's
# single alembic head on origin/main at authoring time (2026-10-20).
_REVISION_ID = "coord_claude_acct_usage_04"
_PARENT_REVISION_ID = "pr_fix_ctx_head_sha_01"
_REVISION_FILENAME = "coord_claude_acct_usage_04_account_hash.py"

_TABLE = "claude_account_usage"
_COLUMN = "account_hash"
_INDEX = "ix_claude_account_usage_tenant_account_hash"
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


def test_upgrade_statements_are_static_and_concurrently_is_in_autocommit() -> None:
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
    assert "NOT NULL" not in adds[0] and "DEFAULT" not in adds[0], (
        "account_hash must be nullable with no default: NULL is UNKNOWN"
    )
    concurrent = [c for c in calls if c.sql and "CONCURRENTLY" in c.sql.upper()]
    assert len(concurrent) == 1, "exactly one CONCURRENTLY index build"
    assert concurrent[0].in_autocommit_block, (
        "CREATE INDEX CONCURRENTLY outside autocommit_block fails at runtime"
    )
    idx_sql = (concurrent[0].sql or "").upper()
    assert "IF NOT EXISTS" in idx_sql
    assert "UNIQUE" not in idx_sql, "the hash is not a row identity"
    assert "ON COORD.CLAUDE_ACCOUNT_USAGE" in idx_sql


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


def _index_facts(engine: Engine, name: str) -> tuple[bool, bool, str] | None:
    """``(indisunique, indisvalid, pg_get_indexdef)`` for the index, or None."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": name},
        ).fetchone()
    return (bool(row[0]), bool(row[1]), str(row[2])) if row else None


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
    assert column_info(engine, _TABLE, _COLUMN) == ("text", "YES", None), (
        f"{_COLUMN} must be a nullable text with no default"
    )
    assert _columns(engine) == columns_at_parent | {_COLUMN}, (
        "the revision adds exactly one column"
    )
    facts = _index_facts(engine, _INDEX)
    assert facts is not None, f"upgrade must create {_INDEX}"
    is_unique, is_valid, indexdef = facts
    assert not is_unique, f"{_INDEX} must be NON-unique"
    assert is_valid, f"{_INDEX} must be VALID (a failed CONCURRENTLY build is not)"
    assert "(tenant_id, account_hash)" in indexdef, indexdef
    identity = _identity_def(engine)
    assert identity == "UNIQUE (tenant_id, device_id, account_label)", (
        f"the row identity must be unchanged, got {identity!r}"
    )


def _assert_rows_behave(engine: Engine) -> None:
    """Two labels with one hash coexist; NULL hashes are writable and stay NULL."""
    tenant_id = uuid.uuid4()
    device_a = uuid.uuid4()
    device_b = uuid.uuid4()
    same = "a" * 64
    with engine.connect() as conn:
        outer = conn.begin()
        try:
            for device_id, label, account_hash in (
                (device_a, ".claude", same),
                (device_b, ".claude-gmail", same),
                (device_b, ".claude-other", None),
            ):
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.claude_account_usage
                            (tenant_id, device_id, account_label, account_hash)
                        VALUES (:tenant_id, :device_id, :label, :account_hash)
                        """
                    ),
                    {
                        "tenant_id": tenant_id,
                        "device_id": device_id,
                        "label": label,
                        "account_hash": account_hash,
                    },
                )
            grouped = conn.execute(
                text(
                    """
                    SELECT account_hash, count(*)
                      FROM coord.claude_account_usage
                     WHERE tenant_id = :tenant_id
                     GROUP BY account_hash
                     ORDER BY account_hash NULLS LAST
                    """
                ),
                {"tenant_id": tenant_id},
            ).all()
            assert [(r[0], r[1]) for r in grouped] == [(same, 2), (None, 1)]
        finally:
            outer.rollback()


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the account_hash column "
        "and its index were NOT verified — only the revision source. This skip "
        "is not a pass. CI provisions a postgres service; locally, set "
        "QONTINUI_TEST_PG=host:port."
    ),
)
def test_coord_claude_acct_usage_04_round_trip() -> None:
    """Walk parent → revision → stamp+re-run → downgrade → re-upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_claude_acct_usage_04") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None, (
            f"{_COLUMN} must not exist before {_REVISION_ID} runs"
        )
        assert not index_exists(engine, _INDEX)
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
        assert not index_exists(engine, _INDEX)
        assert _columns(engine) == columns_at_parent, (
            "downgrade must leave every other column of the table in place"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_present(engine, columns_at_parent)
