"""Runner selection + 503 envelope helpers for the WS-bridge HTTP handlers.

These helpers are the shared infrastructure introduced by Phase 2 of
``plans/2026-05-17-web-runner-ws-bridge-plan-b.md``. They are reused by
Phases 3-7 to dispatch HTTP requests to a connected runner over the
existing ``runner_command_ws`` relay.

Two primitives:

- :func:`pick_active_runner_for_user`: picks the user's most-recently-
  heartbeat-active runner that is currently connected to *this* web
  process (via the in-memory
  :class:`~app.services.runner.connection_registry.WebSocketConnectionRegistry`).
- :func:`runner_bridge_503_no_runner`: builds the structured 503 envelope
  returned when no suitable runner is available. The envelope shape is
  intentionally similar to Plan A's ``endpoint_requires_runner_bridge``
  envelope so clients that special-case it still parse correctly; only
  the ``error`` literal differs (``no_runner_connected``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from sqlalchemy import select

from app.models.runner import Runner

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.services.runner.connection_registry import (
        WebSocketConnectionRegistry,
    )

logger = structlog.get_logger(__name__)

# How many of the user's most-recently-heartbeat-active runners to scan
# before giving up. Keeps the SQL bounded for users with many historical
# runner rows; in practice users own 1-3 runners.
_MAX_CANDIDATES = 10


async def pick_active_runner_for_user(
    user_id: UUID,
    db: AsyncSession,
    registry: WebSocketConnectionRegistry,
) -> Runner | None:
    """Return the user's most-recently-heartbeat-active connected runner.

    Selection rule:

    1. Fetch up to ``_MAX_CANDIDATES`` of the user's runners, ordered by
       ``last_heartbeat`` DESC.
    2. Walk the list and return the first one that is currently
       registered as connected to this web process (per ``registry``).
    3. Returns ``None`` if no connected runner is found — callers turn
       this into :func:`runner_bridge_503_no_runner`.

    Args:
        user_id: Owning user UUID.
        db: Async DB session.
        registry: In-process WebSocket connection registry (typically
            obtained from the runner WebSocket manager singleton).

    Returns:
        The selected :class:`Runner` row, or ``None`` if no candidate is
        currently connected to this web process.
    """
    stmt = (
        select(Runner)
        .where(Runner.user_id == user_id)
        .order_by(Runner.last_heartbeat.desc())
        .limit(_MAX_CANDIDATES)
    )
    rows = await db.execute(stmt)
    for runner in rows.scalars():
        if registry.is_runner_connected(str(runner.id)):
            return runner
    return None


def runner_bridge_503_no_runner(endpoint: str) -> HTTPException:
    """Build a 503 ``no_runner_connected`` envelope for the given endpoint.

    The shape mirrors Plan A's ``endpoint_requires_runner_bridge``
    envelope so clients that already special-case the 503 structure
    continue to work:

    ::

        {
          "error": "no_runner_connected",
          "message": "...",
          "endpoint": "<path>",
          "remedy": "...",
        }

    Args:
        endpoint: The HTTP path that needed a runner (for the ``endpoint``
            field in the envelope; surfaced to clients for diagnostics).
    """
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "no_runner_connected",
            "message": (
                "This endpoint requires a connected runner. No runner is "
                "currently connected for your account."
            ),
            "endpoint": endpoint,
            "remedy": "Start your local qontinui-runner and try again.",
        },
    )


__all__ = [
    "pick_active_runner_for_user",
    "runner_bridge_503_no_runner",
]
