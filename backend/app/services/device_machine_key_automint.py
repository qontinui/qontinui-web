"""Best-effort device machine key (``dmk_``) auto-mint at pairing time.

Every door that pairs a device — the authenticated ``/api/v1/devices/pair-cli``
and the unauthenticated pair-code redeem
(``/api/v1/devices/pair-codes/{code}/redeem``) — hands the runner a ``dmk_``
alongside its device JWT, so a paired runner can recover a device JWT after a
>30-day outage with no user session (plan
``2026-07-02-runner-device-machine-key-cold-start``, 4b). Before plan
``2026-11-03-pair-code-pairing-mints-no-device-machine-key`` only pair-cli did;
a box paired by pair code received no key. One implementation now serves both
doors so the guards cannot drift between them.

The mint is **best-effort**: a failure must NEVER fail the pairing. The runner
simply lacks the cold-start credential and falls back to interactive re-login.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Final, Literal
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import device_crud
from app.crud import device_machine_credential_crud as dmk_crud

logger = structlog.get_logger(__name__)

#: ``/self-mint`` renews a key only when it is absent, expired, or expires
#: within this window; a key usable for longer is refused with a 409 rather
#: than rotated (see ``self_mint_device_machine_credential`` in
#: ``app.api.v1.endpoints.devices``). The pairing auto-mint uses the same
#: window, so a re-pair never rotates a key the runner can still use (coord
#: finding ``414676cf``).
SELF_MINT_RENEWAL_WINDOW: Final[timedelta] = timedelta(days=7)

PairingDoor = Literal["pair_cli", "pair_code_redeem"]


async def automint_on_pairing(
    db: AsyncSession,
    *,
    device_id: UUID,
    owner_user_id: UUID,
    tenant_id: UUID | None,
    door: PairingDoor,
    commit: bool = False,
) -> str | None:
    """Mint a ``dmk_`` for a just-paired device; return its plaintext or None.

    It mints ONLY when the device has no key, or its key is expired or within
    :data:`SELF_MINT_RENEWAL_WINDOW` of expiry. ``dmk_crud.mint`` keeps one row
    per device, so rotating a still-usable key on every pairing invalidated the
    runner's stored key whenever the runner failed to persist the new one. A
    usable key is kept and ``None`` is returned — the runner keeps the key it
    has. A revoked key, or a device whose credentials an operator revoked, is
    never re-armed here: only an operator's ``authorize-redeem`` does.

    Every database statement runs inside a SAVEPOINT, so a failed read or mint
    rolls back only its own work and leaves the caller's transaction usable —
    the pair-code redeem commits its code consumption in that same
    transaction. With ``commit=True`` the helper also commits (pair-cli has
    nothing else to commit); a commit failure is then reported as ``failed``.
    Otherwise the caller commits.

    Logs exactly one ``device_machine_key_automint`` outcome: ``minted`` /
    ``kept_usable_key`` / ``machine_key_revoked`` /
    ``device_credential_revoked`` / ``failed``. Never raises.
    """
    device_machine_key: str | None = None
    outcome = "minted"
    error: str | None = None
    try:
        async with db.begin_nested():
            if await device_crud.get_credential_revoked_at(db, device_id) is not None:
                outcome = "device_credential_revoked"
            else:
                device_machine_key, _cred = await dmk_crud.mint(
                    db,
                    device_id=device_id,
                    owner_user_id=owner_user_id,
                    tenant_id=tenant_id,
                    refuse_if_revoked=True,
                    refuse_if_usable_beyond=SELF_MINT_RENEWAL_WINDOW,
                )
        if commit:
            await db.commit()
    except dmk_crud.DeviceMachineKeyStillUsableError:
        device_machine_key = None
        outcome = "kept_usable_key"
    except dmk_crud.DeviceMachineKeyRevokedError:
        device_machine_key = None
        outcome = "machine_key_revoked"
    except Exception as exc:  # noqa: BLE001 — never break pairing on mint
        device_machine_key = None
        outcome = "failed"
        error = str(exc)

    log = logger.warning if outcome == "failed" else logger.info
    log(
        "device_machine_key_automint",
        door=door,
        outcome=outcome,
        device_id=str(device_id),
        owner_user_id=str(owner_user_id),
        tenant_id=str(tenant_id) if tenant_id is not None else None,
        error=error,
    )
    return device_machine_key
