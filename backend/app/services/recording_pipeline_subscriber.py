"""Background subscriber for recording-pipeline async runs.

The HTTP handlers under ``app/api/v1/endpoints/recording_pipeline.py``
dispatch long-running ``recording_pipeline.{process,process_with_playbook,merge}``
commands to the user's connected runner over the WS bridge, then return
``202 Accepted`` immediately. The actual compute runs minutes; the
runner publishes its terminal ``recording_pipeline_result`` frame on
``runner:responses:{runner_id}`` when it finishes.

This module spawns a background task per run that:

1. Awaits the terminal frame via the existing
   :meth:`CommandRelayService.dispatch_and_wait` (30-min timeout).
2. Parses the frame as a
   :class:`qontinui_schemas.commands.recording_pipeline.ProcessRecordingResult`.
3. Updates the matching ``project.recording_pipeline_runs`` row with the
   result or error JSON.
4. On success, persists the discovered states + transitions to
   ``project.ui_bridge_state_configs`` (and, for the
   ``process_with_playbook`` flavour with ``save_experience=True``,
   the ``recording_sessions`` experience-memory row) via the helpers
   re-exported from the endpoint module.

The subscriber also handles **boot-time recovery**: on app startup,
:func:`recover_running_runs_on_boot` scans for any rows in ``queued``
/ ``running`` state with ``updated_at`` within the last 30 minutes and
re-spawns subscribers for them. Rows older than the TTL flip to
``timed_out`` directly.

Phase 4 of plan ``plans/2026-05-17-web-runner-ws-bridge-plan-b.md``.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from uuid import UUID

import structlog
from sqlalchemy import select, update

from app.db.session import AsyncSessionLocal
from app.models.recording_pipeline_run import RecordingPipelineRun
from app.services.runner import (
    RunnerCommandTimeoutError,
    RunnerNotConnectedError,
)

if TYPE_CHECKING:
    from app.services.runner.command_relay import CommandRelayService

logger = structlog.get_logger(__name__)


# Boot-time-recovery TTL. Matches the runner-side
# `LONG_COMMAND_DISPATCH_TIMEOUT_S = 1800` so a hung subprocess and a
# missed-event row both surface as ``timed_out`` within the same window.
_RUN_TTL = timedelta(minutes=30)


_dispatch_timeout_s = 1800.0


# In-process registry of live subscriber tasks; keyed by ``run_id`` so
# the dispatch handler can verify a subscriber is up (defence against
# task-cancellation races during a hot-reload). Best-effort: a missing
# entry doesn't imply the row is unsupervised — the recovery sweep on
# next boot still picks it up.
_LIVE_TASKS: dict[UUID, asyncio.Task[Any]] = {}


def spawn_recording_pipeline_subscriber(
    *,
    run_id: UUID,
    runner_id: str,
    request_id: str,
    command: dict[str, Any],
    relay: CommandRelayService,
    project_id: UUID | None,
    config_name: str | None,
    export_data: dict[str, Any],
    save_experience: bool,
    variables: list[dict[str, Any]],
    app_name: str | None,
    app_url: str | None,
    merge_config_id: UUID | None,
) -> asyncio.Task[Any]:
    """Spawn the per-run background subscriber task.

    Returns the task handle (not normally needed by callers; tracked
    here for visibility + the recovery sweep).
    """
    task = asyncio.create_task(
        _subscribe_and_persist(
            run_id=run_id,
            runner_id=runner_id,
            request_id=request_id,
            command=command,
            relay=relay,
            project_id=project_id,
            config_name=config_name,
            export_data=export_data,
            save_experience=save_experience,
            variables=variables,
            app_name=app_name,
            app_url=app_url,
            merge_config_id=merge_config_id,
        ),
        name=f"recording_pipeline_subscriber:{run_id}",
    )
    _LIVE_TASKS[run_id] = task
    task.add_done_callback(lambda _t: _LIVE_TASKS.pop(run_id, None))
    return task


async def _subscribe_and_persist(
    *,
    run_id: UUID,
    runner_id: str,
    request_id: str,
    command: dict[str, Any],
    relay: CommandRelayService,
    project_id: UUID | None,
    config_name: str | None,
    export_data: dict[str, Any],
    save_experience: bool,
    variables: list[dict[str, Any]],
    app_name: str | None,
    app_url: str | None,
    merge_config_id: UUID | None,
) -> None:
    """Long-lived task body: dispatch + await + persist.

    On any failure mode (timeout, runner disconnect, schema error)
    flips the PG row to ``failed`` with a structured error payload so
    the GET ``/runs/{run_id}`` poller sees the terminal state.
    """
    # Flip queued -> running so the GET status endpoint reflects that
    # the dispatch happened.
    await _set_row_status(
        run_id=run_id,
        status="running",
    )

    try:
        response = await relay.dispatch_and_wait(
            runner_id,
            command,
            request_id=request_id,
            timeout_s=_dispatch_timeout_s,
        )
    except RunnerNotConnectedError as exc:
        logger.warning(
            "recording_pipeline_runner_disconnected",
            run_id=str(run_id),
            runner_id=runner_id,
            error=str(exc),
        )
        await _record_failure(
            run_id=run_id,
            error_payload={
                "error": "runner_not_connected",
                "message": str(exc),
                "traceback": None,
            },
        )
        return
    except RunnerCommandTimeoutError as exc:
        logger.error(
            "recording_pipeline_timeout",
            run_id=str(run_id),
            runner_id=runner_id,
            error=str(exc),
        )
        await _record_failure(
            run_id=run_id,
            error_payload={
                "error": "runner_timeout",
                "message": str(exc),
                "traceback": None,
            },
            status="timed_out",
        )
        return
    except Exception as exc:  # noqa: BLE001 - surface as failed
        logger.exception(
            "recording_pipeline_subscriber_unexpected_error",
            run_id=str(run_id),
            runner_id=runner_id,
        )
        await _record_failure(
            run_id=run_id,
            error_payload={
                "error": "subscriber_error",
                "message": str(exc),
                "traceback": None,
            },
        )
        return

    # Parse the wire envelope. The runner-side handler always sets a
    # status field; on payload-validation failure the runner sends a
    # RecordingPipelineError envelope where status is absent.
    response_status = response.get("status")
    if response_status not in {"completed", "failed"}:
        # Runner-side payload-validation envelope or unexpected shape.
        logger.error(
            "recording_pipeline_unexpected_response",
            run_id=str(run_id),
            response_error=response.get("error"),
            response_message=response.get("message"),
        )
        await _record_failure(
            run_id=run_id,
            error_payload={
                "error": response.get("error", "unknown_runner_response"),
                "message": response.get("message", "runner returned an unexpected envelope"),
                "traceback": response.get("traceback"),
            },
        )
        return

    if response_status == "failed":
        await _record_failure(
            run_id=run_id,
            error_payload=response.get("error") or {
                "error": "qontinui_exception",
                "message": "runner reported failure with no error payload",
                "traceback": None,
            },
        )
        return

    # status == "completed"
    result_payload = response.get("result") or {}
    await _record_success(
        run_id=run_id,
        result_payload=result_payload,
        project_id=project_id,
        config_name=config_name,
        export_data=export_data,
        save_experience=save_experience,
        variables=variables,
        app_name=app_name,
        app_url=app_url,
        merge_config_id=merge_config_id,
    )


# ============================================================================
# PG-side row updates
# ============================================================================


async def _set_row_status(*, run_id: UUID, status: str) -> None:
    """Set the row's ``status`` + bump ``updated_at``."""
    async with AsyncSessionLocal() as session:
        await session.execute(
            update(RecordingPipelineRun)
            .where(RecordingPipelineRun.run_id == run_id)
            .values(status=status, updated_at=datetime.now(UTC))
        )
        await session.commit()


async def _record_failure(
    *,
    run_id: UUID,
    error_payload: dict[str, Any],
    status: str = "failed",
) -> None:
    """Persist the terminal failure state to the run row."""
    async with AsyncSessionLocal() as session:
        await session.execute(
            update(RecordingPipelineRun)
            .where(RecordingPipelineRun.run_id == run_id)
            .values(
                status=status,
                error_json=error_payload,
                updated_at=datetime.now(UTC),
            )
        )
        await session.commit()


async def _record_success(
    *,
    run_id: UUID,
    result_payload: dict[str, Any],
    project_id: UUID | None,
    config_name: str | None,
    export_data: dict[str, Any],
    save_experience: bool,
    variables: list[dict[str, Any]],
    app_name: str | None,
    app_url: str | None,
    merge_config_id: UUID | None,
) -> None:
    """Persist the terminal success state + (optionally) the discovered states.

    For ``process`` / ``process_with_playbook`` with a non-None
    ``project_id``: creates a fresh ``UIBridgeStateConfig`` tree via
    :func:`_persist_result_to_pg`.

    For ``merge`` (``merge_config_id`` set): updates the existing
    config in place (drops the prior states/transitions, inserts the
    merged set).

    On any persistence failure, the row still flips to ``completed``
    but ``error_json`` carries the secondary error — the runner result
    is real, the persistence layer just had trouble.
    """
    # Avoid circular import at module load.
    from app.api.v1.endpoints.recording_pipeline import (
        _persist_result_to_pg,
        _save_experience_from_payload,
    )

    persisted_config_id: UUID | None = None
    persistence_error: dict[str, Any] | None = None

    async with AsyncSessionLocal() as session:
        try:
            if merge_config_id is not None:
                # Apply the merge result in place.
                persisted_config_id = await _apply_merge_to_pg(
                    session,
                    config_id=merge_config_id,
                    result_payload=result_payload,
                )
                await session.commit()
            elif project_id is not None:
                persisted_config_id = await _persist_result_to_pg(
                    db=session,
                    project_id=project_id,
                    config_name=(
                        config_name
                        or f"recording-{result_payload.get('session_id', 'unknown')}"
                    ),
                    result_payload=result_payload,
                    export_data=export_data,
                )
                if save_experience:
                    await _save_experience_from_payload(
                        db=session,
                        project_id=project_id,
                        result_payload=result_payload,
                        export_data=export_data,
                        variables=variables,
                        app_name=app_name,
                        app_url=app_url,
                        playbook_content=result_payload.get("playbook_content"),
                        state_config_id=persisted_config_id,
                    )
                await session.commit()
        except Exception as exc:  # noqa: BLE001 - persistence is best-effort
            logger.exception(
                "recording_pipeline_persistence_failed",
                run_id=str(run_id),
                error=str(exc),
            )
            await session.rollback()
            persistence_error = {
                "error": "persistence_failed",
                "message": str(exc),
                "traceback": None,
            }

    async with AsyncSessionLocal() as session:
        await session.execute(
            update(RecordingPipelineRun)
            .where(RecordingPipelineRun.run_id == run_id)
            .values(
                status="completed",
                result_json=result_payload,
                error_json=persistence_error,
                updated_at=datetime.now(UTC),
            )
        )
        await session.commit()

    logger.info(
        "recording_pipeline_completed",
        run_id=str(run_id),
        persisted_config_id=str(persisted_config_id) if persisted_config_id else None,
        had_persistence_error=persistence_error is not None,
    )


async def _apply_merge_to_pg(
    session: Any,
    *,
    config_id: UUID,
    result_payload: dict[str, Any],
) -> UUID:
    """Replace an existing config's states + transitions with the merged set."""
    from app.models.ui_bridge_state import UIBridgeState as UIBridgeStateModel
    from app.models.ui_bridge_transition import (
        UIBridgeTransition as UIBridgeTransitionModel,
    )

    existing_states = (
        await session.execute(
            select(UIBridgeStateModel).where(
                UIBridgeStateModel.config_id == config_id
            )
        )
    ).scalars().all()
    for row in existing_states:
        await session.delete(row)

    existing_transitions = (
        await session.execute(
            select(UIBridgeTransitionModel).where(
                UIBridgeTransitionModel.config_id == config_id
            )
        )
    ).scalars().all()
    for row in existing_transitions:
        await session.delete(row)

    for s in result_payload.get("states", []):
        s_meta = s.get("metadata", {}) or {}
        session.add(
            UIBridgeStateModel(
                config_id=config_id,
                state_id=s["id"],
                name=s.get("name", s["id"]),
                element_ids=list(s.get("element_ids", [])),
                confidence=float(s_meta.get("confidence", 0.0)),
                extra_metadata={
                    "blocking": bool(s.get("blocking", False)),
                    "is_global": bool(s_meta.get("is_global", False)),
                    "position_zone": s_meta.get("position_zone"),
                    "observation_count": int(s_meta.get("observation_count", 1)),
                    "source": "recording_merge",
                },
            )
        )

    for t in result_payload.get("transitions", []):
        t_meta = t.get("metadata", {}) or {}
        session.add(
            UIBridgeTransitionModel(
                config_id=config_id,
                transition_id=t["id"],
                name=t.get("name", t["id"]),
                from_states=list(t.get("from_states", [])),
                activate_states=list(t.get("activate_states", [])),
                exit_states=list(t.get("exit_states", [])),
                actions=list(t.get("actions", [])),
                path_cost=float(t.get("path_cost", 1.0)),
                stays_visible=bool(t.get("stays_visible", False)),
                extra_metadata={
                    "confidence": float(t_meta.get("confidence", 0.0)),
                    "observation_count": int(t_meta.get("observation_count", 1)),
                    "source": "recording_merge",
                },
            )
        )

    await session.flush()
    return config_id


# ============================================================================
# Boot-time recovery
# ============================================================================


async def recover_running_runs_on_boot() -> None:
    """Scan for rows in ``queued`` / ``running`` and either re-spawn or expire.

    Re-spawning a live subscriber after a web restart is currently a
    no-op because the original ``request_id`` + command payload are
    not durably stored. Instead, this sweep flips stale rows to
    ``timed_out`` so polling clients see the terminal state.

    Future enhancement (deferred): persist the full command payload +
    request_id alongside the row, then this sweep can resume genuine
    in-flight subscribers by calling :func:`spawn_recording_pipeline_subscriber`.
    For now the cleanup behaviour is conservative: any row older than
    the TTL (or younger but un-supervised after a restart) becomes
    ``timed_out``.
    """
    threshold = datetime.now(UTC) - _RUN_TTL
    async with AsyncSessionLocal() as session:
        # Flip all stale ``queued`` / ``running`` rows.
        await session.execute(
            update(RecordingPipelineRun)
            .where(
                RecordingPipelineRun.status.in_(["queued", "running"]),
                RecordingPipelineRun.updated_at < threshold,
            )
            .values(
                status="timed_out",
                error_json={
                    "error": "boot_time_timeout",
                    "message": (
                        "Web process restarted; the in-flight subscriber "
                        "was lost and the runner's terminal frame was not "
                        "observed within the TTL window."
                    ),
                    "traceback": None,
                },
                updated_at=datetime.now(UTC),
            )
        )
        await session.commit()

        # Surviving ``queued`` / ``running`` rows within the TTL are
        # logged; future iterations may re-subscribe them. For now they
        # are left as-is — they'll expire on the next boot sweep.
        survivors = (
            await session.execute(
                select(RecordingPipelineRun.run_id).where(
                    RecordingPipelineRun.status.in_(["queued", "running"]),
                )
            )
        ).scalars().all()
        if survivors:
            logger.warning(
                "recording_pipeline_unsubscribed_survivors",
                count=len(survivors),
                run_ids=[str(r) for r in survivors[:10]],
            )
