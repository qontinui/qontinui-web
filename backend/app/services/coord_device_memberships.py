"""Request-scoped client for coord's device-membership door.

The device twin of :mod:`app.services.coord_identity`. That module asks coord
``GET /admin/coord/me`` who an SSO OPERATOR is; coord serves that route from an
``OperatorContext`` only, so a coord DEVICE JWT can never get an answer there.
This module asks coord ``GET /coord/devices/me/memberships`` instead — the door
plan ``2026-10-07-agents-publish-documents-to-the-project-overview`` (Phase 1.1,
contract C1) adds for exactly this caller::

    {
      "device_id": "<uuid>",
      "user_id":   "<uuid>",
      "memberships": [ {"tenant_id": "<uuid>", "slug": "<str>",
                        "roles": ["admin", ...]}, ... ]
    }

``memberships`` is the device's OWNING USER's tenants and per-tenant roles,
already intersected by coord with the tenants the device is bound to. ``[]`` is
a measured empty set (the device is bound nowhere its user belongs), not an
unknown.

Same conventions as :mod:`app.services.coord_identity`, deliberately:

* **Base URL** ``settings.COORD_URL`` and the same 5 s timeout.
* **Caching** per request on ``request.state``, never a TTL cache — a stale
  role set would mis-gate a write.
* **Credential**: the caller's own verified device bearer is forwarded, and
  only to this door. It is never sent to an operator route.

Refusals coord answers are surfaced, never turned into an empty grant:

* 403 ``no_linked_operator`` — the device's user has no linked coord operator.
* 403 ``device_token_required`` / ``device_token_missing_user_id`` — the token
  is not a user-bearing device principal.
* 503 ``bindings_unavailable`` — coord could not measure the device's bindings.

Every refusal is raised as ``HTTPException`` whose ``detail`` carries the code
under both ``error`` (the overview router's envelope) and ``code``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import HTTPException, Request

from app.core.config import settings

logger = structlog.get_logger(__name__)

#: Same budget as ``coord_identity._COORD_TIMEOUT``.
_COORD_TIMEOUT = httpx.Timeout(5.0)

#: The door's path on coord (contract C1).
MEMBERSHIPS_PATH = "/coord/devices/me/memberships"

# Stash key for the per-request memoized answer.
_REQUEST_STATE_KEY = "_coord_device_memberships"

#: Coord's 403 codes that this module passes through unchanged.
_PASSTHROUGH_403 = frozenset(
    {"no_linked_operator", "device_token_required", "device_token_missing_user_id"}
)


@dataclass(frozen=True)
class DeviceMembership:
    tenant_id: UUID
    slug: str
    roles: tuple[str, ...]


@dataclass(frozen=True)
class DeviceMemberships:
    """Parsed ``GET /coord/devices/me/memberships`` payload."""

    device_id: UUID | None
    user_id: UUID | None
    memberships: tuple[DeviceMembership, ...]

    def membership(self, tenant_id: UUID) -> DeviceMembership | None:
        for entry in self.memberships:
            if entry.tenant_id == tenant_id:
                return entry
        return None


def _refusal(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": code, "code": code, "message": message},
    )


def _as_uuid(value: Any) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None


def parse_memberships(payload: dict[str, Any]) -> DeviceMemberships:
    """Parse the door's 200 body. An entry without a usable ``tenant_id`` is
    dropped — it names no tenant, so it cannot grant one."""
    raw = payload.get("memberships")
    if not isinstance(raw, list):
        # A body without the list is not "no memberships"; it is a door that
        # did not answer the question.
        raise _refusal(
            502,
            "coord_memberships_malformed",
            "coord's device-membership answer carried no memberships list.",
        )
    entries: list[DeviceMembership] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        tenant_id = _as_uuid(entry.get("tenant_id"))
        if tenant_id is None:
            continue
        roles = entry.get("roles") or []
        entries.append(
            DeviceMembership(
                tenant_id=tenant_id,
                slug=str(entry.get("slug") or ""),
                roles=tuple(str(r) for r in roles if isinstance(r, str)),
            )
        )
    return DeviceMemberships(
        device_id=_as_uuid(payload.get("device_id")),
        user_id=_as_uuid(payload.get("user_id")),
        memberships=tuple(entries),
    )


def _error_code(resp: httpx.Response) -> str | None:
    try:
        body = resp.json()
    except ValueError:
        return None
    if isinstance(body, dict):
        code = body.get("error") or body.get("code")
        if isinstance(code, str):
            return code
    return None


async def fetch_device_memberships(bearer: str) -> DeviceMemberships:
    """Call coord's device-membership door with the device's own bearer.

    Transport failures are 502/504, as in ``coord_identity._fetch_identity``.
    """
    url = f"{settings.COORD_URL}{MEMBERSHIPS_PATH}"
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.get(url, headers={"Authorization": f"Bearer {bearer}"})
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=502, detail="coord is not reachable"
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504, detail="timeout waiting for coord"
            ) from exc

    if resp.status_code == 200:
        try:
            payload = resp.json()
        except ValueError as exc:
            raise _refusal(
                502,
                "coord_memberships_malformed",
                "coord's device-membership answer was not JSON.",
            ) from exc
        if not isinstance(payload, dict):
            raise _refusal(
                502,
                "coord_memberships_malformed",
                "coord's device-membership answer was not an object.",
            )
        return parse_memberships(payload)

    code = _error_code(resp)
    logger.warning(
        "coord_device_memberships_refused",
        status=resp.status_code,
        code=code,
    )
    if resp.status_code == 403 and code in _PASSTHROUGH_403:
        messages = {
            "no_linked_operator": (
                "This device's user has no linked coord operator, so it has no "
                "project memberships."
            ),
            "device_token_required": "This route needs a coord device token.",
            "device_token_missing_user_id": (
                "This device token carries no user_id, so it acts for nobody."
            ),
        }
        raise _refusal(403, code, messages[code])
    if resp.status_code == 403:
        raise _refusal(
            403,
            "device_memberships_refused",
            "coord refused to say which projects this device may act in.",
        )
    if resp.status_code == 401:
        raise _refusal(
            401,
            "device_token_rejected",
            "coord rejected this device token.",
        )
    if resp.status_code == 503:
        raise _refusal(
            503,
            code or "bindings_unavailable",
            "coord could not measure this device's project bindings right now.",
        )
    # Anything else — a 404 from a coord that predates the door, a 5xx — is
    # an unanswered question. Never an empty grant.
    raise _refusal(
        502,
        "coord_memberships_unavailable",
        f"coord's device-membership door answered HTTP {resp.status_code}.",
    )


async def get_device_memberships(request: Request, bearer: str) -> DeviceMemberships:
    """The device's memberships, fetched at most once per request."""
    cached = getattr(request.state, _REQUEST_STATE_KEY, None)
    if isinstance(cached, DeviceMemberships):
        return cached
    memberships = await fetch_device_memberships(bearer)
    setattr(request.state, _REQUEST_STATE_KEY, memberships)
    return memberships


__all__ = [
    "DeviceMembership",
    "DeviceMemberships",
    "MEMBERSHIPS_PATH",
    "fetch_device_memberships",
    "get_device_memberships",
    "parse_memberships",
]
