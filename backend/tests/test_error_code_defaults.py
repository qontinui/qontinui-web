"""An unmapped 4xx never carries a server-failure code.

Phase 5 of
``2026-09-20-a-recorded-delivery-scope-is-permanent-so-a-mis-declared-phase-is-uncorrectable``.
``GET /plan-library/{id}/edges`` answered a genuine 405 (only ``POST`` was
registered on the path) inside an ``INTERNAL_SERVER_ERROR`` envelope, because
``get_default_error_code`` defaulted every unmapped status to it — and, per
the plan's incident record, a tolerant client rendered the failure as an empty
edge list. The fix is for the
class, not the route: 405 has its own code and any other unmapped 4xx falls
back to ``BAD_REQUEST``.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.error_codes import (
    DEFAULT_ERROR_CODES,
    ErrorCode,
    get_default_error_code,
)
from app.middleware.error_handler import http_exception_handler


def test_405_has_its_own_code() -> None:
    assert get_default_error_code(405) is ErrorCode.METHOD_NOT_ALLOWED


@pytest.mark.parametrize("status_code", [402, 406, 410, 412, 413, 415, 418, 451])
def test_an_unmapped_4xx_is_a_client_error(status_code: int) -> None:
    assert status_code not in DEFAULT_ERROR_CODES
    assert get_default_error_code(status_code) is ErrorCode.BAD_REQUEST


@pytest.mark.parametrize("status_code", [501, 505, 507])
def test_an_unmapped_5xx_stays_a_server_error(status_code: int) -> None:
    assert status_code not in DEFAULT_ERROR_CODES
    assert get_default_error_code(status_code) is ErrorCode.INTERNAL_SERVER_ERROR


def test_every_mapped_status_keeps_its_code() -> None:
    for status_code, code in DEFAULT_ERROR_CODES.items():
        assert get_default_error_code(status_code) is code


def _app() -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]

    @app.post("/things/{thing_id}/edges")
    async def create_edge(thing_id: str) -> dict[str, str]:
        return {"thing_id": thing_id}

    @app.get("/teapot")
    async def teapot() -> None:
        raise HTTPException(status_code=418, detail="short and stout")

    return app


def test_a_wrong_method_answers_405_in_a_method_not_allowed_envelope() -> None:
    """The exact shape the edges read hit: GET on a POST-only path."""
    resp = TestClient(_app()).get("/things/abc/edges")
    assert resp.status_code == 405
    assert resp.json()["error"] == "METHOD_NOT_ALLOWED"


def test_an_unmapped_4xx_envelope_is_bad_request() -> None:
    resp = TestClient(_app()).get("/teapot")
    assert resp.status_code == 418
    assert resp.json()["error"] == "BAD_REQUEST"
    assert resp.json()["message"] == "short and stout"
