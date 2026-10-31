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
        {"error": 7, "message": None},
        {"code": "no_error_key"},
        ["a", "list"],
    ],
)
def test_no_detail_shape_renders_as_a_repr(detail: Any) -> None:
    body = _envelope(502, detail)
    assert body["message"] == "HTTP 502 with no message"
    assert "{" not in body["message"] and "[" not in body["message"]


def test_a_string_detail_is_the_message() -> None:
    body = _envelope(502, "coord is not reachable")
    assert body["message"] == "coord is not reachable"


def test_a_dict_detail_without_error_still_uses_its_message() -> None:
    body = _envelope(400, {"message": "bad shape"})
    assert body["message"] == "bad shape"
