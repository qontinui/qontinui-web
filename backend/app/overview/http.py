"""The authoring contract's HTTP pieces, shared by every overview route.

``If-Match`` parsing, the ``ETag`` spelling, and the refusal bodies — one copy,
so the generic resource routes (``app.overview.router``) and the routes beyond
them (page versions and revert, file upload) cannot drift apart on what a 409
or a 428 looks like.
"""

from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.overview.resource import StaleVersion, StoreRefused


def parse_if_match(value: str | None) -> int:
    """``If-Match: "3"`` (or ``W/"3"``, or a bare ``3``) → ``3``.

    Absent is 428 Precondition Required: this contract never accepts a write
    that did not say which version it was built on.
    """
    if value is None or not value.strip():
        raise HTTPException(
            status_code=428,
            detail={
                "error": "if_match_required",
                "message": "Send If-Match with the version you read.",
            },
        )
    token = value.strip()
    if token.startswith("W/"):
        token = token[2:]
    token = token.strip('"')
    if not token.isdigit():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "bad_if_match",
                "message": 'If-Match is the record\'s version, e.g. "3".',
            },
        )
    return int(token)


def etag(version: int) -> str:
    return f'"{version}"'


def stale(exc: StaleVersion) -> JSONResponse:
    current = exc.current.model_dump(mode="json")
    return JSONResponse(
        status_code=409,
        content={
            "error": "version_conflict",
            "message": (
                "Somebody else saved this since you loaded it. Their version is "
                "attached, so you can compare it with yours before saving again."
            ),
            "current_version": current.get("version"),
            "current": current,
        },
        headers={"ETag": etag(int(current.get("version") or 0))},
    )


def refused(exc: StoreRefused) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "message": exc.message},
    )


def not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"error": "not_found", "message": "There is no such record here."},
    )
