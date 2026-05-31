"""Request-scoped client for coord's device routing/data endpoints.

Phase 3 of ``2026-05-30-web-coord-schema-boundary-decoupling.md``: the
HTTP-boundary replacement for web's direct **reads** of ``coord.devices``.
Web no longer reaches into coord's Postgres schema for device routing or
the dashboard device list/get; it asks coord over its own API, authorized
on the caller's forwarded Cognito bearer **and** scoped by the
``x-qontinui-user-id`` header (the authenticated web user's id, which
``coord.devices.user_id`` references — the operator bearer alone cannot
supply it; see plan "Add ``GET /coord/devices/routing``").

The device **write** path (register / heartbeat / delete + the WS
``ws_session_id`` lifecycle) stays on the SQLAlchemy ORM — an explicit
out-of-scope follow-up. This client covers reads only.

Endpoints (all GET, bearer-authed, + ``x-qontinui-user-id`` header):

* ``GET /coord/devices/routing/active`` → ``{"port": <int|null>}`` — the
  user's active paired-runner port.
* ``GET /coord/devices/:id/routing`` → ``{"device_id": "...",
  "ws_session_id": <int|null>}`` — a device's ws session, ownership-checked
  (404 if not owned).
* ``GET /coord/devices/by-user`` → ``{"devices": [<row>...], "count": N}``
  — the user's paired devices (each a full ``coord.devices`` row as JSON).
* ``GET /coord/devices/:id/owned`` → ``<row>``, 404 if not owned.

Transport failures map to 502 (ConnectError) / 504 (TimeoutException),
the same posture as ``operations.py::_proxy_coord_get`` and
``coord_identity.py``. Coord's own ``>= 400`` statuses (notably 404 for an
unowned device) are surfaced verbatim.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import HTTPException, Request

from app.core.config import settings

logger = structlog.get_logger(__name__)

# Same 5s budget the operations.py coord proxies + coord_identity use.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# Coord's per-device-ownership scoping header (mirrors
# ``crate::auth::USER_ID_HEADER`` on the coord side).
_USER_ID_HEADER = "x-qontinui-user-id"


def extract_bearer(request: Request) -> str | None:
    """Pull the caller's bearer from the ``access_token`` cookie or the
    ``Authorization`` header — the same two sources the backend's own
    ``CookieOrBearerScheme`` (and ``coord_identity._extract_bearer``) read."""
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return None


def _headers(bearer: str | None, user_id: str) -> dict[str, str]:
    headers: dict[str, str] = {_USER_ID_HEADER: user_id}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return headers


async def _get(
    path: str,
    *,
    bearer: str | None,
    user_id: str,
    allow_404: bool = False,
) -> Any:
    """GET ``path`` from coord with the bearer + user-id header.

    ``allow_404`` — when True, a coord 404 returns ``None`` (the
    ownership-miss signal) instead of raising; callers that want to
    surface coord's 404 verbatim leave it False.
    """
    url = f"{settings.COORD_URL}{path}"
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.get(url, headers=_headers(bearer, user_id))
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=502, detail="coord is not reachable"
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504, detail="timeout waiting for coord"
            ) from exc
    if allow_404 and resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    try:
        return resp.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail=f"coord {path} returned non-JSON"
        ) from exc


async def get_active_routing_port(
    *,
    bearer: str | None,
    user_id: str,
) -> int | None:
    """Return the user's active paired-runner port, or ``None``.

    Mirrors the old ``SELECT port FROM coord.devices WHERE user_id=:uid AND
    capability_user_paired AND ws_session_id IS NOT NULL ORDER BY
    ws_connected_at DESC LIMIT 1``. Returns ``None`` on no active runner so
    the caller can fall back to its default port. Transport failures still
    raise 502/504.
    """
    payload = await _get(
        "/coord/devices/routing/active", bearer=bearer, user_id=user_id
    )
    if isinstance(payload, dict):
        port = payload.get("port")
        if isinstance(port, int):
            return port
    return None


async def get_device_routing(
    device_id: str | UUID,
    *,
    bearer: str | None,
    user_id: str,
) -> dict[str, Any] | None:
    """Return ``{"device_id", "ws_session_id"}`` for an owned device.

    Replaces ``SELECT device_id, ws_session_id FROM coord.devices WHERE
    device_id=:id AND user_id=:uid AND capability_user_paired``. Returns
    ``None`` when coord reports the device is not owned (its 404) — the same
    signal the old ``row is None`` carried. Transport failures raise
    502/504.
    """
    payload = await _get(
        f"/coord/devices/{device_id}/routing",
        bearer=bearer,
        user_id=user_id,
        allow_404=True,
    )
    if payload is None:
        return None
    if isinstance(payload, dict):
        return payload
    raise HTTPException(
        status_code=502,
        detail="coord /coord/devices/:id/routing returned a non-object payload",
    )


async def list_devices_for_user(
    request: Request,
    user_id: str,
) -> list[dict[str, Any]]:
    """Return the user's paired devices as full ``coord.devices`` JSON rows.

    Replaces the ``device_crud.list_devices`` ORM read. Each row carries
    every ``coord.devices`` column (snake_case keys from coord's
    ``to_jsonb``).
    """
    payload = await _get(
        "/coord/devices/by-user",
        bearer=extract_bearer(request),
        user_id=user_id,
    )
    if isinstance(payload, dict):
        rows = payload.get("devices")
        if isinstance(rows, list):
            return [r for r in rows if isinstance(r, dict)]
    return []


async def get_owned_device(
    request: Request,
    device_id: str | UUID,
    user_id: str,
) -> dict[str, Any]:
    """Return a single owned device row, or raise coord's 404.

    Replaces ``device_crud.get_device`` + ``_ensure_owned``. Coord's
    ownership check (404 if the device isn't owned by ``user_id``) replaces
    the web-side ``_ensure_owned``.
    """
    payload = await _get(
        f"/coord/devices/{device_id}/owned",
        bearer=extract_bearer(request),
        user_id=user_id,
    )
    if isinstance(payload, dict):
        return payload
    raise HTTPException(
        status_code=502,
        detail="coord /coord/devices/:id/owned returned a non-object payload",
    )
