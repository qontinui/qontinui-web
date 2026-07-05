"""Shared web→coord proxy plumbing.

A single import surface for the helpers that proxy read-only requests to
coord, forwarding the caller's Cognito bearer so coord authorizes on the
operator's identity (its ``sub``) and resolves the tenant from it.

These helpers historically lived as a private copy inside
``app.api.v1.endpoints.operations`` (and a second copy inside
``app.api.v1.endpoints.agent_sessions``). They are re-exported here so new
proxy endpoints (e.g. the superuser gates/rollout dashboard at
``/admin-dev/overview``) can depend on ONE module instead of reaching into
``operations`` or growing a third private copy.

Why re-export rather than relocate the bodies: the existing proxy test
suite patches ``app.api.v1.endpoints.operations.httpx.AsyncClient`` to stub
coord (13 test files) and imports ``get_tenant_id`` from ``operations``.
Moving ``_proxy_coord_get``'s body here would resolve ``httpx`` in *this*
module's namespace, silently defeating those patches. Keeping the canonical
implementations in ``operations`` (and re-exporting the names) preserves the
patch target and the existing call sites while still giving new code a clean,
single import point. If/when those tests are repointed, the bodies can move
here without touching importers.
"""

from app.api.v1.endpoints.operations import (
    ACTIVE_TENANT_HEADER,
    _caller_active_tenant,
    _caller_bearer,
    _extract_caller_token,
    _proxy_coord_get,
    _proxy_coord_post,
    _tenant_headers,
    get_tenant_id,
    require_coord_tenant_admin,
)

__all__ = [
    "ACTIVE_TENANT_HEADER",
    "_caller_active_tenant",
    "_caller_bearer",
    "_extract_caller_token",
    "_proxy_coord_get",
    "_proxy_coord_post",
    "_tenant_headers",
    "get_tenant_id",
    "require_coord_tenant_admin",
]
