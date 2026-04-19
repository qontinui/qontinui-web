"""
Workflow dispatch API — user-triggered routing of workflows to server-mode
runners.

``POST /api/v1/workflows/{workflow_id}/dispatch``

Resolves a target runner (either "auto"-picked or an explicit UUID the user
owns), authenticates to it with the runner's ``dispatch_secret`` (a plaintext
m2m bearer persisted on the ``runners`` row), and POSTs
``/api/workflows/run`` on the runner. On success, returns the runner's
execution_id plus metadata about the chosen runner.

Health check policy: a runner is eligible for dispatch only when **both**:

* Its ``last_heartbeat`` is within :data:`HEALTHY_HEARTBEAT_WINDOW_SECONDS`
  of now (the row's ``status`` field alone is not enough — a runner that
  died without deregistering keeps ``status="healthy"`` forever).
* Its ``status`` field is ``"healthy"`` (the runner has self-reported
  healthy Restate / no pending shutdown).
"""

from datetime import timedelta
from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.runner import Runner
from app.models.unified_workflow import UnifiedWorkflow
from app.models.user import User
from app.schemas.workflow_dispatch import (
    WorkflowDispatchRequest,
    WorkflowDispatchResponse,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Policy constants
# ---------------------------------------------------------------------------

HEALTHY_HEARTBEAT_WINDOW_SECONDS = 90
"""Runner is eligible for dispatch only if its last_heartbeat is within this
many seconds of now. Matches the 30s heartbeat cadence + 3x slack."""

DISPATCH_HTTP_TIMEOUT_SECONDS = 15.0
"""Upper bound on the outbound POST to the runner. The runner responds 202
immediately after spawning the workflow (no wait for completion), so this
should be comfortably short."""


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

    "Healthiest" = most-recent heartbeat within the health window, preferring
    rows the runner itself has marked ``status="healthy"``. The filter is
    applied in two stages (SQL narrows to owned server-mode rows; Python
    applies the timestamp window) to keep the SQL portable across test
    databases that don't have ``now() - interval`` support.
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

    Returns None when the workflow does not exist *or* it exists but is owned
    by a different user. We collapse the two cases so we don't leak the
    existence of arbitrary workflow ids to a user who doesn't own them.
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
# Route
# ---------------------------------------------------------------------------


@router.post(
    "/{workflow_id}/dispatch",
    response_model=WorkflowDispatchResponse,
    status_code=status.HTTP_200_OK,
    summary="Dispatch a workflow to a server-mode runner",
)
async def dispatch_workflow(
    *,
    workflow_id: UUID,
    payload: WorkflowDispatchRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Route ``workflow_id`` to a server-mode runner and return the result.

    See module docstring for the target-resolution and health rules.
    """

    # ------------------------------------------------------------------
    # 1. Verify the workflow exists and the current user owns it.
    # ------------------------------------------------------------------
    workflow = await _get_owned_workflow(db, workflow_id, current_user.id)
    if workflow is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {workflow_id}",
        )

    # ------------------------------------------------------------------
    # 2. Resolve the target runner.
    # ------------------------------------------------------------------
    if payload.target == "auto":
        runner = await _pick_auto_runner(db, current_user.id)
        if runner is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
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
        # payload.target is a UUID.
        target_id: UUID = payload.target  # type: ignore[assignment]
        runner = await _get_runner_by_id(db, target_id)
        if runner is None or runner.user_id != current_user.id:
            # Collapse not-found and not-owned to avoid leaking existence.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Runner not found: {target_id}",
            )
        if not runner.server_mode:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "runner_not_server_mode",
                    "message": (
                        f"Runner {target_id} is not in server mode — "
                        "cannot dispatch workflows to it."
                    ),
                },
            )
        if not _is_healthy(runner) or runner.status != "healthy":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "runner_unhealthy",
                    "message": (
                        f"Runner {target_id} is not healthy (last_heartbeat="
                        f"{runner.last_heartbeat!s}, status={runner.status!r})."
                    ),
                },
            )

    # ------------------------------------------------------------------
    # 3. POST to the runner.
    # ------------------------------------------------------------------
    runner_url = f"http://{runner.hostname}:{runner.port}/api/workflows/run"
    request_body = {
        "workflow_id": str(workflow_id),
        "parent_task_run_id": payload.parent_task_run_id,
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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "runner_unreachable",
                "message": f"Could not reach runner at {runner.hostname}:{runner.port}",
            },
        )
    except httpx.TimeoutException:
        logger.warning(
            "workflow_dispatch_timeout",
            runner_id=str(runner.id),
            runner_url=runner_url,
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "runner_bad_response",
                "message": "Runner returned a non-JSON response body",
            },
        )

    execution_id = runner_body.get("execution_id")
    if not isinstance(execution_id, str) or not execution_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "runner_bad_response",
                "message": "Runner response missing execution_id",
            },
        )

    logger.info(
        "workflow_dispatched",
        user_id=str(current_user.id),
        workflow_id=str(workflow_id),
        runner_id=str(runner.id),
        execution_id=execution_id,
    )

    # Local task_run creation skipped:
    # :class:`~app.models.task_run.TaskRun` has no column for an external
    # (runner-side) execution id, so there's nothing to link against. Once a
    # dedicated linkage column or a parent task_run created by the UI lands,
    # populate ``task_run_id`` here.

    return WorkflowDispatchResponse(
        execution_id=execution_id,
        runner_id=runner.id,
        runner_hostname=runner.hostname,
        runner_port=runner.port,
        dispatched_at=utc_now(),
        task_run_id=None,
    )
