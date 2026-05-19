"""Device selection + 503 envelope helpers for the WS-bridge HTTP handlers.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
renamed ``runner_selector`` → ``device_selector`` after the ``auth.runners``
SQLAlchemy table was retired in favour of ``coord.devices``. The HTTP
503 envelope shape is preserved (clients still receive
``no_runner_connected`` to avoid a coordinated frontend update).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from sqlalchemy import select

from app.models.device import Device

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
    2. Walk the list and return the first one currently registered as
       connected to this web process (per ``registry``).
    3. Returns ``None`` if no connected device is found.
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
        if registry.is_runner_connected(str(device.device_id)):
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


# Legacy aliases — preserved for in-process compat while the broader
# fleet of WS-bridge HTTP handlers still imports the runner_* names.
# These will be removed in a follow-up cleanup once every consumer has
# been migrated to the device_* names.
pick_active_runner_for_user = pick_active_device_for_user
runner_bridge_503_no_runner = device_bridge_503_no_device


__all__ = [
    "pick_active_device_for_user",
    "device_bridge_503_no_device",
    # Legacy
    "pick_active_runner_for_user",
    "runner_bridge_503_no_runner",
]
