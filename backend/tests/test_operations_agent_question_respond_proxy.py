"""The agent-question respond proxy gates DECISION-EFFECT rows on tenant admin.

Plan ``2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy``.
A row whose ``effect_kind`` is ``gate`` or ``proposal`` mirrors a decision
another table owns, and coord routes its answer through that effect's core —
clearing an ``operator_approval`` gate or applying a policy edit. The direct
doors for those acts (``/gates/{id}/approve``,
``/coord/prompt-document-proposals/{id}/approve``) require
``require_coord_tenant_admin``; ``/agent-questions/{id}/respond`` must not be a
way around them.

Pinned here:

* a non-admin is REFUSED on a gate-effect row, and nothing is POSTed to coord;
* an admin is allowed, and the recorded ``responded_by_operator`` is the
  AUTHENTICATED user, not the client-supplied value;
* an ordinary (``'none'`` / absent) row is unchanged for a non-admin — the body
  is forwarded verbatim, including its own ``responded_by_operator``;
* an unreadable row fails CLOSED (nothing POSTed), and a 404 stays a 404.

Same harness as ``test_operations_prompt_document_proposals_proxy.py``: a bare
FastAPI app and a mocked ``httpx.AsyncClient``. ``require_coord_tenant_admin``
is deliberately NOT overridden — the real check runs against a patched
``get_coord_identity``, so these tests exercise its actual semantics.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TENANT = UUID("11111111-1111-1111-1111-111111111111")
USER_ID = UUID("99999999-9999-9999-9999-999999999999")
USER_EMAIL = "real-operator@example.com"
QID = "00000000-0000-0000-0000-00000000e001"
RESPOND = f"/api/v1/operations/agent-questions/{QID}/respond"


def _identity(*, admin: bool):
    from app.services.coord_identity import CoordIdentity, CoordTenant

    roles = ("admin",) if admin else ("developer",)
    return CoordIdentity(
        operator_id=USER_ID,
        home_tenant_id=TENANT,
        email=USER_EMAIL,
        roles=roles,
        tenants=(CoordTenant(tenant_id=TENANT, slug="t", roles=roles),),
        is_admin=admin,
    )


def _client() -> TestClient:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    app = FastAPI()
    user = MagicMock()
    user.id = USER_ID
    user.email = USER_EMAIL
    user.is_active = True
    user.is_superuser = False
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[get_tenant_id] = lambda: TENANT
    app.include_router(operations_router, prefix="/api/v1/operations")
    return TestClient(app, raise_server_exceptions=False)


def _resp(status: int = 200, json_data=None) -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json.return_value = json_data
    r.text = str(json_data) if json_data is not None else ""
    return r


def _row(**extra) -> dict:
    return {"question_id": QID, "question": "Approve phase 2?", **extra}


GATE_ROW = _row(
    effect_kind="gate",
    effect_ref={"id": "gate-7", "gate_id": "gate-7"},
    options=["met", "not_met"],
)
PROPOSAL_ROW = _row(
    effect_kind="proposal",
    effect_ref={"id": "p-1", "proposal_id": "p-1"},
    options=["approve", "reject"],
)


def _run(row_response: MagicMock, body: dict, *, admin: bool):
    """POST the respond route with coord's GET answering ``row_response``."""
    from app.api.v1.endpoints import operations

    with (
        patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient,
        patch.object(
            operations,
            "get_coord_identity",
            new=AsyncMock(return_value=_identity(admin=admin)),
        ),
    ):
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance
        instance.get.return_value = row_response
        instance.post.return_value = _resp(json_data={"ok": True})
        resp = _client().post(RESPOND, json=body)
    return resp, instance


@pytest.mark.parametrize("row", [GATE_ROW, PROPOSAL_ROW], ids=["gate", "proposal"])
def test_non_admin_is_refused_on_an_effect_row(row):
    resp, instance = _run(
        _resp(json_data=row),
        {"response": "met", "responded_by_operator": "dev@example.com"},
        admin=False,
    )
    assert resp.status_code == 403
    assert "not_coord_tenant_admin" in resp.text
    # The question was read, and nothing reached coord's respond route.
    assert instance.get.call_args.args[0].endswith(f"/coord/agent-questions/{QID}")
    instance.post.assert_not_called()


def test_admin_is_allowed_and_identity_comes_from_the_auth_user():
    resp, instance = _run(
        _resp(json_data=GATE_ROW),
        {"response": "met", "responded_by_operator": "spoofed@example.com"},
        admin=True,
    )
    assert resp.status_code == 200, resp.text
    instance.post.assert_called_once()
    url = instance.post.call_args.args[0]
    assert url.endswith(f"/coord/agent-questions/{QID}/respond")
    assert instance.post.call_args.kwargs["json"] == {
        "response": "met",
        "responded_by_operator": USER_EMAIL,
    }


def test_admin_identity_is_stamped_even_when_the_body_omits_it():
    resp, instance = _run(
        _resp(json_data=PROPOSAL_ROW), {"response": "approve"}, admin=True
    )
    assert resp.status_code == 200, resp.text
    assert instance.post.call_args.kwargs["json"]["responded_by_operator"] == USER_EMAIL


@pytest.mark.parametrize(
    "row",
    [
        _row(effect_kind="none", effect_ref=None),
        _row(),  # an older coord that omits the columns
        _row(effect_kind=None),
    ],
    ids=["none", "absent", "null"],
)
def test_an_ordinary_row_is_unchanged_for_a_non_admin(row):
    body = {"response": "pin it", "responded_by_operator": "dev@example.com"}
    resp, instance = _run(_resp(json_data=row), body, admin=False)
    assert resp.status_code == 200, resp.text
    # Forwarded verbatim — the body's own attribution is kept.
    assert instance.post.call_args.kwargs["json"] == body


@pytest.mark.parametrize(
    "row_response",
    [
        _resp(status=500, json_data={"error": "PG unavailable"}),
        _resp(json_data=["not", "an", "object"]),
        _resp(json_data=_row(effect_kind=7)),
    ],
    ids=["coord-500", "non-object", "non-string-kind"],
)
def test_an_unreadable_row_fails_closed(row_response):
    resp, instance = _run(
        row_response, {"response": "met", "responded_by_operator": "x"}, admin=True
    )
    assert resp.status_code == 503
    assert "agent_question_unreadable" in resp.text
    instance.post.assert_not_called()


def test_coord_unreachable_fails_closed():
    from app.api.v1.endpoints import operations

    with (
        patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient,
        patch.object(
            operations,
            "get_coord_identity",
            new=AsyncMock(return_value=_identity(admin=True)),
        ),
    ):
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance
        instance.get.side_effect = httpx.ConnectError("down")
        resp = _client().post(RESPOND, json={"response": "met"})
    assert resp.status_code == 503
    instance.post.assert_not_called()


def test_a_missing_question_is_a_404_and_nothing_is_posted():
    resp, instance = _run(
        _resp(status=404, json_data={"error": "question not found"}),
        {"response": "met"},
        admin=True,
    )
    assert resp.status_code == 404
    instance.post.assert_not_called()
