"""``POST /admin/coord/overlord/labels`` — operator label write (Phase 2b).

Plan ``2026-10-01-overlord-session-supervisor-classifies-stops-and-absorbs-
avoidable-escalations``. Pins: operator-only access, request validation, and the
forwarding shape to coord (service token + ``X-Qontinui-User-Id``, no
``label_source``, ``supersedes`` = the chain's newest row id, one retry on 409).
Only the coord service account and ``httpx.AsyncClient`` are replaced, and the
fake client answers in coord's real response shapes (see ``_row``).
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
_TENANT = "11111111-1111-1111-1111-111111111111"
# A chain's root row's id IS its intervention_id; each later row supersedes the
# one before it, and the newest row is the one a label must supersede.
_IID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
_NEWEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
_NEWER = "cccccccc-cccc-cccc-cccc-cccccccccccc"
_OTHER_IID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
_OTHER_NEWEST = "ffffffff-ffff-ffff-ffff-ffffffffffff"
_URL = "/api/v1/admin/coord/overlord/labels"
_HEADERS = {"Authorization": "Bearer service-token", "X-Qontinui-User-Id": str(_USER)}


def _resp(status: int, body: Any) -> MagicMock:
    import json

    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json.return_value = body
    r.text = json.dumps(body)
    return r


# Coord's real response shapes, from qontinui-coord@4db717a8
# crates/coord/src/overlord_interventions.rs. The Phase 2b coord half
# (qontinui-coord#3417, on coord main from 644421592) keeps them and only adds
# row columns web never reads:
#   - a row is `InterventionRow` (:904-930), serialized field for field;
#   - a list entry is `InterventionView` (:1330-1337), whose
#     `#[serde(flatten)] latest: InterventionRow` puts the chain's NEWEST row's
#     columns at the entry's top level, beside `history` (the chain, oldest
#     first), `history_len` and `history_truncated`. There is no `latest` key;
#   - a page is `list_core`'s envelope (:1522-1529).
def _row(row_id: str, iid: str, supersedes: str | None, **cols: Any) -> dict[str, Any]:
    return {
        "id": row_id,
        "intervention_id": iid,
        "supersedes": supersedes,
        "tenant_id": _TENANT,
        "session_id": None,
        "claude_code_session_id": None,
        "observed_at": "2026-10-28T09:00:00Z",
        "recorded_at": "2026-10-28T09:00:00Z",
        "stop_class": "B",
        "strike": None,
        "catalog_hits": [],
        "evidence": {},
        "inputs_unreadable": [],
        "verb": "escalate",
        "mode": "shadow",
        "message_id": None,
        "question_id": None,
        "touch_key": None,
        "outcome": None,
        "outcome_observed_at": None,
        "operator_label": None,
        "brief_version": None,
        "judge_model": None,
        "recorded_by_device_id": None,
        **cols,
    }


def _entry(iid: str, *successors: str) -> dict[str, Any]:
    """One chain as coord lists it: root row ``iid``, then ``successors``."""
    history: list[dict[str, Any]] = []
    prev: str | None = None
    for row_id in (iid, *successors):
        history.append(_row(row_id, iid, prev))
        prev = row_id
    return {
        **history[-1],
        "history": history,
        "history_len": len(history),
        "history_truncated": False,
    }


def _page(
    *chains: tuple[str, ...], truncated: bool = False, offset: int = 0
) -> MagicMock:
    """One list page; each chain is ``(intervention_id, *successor_row_ids)``.

    Coord applies ``limit`` as SQL ``LIMIT`` over one snapshot, so a truncated
    page is always full: its echoed ``limit`` is its entry count, as from a coord
    whose cap is below web's page size.
    """
    entries = [_entry(*chain) for chain in chains]
    return _resp(
        200,
        {
            "ok": True,
            "interventions": entries,
            "total_matching": offset + len(entries) + (1 if truncated else 0),
            "truncated": truncated,
            "limit": len(entries) if truncated else 200,
            "offset": offset,
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
        return UUID(_TENANT)

    app.dependency_overrides[require_coord_tenant_admin] = _gate
    return TestClient(app)


def _drive(
    body: dict[str, Any],
    *,
    gets: list[MagicMock | Exception],
    posts: list[MagicMock | Exception] | None = None,
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
# The appended row coord's 201 carries; the route passes it through unread. It
# is shaped like coord@4db717a8's row; that coord refuses this POST's
# `label_kind`, which the Phase 2b coord half (qontinui-coord#3417) adds.
_ROW = _row("dddddddd-dddd-dddd-dddd-dddddddddddd", _IID, _NEWEST, operator_label="B")
_OTHER = _entry(_OTHER_IID, _OTHER_NEWEST)


def test_operator_label_forwards_to_coord_as_operator_page_write() -> None:
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page((_OTHER_IID, _OTHER_NEWEST), (_IID, _NEWEST))],
        posts=[_resp(201, {"ok": True, "recorded": True, "intervention": _ROW})],
    )
    assert resp.status_code == 200
    assert resp.json() == _ROW
    args, kwargs = inst.post.call_args
    assert args[0].endswith("/coord/overlord/interventions")
    assert kwargs["json"] == {
        "intervention_id": _IID,
        "supersedes": _NEWEST,
        "label_kind": "class",
        "operator_label": "B",
    }
    assert "label_source" not in kwargs["json"]
    assert kwargs["headers"]["X-Qontinui-User-Id"] == str(_USER)
    assert kwargs["headers"]["Authorization"] == "Bearer service-token"
    assert kwargs["headers"]["X-Qontinui-Active-Tenant"] == _TENANT


def test_supersedes_is_the_newest_row_coord_flattens_into_the_entry() -> None:
    """Regression: web read a ``latest`` key coord never sends.

    So a lookup over coord's real page never matched, and answered 404. This is
    a three-row chain, so its newest row is neither the root (the entry's
    ``intervention_id``) nor the first ``history`` row: only the entry's own
    ``id`` is a correct ``supersedes``.
    """
    middle = "99999999-9999-9999-9999-999999999999"
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page((_OTHER_IID, _OTHER_NEWEST), (_IID, middle, _NEWEST))],
        posts=[_resp(201, {"ok": True, "recorded": True, "intervention": _ROW})],
    )
    assert resp.status_code == 200, resp.json()
    sent = inst.post.call_args.kwargs["json"]
    assert sent["intervention_id"] == _IID
    assert sent["supersedes"] == _NEWEST


def test_a_single_row_chain_is_superseded_at_its_root() -> None:
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page((_IID,))],
        posts=[_resp(201, {"intervention": _ROW})],
    )
    assert resp.status_code == 200, resp.json()
    assert inst.post.call_args.kwargs["json"]["supersedes"] == _IID


def test_false_finish_without_class_omits_operator_label() -> None:
    resp, inst = _drive(
        {"intervention_id": _IID, "label_kind": "false_finish"},
        gets=[_page((_IID, _NEWEST))],
        posts=[_resp(201, {"intervention": _ROW})],
    )
    assert resp.status_code == 200
    assert inst.post.call_args.kwargs["json"] == {
        "intervention_id": _IID,
        "supersedes": _NEWEST,
        "label_kind": "false_finish",
    }


def test_newest_row_is_found_on_a_later_page() -> None:
    resp, inst = _drive(
        _OK_BODY,
        gets=[
            _page((_OTHER_IID, _OTHER_NEWEST), truncated=True),
            _page((_IID, _NEWEST), offset=1),
        ],
        posts=[_resp(201, {"intervention": _ROW})],
    )
    assert resp.status_code == 200
    assert inst.get.call_args_list[1].kwargs["params"]["offset"] == 1


def test_unknown_intervention_is_a_typed_404() -> None:
    resp, inst = _drive(_OK_BODY, gets=[_page((_OTHER_IID, _OTHER_NEWEST))])
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "intervention_not_found"
    inst.post.assert_not_called()


@pytest.mark.parametrize(
    "body",
    [
        # The nested entry web used to read, which coord never served.
        {
            "interventions": [{"latest": {"id": _NEWEST, "intervention_id": _IID}}],
            "truncated": False,
        },
        {"interventions": [{"intervention_id": _IID}], "truncated": False},
        {"interventions": [{"id": None, "intervention_id": _IID}], "truncated": False},
        {"interventions": [{"id": 7, "intervention_id": _IID}], "truncated": False},
        {
            "interventions": [{"id": "not-a-uuid", "intervention_id": _IID}],
            "truncated": False,
        },
        {"interventions": ["not-an-entry"], "truncated": False},
        {"interventions": {}, "truncated": False},
        {"truncated": False},
        {"interventions": [_OTHER]},
        {"interventions": [_OTHER], "truncated": "false"},
        {"interventions": [], "truncated": True},
        [],
    ],
    ids=[
        "nested-latest-entry",
        "entry-without-id",
        "null-id",
        "non-uuid-int-id",
        "non-uuid-string-id",
        "entry-not-an-object",
        "interventions-not-a-list",
        "no-interventions-key",
        "no-truncated-flag",
        "non-boolean-truncated",
        "empty-page-claiming-more",
        "page-not-an-object",
    ],
)
def test_a_page_coord_did_not_shape_is_a_502_never_a_404(body: Any) -> None:
    # Reading a contract break as "no such intervention" is what hid the
    # `latest` defect; it must surface as coord's malformed page instead.
    resp, inst = _drive(_OK_BODY, gets=[_resp(200, body)])
    assert resp.status_code == 502
    assert resp.json()["detail"] == {"error": "coord_malformed_interventions_page"}
    inst.post.assert_not_called()


def test_an_undecodable_page_is_a_502_never_a_404() -> None:
    import json

    page = _resp(200, None)
    page.json.side_effect = json.JSONDecodeError("Expecting value", "<html>", 0)
    resp, inst = _drive(_OK_BODY, gets=[page])
    assert resp.status_code == 502
    assert resp.json()["detail"] == {"error": "coord_malformed_interventions_page"}
    inst.post.assert_not_called()


def test_an_empty_ledger_is_a_typed_404() -> None:
    # A well-formed empty answer rules the chain out: a 404, not a 502.
    resp, inst = _drive(_OK_BODY, gets=[_page()])
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "intervention_not_found"
    inst.post.assert_not_called()


def test_running_out_of_pages_is_not_reported_as_not_found() -> None:
    # Coord still says `truncated` when web's page bound runs out, so the chain
    # was never ruled out: an unfinished lookup, not a 404.
    from app.api.v1.endpoints.overlord_labels import _MAX_PAGES

    third = "12345678-1234-1234-1234-123456789abc"
    per_page = 2
    pages = [
        _page(
            (_OTHER_IID, _OTHER_NEWEST), (third,), truncated=True, offset=i * per_page
        )
        for i in range(_MAX_PAGES)
    ]
    resp, inst = _drive(_OK_BODY, gets=pages)
    assert resp.status_code == 502
    assert resp.json()["detail"] == {
        "error": "intervention_lookup_incomplete",
        "intervention_id": _IID,
        "chains_read": _MAX_PAGES * per_page,
    }
    assert inst.get.call_count == _MAX_PAGES
    assert inst.get.call_args.kwargs["params"]["offset"] == (_MAX_PAGES - 1) * per_page
    inst.post.assert_not_called()


def test_409_supersedes_not_latest_retries_once_after_reread() -> None:
    conflict = _resp(409, {"error": "supersedes_not_latest", "latest_id": _NEWER})
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page((_IID, _NEWEST)), _page((_IID, _NEWEST, _NEWER))],
        posts=[conflict, _resp(201, {"intervention": _ROW})],
    )
    assert resp.status_code == 200
    assert [c.kwargs["json"]["supersedes"] for c in inst.post.call_args_list] == [
        _NEWEST,
        _NEWER,
    ]


def test_second_409_is_passed_through_not_retried_again() -> None:
    conflict = _resp(409, {"error": "supersedes_not_latest"})
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page((_IID, _NEWEST)), _page((_IID, _NEWEST, _NEWER))],
        posts=[conflict, conflict],
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "supersedes_not_latest"
    assert inst.post.call_count == 2


# Each transport failure, with the status and error code it maps to.
_TRANSPORT_FAILURES = pytest.mark.parametrize(
    ("exc_type", "status_code", "error"),
    [
        (httpx.ReadTimeout, 504, "coord_timeout"),
        (httpx.ReadError, 502, "coord_transport_error"),
    ],
    ids=["timeout", "broken-connection"],
)


@_TRANSPORT_FAILURES
def test_a_failed_lookup_reports_that_nothing_was_written(
    exc_type: type[httpx.TransportError], status_code: int, error: str
) -> None:
    resp, inst = _drive(_OK_BODY, gets=[exc_type("simulated")])
    assert resp.status_code == status_code
    assert resp.json()["detail"] == {"error": error, "write_may_have_landed": False}
    inst.post.assert_not_called()


@_TRANSPORT_FAILURES
def test_a_failed_post_reports_that_the_write_may_have_landed(
    exc_type: type[httpx.TransportError], status_code: int, error: str
) -> None:
    resp, _ = _drive(
        _OK_BODY, gets=[_page((_IID, _NEWEST))], posts=[exc_type("simulated")]
    )
    assert resp.status_code == status_code
    assert resp.json()["detail"] == {"error": error, "write_may_have_landed": True}


@_TRANSPORT_FAILURES
def test_a_failed_reread_after_a_409_reports_that_nothing_was_written(
    exc_type: type[httpx.TransportError], status_code: int, error: str
) -> None:
    # Coord refused the first POST, so nothing was appended before the re-read
    # failed.
    conflict = _resp(409, {"error": "supersedes_not_latest"})
    resp, inst = _drive(
        _OK_BODY,
        gets=[_page((_IID, _NEWEST)), exc_type("simulated")],
        posts=[conflict],
    )
    assert resp.status_code == status_code
    assert resp.json()["detail"] == {"error": error, "write_may_have_landed": False}
    assert inst.post.call_count == 1


def test_coord_422_passes_through_with_its_body() -> None:
    body = {"error": "invalid_overlord_intervention_field", "field": "operator_label"}
    resp, _ = _drive(_OK_BODY, gets=[_page((_IID, _NEWEST))], posts=[_resp(422, body)])
    assert resp.status_code == 422
    assert resp.json()["detail"] == body


def test_coord_5xx_is_a_502() -> None:
    resp, _ = _drive(
        _OK_BODY,
        gets=[_page((_IID, _NEWEST))],
        posts=[_resp(500, {"error": "boom"})],
    )
    assert resp.status_code == 502


@pytest.mark.parametrize("coord_status", [401, 403])
def test_coord_refusing_web_credential_is_a_502_not_passed_through(
    coord_status: int,
) -> None:
    # A coord 401/403 refuses web's service token, not the operator; passing it
    # through would read in the browser as the operator's session failing.
    resp, _ = _drive(
        _OK_BODY,
        gets=[_page((_IID, _NEWEST))],
        posts=[_resp(coord_status, {"error": "unauthorized"})],
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == {
        "error": "coord_upstream_error",
        "coord_status": coord_status,
        "coord_detail": {"error": "unauthorized"},
    }


@pytest.mark.parametrize("coord_status", [401, 403])
def test_coord_refusing_web_credential_on_the_list_read_is_a_502(
    coord_status: int,
) -> None:
    body = {"error": "token_carries_no_tenant"}
    resp, inst = _drive(_OK_BODY, gets=[_resp(coord_status, body)])
    assert resp.status_code == 502
    assert resp.json()["detail"] == {
        "error": "coord_upstream_error",
        "coord_status": coord_status,
        "coord_detail": body,
    }
    inst.post.assert_not_called()


def test_other_coord_4xx_still_passes_through() -> None:
    # Only 401/403 (web's own credential) are remapped; any other 4xx is the
    # caller's and keeps its status and typed body.
    body = {"error": "not_found"}
    resp, _ = _drive(_OK_BODY, gets=[_page((_IID, _NEWEST))], posts=[_resp(404, body)])
    assert resp.status_code == 404
    assert resp.json()["detail"] == body


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
        body, gets=[_page((_IID, _NEWEST))], posts=[_resp(201, {"intervention": _ROW})]
    )
    assert resp.status_code == 200
