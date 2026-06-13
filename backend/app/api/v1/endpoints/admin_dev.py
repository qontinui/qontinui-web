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

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.api.admin_deps import require_admin
from app.api.coord_proxy import _proxy_coord_get, get_tenant_id
from app.models.user import User

router = APIRouter()

# coord-unavailability statuses that the monitoring dashboard degrades over
# rather than propagating: a read-only status page should render a
# "coord unavailable" banner, not a hard 5xx. (Also keeps the Spec CI crawl
# gate green — coord is unreachable in that environment.)
_COORD_DOWN_STATUSES = {502, 503, 504}


def _empty_overview(detail: str) -> dict[str, Any]:
    """A valid (empty) dev-overview envelope annotated with ``coord_error``.

    Shape matches coord's ``{generated_at, gates, rollouts}`` contract so the
    frontend types stay valid; ``coord_error`` (an optional field the page
    surfaces as a banner) explains why the data is empty.
    """
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "gates": [],
        "rollouts": {
            "auto_merge": {"live": [], "shadow": [], "dry_run": []},
            "features": [],
        },
        "coord_error": detail,
    }


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

    When coord is unreachable/degraded (connect-refused → 502, timeout →
    504, etc.) the endpoint returns an empty envelope annotated with
    ``coord_error`` rather than re-raising the 5xx, so the dashboard renders
    a clear "coord unavailable" state instead of a broken page (and the
    Spec CI crawl, which runs without a live coord, stays green).
    """
    try:
        return await _proxy_coord_get("/coord/dev-overview", tenant_id=tenant_id)
    except HTTPException as exc:
        if exc.status_code in _COORD_DOWN_STATUSES:
            detail = exc.detail if isinstance(exc.detail, str) else "coord unavailable"
            return _empty_overview(detail)
        raise
