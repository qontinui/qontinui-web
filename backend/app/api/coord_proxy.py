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

The bodies still live in ``operations`` and are re-exported here; moving
them is the core move of plan
``2026-10-04-web-coord-http-client-is-copied-across-operations-and-six-modules``,
after which ``operations`` re-imports them so existing ``from …operations
import X`` sites and ``dependency_overrides[get_tenant_id]`` keep working.
The ``patch("app.api.v1.endpoints.operations.httpx.AsyncClient")`` target the
proxy tests use does NOT pin them there: ``operations.httpx`` is the global
``httpx`` module, so that patch replaces ``httpx.AsyncClient`` for every
caller, wherever its body lives — it only needs ``operations`` to keep an
``httpx`` attribute. What a move DOES defeat is a string patch on an imported
name (``…operations.get_coord_identity``); those go through
``tests/_ops_patch.py::patch_ops``, which patches this module and every
loaded operations module that binds the name.
"""

from app.api.v1.endpoints.operations import (
    _COORD_MERGED_READ_TIMEOUT,
    _COORD_PR_LIST_TIMEOUT,
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
    "_COORD_MERGED_READ_TIMEOUT",
    "_COORD_PR_LIST_TIMEOUT",
    "_caller_active_tenant",
    "_caller_bearer",
    "_extract_caller_token",
    "_proxy_coord_get",
    "_proxy_coord_post",
    "_tenant_headers",
    "get_tenant_id",
    "require_coord_tenant_admin",
]
