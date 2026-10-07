"""Device selection + 503 envelope helpers for the WS-bridge HTTP handlers.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
renamed ``runner_selector`` → ``device_selector`` after the ``auth.runners``
SQLAlchemy table was retired in favour of ``coord.devices``. The HTTP
503 envelope shape is preserved (clients still receive
``no_runner_connected`` to avoid a coordinated frontend update).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from sqlalchemy import select

from app.crud import runner_crud
from app.models.device import Device
from app.services.runner.command_relay import (
    RunnerCommandTimeoutError,
    RunnerNotConnectedError,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.services.runner.connection_registry import (
        WebSocketConnectionRegistry,
    )

logger = structlog.get_logger(__name__)

# How many of the user's most-recently-heartbeat-active devices to scan
# before giving up.
_MAX_CANDIDATES = 10


async def pick_active_device_for_user(
    user_id: UUID,
    db: AsyncSession,
    registry: WebSocketConnectionRegistry,
) -> Device | None:
    """Return the user's most-recently-heartbeat-active connected device.

    Selection rule:

    1. Fetch up to ``_MAX_CANDIDATES`` of the user's user-paired
       devices, ordered by ``last_heartbeat`` DESC.
    2. Walk the list and return the first one whose socket to this web
       process is LIVE (``registry.is_runner_socket_live``) — not merely
       registered. A registration can outlive its socket (see that method),
       and every caller hands the pick straight to ``dispatch_and_wait``,
       whose own gate would refuse the stale one; walking past it here
       reaches a device that can actually answer when the user has one.
    3. Returns ``None`` if no such device is found.
    """
    stmt = (
        select(Device)
        .where(
            Device.user_id == user_id,
            Device.capability_user_paired.is_(True),
        )
        .order_by(Device.last_heartbeat.desc())
        .limit(_MAX_CANDIDATES)
    )
    rows = await db.execute(stmt)
    for device in rows.scalars():
        if registry.is_runner_socket_live(str(device.device_id)):
            return device
    return None


def device_bridge_503_no_device(endpoint: str) -> HTTPException:
    """Build a 503 ``no_runner_connected`` envelope for the given endpoint.

    The ``error`` literal is preserved as ``no_runner_connected`` for
    frontend wire-compat; the human message refers to "device" so log
    grepping reflects the new vocabulary.
    """
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "no_runner_connected",
            "message": (
                "This endpoint requires a connected device. No device is "
                "currently connected for your account."
            ),
            "endpoint": endpoint,
            "remedy": "Start your local qontinui device and try again.",
        },
    )


async def get_owned_runner_or_404(
    db: AsyncSession,
    user_id: UUID,
    runner_id: UUID,
) -> Device:
    """Return the caller's runner ``runner_id``, or raise 404 ``runner_not_found``.

    The ownership core of every explicit ``?runner_id=`` selection: an id
    that does not exist and an id owned by another user are the same 404,
    so the response never confirms that a foreign runner exists. This is
    the one place the authorization-bearing comparison is written.
    """
    owned_runner = await runner_crud.get_runner(db, runner_id=runner_id)
    if owned_runner is None or owned_runner.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "runner_not_found", "runner_id": str(runner_id)},
        )
    return owned_runner


async def resolve_runner_for_request(
    runner_id: UUID | None,
    user_id: UUID,
    db: AsyncSession,
    manager: Any,
    endpoint: str,
) -> Device:
    """Pick the runner an HTTP request dispatches to, or raise.

    - ``runner_id`` given: it must be the caller's (else 404
      ``runner_not_found``) and REGISTERED with this process
      (``is_runner_connected``; else 503 ``no_runner_connected``). It is
      never silently swapped for another runner.
    - ``runner_id`` absent: the user's most-recently-heartbeat-active
      runner with a LIVE socket (:func:`pick_active_device_for_user`),
      else 503.

    The explicit arm deliberately keeps the weaker registration predicate;
    ``dispatch_and_wait``'s own gate refuses a stale socket, so both arms
    end in the same 503 for a dead runner.

    Service-level callers with no explicit selection pass ``runner_id=None``
    to get the auto-pick arm with its 503.
    """
    if runner_id is not None:
        owned_runner = await get_owned_runner_or_404(db, user_id, runner_id)
        if not manager.registry.is_runner_connected(str(owned_runner.id)):
            raise device_bridge_503_no_device(endpoint)
        return owned_runner
    picked = await pick_active_device_for_user(user_id, db, manager.registry)
    if picked is None:
        raise device_bridge_503_no_device(endpoint)
    return picked


async def dispatch_or_http_error(
    manager: Any,
    runner: Device,
    cmd: dict[str, Any],
    request_id: UUID,
    endpoint: str,
    timeout_s: float,
    log_prefix: str,
    *,
    log: Any = None,
    timeout_log_fields: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Dispatch ``cmd`` to ``runner`` and return the raw runner response.

    Maps the two relay failures onto the WS-bridge HTTP contract:

    - ``RunnerNotConnectedError`` → warning
      ``<log_prefix>_runner_disconnected_mid_dispatch``, then 503
      ``no_runner_connected`` for ``endpoint``.
    - ``RunnerCommandTimeoutError`` → error ``<log_prefix>_timeout``, then
      504 ``{"error": "runner_timeout", "endpoint", "request_id"}``.

    A runner-reported ``error`` in the response is NOT mapped here: each
    caller owns that shape (500, ``found=False``, a soft fallback, ...).

    Args:
        log: the caller's structlog logger, so the events keep the
            caller's logger name. Defaults to this module's logger.
        timeout_log_fields: extra keyword fields for the timeout event,
            for a caller whose event already carried them.
    """
    log = log if log is not None else logger
    try:
        raw_response: dict[str, Any] = await manager.relay.dispatch_and_wait(
            str(runner.id),
            cmd,
            request_id=str(request_id),
            timeout_s=timeout_s,
        )
    except RunnerNotConnectedError:
        log.warning(
            f"{log_prefix}_runner_disconnected_mid_dispatch",
            runner_id=str(runner.id),
            request_id=str(request_id),
        )
        raise device_bridge_503_no_device(endpoint)
    except RunnerCommandTimeoutError:
        log.error(
            f"{log_prefix}_timeout",
            runner_id=str(runner.id),
            request_id=str(request_id),
            **dict(timeout_log_fields or {}),
        )
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={
                "error": "runner_timeout",
                "endpoint": endpoint,
                "request_id": str(request_id),
            },
        )
    return raw_response


__all__ = [
    "pick_active_device_for_user",
    "device_bridge_503_no_device",
    "get_owned_runner_or_404",
    "resolve_runner_for_request",
    "dispatch_or_http_error",
]
