"""Tests for the gate-doctor sweep proxy (``POST /admin-dev/gates/doctor/sweep``).

Plan ``2026-07-21-gates-search-gateid-and-sweep-action`` Phase 1: an operator
console button fires coord's ``land_backfill`` gate-doctor sweep. The web route
is a bearer-forwarding proxy — ``require_admin`` (operator-only, mirroring the
sibling ``release-verdict`` mutation) + best-effort bearer capture, forwarding
the operator's Cognito bearer to coord so coord's admin-role
``operator_admin_writes`` router authorizes on the operator's real identity.

Testing pattern mirrors ``test_operations_coord_dashboard_proxy.py``: the real
``_proxy_coord_post`` runs (it is NOT patched) and
``app.api.v1.endpoints.operations.httpx.AsyncClient`` is patched to stub coord,
so the test inspects exactly what reaches coord — the forwarded bearer header,
the URL, and the JSON body — and asserts coord's ``BackfillReport`` is returned
verbatim. The auth gate (``require_admin``) is overridden with an admin user;
the bearer-capture dependency is overridden with one that sets the
request-scoped ContextVar ``_proxy_coord_post`` reads (so the caller's
``Authorization`` header is genuinely forwarded end-to-end).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

# The operator bearer the test sends; asserted to reach coord verbatim as
# ``Authorization: Bearer <token>`` on the forwarded call.
_OPERATOR_BEARER = "operator-cognito-token-abc123"


def _build_test_app() -> FastAPI:
    """Minimal app mounting the admin-dev router with the sweep route's deps
    overridden: ``require_admin`` → an admin user, and the bearer-capture
    dependency → one that sets the ContextVar from the request so the real
    ``_proxy_coord_post`` forwards the caller bearer."""
    from app.api.admin_deps import require_admin
    from app.api.v1.endpoints.admin_dev import _capture_bearer_best_effort
    from app.api.v1.endpoints.admin_dev import router as admin_dev_router
    from app.api.v1.endpoints.operations import (
        _caller_bearer,
        _extract_caller_token,
    )

    app = FastAPI()
    admin_user = MagicMock()
    admin_user.is_superuser = True
    app.dependency_overrides[require_admin] = lambda: admin_user

    async def _capture(request: Request) -> str | None:
        # Mirror the real dependency's unconditional bearer capture (without
        # the coord identity round-trip): stash the caller's bearer in the
        # request-scoped ContextVar that ``_tenant_headers`` forwards. MUST be
        # async (like the real dependency) so the ContextVar set here shares
        # the endpoint's context — a sync dependency runs in a threadpool copy
        # and the set would not propagate to ``_proxy_coord_post``.
        _caller_bearer.set(_extract_caller_token(request))
        return "tenant-key"

    app.dependency_overrides[_capture_bearer_best_effort] = _capture
    app.include_router(admin_dev_router, prefix="/api/v1")
    return app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _backfill_report() -> dict:
    """A coord ``BackfillReport`` (contract: ``gate_doctor.rs`` origin/main)."""
    return {
        "dry_run": True,
        "examined": 2,
        "backfilled": 1,
        "left_failed": 1,
        "entries": [
            {
                "gate_id": "2aeadf7c-0000-0000-0000-000000000000",
                "repo": "qontinui/qontinui-web",
                "pr_number": 793,
                "action": "backfilled",
            },
            {
                "gate_id": "8a1ca893-0000-0000-0000-000000000000",
                "repo": "qontinui/qontinui-coord",
                "pr_number": 1105,
                "action": "left_failed",
            },
        ],
    }


def test_sweep_forwards_bearer_and_body_and_returns_report_verbatim(
    client: TestClient,
):
    """(a) the caller bearer reaches coord, (b) ``mode=land_backfill`` + the
    dry-run body reach coord's ``/coord/gates/doctor/sweep``, (c) coord's
    ``BackfillReport`` (incl. ``dry_run:true``) is returned verbatim."""
    report = _backfill_report()
    mock_resp = _mock_response(json_data=report)
    with _patch_httpx() as MockClient:
        instance = AsyncMock()
        instance.post.return_value = mock_resp
        _configure_mock_client(MockClient, instance)
        resp = client.post(
            "/api/v1/admin-dev/gates/doctor/sweep",
            json={"dry_run": True, "mode": "land_backfill"},
            headers={"Authorization": f"Bearer {_OPERATOR_BEARER}"},
        )

    assert resp.status_code == 200
    # (c) coord's report is returned verbatim (including dry_run:true).
    assert resp.json() == report
    assert resp.json()["dry_run"] is True

    # (b) the sweep hit coord's route with the pass-through body.
    called_url = instance.post.call_args.args[0]
    assert called_url.endswith("/coord/gates/doctor/sweep")
    called_body = instance.post.call_args.kwargs.get("json", {})
    assert called_body == {"dry_run": True, "mode": "land_backfill"}

    # (a) the operator's bearer is forwarded so coord authorizes on it.
    headers = instance.post.call_args.kwargs.get("headers")
    assert headers is not None, "sweep must forward a headers dict"
    assert headers.get("Authorization") == f"Bearer {_OPERATOR_BEARER}"


def test_sweep_defaults_are_coord_defaults(client: TestClient):
    """An empty body mirrors coord's defaults: dry-run-first + land_backfill."""
    report = _backfill_report()
    mock_resp = _mock_response(json_data=report)
    with _patch_httpx() as MockClient:
        instance = AsyncMock()
        instance.post.return_value = mock_resp
        _configure_mock_client(MockClient, instance)
        resp = client.post(
            "/api/v1/admin-dev/gates/doctor/sweep",
            json={},
            headers={"Authorization": f"Bearer {_OPERATOR_BEARER}"},
        )
    assert resp.status_code == 200
    called_body = instance.post.call_args.kwargs.get("json", {})
    # Dry-run-first is the guardrail; land_backfill is the default mode.
    assert called_body == {"dry_run": True, "mode": "land_backfill"}


def test_sweep_passes_dry_run_false_through(client: TestClient):
    """The explicit live-mutation second click forwards ``dry_run:false``."""
    live_report = {**_backfill_report(), "dry_run": False}
    mock_resp = _mock_response(json_data=live_report)
    with _patch_httpx() as MockClient:
        instance = AsyncMock()
        instance.post.return_value = mock_resp
        _configure_mock_client(MockClient, instance)
        resp = client.post(
            "/api/v1/admin-dev/gates/doctor/sweep",
            json={"dry_run": False, "mode": "land_backfill"},
            headers={"Authorization": f"Bearer {_OPERATOR_BEARER}"},
        )
    assert resp.status_code == 200
    assert resp.json()["dry_run"] is False
    called_body = instance.post.call_args.kwargs.get("json", {})
    assert called_body == {"dry_run": False, "mode": "land_backfill"}


def test_sweep_surfaces_coord_403_verbatim(client: TestClient):
    """A coord 403 (bearer not accepted / non-admin) is surfaced, NOT swallowed
    into a degraded envelope — the design decision's honesty requirement."""
    mock_resp = _mock_response(status_code=403, text="non_interactive_write_forbidden")
    with _patch_httpx() as MockClient:
        instance = AsyncMock()
        instance.post.return_value = mock_resp
        _configure_mock_client(MockClient, instance)
        resp = client.post(
            "/api/v1/admin-dev/gates/doctor/sweep",
            json={"dry_run": False, "mode": "land_backfill"},
            headers={"Authorization": f"Bearer {_OPERATOR_BEARER}"},
        )
    assert resp.status_code == 403
    assert "non_interactive_write_forbidden" in resp.json()["detail"]


def test_sweep_surfaces_coord_400_for_unknown_mode(client: TestClient):
    """An unknown mode is coord's 400 to raise (web passes mode through)."""
    mock_resp = _mock_response(status_code=400, text="unknown mode")
    with _patch_httpx() as MockClient:
        instance = AsyncMock()
        instance.post.return_value = mock_resp
        _configure_mock_client(MockClient, instance)
        resp = client.post(
            "/api/v1/admin-dev/gates/doctor/sweep",
            json={"dry_run": True, "mode": "not_a_real_mode"},
            headers={"Authorization": f"Bearer {_OPERATOR_BEARER}"},
        )
    assert resp.status_code == 400
    # web forwarded the mode verbatim rather than validating locally.
    called_body = instance.post.call_args.kwargs.get("json", {})
    assert called_body["mode"] == "not_a_real_mode"
