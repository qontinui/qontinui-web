"""Best-effort coord ``helper`` operator-role provisioning.

Helper-task-queue plan §9.4: when a HELPER organization invite is accepted,
the accepting user should be granted coord's custom ``helper`` operator_role
so coord's ``require_helper_or_operator`` gate admits them to the portal
routes (``GET /coord/helper-tasks`` / ``POST /coord/helper-tasks/:id/answer``).

What this module can and cannot do today
----------------------------------------

Coord's only role-grant surface is ``POST /admin/coord/operators/{id}/roles``
(``routes_phase3.rs::post_operator_grant_role``), which is
``rbac::require_role("admin")``-gated — the caller must be a coord tenant
admin. At invite-accept time the only bearer the web backend holds is the
*accepting helper's own* Cognito token, and the web backend has no coord
service credential of its own. So:

- When the accepting user happens to hold a coord admin role (the
  owner-testing case: an owner accepting a helper invite into their own
  tenant), the grant SUCCEEDS and lands in the caller's active/home tenant.
- When the accepting user is a genuinely-new helper, coord rejects the grant
  (403) — expected and non-fatal. The identity resolution performed first
  still auto-provisions the operator + home tenant coord-side
  (``lookup_or_provision_operator``), and org owners/admins can complete the
  grant through the existing member-management surface
  (``POST /api/v1/operations/coord/members/{operator_id}/roles``).

DOCUMENTED GAP (for the coordinator): coord has no invite-scoped /
self-service grant path and the web backend has no coord service identity,
so a helper's coord role cannot be provisioned automatically on accept.
Portal access for owner-testing works via coord's operator-hierarchy
fallback regardless.

Every failure path here is swallowed and logged — invite acceptance must
NEVER be blocked by coord provisioning.
"""

from __future__ import annotations

import httpx
import structlog
from fastapi import HTTPException, Request

from app.core.config import settings
from app.services.coord_identity import get_coord_identity

logger = structlog.get_logger(__name__)

# Same 5s budget as the other web→coord proxies.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# Coord's free-text operator_role admitted by `require_helper_or_operator`.
COORD_HELPER_ROLE = "helper"


def _extract_bearer(request: Request) -> str | None:
    """Caller bearer from the ``access_token`` cookie or Authorization header
    (same two sources as ``coord_identity`` / ``operations``)."""
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return None


async def provision_coord_helper_role(request: Request) -> str:
    """Best-effort: grant coord's ``helper`` role to the calling user.

    Returns an outcome tag for structured logging:

    - ``"granted"`` — coord accepted the grant (caller was a coord admin).
    - ``"operator_provisioned_grant_denied"`` — operator exists coord-side
      but the grant was rejected (the expected non-admin path; see module
      docstring for the documented gap).
    - ``"identity_unresolved"`` / ``"no_bearer"`` / ``"coord_unreachable"`` /
      ``"grant_failed_<status>"`` — degraded paths, all non-fatal.

    Never raises.
    """
    bearer = _extract_bearer(request)
    if not bearer:
        logger.warning("coord_helper_provisioning_no_bearer")
        return "no_bearer"

    # Resolve (and coord-side auto-provision) the caller's operator identity.
    try:
        identity = await get_coord_identity(request)
    except HTTPException as exc:
        logger.warning(
            "coord_helper_provisioning_identity_unresolved",
            status_code=exc.status_code,
            detail=str(exc.detail),
        )
        return "identity_unresolved"
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("coord_helper_provisioning_identity_error", error=str(exc))
        return "identity_unresolved"

    if identity.operator_id is None:
        logger.warning("coord_helper_provisioning_no_operator_id")
        return "identity_unresolved"

    # Already holding the helper role (or better)? Nothing to do.
    if COORD_HELPER_ROLE in identity.roles:
        return "already_granted"

    url = f"{settings.COORD_URL}/admin/coord/operators/{identity.operator_id}/roles"
    headers = {"Authorization": f"Bearer {bearer}"}
    try:
        async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
            resp = await client.post(
                url, json={"role": COORD_HELPER_ROLE}, headers=headers
            )
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("coord_helper_provisioning_coord_unreachable", error=str(exc))
        return "coord_unreachable"

    if resp.status_code < 400:
        logger.info(
            "coord_helper_role_granted",
            operator_id=str(identity.operator_id),
        )
        return "granted"

    if resp.status_code == 403:
        # Expected for a non-admin accepting caller — the documented gap.
        logger.info(
            "coord_helper_provisioning_grant_denied",
            operator_id=str(identity.operator_id),
            note=(
                "coord role-grant requires a tenant-admin bearer; helper "
                "operator was auto-provisioned but the `helper` role must be "
                "granted by an org admin via the member-management surface"
            ),
        )
        return "operator_provisioned_grant_denied"

    logger.warning(
        "coord_helper_provisioning_grant_failed",
        status_code=resp.status_code,
        body=resp.text[:500],
    )
    return f"grant_failed_{resp.status_code}"
