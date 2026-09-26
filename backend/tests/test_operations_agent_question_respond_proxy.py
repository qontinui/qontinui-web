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
* an unreadable row fails CLOSED (nothing POSTed): a coord 5xx, an unreachable
  coord, a non-JSON 2xx body or any other ``httpx`` transport error is a 503,
  while a coord 4xx (401 / 403 / 400 / 404) is re-raised unchanged;
* ``effect_kind`` ``clause`` and a kind this build does not recognise also
  require admin; a superuser passes; the admin check runs in the ACTIVE tenant;
* an ordinary row needs no web user at all (the user dependency is optional),
  while an effect row with no active user is a 403 ``inactive_or_unknown_user``
  (never 401 — the frontend reads that as session expiry);
* the row must POSITIVELY identify itself — a JSON object whose
  ``question_id`` equals the requested id; a wrapper body, ``{}`` or a
  different id is a 503 and nothing is POSTed;
* ``effect_kind`` matching is exact: ``""`` and ``"none"`` are ordinary,
  ``"NONE"`` and ``" none "`` require admin;
* ``question_id`` is a UUID — a malformed one is a 422 and reaches no coord.

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


OTHER_TENANT = UUID("22222222-2222-2222-2222-222222222222")

_ANON = object()  # sentinel: "no active web user on this request"


def _identity(*, admin: bool, other_tenant_roles: tuple[str, ...] | None = None):
    from app.services.coord_identity import CoordIdentity, CoordTenant

    roles = ("admin",) if admin else ("developer",)
    tenants = [CoordTenant(tenant_id=TENANT, slug="t", roles=roles)]
    if other_tenant_roles is not None:
        tenants.append(
            CoordTenant(tenant_id=OTHER_TENANT, slug="o", roles=other_tenant_roles)
        )
    return CoordIdentity(
        operator_id=USER_ID,
        home_tenant_id=TENANT,
        email=USER_EMAIL,
        roles=roles,
        tenants=tuple(tenants),
        is_admin=admin,
    )


def _client(*, superuser: bool = False, user=None) -> TestClient:
    from app.api.deps import current_active_user_optional
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    app = FastAPI()
    if user is None:
        user = MagicMock()
        user.id = USER_ID
        user.email = USER_EMAIL
        user.is_active = True
        user.is_superuser = superuser
    resolved = None if user is _ANON else user
    # The route resolves the web user OPTIONALLY. Only this dependency is
    # overridden: if the route still depended on the strict
    # ``get_current_active_user_async`` it would be resolved for real here.
    app.dependency_overrides[current_active_user_optional] = lambda: resolved
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


def _run(
    row_response: MagicMock | None,
    body: dict,
    *,
    admin: bool,
    get_side_effect: BaseException | None = None,
    identity=None,
    headers: dict[str, str] | None = None,
    client_kwargs: dict | None = None,
    path: str = RESPOND,
):
    """POST the respond route with coord's GET answering ``row_response``
    (or raising ``get_side_effect``)."""
    from app.api.v1.endpoints import operations

    with (
        patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient,
        patch.object(
            operations,
            "get_coord_identity",
            new=AsyncMock(return_value=identity or _identity(admin=admin)),
        ),
    ):
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance
        if get_side_effect is not None:
            instance.get.side_effect = get_side_effect
        else:
            instance.get.return_value = row_response
        instance.post.return_value = _resp(json_data={"ok": True})
        resp = _client(**(client_kwargs or {})).post(path, json=body, headers=headers)
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
        _resp(status=502, json_data={"error": "bad gateway"}),
        _resp(status=503, json_data={"error": "draining"}),
        _resp(json_data=["not", "an", "object"]),
        _resp(json_data=_row(effect_kind=7)),
        _resp(json_data={"question": _row(effect_kind="gate")}),
        _resp(json_data={}),
        _resp(
            json_data={
                **_row(effect_kind="none"),
                "question_id": "00000000-0000-0000-0000-00000000e002",
            }
        ),
        _resp(json_data={**_row(effect_kind="none"), "question_id": None}),
    ],
    ids=[
        "coord-500",
        "coord-502",
        "coord-503",
        "non-object",
        "non-string-kind",
        "wrapper-body",
        "empty-object",
        "mismatched-id",
        "null-id",
    ],
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


def test_the_row_id_is_compared_case_insensitively():
    row = {**_row(effect_kind="none"), "question_id": QID.upper()}
    resp, instance = _run(_resp(json_data=row), {"response": "ok"}, admin=False)
    assert resp.status_code == 200, resp.text
    instance.post.assert_called_once()


def test_a_coord_timeout_on_the_read_fails_closed_as_503():
    # _proxy_coord_get turns a timeout into CoordTransportUnavailable(504).
    resp, instance = _run(
        None,
        {"response": "met"},
        admin=True,
        get_side_effect=httpx.ReadTimeout("slow"),
    )
    assert resp.status_code == 503
    assert "agent_question_unreadable" in resp.text
    instance.post.assert_not_called()


@pytest.mark.parametrize("kind", ["", "none"], ids=["empty", "none"])
def test_empty_and_none_effect_kinds_are_ordinary(kind):
    body = {"response": "ok", "responded_by_operator": "dev@example.com"}
    resp, instance = _run(_resp(json_data=_row(effect_kind=kind)), body, admin=False)
    assert resp.status_code == 200, resp.text
    assert instance.post.call_args.kwargs["json"] == body


@pytest.mark.parametrize("kind", ["NONE", " none "], ids=["upper", "padded"])
def test_effect_kind_matching_is_exact_so_variants_require_admin(kind):
    row = _row(effect_kind=kind)
    resp, instance = _run(_resp(json_data=row), {"response": "ok"}, admin=False)
    assert resp.status_code == 403
    assert "not_coord_tenant_admin" in resp.text
    instance.post.assert_not_called()

    # ...and an admin passes, with the authenticated identity stamped.
    resp, instance = _run(_resp(json_data=row), {"response": "ok"}, admin=True)
    assert resp.status_code == 200, resp.text
    assert instance.post.call_args.kwargs["json"]["responded_by_operator"] == USER_EMAIL


def test_a_missing_question_is_a_404_and_nothing_is_posted():
    resp, instance = _run(
        _resp(status=404, json_data={"error": "question not found"}),
        {"response": "met"},
        admin=True,
    )
    assert resp.status_code == 404
    instance.post.assert_not_called()


@pytest.mark.parametrize(
    ("status", "detail"),
    [
        (401, "session expired"),
        (400, "malformed question id"),
        (403, "tenant_not_resolved"),
    ],
    ids=["401", "400", "403"],
)
def test_a_coord_4xx_on_the_read_passes_through_unchanged(status, detail):
    resp, instance = _run(
        _resp(status=status, json_data={"error": detail}),
        {"response": "met"},
        admin=True,
    )
    assert resp.status_code == status
    assert detail in resp.text
    assert "agent_question_unreadable" not in resp.text
    instance.post.assert_not_called()


def test_a_non_json_2xx_body_fails_closed_as_503():
    row = _resp(status=200)
    row.json.side_effect = ValueError("Expecting value: line 1 column 1")
    row.text = "<html>not json</html>"
    resp, instance = _run(row, {"response": "met"}, admin=True)
    assert resp.status_code == 503
    assert "agent_question_unreadable" in resp.text
    instance.post.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        httpx.RemoteProtocolError("peer closed connection"),
        httpx.ReadError("connection reset"),
    ],
    ids=["remote-protocol", "read-error"],
)
def test_an_untranslated_httpx_error_fails_closed_as_503(error):
    resp, instance = _run(None, {"response": "met"}, admin=True, get_side_effect=error)
    assert resp.status_code == 503
    assert "agent_question_unreadable" in resp.text
    instance.post.assert_not_called()


@pytest.mark.parametrize(
    "row",
    [
        _row(effect_kind="clause", effect_ref={"id": "c-1"}, options=["approve"]),
        _row(effect_kind="some_future_kind", effect_ref={"id": "x"}),
    ],
    ids=["clause", "unrecognised"],
)
def test_other_effect_kinds_also_require_admin(row):
    resp, instance = _run(_resp(json_data=row), {"response": "approve"}, admin=False)
    assert resp.status_code == 403
    assert "not_coord_tenant_admin" in resp.text
    instance.post.assert_not_called()


def test_a_superuser_passes_without_tenant_admin():
    resp, instance = _run(
        _resp(json_data=GATE_ROW),
        {"response": "met"},
        admin=False,
        client_kwargs={"superuser": True},
    )
    assert resp.status_code == 200, resp.text
    assert instance.post.call_args.kwargs["json"]["responded_by_operator"] == USER_EMAIL


def test_admin_is_checked_in_the_active_tenant_not_the_home_one():
    # Admin of the HOME tenant, only Developer of the one the switcher selects.
    identity = _identity(admin=True, other_tenant_roles=("developer",))
    resp, instance = _run(
        _resp(json_data=GATE_ROW),
        {"response": "met"},
        admin=True,
        identity=identity,
        headers={"X-Qontinui-Active-Tenant": str(OTHER_TENANT)},
    )
    assert resp.status_code == 403
    assert "not_coord_tenant_admin" in resp.text
    instance.post.assert_not_called()


def test_an_ordinary_row_needs_no_web_user():
    body = {"response": "pin it", "responded_by_operator": "dev@example.com"}
    resp, instance = _run(
        _resp(json_data=_row(effect_kind="none")),
        body,
        admin=False,
        client_kwargs={"user": _ANON},
    )
    assert resp.status_code == 200, resp.text
    assert instance.post.call_args.kwargs["json"] == body


def test_an_effect_row_without_a_web_user_is_a_403_not_a_401():
    # 401 would read as session expiry to the frontend httpClient.
    resp, instance = _run(
        _resp(json_data=GATE_ROW),
        {"response": "met"},
        admin=True,
        client_kwargs={"user": _ANON},
    )
    assert resp.status_code == 403
    assert "inactive_or_unknown_user" in resp.text
    instance.post.assert_not_called()


def test_a_malformed_question_id_is_a_422_and_reaches_no_coord():
    resp, instance = _run(
        _resp(json_data=GATE_ROW),
        {"response": "met"},
        admin=True,
        path="/api/v1/operations/agent-questions/not-a-uuid/respond",
    )
    assert resp.status_code == 422
    instance.get.assert_not_called()
    instance.post.assert_not_called()
