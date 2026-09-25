"""``POST /api/v1/devices/resolve`` — the browser's door to coord's resolver.

Plan ``2026-09-20-runner-selector-drives-a-transport-not-a-target`` Phase 3.
The frontend never calls coord directly: it asks here, and this forwards to
coord's ``POST /coord/devices/resolve`` with the caller's own bearer (see
:mod:`app.services.coord_device_resolve`). The answer is always ``200`` with
an ``outcome`` tag — coord's five outcomes, or ``unavailable`` when coord's
answer could not be obtained (UNKNOWN; the browser keeps its last resolved
target and never substitutes a pick of its own).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_current_active_user_async
from app.models.user import User
from app.schemas.device_resolve import DeviceResolveRequest, DeviceResolveResponse
from app.services.coord_device_resolve import CoordCaller, resolve_device

router = APIRouter()


@router.post(
    "/resolve",
    response_model=DeviceResolveResponse,
    summary="Resolve which of the caller's devices should run a piece of work",
)
async def post_device_resolve(
    body: DeviceResolveRequest,
    request: Request,
    _current_user: User = Depends(get_current_active_user_async),
) -> DeviceResolveResponse:
    """Forward to coord's resolver AS the caller; never a web-side pick.

    Authentication here only refuses anonymous callers early; the user whose
    devices are candidates is decided by coord from the forwarded bearer.
    """
    outcome = await resolve_device(body, CoordCaller.from_request(request))
    return DeviceResolveResponse(outcome)
