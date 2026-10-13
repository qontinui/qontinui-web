"""Shape test for the ``coord_agent_worktrees_client_allocation_id_01`` revision.

Phase 2a (web half) of plan
``2026-10-11-allocate-worktree-killed-before-agent-id-leaks-an-unfindable-ledger-row``
adds ``coord.agent_worktrees.client_allocation_id UUID NULL`` and the partial
unique index ``uq_agent_worktrees_device_client_alloc_repo`` on
``(device_id, client_allocation_id, repo) WHERE client_allocation_id IS NOT NULL``.

What this pins is the CONTRACT coord's allocate / worktree-done doors depend on:

1. **Source shapes coord's migration_classifier admits** — every upgrade
   ``op.execute`` is one static literal, and the CONCURRENTLY build sits inside
   an ``autocommit_block`` (outside it, CONCURRENTLY fails at runtime).
2. **Absent at the parent**, so the walk cannot pass vacuously.
3. **Nullable ``uuid``, no default** — NULL is "the caller sent no handle".
4. **The index is UNIQUE, VALID, partial on ``client_allocation_id IS NOT
   NULL``, and keyed ``(device_id, client_allocation_id, repo)``** — asserted
   from ``pg_index`` / ``pg_get_indexdef``, not from the DDL text.
5. **Idempotent re-run** after ``stamp`` back to the parent.
6. **Downgrade drops exactly the column and the index**; re-upgrade restores
   both.
7. **The key's behaviour on real rows.** One allocation inserts one row per
   repo (requested + declared siblings) under one ``device_id``, so two repos
   sharing ``(device_id, client_allocation_id)`` must be ACCEPTED; a same-repo
   replay of that handle must raise 23505 on THIS index (coord maps it to its
   409); NULL handles stay outside the index.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

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
# revision's own `down_revision`; the first test enforces it.
_REVISION_ID = "coord_agent_worktrees_client_allocation_id_01"
_PARENT_REVISION_ID = "kpi_02_coord_session_usage"
_REVISION_FILENAME = (
    "coord_agent_worktrees_client_allocation_id_01_per_device_unique.py"
)

_TABLE = "agent_worktrees"
_COLUMN = "client_allocation_id"
_INDEX = "uq_agent_worktrees_device_client_alloc_repo"


def _source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


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


def test_upgrade_statements_are_static_and_concurrently_is_in_autocommit() -> None:
    calls = upgrade_execute_calls(
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    )
    assert calls, "upgrade() must issue its DDL through op.execute"
    for call in calls:
        assert call.sql is not None, (
            "every upgrade op.execute must take ONE static string literal — "
            "coord's migration_classifier rejects anything dynamic"
        )
    concurrent = [c for c in calls if c.sql and "CONCURRENTLY" in c.sql.upper()]
    assert len(concurrent) == 1, "exactly one CONCURRENTLY index build"
    assert concurrent[0].in_autocommit_block, (
        "CREATE INDEX CONCURRENTLY outside autocommit_block fails at runtime"
    )
    assert "IF NOT EXISTS" in (concurrent[0].sql or "").upper()


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


def _index_facts(engine: Engine) -> tuple[bool, bool, str] | None:
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
            {"idx": _INDEX},
        ).fetchone()
    return (bool(row[0]), bool(row[1]), str(row[2])) if row else None


def _assert_present(engine: Engine, columns_at_parent: set[str]) -> None:
    assert column_info(engine, _TABLE, _COLUMN) == ("uuid", "YES", None), (
        f"{_COLUMN} must be a nullable uuid with no default"
    )
    assert _columns(engine) == columns_at_parent | {_COLUMN}, (
        "the revision adds exactly one column"
    )
    facts = _index_facts(engine)
    assert facts is not None, f"upgrade must create {_INDEX}"
    is_unique, is_valid, indexdef = facts
    assert is_unique, f"{_INDEX} must be UNIQUE"
    assert is_valid, f"{_INDEX} must be VALID (a failed CONCURRENTLY build is not)"
    assert "(device_id, client_allocation_id, repo)" in indexdef, indexdef
    assert "WHERE (client_allocation_id IS NOT NULL)" in indexdef, indexdef


def _insert_worktree(
    conn: Connection,
    *,
    tenant_id: object,
    device_id: object,
    repo: str,
    client_allocation_id: uuid.UUID | None,
) -> None:
    agent_id = uuid.uuid4()
    conn.execute(
        text(
            """
            INSERT INTO coord.agent_worktrees
                (agent_id, device_id, repo, branch, parent_sha, worktree_path,
                 tenant_id, client_allocation_id)
            VALUES (:agent_id, :device_id, :repo, :branch, 'deadbeef', :path,
                    :tenant_id, :client_allocation_id)
            """
        ),
        {
            "agent_id": agent_id,
            "device_id": device_id,
            "repo": repo,
            "branch": f"agent/{agent_id}",
            "path": f"agent-worktrees/{agent_id}/{repo}",
            "tenant_id": tenant_id,
            "client_allocation_id": client_allocation_id,
        },
    )


def _assert_key_behaviour(engine: Engine) -> None:
    """Siblings share a handle; a same-repo replay is a 23505 on this index."""
    with engine.connect() as conn:
        outer = conn.begin()
        try:
            tenant_id = conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (slug, display_name)
                    VALUES ('wt-client-alloc-test', 'wt client alloc test')
                    RETURNING tenant_id
                    """
                )
            ).scalar_one()
            device_id = conn.execute(
                text(
                    """
                    INSERT INTO coord.devices (name, hostname, tenant_id)
                    VALUES ('alloc-test', 'alloc-test-host', :tenant_id)
                    RETURNING device_id
                    """
                ),
                {"tenant_id": tenant_id},
            ).scalar_one()
            handle = uuid.uuid4()
            common = {"tenant_id": tenant_id, "device_id": device_id}

            # One allocation, a requested repo plus a declared sibling: accepted.
            _insert_worktree(
                conn, **common, repo="qontinui-web", client_allocation_id=handle
            )
            _insert_worktree(
                conn, **common, repo="qontinui-schemas", client_allocation_id=handle
            )
            # NULL handles are outside the partial index: never collide.
            _insert_worktree(
                conn, **common, repo="qontinui-web", client_allocation_id=None
            )
            _insert_worktree(
                conn, **common, repo="qontinui-web", client_allocation_id=None
            )

            # A same-device, same-repo replay of the handle: 23505 on THIS index.
            savepoint = conn.begin_nested()
            with pytest.raises(IntegrityError) as excinfo:
                _insert_worktree(
                    conn, **common, repo="qontinui-web", client_allocation_id=handle
                )
            savepoint.rollback()
            orig = excinfo.value.orig
            assert getattr(orig, "pgcode", None) == "23505", orig
            assert orig.diag.constraint_name == _INDEX, (  # type: ignore[union-attr]
                f"the replay must trip {_INDEX}, not another constraint"
            )
        finally:
            outer.rollback()


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the client_allocation_id "
        "column and its unique index were NOT verified — only the revision "
        "source. This skip is not a pass. CI provisions a postgres service; "
        "locally, point DATABASE_URL at a reachable instance."
    ),
)
def test_coord_agent_worktrees_client_allocation_id_01_round_trip() -> None:
    """Walk parent → revision → stamp+re-run → downgrade → re-upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_wt_client_alloc_id_01") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None, (
            f"{_COLUMN} must not exist before {_REVISION_ID} runs"
        )
        assert not index_exists(engine, _INDEX)
        columns_at_parent = _columns(engine)
        assert columns_at_parent, "coord.agent_worktrees must exist at the parent"

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_present(engine, columns_at_parent)
        _assert_key_behaviour(engine)

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
