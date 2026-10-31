"""The error envelope's ``message`` is prose, never a Python repr.

Coord's registry 500s carry only ``{"error": "failed to upsert agent registry
row"}``. The proxies forward that dict as the HTTPException ``detail``, and the
handler used to fall back to ``str(detail)``, so the operator read
``{'error': 'failed to upsert agent registry row'}`` on the page. A dict detail
now gives its string ``message``, else its string ``error``; anything else
names the status.
"""

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.middleware.error_handler import http_exception_handler


def _envelope(status_code: int, detail: Any) -> dict[str, Any]:
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]

    @app.get("/boom")
    async def boom() -> None:
        raise HTTPException(status_code=status_code, detail=detail)

    resp = TestClient(app).get("/boom")
    assert resp.status_code == status_code
    body: dict[str, Any] = resp.json()
    return body


def test_a_dict_detail_with_only_error_gives_that_error_as_the_message() -> None:
    body = _envelope(500, {"error": "failed to upsert agent registry row"})
    assert body["error"] == "failed to upsert agent registry row"
    assert body["message"] == "failed to upsert agent registry row"


def test_a_dict_detail_prefers_its_message() -> None:
    body = _envelope(422, {"error": "invalid_disposition", "message": "pick one"})
    assert body["error"] == "invalid_disposition"
    assert body["message"] == "pick one"


@pytest.mark.parametrize(
    "detail",
    [
        {"error": {"code": "nested"}},
        {"nested": {"code": "no_error_key"}},
        ["a", "list"],
    ],
)
def test_no_detail_shape_renders_as_a_repr(detail: Any) -> None:
    body = _envelope(502, detail)
    assert body["message"] == "HTTP 502 with no message"
    assert "{" not in body["message"] and "[" not in body["message"]


# The three dict shapes without an ``error`` key that real raise sites send
# (``pair_codes.py`` redeem 502, ``devenv*.py`` / ``fleet_targets.py`` typed
# refusals, ``projects.py`` version conflict). Every field reaches the client
# at the top level, and the message says what the dict carries.


def test_a_relayed_coord_answer_keeps_coord_status_and_body() -> None:
    coord_body = '{"error":"code_already_redeemed"}'
    body = _envelope(502, {"coord_status": 409, "coord_body": coord_body})
    assert body["error"] == "BAD_GATEWAY"
    assert body["message"] == f"coord answered HTTP 409: {coord_body}"
    assert body["coord_status"] == 409
    assert body["coord_body"] == coord_body


def test_a_relayed_coord_status_without_a_body_says_so() -> None:
    body = _envelope(502, {"coord_status": 503})
    assert body["message"] == "coord answered HTTP 503 with no body"
    assert body["coord_status"] == 503


def test_a_typed_refusal_keeps_its_code_at_the_top_level() -> None:
    body = _envelope(
        401,
        {"code": "invalid_machine_key", "message": "Missing or malformed machine key."},
    )
    assert body["message"] == "Missing or malformed machine key."
    assert body["code"] == "invalid_machine_key"


def test_a_version_conflict_keeps_both_versions() -> None:
    body = _envelope(
        409,
        {
            "message": "Version conflict: project was modified",
            "expected_version": 3,
            "current_version": 5,
        },
    )
    assert body["message"] == "Version conflict: project was modified"
    assert body["expected_version"] == 3
    assert body["current_version"] == 5


def test_a_non_string_error_is_listed_rather_than_dropped() -> None:
    body = _envelope(502, {"error": 7, "message": None})
    assert body["message"] == "HTTP 502: error=7"


def test_a_dict_with_neither_message_nor_error_lists_its_scalar_fields() -> None:
    body = _envelope(502, {"code": "no_agent_host", "attempts": 2})
    assert body["message"] == "HTTP 502: code=no_agent_host, attempts=2"
    assert body["code"] == "no_agent_host"
    assert body["attempts"] == 2


def test_a_string_detail_is_the_message() -> None:
    body = _envelope(502, "coord is not reachable")
    assert body["message"] == "coord is not reachable"


def test_a_dict_detail_without_error_still_uses_its_message() -> None:
    body = _envelope(400, {"message": "bad shape"})
    assert body["message"] == "bad shape"


@pytest.mark.parametrize(
    "detail",
    [
        {"path": "/etc/elsewhere", "timestamp": 0, "detail": "x", "code": "c1"},
        {
            "error": "refused",
            "path": "/etc/elsewhere",
            "timestamp": 0,
            "detail": "x",
            "code": "c1",
        },
    ],
)
def test_a_detail_cannot_overwrite_the_envelope(detail: dict[str, Any]) -> None:
    body = _envelope(409, detail)
    assert body["path"].endswith("/boom")
    assert isinstance(body["timestamp"], float) and body["timestamp"] > 0
    # Every other field, `detail` included, is still spread at the top level.
    assert body["detail"] == "x"
    assert body["code"] == "c1"


def test_coords_refusal_prose_under_detail_reaches_the_client() -> None:
    # Coord's structured refusal (dispatch_role_routes.rs `reason_required`)
    # carries its sentence under `detail`; the console's role editor, spawn
    # modal and overlord-flow reader show it from the top level.
    sentence = "a role change moves where coord sends work, so say why"
    body = _envelope(422, {"error": "reason_required", "detail": sentence})
    assert body["error"] == "reason_required"
    assert body["message"] == "reason_required"
    assert body["detail"] == sentence
    assert body["path"].endswith("/boom")
