"""Saved per-tab lists of a runner's open sessions, kept 14 days.

Plan ``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``,
Phase 2. Mounted at ``/api/v1/saved-session-lists``; every route needs a
signed-in user.

* ``POST``: capture. Relays one ``GET /terminal-layout`` to the runner that
  owns the device's relay socket (``app/services/runner_relay.py``, whose
  routing read is the device-ownership check, made before any relay frame is
  sent). The body is validated with the generated ``TerminalLayout`` model and
  joined to coord's per-session work status, then stored with
  ``expires_at = captured_at + 14 days`` on this backend's clock. The device is
  trimmed to its newest 50 lists.
* ``GET``: the caller's unexpired lists, newest first, without layouts.
* ``GET /{list_id}``: one unexpired list with its layout.
* ``DELETE /{list_id}``: delete one.

Visibility follows device access (D6): a list is readable and deletable by
whoever passes coord's device-ownership check for its ``device_id``. The list
route makes ONE ``coord_device.list_devices_for_user`` call per request; the
single-list routes ask coord's ownership-checked routing read for that one
device, the same check the relay makes. Both are ``user_id = caller AND
capability_user_paired`` on coord's side. A list that is expired, missing or
on a device the caller does not own is the same 404.

Capture refusals (D7). The relay's own device refusals (404
``device_not_owned``, 503 ``runner_not_connected`` /
``runner_never_registered``, 500 ``device_lookup_failed``) pass through with
the exact body ``/runner-proxy`` serves, built by the same function. They are
never read as the runner's answer. The runner's answers map as follows:

* a 403 whose ``error`` is the relay allowlist refusal ("this path is not
  carried by the HTTP relay …"), or a 404, means the runner build predates
  ``/terminal-layout``: 409 ``runner_predates_terminal_layout``;
* 409 ``egress_off``: 409 ``runner_egress_off``;
* any other non-2xx: 502 ``runner_error``;
* no answer in time: 504 ``runner_relay_timeout``;
* a body that is not a valid ``TerminalLayout``, is not decodable, or holds
  a NUL character (which Postgres cannot store): 502 ``runner_layout_invalid``;
* a body over the relay's 8 MiB cap: 413 ``runner_layout_too_large``. The
  runner enforces the same cap on its side and answers 413 ("response body
  exceeds relay size limit"); this backend's relay checks it again.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from qontinui_schemas.generated import TerminalLayout
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.core.refusal import (
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    RefusalHTTPException,
    refusal_error,
)
from app.models.saved_session_list import (
    SAVED_SESSION_LIST_RETENTION,
    SAVED_SESSION_LISTS_PER_DEVICE,
    SavedSessionList,
)
from app.models.user import User
from app.schemas.saved_session_lists import (
    SavedSessionListCoordStatus,
    SavedSessionListCreate,
    SavedSessionListDetail,
    SavedSessionListSummary,
)
from app.services import coord_device, coord_session_status, runner_relay

logger = structlog.get_logger(__name__)

router = APIRouter()

#: The runner route the capture relays (no leading slash, as the relay takes it).
TERMINAL_LAYOUT_PATH = "terminal-layout"

#: How long the capture waits for the runner. A layout is built from the
#: runner's in-memory state; a runner that has not answered in this long is
#: not going to, and the person who pressed Save is waiting.
CAPTURE_RELAY_TIMEOUT_S = 15.0

#: The headers the capture sends the runner. Nothing of the caller's request is
#: forwarded.
_CAPTURE_HEADERS: tuple[tuple[str, str], ...] = (("accept", "application/json"),)

#: The leading words of the runner's relay-allowlist refusal
#: (qontinui-runner ``src-tauri/src/mcp/relay_path_policy.rs``
#: ``RelayPathVerdict::NotAllowed``, answered 403 by ``backend_relay.rs``). A
#: runner whose ``RELAY_ALLOWED`` predates ``GET /terminal-layout`` answers it.
RELAY_PATH_NOT_CARRIED = "this path is not carried by the HTTP relay"

#: The runner relay's egress refusal token (``egress_off_http_response``).
_EGRESS_OFF = "egress_off"

#: The key under which the stored ``layout`` carries coord's per-session work
#: status, keyed by ``claudeSessionId`` (D10). The runner's body never has it:
#: coord status is not part of ``TerminalLayout``.
COORD_STATUS_KEY = "coordStatus"

#: Where a user gets a runner build that has the feature.
_RUNNER_DOWNLOAD_PAGE = "/download"

#: The tenant switch the runner's egress gate names for a terminal read
#: ("Terminal streaming is off for this project").
_TERMINAL_STREAMING_SETTING = "Terminal streaming"

_NOT_FOUND_SENTENCE = (
    "saved session list not found: it does not exist, it has expired, or it "
    "belongs to a device you do not own"
)


def utc_now() -> datetime:
    """This backend's clock. One seam, so tests can move it."""
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Capture
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=SavedSessionListDetail,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"description": "The device is not paired to the caller."},
        409: {
            "description": (
                "The runner's build predates /terminal-layout, or its egress "
                "gate refused the read."
            )
        },
        413: {"description": "The runner's layout is over the relay's 8 MiB cap."},
        502: {"description": "The runner answered an error or an invalid layout."},
        503: {"description": "The device's runner is not connected to the relay."},
        504: {"description": "The runner did not answer in time."},
    },
)
async def capture_saved_session_list(
    body: SavedSessionListCreate,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(current_active_user),
) -> SavedSessionListDetail | JSONResponse:
    """Save the runner's current per-tab session list for ``device_id``."""
    user_id = str(user.id)
    bearer = coord_device.extract_bearer(request)
    outcome = await runner_relay.relay_http(
        body.device_id,
        user_id=user_id,
        bearer=bearer,
        method="GET",
        path=TERMINAL_LAYOUT_PATH,
        query="",
        headers=_CAPTURE_HEADERS,
        body=b"",
        timeout_s=CAPTURE_RELAY_TIMEOUT_S,
        caller="saved_session_lists",
    )
    if isinstance(
        outcome,
        runner_relay.NotOwned | runner_relay.NotConnected | runner_relay.LookupFailed,
    ):
        request_id = runner_relay.relay_request_id(request)
        logger.warning(
            "saved_session_list_capture_refused",
            outcome=type(outcome).__name__,
            device_id=str(body.device_id),
            user_id=user_id,
            request_id=request_id,
        )
        return runner_relay.relay_refusal_response(outcome, request_id=request_id)
    if not isinstance(outcome, runner_relay.Reply):
        raise _relay_failure_refusal(outcome, body.device_id)

    raw_layout, layout = _validated_layout(outcome, body.device_id)
    _note_device_mismatch(layout, body.device_id)

    claude_ids = [
        session.claudeSessionId
        for page in layout.pages
        for session in page.sessions
        if session.claudeSessionId
    ]
    statuses = await coord_session_status.read_work_status(
        claude_ids, bearer=bearer, user_id=user_id
    )
    coord_status = {cid: answer.as_json() for cid, answer in statuses.items()}

    captured_at = utc_now()
    row = SavedSessionList(
        id=uuid.uuid4(),
        device_id=body.device_id,
        runner_instance=layout.runner.instanceName,
        runner_port=layout.runner.port,
        runner_build_id=layout.runner.buildId,
        title=body.title,
        created_by_user_id=user.id,
        captured_at=captured_at,
        expires_at=captured_at + SAVED_SESSION_LIST_RETENTION,
        tab_count=len(layout.pages),
        session_count=sum(len(page.sessions) for page in layout.pages),
        # The runner's body as relayed, not re-dumped from the model, so a
        # field a newer runner adds is kept (D9), plus coord's answers.
        layout={**raw_layout, COORD_STATUS_KEY: coord_status},
    )
    db.add(row)
    await db.flush()
    trimmed = await _trim_device(db, body.device_id)
    await db.commit()

    logger.info(
        "saved_session_list_captured",
        saved_session_list_id=str(row.id),
        device_id=str(body.device_id),
        user_id=user_id,
        tab_count=row.tab_count,
        session_count=row.session_count,
        coord_status_reads={
            read: sum(1 for a in statuses.values() if a.read == read)
            for read in ("ok", "unknown", "failed")
        },
        trimmed=trimmed,
    )
    return _detail(row, created_by_name=_display_name(user.full_name, user.username))


def _relay_failure_refusal(
    outcome: runner_relay.RelayOutcome, device_id: UUID
) -> RefusalHTTPException:
    """The refusal for a relay outcome that is neither a device refusal nor a
    reply: the runner did not answer, or its answer could not be read."""
    metadata = {"device_id": str(device_id)}
    if isinstance(outcome, runner_relay.Timeout):
        return refusal_error(
            504,
            RefusalCode.upstream_timeout,
            NextActionKind.retry_later,
            "the runner did not answer the relayed terminal-layout read in time",
            discriminator="runner_relay_timeout",
            glossary_terms=[GlossaryTerm.runner],
            metadata=metadata,
        )
    if isinstance(outcome, runner_relay.ReplyTooLarge):
        return _layout_too_large(
            f"the runner's terminal layout is {outcome.size} bytes",
            metadata,
        )
    if isinstance(outcome, runner_relay.UndecodableReply):
        return _layout_invalid(
            "the runner's reply body could not be decoded", device_id
        )
    # InvalidRequest: the relay refused the capture's own fixed request, which
    # this module builds; that is this backend's defect.
    detail = outcome.detail if isinstance(outcome, runner_relay.InvalidRequest) else ""
    return refusal_error(
        500,
        RefusalCode.internal_error,
        NextActionKind.report_defect,
        f"the relay refused the capture's own request: {detail}",
        discriminator="relay_request_rejected",
        metadata=metadata,
    )


def _layout_too_large(sentence: str, metadata: dict[str, Any]) -> RefusalHTTPException:
    return refusal_error(
        413,
        RefusalCode.quota_exceeded,
        NextActionKind.report_defect,
        f"{sentence}, over the relay's {runner_relay.RELAY_MAX_BODY_BYTES}-byte cap",
        discriminator="runner_layout_too_large",
        glossary_terms=[GlossaryTerm.runner],
        metadata=metadata,
    )


def _layout_invalid(sentence: str, device_id: UUID) -> RefusalHTTPException:
    return refusal_error(
        502,
        RefusalCode.internal_error,
        NextActionKind.report_defect,
        sentence,
        discriminator="runner_layout_invalid",
        glossary_terms=[GlossaryTerm.runner],
        metadata={"device_id": str(device_id)},
    )


def _runner_error_body(body: bytes) -> dict[str, Any]:
    """The runner's JSON error body, or ``{}`` when it is not a JSON object."""
    try:
        parsed = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _reply_refusal(reply: runner_relay.Reply, device_id: UUID) -> RefusalHTTPException:
    """The refusal for a runner answer that is not a 2xx (D7)."""
    error_body = _runner_error_body(reply.body)
    runner_error = error_body.get("error")
    runner_error = runner_error if isinstance(runner_error, str) else None
    metadata: dict[str, Any] = {
        "device_id": str(device_id),
        "runner_status": reply.status,
    }

    predates = reply.status == 404 or (
        reply.status == 403
        and runner_error is not None
        and runner_error.startswith(RELAY_PATH_NOT_CARRIED)
    )
    if predates:
        return refusal_error(
            409,
            RefusalCode.conflict,
            NextActionKind.open_page,
            "this runner's build predates saved tab lists: install the current "
            "runner (or rebuild it from source) to enable saving",
            discriminator="runner_predates_terminal_layout",
            target=_RUNNER_DOWNLOAD_PAGE,
            glossary_terms=[GlossaryTerm.runner],
            metadata=metadata,
        )

    if reply.status == 413:
        # The runner's own copy of the relay cap: the layout it built is over
        # 8 MiB. Retrying cannot help.
        return _layout_too_large(
            "the runner refused to relay its terminal layout"
            + (f" ({runner_error[:300]})" if runner_error else ""),
            metadata,
        )

    if reply.status == 409 and runner_error == _EGRESS_OFF:
        flow = error_body.get("flow")
        message = error_body.get("message")
        return refusal_error(
            409,
            RefusalCode.permission_denied,
            NextActionKind.set_setting,
            message
            if isinstance(message, str) and message
            else "the runner's egress gate refused the terminal-layout read",
            discriminator="runner_egress_off",
            target=_TERMINAL_STREAMING_SETTING,
            glossary_terms=[GlossaryTerm.runner],
            metadata={**metadata, "flow": flow if isinstance(flow, str) else None},
        )

    sentence = f"the runner answered {reply.status} for its terminal layout"
    if runner_error:
        sentence = f"{sentence}: {runner_error[:300]}"
    return refusal_error(
        502,
        RefusalCode.upstream_unavailable,
        NextActionKind.retry_later,
        sentence,
        discriminator="runner_error",
        glossary_terms=[GlossaryTerm.runner],
        metadata=metadata,
    )


def _validated_layout(
    reply: runner_relay.Reply, device_id: UUID
) -> tuple[dict[str, Any], TerminalLayout]:
    """The runner's body as parsed JSON, and as the generated model.

    The model is the D9 wire type with no extra-field refusal, so a field a
    newer runner adds passes. The raw dict is what gets stored.
    """
    if not 200 <= reply.status < 300:
        raise _reply_refusal(reply, device_id)
    try:
        raw = json.loads(reply.body)
    except (ValueError, UnicodeDecodeError):
        raise _layout_invalid(
            "the runner's terminal layout is not JSON", device_id
        ) from None
    if not isinstance(raw, dict):
        raise _layout_invalid(
            "the runner's terminal layout is not a JSON object", device_id
        )
    if _holds_unstorable_text(raw):
        # Postgres jsonb cannot store U+0000 or an unpaired UTF-16 surrogate;
        # storing either would fail as a 500.
        raise _layout_invalid(
            "the runner's terminal layout holds a NUL character or an unpaired "
            "surrogate, which cannot be stored",
            device_id,
        )
    try:
        layout = TerminalLayout.model_validate(raw)
    except ValidationError as exc:
        # A ValidationError always carries at least one error.
        errors = exc.errors(include_url=False, include_input=False)
        first = errors[0]
        where = ".".join(str(part) for part in first["loc"]) or "(root)"
        raise _layout_invalid(
            f"the runner's terminal layout does not match the TerminalLayout "
            f"schema ({len(errors)} error(s); first at {where}: {first['msg']})",
            device_id,
        ) from None
    return raw, layout


def _is_unstorable(text: str) -> bool:
    """True when ``text`` holds a character Postgres jsonb cannot store:
    U+0000, or an unpaired UTF-16 surrogate (``json.loads`` decodes a lone
    ``\\ud800`` escape into one; a paired escape becomes a real character)."""
    return any(ch == "\x00" or "\ud800" <= ch <= "\udfff" for ch in text)


def _holds_unstorable_text(value: Any) -> bool:
    """True when any string in the JSON value, key or value, is unstorable."""
    if isinstance(value, str):
        return _is_unstorable(value)
    if isinstance(value, dict):
        return any(
            _holds_unstorable_text(k) or _holds_unstorable_text(v)
            for k, v in value.items()
        )
    if isinstance(value, list):
        return any(_holds_unstorable_text(item) for item in value)
    return False


def _note_device_mismatch(layout: TerminalLayout, device_id: UUID) -> None:
    """Log a runner that reports a device id other than the one relayed to.

    The relay reached the runner holding this device's socket, so the list is
    still what that runner said. A disagreeing self-report is worth seeing.
    """
    reported = layout.runner.deviceId
    if reported is None:
        return
    try:
        same = UUID(reported) == device_id
    except ValueError:
        same = False
    if not same:
        logger.warning(
            "saved_session_list_runner_device_mismatch",
            device_id=str(device_id),
            runner_reported_device_id=reported,
        )


async def _trim_device(db: AsyncSession, device_id: UUID) -> int:
    """Keep the device's newest :data:`SAVED_SESSION_LISTS_PER_DEVICE` lists."""
    newest = (
        select(SavedSessionList.id)
        .where(SavedSessionList.device_id == device_id)
        .order_by(SavedSessionList.captured_at.desc(), SavedSessionList.id.desc())
        .limit(SAVED_SESSION_LISTS_PER_DEVICE)
    )
    result = await db.execute(
        delete(SavedSessionList).where(
            SavedSessionList.device_id == device_id,
            SavedSessionList.id.not_in(newest.scalar_subquery()),
        )
    )
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Reads and delete
# ---------------------------------------------------------------------------


@router.get("", response_model=list[SavedSessionListSummary])
async def list_saved_session_lists(
    request: Request,
    device_id: UUID | None = Query(
        default=None, description="Only this device's lists."
    ),
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(current_active_user),
) -> list[SavedSessionListSummary]:
    """The caller's unexpired saved lists, newest first, without layouts."""
    owned = await _owned_device_ids(request, user)
    if device_id is not None:
        owned &= {device_id}
    if not owned:
        return []

    columns = [
        SavedSessionList.id,
        SavedSessionList.device_id,
        SavedSessionList.runner_instance,
        SavedSessionList.runner_port,
        SavedSessionList.runner_build_id,
        SavedSessionList.title,
        SavedSessionList.created_by_user_id,
        SavedSessionList.captured_at,
        SavedSessionList.expires_at,
        SavedSessionList.tab_count,
        SavedSessionList.session_count,
    ]
    stmt = (
        select(*columns, User.full_name, User.username)
        .outerjoin(User, User.id == SavedSessionList.created_by_user_id)
        .where(
            SavedSessionList.device_id.in_(sorted(owned)),
            SavedSessionList.expires_at > utc_now(),
        )
        .order_by(SavedSessionList.captured_at.desc(), SavedSessionList.id.desc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        SavedSessionListSummary(
            id=r.id,
            device_id=r.device_id,
            runner_instance=r.runner_instance,
            runner_port=r.runner_port,
            runner_build_id=r.runner_build_id,
            title=r.title,
            created_by_user_id=r.created_by_user_id,
            created_by_name=_display_name(r.full_name, r.username),
            captured_at=r.captured_at,
            expires_at=r.expires_at,
            tab_count=r.tab_count,
            session_count=r.session_count,
        )
        for r in rows
    ]


@router.get(
    "/{list_id}",
    response_model=SavedSessionListDetail,
    responses={404: {"description": "Missing, expired, or not the caller's."}},
)
async def get_saved_session_list(
    list_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(current_active_user),
) -> SavedSessionListDetail:
    """One unexpired saved list, with its layout."""
    row, created_by_name = await _accessible_row(db, request, user, list_id)
    return _detail(row, created_by_name=created_by_name)


@router.delete(
    "/{list_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses={404: {"description": "Missing, expired, or not the caller's."}},
)
async def delete_saved_session_list(
    list_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    user: User = Depends(current_active_user),
) -> Response:
    """Delete one saved list."""
    row, _ = await _accessible_row(db, request, user, list_id)
    await db.execute(delete(SavedSessionList).where(SavedSessionList.id == row.id))
    await db.commit()
    logger.info(
        "saved_session_list_deleted",
        saved_session_list_id=str(list_id),
        device_id=str(row.device_id),
        user_id=str(user.id),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _owned_device_ids(request: Request, user: User) -> set[UUID]:
    """The caller's paired devices: ONE coord read (D6)."""
    rows = await coord_device.list_devices_for_user(request, str(user.id))
    owned: set[UUID] = set()
    for row in rows:
        try:
            owned.add(UUID(str(row.get("device_id"))))
        except ValueError:
            continue
    return owned


async def _accessible_row(
    db: AsyncSession, request: Request, user: User, list_id: UUID
) -> tuple[SavedSessionList, str | None]:
    """The unexpired list the caller may see, with its creator's name, or 404.

    Access is coord's ownership-checked routing read for the list's device,
    the check the relay itself makes. Missing, expired and not-owned are one
    404, so the route does not say which lists exist.
    """
    found = (
        await db.execute(
            select(SavedSessionList, User.full_name, User.username)
            .outerjoin(User, User.id == SavedSessionList.created_by_user_id)
            .where(
                SavedSessionList.id == list_id,
                SavedSessionList.expires_at > utc_now(),
            )
        )
    ).first()
    if found is not None:
        row, full_name, username = found
        routing = await coord_device.get_device_routing(
            row.device_id,
            bearer=coord_device.extract_bearer(request),
            user_id=str(user.id),
        )
        if routing is not None:
            return row, _display_name(full_name, username)
    raise refusal_error(
        404,
        RefusalCode.not_found,
        NextActionKind.none_terminal,
        _NOT_FOUND_SENTENCE,
        discriminator="saved_session_list_not_found",
        metadata={"saved_session_list_id": str(list_id)},
    )


def _display_name(full_name: str | None, username: str | None) -> str | None:
    return full_name or username or None


def _detail(
    row: SavedSessionList, *, created_by_name: str | None
) -> SavedSessionListDetail:
    """Serve a stored row: the layout through the generated model, and the
    coord join beside it."""
    stored = dict(row.layout)
    coord_raw = stored.pop(COORD_STATUS_KEY, None)
    try:
        layout = TerminalLayout.model_validate(stored)
        coord_status = {
            cid: SavedSessionListCoordStatus.model_validate(answer)
            for cid, answer in (coord_raw or {}).items()
        }
    except (ValidationError, AttributeError):
        logger.exception(
            "saved_session_list_stored_layout_unreadable",
            saved_session_list_id=str(row.id),
        )
        raise refusal_error(
            500,
            RefusalCode.internal_error,
            NextActionKind.report_defect,
            "this saved list's stored layout no longer reads as a TerminalLayout",
            discriminator="saved_session_list_layout_unreadable",
            metadata={"saved_session_list_id": str(row.id)},
        ) from None
    return SavedSessionListDetail(
        id=row.id,
        device_id=row.device_id,
        runner_instance=row.runner_instance,
        runner_port=row.runner_port,
        runner_build_id=row.runner_build_id,
        title=row.title,
        created_by_user_id=row.created_by_user_id,
        created_by_name=created_by_name,
        captured_at=row.captured_at,
        expires_at=row.expires_at,
        tab_count=row.tab_count,
        session_count=row.session_count,
        layout=layout,
        coord_status=coord_status,
    )
