"""Unit tests for ``GET /api/v1/devices/me`` device-identity resolution (PR #412).

``app.api.v1.endpoints.devices.get_device_identity`` is the disjoint
device-principal path: the relay's ``_auth.ts`` forwards a coord-issued
device-token JWT here to resolve ``(device_id, user_id, tenant_id)``. The
Cognito-only ``/auth/users/me`` rejects a device JWT, so this is the only
route that turns a device token into a principal.

These tests call the route function directly with a stub
``DeviceTokenContext`` (no TestClient / coord JWKS needed — unit posture
per ``tests/conftest.py``) and additionally lock the ROUTE ORDERING
invariant, which is a latent footgun: FastAPI matches routes in
registration order, so ``/me`` MUST be registered before ``/{device_id}``
or ``GET /devices/me`` gets captured with ``device_id="me"`` and 422s /
mis-resolves.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException, status

from app.api.deps import DeviceTokenContext
from app.api.v1.endpoints.devices import get_device_identity, router
from app.schemas.device import DeviceIdentityResponse


def _ctx(*, device_id=None, user_id=None, tenant_id="tenant-abc") -> DeviceTokenContext:
    """Build a DeviceTokenContext with the claims the route reads.

    ``device_id`` is read off ``claims['device_id']`` (via the property),
    ``user_id`` off the owning ``user.id``, and ``tenant_id`` off
    ``claims['tenant_id']``.
    """
    device_id = device_id or uuid.uuid4()
    user_id = user_id or uuid.uuid4()
    claims: dict = {"device_id": str(device_id)}
    if tenant_id is not None:
        claims["tenant_id"] = tenant_id

    class _StubUser:
        id = user_id

    return DeviceTokenContext(claims=claims, user=_StubUser())


@pytest.mark.asyncio
async def test_returns_principal_with_all_three_stringified() -> None:
    """The response carries device_id / user_id / tenant_id, every value a
    string — the relay uses them directly as a principal."""
    device_id = uuid.uuid4()
    user_id = uuid.uuid4()
    ctx = _ctx(device_id=device_id, user_id=user_id, tenant_id="tenant-xyz")

    resp = await get_device_identity(device_ctx=ctx)

    assert isinstance(resp, DeviceIdentityResponse)
    assert resp.device_id == str(device_id)
    assert resp.user_id == str(user_id)
    assert resp.tenant_id == "tenant-xyz"
    # All three are emitted as strings (not UUID objects).
    assert isinstance(resp.device_id, str)
    assert isinstance(resp.user_id, str)
    assert isinstance(resp.tenant_id, str)


@pytest.mark.asyncio
async def test_tenant_id_sourced_from_claims() -> None:
    """tenant_id comes from ``claims['tenant_id']`` verbatim, not derived
    from the user or device."""
    ctx = _ctx(tenant_id="personal-jspinak")
    resp = await get_device_identity(device_ctx=ctx)
    assert resp.tenant_id == "personal-jspinak"


@pytest.mark.asyncio
async def test_missing_tenant_claim_is_401() -> None:
    """A device token without a tenant_id claim cannot resolve a tenant ->
    401, rather than emitting an empty/None tenant principal."""
    ctx = _ctx(tenant_id=None)
    with pytest.raises(HTTPException) as exc:
        await get_device_identity(device_ctx=ctx)
    assert exc.value.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_empty_tenant_claim_is_401() -> None:
    """An empty-string tenant_id claim is falsy and must also 401 (a blank
    tenant is not a valid principal)."""
    ctx = _ctx(tenant_id="")
    # _ctx skips the key only on None; force the empty-string case.
    ctx.claims["tenant_id"] = ""
    with pytest.raises(HTTPException) as exc:
        await get_device_identity(device_ctx=ctx)
    assert exc.value.status_code == status.HTTP_401_UNAUTHORIZED


def _route_index(path: str) -> int:
    """Index of the route registered for ``path`` in the devices router.

    Raises if not found so a rename of either path fails loudly instead of
    silently passing the ordering assertion.
    """
    for i, route in enumerate(router.routes):
        if getattr(route, "path", None) == path:
            return i
    raise AssertionError(f"route {path!r} not registered on devices router")


def test_me_route_registered_before_device_id_route() -> None:
    """ROUTE-ORDERING REGRESSION GUARD.

    FastAPI matches routes in registration order. ``GET /me`` and
    ``GET /{device_id}`` both match the literal path ``/me``; if someone
    moves ``/me`` after the parameterized route, ``GET /devices/me`` is
    captured as ``device_id="me"`` (a 422, or worse a mis-resolved lookup)
    and the disjoint device-identity path silently breaks. Lock the order
    here so that reordering flips this test red.
    """
    me_index = _route_index("/me")
    device_id_index = _route_index("/{device_id}")
    assert me_index < device_id_index, (
        "GET /devices/me must be registered BEFORE GET /devices/{device_id}; "
        "otherwise 'me' is captured as a device_id path param."
    )
