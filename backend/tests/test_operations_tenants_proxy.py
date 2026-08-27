"""Tests for the tenant ("Project") surface under ``/api/v1/operations``.

Plan ``2026-08-25-self-service-tenant-project-creation``, Phase 2:

  - ``POST /api/v1/operations/tenants`` → coord ``POST /coord/tenants``, a
    thin bearer-forwarding proxy with no web-side auth logic of its own;
  - ``GET  /api/v1/operations/tenants`` now renders coord's per-tenant
    ``display_name`` as ``name``, falling back to the slug.

The two halves are tested together because they are one user-visible
claim: a user who types **"My Pizzeria"** must then SEE "My Pizzeria" —
not ``my-pizzeria``. Before this plan ``/me`` carried no display name at
all and the list route hard-coded ``name = slug``.

The proxy tests assert coord's 4xx statuses reach the browser INTACT.
That matters more than it looks: ``409 slug_taken`` is the one answer that
tells a user their name collided, and a 500 there would read as "the
system broke" for what is really "pick another name".
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"

_HOME = UUID("11111111-1111-1111-1111-111111111111")
_OTHER = UUID("22222222-2222-2222-2222-222222222222")


def _build_test_app() -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "operator@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    # `raise_server_exceptions=False` is NOT set: every assertion below is on
    # a status the route raises deliberately, so a real 500 must still blow up
    # the test rather than be silently asserted as a status code.
    return TestClient(_build_test_app())


def _identity(*, display_names: dict[UUID, str | None]) -> Any:
    """A two-tenant operator whose per-tenant display names are given."""
    from app.services.coord_identity import CoordIdentity, CoordTenant

    return CoordIdentity(
        operator_id=uuid4(),
        home_tenant_id=_HOME,
        email="operator@example.com",
        roles=("operator",),
        tenants=(
            CoordTenant(
                tenant_id=_HOME,
                slug="personal-abc",
                roles=("operator",),
                display_name=display_names.get(_HOME),
            ),
            CoordTenant(
                tenant_id=_OTHER,
                slug="my-pizzeria",
                roles=("admin",),
                display_name=display_names.get(_OTHER),
            ),
        ),
        is_admin=False,
    )


def _mock_response(
    status_code: int = 200, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance) -> None:
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _patch_identity(identity: Any):
    return patch(
        "app.api.v1.endpoints.operations.get_coord_identity",
        new=AsyncMock(return_value=identity),
    )


# ---------------------------------------------------------------------------
# GET /tenants — the typed name is what the UI shows
# ---------------------------------------------------------------------------


class TestListUserTenants:
    def test_display_name_is_rendered_not_the_slug(self, client: TestClient):
        """Create "My Pizzeria" → the list route must say "My Pizzeria".

        The plan's whole "user-facing label is Project" decision reduces to
        this assertion: without it a user who typed "My Pizzeria" sees
        `my-pizzeria` in the switcher and the header chip.
        """
        identity = _identity(display_names={_HOME: "Personal", _OTHER: "My Pizzeria"})
        with _patch_identity(identity):
            resp = client.get(f"{API_PREFIX}/tenants")

        assert resp.status_code == 200
        body = resp.json()
        by_id = {t["id"]: t for t in body["tenants"]}
        assert by_id[str(_OTHER)]["name"] == "My Pizzeria"
        # The slug is still carried — the name is presentation, the slug is
        # the identifier — and it is NOT what `name` renders.
        assert by_id[str(_OTHER)]["slug"] == "my-pizzeria"
        assert by_id[str(_HOME)]["name"] == "Personal"
        assert body["active_tenant_id"] == str(_HOME)

    def test_falls_back_to_slug_when_coord_sends_no_display_name(
        self, client: TestClient
    ):
        """A coord that predates `display_name` on `/me` must still work.

        Absence-tolerance is the whole contract here: this half of the plan
        ships independently of coord's half, and an SSO-auto-provisioned
        tenant never gets a display name at all.
        """
        identity = _identity(display_names={_HOME: None, _OTHER: None})
        with _patch_identity(identity):
            resp = client.get(f"{API_PREFIX}/tenants")

        assert resp.status_code == 200
        by_id = {t["id"]: t for t in resp.json()["tenants"]}
        assert by_id[str(_HOME)]["name"] == "personal-abc"
        assert by_id[str(_OTHER)]["name"] == "my-pizzeria"

    def test_empty_membership_is_403_tenant_not_resolved(self, client: TestClient):
        from app.services.coord_identity import CoordIdentity

        identity = CoordIdentity(
            operator_id=uuid4(),
            home_tenant_id=None,
            email="nobody@example.com",
            roles=(),
            tenants=(),
            is_admin=False,
        )
        with _patch_identity(identity):
            resp = client.get(f"{API_PREFIX}/tenants")
        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"


# ---------------------------------------------------------------------------
# POST /tenants — the create proxy
# ---------------------------------------------------------------------------


class TestCreateUserTenant:
    def test_creates_and_forwards_body_to_coord(self, client: TestClient):
        coord_payload = {
            "tenant_id": str(_OTHER),
            "slug": "my-pizzeria",
            "display_name": "My Pizzeria",
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/tenants", json={"display_name": "My Pizzeria"}
            )

        assert resp.status_code == 200
        assert resp.json() == coord_payload

        call = instance.post.call_args
        assert call.args[0].endswith("/coord/tenants")
        # The name crosses the wire EXACTLY as typed — web must never
        # pre-slugify or "clean up" the user's input; coord rejects rather
        # than mangles, and pre-mangling here would hide that.
        assert call.kwargs["json"] == {"display_name": "My Pizzeria"}
        # `forward_bearer=True` means a headers dict is built even though no
        # tenant was resolved (there is none yet — this call creates one).
        assert call.kwargs.get("headers") is not None

    def test_coord_409_slug_taken_propagates_as_409(self, client: TestClient):
        """A name collision must reach the browser as 409, not 500.

        `_proxy_coord_post` re-raises coord's status verbatim; this pins that
        behaviour for the one status the create dialog has distinct copy for.
        """
        mock_resp = _mock_response(
            status_code=409, text='{"error":"slug_taken","slug":"my-pizzeria"}'
        )
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/tenants", json={"display_name": "My Pizzeria"}
            )

        assert resp.status_code == 409
        # coord's own body survives the hop, so the frontend can read the
        # machine-readable code rather than guess from the status.
        assert "slug_taken" in resp.json()["detail"]

    def test_coord_400_invalid_name_propagates_as_400(self, client: TestClient):
        mock_resp = _mock_response(
            status_code=400, text='{"error":"invalid_name","reason":"empty_slug"}'
        )
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = client.post(f"{API_PREFIX}/tenants", json={"display_name": "..."})

        assert resp.status_code == 400
        assert "invalid_name" in resp.json()["detail"]

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
            _configure_mock_client(MockClient, instance)
            resp = client.post(f"{API_PREFIX}/tenants", json={"display_name": "X"})
        assert resp.status_code == 502

    def test_empty_name_is_rejected_before_coord(self, client: TestClient):
        """An empty name never reaches coord — `min_length=1` on the model.

        This is a courtesy, not the security control: coord still validates,
        denylists and caps. It exists so the obvious no-op does not spend a
        round-trip.
        """
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = client.post(f"{API_PREFIX}/tenants", json={"display_name": ""})
        assert resp.status_code == 422
        instance.post.assert_not_awaited()
