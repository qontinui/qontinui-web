"""Unit tests for the dual-auth audit-actor dependency (PR #412).

``app.api.deps.get_audit_actor_user_id`` is the single place that resolves
the acting principal for the ``POST /api/v1/users/me/co-pilot/activity``
insert path. The relay calls that endpoint with WHICHEVER bearer it holds
— a Cognito user JWT OR a coord-issued device-token JWT — so the
dependency must accept both and, critically, attribute the row to the
right user with no path to spoof another user's id.

These tests CALL THE DEPENDENCY DIRECTLY (it's a plain async function;
Depends() defaults are inert when invoked by hand) rather than through a
TestClient, so they need no PG / Cognito / coord JWKS — matching the
unit-test posture of ``tests/conftest.py`` (integration tests are
``collect_ignore``'d).

The four cases lock the full decision tree in the implementation:

  1. Cognito user resolved -> return ``user.id`` (PRECEDENCE, even when a
     bearer is ALSO present — the Cognito identity always wins).
  2. No Cognito user + a bearer -> verify it as a device token and
     attribute to the device's owning user.
  3. Neither -> 401 (no anonymous insert).
  4. A bearer that fails device verification -> the 401 from
     ``_verify_device_jwt`` propagates (an invalid device token must NOT
     silently fall through to success).
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials

from app.api import deps


def _creds(token: str = "device-jwt-token") -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


@pytest.mark.asyncio
async def test_cognito_user_takes_precedence_even_with_bearer(monkeypatch) -> None:
    """A resolved Cognito user wins outright — its id is returned and the
    device-verification path is NEVER consulted, even when a bearer is also
    present. This is the invariant that keeps a forwarded device token from
    overriding the authenticated browser user."""
    cognito_user = SimpleNamespace(id=uuid.uuid4())

    # If precedence is broken and the device path runs, this would change
    # the returned id — so make it a loud, distinct value.
    def _boom(_token):  # pragma: no cover - must not be called
        raise AssertionError(
            "_verify_device_jwt must not run when a Cognito user is present"
        )

    monkeypatch.setattr(deps, "_verify_device_jwt", _boom)

    result = await deps.get_audit_actor_user_id(user=cognito_user, credentials=_creds())
    assert result == cognito_user.id


@pytest.mark.asyncio
async def test_device_bearer_resolves_to_owning_user(monkeypatch) -> None:
    """With no Cognito user, the presented bearer is verified as a device
    token and the row is attributed to the device's OWNING user."""
    owner = SimpleNamespace(id=uuid.uuid4())
    captured: dict[str, str] = {}

    async def _fake_verify(token):
        captured["token"] = token
        return ({"device_id": str(uuid.uuid4())}, owner)

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)

    result = await deps.get_audit_actor_user_id(
        user=None, credentials=_creds("the-device-token")
    )
    assert result == owner.id
    # The raw bearer string is what gets verified (not e.g. the whole header).
    assert captured["token"] == "the-device-token"


@pytest.mark.asyncio
async def test_no_user_no_bearer_is_401() -> None:
    """Neither a Cognito user nor a bearer -> 401. There is no anonymous
    insert path."""
    with pytest.raises(HTTPException) as exc:
        await deps.get_audit_actor_user_id(user=None, credentials=None)
    assert exc.value.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_invalid_device_bearer_propagates_401(monkeypatch) -> None:
    """A bearer that fails device verification must propagate the 401 — it
    must NOT be swallowed into a success or a different status."""

    async def _fake_verify(_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired device token.",
        )

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)

    with pytest.raises(HTTPException) as exc:
        await deps.get_audit_actor_user_id(user=None, credentials=_creds())
    assert exc.value.status_code == status.HTTP_401_UNAUTHORIZED
