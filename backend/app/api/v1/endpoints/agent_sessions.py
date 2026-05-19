"""Agent sessions observability surface.

Side D / Phase 4 of plan
``D:/qontinui-root/plans/coord-agent-session-id-tracking.md`` — the
``/admin/agent-sessions`` panel backend.

Two read-only endpoints exposing the lineage data shipped by Phase 1
(alembic ``coord_agent_session_id_lineage``) + Phase 2 (coord HTTP
mutating handlers persisting ``agent_session_id``):

* ``GET /api/v1/admin/agent-sessions`` — list rows from
  ``coord.agent_sessions`` with live/user/since/limit filters.

* ``GET /api/v1/admin/agent-sessions/{session_id}/lineage`` — the
  per-session action timeline. Runs the UNION ALL query from the
  plan's Verification §3 across four lineage tables
  (agent_worktrees / claims_audit / build_events / merge_proposals).

Architectural decision (vs. proxying to coord): the canonical PG
already owns the ``coord.agent_sessions`` table and lineage columns —
the web backend's alembic chain stamps them (see
``alembic/versions/coord_agent_session_id_lineage.py``). Reads can go
direct to PG via the same async session pool, avoiding a cross-repo
HTTP hop that would (a) require new coord routes (none today), (b)
introduce a coord-availability dependency for a read-only dashboard,
and (c) double-count tail latency. Writes still go agent → coord per
plan Side A; this surface is observability-only.

Auth: ``require_admin`` (superuser flag). The lineage data covers
all users, so this is fleet-operator surface, not per-user.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_deps import require_admin
from app.api.deps import get_async_db
from app.models.user import User

logger = structlog.get_logger(__name__)
router = APIRouter()


# ---- Constants -----------------------------------------------------------

# Cap on rows returned by the list endpoint. The dashboard's typical
# query (`live=true`) is naturally bounded by concurrent Claude Code
# sessions on a fleet (low double digits). 500 covers the "show me
# every session in the last week" historical view without unbounded
# pagination machinery.
_LIST_MAX_LIMIT = 500
_LIST_DEFAULT_LIMIT = 100

# Cap on lineage actions per session. A 12-hour Claude session
# typically generates O(100) coord-mediated actions; 500 is the
# plan's stated cap (Verification §3) and matches the UNION ALL
# query verbatim.
_LINEAGE_MAX_ACTIONS = 500


# ---- GET /admin/agent-sessions -------------------------------------------


@router.get("/agent-sessions")
async def list_agent_sessions(
    live: bool = Query(
        False,
        description="If true, filter to rows where closed_at IS NULL.",
    ),
    user_id: UUID | None = Query(
        None,
        description="If set, filter to sessions owned by this user.",
    ),
    since: datetime | None = Query(
        None,
        description=(
            "If set (RFC3339), filter to rows where last_seen >= since. "
            "Useful for 'activity in the last N hours' views."
        ),
    ),
    limit: int = Query(
        _LIST_DEFAULT_LIMIT,
        ge=1,
        le=_LIST_MAX_LIMIT,
        description=f"Max rows to return (capped at {_LIST_MAX_LIMIT}).",
    ),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """List sessions from ``coord.agent_sessions``.

    Ordered by ``last_seen DESC`` so the most-recent activity surfaces
    first. The ``idx_agent_sessions_live`` partial index from the
    Phase 1 migration covers the ``live=true`` path.
    """
    where_clauses: list[str] = []
    params: dict[str, Any] = {"limit": limit}

    if live:
        where_clauses.append("closed_at IS NULL")
    if user_id is not None:
        where_clauses.append("user_id = :user_id")
        params["user_id"] = user_id
    if since is not None:
        where_clauses.append("last_seen >= :since")
        params["since"] = since

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    sql = text(
        f"""
        SELECT id, user_id, device_id, first_seen, last_seen, label, closed_at
        FROM coord.agent_sessions
        {where_sql}
        ORDER BY last_seen DESC
        LIMIT :limit
        """
    )

    try:
        result = await db.execute(sql, params)
        rows = result.mappings().all()
    except Exception as exc:  # pragma: no cover — surface DB issues clearly
        logger.exception(
            "list_agent_sessions_failed",
            error=str(exc),
            live=live,
            user_id=str(user_id) if user_id else None,
        )
        raise HTTPException(
            status_code=500,
            detail=f"failed to query agent_sessions: {exc}",
        )

    sessions = [
        {
            "id": str(r["id"]),
            "user_id": str(r["user_id"]) if r["user_id"] else None,
            "device_id": str(r["device_id"]) if r["device_id"] else None,
            "first_seen": r["first_seen"].isoformat() if r["first_seen"] else None,
            "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
            "label": r["label"],
            "closed_at": r["closed_at"].isoformat() if r["closed_at"] else None,
        }
        for r in rows
    ]
    return {"sessions": sessions, "count": len(sessions)}


# ---- GET /admin/agent-sessions/{id}/lineage ------------------------------


# UNION ALL query from plan Verification §3, extended in
# ``2026-05-19-coordinator-production-readiness.md`` Phase 5 with the
# ``coord.agent_logs`` arm. Five lineage tables now carry the bulk of
# audit history; ``coord.coordinator_decisions`` and ``coord.devices``
# also have the column but are excluded from the timeline view
# (decisions are coordinator-internal; devices show the latest-session
# pointer, not a per-session action). Both surface in follow-up rollup
# views (see plan §"Out-of-scope follow-ups").
#
# Each branch synthesises a uniform ``(kind, handle, occurred_at)``
# shape so the client renders a single timeline without per-kind
# field gymnastics. ``handle`` is the row's natural identifier
# (agent_id, claims_audit row id, build_id, proposal_id, or for
# ``agent_log`` a human-readable ``"<level> <event>"`` string) for
# operator drill-down. Per the readiness plan: ``agent_log`` is
# expected to dominate row counts for active sessions — the 500-row
# LIMIT applies post-UNION, so a noisy agent doesn't crowd out the
# four lower-volume kinds.
_LINEAGE_SQL = text(
    """
    SELECT 'agent_worktree'  AS kind,
           agent_id::text    AS handle,
           created_at        AS occurred_at
      FROM coord.agent_worktrees    WHERE agent_session_id = :session_id
    UNION ALL
    SELECT 'claim_event'     AS kind,
           id::text          AS handle,
           occurred_at       AS occurred_at
      FROM coord.claims_audit       WHERE agent_session_id = :session_id
    UNION ALL
    SELECT 'build_event'     AS kind,
           build_id::text    AS handle,
           started_at        AS occurred_at
      FROM coord.build_events       WHERE agent_session_id = :session_id
    UNION ALL
    SELECT 'merge_proposal'  AS kind,
           proposal_id::text AS handle,
           created_at        AS occurred_at
      FROM coord.merge_proposals    WHERE agent_session_id = :session_id
    UNION ALL
    SELECT 'agent_log'       AS kind,
           level || ' ' || event AS handle,
           occurred_at       AS occurred_at
      FROM coord.agent_logs         WHERE agent_session_id = :session_id
    ORDER BY occurred_at DESC
    LIMIT :limit
    """
)


@router.get("/agent-sessions/{session_id}/lineage")
async def get_agent_session_lineage(
    session_id: UUID,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """Return the per-session action timeline.

    Runs the four-branch UNION ALL from plan Verification §3, capped
    at 500 actions (plan-stated). Returns an empty ``actions`` list
    for unknown / never-active session UUIDs — the endpoint does not
    404 on "no rows" because the session row itself may have been
    soft-closed and rolled out of the lookup table, yet the audit
    trail still survives via the ``ON DELETE SET NULL`` FK posture.
    """
    try:
        result = await db.execute(
            _LINEAGE_SQL,
            {"session_id": session_id, "limit": _LINEAGE_MAX_ACTIONS},
        )
        rows = result.mappings().all()
    except Exception as exc:  # pragma: no cover
        logger.exception(
            "agent_session_lineage_failed",
            session_id=str(session_id),
            error=str(exc),
        )
        raise HTTPException(
            status_code=500,
            detail=f"failed to query lineage: {exc}",
        )

    actions = [
        {
            "kind": r["kind"],
            "handle": r["handle"],
            "occurred_at": (r["occurred_at"].isoformat() if r["occurred_at"] else None),
        }
        for r in rows
    ]
    return {"session_id": str(session_id), "actions": actions}
