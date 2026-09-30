"""Shared dispatcher service.

Both the user-facing ``POST /api/v1/workflows/{id}/dispatch`` endpoint and
a scheduled fire end up doing the same three things. A scheduled fire is
:func:`app.jobs.scheduled_dispatch.fire_scheduled_run`, called for each due
row by ``poll_and_dispatch_due`` — the in-process scheduler's
``scheduled_dispatch`` task (``app/core/scheduler.py``, every 30 s) — and by
the run-now endpoint for one row:

1. Verify the workflow exists and the caller owns it.
2. Resolve a target runner ("auto" → coord's capability-checked resolver,
   ``POST /coord/devices/resolve``; UUID → ownership + health check).
3. Send the workflow to the runner over the unified WebSocket channel
   (``runner.ws_session_id IS NOT NULL`` → fan via
   :class:`RunnerWebSocketManager`). Every runner connects via WS.

Error reporting uses :class:`DispatchError` — the endpoint maps it to
``HTTPException``, ``fire_scheduled_run`` serialises it into the schedule
row's ``last_error``.
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
from app.models.app_deploy_state import AppDeploymentFreshness, AppDeployState
from app.models.device import Device
from app.models.unified_workflow import UnifiedWorkflow
from app.schemas.device_resolve import (
    AllCapableDrainedOutcome,
    DeviceResolveRequest,
    DeviceResolveResult,
    DrainUnreadableOutcome,
    NoCapableDeviceOutcome,
    PinIneligibleOutcome,
    ResolvedOutcome,
    UnavailableOutcome,
)
from app.schemas.workflow_dispatch import WorkflowDispatchResponse
from app.services.coord_device_resolve import (
    NO_PAIRED_DEVICE_CODE,
    CoordCaller,
    resolve_device,
)
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

__all__ = [
    "HEALTHY_HEARTBEAT_WINDOW_SECONDS",
    "AutoPickRefusal",
    "DispatchError",
    "dispatch_to_fresh_host",
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
    ``"no_paired_runner"``, ``"runner_offline"``, ...). ``detail`` is the
    full detail body the endpoint historically attaches to
    ``HTTPException(detail=...)``.
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


@dataclass(frozen=True)
class AutoPickRefusal:
    """Coord's resolver named no device for an automatic pick — and why.

    ``code`` is stable and machine-readable; ``outcome`` is the resolver's own
    answer. A refusal is never "pick something else": there is no web-side
    ordering, for interactive or background callers, so an UNKNOWN resolver
    means no auto-pick.
    """

    code: str
    message: str
    #: ``None`` when echoing the outcome would disclose something the caller
    #: may not see (a device id that is not theirs).
    outcome: DeviceResolveResult | None

    def to_dispatch_error(self) -> DispatchError:
        detail: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.outcome is not None:
            detail["resolver_outcome"] = self.outcome.model_dump(mode="json")
        return DispatchError(status_code=503, code=self.code, detail=detail)


# The ``unavailable`` reasons a later attempt can clear by itself. The rest
# are a refusal, a missing credential or a deployment fault: retrying as-is
# gets the same answer, so the message does not advise it.
_TRANSIENT_UNAVAILABLE = frozenset({"coord_unreachable", "upstream_error"})


def _unavailable_cause(outcome: UnavailableOutcome) -> str:
    """``reason[: coord's error string][, HTTP status]`` — all coord said."""
    cause: str = outcome.reason
    if outcome.code:
        cause += f": {outcome.code}"
    if outcome.status is not None:
        cause += f", HTTP {outcome.status}"
    return cause


def _unavailable_refusal(outcome: UnavailableOutcome) -> AutoPickRefusal:
    """The refusal for a resolver that named nothing because it was not
    answered. Coord's own ``error`` string and HTTP status are in the
    message, so they reach the run-now response and a schedule's
    ``last_error``."""
    cause = _unavailable_cause(outcome)
    if outcome.reason == "refused" and outcome.code == NO_PAIRED_DEVICE_CODE:
        # Only a background caller's mint answers this, so the user is a
        # schedule's owner. It is coord's fact about the user, not about
        # which runners are online: starting one does not help, pairing does.
        return AutoPickRefusal(
            code="no_paired_runner",
            message=(
                f"The user this run is for has no paired runner ({cause}). "
                "Pair a runner with that account."
            ),
            outcome=outcome,
        )
    if outcome.reason == "refused":
        message = (
            f"Coord refused to resolve a runner ({cause}), so none is picked "
            "automatically. The refusal is coord's own; choose a runner "
            "explicitly."
        )
    else:
        advice = (
            "Choose a runner explicitly, or retry."
            if outcome.reason in _TRANSIENT_UNAVAILABLE
            else "Choose a runner explicitly."
        )
        message = (
            f"Coord's device resolver could not be asked ({cause}), so no "
            f"runner is picked automatically. {advice}"
        )
    return AutoPickRefusal(
        code="device_resolver_unavailable", message=message, outcome=outcome
    )


def _refusal_for(outcome: DeviceResolveResult) -> AutoPickRefusal:
    """The typed refusal for every resolver answer that is not a device."""
    if isinstance(outcome, UnavailableOutcome):
        return _unavailable_refusal(outcome)
    if isinstance(outcome, DrainUnreadableOutcome):
        return AutoPickRefusal(
            code="drain_unreadable",
            message=(
                "Coord could not read which devices are drained, so it names "
                "none. Retry shortly."
            ),
            outcome=outcome,
        )
    if isinstance(outcome, AllCapableDrainedOutcome):
        return AutoPickRefusal(
            code="all_capable_runners_drained",
            message="Every runner able to run this is drained.",
            outcome=outcome,
        )
    if isinstance(outcome, NoCapableDeviceOutcome):
        missing = f" (missing: {', '.join(outcome.missing)})" if outcome.missing else ""
        return AutoPickRefusal(
            code="no_healthy_runner",
            message=(
                "No online runner of yours can run this"
                f"{missing}. Start a runner so it connects, then retry."
            ),
            outcome=outcome,
        )
    if isinstance(outcome, PinIneligibleOutcome):
        return AutoPickRefusal(
            code="runner_ineligible",
            message=outcome.detail,
            outcome=outcome,
        )
    # ``resolved`` is handled by the callers; anything else is a contract gap.
    return AutoPickRefusal(
        code="device_resolver_unavailable",
        message="Coord's device resolver gave an answer this build cannot read.",
        outcome=outcome,
    )


async def _owned_device(
    db: AsyncSession, user_id: UUID, outcome: ResolvedOutcome
) -> Device | AutoPickRefusal:
    """The ``Device`` row for coord's pick, re-checked against ``user_id``.

    Coord already scopes to the caller's paired devices; this is the web
    side's own ownership floor, so a resolver bug can never dispatch to a
    device the dispatching user does not own.
    """
    device = await _get_runner_by_id(db, outcome.device_id)
    if device is None or device.user_id != user_id:
        # The device id stays in the server log only: it may be someone
        # else's, and the refusal goes back to the caller.
        logger.warning(
            "resolved_device_not_owned",
            user_id=str(user_id),
            device_id=str(outcome.device_id),
        )
        return AutoPickRefusal(
            code="resolved_device_not_owned",
            message=(
                "Coord resolved a device that is not one of your runners "
                "here; refusing to dispatch to it."
            ),
            outcome=None,
        )
    return device


async def _pick_auto_runner(
    db: AsyncSession,
    user_id: UUID,
    caller: CoordCaller,
    *,
    required_capabilities: list[str],
) -> Device | AutoPickRefusal:
    """Ask coord's resolver which of the caller's runners runs this work.

    ``placeable`` work with no pin: coord picks from the caller's paired,
    heartbeat-fresh, capable, non-drained devices (plan D1/D3).
    ``required_capabilities`` is a required parameter, not a default, so no
    caller is capability-blind by omission (the precedent coord set in
    ``gates.rs`` ``pick_online_device_for_tenant``).

    Anything but ``resolved`` is an :class:`AutoPickRefusal` — including an
    UNKNOWN resolver. There is deliberately no web-side ordering to fall back
    on, for any caller: coord is the only thing that names a runner here.

    That holds for a BACKGROUND caller too (a scheduled fire,
    ``CoordCaller.background_for(owner)``). It has no request and so no
    bearer of its own; :func:`resolve_device` mints one acting for the user
    the caller names and asks the same door, so a scheduled run gets the same
    capability and drain checks as an interactive one. When that mint fails
    the pick is refused like any other UNKNOWN. An interactive caller that
    arrives without a bearer is NOT background: it is refused
    ``unavailable / no_credential`` and nothing is minted for it.
    """
    outcome = await resolve_device(
        DeviceResolveRequest(
            required_capabilities=required_capabilities, work_class="placeable"
        ),
        caller,
    )
    if isinstance(outcome, ResolvedOutcome):
        return await _owned_device(db, user_id, outcome)
    return _refusal_for(outcome)


async def dispatch_to_fresh_host(
    db: AsyncSession,
    user_id: UUID,
    app_id: str,
    caller: CoordCaller,
    strategy: str = "best_effort",
) -> Device | AutoPickRefusal | None:
    """Resolve an owned, eligible device with a FRESH deployment of ``app_id``.

    Fleet-fresh P4: ``project.app_deploy_state`` (written by the runner's
    auto-fresh engine) says which of the user's hosts serve a build matching
    upstream HEAD. Coord does not hold deploy state, so the join stays here
    as a POST-FILTER over coord's eligibility: each fresh host, most recently
    deployed first, is put to coord's resolver as a ``machine_bound`` pin —
    which coord answers ``resolved via pin`` only when that exact device is
    eligible (online, capable, not drained) and never re-targets (plan D2).

    ``strategy="best_effort"`` falls back to coord's pool pick
    (:func:`_pick_auto_runner`) — a stale host beats no host.

    Returns the device, ``None`` when nothing qualifies (``fresh_only``: no
    eligible fresh host), or an :class:`AutoPickRefusal` when the resolver
    could not decide — UNKNOWN is never reported as "no host".
    """
    query = (
        select(Device)
        .join(AppDeployState, AppDeployState.device_id == Device.device_id)
        .where(
            Device.user_id == user_id,
            Device.capability_user_paired.is_(True),
            AppDeployState.app_id == app_id,
            AppDeployState.freshness == AppDeploymentFreshness.FRESH.value,
        )
        .order_by(AppDeployState.deployed_at.desc())
    )
    result = await db.execute(query)
    for device in result.scalars().all():
        outcome = await resolve_device(
            DeviceResolveRequest(
                required_capabilities=[],
                preferred_device=device.device_id,
                work_class="machine_bound",
            ),
            caller,
        )
        if isinstance(outcome, ResolvedOutcome):
            if outcome.device_id != device.device_id:
                # machine_bound never re-targets; a different device is a
                # contract violation, not a fresh host.
                return _refusal_for(
                    UnavailableOutcome(reason="malformed_response", status=200)
                )
            return await _owned_device(db, user_id, outcome)
        if isinstance(outcome, PinIneligibleOutcome):
            continue  # fresh, but offline / drained / not eligible
        return _refusal_for(outcome)

    if strategy == "fresh_only":
        return None
    return await _pick_auto_runner(db, user_id, caller, required_capabilities=[])


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
    caller: CoordCaller,
    parent_task_run_id: str | None = None,
) -> WorkflowDispatchResponse:
    """Resolve the target runner and relay the workflow over its WebSocket.

    Args:
        db: Active async session.
        user_id: The caller's user id. Scoping for ownership checks.
        workflow_id: Workflow to dispatch.
        target: Either the literal string ``"auto"`` or a runner UUID.
        caller: Who coord's device resolver is asked AS (for ``"auto"``):
            the request's own bearer, or — for a scheduled run, which has no
            request — ``CoordCaller.background_for(owner)``, for which a
            bearer acting for the schedule's owner is minted from coord.
            Either way coord names the runner or the dispatch is refused.
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
    runner: Device | None
    if target == "auto":
        # Workflows declare no capability requirements today, so the
        # requirement is explicitly empty (never omitted).
        picked = await _pick_auto_runner(db, user_id, caller, required_capabilities=[])
        if isinstance(picked, AutoPickRefusal):
            raise picked.to_dispatch_error()
        runner = picked
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
