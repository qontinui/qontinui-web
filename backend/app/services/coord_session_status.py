"""Read coord's work-axis status for Claude Code sessions, by harness session id.

Plan ``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``,
Phase 2, D10. The saved-session-lists capture asks coord, once per capture,
whether each session in the relayed layout is finished. The join runs here,
in the web backend, and not in the runner: the runner handles a relayed
``http_request`` inline on its relay read loop, so a coord read inside that
handler would hold up every other relay frame.

The coord route is ``GET /coord/sessions/work-status?claude_code_session_ids=<csv>``
(qontinui-coord ``crates/coord/src/session_work_status.rs``). It is
authorized by an operator bearer or a device JWT, answers only for the
caller's tenant, and accepts at most :data:`MAX_IDS_PER_CALL` ids per call.
This client forwards the caller's own bearer, as ``app/services/coord_device.py``
does, against the same coord (``coord_device_base()``) with the same 5 s
budget.

Every answer is per id, and only one shape counts as an answer:
``statuses[id].session_status`` on a response whose
``sessionBridgeColumnPresent`` is ``true``. That value is the work axis
(``finished``, another word, or ``null`` = the session exists and its work
axis is unset). Everything else is UNKNOWN for that id, never "not finished":
an id coord lists under ``unknown`` (no session in the caller's tenant, which
is also how a session of another tenant on a multi-tenant device reads), an
id it calls ``invalid``, an id missing because the input was truncated, a
response without the bridge column, and a failed read.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

import httpx
import structlog

from app.core.config import coord_device_base

logger = structlog.get_logger(__name__)

#: coord's ``MAX_IDS`` for this route (``session_work_status.rs``). A longer
#: list is sent in chunks, so coord never has to truncate one.
MAX_IDS_PER_CALL = 500

# The same 5 s budget ``coord_device`` and the operations coord proxies use.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# coord's per-user scoping header, sent as ``coord_device`` sends it. This
# route resolves the tenant from the bearer and ignores it.
_USER_ID_HEADER = "x-qontinui-user-id"

_PATH = "/coord/sessions/work-status"

CoordStatusRead = Literal["ok", "unknown", "failed"]


@dataclass(frozen=True, slots=True)
class CoordWorkStatus:
    """coord's work-axis answer for one session.

    ``read`` says what kind of answer ``value`` is:

    * ``ok``: coord answered for this id. ``value`` is its ``session_status``,
      where ``None`` means the session exists and its work axis is unset.
    * ``unknown``: coord answered the call but not for this id (``unknown``,
      ``invalid``, truncated input, or no bridge column). ``value`` is ``None``.
    * ``failed``: the read itself failed. ``value`` is ``None``.
    """

    value: str | None
    read: CoordStatusRead

    def as_json(self) -> dict[str, str | None]:
        """The stored and served form: ``{"value": ..., "read": ...}``."""
        return {"value": self.value, "read": self.read}


_UNKNOWN = CoordWorkStatus(value=None, read="unknown")
_FAILED = CoordWorkStatus(value=None, read="failed")


def _canonical_uuid(raw: str) -> str | None:
    """The id as coord keys it (lowercase, hyphenated), or ``None`` for a
    token that is not a UUID. coord would answer such a token as ``invalid``,
    so it is not sent at all."""
    try:
        return str(uuid.UUID(raw))
    except (ValueError, AttributeError, TypeError):
        return None


async def read_work_status(
    claude_session_ids: Iterable[str],
    *,
    bearer: str | None,
    user_id: str,
) -> dict[str, CoordWorkStatus]:
    """coord's work-axis status for each of ``claude_session_ids``.

    Returns one entry per distinct input id, keyed by the id exactly as given,
    so a caller joins it back to the layout it came from. This function
    never raises: a coord it cannot read is ``read="failed"`` for every id
    that read covered.
    """
    by_input: dict[str, str | None] = {}
    for raw in claude_session_ids:
        if raw not in by_input:
            by_input[raw] = _canonical_uuid(raw)

    answers: dict[str, CoordWorkStatus] = {}
    canonical = sorted({c for c in by_input.values() if c is not None})
    if canonical and bearer is None:
        # Nothing to authorize the read with. coord would answer 401, so the
        # read is failed without making it.
        logger.warning(
            "saved_session_lists_coord_status_read_failed",
            reason="no_bearer",
            ids=len(canonical),
        )
    for start in range(0, len(canonical), MAX_IDS_PER_CALL):
        chunk = canonical[start : start + MAX_IDS_PER_CALL]
        if bearer is None:
            answers.update(dict.fromkeys(chunk, _FAILED))
            continue
        answers.update(await _read_chunk(chunk, bearer=bearer, user_id=user_id))

    return {
        raw: (answers.get(canon, _FAILED) if canon is not None else _UNKNOWN)
        for raw, canon in by_input.items()
    }


async def _read_chunk(
    ids: list[str],
    *,
    bearer: str,
    user_id: str,
) -> dict[str, CoordWorkStatus]:
    """One call for at most :data:`MAX_IDS_PER_CALL` canonical ids."""
    url = f"{coord_device_base()}{_PATH}"
    headers = {"Authorization": f"Bearer {bearer}", _USER_ID_HEADER: user_id}
    try:
        async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
            resp = await client.get(
                url,
                params={"claude_code_session_ids": ",".join(ids)},
                headers=headers,
            )
    except httpx.HTTPError as exc:
        logger.warning(
            "saved_session_lists_coord_status_read_failed",
            reason="transport",
            error_type=type(exc).__name__,
            ids=len(ids),
        )
        return dict.fromkeys(ids, _FAILED)

    if resp.status_code != 200:
        logger.warning(
            "saved_session_lists_coord_status_read_failed",
            reason="status",
            upstream_status=resp.status_code,
            body_preview=resp.text[:200],
            ids=len(ids),
        )
        return dict.fromkeys(ids, _FAILED)

    try:
        payload = resp.json()
    except ValueError:
        payload = None
    statuses = payload.get("statuses") if isinstance(payload, dict) else None
    if not isinstance(statuses, dict):
        logger.warning(
            "saved_session_lists_coord_status_read_failed",
            reason="malformed",
            ids=len(ids),
        )
        return dict.fromkeys(ids, _FAILED)

    if payload.get("sessionBridgeColumnPresent") is not True:
        # coord could not express the join at all on its database, so an
        # absent id is not an observation. Every id is unknown.
        logger.info(
            "saved_session_lists_coord_status_bridge_absent",
            ids=len(ids),
        )
        return dict.fromkeys(ids, _UNKNOWN)

    out: dict[str, CoordWorkStatus] = {}
    for coord_id in ids:
        row = statuses.get(coord_id)
        value = row.get("session_status") if isinstance(row, dict) else None
        if isinstance(row, dict) and (value is None or isinstance(value, str)):
            out[coord_id] = CoordWorkStatus(value=value, read="ok")
        else:
            out[coord_id] = _UNKNOWN
    return out
