"""Wake-runner endpoint for Phase F.2 of the scheduler reliability plan.

Exposes ``POST /api/v1/runner/{user_id}/wake`` which the qontinui-web
frontend calls before dispatching work to a runner. Behaviour:

* If the target user has at least one live runner connection (tracked
  via :class:`RunnerConnectionManager`'s user reverse-lookup), respond
  with ``{ "status": "already_online", "connection_id": <int> }`` so the
  caller can dispatch normally.
* Otherwise, mint a wake intent: persist a small JSON blob in Redis at
  ``wake_intent:{user_id}:{intent_id}`` with a 60-second TTL, and
  respond with a ``qontinui://wake?...`` deep-link URL. The frontend
  navigates to that URL via ``window.location.href``; the runner-side
  deep-link handler (Phase F-runner) opens the runner, registers, and
  the manager's ``fulfill_wake_intent`` flow surfaces a ``runner.woke``
  event over the per-user Redis pub/sub channel.

Requests are authorised via the same dependency the rest of the
``/api/v1/runner/*`` surface uses (``get_current_active_user_async``).
A user may only request a wake for *their own* ``user_id``.
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Annotated, Any
from urllib.parse import urlencode
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field
from qontinui_schemas.common import utc_now
from redis import asyncio as aioredis

from app.api.deps import get_current_active_user_async
from app.config.redis_config import get_redis
from app.models.user import User as UserModel
from app.services.runner_connection_manager import (
    WAKE_INTENT_KEY_PREFIX,
    WAKE_INTENT_TTL_SECONDS,
    RunnerConnectionManager,
    get_runner_connection_manager,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


class WakeRequest(BaseModel):
    """Request body for ``POST /api/v1/runner/{user_id}/wake``."""

    task_id: UUID | None = Field(
        default=None,
        description=(
            "Optional task identifier to dispatch once the runner registers."
            " Surfaced back to the runner via the deep-link query string."
        ),
    )
    reason: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Free-form reason — surfaced in logs and the runner.woke event.",
    )


class WakeAlreadyOnlineResponse(BaseModel):
    status: str = Field("already_online", description="Discriminator value.")
    connection_id: int


class WakeRequiredResponse(BaseModel):
    status: str = Field("wake_required", description="Discriminator value.")
    wake_url: str
    intent_id: str
    expires_at: str


WakeResponse = WakeAlreadyOnlineResponse | WakeRequiredResponse


def _build_wake_url(intent_id: str, task_id: UUID | None) -> str:
    """Build a ``qontinui://wake?...`` URL with URL-encoded query params."""
    params: dict[str, str] = {"intent": intent_id}
    if task_id is not None:
        params["task_id"] = str(task_id)
    # urlencode handles percent-encoding of every character that isn't safe in
    # a query string, including any user-supplied task_id text.
    return "qontinui://wake?" + urlencode(params)


async def _get_manager(
    redis: Annotated[aioredis.Redis, Depends(get_redis)],
) -> RunnerConnectionManager:
    """Resolve the singleton ``RunnerConnectionManager`` for DI."""
    return await get_runner_connection_manager(redis)


@router.post(
    "/{user_id}/wake",
    response_model=WakeResponse,
    status_code=status.HTTP_200_OK,
    summary="Request a wake-up for a user's offline runner",
)
async def wake_runner(
    *,
    user_id: Annotated[UUID, Path(description="Owner user ID to wake.")],
    payload: WakeRequest,
    current_user: Annotated[UserModel, Depends(get_current_active_user_async)],
    redis: Annotated[aioredis.Redis, Depends(get_redis)],
    manager: Annotated[RunnerConnectionManager, Depends(_get_manager)],
) -> Any:
    """Return either ``already_online`` or a wake-URL the caller navigates to.

    See module docstring for the full behavior contract.
    """
    # A user may only wake their own runner. Cross-user wake attempts
    # are rejected with 403.
    if current_user.id != user_id:
        logger.warning(
            "wake_runner_cross_user_attempt",
            requested_user_id=str(user_id),
            current_user_id=str(current_user.id),
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "forbidden",
                "message": "Cannot wake another user's runner.",
            },
        )

    # Fast path: runner already online → caller can dispatch normally.
    online_connection_id = await manager.is_user_online(user_id)
    if online_connection_id is not None:
        logger.info(
            "wake_runner_already_online",
            user_id=str(user_id),
            connection_id=online_connection_id,
            reason=payload.reason,
        )
        return WakeAlreadyOnlineResponse(
            status="already_online",
            connection_id=online_connection_id,
        )

    # Slow path: mint a wake intent, store with TTL, return deep link.
    intent_id = uuid4().hex
    expires_at = utc_now() + timedelta(seconds=WAKE_INTENT_TTL_SECONDS)
    intent_payload: dict[str, Any] = {
        "intent_id": intent_id,
        "user_id": str(user_id),
        "task_id": str(payload.task_id) if payload.task_id is not None else None,
        "reason": payload.reason,
        "created_at": utc_now().isoformat(),
        "expires_at": expires_at.isoformat(),
    }

    redis_key = f"{WAKE_INTENT_KEY_PREFIX}:{user_id}:{intent_id}"
    try:
        await redis.set(
            redis_key,
            json.dumps(intent_payload),
            ex=WAKE_INTENT_TTL_SECONDS,
        )
    except Exception as e:
        logger.error(
            "wake_intent_persist_failed",
            user_id=str(user_id),
            intent_id=intent_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "wake_intent_storage_failed",
                "message": "Could not persist wake intent.",
            },
        ) from e

    wake_url = _build_wake_url(intent_id=intent_id, task_id=payload.task_id)

    logger.info(
        "wake_intent_created",
        user_id=str(user_id),
        intent_id=intent_id,
        ttl_seconds=WAKE_INTENT_TTL_SECONDS,
        has_task_id=payload.task_id is not None,
        reason=payload.reason,
    )

    return WakeRequiredResponse(
        status="wake_required",
        wake_url=wake_url,
        intent_id=intent_id,
        expires_at=expires_at.isoformat(),
    )
