"""Request-scoped client for coord's operator-identity endpoint.

This is the HTTP-boundary replacement for the old cross-schema reads in
``coord_operator_resolver`` (which SELECTed ``coord.operators`` /
``coord.tenants`` / ``coord.operator_roles`` directly from web's
shared-DB session). Web no longer reaches into coord's Postgres schema
for identity; it asks coord over its own API, authorized on the caller's
forwarded Cognito bearer.

The single source of truth is coord's ``GET /admin/coord/me`` (deployed
via coord PR #212). It returns, for the bearer's operator::

    {
      "operator_id":     "<uuid>",
      "home_tenant_id":  "<uuid>",
      "tenant_id":       "<uuid>",        # == home, back-compat alias
      "email":           "<str>",
      "roles":           ["..."],
      "tenants": [ {"tenant_id": "<uuid>", "slug": "<str>",
                    "roles": ["..."]}, ... ],
      "is_admin":        <bool>
    }

Caching policy (plan Open-Q#1, resolved): cache the result **per request**
(one coord call per request max), NOT a TTL cache — a stale tenant/role
set would mis-gate the dashboard. The cache lives on ``request.state`` so
it is naturally scoped to (and discarded with) the request.

Auth posture: coord's ``/admin/coord/me`` is SSO+RBAC-gated and 403s an
operator that isn't a linked tenant member. Web forwards the caller's
Cognito bearer and surfaces that 403 verbatim (``tenant_not_resolved``) —
so dropping the old web-side ``coord_operator_resolver`` 403 gate does not
open any route: coord still fails the call closed for an unlinked caller.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import HTTPException, Request, status

from app.core.config import settings

logger = structlog.get_logger(__name__)

# Same 5s budget the operations.py coord proxies use — a small JSON read
# from coord's PG; longer than this means coord is unhealthy.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# Stash key for the per-request memoized identity payload.
_REQUEST_STATE_KEY = "_coord_identity"


@dataclass(frozen=True)
class CoordTenant:
    """One tenant membership from ``/admin/coord/me``'s ``tenants[]``."""

    tenant_id: UUID
    slug: str
    roles: tuple[str, ...]


@dataclass(frozen=True)
class CoordIdentity:
    """Parsed ``GET /admin/coord/me`` payload for the calling operator."""

    operator_id: UUID | None
    home_tenant_id: UUID | None
    email: str | None
    roles: tuple[str, ...]
    tenants: tuple[CoordTenant, ...]
    is_admin: bool

    def tenant_ids(self) -> list[UUID]:
        """Home tenant first, then the rest of the membership set.

        Mirrors the old ``resolve_tenants_for_user`` ordering: the home
        tenant is the natural "active" default; the remaining tenants
        follow in coord's (slug-asc) order.
        """
        ids = [t.tenant_id for t in self.tenants]
        if self.home_tenant_id is not None and self.home_tenant_id in ids:
            ids = [self.home_tenant_id] + [
                tid for tid in ids if tid != self.home_tenant_id
            ]
        elif self.home_tenant_id is not None:
            ids = [self.home_tenant_id, *ids]
        return ids

    def slug_for(self, tenant_id: UUID | None) -> str | None:
        """Return the slug of ``tenant_id`` in the membership set."""
        if tenant_id is None:
            return None
        for t in self.tenants:
            if t.tenant_id == tenant_id:
                return t.slug
        return None


def _as_uuid(value: Any) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None


def _parse_identity(payload: dict[str, Any]) -> CoordIdentity:
    raw_tenants = payload.get("tenants") or []
    tenants: list[CoordTenant] = []
    for entry in raw_tenants:
        if not isinstance(entry, dict):
            continue
        tid = _as_uuid(entry.get("tenant_id"))
        if tid is None:
            continue
        roles = entry.get("roles") or []
        tenants.append(
            CoordTenant(
                tenant_id=tid,
                slug=str(entry.get("slug") or ""),
                roles=tuple(str(r) for r in roles),
            )
        )
    return CoordIdentity(
        operator_id=_as_uuid(payload.get("operator_id")),
        # ``home_tenant_id`` is the canonical field; ``tenant_id`` is the
        # back-compat alias coord still emits (== home).
        home_tenant_id=_as_uuid(
            payload.get("home_tenant_id") or payload.get("tenant_id")
        ),
        email=(str(payload["email"]) if payload.get("email") else None),
        roles=tuple(str(r) for r in (payload.get("roles") or [])),
        tenants=tuple(tenants),
        is_admin=bool(payload.get("is_admin", False)),
    )


def _extract_bearer(request: Request) -> str | None:
    """Pull the caller's bearer from the ``access_token`` cookie or the
    ``Authorization`` header — the same two sources the backend's own
    ``CookieOrBearerScheme`` (and ``operations.py::_extract_caller_token``)
    read."""
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return None


# Must match ``operations.ACTIVE_TENANT_HEADER``: the dashboard tenant-switcher
# selection. Forwarded to coord's /me so the returned identity (home tenant +
# per-tenant ``roles``) reflects the SELECTED tenant — coord re-scopes the
# operator context to it, membership-validated (never widening).
ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"


def _extract_active_tenant(request: Request) -> str | None:
    """Read the dashboard tenant-switcher selection header, if present."""
    return request.headers.get(ACTIVE_TENANT_HEADER) or None


async def _fetch_identity(
    bearer: str | None, active_tenant: str | None = None
) -> CoordIdentity:
    """Call coord ``GET /admin/coord/me`` with the forwarded bearer.

    Maps transport failures to 502/504 (same posture as
    ``operations.py::_proxy_coord_get``) and surfaces coord's own status
    codes verbatim — notably the 403 it raises for an unlinked operator
    (the boundary's fail-closed authz gate).

    When ``active_tenant`` is supplied it is forwarded as
    ``X-Qontinui-Active-Tenant`` so coord re-scopes the operator's identity
    (home tenant + per-tenant roles) to that tenant — but only if the
    operator is a member, validated coord-side.
    """
    url = f"{settings.COORD_URL}/admin/coord/me"
    headers: dict[str, str] = {}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if active_tenant:
        headers[ACTIVE_TENANT_HEADER] = active_tenant
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.get(url, headers=headers)
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=502, detail="coord is not reachable"
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504, detail="timeout waiting for coord"
            ) from exc
    if resp.status_code == status.HTTP_403_FORBIDDEN:
        # Coord fails closed for an operator that isn't a linked tenant
        # member — surface the same 403 the old resolver raised.
        raise HTTPException(status_code=403, detail="tenant_not_resolved")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    try:
        payload = resp.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502, detail="coord /admin/coord/me returned non-JSON"
        ) from exc
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=502,
            detail="coord /admin/coord/me returned a non-object payload",
        )
    return _parse_identity(payload)


async def get_coord_identity(request: Request) -> CoordIdentity:
    """Return the calling operator's coord identity, cached on the request.

    One coord round-trip per request max: the parsed payload is memoized
    on ``request.state`` and reused by every consumer in the same request.
    """
    cached = getattr(request.state, _REQUEST_STATE_KEY, None)
    if isinstance(cached, CoordIdentity):
        return cached
    bearer = _extract_bearer(request)
    if bearer is None:
        # Local short-circuit: coord would 401 this anyway, but making the
        # round-trip lets unauthenticated scanners drive outbound load
        # against coord's /admin/coord/me (5s timeout budget per call).
        raise HTTPException(status_code=401, detail="not_authenticated")
    identity = await _fetch_identity(bearer, _extract_active_tenant(request))
    setattr(request.state, _REQUEST_STATE_KEY, identity)
    return identity


async def get_coord_identity_for_token(token: str | None) -> CoordIdentity:
    """Fetch coord identity for an explicit bearer (no request to cache on).

    Used by WebSocket handlers, which authenticate from a query-param token
    rather than a request bearer + cookie. There is no per-request state to
    memoize against on a WS upgrade, so this performs a fresh fetch.
    """
    return await _fetch_identity(token)
