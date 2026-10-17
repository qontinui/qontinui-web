"""``POST /admin/coord/overlord/labels`` — operator label write (Phase 2b).

Plan ``2026-10-01-overlord-session-supervisor-classifies-stops-and-absorbs-
avoidable-escalations``. Pins: operator-only access, request validation, and the
forwarding shape to coord (service token + ``X-Qontinui-User-Id``, no
``label_source``, ``supersedes`` = the chain's newest row id, one retry on 409).
Only the coord service account and ``httpx.AsyncClient`` are replaced.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

_USER = UUID("44444444-4444-4444-4444-444444444444")
_IID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
_ROOT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
_NEWER = "cccccccc-cccc-cccc-cccc-cccccccccccc"
_URL = "/api/v1/admin/coord/overlord/labels"
_HEADERS = {"Authorization": "Bearer service-token", "X-Qontinui-User-Id": str(_USER)}


def _resp(status: int, body: Any) -> MagicMock:
    import json

    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json.return_value = body
    r.text = json.dumps(body)
    return r


def _page(*rows: tuple[str, str], truncated: bool = False) -> MagicMock:
    return _resp(
        200,
        {
            "ok": True,
            "interventions": [
                {"latest": {"id": rid, "intervention_id": iid}} for iid, rid in rows
            ],
            "truncated": truncated,
        },
    )


def _client(*, operator: bool = True) -> TestClient:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.overlord_labels import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/admin/coord/overlord")
    app.dependency_overrides[get_current_active_user_async] = lambda: MagicMock(
        id=_USER
    )

    def _gate() -> UUID:
        if not operator:
            raise HTTPException(status_code=403, detail="not_coord_tenant_admin")
        return UUID("11111111-1111-1111-1111-111111111111")

    app.dependency_overrides[require_coord_tenant_admin] = _gate
    return TestClient(app)


def _drive(
    body: dict[str, Any],
    *,
    gets: list[MagicMock],
    posts: list[MagicMock] | None = None,
    operator: bool = True,
) -> tuple[httpx.Response, AsyncMock]:
    instance = AsyncMock()
    instance.get.side_effect = gets
    instance.post.side_effect = posts or []
    ctor = MagicMock()
    ctor.return_value.__aenter__.return_value = instance
    sa = MagicMock()
    sa._headers = AsyncMock(return_value=dict(_HEADERS))
    with (
        patch("app.api.v1.endpoints.overlord_labels.httpx.AsyncClient", ctor),
        patch("app.api.v1.endpoints.overlord_labels.coord_service_account", sa),
    ):
        resp = _client(operator=operator).post(_URL, json=body)
    return resp, instance


_OK_BODY = {"intervention_id": _IID, "label_kind": "class", "operator_label": "B"}
_ROW = {"id": "dddddddd-dddd-dddd-dddd-dddddddddddd", "operator_label": "B"}


def test_operator_label_forwards_to_coord_as_operator_page_write() -> None:
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page(("other", "zzz"), (_IID, _ROOT))],
        posts=[_resp(201, {"ok": True, "recorded": True, "intervention": _ROW})],
    )
    assert resp.status_code == 200
    assert resp.json() == _ROW
    args, kwargs = inst.post.call_args
    assert args[0].endswith("/coord/overlord/interventions")
    assert kwargs["json"] == {
        "intervention_id": _IID,
        "supersedes": _ROOT,
        "label_kind": "class",
        "operator_label": "B",
    }
    assert "label_source" not in kwargs["json"]
    assert kwargs["headers"]["X-Qontinui-User-Id"] == str(_USER)
    assert kwargs["headers"]["Authorization"] == "Bearer service-token"


def test_false_finish_without_class_omits_operator_label() -> None:
    resp, inst = _drive(
        {"intervention_id": _IID, "label_kind": "false_finish"},
        gets=[_page((_IID, _ROOT))],
        posts=[_resp(201, {"intervention": _ROW})],
    )
    assert resp.status_code == 200
    assert inst.post.call_args.kwargs["json"] == {
        "intervention_id": _IID,
        "supersedes": _ROOT,
        "label_kind": "false_finish",
    }


def test_newest_row_is_found_on_a_later_page() -> None:
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page(("other", "zzz"), truncated=True), _page((_IID, _ROOT))],
        posts=[_resp(201, {"intervention": _ROW})],
    )
    assert resp.status_code == 200
    assert inst.get.call_args_list[1].kwargs["params"]["offset"] == 1


def test_unknown_intervention_is_a_typed_404() -> None:
    resp, inst = _drive(_OK_BODY, gets=[_page(("other", "zzz"))])
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "intervention_not_found"
    inst.post.assert_not_called()


def test_409_supersedes_not_latest_retries_once_after_reread() -> None:
    conflict = _resp(409, {"error": "supersedes_not_latest", "latest_id": _NEWER})
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page((_IID, _ROOT)), _page((_IID, _NEWER))],
        posts=[conflict, _resp(201, {"intervention": _ROW})],
    )
    assert resp.status_code == 200
    assert [c.kwargs["json"]["supersedes"] for c in inst.post.call_args_list] == [
        _ROOT,
        _NEWER,
    ]


def test_second_409_is_passed_through_not_retried_again() -> None:
    conflict = _resp(409, {"error": "supersedes_not_latest"})
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page((_IID, _ROOT)), _page((_IID, _NEWER))],
        posts=[conflict, conflict],
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "supersedes_not_latest"
    assert inst.post.call_count == 2


def test_coord_422_passes_through_with_its_body() -> None:
    body = {"error": "invalid_overlord_intervention_field", "field": "operator_label"}
    resp, _ = _drive(_OK_BODY, gets=[_page((_IID, _ROOT))], posts=[_resp(422, body)])
    assert resp.status_code == 422
    assert resp.json()["detail"] == body


def test_coord_5xx_is_a_502() -> None:
    resp, _ = _drive(
        _OK_BODY,
        gets=[_page((_IID, _ROOT))],
        posts=[_resp(500, {"error": "boom"})],
    )
    assert resp.status_code == 502


def test_non_operator_is_refused_before_any_coord_call() -> None:
    resp, inst = _drive(_OK_BODY, gets=[], operator=False)
    assert resp.status_code == 403
    inst.get.assert_not_called()
    inst.post.assert_not_called()


def test_unauthenticated_request_is_refused() -> None:
    """No dependency override: a request with no operator session is refused."""
    from app.api.v1.endpoints.overlord_labels import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/admin/coord/overlord")
    with patch("app.api.v1.endpoints.overlord_labels.httpx.AsyncClient") as ctor:
        resp = TestClient(app).post(_URL, json=_OK_BODY)
    assert resp.status_code in (401, 403)
    ctor.assert_not_called()


@pytest.mark.parametrize(
    "body",
    [
        {"intervention_id": _IID, "label_kind": "false_finish", "operator_label": "E"},
        {"intervention_id": _IID, "label_kind": "class"},
        {**_OK_BODY, "label_source": "operator_page"},
        {**_OK_BODY, "operator_label": "C"},
        {**_OK_BODY, "label_kind": "other"},
        {**_OK_BODY, "intervention_id": "not-a-uuid"},
        {"label_kind": "class", "operator_label": "A"},
    ],
)
def test_invalid_requests_are_422_and_never_reach_coord(body: dict[str, Any]) -> None:
    resp, inst = _drive(body, gets=[])
    assert resp.status_code == 422
    inst.get.assert_not_called()
    inst.post.assert_not_called()


@pytest.mark.parametrize(
    "body",
    [
        {"intervention_id": _IID, "label_kind": "false_finish", "operator_label": "A"},
        {"intervention_id": _IID, "label_kind": "false_finish", "operator_label": "B"},
        {"intervention_id": _IID, "label_kind": "class", "operator_label": "E"},
    ],
)
def test_valid_label_combinations_are_accepted(body: dict[str, Any]) -> None:
    resp, _ = _drive(
        body, gets=[_page((_IID, _ROOT))], posts=[_resp(201, {"intervention": _ROW})]
    )
    assert resp.status_code == 200
