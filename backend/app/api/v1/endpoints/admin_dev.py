"""Superuser dev-overview proxy — gates & rollout dashboard backend.

A single read-only proxy endpoint backing the superuser "gates & rollout"
dashboard at ``/admin/coord/gates`` in the operator console. It forwards to
coord's ``GET /coord/dev-overview`` (which emits the gates + rollout
contract consumed by the frontend ``admin-dev-service``).

Auth posture: double-gated.

* ``get_tenant_id`` resolves the caller's home tenant AND, as a side
  effect, captures the caller's Cognito bearer into the request-scoped
  ContextVar that ``_proxy_coord_get`` forwards to coord. (No
  ``request: Request`` param / manual ``_caller_bearer.set(...)`` here — the
  dependency already does it; duplicating it would be dead code.)
* ``require_admin`` enforces the superuser flag web-side. The page itself
  lives behind the console's superuser gate too; this is defense in depth.

The proxy plumbing comes from the shared :mod:`app.api.coord_proxy` module
(re-export of the canonical helpers in
``app.api.v1.endpoints.operations``) so this endpoint does not grow a third
private copy of the bearer-capture/forward machinery.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.admin_deps import require_admin
from app.api.coord_proxy import _proxy_coord_get, get_tenant_id
from app.models.user import User

router = APIRouter()


@router.get("/admin-dev/overview")
async def get_dev_overview(
    tenant_id: UUID = Depends(get_tenant_id),  # captures + forwards caller bearer
    _admin: User = Depends(require_admin),  # superuser gate
) -> Any:
    """Proxy coord's ``GET /coord/dev-overview`` (gates + rollout overview).

    Returns coord's JSON envelope verbatim — the
    ``{generated_at, gates, rollouts}`` contract the frontend
    ``admin-dev-service`` types against. ``tenant_id`` is resolved only to
    trigger bearer-forwarding (the overview is fleet-wide, not tenant-scoped
    on the web side); coord authorizes on the forwarded operator bearer.
    """
    return await _proxy_coord_get("/coord/dev-overview", tenant_id=tenant_id)
