"""The device-scoped credential deny, enforced at every web door that issues
a device a credential.

Plan ``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-
qontinui-web`` Phase 4: while ``coord.devices.credential_revoked_at`` is set,
``/machine-credential/mint``, ``/self-mint``, ``/exchange``, the pair-code
redeem and the ``/pending-redeem`` poll all refuse. One implementation, so the
fail-closed rule (a failed read refuses, never passes) cannot drift between
doors.
"""

from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import device_crud

logger = structlog.get_logger(__name__)


async def refuse_if_credential_revoked(
    db: AsyncSession, device_id: UUID, *, door: str, lock_device_row: bool = False
) -> None:
    """403 ``device_credential_revoked`` while the device's deny is set.

    Fail-closed: a read that fails is a 503 refusal, logged with the device
    id, never a pass.

    ``lock_device_row`` reads the deny through
    :func:`device_crud.get_credential_anchor` with ``FOR SHARE`` on the
    ``coord.devices`` row, held until the caller's transaction ends. The
    operator's revoke and ``authorize-redeem`` hold that row ``FOR UPDATE``,
    so a locked read sees a deny either committed, and neither can commit a
    deny change until the caller commits. Only a caller holding no pair-code
    row lock may ask for it (see ``get_credential_anchor``).
    """
    try:
        if lock_device_row:
            anchor = await device_crud.get_credential_anchor(
                db, device_id, lock_for_share=True
            )
            revoked_at = anchor.credential_revoked_at if anchor else None
        else:
            revoked_at = await device_crud.get_credential_revoked_at(db, device_id)
    except Exception as exc:  # noqa: BLE001 — any read failure refuses
        logger.error(
            "device_credential_revoked_read_failed",
            device_id=str(device_id),
            door=door,
            error=str(exc),
            failure=type(exc).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "device_credential_state_unavailable",
                "code": "device_credential_state_unavailable",
                "message": (
                    "Could not confirm this device's credentials are not "
                    "revoked; nothing was issued or consumed. Retry later."
                ),
            },
        ) from exc
    if revoked_at is not None:
        logger.warning(
            "device_credential_revoked_refused",
            device_id=str(device_id),
            door=door,
            revoked_at=revoked_at.isoformat(),
            locked_read=lock_device_row,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "device_credential_revoked",
                "code": "device_credential_revoked",
                "message": (
                    "An operator revoked this device's credentials. Only an "
                    "operator's Authenticate (authorize-redeem) re-arms it."
                ),
            },
        )
