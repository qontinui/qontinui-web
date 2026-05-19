"""Legacy compat shim — wrappers around :mod:`app.crud.device_crud`.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
retired the ``Runner`` SQLAlchemy model + companion ``runner_crud``
module. The replacement is :mod:`app.crud.device_crud` (operating on
``coord.devices``). This shim adapts the legacy call shape — i.e.
``runner_id=``, ``runner_token_id=`` — to the new ``device_id=`` /
no-token signature so the broader fleet of WS-bridge HTTP handlers
(``runner_chat.py``, ``runner_command_ws.py``, ``ui_bridge_states.py``,
``websockets/testing/handler.py``, etc.) continues to compile while the
rename is propagated through the codebase.

The legacy token-mint helpers (``create_runner_token`` /
``validate_runner_token`` / ``revoke_runner_token`` /
``list_runner_tokens`` / ``get_runner_token``) are NOT re-exported —
token issuance is now coord's responsibility via the OAuth-loopback
pairing flow (see ``backend/app/api/v1/endpoints/devices.py`` and
``backend/app/services/coord_jwks.py``).
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import device_crud
from app.models.device import Device

__all__ = [
    "register_runner",
    "heartbeat_runner",
    "list_runners",
    "get_runner",
    "delete_runner",
]


async def register_runner(
    db: AsyncSession,
    *,
    user_id: UUID,
    name: str,
    hostname: str,
    port: int,
    capabilities: list[str],
    restate_enabled: bool,
    restate_healthy: bool,
    os: str | None = None,
    os_version: str | None = None,
    runner_token_id: object = None,  # legacy kwarg, ignored
) -> Device:
    """Legacy adapter for :func:`device_crud.register_device`.

    Accepts and silently drops the legacy ``runner_token_id`` kwarg —
    token issuance moved to coord (no per-runner web-backend token id).
    """
    return await device_crud.register_device(
        db,
        user_id=user_id,
        name=name,
        hostname=hostname,
        port=port,
        capabilities=capabilities,
        restate_enabled=restate_enabled,
        restate_healthy=restate_healthy,
        os=os,
        os_version=os_version,
    )


async def get_runner(
    db: AsyncSession,
    runner_id: UUID,
) -> Device | None:
    """Legacy adapter for :func:`device_crud.get_device` (renames the
    keyword from ``runner_id`` to ``device_id``)."""
    return await device_crud.get_device(db, device_id=runner_id)


async def delete_runner(
    db: AsyncSession,
    runner_id: UUID,
    user_id: UUID,
) -> None:
    """Legacy adapter for :func:`device_crud.delete_device`."""
    await device_crud.delete_device(db, device_id=runner_id, user_id=user_id)


# Heartbeat + list have no parameter-renames and stay as direct re-exports.
heartbeat_runner = device_crud.heartbeat_device
list_runners = device_crud.list_devices
