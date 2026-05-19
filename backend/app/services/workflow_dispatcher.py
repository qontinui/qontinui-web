"""Shared dispatcher service.

Both the user-facing ``POST /api/v1/workflows/{id}/dispatch`` endpoint and
the Celery task that fires on cron end up doing the same three things:

1. Verify the workflow exists and the caller owns it.
2. Resolve a target runner ("auto" → healthiest owned; UUID → ownership +
   health check).
3. Send the workflow to the runner over the unified WebSocket channel
   (``runner.ws_session_id IS NOT NULL`` → fan via
   :class:`RunnerWebSocketManager`). Every runner connects via WS.

Error reporting uses :class:`DispatchError` — the endpoint maps it to
``HTTPException``, the Celery task serialises it into ``last_error``.
"""

from __future__ import annotations

import uuid as _uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID

import structlog
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_config import get_redis
from app.models.device import Device
from app.models.unified_workflow import UnifiedWorkflow
from app.schemas.workflow_dispatch import WorkflowDispatchResponse
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

__all__ = [
    "HEALTHY_HEARTBEAT_WINDOW_SECONDS",
    "DispatchError",
    "dispatch_workflow_to_runner",
]


# ---------------------------------------------------------------------------
# Policy constants
# ---------------------------------------------------------------------------

HEALTHY_HEARTBEAT_WINDOW_SECONDS = 90
"""Runner is eligible for dispatch only if its last_heartbeat is within this
many seconds of now. Matches the 30s heartbeat cadence + 3x slack."""


# ---------------------------------------------------------------------------
# Error type
# ---------------------------------------------------------------------------


@dataclass
class DispatchError(Exception):
    """A failure case from :func:`dispatch_workflow_to_runner`.

    ``status_code`` is the HTTP status the endpoint should surface. ``code``
    is a short machine-readable string (``"no_healthy_runner"``,
    ``"runner_offline"``, ...). ``detail`` is the full detail body the
    endpoint historically attaches to ``HTTPException(detail=...)``.
    """

    status_code: int
    code: str
    detail: Any

    def __str__(self) -> str:  # pragma: no cover - repr helper
        return f"DispatchError(status={self.status_code}, code={self.code})"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_healthy(device: Device) -> bool:
    """Return True if ``device``'s last heartbeat is within the health window."""
    if device.last_heartbeat is None:
        return False
    age = utc_now() - device.last_heartbeat
    return age <= timedelta(seconds=HEALTHY_HEARTBEAT_WINDOW_SECONDS)


async def _pick_auto_runner(db: AsyncSession, user_id: UUID) -> Device | None:
    """Return the healthiest device owned by ``user_id`` (WS-connected wins).

    Preference order:
      1. WS-connected (``ws_session_id IS NOT NULL``) and derived_status healthy.
      2. Heartbeat-fresh and derived_status == 'healthy'.
    """
    query = (
        select(Device)
        .where(
            Device.user_id == user_id,
            Device.capability_user_paired.is_(True),
        )
        .order_by(
            Device.ws_session_id.is_not(None).desc(),
            Device.last_heartbeat.desc().nullslast(),
        )
    )
    result = await db.execute(query)
    for device in result.scalars().all():
        if device.ws_session_id is not None and device.derived_status == "healthy":
            return device
        if _is_healthy(device) and device.derived_status == "healthy":
            return device
    return None


async def _get_runner_by_id(db: AsyncSession, runner_id: UUID) -> Device | None:
    query = select(Device).where(Device.device_id == runner_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def _get_owned_workflow(
    db: AsyncSession, workflow_id: UUID, user_id: UUID
) -> UnifiedWorkflow | None:
    """Fetch the workflow and enforce per-user ownership.

    Collapses not-found and not-owned into ``None`` to avoid leaking the
    existence of arbitrary workflow ids.
    """
    query = select(UnifiedWorkflow).where(UnifiedWorkflow.id == workflow_id)
    result = await db.execute(query)
    workflow = result.scalar_one_or_none()
    if workflow is None:
        return None
    if (
        workflow.created_by_user_id is not None
        and workflow.created_by_user_id != user_id
    ):
        return None
    return workflow


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def dispatch_workflow_to_runner(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_id: UUID,
    target: str | UUID,
    parent_task_run_id: str | None = None,
) -> WorkflowDispatchResponse:
    """Resolve the target runner and relay the workflow over its WebSocket.

    Args:
        db: Active async session.
        user_id: The caller's user id. Scoping for ownership checks.
        workflow_id: Workflow to dispatch.
        target: Either the literal string ``"auto"`` or a runner UUID.
        parent_task_run_id: Optional opaque string forwarded to the runner.

    Raises:
        DispatchError: On any failure path (404, 409, 503, ...).

    Returns:
        The successful dispatch response shape.
    """
    # ------------------------------------------------------------------
    # 1. Verify the workflow exists and the user owns it.
    # ------------------------------------------------------------------
    workflow = await _get_owned_workflow(db, workflow_id, user_id)
    if workflow is None:
        raise DispatchError(
            status_code=404,
            code="workflow_not_found",
            detail=f"Workflow not found: {workflow_id}",
        )

    # ------------------------------------------------------------------
    # 2. Resolve target runner.
    # ------------------------------------------------------------------
    if target == "auto":
        runner = await _pick_auto_runner(db, user_id)
        if runner is None:
            raise DispatchError(
                status_code=503,
                code="no_healthy_runner",
                detail={
                    "code": "no_healthy_runner",
                    "message": (
                        "No healthy runner is available. Start a runner "
                        "with valid web credentials so it connects to the "
                        "unified WebSocket channel, then retry."
                    ),
                },
            )
    else:
        # Coerce to UUID. Callers that want "auto" must pass the literal
        # string; anything else is expected to be a UUID (or coerceable).
        target_id: UUID = target if isinstance(target, UUID) else UUID(str(target))
        runner = await _get_runner_by_id(db, target_id)
        if runner is None or runner.user_id != user_id:
            raise DispatchError(
                status_code=404,
                code="runner_not_found",
                detail=f"Runner not found: {target_id}",
            )
        # WS-connected wins; otherwise fall through to heartbeat freshness.
        if runner.ws_session_id is None and (
            not _is_healthy(runner) or runner.derived_status != "healthy"
        ):
            raise DispatchError(
                status_code=503,
                code="runner_unhealthy",
                detail={
                    "code": "runner_unhealthy",
                    "message": (
                        f"Runner {target_id} is not healthy (last_heartbeat="
                        f"{runner.last_heartbeat!s}, status={runner.derived_status!r})."
                    ),
                },
            )

    # ------------------------------------------------------------------
    # 3. Dispatch over the runner's unified WebSocket.
    # ------------------------------------------------------------------
    if runner.ws_session_id is None:
        raise DispatchError(
            status_code=503,
            code="runner_offline",
            detail={
                "code": "runner_offline",
                "message": (
                    f"Runner {runner.device_id} is not connected via WebSocket. "
                    "Start the runner so it connects to "
                    "/api/v1/runners/ws and retry."
                ),
            },
        )

    redis = await get_redis()
    manager = await get_runner_websocket_manager(redis)
    if not manager.is_connected(runner.device_id):
        raise DispatchError(
            status_code=503,
            code="runner_offline",
            detail={
                "code": "runner_offline",
                "message": (
                    f"Runner {runner.device_id} has a stale ws_session_id but no "
                    "active WebSocket on this backend instance."
                ),
            },
        )

    run_id = str(_uuid.uuid4())
    sent = await manager.send_dispatch(
        runner.device_id,
        {
            "run_id": run_id,
            "workflow_id": str(workflow_id),
            "parent_task_run_id": parent_task_run_id,
        },
    )
    if not sent:
        raise DispatchError(
            status_code=503,
            code="dispatch_failed",
            detail={
                "code": "dispatch_failed",
                "message": "Could not relay dispatch over WebSocket.",
            },
        )

    logger.info(
        "workflow_dispatched_ws",
        user_id=str(user_id),
        workflow_id=str(workflow_id),
        runner_id=str(runner.device_id),
        run_id=run_id,
    )

    # ``Device.port`` is nullable on the unified ``coord.devices`` table
    # (non-runner devices have NULL). A runner that reached this dispatch
    # path has WS-paired, which implies it advertised a port — but mypy
    # can't see that, so narrow explicitly with a 0 fallback. Downstream
    # consumers treat 0 as "WS dispatch already routed; HTTP fallback
    # disabled", consistent with the WS-bridge architecture.
    return WorkflowDispatchResponse(
        execution_id=run_id,
        runner_id=runner.device_id,
        runner_hostname=runner.hostname,
        runner_port=runner.port or 0,
        dispatched_at=utc_now(),
        task_run_id=None,
    )
