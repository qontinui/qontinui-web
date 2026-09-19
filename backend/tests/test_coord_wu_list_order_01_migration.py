"""Behaviour test for the ``coord_wu_list_order_01`` revision.

The revision adds, on ``coord.work_units``::

    ALTER TABLE ... ADD COLUMN IF NOT EXISTS derive_checked_at TIMESTAMPTZ NULL
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_coord_work_units_tenant_authored_slug
        ON coord.work_units (tenant_id, authored_at DESC NULLS LAST, slug)
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_coord_work_units_derive_checked_at
        ON coord.work_units (derive_checked_at ASC NULLS FIRST)

Phases 1 and 3 (alembic halves) of plan
``2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost``.

``migration-reversal.yml`` would only confirm the statements execute against an
empty database. What is worth pinning is the ORDER contract each index exists
for — key directions and NULL placement are the whole point, and a
``DESC`` key that silently defaulted to ``NULLS FIRST`` would still "exist".

What is asserted
================

1. The pinned parent is the revision's real ``down_revision`` (no DB needed).
2. Neither the column nor either index exists at the parent revision.
3. After upgrade the column is ``timestamptz``, nullable, no default, and
   carries a comment naming the derive worker.
4. Both indexes are ``indisvalid`` (a killed ``CONCURRENTLY`` build leaves an
   INVALID index that ``IF NOT EXISTS`` skips forever), and their definitions
   carry the exact key directions / NULL placement.
5. **The list page rides the authored index with no Sort node** —
   ``WHERE tenant_id = X ORDER BY authored_at DESC NULLS LAST, slug ASC LIMIT n``.
6. **Sensitivity:** the same order with ``NULLS FIRST`` cannot be served
   without a sort — otherwise assertion 5 would pass against an index whose
   NULL placement is wrong.
7. **The derive rotation read rides the derive index with no Sort node**, and
   the NULLS-FIRST rows come back first.
8. Downgrade removes all three objects and leaves ``authored_at`` and every row.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

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
    run_alembic,
)

_REVISION_ID = "coord_wu_list_order_01"
_PARENT_REVISION_ID = "agent_questions_alert_episode_01"
_REVISION_FILENAME = "coord_wu_list_order_01_authored_index_and_derive_checked_at.py"

_IX_AUTHORED = "ix_coord_work_units_tenant_authored_slug"
_IX_DERIVE = "ix_coord_work_units_derive_checked_at"

_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000a0701")
_OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000a0702")
_EPOCH = datetime(2026, 5, 1, tzinfo=UTC)

# The Phase 1 list page: tenant filter, stable authored order, slug tiebreak.
_LIST_SQL = (
    "SELECT slug FROM coord.work_units "
    f"WHERE tenant_id = '{_TENANT}' "
    "ORDER BY authored_at DESC NULLS LAST, slug ASC LIMIT 50"
)

# Same keys, wrong NULL placement — the index cannot serve this without a sort.
_LIST_WRONG_NULLS_SQL = (
    "SELECT slug FROM coord.work_units "
    f"WHERE tenant_id = '{_TENANT}' "
    "ORDER BY authored_at DESC NULLS FIRST, slug ASC LIMIT 50"
)

# The Phase 3 rotation half: oldest-evaluated first, never-evaluated before all.
_ROTATION_SQL = (
    "SELECT slug FROM coord.work_units "
    "ORDER BY derive_checked_at ASC NULLS FIRST LIMIT 20"
)


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` is the revision's real parent — no database needed."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        source,
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins _PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. "
        "Re-point both together."
    )


def _indexdef(engine: Engine, name: str) -> tuple[str, bool]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid), i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": name},
        ).one()
    return str(row[0]), bool(row[1])


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN with sequential scans penalised (the fixture is tiny)."""
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed(engine: Engine) -> None:
    """Dated, undated and other-tenant units; half already derive-checked."""
    with engine.begin() as conn:
        for tenant, prefix in ((_TENANT, "t"), (_OTHER_TENANT, "o")):
            for i in range(60):
                authored = None if i % 7 == 0 else _EPOCH + timedelta(days=i % 20)
                checked = None if i % 2 == 0 else _EPOCH + timedelta(hours=i)
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.work_units
                            (slug, tenant_id, status, title,
                             authored_at, derive_checked_at)
                        VALUES (:slug, :tenant, 'draft', :slug, :authored, :checked)
                        """
                    ),
                    {
                        "slug": f"{prefix}-unit-{i:03d}",
                        "tenant": str(tenant),
                        "authored": authored,
                        "checked": checked,
                    },
                )
        conn.execute(text("ANALYZE coord.work_units"))


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the list-order and "
        "derive-rotation INDEXES were NOT verified — only the pinned parent. "
        "CI provisions a postgres service; locally, point QONTINUI_TEST_PG at a "
        "reachable instance."
    ),
)
def test_coord_wu_list_order_01_indexes_serve_both_orders_and_downgrade() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_wu_list_order_01_test") as (
        engine,
        url,
    ):
        # 2. Parent — nothing this revision adds exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "work_units", "derive_checked_at") is None
        assert not index_exists(engine, _IX_AUTHORED)
        assert not index_exists(engine, _IX_DERIVE)

        # 3. Apply — the column.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        info = column_info(engine, "work_units", "derive_checked_at")
        assert info is not None, "upgrade must add derive_checked_at"
        data_type, is_nullable, default = info
        assert data_type == "timestamp with time zone"
        assert is_nullable == "YES", "NULL = never evaluated by the derive worker"
        assert default is None, (
            "no default: now() would claim a check that never happened and push "
            "every existing unit to the back of the rotation"
        )
        with engine.connect() as conn:
            comment = conn.execute(
                text(
                    "SELECT col_description('coord.work_units'::regclass, attnum) "
                    "FROM pg_attribute WHERE attrelid = 'coord.work_units'::regclass "
                    "AND attname = 'derive_checked_at'"
                )
            ).scalar()
        assert comment and "derive worker" in comment, comment

        # 4. Both indexes valid, with the exact directions and NULL placement.
        authored_def, authored_valid = _indexdef(engine, _IX_AUTHORED)
        assert authored_valid, "INVALID index — a killed CONCURRENTLY build"
        assert "(tenant_id, authored_at DESC NULLS LAST, slug)" in authored_def, (
            authored_def
        )
        derive_def, derive_valid = _indexdef(engine, _IX_DERIVE)
        assert derive_valid, "INVALID index — a killed CONCURRENTLY build"
        assert "(derive_checked_at NULLS FIRST)" in derive_def, derive_def

        _seed(engine)

        # 5. The list page rides the authored index without sorting.
        plan = _plan_for(engine, _LIST_SQL)
        assert _IX_AUTHORED in plan, f"list page must ride the index:\n{plan}"
        assert "Sort" not in plan, f"the index must supply the order:\n{plan}"

        # 6. Sensitivity — wrong NULL placement needs a sort.
        wrong = _plan_for(engine, _LIST_WRONG_NULLS_SQL)
        assert "Sort" in wrong, (
            "NULLS FIRST must NOT be servable by this index without a sort — "
            f"otherwise assertion 5 proves nothing about NULL placement:\n{wrong}"
        )

        # The order itself: dated newest-first, slug tiebreak, undated last.
        with engine.connect() as conn:
            listed = conn.execute(
                text(
                    "SELECT slug, authored_at FROM coord.work_units "
                    f"WHERE tenant_id = '{_TENANT}' "
                    "ORDER BY authored_at DESC NULLS LAST, slug ASC"
                )
            ).all()
        assert len(listed) == 60
        assert all(r[0].startswith("t-") for r in listed), "tenant filter leaked"
        undated = [r for r in listed if r[1] is None]
        assert undated and listed[-len(undated) :] == undated, "undated sort last"

        # 7. The rotation read rides the derive index, NULLs first.
        rotation_plan = _plan_for(engine, _ROTATION_SQL)
        assert _IX_DERIVE in rotation_plan, rotation_plan
        assert "Sort" not in rotation_plan, rotation_plan
        with engine.connect() as conn:
            first = conn.execute(
                text(
                    "SELECT derive_checked_at FROM coord.work_units "
                    "ORDER BY derive_checked_at ASC NULLS FIRST LIMIT 20"
                )
            ).all()
        assert all(r[0] is None for r in first), (
            "never-evaluated units must come first in the rotation"
        )

        # 8. Downgrade — exactly this revision's three objects.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IX_AUTHORED)
        assert not index_exists(engine, _IX_DERIVE)
        assert column_info(engine, "work_units", "derive_checked_at") is None
        assert column_info(engine, "work_units", "authored_at") is not None, (
            "downgrade must NOT touch authored_at"
        )
        with engine.connect() as conn:
            count = conn.execute(
                text("SELECT count(*) FROM coord.work_units")
            ).scalar_one()
        assert count == 120, "downgrade must not delete rows"

        # Re-upgrade is clean (idempotent DDL, no leftovers).
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _indexdef(engine, _IX_AUTHORED)[1]
        assert _indexdef(engine, _IX_DERIVE)[1]
