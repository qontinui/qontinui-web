"""Service-to-service internal endpoints (coord -> web; no user surface).

Plan ``2026-10-12-operator-action-items-pushed-to-the-phone`` Phase 3:

    POST /api/v1/internal/coord-push

Coord owns operator action items and their push state; web owns the Expo
push tokens (``auth.push_devices``) and the only Expo client in the fleet. So
coord resolves an item's recipients to web user ids and asks web to push to
them. This route looks up those users' active tokens, sends one Expo batch,
and answers per-request COUNTS — coord stamps them on the item as its push
state (D4), so a failure is visible on the item rather than lost here.

**Auth is a shared service secret and nothing else.** Coord presents
``X-Coord-Service-Secret``; it is compared to ``settings.COORD_WEB_SERVICE_SECRET``
in constant time. An EMPTY setting means the hop is unconfigured and every
call is rejected with 401 — an unauthenticated call is never accepted. No
global middleware guards ``/api/v1/internal/*`` (``main.py`` registers none),
so :func:`_require_coord_secret` is the only gate on this module; every route
added here must carry it.

**Payload bounds.** Expo refuses a notification payload over 4096 bytes, so
every user-supplied field is bounded in UTF-8 BYTES (a character count
under-measures non-ASCII text up to four times): ``title`` to
:data:`MAX_PUSH_TITLE_BYTES` (and 200 characters), ``body`` to
:data:`MAX_PUSH_BODY_BYTES` (tighter than the plan's original 4000 characters —
coord sends at most 180 characters, which is at most 720 bytes), and ``data`` to
:data:`MAX_PUSH_DATA_BYTES` bytes of compact UTF-8 JSON. Together that is at
most 2624 bytes, leaving over 1400 bytes of the 4096 for Expo's own fields
(``to``, ``sound``, ``priority``, the collapse id). A field over its bound is a
422 here rather than an Expo failure counted as ``failed``.

Who may make web send a push is a new authorization decision (plan D2,
security content trigger 5): only a holder of the coord service secret, and
only to the user ids it names. The route is not proxied by ``/operations``.
"""

from __future__ import annotations

import hmac
import json
from typing import Any, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.core.config import settings
from app.models.push_device import PushDevice
from app.services.push_notifications import (
    MAX_REPORTED_ERRORS,
    send_push_notifications_with_result,
)

logger = structlog.get_logger(__name__)

router = APIRouter()

SECRET_HEADER = "X-Coord-Service-Secret"

# Expo rejects a notification payload over 4096 bytes. The plan's contract
# allowed a 4000-character body, which with title and data could pass that
# ceiling and fail at Expo instead of here. All three bounds are UTF-8 BYTES
# (see the module docstring for the sum); coord sends at most 180 characters of
# body (<= 720 bytes), so they cost coord nothing.
MAX_PUSH_TITLE_CHARS = 200
MAX_PUSH_TITLE_BYTES = 600
MAX_PUSH_BODY_BYTES = 1000
MAX_PUSH_DATA_BYTES = 1024


def _utf8_len(value: str) -> int:
    return len(value.encode("utf-8"))


def _require_coord_secret(
    x_coord_service_secret: str | None = Header(default=None, alias=SECRET_HEADER),
) -> None:
    """Authenticate the coord service call via the shared secret.

    Rejects (401) when the secret is unconfigured (empty) — the hop is then
    OFF and no call is ever accepted — or when the presented header does not
    constant-time match. The response never says which of the two failed.
    """
    configured = settings.COORD_WEB_SERVICE_SECRET or ""
    presented = x_coord_service_secret or ""
    if not configured or not hmac.compare_digest(
        presented.encode("utf-8"), configured.encode("utf-8")
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing coord service secret",
        )


class CoordPushRequest(BaseModel):
    """Body coord sends to ``POST /internal/coord-push``.

    Deliberately carries NO ``category`` / ``channel_id`` (plan D7): a push
    naming an Android channel the device has not created is not displayed
    while Expo still returns an ``ok`` ticket, which would turn ``accepted``
    into an invisible failure.
    """

    model_config = ConfigDict(extra="forbid")

    user_ids: list[UUID] = Field(
        min_length=1,
        max_length=50,
        description="Web user ids (auth.users.id) to push to. 1-50.",
    )
    title: str = Field(
        min_length=1,
        max_length=MAX_PUSH_TITLE_CHARS,
        description=f"At most {MAX_PUSH_TITLE_CHARS} characters and "
        f"{MAX_PUSH_TITLE_BYTES} UTF-8 bytes.",
    )
    body: str = Field(
        # A UTF-8 string of N bytes has at most N characters, so this character
        # bound is implied by the byte bound below; it is here so the schema
        # states a length at all. The byte bound is the one that binds.
        max_length=MAX_PUSH_BODY_BYTES,
        description=f"Notification body, at most {MAX_PUSH_BODY_BYTES} UTF-8 "
        "bytes. Coord sends at most 180 characters.",
    )
    data: dict[str, Any] = Field(
        description="Opaque payload delivered to the app (e.g. the deep link). "
        f"At most {MAX_PUSH_DATA_BYTES} bytes as serialized JSON."
    )
    priority: Literal["high", "default"]
    collapse_id: str | None = Field(
        default=None,
        max_length=200,
        description="Newer pushes with the same id replace older ones on the device.",
    )

    @field_validator("title")
    @classmethod
    def _title_fits_expo(cls, value: str) -> str:
        size = _utf8_len(value)
        if size > MAX_PUSH_TITLE_BYTES:
            raise ValueError(
                f"title is {size} UTF-8 bytes; at most {MAX_PUSH_TITLE_BYTES}"
            )
        return value

    @field_validator("body")
    @classmethod
    def _body_fits_expo(cls, value: str) -> str:
        size = _utf8_len(value)
        if size > MAX_PUSH_BODY_BYTES:
            raise ValueError(
                f"body is {size} UTF-8 bytes; at most {MAX_PUSH_BODY_BYTES}"
            )
        return value

    @field_validator("data")
    @classmethod
    def _data_fits_expo(cls, value: dict[str, Any]) -> dict[str, Any]:
        size = _utf8_len(json.dumps(value, separators=(",", ":"), ensure_ascii=False))
        if size > MAX_PUSH_DATA_BYTES:
            raise ValueError(
                f"data is {size} bytes as JSON; at most {MAX_PUSH_DATA_BYTES} "
                "fit beside the title and body in Expo's 4 KB payload"
            )
        return value


class CoordPushResponse(BaseModel):
    """Per-request counts coord records as the item's push state."""

    users: int = Field(description="Distinct requested users with >= 1 active device.")
    devices: int = Field(description="Active push devices the batch was sent to.")
    accepted: int = Field(description="Tickets Expo answered with status ok.")
    failed: int = Field(description="Messages without an ok ticket.")
    deactivated: int = Field(
        description="Tokens deactivated because their ticket said DeviceNotRegistered."
    )
    errors: list[str] = Field(
        description=f"At most {MAX_REPORTED_ERRORS} error messages, first seen first."
    )


@router.post(
    "/coord-push",
    response_model=CoordPushResponse,
    dependencies=[Depends(_require_coord_secret)],
)
async def coord_push(
    body: CoordPushRequest,
    db: AsyncSession = Depends(get_async_db),
) -> CoordPushResponse:
    """Push one notification to every active device of the named users.

    ``devices: 0`` is an answer, not an error: coord maps it to the item's
    ``no_devices`` state. Expo failures are counted, not raised, so the
    response is always the counts — a non-2xx from this route means the call
    itself was refused (401 secret, 422 body), never that Expo failed.
    """
    user_ids = list(dict.fromkeys(body.user_ids))
    rows = (
        await db.execute(
            select(PushDevice.user_id, PushDevice.push_token).where(
                PushDevice.user_id.in_(user_ids),
                PushDevice.is_active == True,  # noqa: E712
            )
        )
    ).all()
    tokens = list(dict.fromkeys(row[1] for row in rows))
    users_with_devices = len({row[0] for row in rows})

    result = await send_push_notifications_with_result(
        tokens,
        body.title,
        body.body,
        data=body.data,
        priority=body.priority,
        collapse_id=body.collapse_id,
        db=db,
    )
    logger.info(
        "coord_push_handled",
        requested_users=len(user_ids),
        users=users_with_devices,
        devices=result.devices,
        accepted=result.accepted,
        failed=result.failed,
        deactivated=result.deactivated,
    )
    return CoordPushResponse(
        users=users_with_devices,
        devices=result.devices,
        accepted=result.accepted,
        failed=result.failed,
        deactivated=result.deactivated,
        errors=result.errors,
    )
