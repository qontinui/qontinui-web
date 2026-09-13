"""The tenant ``auto_fix_pr`` dial through the ``/operations/pr-merge/settings`` proxy.

Plan ``2026-09-12-pr-fixer-spawns-default-on-bounded-and-coordinated-with-the-author``
Phase 4b. The web backend authors no logic for this dial: coord owns the
``PatchTenantSettings.auto_fix_pr`` write and the resolved read. What the web
side owns is the transport, and the one property that can silently break the
off-switch lives there:

**All three tenant values must reach coord distinguishably.** ``null`` means
"clear the override, follow the default ON"; ``false`` means "off". A proxy
that dropped ``None`` keys, or coerced a falsy value, would turn an operator's
explicit OFF into "leave unchanged" — the switch would read back as saved and
spawn anyway. So each value is asserted on the exact JSON coord receives, and
the resolved read (``auto_fix_pr_tenant`` / ``auto_fix_pr`` /
``auto_fix_pr_source``) is asserted to come back unaltered, ``unknown`` included.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API = "/api/v1/operations/pr-merge/settings"


def _app() -> FastAPI:
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    app = FastAPI()
    tenant = uuid4()
    app.dependency_overrides[get_tenant_id] = lambda: tenant
    app.dependency_overrides[require_coord_tenant_admin] = lambda: tenant
    app.include_router(operations_router, prefix="/api/v1/operations")
    return app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_app())


def _response(json_data: object, status_code: int = 200) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data)
    return resp


def _mock_client(MockClient: MagicMock) -> AsyncMock:
    instance = AsyncMock()
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = instance
    return instance


def _profile(tenant: bool | None, effective: bool, source: str) -> dict:
    return {
        "tenant_id": "t",
        "profile": {
            "auto_fix_pr_tenant": tenant,
            "auto_fix_pr": effective,
            "auto_fix_pr_source": source,
        },
    }


@pytest.mark.parametrize(
    ("value", "coord_reply"),
    [
        (None, _profile(None, True, "default")),
        (True, _profile(True, True, "tenant")),
        (False, _profile(False, False, "tenant")),
    ],
)
def test_patch_forwards_each_tenant_value_verbatim(
    client: TestClient, value: bool | None, coord_reply: dict
) -> None:
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        instance = _mock_client(MockClient)
        instance.patch.return_value = _response(coord_reply)

        resp = client.patch(API, json={"auto_fix_pr": value})

    assert resp.status_code == 200
    assert resp.json() == coord_reply
    instance.patch.assert_called_once()
    assert instance.patch.call_args.args[0].endswith("/pr-merge/settings")
    sent = instance.patch.call_args.kwargs["json"]
    assert "auto_fix_pr" in sent, (
        "a null must be SENT (clear), never dropped (unchanged)"
    )
    assert sent["auto_fix_pr"] is value


@pytest.mark.parametrize("source", ["default", "tenant", "repo", "unknown"])
def test_get_returns_the_resolved_dial_unaltered(
    client: TestClient, source: str
) -> None:
    reply = _profile(None if source == "default" else True, source != "unknown", source)
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        instance = _mock_client(MockClient)
        instance.get.return_value = _response(reply)

        resp = client.get(API)

    assert resp.status_code == 200
    assert resp.json() == reply


def test_coord_refusal_surfaces_rather_than_reading_as_saved(
    client: TestClient,
) -> None:
    """A coord build without the field 400s the PATCH; the operator must see it."""
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        instance = _mock_client(MockClient)
        instance.patch.return_value = _response(
            {"error": "unknown field `auto_fix_pr`"}, status_code=400
        )

        resp = client.patch(API, json={"auto_fix_pr": False})

    assert resp.status_code == 400
