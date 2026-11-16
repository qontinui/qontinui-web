"""One HTTP request to a remote runner, relayed over the runner's own WebSocket.

This is the relay arm of ``/api/v1/device-bridge/runner-proxy/{path}`` as a
service (plan
``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``,
Phase 2). It used to live inline in
``app/api/v1/endpoints/device_bridge_ws.py::_runner_proxy_relay``, which read
everything from a FastAPI ``Request`` and answered with a ``Response``, so no
second caller could use it. :func:`relay_http` takes the request as plain
values and returns a TYPED outcome, and each caller renders that outcome
itself. There are two callers: ``runner_proxy``, whose behaviour did not change
in the move, and the saved-session-lists capture
(``app/api/v1/endpoints/saved_session_lists.py``), which relays one fixed
``GET /terminal-layout``.

What the relay does, in order. The order is behaviour, and the runner-proxy
tests pin it:

1. Resolve the device over coord's HTTP boundary (``GET
   /coord/devices/:id/routing``, ownership-checked against the caller). A
   device the caller does not own is :class:`NotOwned`. One the caller owns
   whose runner holds no relay session (``ws_session_id IS NULL``) is
   :class:`NotConnected`, carrying the two liveness clocks. Any other
   unexpected lookup error is :class:`LookupFailed`. A coord TRANSPORT fault is
   not an outcome: the coord client's 502/504 ``HTTPException`` propagates, as
   it always has.
2. Refuse a path that fails the SSRF guard, then read the request body and
   refuse one over the cap (:class:`InvalidRequest`). Both happen before any
   frame is sent, and a request refused in step 1 or by the path guard never
   has its body read.
3. Drop hop-by-hop headers, every ambient credential and the browser's
   provenance headers.
4. Publish one ``http_request`` envelope on the runner's command channel and
   await the matching ``command_response``. When none arrives in time, the
   outcome is :class:`Timeout`.
5. Decode the reply: :class:`UndecodableReply`, :class:`ReplyTooLarge`, or
   :class:`Reply` with the runner's status, its non-hop-by-hop headers and its
   body.

The device refusals (:class:`NotOwned`, :class:`NotConnected`,
:class:`LookupFailed`) render through ONE function,
:func:`relay_refusal_response`, so every caller serves the same 404 / 503 / 500
body. Logging those refusals is the caller's job, because the log line names
the caller's route.
"""

from __future__ import annotations

import base64
import binascii
import re
import time
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import NamedTuple
from uuid import UUID, uuid4

import structlog
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from app.config.redis_config import get_redis
from app.core.refusal import (
    REFUSAL_KEY,
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    build_refusal,
    refusal_payload,
)
from app.services import coord_device

logger = structlog.get_logger(__name__)


# Maximum request/response body size relayed over the WS bridge. Guards both
# the inbound request body and the base64-decoded response body against
# oversized payloads that would strain Redis pub/sub. 8 MiB.
RELAY_MAX_BODY_BYTES = 8 * 1024 * 1024

# Pattern for safe proxy path segments — allows alphanumeric, hyphens, underscores,
# dots, and forward slashes only. Rejects characters that could rewrite the URL
# (e.g., '@', ':', '?', '#') even if FastAPI strips some of them first.
_SAFE_PATH_RE = re.compile(r"^[a-zA-Z0-9/_\-\.]*$")


def validate_proxy_path(path: str) -> None:
    """Raise ValueError if path contains characters that could redirect the URL."""
    if not _SAFE_PATH_RE.match(path):
        raise ValueError(f"Proxy path contains disallowed characters: {path!r}")


# The end user's BROWSER provenance headers, dropped on BOTH runner hops (this
# relay, and the co-located hop in ``device_bridge_ws.runner_proxy``).
#
# The runner's loopback API classifies a caller by ``Origin`` and
# ``Sec-Fetch-Site`` (``src-tauri/src/mcp/origin_guard.rs``, plan
# ``2026-09-17-runner-loopback-api-accepts-any-origin``): absent both it is a
# NON-browser caller and keeps full local trust; with a browser origin it is
# admitted only to the routes that origin's class is allowlisted for. Every
# request through either hop is SERVER-mediated — this backend has already
# authenticated the user and, on the relay arm, the runner's
# ``relay_path_policy`` gates the path — so forwarding the page's
# ``Origin: https://app.qontinui.io`` would make the runner refuse a proxied
# mobile / digital-twin / co-pilot call as a Foreign browser request. The whole
# Fetch Metadata family goes too — matched by its ``sec-fetch-`` PREFIX, so a
# member browsers add later is stripped without an edit here: it describes the
# browser's hop, not this one. This strip must be deployed BEFORE the runner
# enforces its route allowlist (that plan's Phase 2 prerequisite).
_BROWSER_PROVENANCE_REQUEST_HEADERS = frozenset({"origin"})
_BROWSER_PROVENANCE_REQUEST_HEADER_PREFIX = "sec-fetch-"


def is_browser_provenance_header(name: str) -> bool:
    """True for a request header that only a browser's own hop can carry."""
    lowered = name.lower()
    return lowered in _BROWSER_PROVENANCE_REQUEST_HEADERS or lowered.startswith(
        _BROWSER_PROVENANCE_REQUEST_HEADER_PREFIX
    )


# Ambient credentials — every header by which a caller authenticates TO THIS
# BACKEND. Neither runner hop (this relay nor the co-located legacy hop in
# ``device_bridge_ws.runner_proxy``) forwards any of them: the runner trusts its
# own channel, not the end user's credentials, and a runner (or anything on its
# box reading its logs) must never receive a replayable web credential.
#   - ``authorization`` / ``proxy-authorization`` — the user's bearer.
#   - ``cookie`` — the browser's session / refresh cookies (the frontend's
#     httpClient sends ``credentials: "include"``).
#   - ``x-csrf-token`` — the CSRF token paired with that session.
#   - ``x-machine-key`` / ``x-device-machine-key`` — machine / device keys
#     accepted by the devenv-agent and device endpoints.
#   - ``x-coord-admin-secret`` — the coord admin shared secret.
AMBIENT_CREDENTIAL_REQUEST_HEADERS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "x-csrf-token",
        "x-machine-key",
        "x-device-machine-key",
        "x-coord-admin-secret",
    }
)

# Request headers never forwarded to the runner over the relay: hop-by-hop
# (``host``, ``connection``, ``transfer-encoding``, ``content-length``) plus
# every ambient credential above.
#
# Browser provenance headers are dropped as well, by
# :func:`is_browser_provenance_header` (above) at the filter site.
RELAY_EXCLUDED_REQUEST_HEADERS = (
    frozenset({"host", "connection", "transfer-encoding", "content-length"})
    | AMBIENT_CREDENTIAL_REQUEST_HEADERS
)

# Hop-by-hop response headers stripped before returning the runner's reply.
RELAY_EXCLUDED_RESPONSE_HEADERS = frozenset(
    {"transfer-encoding", "connection", "keep-alive", "content-length"}
)


#: The ``next_action.target`` for a paired device whose runner has never
#: opened the relay. ``Refusal::render`` reads: Set the "<target>" setting,
#: then try again. "Web Integration" is the runner's own Settings section
#: and toggle (``WebIntegrationSettings.tsx``); the relay starts at runner
#: boot once it is on and the runner is signed in. The runner has no
#: separate cloud-relay toggle any more.
RELAY_SETTING_TARGET = "Web Integration"

#: The refusal sentence for the same case. The top-level ``detail`` keeps its
#: prior value ("runner not connected") for older mobile builds.
_NEVER_REGISTERED_SENTENCE = (
    "this device is paired, but its runner has never connected to the cloud "
    "relay: start the runner on that device, sign it in, and turn its cloud "
    "relay on, then try again"
)


# ---------------------------------------------------------------------------
# Outcomes
# ---------------------------------------------------------------------------


class DeviceLiveness(NamedTuple):
    """The two liveness clocks, plus whether we actually learned them.

    ``known`` is the field that keeps ``None`` from meaning two things at
    once. A ``ws_connected_at`` of ``None`` is a real, useful fact — the
    column is NULL, so the runner has *never* held a WS session — but the
    coord read that sources it can also simply fail, and that yields ``None``
    for a completely different reason. Collapsing the two would make the 503
    body assert "never registered" whenever coord hiccupped, which is a
    confident wrong answer in place of an honest unknown.
    """

    known: bool
    ws_connected_at: str | None
    last_seen_at: str | None


@dataclass(frozen=True, slots=True)
class NotOwned:
    """coord's ownership-checked routing read found no device of this id
    paired to the caller (its 404)."""

    device_id: UUID


@dataclass(frozen=True, slots=True)
class NotConnected:
    """The caller owns the device, but its runner holds no relay session:
    ``coord.devices.ws_session_id IS NULL``."""

    device_id: UUID
    liveness: DeviceLiveness


@dataclass(frozen=True, slots=True)
class LookupFailed:
    """The routing read failed with an unexpected error. This is our fault,
    not a coord transport fault (those propagate as coord's 502/504)."""

    device_id: UUID


@dataclass(frozen=True, slots=True)
class InvalidRequest:
    """The relay's own guards refused the request before any frame was sent:
    an unsafe path (400) or a body over :data:`RELAY_MAX_BODY_BYTES` (413)."""

    status_code: int
    detail: str


@dataclass(frozen=True, slots=True)
class Timeout:
    """No matching ``command_response`` arrived within the timeout."""

    elapsed_ms: float


@dataclass(frozen=True, slots=True)
class UndecodableReply:
    """The runner answered, but its ``body_b64`` is not base64."""


@dataclass(frozen=True, slots=True)
class ReplyTooLarge:
    """The runner answered with a body over :data:`RELAY_MAX_BODY_BYTES`."""

    size: int


@dataclass(frozen=True, slots=True)
class Reply:
    """The runner's own answer: its HTTP status, its headers minus the
    hop-by-hop ones, and its body (at most :data:`RELAY_MAX_BODY_BYTES`)."""

    status: int
    headers: dict[str, str]
    body: bytes


#: The outcomes that are a refusal about the DEVICE, rendered by
#: :func:`relay_refusal_response`.
DeviceRefusal = NotOwned | NotConnected | LookupFailed

#: Every outcome :func:`relay_http` can return.
RelayOutcome = (
    NotOwned
    | NotConnected
    | LookupFailed
    | InvalidRequest
    | Timeout
    | UndecodableReply
    | ReplyTooLarge
    | Reply
)


# ---------------------------------------------------------------------------
# The relay
# ---------------------------------------------------------------------------


async def _device_liveness(
    device_id: UUID,
    *,
    bearer: str | None,
    user_id: str,
    caller: str,
) -> DeviceLiveness:
    """Best-effort liveness clocks for the not-connected 503.

    Coord's ``GET /coord/devices/:id/routing`` deliberately returns only
    ``{device_id, ws_session_id}``, so the timestamps come from the full-row
    read (``GET /coord/devices/:id/owned``) instead. That read runs ONLY on
    the 503 path, never on a healthy relay dispatch, and ONE read sources
    both fields.

    **Two clocks, deliberately both named.** ``ws_session_id`` has more than
    one writer: a fresh registration sets it, and the heartbeat heal
    (``devices_ws.py`` → ``device_crud.claim_ws_session``) can re-claim a
    session without one. "Last registered" and "last healed" are therefore
    different clocks, and the 503's whole purpose — telling "never
    registered" apart from "flapping right now" — turns on which is read.

    * ``ws_connected_at`` is the timestamp of the *current* WS claim however
      it was obtained: both non-NULL writers set it alongside
      ``ws_session_id``, and ``claim_ws_session`` deliberately copies it from
      the connection row rather than stamping ``utc_now()``. This is the
      flapping signal.
    * ``last_seen_at`` is the general device heartbeat — a different fact,
      and the one the 503 body already shipped with.

    Returning both under their own names is what keeps either from being the
    ambiguous "last seen" whose meaning shifts by code path — which is the
    defect this 503 exists to diagnose, and one worth not reproducing in the
    diagnosis.

    **This function never raises.** A coord fault while decorating a 503 must
    not convert a genuine "runner not connected" into a 502/504 — the 503 is
    already the correct answer and the timestamps are a nicety. Any failure
    yields ``known=False``, and the 503 then OMITS both fields from the body
    rather than sending ``null`` — because ``null`` is already spoken for. It
    means the column is NULL, i.e. "never registered", which is exactly the
    strong claim a failed lookup has no basis to make. Absent is the wire
    spelling of "unknown"; ``null`` is the wire spelling of "never". The
    unknown case is named on its own line,
    ``runner_proxy_relay_liveness_lookup_failed``, which carries the request
    id via the middleware's contextvar.
    """
    try:
        owned = await coord_device.get_owned_device_with_bearer(
            device_id, bearer=bearer, user_id=user_id
        )
    except Exception:
        logger.info(
            "runner_proxy_relay_liveness_lookup_failed",
            device_id=str(device_id),
            caller=caller,
            exc_info=True,
        )
        return DeviceLiveness(known=False, ws_connected_at=None, last_seen_at=None)

    # coord serialises the row with ``to_jsonb``, so a timestamptz arrives as
    # an ISO-8601 string. Anything else is not a timestamp we can promise.
    def _iso(key: str) -> str | None:
        value = owned.get(key)
        return value if isinstance(value, str) else None

    return DeviceLiveness(
        known=True,
        ws_connected_at=_iso("ws_connected_at"),
        last_seen_at=_iso("last_seen_at"),
    )


async def relay_http(
    device_id: UUID,
    *,
    user_id: str,
    bearer: str | None,
    method: str,
    path: str,
    query: str,
    headers: Iterable[tuple[str, str]],
    body: bytes | Callable[[], Awaitable[bytes]],
    timeout_s: float,
    caller: str,
) -> RelayOutcome:
    """Relay one HTTP request to the runner that owns ``device_id``'s relay socket.

    ``bearer`` is the caller's own credential, forwarded to coord for the
    ownership-checked device reads and never to the runner. ``path`` has no
    leading slash (the shape ``runner_proxy``'s ``{path:path}`` parameter
    has). ``headers`` are the caller's request headers. The ones in
    :data:`RELAY_EXCLUDED_REQUEST_HEADERS`, and the browser's provenance
    headers, are dropped here, so no caller can forward a credential by
    accident.

    ``body`` is the request body, or a coroutine function that reads it
    (``Request.body``). It is read only after the device is known to be
    reachable and the path has passed the guard, so a refused request never
    buffers its body. ``caller`` names the route on every log line this
    relay emits (``runner_proxy``, ``saved_session_lists``), so traffic of one
    caller can be counted without the other's.

    The request is published as an ``http_request`` envelope on the runner's
    Redis command channel and the matching ``command_response`` is awaited, so
    the relay works across horizontally-scaled backend replicas.
    """
    # Lazy imports keep the module import graph light.
    from app.services.runner import RunnerCommandTimeoutError
    from app.services.runner_websocket_manager import (
        get_runner_websocket_manager,
    )

    # 1. Resolve the device routing over coord's HTTP boundary (Phase 3 of
    # ``2026-05-30-web-coord-schema-boundary-decoupling.md``). Replaces the
    # former direct ``SELECT device_id, ws_session_id FROM coord.devices
    # WHERE device_id=:id AND user_id=:uid AND capability_user_paired`` —
    # coord now owns that ownership-checked read behind
    # ``GET /coord/devices/:id/routing`` (scoped by ``x-qontinui-user-id``).
    # Coord's 404 (device not owned) maps to ``row is None``, the same
    # signal the prior query carried. Coord transport faults surface as the
    # 502/504 ``HTTPException`` from the client; any other unexpected error
    # preserves the prior 500-on-lookup-error posture (a real fault, not a
    # relay-connectivity problem).
    try:
        row = await coord_device.get_device_routing(
            device_id,
            bearer=bearer,
            user_id=user_id,
        )
    except HTTPException:
        # 502/504 transport mapping from the coord client — re-raise so
        # FastAPI renders the gateway error verbatim.
        raise
    except Exception:
        logger.exception(
            "runner_proxy_relay_device_lookup_failed",
            device_id=str(device_id),
            caller=caller,
        )
        return LookupFailed(device_id=device_id)

    if row is None:
        return NotOwned(device_id=device_id)
    if row.get("ws_session_id") is None:  # ws_session_id IS NULL
        # The relay's single most common failure. Its 503 is rendered from
        # this outcome alone (:func:`relay_refusal_response`), so a reader
        # debugging a relay 503 has exactly one candidate cause.
        liveness = await _device_liveness(
            device_id, bearer=bearer, user_id=user_id, caller=caller
        )
        return NotConnected(device_id=device_id, liveness=liveness)

    # 2. Validate the path with the SSRF guard, then read and cap the body.
    try:
        validate_proxy_path(path)
    except ValueError as exc:
        return InvalidRequest(status_code=400, detail=str(exc))
    if not isinstance(body, bytes):
        body = await body()
    if len(body) > RELAY_MAX_BODY_BYTES:
        return InvalidRequest(
            status_code=413, detail="request body exceeds relay size cap"
        )

    # 3. Build the filtered request headers (lowercased keys, drop hop-by-hop
    #    + every ambient credential — never forward the user's bearer to the
    #    runner — and the browser's provenance headers).
    fwd_headers = {
        k.lower(): v
        for k, v in headers
        if k.lower() not in RELAY_EXCLUDED_REQUEST_HEADERS
        and not is_browser_provenance_header(k)
    }

    # 4. Build the http_request envelope (top-level type — see wire contract).
    body_b64 = base64.b64encode(body).decode("ascii") if body else ""
    envelope: dict[str, str | dict[str, str]] = {
        "type": "http_request",
        "method": method,
        "path": path,
        "query": query,
        "headers": fwd_headers,
        "body_b64": body_b64,
    }

    request_id = str(uuid4())
    redis_client = await get_redis()
    manager = await get_runner_websocket_manager(redis_client)

    started = time.monotonic()
    logger.info(
        "runner_proxy_relay_dispatch",
        caller=caller,
        device_id=str(device_id),
        request_id=request_id,
        method=method,
        path=path,
        timeout_s=timeout_s,
        body_bytes=len(body),
    )

    # 5. Dispatch over the WS bridge and await the matching response.
    #
    # ``require_local_connection=False`` is what makes this relay work across
    # horizontally-scaled replicas, and it also means ``dispatch_and_wait``
    # cannot raise ``RunnerNotConnectedError`` here — the raise in
    # ``app/services/runner/command_relay.py`` is gated on that same flag. So
    # this function has exactly ONE not-connected outcome: the
    # ``ws_session_id IS NULL`` branch above. Do not add an unreachable
    # ``except`` arm back; a reader debugging a relay 503 must have one
    # candidate cause, not two.
    try:
        reply = await manager.relay.dispatch_and_wait(
            str(device_id),
            envelope,
            request_id=request_id,
            timeout_s=timeout_s,
            require_local_connection=False,
        )
    except RunnerCommandTimeoutError:
        elapsed_ms = (time.monotonic() - started) * 1000.0
        logger.error(
            "runner_proxy_relay_timeout",
            caller=caller,
            device_id=str(device_id),
            request_id=request_id,
            path=path,
            elapsed_ms=round(elapsed_ms, 1),
        )
        return Timeout(elapsed_ms=elapsed_ms)

    # 6. Translate the command_response reply.
    status_code = reply.get("status", 200)
    try:
        status_code = int(status_code)
    except (TypeError, ValueError):
        status_code = 200

    reply_body_b64 = reply.get("body_b64", "") or ""
    try:
        resp_content = base64.b64decode(reply_body_b64) if reply_body_b64 else b""
    except (binascii.Error, ValueError):
        logger.error(
            "runner_proxy_relay_bad_response_b64",
            caller=caller,
            device_id=str(device_id),
            request_id=request_id,
        )
        return UndecodableReply()

    if len(resp_content) > RELAY_MAX_BODY_BYTES:
        return ReplyTooLarge(size=len(resp_content))

    reply_headers = reply.get("headers") or {}
    resp_headers = {
        k: v
        for k, v in reply_headers.items()
        if k.lower() not in RELAY_EXCLUDED_RESPONSE_HEADERS
    }

    elapsed_ms = (time.monotonic() - started) * 1000.0
    logger.info(
        "runner_proxy_relay",
        caller=caller,
        device_id=str(device_id),
        request_id=request_id,
        method=method,
        path=path,
        status=status_code,
        elapsed_ms=round(elapsed_ms, 1),
    )

    return Reply(status=status_code, headers=resp_headers, body=resp_content)


# ---------------------------------------------------------------------------
# Rendering the device refusals
# ---------------------------------------------------------------------------


def relay_request_id(request: Request) -> str:
    """The correlation id for this HTTP request.

    ``RequestIDMiddleware`` (``app/middleware/request_id.py``, registered in
    ``main.py``) already owns a per-request id: it honours an inbound
    ``X-Request-ID``, binds it into the structlog contextvars every line of
    the request inherits, stashes it on ``request.state.request_id``, and
    echoes it back in the ``X-Request-ID`` response header.

    Minting a *fresh* ``uuid4()`` here instead — as the relay's 503 arm first
    did — breaks the very workflow the id exists for. The value in the body
    would disagree with the ``X-Request-ID`` header on the same response, and
    passing it as an explicit ``request_id=`` log kwarg *overrides* the
    contextvar of the same name, so the one line naming the failure could no
    longer be joined to ``request_started``/``request_completed`` for that
    request. Grepping the id the client shows would return exactly one line
    and nothing around it.

    The fallback matters and is reached two ways: a ``Request`` built directly
    in a unit test has no ``state`` attribute at all, and a real one that
    somehow bypassed the middleware has a ``state`` with no ``request_id``.
    Both must yield a usable id rather than an ``AttributeError`` — this runs
    on an error path, where raising would replace a correct 404/503 with a
    500.
    """
    state = getattr(request, "state", None)
    request_id = getattr(state, "request_id", None)
    return request_id if isinstance(request_id, str) and request_id else str(uuid4())


def liveness_fields(liveness: DeviceLiveness) -> dict[str, object]:
    """The liveness clocks as they appear on the not-connected 503 body.

    Present only when the coord read actually answered. A failed lookup
    leaves both keys off entirely rather than sending ``null``, because
    ``null`` already carries a strong meaning here — the column is NULL, so
    the runner has never registered — and a lookup that failed has no basis
    for that claim. See :class:`DeviceLiveness`. Callers spread the SAME
    value into their log line, so a log query and the body cannot disagree
    about what was known: a ``ws_connected_at=None`` log kwarg would make one
    query return the never-registered rows and the coord-outage rows
    together.
    """
    if not liveness.known:
        return {}
    return {
        # The claim clock — how long ago the runner last held a WS session.
        # This is what separates "never registered" (``null``) from
        # "flapping right now" (seconds ago).
        "ws_connected_at": liveness.ws_connected_at,
        # The heartbeat clock. A different fact; see ``_device_liveness``.
        "last_seen_at": liveness.last_seen_at,
    }


def relay_refusal_response(outcome: DeviceRefusal, *, request_id: str) -> JSONResponse:
    """The relay's refusal for a device it cannot reach, as an HTTP response.

    One renderer for every caller, so the saved-session-lists capture serves
    exactly the body ``runner_proxy`` always has: ``detail`` keeps its prior
    value for older mobile builds and the rest is additive (``device_id``,
    ``request_id``, the liveness clocks, and the typed ``refusal`` envelope).
    ``request_id`` is the middleware's id (:func:`relay_request_id`).
    """
    if isinstance(outcome, NotOwned):
        # A device this caller does not own becomes theirs by pairing it.
        refusal = build_refusal(
            RefusalCode.not_found,
            NextActionKind.pair_device,
            "device not found or not owned by caller",
            discriminator="device_not_owned",
            glossary_terms=[GlossaryTerm.device],
        )
        return JSONResponse(
            status_code=404,
            # Additive, exactly as on the 503: ``detail`` keeps its prior value.
            content={
                "detail": "device not found or not owned by caller",
                "device_id": str(outcome.device_id),
                "request_id": request_id,
                REFUSAL_KEY: refusal_payload(refusal),
            },
        )
    if isinstance(outcome, NotConnected):
        # Both arms are reached only for a device row this caller OWNS, so the
        # device is already paired; pairing it again is a finished step and
        # cannot help. What differs is the runner on it:
        #
        # * never registered (``ws_connected_at`` is null): its runner has
        #   never opened the relay WebSocket. Waiting will not change that.
        #   Someone has to start the runner on that device, sign it in, and
        #   turn its cloud relay on, so the next action is that setting, and
        #   the sentence says the rest.
        # * connected before: it is expected back, so the same request later
        #   is the next step. An unknown liveness is not "never registered"
        #   either. It takes the retry arm, which is right for every runner
        #   seen before.
        liveness = outcome.liveness
        never_registered = liveness.known and liveness.ws_connected_at is None
        if never_registered:
            refusal = build_refusal(
                RefusalCode.device_not_connected,
                NextActionKind.set_setting,
                _NEVER_REGISTERED_SENTENCE,
                discriminator="runner_never_registered",
                target=RELAY_SETTING_TARGET,
                glossary_terms=[GlossaryTerm.runner, GlossaryTerm.device],
            )
        else:
            refusal = build_refusal(
                RefusalCode.device_not_connected,
                NextActionKind.retry_later,
                "runner not connected",
                discriminator="runner_not_connected",
                glossary_terms=[GlossaryTerm.runner, GlossaryTerm.device],
            )
        # The extra fields are ADDITIVE and optional — ``detail`` keeps its
        # exact prior value so an older mobile build is unaffected.
        return JSONResponse(
            status_code=503,
            content={
                "detail": "runner not connected",
                "device_id": str(outcome.device_id),
                "request_id": request_id,
                **liveness_fields(liveness),
                REFUSAL_KEY: refusal_payload(refusal),
            },
        )
    # LookupFailed: an unexpected lookup error is OUR fault — the 500 says so
    # (``report_defect``) rather than inviting a retry or a re-pair.
    refusal = build_refusal(
        RefusalCode.internal_error,
        NextActionKind.report_defect,
        "device lookup failed",
        discriminator="device_lookup_failed",
        glossary_terms=[GlossaryTerm.device],
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "device lookup failed",
            REFUSAL_KEY: refusal_payload(refusal),
        },
    )
