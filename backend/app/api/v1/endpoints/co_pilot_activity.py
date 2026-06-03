"""UI Bridge co-pilot activity feed (§4.8 of the production-safe plan).

Two endpoints, both authenticated as the calling user (Cognito-issued JWT,
same path as every other ``/api/v1/users/*`` route):

* ``POST /api/v1/users/me/co-pilot/activity``
    Server-to-server insert. The Next.js ``/api/ui-bridge/*`` route
    handler calls this after the auth gate verified the caller and after
    the relay returned a response. The row records the FACT a write
    command was issued, with a SAFE summary (never raw payload).
    Fire-and-forget on the caller side: a failure here MUST NOT block
    the relay response (the caller drops the response). We still return
    201 on success so the relay can log a warning on persistent
    failures.

* ``GET /api/v1/users/me/co-pilot/activity``
    User-facing activity feed. Returns the caller's own rows from
    ``web.bridge_audit_log`` (scoped by ``user_id = current_user.id`` —
    a user can never see anyone else's rows). Cursor pagination by
    ``occurred_at DESC``; default 100, max 500.
"""

from datetime import datetime
from typing import Any, cast

import structlog
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.bridge_audit_log import BridgeAuditLog
from app.models.user import User as UserModel
from app.schemas.co_pilot_activity import (
    BridgeAuditLogCreate,
    BridgeAuditLogListResponse,
    BridgeAuditLogResponse,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


_ALLOWED_STATUS_FILTERS = {"success", "failed"}
_ALLOWED_EXECUTION_FILTERS = {"received", "executed", "failed"}
_MAX_LIMIT = 500
_DEFAULT_LIMIT = 100


@router.post(
    "/activity",
    response_model=BridgeAuditLogResponse,
    status_code=status.HTTP_201_CREATED,
)
async def insert_bridge_audit_log(
    *,
    payload: BridgeAuditLogCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Insert a single audit row for the calling user.

    Called server-to-server by the Next.js relay route. Bearer in the
    Authorization header is the SAME token the relay just verified, so
    ``current_user`` here is the same user the row will be attributed
    to — there is no path to inject rows under another user's id.
    """
    row = BridgeAuditLog(
        user_id=current_user.id,
        session_id=payload.session_id,
        tab_id=payload.tab_id,
        command_name=payload.command_name,
        target_element_id=payload.target_element_id,
        path=payload.path,
        method=payload.method,
        origin=payload.origin,
        status_code=payload.status_code,
        execution_status=payload.execution_status,
        payload_summary=payload.payload_summary,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/activity", response_model=BridgeAuditLogListResponse)
async def list_my_bridge_audit_log(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    limit: int = Query(
        _DEFAULT_LIMIT,
        ge=1,
        le=_MAX_LIMIT,
        description=f"Max rows to return (1-{_MAX_LIMIT}).",
    ),
    before: datetime | None = Query(
        None,
        description=(
            "Cursor: return rows with occurred_at strictly less than this "
            "timestamp. Use the previous response's `next_before` to paginate."
        ),
    ),
    after: datetime | None = Query(
        None, description="Lower bound: occurred_at >= this timestamp."
    ),
    command: str | None = Query(
        None,
        description="Exact command_name filter (e.g. element.action).",
    ),
    status: str | None = Query(
        None,
        description=(
            "Coarse RECEIPT status filter: `success` = HTTP 2xx, `failed` = "
            "anything else. This is the relay-delivery status, NOT execution."
        ),
    ),
    execution: str | None = Query(
        None,
        description=(
            "EXECUTION outcome filter (Bug 3b): `received` (delivered, outcome "
            "unknown), `executed` (tab confirmed it ran), or `failed` (tab "
            "reported it did not run). Distinct from `status`, which is receipt."
        ),
    ),
) -> Any:
    """Return the calling user's bridge audit rows, newest first.

    Strictly scoped to ``user_id = current_user.id`` — a user can never
    see rows from another account.
    """
    conditions = [BridgeAuditLog.user_id == current_user.id]
    if before is not None:
        conditions.append(BridgeAuditLog.occurred_at < before)
    if after is not None:
        conditions.append(BridgeAuditLog.occurred_at >= after)
    if command is not None:
        conditions.append(BridgeAuditLog.command_name == command)
    if status is not None and status in _ALLOWED_STATUS_FILTERS:
        if status == "success":
            conditions.append(BridgeAuditLog.status_code < 400)
        else:
            conditions.append(BridgeAuditLog.status_code >= 400)
    if execution is not None and execution in _ALLOWED_EXECUTION_FILTERS:
        conditions.append(BridgeAuditLog.execution_status == execution)

    stmt = (
        select(BridgeAuditLog)
        .where(and_(*conditions))
        .order_by(desc(BridgeAuditLog.occurred_at))
        .limit(limit + 1)
    )
    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    page = rows[:limit]
    next_before: datetime | None
    if has_more and page:
        # SQLAlchemy types `occurred_at` as `Column[datetime] | None` at the
        # type-checker layer, but the column is non-nullable in PG, so the
        # runtime value is always a datetime. Cast for mypy.
        next_before = cast(datetime, page[-1].occurred_at)
    else:
        next_before = None

    return BridgeAuditLogListResponse(
        items=[BridgeAuditLogResponse.model_validate(r) for r in page],
        next_before=next_before,
    )
