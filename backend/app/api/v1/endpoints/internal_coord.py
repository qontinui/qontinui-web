"""Internal coord -> web webhook receiver (T3 gate-action notifications).

When coord's merge gate escalates a PR into specialist review it POSTs here
(see ``qontinui-coord/src/pr_merge/gate_notify.rs``). We map the **embedded**
responsible-context to qontinui user(s) locally — no coord callback, no user
bearer — and create a prefs-respecting, deduped notification for each.

Auth is a shared service secret in ``X-Coord-Service-Token`` (NOT a user JWT):
the route is internal, service-to-service. The feature is dark until
``COORD_WEB_SERVICE_TOKEN`` is provisioned on both sides (503 otherwise),
mirroring coord's default-off discipline.
"""

from __future__ import annotations

import hmac
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import settings
from app.models.notification import Notification, NotificationType
from app.services.identity_resolver import map_context_to_users
from app.services.notifications.builders import build_gate_action_notification
from app.services.notifications.core import notification_service

router = APIRouter()
logger = structlog.get_logger(__name__)


async def verify_coord_service_token(
    x_coord_service_token: str | None = Header(default=None),
) -> None:
    """Constant-time check of the shared coord service secret.

    503 when the feature is unconfigured (no secret) — the receiver is dark
    by default. 401 on a missing/mismatched token.
    """
    expected = settings.COORD_WEB_SERVICE_TOKEN
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="gate-action notifications are not configured",
        )
    if not x_coord_service_token or not hmac.compare_digest(
        x_coord_service_token, expected
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid coord service token",
        )


class ResponsibleContext(BaseModel):
    """Coord-resolved ids — web maps these to users locally (no callback)."""

    github_author_id: int | None = None
    agent_id: UUID | None = None
    device_owner_user_id: UUID | None = None
    tenant_fallback_user_ids: list[UUID] = Field(default_factory=list)


class CoordNotification(BaseModel):
    """The webhook body coord POSTs (mirrors gate_notify.rs's wire contract)."""

    repo: str
    pr_number: int
    block_reason_code: str
    head_sha: str
    tenant_id: UUID | None = None
    coverage: float | None = None
    graph_available: bool = False
    responsible_context: ResponsibleContext = Field(default_factory=ResponsibleContext)
    evidence: dict[str, Any] = Field(default_factory=dict)


async def _already_notified(db: AsyncSession, user_id: UUID, dedup_key: str) -> bool:
    """N3 dedup: has this user already been notified for this exact verdict?"""
    result = await db.execute(
        select(Notification.id)
        .where(Notification.user_id == user_id)
        .where(Notification.notification_type == NotificationType.GATE_ACTION)
        .where(Notification.notification_metadata["dedup_key"].astext == dedup_key)
        .limit(1)
    )
    return result.first() is not None


@router.post(
    "/coord-notifications",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(verify_coord_service_token)],
)
async def receive_coord_notification(
    body: CoordNotification,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Resolve responsible user(s) from the embedded context and notify them."""
    rc = body.responsible_context
    users = await map_context_to_users(
        db,
        github_author_id=(
            str(rc.github_author_id) if rc.github_author_id is not None else None
        ),
        device_owner_user_id=rc.device_owner_user_id,
        tenant_fallback_user_ids=rc.tenant_fallback_user_ids,
    )

    if not users:
        # Soft no-op (NOT an error): coord supplied no resolvable user. The
        # webhook is best-effort — never fail it back to coord.
        logger.info(
            "gate_action_no_responsible_user",
            repo=body.repo,
            pr_number=body.pr_number,
            block_reason_code=body.block_reason_code,
        )
        return {"notified": 0, "reason": "no responsible user resolved"}

    title, message, metadata = build_gate_action_notification(
        repo=body.repo,
        pr_number=body.pr_number,
        block_reason_code=body.block_reason_code,
        head_sha=body.head_sha,
        coverage=body.coverage,
        graph_available=body.graph_available,
        frontend_url=settings.FRONTEND_URL,
    )
    dedup_key = metadata["dedup_key"]

    notified = 0
    skipped = 0
    for ru in users:
        if await _already_notified(db, ru.user_id, dedup_key):
            skipped += 1
            continue
        created = await notification_service.create_notification(
            db,
            user_id=ru.user_id,
            notification_type=NotificationType.GATE_ACTION,
            title=title,
            message=message,
            resource_type="pull_request",
            resource_id=f"{body.repo}#{body.pr_number}",
            metadata={**metadata, "source": ru.source},
            send_email=True,
        )
        # create_notification returns None when the user opted out of this
        # category (prefs-gated) — that counts as handled, not notified.
        if created is not None:
            notified += 1

    logger.info(
        "gate_action_notified",
        repo=body.repo,
        pr_number=body.pr_number,
        block_reason_code=body.block_reason_code,
        resolved=len(users),
        notified=notified,
        skipped_dedup=skipped,
    )
    return {"notified": notified, "skipped_dedup": skipped, "resolved": len(users)}
