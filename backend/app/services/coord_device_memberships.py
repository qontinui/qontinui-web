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

* 403 with coord's own code, passed through unchanged — ``no_linked_operator``
  (the device's user has no linked coord operator),
  ``device_token_required`` / ``device_token_missing_user_id`` (the token is
  not a user-bearing device principal), ``device_not_paired`` /
  ``device_user_mismatch`` / ``device_credential_revoked`` (coord's
  ``coord.devices`` row does not back the claim), or any later code coord
  adds. A 403 with no readable code is ``device_memberships_refused``.
* 503 ``bindings_unavailable`` — coord could not measure the device's bindings.

An answer this module cannot read is a 502 ``coord_memberships_malformed``
(no ``memberships`` list, a ``roles`` that is not a list of strings), and a
door that could not be reached or answered another status is a 502/504. A
malformed answer is never read as fewer rights: the question went unanswered.

Every refusal is raised as ``HTTPException`` whose ``detail`` carries the code
under both ``error`` (the overview router's envelope) and ``code``.
"""

from __future__ import annotations

import re
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

#: Messages for the 403 codes coord documents on this door (contract C1 and
#: qontinui-coord#2991). Every coord 403 code passes through unchanged,
#: listed here or not; a listed one also gets a sentence a person can act on.
_KNOWN_403_MESSAGES: dict[str, str] = {
    "no_linked_operator": (
        "This device's user has no linked coord operator, so it has no "
        "project memberships."
    ),
    "device_token_required": "This route needs a coord device token.",
    "device_token_missing_user_id": (
        "This device token carries no user_id, so it acts for nobody."
    ),
    "device_not_paired": (
        "coord has no paired device behind this token; pair the device again."
    ),
    "device_user_mismatch": (
        "coord's record of this device names a different user than the token."
    ),
    "device_credential_revoked": (
        "This device's credential has been revoked; pair the device again."
    ),
}

#: The shape a coord error code is passed through in: snake_case, bounded.
#: Anything else is not echoed back to the caller.
_ERROR_CODE_SHAPE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


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
    dropped — it names no tenant, so it cannot grant one.

    A ``roles`` that is not a list of strings is a malformed answer (502), not
    an entry with fewer roles: iterating a string would read ``"admin"`` as the
    roles ``a``, ``d``, ``m``, ``i``, ``n``, and guessing at any other shape
    reads something coord did not say."""
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
        roles = entry.get("roles")
        if not isinstance(roles, list) or not all(isinstance(r, str) for r in roles):
            raise _refusal(
                502,
                "coord_memberships_malformed",
                "coord's device-membership answer carried a roles value that "
                "is not a list of role names.",
            )
        entries.append(
            DeviceMembership(
                tenant_id=tenant_id,
                slug=str(entry.get("slug") or ""),
                roles=tuple(roles),
            )
        )
    return DeviceMemberships(
        device_id=_as_uuid(payload.get("device_id")),
        user_id=_as_uuid(payload.get("user_id")),
        memberships=tuple(entries),
    )


def _error_code(resp: httpx.Response) -> str | None:
    """Coord's error code from a refusal body, when it has the code shape."""
    try:
        body = resp.json()
    except ValueError:
        return None
    if isinstance(body, dict):
        code = body.get("error") or body.get("code")
        if isinstance(code, str) and _ERROR_CODE_SHAPE.fullmatch(code):
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
        except httpx.HTTPError as exc:
            # Any other transport failure (a dropped connection, a protocol
            # error) is the same unanswered question, never a 500.
            raise _refusal(
                502,
                "coord_memberships_unavailable",
                "coord's device-membership door could not be read "
                f"({type(exc).__name__}).",
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
    if resp.status_code == 403:
        if code is None:
            raise _refusal(
                403,
                "device_memberships_refused",
                "coord refused to say which projects this device may act in.",
            )
        # Coord's code IS the diagnosis (an unpaired device, a revoked
        # credential, a user mismatch each want a different remedy), so it is
        # passed through rather than flattened into one refusal.
        raise _refusal(
            403,
            code,
            _KNOWN_403_MESSAGES.get(
                code,
                f"coord refused to say which projects this device may act in ({code}).",
            ),
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
