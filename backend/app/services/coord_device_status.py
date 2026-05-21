"""Coord device-status bridge — REST proxy + WS bridge.

Plan: `D:/qontinui-root/plans/2026-05-21-coordination-improvements.md`
Phase 1.3. Provides the web backend's view of coord's
``coord.device_status`` surface so the operations dashboard can render
a live "currently doing" sub-line on each `MachineCard`.

Two pieces ship here:

1. :func:`fetch_device_status` — tenant-scoped REST proxy to
   ``GET /coord/status?tenant_id=<uuid>``. Used by the
   ``/api/v1/operations/device-status`` endpoint for the initial seed
   and as a polling fallback when the WS is offline.
2. :func:`mint_device_status_token` — mints a coord-issued service
   JWT carrying the operator's resolved ``tenant_id`` claim, scoped
   for the dashboard's WS subscription. Used by the WS-bridge
   endpoint to authenticate upstream to coord's
   ``/ws/device-status``.

The mint path requires `COORD_ADMIN_SECRET` to be set; without it the
device-status surface returns 503 (same posture as
:mod:`app.services.strategy`). The minted token's `tenant_id` claim
is the sole authorization input coord uses to scope subscription
topics on `/ws/device-status` (`device_status:<tenant_uuid>`) — the
admin secret + tenant resolution upstream guarantee an operator can
only ever subscribe to their own tenant's bucket.

Cache discipline: tokens are minted per-call (no in-process cache)
because the dashboard's WS bridge opens one upstream WS per browser
session, and the WS may live for hours; pre-minting + holding stale
tokens would be more complex than re-minting on each WS attach
(roughly one mint per page-load).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

# Same shared timeout as :mod:`app.api.v1.endpoints.operations`. Coord's
# `/coord/status` is a small JSON read backed by a single SQL SELECT;
# 5s is generous and matches the `_COORD_TIMEOUT` used by the other
# proxy helpers.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# Service-name embedded in the minted JWT's `sub` claim
# (`sub = "service:qontinui-web-device-status"`). Distinct from the
# strategy-bridge service name so coord's audit log can disambiguate.
DEVICE_STATUS_SERVICE_NAME = "qontinui-web-device-status"


class CoordDeviceStatusDisabledError(RuntimeError):
    """Raised when COORD_ADMIN_SECRET is unset and the device-status
    bridge surface is therefore unavailable. Surfaced as HTTP 503."""


class CoordDeviceStatusMintFailedError(RuntimeError):
    """Raised when coord's service-token endpoint rejects the mint."""


async def fetch_device_status(
    *,
    tenant_id: UUID,
    since: str | None = None,
) -> dict[str, Any]:
    """Proxy ``GET /coord/status?tenant_id=<uuid>&since=<rfc3339>``.

    Returns the parsed JSON body. Coord shapes the response as
    ``{"devices": [StatusRow, ...], "count": <int>}`` (Phase 6 of the
    unified-devices plan renamed the wrapper key from `machines` →
    `devices`).
    """
    url = f"{settings.COORD_URL.rstrip('/')}/coord/status"
    params: dict[str, str] = {"tenant_id": str(tenant_id)}
    if since is not None:
        params["since"] = since
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        resp = await client.get(url, params=params)
    resp.raise_for_status()
    body: Any = resp.json()
    if not isinstance(body, dict):
        # Defensive — coord always wraps; treat anything else as empty.
        return {"devices": [], "count": 0}
    return body


async def mint_device_status_token(*, tenant_id: UUID) -> str:
    """Mint a coord-issued service JWT scoped to ``tenant_id``.

    The minted token carries:

    - ``sub = "service:qontinui-web-device-status"``
    - ``sub_type = "service"``
    - ``tenant_id = <tenant_id>``  (Phase 1.3 of coordination-improvements)
    - 4h TTL (same as agent tokens)

    Coord's ``/ws/device-status`` subscription gate
    (``device_status_ws::claims_can_subscribe``) requires the JWT's
    ``tenant_id`` claim to match the requested
    ``device_status:<tenant_uuid>`` topic — that's the per-tenant
    isolation the dashboard relies on.

    Raises:
        CoordDeviceStatusDisabledError: ``COORD_ADMIN_SECRET`` unset
            (feature is intentionally disabled until coord is reachable
            with an admin secret).
        CoordDeviceStatusMintFailedError: coord rejected the mint
            (transport error, 4xx/5xx response). Surfaced as 502 by
            the calling endpoint.
    """
    admin_secret = settings.COORD_ADMIN_SECRET
    if not admin_secret:
        raise CoordDeviceStatusDisabledError(
            "COORD_ADMIN_SECRET not set — device-status WS bridge disabled"
        )

    url = f"{settings.COORD_URL.rstrip('/')}/coord/auth/service-token"
    payload = {
        "service_name": DEVICE_STATUS_SERVICE_NAME,
        "tenant_id": str(tenant_id),
        # The WS subscription gate only inspects the `tenant_id`
        # claim; no scope grants are required to read device_status.
        # We pass an empty scopes object to make that explicit
        # rather than implicit.
        "scopes": {},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                headers={"X-Coord-Admin-Secret": admin_secret},
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise CoordDeviceStatusMintFailedError(
            f"coord service-token transport failed: {exc}"
        ) from exc

    if resp.status_code != 200:
        raise CoordDeviceStatusMintFailedError(
            f"coord service-token mint failed: HTTP {resp.status_code} "
            f"{resp.text[:200]}"
        )

    try:
        body = resp.json()
    except ValueError as exc:
        raise CoordDeviceStatusMintFailedError(
            f"coord service-token response not JSON: {resp.text[:200]}"
        ) from exc

    token = body.get("token")
    if not isinstance(token, str) or not token:
        raise CoordDeviceStatusMintFailedError(
            f"coord service-token response missing 'token' field: {body!r}"
        )
    logger.info(
        "device_status_token_minted",
        sub=body.get("sub"),
        tenant_id=str(tenant_id),
        exp=body.get("exp"),
    )
    return token


def build_device_status_ws_url(token: str) -> str:
    """Build the upstream coord WS URL with the token query param.

    Coord exposes the WS at ``wss?://<coord-host>/ws/device-status``;
    the token is carried in the query string (browsers can't set
    headers on WS upgrades, and coord's handler reads
    `?token=<jwt>` accordingly).

    Translates the configured ``COORD_URL`` scheme:
    `http://` → `ws://`, `https://` → `wss://`. Falls back to `ws://`
    for any other (defensive — we don't expect another scheme).
    """
    base = settings.COORD_URL.rstrip("/")
    if base.startswith("https://"):
        ws_base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        ws_base = "ws://" + base[len("http://") :]
    else:
        ws_base = "ws://" + base
    return f"{ws_base}/ws/device-status?token={token}"
