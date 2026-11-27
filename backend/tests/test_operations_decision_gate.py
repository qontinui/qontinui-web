"""Tests for ``POST /api/v1/operations/gates/decision`` (Overview plan Phase 8).

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord``. The
proxy registers a decision gate (``operator_approval`` anchored on
``(work_unit_id, phase_name)``) through coord's existing operator route
``POST /coord/gates/register``, after resolving the slug to the unit id with
``GET /coord/work-units/{slug}``.

* derived-only: exactly one coord read and one coord register write, nothing
  else; the verdict stays on the existing approve / reject / reopen routes.
* unknown: the proxy only ever emits the allowlisted ``operator_approval`` kind
  and never a class the Overview hides (``security-surface`` / ``ops-confirm``);
  a client-supplied ``gate_class`` is a 422, not a silent drop.
* tenant: another tenant's unit is refused by coord (404 on the slug read, or
  ``WorkUnitNotInTenant`` on register) and that error reaches the caller.

Mocked ``httpx.AsyncClient`` pattern of ``test_operations_ci_status_notify_proxy``.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

DECISION_PATH = "/api/v1/operations/gates/decision"
UNIT_ID = "11111111-2222-3333-4444-555555555555"
GATE_ID = "77777777-7777-7777-7777-777777777777"
SLUG = "2026-11-25-overview-timeline-and-milestones-derive-from-coord"
HIDDEN_CLASSES = {"security-surface", "ops-confirm"}


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    resolved = uuid4()
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: resolved
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: resolved
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure(MockClient, instance):
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = instance


def _payload(**over):
    body = {
        "work_unit_slug": SLUG,
        "phase_name": "Customer showing accepted",
        "prompt": "Has the customer accepted the showing?",
    }
    body.update(over)
    return body


def _post(client: TestClient, payload: dict, *, get_resp=None, post_resp=None):
    get_resp = get_resp or _mock_response(
        json_data={"work_unit": {"id": UNIT_ID, "slug": SLUG}}
    )
    post_resp = post_resp or _mock_response(
        201, {"gate_id": GATE_ID, "warnings": [], "initial_verdict": "open"}
    )
    with _patch_httpx() as MockClient:
        instance = AsyncMock()
        instance.get.return_value = get_resp
        instance.post.return_value = post_resp
        _configure(MockClient, instance)
        resp = client.post(DECISION_PATH, json=payload)
    return resp, instance


class TestRegisterDecisionGate:
    def test_register_body_shape(self, auth_client: TestClient):
        resp, inst = _post(auth_client, _payload())
        assert resp.status_code == 200, resp.text
        assert resp.json()["gate_id"] == GATE_ID

        # derived-only: one read (the slug) and one write (the register).
        assert inst.get.call_count == 1
        assert inst.post.call_count == 1
        assert inst.get.call_args.args[0].endswith(f"/coord/work-units/{SLUG}")
        assert inst.post.call_args.args[0].endswith("/coord/gates/register")

        body = inst.post.call_args.kwargs["json"]
        assert body == {
            "work_unit_id": UNIT_ID,
            "phase_name": "Customer showing accepted",
            "predicate": {
                "kind": "operator_approval",
                "prompt": "Has the customer accepted the showing?",
            },
            "clearance_audience": "operator",
            "gate_class": "routine-review",
        }

    def test_audience_comes_from_the_form(self, auth_client: TestClient):
        _, inst = _post(auth_client, _payload(clearance_audience="agent"))
        assert inst.post.call_args.kwargs["json"]["clearance_audience"] == "agent"

    def test_bad_audience_is_422(self, auth_client: TestClient):
        resp, inst = _post(auth_client, _payload(clearance_audience="everyone"))
        assert resp.status_code == 422
        assert inst.get.call_count == 0 and inst.post.call_count == 0

    def test_values_are_stripped_and_blank_refused(self, auth_client: TestClient):
        _, inst = _post(auth_client, _payload(phase_name="  Phase 8  "))
        assert inst.post.call_args.kwargs["json"]["phase_name"] == "Phase 8"
        resp, inst2 = _post(auth_client, _payload(prompt="   "))
        assert resp.status_code == 422
        assert inst2.post.call_count == 0

    def test_slug_cannot_traverse_the_coord_path(self, auth_client: TestClient):
        resp, inst = _post(auth_client, _payload(work_unit_slug="../gates/x"))
        assert resp.status_code == 422
        assert inst.get.call_count == 0


class TestOnlyAllowlistedShapesAreEmitted:
    """Unknown case: nothing the Overview would hide can be registered here."""

    @pytest.mark.parametrize("cls", sorted(HIDDEN_CLASSES | {"routine-review"}))
    def test_client_gate_class_is_refused(self, auth_client: TestClient, cls: str):
        resp, inst = _post(auth_client, _payload(gate_class=cls))
        assert resp.status_code == 422
        assert inst.post.call_count == 0

    def test_predicate_kind_and_class_are_fixed(self, auth_client: TestClient):
        _, inst = _post(auth_client, _payload())
        body = inst.post.call_args.kwargs["json"]
        assert body["predicate"]["kind"] == "operator_approval"
        assert body["gate_class"] not in HIDDEN_CLASSES
        # Coord derives security-surface when no class is supplied, so the
        # class must be present rather than omitted.
        assert "gate_class" in body


class TestTenantRefusal:
    def test_unknown_slug_in_this_tenant_never_registers(self, auth_client: TestClient):
        resp, inst = _post(
            auth_client,
            _payload(),
            get_resp=_mock_response(404, {"error": "work_unit_not_found"}),
        )
        assert resp.status_code == 404
        assert inst.post.call_count == 0

    def test_coord_work_unit_not_in_tenant_reaches_the_caller(
        self, auth_client: TestClient
    ):
        resp, _ = _post(
            auth_client,
            _payload(),
            post_resp=_mock_response(
                403,
                {"error": "work_unit_not_in_tenant", "work_unit_id": UNIT_ID},
            ),
        )
        assert resp.status_code == 403
        assert "work_unit_not_in_tenant" in resp.text

    def test_a_2xx_without_a_unit_id_is_not_guessed(self, auth_client: TestClient):
        resp, inst = _post(
            auth_client,
            _payload(),
            get_resp=_mock_response(json_data={"work_unit": {}}),
        )
        assert resp.status_code == 502
        assert inst.post.call_count == 0
