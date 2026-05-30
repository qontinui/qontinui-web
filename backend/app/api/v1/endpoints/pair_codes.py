"""Single-use pair-code HTTP surface — Phase 2a.1.

Plan:
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``.

Two endpoints, mounted under ``/api/v1/devices/pair-codes``:

* ``POST /api/v1/devices/pair-codes`` — **operator JWT required.** Mints
  a fresh 6-char code with a 5-minute TTL. Tenant is resolved from the
  authenticated user via :func:`resolve_tenant_for_user` and burned in
  at mint time.

* ``POST /api/v1/devices/pair-codes/{code}/redeem`` — **no operator JWT
  required.** The runner posts ``(device_id, hostname)`` and gets back
  the canonical ``PairCompleteResponse`` shape. The endpoint is
  unauthenticated by design — the pair code IS the credential. The
  resulting device JWT is tenant-scoped to the code's mint-time tenant,
  so even though anyone with the code can redeem, the blast radius is
  bounded by what the issuing operator could have done.
"""

from __future__ import annotations

from datetime import UTC
from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.core.config import settings
from app.crud import pair_code_crud
from app.models.user import User as UserModel
from app.schemas.pair_code import (
    PairCodeMintIn,
    PairCodeMintOut,
    PairCodeRedeemIn,
    PairCodeRedeemOut,
)
from app.services.coord_operator_resolver import resolve_tenant_for_user
from app.services.strategy import strategy_client

logger = structlog.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Mint
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=PairCodeMintOut,
    status_code=status.HTTP_201_CREATED,
)
async def mint_pair_code_endpoint(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    _payload: PairCodeMintIn = PairCodeMintIn(),
) -> Any:
    """Mint a fresh single-use pair code (5-minute TTL).

    The operator's tenant is resolved from the auth context and burned
    into the row so the runner that later redeems the code gets a
    correctly-scoped device JWT without trusting any runner-supplied
    tenant_id.
    """
    # Tenant is resolved + captured HERE, at mint time, while the user is
    # authenticated (sub-primary / email-fallback re-key, expand/contract).
    # It is burned into the pair-code row so the LATER, UNAUTHENTICATED
    # redeem can mint a correctly-scoped device JWT without re-resolving —
    # the redeem has no user identity, so this resolution cannot be
    # offloaded to it.
    tenant_id = await resolve_tenant_for_user(current_user, db)
    row = await pair_code_crud.mint_pair_code(
        db,
        tenant_id=tenant_id,
        issued_by_user_id=current_user.id,
    )
    await db.commit()
    return PairCodeMintOut(code=row.code, expires_at=row.expires_at)


# ---------------------------------------------------------------------------
# Redeem
# ---------------------------------------------------------------------------


@router.post(
    "/{code}/redeem",
    response_model=PairCodeRedeemOut,
    status_code=status.HTTP_200_OK,
)
async def redeem_pair_code_endpoint(
    *,
    db: AsyncSession = Depends(get_async_db),
    code: str,
    payload: PairCodeRedeemIn,
) -> Any:
    """Redeem a single-use pair code for a device JWT.

    **UNAUTHENTICATED ON PURPOSE.** This endpoint deliberately requires
    NO operator JWT — the pair code IS the credential. The runner has
    no operator JWT yet (that's why it needs to pair), so any
    auth-gated alternative would defeat the entire flow.

    The resulting device JWT is tenant-scoped to the **code's**
    mint-time tenant, NOT to anything the runner asserts in the request
    body. The runner's ``device_id`` is recorded but used only as the
    new device's stable identity — the runner cannot escalate to a
    different tenant by claiming a different ``device_id``.

    Returns:

    * **200** + :class:`PairCodeRedeemOut` on success.
    * **404** if the code doesn't exist (or never did).
    * **409** if the code has already been redeemed (single-use).
    * **410** if the code has expired.
    * **502** if the downstream coord ``pair-cli`` call fails.
    """
    code_upper = code.upper()
    row = await pair_code_crud.get_redeemable(db, code_upper)
    if row is None:
        # Differentiate 404 (never existed) from 409 (already redeemed)
        # from 410 (expired). A second unlocked lookup gives us the
        # discriminator. The unlocked re-query is safe: if the row is
        # genuinely missing, both queries see NULL; if it's redeemed or
        # expired, both queries see the same row state.
        existing = await pair_code_crud.find_by_code(db, code_upper)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "pair_code_not_found",
                    "message": "Pair code not found.",
                },
            )
        if existing.redeemed_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "pair_code_already_redeemed",
                    "message": "Pair code has already been redeemed.",
                },
            )
        # Expired (the only remaining failure case from get_redeemable).
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "pair_code_expired", "message": "Pair code has expired."},
        )

    # Forward to coord's pair-cli endpoint to mint the device JWT,
    # reusing the same backend code path the authenticated /pair-cli
    # endpoint uses (modulo the user-JWT — here we trust the pair code
    # itself, so we mint with the code's burned-in tenant + issuer).
    if not strategy_client.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Coord integration disabled (COORD_ADMIN_SECRET unset); "
                "device pairing unavailable."
            ),
        )

    coord_url = settings.COORD_URL.rstrip("/")
    headers = await strategy_client._headers(str(row.issued_by_user_id))  # noqa: SLF001
    body: dict[str, Any] = {
        "device_id": str(payload.device_id),
        "hostname": payload.hostname,
        "name": payload.hostname,
        "user_id": str(row.issued_by_user_id),
        "tenant_id": str(row.tenant_id),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{coord_url}/coord/devices/pair-cli",
                headers=headers,
                json=body,
            )
    except httpx.HTTPError as exc:
        logger.error(
            "pair_code_redeem_coord_transport_failed",
            code_prefix=code_upper[:2],
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord unreachable.",
        ) from exc

    if resp.status_code not in (200, 201):
        logger.warning(
            "pair_code_redeem_coord_rejected",
            code_prefix=code_upper[:2],
            status=resp.status_code,
            body=resp.text[:500],
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "coord_status": resp.status_code,
                "coord_body": resp.text[:500],
            },
        )

    try:
        coord_body = resp.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-cli returned non-JSON.",
        ) from exc

    coord_device_id_raw = coord_body.get("device_id")
    coord_token = coord_body.get("token")
    if not coord_device_id_raw or not coord_token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-cli response missing device_id/token.",
        )

    try:
        coord_device_id = UUID(str(coord_device_id_raw))
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coord pair-cli returned malformed device_id.",
        ) from exc

    # All-clear — mark the code redeemed. The row lock from
    # get_redeemable() guarantees this is the single successful
    # consume; concurrent attempts will have failed at that gate.
    await pair_code_crud.mark_redeemed(db, row=row, device_id=coord_device_id)
    await db.commit()

    expires_at_raw = coord_body.get("exp")
    from datetime import datetime as _dt

    expires_at_dt: _dt | None = None
    if isinstance(expires_at_raw, int):
        expires_at_dt = _dt.fromtimestamp(expires_at_raw, tz=UTC)

    logger.info(
        "pair_code_redeemed",
        code_prefix=code_upper[:2],
        tenant_id=str(row.tenant_id),
        device_id=str(coord_device_id),
        issued_by=str(row.issued_by_user_id),
    )
    return PairCodeRedeemOut(
        user_id=row.issued_by_user_id,
        tenant_id=row.tenant_id,
        device_id=coord_device_id,
        expires_at=expires_at_dt,
        device_token_jwt=str(coord_token),
    )
