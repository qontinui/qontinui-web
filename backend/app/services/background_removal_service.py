"""Background Removal Service.

Phase 6 of plan ``plans/2026-05-17-web-runner-ws-bridge-plan-b.md``:
dispatches the cv2+numpy background-removal work over the WS bridge to
a connected qontinui-runner (command ``discovery.background_removal``)
instead of importing the heavy qontinui module on the web side.

Selection rules:

- If ``runner_id`` is supplied, that runner is used (caller verifies
  ownership at the HTTP layer).
- Otherwise the user's most-recently-heartbeat-active connected runner
  is selected.
- If no runner is connected, the service raises an ``HTTPException``
  with the canonical ``no_runner_connected`` envelope (status 503).

The service is constructible without a runner (lazy resolution at call
time) so unit tests + future no-runner code paths don't pay an init
cost.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import structlog
from fastapi import HTTPException, status
from qontinui_schemas.commands.discovery import (
    BackgroundRemovalRequest,
    BackgroundRemovalResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.runner import (
    RunnerCommandTimeoutError,
    RunnerNotConnectedError,
    pick_active_runner_for_user,
    runner_bridge_503_no_runner,
)

logger = structlog.get_logger(__name__)


# 20 MB soft cap on total base64 screenshot payload size before
# dispatching to the runner. Documented in plan §"Risks (a)" — guards
# against batch payloads exceeding Redis pub/sub message limits.
_MAX_SCREENSHOTS_PAYLOAD_BYTES = 20 * 1024 * 1024

_BACKGROUND_REMOVAL_ENDPOINT = "/api/v1/remove-background"

# Default WS-bridge timeout for the background-removal command. The
# underlying cv2 op is sub-5-second per typical UI screenshot; 30s
# matches the dispatcher's default + leaves headroom for the
# subprocess wall-clock cap in ``ws_bridge_dispatch.rs``.
_BACKGROUND_REMOVAL_TIMEOUT_S = 30.0


def _payload_size_bytes(screenshots_b64: list[str]) -> int:
    """Return the total byte size of a base64 screenshot batch."""
    return sum(len(s) for s in screenshots_b64)


class BackgroundRemovalService:
    """Dispatches background-removal work to a connected runner.

    Constructing the service is now cheap (no qontinui import, no runner
    handshake); the runner is resolved on each :meth:`remove_backgrounds`
    call so concurrent requests can pick the user's currently-connected
    runner each time.
    """

    def __init__(
        self,
        user_id: UUID,
        db: AsyncSession,
        manager: Any,
        runner_id: UUID | None = None,
    ) -> None:
        """Initialise the background-removal service.

        Args:
            user_id: Owning user UUID (passed to
                :func:`pick_active_runner_for_user` for runner selection
                when ``runner_id`` is not provided).
            db: Async DB session — used to fetch the user's runners.
            manager: Runner WebSocket manager instance (provides
                ``.registry`` + ``.relay``).
            runner_id: Optional explicit runner UUID. When supplied, the
                caller is responsible for verifying ownership.
        """
        self._user_id = user_id
        self._db = db
        self._manager = manager
        self._runner_id = runner_id

    async def remove_backgrounds(
        self,
        screenshots_b64: list[str],
        config: dict[str, Any] | None = None,
        debug: bool = False,
    ) -> tuple[list[str], dict[str, Any]]:
        """Dispatch background removal to the active runner.

        Args:
            screenshots_b64: Base64-encoded PNG/JPEG payloads.
            config: Optional :class:`BackgroundRemovalConfig` field dict
                (forwarded verbatim to the runner; ``None`` means use
                qontinui-side defaults).
            debug: If True, the runner includes a base64 PNG mask of the
                inferred background in the statistics dict under
                ``background_mask_base64``.

        Returns:
            ``(masked_screenshots_b64, statistics)`` — same shape as the
            pre-Plan-A
            :func:`qontinui.discovery.background_removal.remove_backgrounds_from_base64`
            return so the HTTP handler can populate
            :class:`RemoveBackgroundResponse` without re-shaping.

        Raises:
            HTTPException: 413 if the total base64 payload exceeds the
                20 MB soft cap, 503 if no runner is connected, 504 if
                the runner does not respond within the dispatch timeout,
                or 500 if the runner returns a structured error.
        """
        payload_size = _payload_size_bytes(screenshots_b64)
        if payload_size > _MAX_SCREENSHOTS_PAYLOAD_BYTES:
            logger.warning(
                "background_removal_payload_too_large",
                payload_size=payload_size,
                cap=_MAX_SCREENSHOTS_PAYLOAD_BYTES,
                num_screenshots=len(screenshots_b64),
            )
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={
                    "error": "payload_too_large",
                    "message": (
                        "Total base64 screenshot payload exceeds the "
                        f"{_MAX_SCREENSHOTS_PAYLOAD_BYTES // (1024 * 1024)} MB "
                        "soft cap; reduce batch size or resolution."
                    ),
                    "endpoint": _BACKGROUND_REMOVAL_ENDPOINT,
                    "payload_bytes": payload_size,
                    "cap_bytes": _MAX_SCREENSHOTS_PAYLOAD_BYTES,
                },
            )

        runner = await self._resolve_runner()
        if runner is None:
            raise runner_bridge_503_no_runner(_BACKGROUND_REMOVAL_ENDPOINT)

        request_id = uuid4()
        cmd = BackgroundRemovalRequest(
            request_id=request_id,
            screenshots_b64=screenshots_b64,
            config=config,
            debug=debug,
        ).model_dump(mode="json")

        logger.info(
            "background_removal_dispatch",
            runner_id=str(runner.id),
            request_id=str(request_id),
            num_screenshots=len(screenshots_b64),
            payload_bytes=payload_size,
            debug=debug,
        )

        try:
            raw_response = await self._manager.relay.dispatch_and_wait(
                str(runner.id),
                cmd,
                request_id=str(request_id),
                timeout_s=_BACKGROUND_REMOVAL_TIMEOUT_S,
            )
        except RunnerNotConnectedError:
            logger.warning(
                "background_removal_runner_disconnected_mid_dispatch",
                runner_id=str(runner.id),
                request_id=str(request_id),
            )
            raise runner_bridge_503_no_runner(_BACKGROUND_REMOVAL_ENDPOINT)
        except RunnerCommandTimeoutError:
            logger.error(
                "background_removal_timeout",
                runner_id=str(runner.id),
                request_id=str(request_id),
                timeout_s=_BACKGROUND_REMOVAL_TIMEOUT_S,
            )
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={
                    "error": "runner_timeout",
                    "endpoint": _BACKGROUND_REMOVAL_ENDPOINT,
                    "request_id": str(request_id),
                },
            )

        if raw_response.get("error"):
            logger.error(
                "background_removal_runner_error",
                runner_id=str(runner.id),
                request_id=str(request_id),
                error=raw_response.get("error"),
                message=raw_response.get("message"),
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "error": "runner_error",
                    "runner_error": raw_response.get("error"),
                    "message": raw_response.get("message")
                    or "Runner returned an error.",
                },
            )

        response = BackgroundRemovalResponse.model_validate(raw_response)
        return list(response.masked_screenshots_b64), dict(response.statistics)

    async def _resolve_runner(self) -> Any:
        """Resolve the runner to dispatch this request to.

        Honours ``self._runner_id`` if provided; otherwise picks the
        user's most-recently-heartbeat-active connected runner.
        """
        if self._runner_id is not None:
            from app.crud import runner_crud

            owned_runner = await runner_crud.get_runner(
                self._db, runner_id=self._runner_id
            )
            if owned_runner is None or owned_runner.user_id != self._user_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={
                        "error": "runner_not_found",
                        "runner_id": str(self._runner_id),
                    },
                )
            if not self._manager.registry.is_runner_connected(str(owned_runner.id)):
                return None
            return owned_runner

        return await pick_active_runner_for_user(
            self._user_id, self._db, self._manager.registry
        )


__all__ = ["BackgroundRemovalService"]
