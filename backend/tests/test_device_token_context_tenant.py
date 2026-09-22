"""``DeviceTokenContext``'s tenant accessors, and the dual-input actor context.

Plan
``2026-09-22-the-plan-corpus-has-no-tenant-axis-so-a-multi-bound-device-cannot-scope-its-plans``
Phase 2. No database and no event loop for the pure accessors, so these never
skip — which matters, because the property they pin is a POSTURE, and a posture
that only holds where the suite happens to have a Postgres is not pinned.

The split under test
--------------------
``tenant_id`` and ``tenant_id_optional`` differ on ONE input and agree on the
other, deliberately:

* **missing claim** — ``tenant_id`` 401s (``GET /devices/me`` owes the tenant
  as its answer and has nothing to return), ``tenant_id_optional`` yields
  ``None`` (coord mints ``Claims.tenant_id`` as an ``Option``, so a
  tenant-less token is a supported credential and the corpus records
  ``unknown``).
* **malformed claim** — BOTH 401. A broken credential filed as ``unknown``
  would put a real tenant's row in the unattributed bucket, which is the one
  outcome ``tenant_source`` exists to prevent. If these two ever converge on
  "return None", the two absences have collapsed and the axis is lying.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.api.deps import ActorPrincipal, DeviceTokenContext, _resolve_actor_context

TENANT = UUID("33333333-3333-4333-8333-333333333333")


class _FakeUser:
    def __init__(self) -> None:
        self.id = uuid4()


def _ctx(**claims) -> DeviceTokenContext:
    return DeviceTokenContext(claims=dict(claims), user=_FakeUser())  # type: ignore[arg-type]


# --------------------------------------------------------------------------
# The strict accessor.
# --------------------------------------------------------------------------


def test_tenant_id_returns_the_claim() -> None:
    assert _ctx(tenant_id=str(TENANT)).tenant_id == TENANT


def test_tenant_id_401s_on_a_missing_claim() -> None:
    with pytest.raises(HTTPException) as exc:
        _ = _ctx().tenant_id
    assert exc.value.status_code == 401
    assert "tenant_id" in str(exc.value.detail)


def test_tenant_id_401s_on_a_malformed_claim() -> None:
    with pytest.raises(HTTPException) as exc:
        _ = _ctx(tenant_id="not-a-uuid").tenant_id
    assert exc.value.status_code == 401


# --------------------------------------------------------------------------
# The optional accessor — asymmetric ON PURPOSE.
# --------------------------------------------------------------------------


def test_tenant_id_optional_returns_the_claim() -> None:
    assert _ctx(tenant_id=str(TENANT)).tenant_id_optional == TENANT


def test_tenant_id_optional_is_none_on_a_missing_claim() -> None:
    assert _ctx().tenant_id_optional is None


def test_tenant_id_optional_still_401s_on_a_malformed_claim() -> None:
    """The half of the asymmetry a "simplification" would delete."""
    with pytest.raises(HTTPException) as exc:
        _ = _ctx(tenant_id="not-a-uuid").tenant_id_optional
    assert exc.value.status_code == 401


def test_an_empty_string_claim_is_absent_not_malformed() -> None:
    """Falsy claims read as ABSENT, matching ``device_id``'s own ``if not raw``.

    A JWT minter that emits ``""`` for "no tenant" must not produce a 401 on
    the recording path; it is the same absence as omitting the key.
    """
    assert _ctx(tenant_id="").tenant_id_optional is None


# --------------------------------------------------------------------------
# The dual-input door.
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_operator_arm_yields_no_device_context() -> None:
    """``None`` means "this caller is not a device", never "claims unavailable".

    It is also the property that lets a DUAL-AUTH route depend on this at all:
    ``get_authenticated_device`` would have raised on a bearer-less browser
    request long before the handler ran.
    """
    user = _FakeUser()
    principal, device_ctx = await _resolve_actor_context(user, None)  # type: ignore[arg-type]
    assert isinstance(principal, ActorPrincipal)
    assert principal.kind == "operator"
    assert device_ctx is None


@pytest.mark.asyncio
async def test_a_cognito_user_wins_even_when_a_bearer_is_also_present(
    monkeypatch,
) -> None:
    """Precedence is unchanged from ``_resolve_actor_principal``.

    A forwarded device token must not let a browser operator act as the
    device — so the device arm is never consulted, and no claims come back.
    """
    from app.api import deps

    async def _boom(_token: str):  # pragma: no cover — must not be reached
        raise AssertionError("the device arm ran although a Cognito user resolved")

    monkeypatch.setattr(deps, "_verify_device_jwt", _boom)

    class _Creds:
        credentials = "a-device-jwt"

    principal, device_ctx = await deps._resolve_actor_context(
        _FakeUser(),  # type: ignore[arg-type]
        _Creds(),  # type: ignore[arg-type]
    )
    assert principal.kind == "operator"
    assert device_ctx is None


@pytest.mark.asyncio
async def test_device_arm_verifies_once_and_hands_back_the_claims(
    monkeypatch,
) -> None:
    """ONE verification, both halves.

    Depending on ``get_audit_actor_user`` plus a separate device dependency
    would run ``_verify_device_jwt`` twice — two coord-JWKS checks and two
    ``User`` selects per request. The call counter is the assertion.
    """
    from app.api import deps

    user = _FakeUser()
    calls: list[str] = []

    async def _verify(token: str):
        calls.append(token)
        return ({"device_id": str(uuid4()), "tenant_id": str(TENANT)}, user)

    monkeypatch.setattr(deps, "_verify_device_jwt", _verify)

    class _Creds:
        credentials = "a-device-jwt"

    principal, device_ctx = await deps._resolve_actor_context(None, _Creds())  # type: ignore[arg-type]
    assert principal.kind == "device"
    assert device_ctx is not None
    assert device_ctx.tenant_id == TENANT
    assert calls == ["a-device-jwt"]


@pytest.mark.asyncio
async def test_no_user_and_no_bearer_is_still_a_401() -> None:
    """There is no anonymous path, and this door does not invent one."""
    with pytest.raises(HTTPException) as exc:
        await _resolve_actor_context(None, None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_resolve_actor_principal_delegates_to_the_shared_tree(
    monkeypatch,
) -> None:
    """One implementation, not two — the property the module docstring claims."""
    from app.api import deps

    user = _FakeUser()
    calls: list[str] = []

    async def _verify(token: str):
        calls.append(token)
        return ({"device_id": str(uuid4())}, user)

    monkeypatch.setattr(deps, "_verify_device_jwt", _verify)

    class _Creds:
        credentials = "a-device-jwt"

    principal = await deps._resolve_actor_principal(None, _Creds())  # type: ignore[arg-type]
    assert principal.kind == "device"
    assert calls == ["a-device-jwt"]
