"""Shared dispatcher service — Phase 3D refactor (Phase 2B updated).

Both the user-facing ``POST /api/v1/workflows/{id}/dispatch`` endpoint and
the Celery task that fires on cron end up doing the same three things:

1. Verify the workflow exists and the caller owns it.
2. Resolve a target runner ("auto" → healthiest owned; UUID → ownership +
   health check).
3. Send the workflow to the runner. Preferred transport is the unified
   WebSocket channel (``runner.ws_session_id IS NOT NULL`` → fan via
   :class:`RunnerWebSocketManager`). HTTP-with-``dispatch_secret`` is the
   fallback while the runner still uses the legacy heartbeat path —
   Phase 5 cleanup will remove this once the runner has migrated.

Error reporting uses :class:`DispatchError` — the endpoint maps it to
``HTTPException``, the Celery task serialises it into ``last_error``.
"""

from __future__ import annotations

import uuid as _uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID

import httpx
import structlog
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.redis_config import get_redis
from app.models.runner import Runner
from app.models.unified_workflow import UnifiedWorkflow
from app.schemas.workflow_dispatch import WorkflowDispatchResponse
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

__all__ = [
    "HEALTHY_HEARTBEAT_WINDOW_SECONDS",
    "DISPATCH_HTTP_TIMEOUT_SECONDS",
    "DispatchError",
    "dispatch_workflow_to_runner",
]


# ---------------------------------------------------------------------------
# Policy constants — preserved verbatim from the Phase 3C endpoint.
# ---------------------------------------------------------------------------

HEALTHY_HEARTBEAT_WINDOW_SECONDS = 90
"""Runner is eligible for dispatch only if its last_heartbeat is within this
many seconds of now. Matches the 30s heartbeat cadence + 3x slack."""

DISPATCH_HTTP_TIMEOUT_SECONDS = 15.0
"""Upper bound on the outbound POST to the runner. The runner responds 202
immediately after spawning the workflow, so this stays short."""


# ---------------------------------------------------------------------------
# Error type
# ---------------------------------------------------------------------------


@dataclass
class DispatchError(Exception):
    """A failure case from :func:`dispatch_workflow_to_runner`.

    ``status_code`` is the HTTP status the endpoint should surface. ``code``
    is a short machine-readable string (``"no_healthy_runner"``,
    ``"runner_rejected"``, ...). ``detail`` is the full detail body the
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


def _is_healthy(runner: Runner) -> bool:
    """Return True if ``runner``'s last heartbeat is within the health window."""
    if runner.last_heartbeat is None:
        return False
    age = utc_now() - runner.last_heartbeat
    return age <= timedelta(seconds=HEALTHY_HEARTBEAT_WINDOW_SECONDS)


async def _pick_auto_runner(db: AsyncSession, user_id: UUID) -> Runner | None:
    """Return the healthiest server-mode runner owned by ``user_id``.

    Ported verbatim from Phase 3C to preserve behaviour.
    """
    query = (
        select(Runner)
        .where(
            Runner.user_id == user_id,
            Runner.server_mode.is_(True),
        )
        .order_by(Runner.last_heartbeat.desc().nullslast())
    )
    result = await db.execute(query)
    for runner in result.scalars().all():
        if _is_healthy(runner) and runner.status == "healthy":
            return runner
    return None


async def _get_runner_by_id(db: AsyncSession, runner_id: UUID) -> Runner | None:
    query = select(Runner).where(Runner.id == runner_id)
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
    """Resolve the target runner and POST the workflow to it.

    Args:
        db: Active async session.
        user_id: The caller's user id. Scoping for ownership checks.
        workflow_id: Workflow to dispatch.
        target: Either the literal string ``"auto"`` or a runner UUID.
        parent_task_run_id: Optional opaque string forwarded to the runner.

    Raises:
        DispatchError: On any failure path (404, 409, 503, 502, 504, ...).

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
                        "No healthy server-mode runner is available. "
                        "Start a runner with QONTINUI_SERVER_MODE=1 and "
                        "valid web credentials, then retry."
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
        if not runner.server_mode:
            raise DispatchError(
                status_code=409,
                code="runner_not_server_mode",
                detail={
                    "code": "runner_not_server_mode",
                    "message": (
                        f"Runner {target_id} is not in server mode — "
                        "cannot dispatch workflows to it."
                    ),
                },
            )
        if not _is_healthy(runner) or runner.status != "healthy":
            raise DispatchError(
                status_code=503,
                code="runner_unhealthy",
                detail={
                    "code": "runner_unhealthy",
                    "message": (
                        f"Runner {target_id} is not healthy (last_heartbeat="
                        f"{runner.last_heartbeat!s}, status={runner.status!r})."
                    ),
                },
            )

    # ------------------------------------------------------------------
    # 3a. WS-preferred dispatch. If the runner has an open WebSocket
    #     (``ws_session_id`` set), relay the dispatch as a typed message
    #     instead of going over HTTP. The runner ACKs over the same WS;
    #     the synchronous "execution_id" we historically returned is
    #     replaced by a server-minted ``run_id`` that the runner echoes.
    # ------------------------------------------------------------------
    if runner.ws_session_id is not None:
        redis = await get_redis()
        manager = await get_runner_websocket_manager(redis)
        if manager.is_connected(runner.id):
            run_id = str(_uuid.uuid4())
            sent = await manager.send_dispatch(
                runner.id,
                {
                    "run_id": run_id,
                    "workflow_id": str(workflow_id),
                    "parent_task_run_id": parent_task_run_id,
                },
            )
            if sent:
                logger.info(
                    "workflow_dispatched_ws",
                    user_id=str(user_id),
                    workflow_id=str(workflow_id),
                    runner_id=str(runner.id),
                    run_id=run_id,
                )
                return WorkflowDispatchResponse(
                    execution_id=run_id,
                    runner_id=runner.id,
                    runner_hostname=runner.hostname,
                    runner_port=runner.port,
                    dispatched_at=utc_now(),
                    task_run_id=None,
                )

    # ------------------------------------------------------------------
    # 3b. HTTP fallback (legacy path until Phase 5 cleanup).
    # ------------------------------------------------------------------
    runner_url = f"http://{runner.hostname}:{runner.port}/api/workflows/run"
    request_body = {
        "workflow_id": str(workflow_id),
        "parent_task_run_id": parent_task_run_id,
    }
    try:
        async with httpx.AsyncClient(timeout=DISPATCH_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                runner_url,
                json=request_body,
                headers={"Authorization": f"Bearer {runner.dispatch_secret}"},
            )
    except httpx.ConnectError as e:
        logger.warning(
            "workflow_dispatch_connect_error",
            runner_id=str(runner.id),
            runner_url=runner_url,
            error=str(e),
        )
        raise DispatchError(
            status_code=502,
            code="runner_unreachable",
            detail={
                "code": "runner_unreachable",
                "message": (
                    f"Could not reach runner at {runner.hostname}:{runner.port}"
                ),
            },
        )
    except httpx.TimeoutException:
        logger.warning(
            "workflow_dispatch_timeout",
            runner_id=str(runner.id),
            runner_url=runner_url,
        )
        raise DispatchError(
            status_code=504,
            code="runner_timeout",
            detail={
                "code": "runner_timeout",
                "message": f"Runner at {runner.hostname}:{runner.port} timed out",
            },
        )

    if resp.status_code < 200 or resp.status_code >= 300:
        body_preview = resp.text[:500] if resp.text else ""
        logger.warning(
            "workflow_dispatch_non_2xx",
            runner_id=str(runner.id),
            runner_status=resp.status_code,
            body_preview=body_preview,
        )
        raise DispatchError(
            status_code=502,
            code="runner_rejected",
            detail={
                "code": "runner_rejected",
                "runner_status": resp.status_code,
                "runner_body_preview": body_preview,
            },
        )

    # ------------------------------------------------------------------
    # 4. Extract execution_id; build response.
    # ------------------------------------------------------------------
    try:
        runner_body = resp.json()
    except ValueError:
        raise DispatchError(
            status_code=502,
            code="runner_bad_response",
            detail={
                "code": "runner_bad_response",
                "message": "Runner returned a non-JSON response body",
            },
        )

    execution_id = runner_body.get("execution_id")
    if not isinstance(execution_id, str) or not execution_id:
        raise DispatchError(
            status_code=502,
            code="runner_bad_response",
            detail={
                "code": "runner_bad_response",
                "message": "Runner response missing execution_id",
            },
        )

    logger.info(
        "workflow_dispatched",
        user_id=str(user_id),
        workflow_id=str(workflow_id),
        runner_id=str(runner.id),
        execution_id=execution_id,
    )

    return WorkflowDispatchResponse(
        execution_id=execution_id,
        runner_id=runner.id,
        runner_hostname=runner.hostname,
        runner_port=runner.port,
        dispatched_at=utc_now(),
        task_run_id=None,
    )
