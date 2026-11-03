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

    ``tenant_id`` is the tenant this pairing was made in (``None`` when the
    door could not establish it). The key is minted only when it equals the
    device's home tenant, ``coord.devices.tenant_id`` — the tenant coord's
    service-mint resolves for every device JWT the key will yield, and which a
    pairing into a second tenant never moves. The anchor is the device, not
    whichever pairing wrote the key row first: an unbound pair code's holder
    chooses the ``device_id`` it presents, so trusting the stored row would let
    a foreign pairing squat a key and lock the rightful tenant out for good.
    The check covers the no-key path as well as the rotate. When the tenants
    match, an existing row is rotated (subject to the guards below) whatever
    tenant it records, so a squatted or NULL-tenant row is repaired by the
    rightful tenant's next pairing. The tenant is the boundary, not the owner:
    a re-pair by another operator of the same tenant re-owns the key to that
    operator, as pair-cli always has (``/exchange`` resolves the JWT's owner
    and tenant from ``coord.devices``; the key's owner is a label).

    It mints ONLY when the device has no key, or its key is expired or within
    :data:`SELF_MINT_RENEWAL_WINDOW` of expiry, so a re-pair never invalidates
    a key the runner still holds. A revoked key, or a device whose credentials
    an operator revoked, is never re-armed here: only an operator's
    ``authorize-redeem`` does.

    Every read and the mint run inside a SAVEPOINT, so a failure rolls back
    only its own work and leaves the caller's transaction usable — the
    pair-code redeem commits its code consumption in that same transaction.
    With ``commit=True`` the helper also commits (pair-cli has nothing else to
    commit); a commit failure is then reported as ``failed``. Otherwise the
    caller commits.

    Logs exactly one ``device_machine_key_automint`` outcome and never raises:

    * ``minted`` — the plaintext is returned;
    * ``kept_usable_key`` — the device's key is usable beyond the window;
    * ``lost_insert_race`` — a concurrent mint created the device's first key;
    * ``machine_key_revoked`` / ``device_credential_revoked`` — revoked;
    * ``device_tenant_unknown`` — no ``coord.devices`` row, or no tenant on it
      (fail closed);
    * ``pairing_tenant_unknown`` — the door could not say which tenant it
      paired in (fail closed);
    * ``foreign_tenant_key`` — the pairing tenant is not the device's;
    * ``failed`` — anything else (the error is logged).
    """
    device_machine_key: str | None = None
    outcome = "minted"
    error: str | None = None
    device_tenant: UUID | None = None
    try:
        async with db.begin_nested():
            anchor = await device_crud.get_credential_anchor(db, device_id)
            device_tenant = anchor.tenant_id if anchor is not None else None
            if anchor is not None and anchor.credential_revoked_at is not None:
                outcome = "device_credential_revoked"
            elif device_tenant is None:
                outcome = "device_tenant_unknown"
            elif tenant_id is None:
                outcome = "pairing_tenant_unknown"
            elif tenant_id != device_tenant:
                outcome = "foreign_tenant_key"
            else:
                device_machine_key, _cred = await dmk_crud.mint(
                    db,
                    device_id=device_id,
                    owner_user_id=owner_user_id,
                    tenant_id=device_tenant,
                    refuse_if_revoked=True,
                    refuse_if_usable_beyond=SELF_MINT_RENEWAL_WINDOW,
                )
        if commit:
            await db.commit()
    except dmk_crud.DeviceMachineKeyConcurrentMintError:
        device_machine_key = None
        outcome = "lost_insert_race"
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
        device_tenant_id=str(device_tenant) if device_tenant is not None else None,
        error=error,
    )
    return device_machine_key
