"""Behaviour test for the ``coord_sessions_fleet_idx_01`` index.

The revision creates one index::

    CREATE INDEX CONCURRENTLY coord_sessions_tenant_started_idx
    ON coord.sessions (tenant_id, started_at DESC, id DESC)

for the UNFILTERED ``GET /coord/sessions/fleet`` keyset walk (plan
``2026-09-12-fleet-principal-session-routes-disagree-about-being-capped``,
Phase 4). The plan's verification is explicit that *"an index that the planner
declines to use is not a fix, and only EXPLAIN says which happened"* — so the
contract pinned here is the PLAN, not the statement's execution.

What is asserted
================

1. At the parent revision the index does not exist, and coord's keyset
   continuation needs a ``Sort`` — no existing index supplies
   ``started_at DESC, id DESC`` behind a bare tenant equality. This is the
   "before" half of the EXPLAIN comparison; without it, assertion 4 could pass
   against an order some other index already served.
2. After upgrade the index exists and is ``indisvalid`` (a killed CONCURRENTLY
   build leaves an INVALID index that ``IF NOT EXISTS`` would skip forever).
3. Its key list is exactly ``(tenant_id, started_at DESC, id DESC)`` — the
   route's ``ORDER BY`` including the tiebreaker.
4. coord's unfiltered FIRST PAGE and KEYSET CONTINUATION both ride the index
   with no ``Sort`` node, and on the continuation the row comparison
   ``(started_at, id) < (...)`` is an index CONDITION, not a filter.
5. The walk is total over the seeded rows, including a same-microsecond tie
   that only ``id`` separates: every open row appears exactly once.
6. Downgrade removes the index; rows survive.

The SQL is ``build_fleet_sql`` as rendered by qontinui-coord ``origin/main``
``5abacc93a`` (``crates/coord/src/session_fleet.rs``) for the default scope —
every optional column present, ``closed_at IS NULL``, no ``device_id`` /
``state`` filter — with its positional ``$n`` spelled as named binds.

The fixture is tiny, so ``enable_seqscan = off`` removes the cost question
(a seq scan wins any tiny table) and leaves the one asked: CAN the planner serve
this statement from this index in the requested order? At production scale the
EXPLAIN against the real table is still owed after deploy.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_sessions_fleet_idx_01"
_PARENT_REVISION_ID = "coord_iops_idx_01"

_INDEX_NAME = "coord_sessions_tenant_started_idx"
_KEY_FRAGMENT = "(tenant_id, started_at DESC, id DESC)"

_SELECT = """
    SELECT s.id, s.device_id, d.hostname, d.name AS display_name,
           s.claude_code_session_id, s.session_kind,
           s.intent->>'purpose' AS intent, s.state, s.session_status,
           s.work_unit_slug, s.repo, s.branch, s.provider, s.correlation_topic,
           s.started_at, s.last_heartbeat_at, s.closed_at
      FROM coord.sessions AS s
      LEFT JOIN coord.devices AS d ON d.device_id = s.device_id
"""

# Page 1 of the default (open-sessions) unfiltered walk.
_FIRST_PAGE_SQL = (
    _SELECT
    + """
     WHERE s.tenant_id = :tenant AND s.closed_at IS NULL
     ORDER BY s.started_at DESC, s.id DESC
     LIMIT :lim
    """
)

# Every later page: the row-comparison keyset predicate.
_CONTINUATION_SQL = (
    _SELECT
    + """
     WHERE s.tenant_id = :tenant AND s.closed_at IS NULL
       AND (s.started_at, s.id) < (CAST(:k AS timestamptz), CAST(:i AS uuid))
     ORDER BY s.started_at DESC, s.id DESC
     LIMIT :lim
    """
)

_BASE_TIME = dt.datetime(2026, 9, 1, tzinfo=dt.UTC)
_OPEN_ROWS = 10
_PAGE = 3


def _index_state(engine: Engine) -> tuple[bool, str]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": _INDEX_NAME},
        ).one()
    return bool(row[0]), str(row[1])


def _plan_for(engine: Engine, sql: str, params: dict[str, object]) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised (see module docstring)."""
    # SET LOCAL inside a transaction: the setting dies with the transaction
    # instead of riding the pooled connection into later queries.
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}"), params).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed(engine: Engine) -> tuple[uuid.UUID, set[uuid.UUID]]:
    """A tenant with ``_OPEN_ROWS`` open sessions and one closed one.

    Two open sessions share a ``started_at`` to the microsecond, so only ``id``
    orders them — the case the ``id DESC`` key column and the cursor's second
    component exist for. A second tenant's rows exercise the tenant equality.

    Returns the walked tenant and the ids of its OPEN sessions.
    """
    tenant = uuid.uuid4()
    other_tenant = uuid.uuid4()
    open_ids: set[uuid.UUID] = set()
    with engine.begin() as conn:
        for t, slug in ((tenant, "fleetidx-a"), (other_tenant, "fleetidx-b")):
            conn.execute(
                text(
                    "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                    "VALUES (:t, :slug, :slug)"
                ),
                {"t": t, "slug": slug},
            )
            device = uuid.uuid4()
            conn.execute(
                text(
                    "INSERT INTO coord.devices (device_id, tenant_id, name, hostname) "
                    "VALUES (:d, :t, 'box', 'box')"
                ),
                {"d": device, "t": t},
            )
            for n in range(_OPEN_ROWS + 1):
                sid = uuid.uuid4()
                # Rows 4 and 5 share an instant: a tie only `id` breaks.
                offset = 4 if n == 5 else n
                closed = n == _OPEN_ROWS
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.sessions
                            (id, tenant_id, device_id, session_kind, intent,
                             state, started_at, closed_at)
                        VALUES
                            (:id, :t, :d, 'terminal_claude', CAST('{}' AS jsonb),
                             CASE WHEN :closed THEN 'closed' ELSE 'active' END,
                             :started,
                             CASE WHEN :closed THEN now() ELSE NULL END)
                        """
                    ),
                    {
                        "id": sid,
                        "t": t,
                        "d": device,
                        "closed": closed,
                        "started": _BASE_TIME + dt.timedelta(minutes=offset),
                    },
                )
                if t == tenant and not closed:
                    open_ids.add(sid)
        conn.execute(text("ANALYZE coord.sessions"))
    return tenant, open_ids


def _walk(engine: Engine, tenant: uuid.UUID) -> list[uuid.UUID]:
    """Walk the tenant's open sessions page by page, exactly as coord does."""
    seen: list[uuid.UUID] = []
    with engine.connect() as conn:
        rows = conn.execute(
            text(_FIRST_PAGE_SQL), {"tenant": tenant, "lim": _PAGE}
        ).all()
        while rows:
            seen.extend(r.id for r in rows)
            last = rows[-1]
            rows = conn.execute(
                text(_CONTINUATION_SQL),
                {
                    "tenant": tenant,
                    "k": last.started_at,
                    "i": last.id,
                    "lim": _PAGE,
                },
            ).all()
    return seen


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_sessions_fleet_idx_01_serves_the_unfiltered_fleet_walk() -> None:
    """Build the index; prove the unfiltered walk rides it with no Sort."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_sessions_fleet_idx_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision: no index, and the continuation needs a Sort.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must be created by this revision, not an earlier one"
        )

        tenant, open_ids = _seed(engine)
        cursor_params = {
            "tenant": tenant,
            "k": _BASE_TIME + dt.timedelta(minutes=7),
            "i": uuid.uuid4(),
            "lim": _PAGE,
        }

        before = _plan_for(engine, _CONTINUATION_SQL, cursor_params)
        assert "Sort" in before, (
            "at the parent revision no index should supply the walk's order; "
            "if one does, this revision is redundant:\n" + before
        )

        # ----------------------------------------------------------------
        # 2-3. Apply: exists, VALID, and with the route's exact key list.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        valid, definition = _index_state(engine)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run: existence is not enough"
        )
        assert _KEY_FRAGMENT in definition, (
            f"key list must match ORDER BY started_at DESC, id DESC behind the "
            f"tenant equality; got: {definition}"
        )
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.sessions"))

        # ----------------------------------------------------------------
        # 4. Both page shapes ride the index, in order, with no Sort.
        # ----------------------------------------------------------------
        first = _plan_for(engine, _FIRST_PAGE_SQL, {"tenant": tenant, "lim": _PAGE})
        assert _INDEX_NAME in first, f"page 1 must ride the new index:\n{first}"
        assert "Sort" not in first, f"page 1 must not sort:\n{first}"

        after = _plan_for(engine, _CONTINUATION_SQL, cursor_params)
        assert _INDEX_NAME in after, f"the continuation must ride the index:\n{after}"
        assert "Sort" not in after, f"the continuation must not sort:\n{after}"
        cond_lines = [ln for ln in after.splitlines() if "Index Cond" in ln]
        assert any(
            "ROW(s.started_at, s.id) <" in ln or "ROW(started_at, id) <" in ln
            for ln in cond_lines
        ), (
            "the keyset row comparison must be an index CONDITION on the full "
            f"two-column key, not a recheck filter:\n{after}"
        )

        # ----------------------------------------------------------------
        # 5. The walk is total: every open row once, the tie included, the
        #    closed row and the other tenant's rows excluded.
        # ----------------------------------------------------------------
        walked = _walk(engine, tenant)
        assert len(walked) == len(set(walked)), "a row repeated across pages"
        assert set(walked) == open_ids, "the walk skipped or leaked a row"

        # ----------------------------------------------------------------
        # 6. Downgrade removes it; the table and its rows survive.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.sessions")
            ).scalar() == 2 * (_OPEN_ROWS + 1), (
                "downgrade drops the index only; rows are untouched"
            )
