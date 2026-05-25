"""Regression test for the ``/api/v1/variables/global`` bad-input 500.

Before the 2026-05-25 baseline-500 fix, ``project_id`` arrived as a raw
query string and was passed straight into a query against the UUID-typed
``project.projects.id`` column. An empty or malformed value (e.g. the
automation-builder page mounting before a project is selected sends
``project_id=``) made asyncpg raise ``DataError`` -> opaque HTTP 500 on
routine input. The handler now validates ``project_id`` is a well-formed
UUID via ``_parse_project_uuid`` and returns 422 instead.

This locks that helper: valid UUID -> parsed; empty / malformed -> 422.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from fastapi import HTTPException, status

from app.api.v1.endpoints.variables import _parse_project_uuid


def test_parse_project_uuid_accepts_valid() -> None:
    raw = "14b18ca5-9652-4d05-b7fd-af332e4f2709"
    assert _parse_project_uuid(raw) == UUID(raw)


@pytest.mark.parametrize("bad", ["", "notauuid", "123", "  ", "null", "undefined"])
def test_parse_project_uuid_rejects_bad_input_with_422(bad: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        _parse_project_uuid(bad)
    assert exc_info.value.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
