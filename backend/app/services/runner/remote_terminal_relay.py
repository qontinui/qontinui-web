"""Device-authed remote-terminal origination door (D6 broker, Phase 3b).

Plan ``2026-08-31-remote-session-tabs-in-runner-terminal``, design decision
D6 / transport B1. A SOURCE device (a runner whose operator clicked *Attach*
on a fleet session) speaks the ``remote_terminal_*`` family on its existing
``WS /api/v1/devices/ws`` socket. This module:

1. **verifies the grant** coord minted — the same JWKS verifier
   ``devices_ws`` uses for the device token itself — and refuses with a typed
   ``error`` code when the grant is not the kind the frame needs, is expired,
   or was minted for a different source device;
2. **claims and registers the attachment** in Redis (multi-replica): the grant
   is claimed atomically (``SET NX EXAT``) so one grant admits ONE live
   attachment on ONE socket, and once the target names the terminal the
   ``(target_device_id, terminal_id)`` route is claimed by one atomic
   server-side script so two grants can never hold one terminal;
3. **forwards** to the TARGET device through the existing runner-direction
   terminal channel (``TerminalRelayService.send_terminal_to_runner`` via
   ``manager.send_terminal``) with a ``remote`` block attached, so the PTY
   owner can enforce the grant itself;
4. **routes the return path** — the target's ``terminal_attached`` /
   ``terminal_output`` / ``terminal_exit`` / ``terminal_buffer_response`` /
   correlated ``error`` — to the ONE attached source socket, filtered by
   terminal id, never to every watcher.

The backend never decides *who may attach*: it checks a token coord minted.
The operator-web path (``runner_terminal_ws.py`` + mobile watchers) is
byte-for-byte unchanged — frames that only the remote path consumes travel on
a remote-only Redis channel, and frames the mobile path already publishes are
merely *also* consumed here.

Binding happens on ``terminal_attached``, not on the grant
------------------------------------------------------------
A grant may NAME a terminal (``attach.terminal_id``). That claim is forwarded
to the target as a hint in the ``remote`` block and nothing else: no return
route is registered and no ``remote_terminal_input`` is admitted until the
TARGET answers ``terminal_attached`` naming the terminal it actually bound.
Until then the attachment is registered by grant only.

Return-route keying
-------------------
The source socket's replica subscribes to the target's existing
``runner:terminal_response:{target_device_id}`` channel (where
``devices_ws`` already publishes every ``terminal_output`` / ``terminal_exit``
/ ``terminal_buffer_response`` / request-correlated ``error``) plus the
remote-only ``runner:remote_terminal_response:{target_device_id}`` channel
(``terminal_attached``, and refusals correlated by ``remote`` rather than
``request_id``). Frames are matched to this socket's attachments by
``terminal_id`` (streaming frames), by a ``request_id`` this module MINTED
(RPC replies), or — for a target frame the target itself marked with the
grant, such as the unsolicited ring it sends when a flow RESUME had withheld
output — by that ``grant_jti``. The source's own ``request_id`` is never put
on the wire to the target, because every watcher of the target shares that
channel and two sources choosing equal ids would otherwise cross-bind. One
frame on that channel is matched by NEITHER: ``runner_disconnected``, which
``RunnerWebSocketManager.unregister`` publishes device-wide when the target's
own socket goes — it settles every attachment this socket holds on that
target, because an attach the target can no longer answer has nothing else
left to settle it. Anything else on the channel is ignored. The Redis registry —
``remote_attach:claim:{grant_jti}`` → ``source_device_id`` (the atomic
single-use claim), ``remote_attach:grant:{grant_jti}`` → the full attachment
record, and ``remote_attach:{target_device_id}:{terminal_id}`` →
``{source_device_id, grant_jti, exp}`` — is the durable, replica-independent
record of who holds which terminal, expiring with the grant.
``release_source`` deletes all three, so a source that reconnects re-presents
its grant successfully once the old socket has torn down; a re-presentation
that races the teardown reads ``attach_grant_consumed`` and retries.

Remote CREATE
-------------
Plan ``2026-09-11-headless-runner-parity-from-a-headed-runner`` adds a second
capability on the same socket: ``remote_terminal_create``, presented with a
``create_grant`` (addressed by target DEVICE, carrying no session) and
forwarded as ``terminal_create`` with ``remote.kind = "create"``. The target
answers ``terminal_created`` on the ordinary response channel, correlated by
the minted ``request_id``; the relay forwards it as ``remote_terminal_created``
with a declared ``coord_session_id`` and drops the grant, so driving the new
terminal needs a separate attach grant. A create grant admits no
session-scoped frame (``grant_wrong_kind``). Every refusal about a create
grant ITSELF — invalid, expired, wrong source, consumed — is spelled
``create_grant_*``. Other refusals a create can receive keep their shared
spellings — among them ``grant_wrong_kind``, ``attach_not_registered`` (a frame
naming a create grant this socket no longer holds),
``attach_verifier_unavailable``, ``attach_registry_unavailable``,
``target_not_connected`` and ``listener_lost``; that list is illustrative, not
exhaustive, so match on the code, not the prefix. Unlike attach, a create's
claim key is NOT deleted
on release — it expires with the grant, which is what single use means.

Remote END
----------
Plan ``2026-09-30-close-remote-sessions-from-the-local-runner`` adds
``remote_terminal_end``: END the session an ATTACH grant names (a graceful
``/exit`` on the target, or a hard close with ``force``), forwarded as
``terminal_end`` with the same ``remote`` block ``terminal_attach`` carries.
The target answers ``terminal_ended`` on the remote-only channel, correlated by
the minted ``request_id`` in ``pending_end``; the relay rebuilds it as
``remote_terminal_ended``. Two paths, kept apart in ``_handle_end``: an OPEN
TAB's bound grant (authorized like input, attachment left alone — a PTY that
closes is retired by ``terminal_exit``), and a FRESH grant for a session this
socket never attached to (verified, claimed, listened for, and ALWAYS released
when the round trip settles). An end the target does not answer within
``PENDING_END_TTL_SECONDS`` is answered ``end_reply_timeout``; one whose
target's relay socket dies, or whose return route is lost, is answered at once
``target_not_connected`` / ``listener_lost``. All three arrive as a
``remote_terminal_error`` and mean the outcome is UNKNOWN. While a fresh-grant
end is in flight every other frame naming that grant — detach included — is
refused ``end_already_pending``, and the expiry sweep leaves it alone.

Forward direction is replica-local
----------------------------------
The SOURCE → TARGET leg goes through the in-process connection registry
(``send_terminal_to_runner``): a target connected to ANOTHER replica reads
``target_not_connected`` here. That is the same limitation the mobile
terminal path has today (``runner_terminal_ws`` answers "Runner is not
connected." on the same local predicate); only the return path is
multi-replica through Redis pubsub.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any
from uuid import UUID, uuid4

import structlog
from qontinui_schemas.common import utc_now
from redis import asyncio as aioredis

from app.config.redis_config import get_redis
from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenExpiredError,
    CoordTokenInvalidError,
    coord_jwks_client,
    jwks_failure_log_fields,
)
from app.services.runner.remote_relay.protocol import (
    _HIGH_VOLUME_TARGET_FRAMES,
    _INLINE_RELAY_ERROR_CODES,
    ATTACH_GRANT_SUB_TYPE,
    CODE_BUFFER_BACKLOG,
    CODE_CREATE_GRANT_CONSUMED,
    CODE_CREATE_GRANT_EXPIRED,
    CODE_CREATE_GRANT_INVALID,
    CODE_CREATE_GRANT_WRONG_SOURCE,
    CODE_END_PENDING,
    CODE_END_TIMEOUT,
    CODE_GRANT_CONSUMED,
    CODE_GRANT_EXPIRED,
    CODE_GRANT_INVALID,
    CODE_GRANT_WRONG_KIND,
    CODE_GRANT_WRONG_SOURCE,
    CODE_LISTENER_LOST,
    CODE_NOT_REGISTERED,
    CODE_REGISTRY_UNAVAILABLE,
    CODE_TARGET_NOT_CONNECTED,
    CODE_TERMINAL_BUSY,
    CODE_VERIFIER_UNAVAILABLE,
    CREATE_GRANT_SUB_TYPE,
    END_OUTCOME_FALLBACK,
    END_OUTCOMES,
    INPUT_ACK_RELAY_OWNED_KEYS,
    INPUT_FORWARD_RELAY_OWNED_KEYS,
    KIND_ATTACH,
    KIND_CREATE,
    RELAY_ERROR_CODES,
    SOURCE_END_REPLY_FRAME_TYPE,
    SOURCE_FRAME_TYPES,
    SOURCE_INPUT_ACK_FRAME_TYPE,
    TARGET_CODE_ATTACH_GRANT_UNKNOWN,
    TARGET_CODE_FALLBACK,
    TARGET_CODE_MAX,
    TARGET_CODE_PREFIX,
    TARGET_END_REPLY_FRAME_TYPE,
    TARGET_ERROR_CODES,
    TARGET_INPUT_ACK_FRAME_TYPE,
    TARGET_MESSAGE_MAX,
    TARGET_REFUSAL_FRAME_TYPES,
    _is_remote_marked,
    _is_uuid,
    _prefix_is_disjoint_from_relay_codes,
    create_target_device_id,
    is_remote_only_target_frame,
    is_source_frame,
    namespace_target_code,
)
from app.services.runner.remote_relay.registry import (
    BIND_TERMINAL_SCRIPT,
    RELEASE_TERMINAL_SCRIPT,
    _eval,
    _hset,
    _maybe_await,
    claim_key,
    grant_key,
    remote_response_channel,
    response_channel,
    terminal_key,
)
from app.services.runner.remote_relay.state import (
    PENDING_BUFFER_MAX,
    PENDING_BUFFER_TTL_SECONDS,
    _Attachment,
    _Pending,
    _PendingEnd,
    _SourceSession,
)
from app.websockets.safe_send import BENIGN_SEND_EXCEPTIONS

logger = structlog.get_logger(__name__)

# The relay is the module facade: ``devices_ws`` and the tests read the wire
# vocabulary, the socket state and the registry primitives through it, so the
# names imported above from ``remote_relay`` are re-exported here (``__all__``).
# Re-exported for READING only. To PATCH one, patch the module that defines it
# (``remote_relay.protocol`` / ``.state`` / ``.registry``): code reads a name
# from its own module's globals at call time, so a patch on this facade does
# not reach code that lives there.
__all__ = [
    "ATTACH_GRANT_SUB_TYPE",
    "BIND_TERMINAL_SCRIPT",
    "CODE_BUFFER_BACKLOG",
    "CODE_CREATE_GRANT_CONSUMED",
    "CODE_CREATE_GRANT_EXPIRED",
    "CODE_CREATE_GRANT_INVALID",
    "CODE_CREATE_GRANT_WRONG_SOURCE",
    "CODE_END_PENDING",
    "CODE_END_TIMEOUT",
    "CODE_GRANT_CONSUMED",
    "CODE_GRANT_EXPIRED",
    "CODE_GRANT_INVALID",
    "CODE_GRANT_WRONG_KIND",
    "CODE_GRANT_WRONG_SOURCE",
    "CODE_LISTENER_LOST",
    "CODE_NOT_REGISTERED",
    "CODE_REGISTRY_UNAVAILABLE",
    "CODE_TARGET_NOT_CONNECTED",
    "CODE_TERMINAL_BUSY",
    "CODE_VERIFIER_UNAVAILABLE",
    "CREATE_GRANT_SUB_TYPE",
    "END_OUTCOMES",
    "END_OUTCOME_FALLBACK",
    "INPUT_ACK_RELAY_OWNED_KEYS",
    "INPUT_FORWARD_RELAY_OWNED_KEYS",
    "KIND_ATTACH",
    "KIND_CREATE",
    "PENDING_BUFFER_MAX",
    "PENDING_BUFFER_TTL_SECONDS",
    "RELAY_ERROR_CODES",
    "RELEASE_TERMINAL_SCRIPT",
    "RemoteTerminalRelay",
    "SOURCE_END_REPLY_FRAME_TYPE",
    "SOURCE_FRAME_TYPES",
    "SOURCE_INPUT_ACK_FRAME_TYPE",
    "TARGET_CODE_ATTACH_GRANT_UNKNOWN",
    "TARGET_CODE_FALLBACK",
    "TARGET_CODE_MAX",
    "TARGET_CODE_PREFIX",
    "TARGET_END_REPLY_FRAME_TYPE",
    "TARGET_ERROR_CODES",
    "TARGET_INPUT_ACK_FRAME_TYPE",
    "TARGET_MESSAGE_MAX",
    "TARGET_REFUSAL_FRAME_TYPES",
    "_Attachment",
    "_HIGH_VOLUME_TARGET_FRAMES",
    "_INLINE_RELAY_ERROR_CODES",
    "_Pending",
    "_PendingEnd",
    "_SourceSession",
    "_eval",
    "_hset",
    "_is_remote_marked",
    "_is_uuid",
    "_maybe_await",
    "_prefix_is_disjoint_from_relay_codes",
    "claim_key",
    "create_target_device_id",
    "get_relay",
    "grant_key",
    "handle_source_frame",
    "is_remote_only_target_frame",
    "is_source_frame",
    "namespace_target_code",
    "publish_target_frame",
    "release_source",
    "remote_response_channel",
    "response_channel",
    "terminal_key",
]


# The two tunables below stay in THIS module, not in ``remote_relay``, because the
# code that reads them lives here and reads them from this module's globals at
# call time; tests patch them here (``monkeypatch.setattr(rtr, ...)``).

# How long to wait before the single re-present.
# (The re-present itself is described at ``TARGET_CODE_ATTACH_GRANT_UNKNOWN`` in
# ``remote_relay/protocol.py``.)
#
# Bounded from above by the SOURCE's ``ATTACH_TIMEOUT`` of 20 s: the re-present
# has to be forwarded, answered and routed back inside that budget or the
# source has already given up and the frame buys nothing. 3 s leaves ~17 s for
# the round trip, which is the whole point of picking a figure well under the
# ceiling rather than one close to it. It is also long enough to be a genuine
# second look on a target that re-reads coord on demand, where the answer turns
# over in well under a second.
ATTACH_REPRESENT_DELAY_SECONDS = 3.0

# How long an unanswered ``terminal_end`` stays correlatable before the source
# is told ``end_reply_timeout``. One fixed ladder, stated in one place:
#
#   target graceful-exit deadline (60 s) < THIS (75 s) < source timeout (90 s)
#
# Deliberately NOT ``PENDING_BUFFER_TTL_SECONDS``: that is 60 s, EQUAL to the
# target's default deadline, so a graceful exit that used its whole budget
# would race the relay's give-up and the source would read a typed timeout for
# an end that in fact succeeded. Above the target so its answer always has room
# to arrive; below the source so the source hears the relay's verdict rather
# than its own silence. Read at call time, so tests can shorten it.
PENDING_END_TTL_SECONDS = 75.0


class RemoteTerminalRelay:
    """Broker between a SOURCE device socket and a TARGET device's terminals."""

    def __init__(self, redis_client: aioredis.Redis | None = None) -> None:
        self._redis = redis_client
        # id(websocket) -> session. The socket object is the identity: one
        # device may reconnect (new socket, same device_id) while the old
        # session is still tearing down.
        self._sessions: dict[int, _SourceSession] = {}
        # Listener finishers spawned from inside the listener they stop; held
        # so the event loop cannot garbage-collect them mid-flight.
        self._background: set[asyncio.Task[None]] = set()

    # ------------------------------------------------------------------
    # Plumbing
    # ------------------------------------------------------------------

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = await get_redis()
        return self._redis

    def _session_for(
        self, websocket: Any, device_id: Any, manager: Any
    ) -> _SourceSession:
        key = id(websocket)
        session = self._sessions.get(key)
        if session is None:
            session = _SourceSession(
                websocket=websocket, device_id=str(device_id), manager=manager
            )
            self._sessions[key] = session
        return session

    async def _send_to_source(
        self, session: _SourceSession, payload: dict[str, Any]
    ) -> None:
        """Serialized send to the source socket (listener task + router share it)."""
        async with session.send_lock:
            try:
                await session.websocket.send_json(payload)
            except BENIGN_SEND_EXCEPTIONS as exc:
                logger.info(
                    "remote_terminal_source_gone",
                    source_device_id=session.device_id,
                    frame_type=payload.get("type"),
                    error=str(exc),
                )

    async def _refuse(
        self,
        session: _SourceSession,
        code: str,
        message: str,
        *,
        request_id: Any = None,
        grant_jti: str | None = None,
        terminal_id: Any = None,
    ) -> None:
        payload: dict[str, Any] = {"type": "error", "code": code, "message": message}
        if request_id is not None:
            payload["request_id"] = request_id
        if grant_jti is not None:
            payload["grant_jti"] = grant_jti
        if isinstance(terminal_id, str):
            payload["terminal_id"] = terminal_id
        logger.warning(
            "remote_terminal_refused",
            source_device_id=session.device_id,
            code=code,
            request_id=request_id,
            grant_jti=grant_jti,
        )
        await self._send_to_source(session, payload)

    # ------------------------------------------------------------------
    # SOURCE → TARGET
    # ------------------------------------------------------------------

    async def handle_source_frame(
        self,
        msg: dict[str, Any],
        device_id: Any,
        manager: Any,
        websocket: Any,
    ) -> None:
        """Dispatch one ``remote_terminal_*`` frame from the connected SOURCE."""
        msg_type = msg.get("type")
        if websocket is None:
            logger.warning(
                "remote_terminal_no_socket",
                source_device_id=str(device_id),
                msg_type=msg_type,
            )
            return
        session = self._session_for(websocket, device_id, manager)
        # The grant THIS frame names is left to ``_authorize``, which answers
        # its expiry as a refusal correlated to the frame's own request id.
        named = msg.get("grant_jti")
        await self._reap_expired(
            session, except_jti=named if isinstance(named, str) else None
        )

        if msg_type == "remote_terminal_attach":
            await self._handle_attach(session, msg)
        elif msg_type == "remote_terminal_create":
            await self._handle_create(session, msg)
        elif msg_type == "remote_terminal_end":
            await self._handle_end(session, msg)
        elif msg_type == "remote_terminal_input":
            att = await self._authorize(session, msg)
            if att is not None:
                # The WHOLE source frame minus the keys the relay owns — see
                # ``INPUT_FORWARD_RELAY_OWNED_KEYS``. ``seq`` and ``probe``
                # ride here, and so does any field a newer source adds.
                await self._forward(
                    session,
                    msg,
                    att,
                    "terminal_input",
                    {
                        key: value
                        for key, value in msg.items()
                        if key not in INPUT_FORWARD_RELAY_OWNED_KEYS
                    },
                )
        elif msg_type == "remote_terminal_resize":
            att = await self._authorize(session, msg)
            if att is not None:
                await self._forward(
                    session,
                    msg,
                    att,
                    "terminal_resize",
                    {"cols": msg.get("cols"), "rows": msg.get("rows")},
                )
        elif msg_type == "remote_terminal_buffer":
            att = await self._authorize(session, msg)
            if att is not None:
                minted = uuid4().hex
                source_request_id = msg.get("request_id")
                extra: dict[str, Any] = {"request_id": minted}
                # Phase 5 lazy scrollback asks for an absolute HALF-OPEN range,
                # and the target reads both ends (`handle_terminal_buffer`).
                # Forwarding only the lower bound turns `[from, to)` into
                # `[from, end-of-ring)`: the operator asks for the window above
                # the attach seed and is answered with the whole ring.
                for bound in ("from_offset", "to_offset"):
                    if msg.get(bound) is not None:
                        extra[bound] = msg.get(bound)
                # Bound the correlation table before adding to it. This is the
                # ONLY insertion point, so sweeping here is sufficient to keep
                # it bounded: nothing else grows it. See
                # ``PENDING_BUFFER_TTL_SECONDS`` / ``PENDING_BUFFER_MAX``.
                now = time.monotonic()
                swept = session.sweep_pending_buffer(now)
                if swept:
                    logger.info(
                        "remote_terminal_buffer_rpc_timed_out",
                        source_device_id=session.device_id,
                        grant_jti=att.grant_jti,
                        dropped=len(swept),
                    )
                if len(session.pending_buffer) >= PENDING_BUFFER_MAX:
                    await self._refuse(
                        session,
                        CODE_BUFFER_BACKLOG,
                        "too many scrollback requests are still unanswered on "
                        "this connection",
                        request_id=source_request_id,
                        grant_jti=att.grant_jti,
                        terminal_id=att.terminal_id,
                    )
                    return
                # Register BEFORE forwarding: the reply can race back on the
                # listener before ``send_terminal`` returns.
                session.pending_buffer[minted] = (
                    source_request_id if isinstance(source_request_id, str) else None,
                    att.grant_jti,
                )
                session.pending_buffer_deadline[minted] = (
                    now + PENDING_BUFFER_TTL_SECONDS
                )
                if not await self._forward(session, msg, att, "terminal_buffer", extra):
                    session.pending_buffer.pop(minted, None)
                    session.pending_buffer_deadline.pop(minted, None)
        elif msg_type == "remote_terminal_flow":
            # Retyped to `terminal_flow`, the spelling the target's handler is
            # named for. The target accepts either, so this translation is
            # belt-and-braces on the SPELLING — but it is load-bearing on
            # ADMISSION: the frame reaches the target only because this arm
            # exists. Gated exactly like `terminal_input` (`require_bound`
            # default): a flow frame for a terminal this grant does not hold
            # must not pause someone else's pane.
            att = await self._authorize(session, msg)
            if att is not None:
                await self._forward(
                    session, msg, att, "terminal_flow", {"paused": msg.get("paused")}
                )
        elif msg_type == "remote_terminal_detach":
            # Admitted on the grant alone: a source may give up an attach the
            # target never answered, and stranding that grant until expiry
            # would be the only alternative.
            att = await self._authorize(
                session,
                msg,
                require_bound=False,
                require_attach_kind=False,
                settle_waiter=False,
            )
            if att is not None:
                await self._detach_target(session, att, att.terminal_id)
                await self._drop_attachment(session, att)

    async def _verify_grant(
        self,
        session: _SourceSession,
        msg: dict[str, Any],
        *,
        sub_type: str,
        kind_noun: str,
        code_invalid: str,
        code_expired: str,
        code_wrong_source: str,
    ) -> tuple[dict[str, Any], str, str, int] | None:
        """Verify the capability token on a source frame; ``None`` when refused.

        Everything an attach grant and a create grant are checked for
        identically: the SAME JWKS verifier that admitted this socket, the
        declared ``sub_type``, the source device (taken from the authenticated
        socket, never from a body field), expiry, and a usable ``jti``. Shared
        rather than copied because the create door is exactly the kind of
        second caller that silently grows a weaker check than the first.

        Returns ``(claims, jti, socket_source, exp)``.
        """
        request_id = msg.get("request_id")
        grant = msg.get("grant")
        if not isinstance(grant, str) or not grant:
            await self._refuse(
                session, code_invalid, "grant missing", request_id=request_id
            )
            return None

        try:
            claims = await coord_jwks_client.verify_token(grant)
        except CoordTokenExpiredError as exc:
            await self._refuse(session, code_expired, str(exc), request_id=request_id)
            return None
        except CoordTokenInvalidError as exc:
            await self._refuse(session, code_invalid, str(exc), request_id=request_id)
            return None
        except CoordJWKSUnavailableError as exc:
            # Same shared field set as every other terminating JWKS handler
            # (URL dialled, the SETTING that produced it, exception class and
            # chained cause): ``error=str(exc)`` alone cannot separate a wrong
            # coord URL from an unreachable coord.
            logger.error(
                "remote_terminal_verifier_unavailable",
                source_device_id=session.device_id,
                **jwks_failure_log_fields(exc),
            )
            await self._refuse(
                session,
                CODE_VERIFIER_UNAVAILABLE,
                "grant verifier temporarily unavailable",
                request_id=request_id,
            )
            return None

        if claims.get("sub_type") != sub_type:
            await self._refuse(
                session,
                code_invalid,
                f"token is not {kind_noun}",
                request_id=request_id,
            )
            return None

        # The grant is bound to the SOURCE device coord minted it for, and the
        # source is whoever authenticated THIS socket — never a body field.
        try:
            grant_source = str(UUID(str(claims.get("device_id"))))
            socket_source = str(UUID(session.device_id))
        except (ValueError, TypeError):
            await self._refuse(
                session,
                code_invalid,
                "grant device_id malformed",
                request_id=request_id,
            )
            return None
        if grant_source != socket_source:
            await self._refuse(
                session,
                code_wrong_source,
                "grant was minted for a different source device",
                request_id=request_id,
            )
            return None

        exp = claims.get("exp")
        if not isinstance(exp, int | float) or exp <= time.time():
            await self._refuse(
                session, code_expired, "grant expired", request_id=request_id
            )
            return None

        jti = claims.get("jti")
        if not isinstance(jti, str) or not jti:
            await self._refuse(
                session, code_invalid, "grant missing jti", request_id=request_id
            )
            return None
        return claims, jti, socket_source, int(exp)

    async def _attach_target(
        self, session: _SourceSession, claims: dict[str, Any], request_id: Any
    ) -> tuple[str, str, str | None] | None:
        """The ``attach`` claims of a verified attach grant; ``None`` when refused.

        Returns ``(target_device_id, target_session_id, requested_terminal_id)``.
        Shared by attach and end, so the fresh-grant end path cannot grow a
        weaker reading of the same token.
        """
        attach = claims.get("attach")
        if not isinstance(attach, dict):
            await self._refuse(
                session,
                CODE_GRANT_INVALID,
                "grant missing attach claims",
                request_id=request_id,
            )
            return None
        try:
            target_device_id = str(UUID(str(attach.get("target_device_id"))))
            target_session_id = str(UUID(str(attach.get("target_session_id"))))
        except (ValueError, TypeError):
            await self._refuse(
                session,
                CODE_GRANT_INVALID,
                "grant attach target malformed",
                request_id=request_id,
            )
            return None
        raw_terminal_id = attach.get("terminal_id")
        requested_terminal_id = (
            raw_terminal_id if isinstance(raw_terminal_id, str) else None
        )
        return target_device_id, target_session_id, requested_terminal_id

    async def _handle_attach(
        self, session: _SourceSession, msg: dict[str, Any]
    ) -> None:
        request_id = msg.get("request_id")
        verified = await self._verify_grant(
            session,
            msg,
            sub_type=ATTACH_GRANT_SUB_TYPE,
            kind_noun="an attach grant",
            code_invalid=CODE_GRANT_INVALID,
            code_expired=CODE_GRANT_EXPIRED,
            code_wrong_source=CODE_GRANT_WRONG_SOURCE,
        )
        if verified is None:
            return
        claims, jti, socket_source, exp = verified

        target = await self._attach_target(session, claims, request_id)
        if target is None:
            return
        target_device_id, target_session_id, requested_terminal_id = target

        # A grant is single use on this socket too — the Redis claim below
        # would refuse it anyway, but that message would blame "another"
        # attachment for what is a re-presentation.
        if jti in session.grants:
            await self._refuse(
                session,
                CODE_GRANT_CONSUMED,
                "grant already presented on this socket",
                request_id=request_id,
                grant_jti=jti,
            )
            return

        att = _Attachment(
            grant_jti=jti,
            source_device_id=socket_source,
            target_device_id=target_device_id,
            target_session_id=target_session_id,
            exp=int(exp),
            request_id=request_id if isinstance(request_id, str) else None,
            requested_terminal_id=requested_terminal_id,
        )
        # The id on the wire to the target is OURS: every watcher of the
        # target shares its response channel, and the reply is correlated by
        # this id alone.
        minted = uuid4().hex

        # Claim + register BEFORE forwarding: the target's reply can race back
        # on the listener before ``send_terminal`` returns. Every await in
        # here talks to Redis; a failure is a typed refusal on this socket,
        # never an exception into the device loop (which would tear the
        # source's whole socket down).
        claimed = False
        try:
            claimed = await self._claim_grant(att)
            if claimed:
                await self._write_grant_record(att)
                session.grants[jti] = att
                session.pending_attach[minted] = (att.request_id, jti)
                await self._ensure_listener(session, target_device_id)
        except Exception as exc:  # noqa: BLE001 - registry failure is a typed refusal
            logger.error(
                "remote_terminal_registry_unavailable",
                source_device_id=session.device_id,
                grant_jti=jti,
                error=str(exc),
                error_type=type(exc).__name__,
            )
            if claimed:
                await self._drop_attachment(session, att)
            await self._refuse(
                session,
                CODE_REGISTRY_UNAVAILABLE,
                "attachment registry temporarily unavailable",
                request_id=request_id,
                grant_jti=jti,
            )
            return
        if not claimed:
            await self._refuse(
                session,
                CODE_GRANT_CONSUMED,
                "grant is already held by a live attachment",
                request_id=request_id,
                grant_jti=jti,
            )
            return

        frame: dict[str, Any] = {
            "type": "terminal_attach",
            "request_id": minted,
            "cols": msg.get("cols"),
            "rows": msg.get("rows"),
            "remote": att.session_remote_block(),
            "timestamp": utc_now().isoformat(),
        }
        # A REATTACH carries `have_offset`: the absolute offset of the last byte
        # the source still holds. Dropping it here is not cosmetic — the target
        # reads its absence as "this source has nothing", ships the whole 64 KiB
        # ring tail, and the source then sees a gap where none existed and
        # writes a DATA-LOSS marker into the pane. Forwarded only when present,
        # so a first attach still takes the tail arm deliberately rather than by
        # omission.
        if msg.get("have_offset") is not None:
            frame["have_offset"] = msg.get("have_offset")
        # A COPY, taken before the send: the re-present must re-offer what the
        # source actually asked for, and the manager is handed the live dict.
        att.attach_frame = dict(frame)
        sent = await session.manager.send_terminal(target_device_id, frame)
        if not sent:
            await self._drop_attachment(session, att)
            await self._refuse(
                session,
                CODE_TARGET_NOT_CONNECTED,
                "target device is not connected",
                request_id=request_id,
                grant_jti=jti,
            )
            return
        logger.info(
            "remote_terminal_attach_forwarded",
            source_device_id=session.device_id,
            target_device_id=target_device_id,
            target_session_id=target_session_id,
            grant_jti=jti,
            request_id=request_id,
            forwarded_request_id=minted,
        )

    async def _handle_create(
        self, session: _SourceSession, msg: dict[str, Any]
    ) -> None:
        """Forward a remote ``terminal_create`` under a coord-minted CREATE grant.

        What this door does NOT decide is where the terminal lands. The frame's
        ``working_dir`` / ``working_dir_key`` / ``intent_repo`` are carried
        through verbatim as a PREFERENCE and the TARGET answers them from its
        own configuration, refusing anything outside it. Stripping them here
        would look safer and be worse: the policy would then live in two places
        and the source would be told its value was honoured when it was
        dropped. One enforcement point, and it is the machine that owns the
        PTY.
        """
        request_id = msg.get("request_id")
        verified = await self._verify_grant(
            session,
            msg,
            sub_type=CREATE_GRANT_SUB_TYPE,
            kind_noun="a create grant",
            code_invalid=CODE_CREATE_GRANT_INVALID,
            code_expired=CODE_CREATE_GRANT_EXPIRED,
            code_wrong_source=CODE_CREATE_GRANT_WRONG_SOURCE,
        )
        if verified is None:
            return
        claims, jti, socket_source, exp = verified

        target_device_id = create_target_device_id(claims)
        if target_device_id is None:
            await self._refuse(
                session,
                CODE_CREATE_GRANT_INVALID,
                "grant names no usable target device",
                request_id=request_id,
                grant_jti=jti,
            )
            return

        if jti in session.grants:
            await self._refuse(
                session,
                CODE_CREATE_GRANT_CONSUMED,
                "grant already presented on this socket",
                request_id=request_id,
                grant_jti=jti,
            )
            return

        att = _Attachment(
            grant_jti=jti,
            source_device_id=socket_source,
            target_device_id=target_device_id,
            # A create grant is about a session that does not exist yet.
            target_session_id=None,
            exp=exp,
            request_id=request_id if isinstance(request_id, str) else None,
            kind=KIND_CREATE,
        )
        minted = uuid4().hex

        claimed = False
        try:
            claimed = await self._claim_grant(att)
            if claimed:
                await self._write_grant_record(att)
                session.grants[jti] = att
                session.pending_create[minted] = (att.request_id, jti)
                await self._ensure_listener(session, target_device_id)
        except Exception as exc:  # noqa: BLE001 - registry failure is a typed refusal
            logger.error(
                "remote_terminal_registry_unavailable",
                source_device_id=session.device_id,
                grant_jti=jti,
                error=str(exc),
                error_type=type(exc).__name__,
            )
            if claimed:
                await self._drop_attachment(session, att)
            await self._refuse(
                session,
                CODE_REGISTRY_UNAVAILABLE,
                "attachment registry temporarily unavailable",
                request_id=request_id,
                grant_jti=jti,
            )
            return
        if not claimed:
            await self._refuse(
                session,
                CODE_CREATE_GRANT_CONSUMED,
                # Not "held by a live attachment": a create's claim outlives
                # the create on purpose (``_release_registry``), so nothing
                # need be live for this to fire.
                "grant already spent — a create grant is single use",
                request_id=request_id,
                grant_jti=jti,
            )
            return

        frame: dict[str, Any] = {
            "type": "terminal_create",
            "request_id": minted,
            "remote": att.remote_block(),
            "timestamp": utc_now().isoformat(),
        }
        # The caller's PREFERENCES, forwarded only when present so the target
        # can tell "no preference" (take your default) from "this one" (a
        # value it must recognise or refuse).
        for key in (
            "title",
            "cols",
            "rows",
            "working_dir_key",
            "working_dir",
            "intent_repo",
        ):
            if msg.get(key) is not None:
                frame[key] = msg.get(key)

        sent = await session.manager.send_terminal(target_device_id, frame)
        if not sent:
            await self._drop_attachment(session, att)
            await self._refuse(
                session,
                CODE_TARGET_NOT_CONNECTED,
                "target device is not connected",
                request_id=request_id,
                grant_jti=jti,
            )
            return
        logger.info(
            "remote_terminal_create_forwarded",
            source_device_id=session.device_id,
            target_device_id=target_device_id,
            grant_jti=jti,
            request_id=request_id,
            forwarded_request_id=minted,
        )

    # ------------------------------------------------------------------
    # END a remote session (plan
    # ``2026-09-30-close-remote-sessions-from-the-local-runner``, Phase 2)
    # ------------------------------------------------------------------

    async def _handle_end(self, session: _SourceSession, msg: dict[str, Any]) -> None:
        """Forward ``remote_terminal_end`` as ``terminal_end``. Two SEPARATE paths.

        * **Open tab** — the frame names (``grant_jti``) an attach grant already
          bound on this socket. Authorized exactly like input/resize and
          forwarded; the attachment is LEFT alone whatever the outcome. If the
          PTY does close, the target's ``terminal_exit`` retires it through the
          existing ``remote_terminal_exit`` + drop arm — ``_release_registry``
          is never reached for from here.
        * **Fresh grant** — the frame presents a grant token (``grant``) this
          socket holds no attachment for, to end a session it never attached
          to. ``_authorize`` would refuse it (nothing registered) and
          ``_handle_attach`` is the wrong door (it asks the target to BIND), so
          it is verified, claimed and given a return route here, marked
          ``end_only``, and dropped the moment the round trip settles — reply,
          refusal or TTL — so the Redis claim is never held to grant expiry.

        Either way the target receives the same frame, built by
        ``_forward_end``, and the grant's ``target_session_id`` — not anything
        on the wire — names the session the target resolves.
        """
        grant_jti = msg.get("grant_jti")
        registered = isinstance(grant_jti, str) and grant_jti in session.grants
        grant = msg.get("grant")
        if not registered and isinstance(grant, str) and grant:
            await self._end_with_fresh_grant(session, msg)
        else:
            await self._end_attached(session, msg)

    async def _end_attached(self, session: _SourceSession, msg: dict[str, Any]) -> None:
        """The open-tab path: an attach grant already bound on this socket."""
        grant_jti = msg.get("grant_jti")
        held = session.grants.get(grant_jti) if isinstance(grant_jti, str) else None
        if held is not None and held.end_only:
            # A fresh-grant end of this very grant is in flight; ``_authorize``
            # would answer the symptom ("nothing attached"), not the reason.
            await self._refuse(
                session,
                CODE_END_PENDING,
                "an end for this grant is still awaiting the target's answer",
                request_id=msg.get("request_id"),
                grant_jti=held.grant_jti,
            )
            return
        authorize_msg = msg
        if held is not None and held.attached and msg.get("terminal_id") is None:
            # ``terminal_id`` is optional on the end frame: a bound grant holds
            # exactly one terminal, so an omitted one means THAT terminal. A
            # frame that names a DIFFERENT one is still refused by
            # ``_authorize``.
            authorize_msg = {**msg, "terminal_id": held.terminal_id}
        att = await self._authorize(session, authorize_msg)
        if att is None:
            return
        await self._forward_end(session, msg, att, terminal_id=att.terminal_id)

    async def _end_with_fresh_grant(
        self, session: _SourceSession, msg: dict[str, Any]
    ) -> None:
        """The fresh-grant path: verify → claim → listen → forward → always drop."""
        request_id = msg.get("request_id")
        verified = await self._verify_grant(
            session,
            msg,
            sub_type=ATTACH_GRANT_SUB_TYPE,
            kind_noun="an attach grant",
            code_invalid=CODE_GRANT_INVALID,
            code_expired=CODE_GRANT_EXPIRED,
            code_wrong_source=CODE_GRANT_WRONG_SOURCE,
        )
        if verified is None:
            return
        claims, jti, socket_source, exp = verified
        held = session.grants.get(jti)
        if held is not None and held.end_only:
            # This very token is already ending its session on this socket.
            await self._refuse(
                session,
                CODE_END_PENDING,
                "an end for this grant is still awaiting the target's answer",
                request_id=request_id,
                grant_jti=jti,
            )
            return
        if held is not None:
            # The token of a grant this socket already holds, presented without
            # its ``grant_jti``: that is the open-tab path, not a second claim.
            await self._end_attached(session, {**msg, "grant_jti": jti})
            return

        target = await self._attach_target(session, claims, request_id)
        if target is None:
            return
        target_device_id, target_session_id, requested_terminal_id = target

        att = _Attachment(
            grant_jti=jti,
            source_device_id=socket_source,
            target_device_id=target_device_id,
            target_session_id=target_session_id,
            exp=exp,
            request_id=request_id if isinstance(request_id, str) else None,
            requested_terminal_id=requested_terminal_id,
            end_only=True,
        )
        claimed = False
        try:
            claimed = await self._claim_grant(att)
            if claimed:
                await self._write_grant_record(att)
                session.grants[jti] = att
                await self._ensure_listener(session, target_device_id)
        except Exception as exc:  # noqa: BLE001 - registry failure is a typed refusal
            logger.error(
                "remote_terminal_registry_unavailable",
                source_device_id=session.device_id,
                grant_jti=jti,
                error=str(exc),
                error_type=type(exc).__name__,
            )
            if claimed:
                await self._drop_attachment(session, att)
            await self._refuse(
                session,
                CODE_REGISTRY_UNAVAILABLE,
                "attachment registry temporarily unavailable",
                request_id=request_id,
                grant_jti=jti,
            )
            return
        if not claimed:
            await self._refuse(
                session,
                CODE_GRANT_CONSUMED,
                "grant is already held by a live attachment",
                request_id=request_id,
                grant_jti=jti,
            )
            return

        named = msg.get("terminal_id")
        if (
            not await self._forward_end(
                session, msg, att, terminal_id=named if isinstance(named, str) else None
            )
            and session.grants.get(jti) is att
        ):
            # Nothing is in flight, so nothing will settle it later. Dropped
            # only while it is still OURS: a ``runner_disconnected`` or listener
            # loss during the forward's await may already have evicted it, and
            # a second drop would delete the claim key unconditionally — by
            # then possibly a new claim on this jti from another socket.
            await self._drop_attachment(session, att)

    async def _forward_end(
        self,
        session: _SourceSession,
        msg: dict[str, Any],
        att: _Attachment,
        *,
        terminal_id: str | None,
    ) -> bool:
        """Send ``terminal_end`` under a minted id and arm its TTL; False if not sent.

        The frame is ``terminal_attach``'s shape — the same ``remote`` block
        (``session_remote_block``), a relay-MINTED ``request_id``, a
        ``timestamp`` — plus ``force`` and an optional top-level
        ``terminal_id`` the target only COMPARES against the terminal it
        resolves from the grant. ``force`` is true only when the source sent
        the JSON literal ``true``: anything else fails toward the graceful end.
        """
        request_id = msg.get("request_id")
        if any(e.grant_jti == att.grant_jti for e in session.pending_end.values()):
            await self._refuse(
                session,
                CODE_END_PENDING,
                "an end for this grant is still awaiting the target's answer",
                request_id=request_id,
                grant_jti=att.grant_jti,
                terminal_id=att.terminal_id,
            )
            return False
        minted = uuid4().hex
        force = msg.get("force") is True
        frame: dict[str, Any] = {
            "type": "terminal_end",
            "request_id": minted,
            "remote": att.session_remote_block(),
            "force": force,
            "timestamp": utc_now().isoformat(),
        }
        if terminal_id is not None:
            frame["terminal_id"] = terminal_id
        # Register BEFORE forwarding: the reply can race back on the listener
        # before ``send_terminal`` returns.
        session.pending_end[minted] = _PendingEnd(
            source_request_id=request_id if isinstance(request_id, str) else None,
            grant_jti=att.grant_jti,
            target_device_id=att.target_device_id,
            target_session_id=att.target_session_id,
            terminal_id=att.terminal_id if att.attached else None,
            end_only=att.end_only,
        )
        try:
            sent = await session.manager.send_terminal(att.target_device_id, frame)
        except Exception as exc:  # noqa: BLE001 - a dead target is a refusal
            logger.warning(
                "remote_terminal_end_forward_failed",
                grant_jti=att.grant_jti,
                target_device_id=att.target_device_id,
                error=str(exc),
            )
            sent = False
        if not sent:
            if session.pending_end.pop(minted, None) is None:
                # Already settled while the send was in flight (a
                # ``runner_disconnected`` answered it): the source has its one
                # answer, so a second refusal would only be noise it must drop.
                return False
            await self._refuse(
                session,
                CODE_TARGET_NOT_CONNECTED,
                "target device is not connected",
                request_id=request_id,
                grant_jti=att.grant_jti,
                terminal_id=att.terminal_id,
            )
            return False
        # Armed only while the entry is still unsettled: the reply can race
        # back on the listener before ``send_terminal`` returns, and a timer
        # armed for an already-settled id would idle out its whole TTL.
        if minted in session.pending_end:
            timer = asyncio.get_running_loop().create_task(
                self._expire_pending_end(session, minted)
            )
            session.pending_end_timers[minted] = timer
            self._background.add(timer)
            timer.add_done_callback(self._background.discard)
        logger.info(
            "remote_terminal_end_forwarded",
            source_device_id=session.device_id,
            target_device_id=att.target_device_id,
            target_session_id=att.target_session_id,
            grant_jti=att.grant_jti,
            request_id=request_id,
            forwarded_request_id=minted,
            force=force,
            fresh_grant=att.end_only,
        )
        return True

    def _cancel_end_timer(self, session: _SourceSession, wire_request_id: Any) -> None:
        """Disarm the TTL of a ``pending_end`` entry that has been settled."""
        if not isinstance(wire_request_id, str):
            return
        timer = session.pending_end_timers.pop(wire_request_id, None)
        if timer is not None and timer is not asyncio.current_task():
            timer.cancel()

    async def _expire_pending_end(self, session: _SourceSession, minted: str) -> None:
        """Answer an end the target never did with a TYPED error, not silence.

        The TTL is read from the module at call time so tests can shorten it.
        A fresh-grant attachment is dropped here too: this is the third of the
        three ways its round trip settles.
        """
        await asyncio.sleep(PENDING_END_TTL_SECONDS)
        session.pending_end_timers.pop(minted, None)
        entry = session.pending_end.pop(minted, None)
        if entry is None:
            return
        logger.warning(
            "remote_terminal_end_timed_out",
            source_device_id=session.device_id,
            grant_jti=entry.grant_jti,
            request_id=entry.source_request_id,
            forwarded_request_id=minted,
            ttl_seconds=PENDING_END_TTL_SECONDS,
        )
        await self._answer_end_and_release(
            session,
            entry,
            self._end_error_payload(
                entry,
                code=CODE_END_TIMEOUT,
                message="target did not answer the end request in time; "
                "its outcome is unknown",
            ),
        )

    @staticmethod
    def _end_error_payload(
        entry: _PendingEnd, *, code: str, message: str
    ) -> dict[str, Any]:
        """The ``remote_terminal_error`` a relay-settled end is answered with."""
        payload: dict[str, Any] = {
            "type": "remote_terminal_error",
            "grant_jti": entry.grant_jti,
            "code": code,
            "message": message,
        }
        if entry.source_request_id is not None:
            payload["request_id"] = entry.source_request_id
        if entry.terminal_id is not None:
            payload["terminal_id"] = entry.terminal_id
        return payload

    async def _answer_end_and_release(
        self, session: _SourceSession, entry: _PendingEnd, payload: dict[str, Any]
    ) -> None:
        """Send a settled end's answer, then release it — the release ALWAYS runs.

        ``_send_to_source`` swallows only the benign "socket already gone"
        exceptions; anything else propagates. Were the release sequenced after
        it rather than in ``finally``, such a send would leave a fresh-grant
        end's ``end_only`` attachment and its Redis claim held to grant expiry,
        and every later end of that grant refused ``end_already_pending``.
        """
        try:
            await self._send_to_source(session, payload)
        finally:
            await self._release_end_only(session, entry)

    async def _settle_pending_ends_on_target(
        self,
        session: _SourceSession,
        target_device_id: str,
        *,
        code: str,
        message: str,
    ) -> int:
        """Answer every end in flight to ``target_device_id`` NOW; return how many.

        For the two conditions under which no reply can arrive — the target's
        relay socket died (``runner_disconnected``) or this socket's return
        route did (listener lost). Waiting out ``PENDING_END_TTL_SECONDS`` would
        only delay the same UNKNOWN verdict by 75 s. Covers open-tab ends too,
        which ``_evict`` deliberately leaves in ``pending_end``.
        """
        settled = 0
        for rid, entry in list(session.pending_end.items()):
            if entry.target_device_id != target_device_id:
                continue
            if session.pending_end.pop(rid, None) is None:
                continue
            self._cancel_end_timer(session, rid)
            settled += 1
            logger.info(
                "remote_terminal_end_settled_by_relay",
                source_device_id=session.device_id,
                target_device_id=target_device_id,
                grant_jti=entry.grant_jti,
                request_id=entry.source_request_id,
                forwarded_request_id=rid,
                code=code,
            )
            await self._answer_end_and_release(
                session,
                entry,
                self._end_error_payload(entry, code=code, message=message),
            )
        return settled

    def _pop_pending_end(
        self, session: _SourceSession, wire_request_id: Any, target_device_id: str
    ) -> _PendingEnd | None:
        """Pop the ``pending_end`` entry a target frame answers, and disarm it.

        Bound to the device the end was forwarded to, as ``_pop_correlated``
        binds the other three tables — but checked against the SNAPSHOT, not
        ``session.grants``, so an entry whose attachment is already gone (the
        open tab ``terminal_exit`` retired first) still settles. On a device
        mismatch the entry is put back: the frame is not the answer.
        """
        if not isinstance(wire_request_id, str):
            return None
        entry = session.pending_end.pop(wire_request_id, None)
        if entry is None:
            return None
        if entry.target_device_id != target_device_id:
            logger.warning(
                "remote_terminal_reply_wrong_target",
                what="terminal_end",
                grant_jti=entry.grant_jti,
                granted_target=entry.target_device_id,
                frame_target=target_device_id,
            )
            session.pending_end[wire_request_id] = entry
            return None
        self._cancel_end_timer(session, wire_request_id)
        return entry

    async def _release_end_only(
        self, session: _SourceSession, entry: _PendingEnd
    ) -> None:
        """Release what a SETTLED end held; never an open tab's attachment.

        A fresh-grant end's attachment is dropped (which also stops the
        listener when nothing else needs it). An open tab's is left alone, but
        its settled end may have been the last thing keeping the listener up —
        the tab itself having been retired by ``terminal_exit`` first.
        """
        if entry.end_only:
            att = session.grants.get(entry.grant_jti)
            if att is not None and att.end_only:
                await self._drop_attachment(session, att)
                return
        await self._maybe_stop_listener(session, entry.target_device_id)

    async def _authorize(
        self,
        session: _SourceSession,
        msg: dict[str, Any],
        *,
        require_bound: bool = True,
        require_attach_kind: bool = True,
        settle_waiter: bool = True,
    ) -> _Attachment | None:
        """Admit a post-attach frame only for a registered, live grant.

        ``settle_waiter`` (the default) lets the expiry arm tell a still-pending
        attach or create waiter its grant lapsed. The detach door clears it: a
        source that detaches has abandoned that waiter.

        With ``require_bound`` (the default) the TARGET must also have
        answered ``terminal_attached`` and the frame must name that terminal;
        a grant that merely NAMES a terminal admits nothing.

        ``require_attach_kind`` (the default) additionally refuses a CREATE
        grant. Only ``remote_terminal_detach`` clears it, and for a reason that
        is not a session operation at all: giving up a registration is how a
        source releases the Redis claim and the per-target listener a create it
        no longer wants is holding. Refusing that would leave an abandoned
        create pinned until the grant expired.
        """
        request_id = msg.get("request_id")
        grant_jti = msg.get("grant_jti")
        terminal_id = msg.get("terminal_id")
        att = session.grants.get(grant_jti) if isinstance(grant_jti, str) else None
        if att is None:
            await self._refuse(
                session,
                CODE_NOT_REGISTERED,
                "no attachment registered for this grant on this socket",
                request_id=request_id,
                grant_jti=grant_jti if isinstance(grant_jti, str) else None,
                terminal_id=terminal_id,
            )
            return None
        if att.end_only:
            # A fresh-grant end of this grant is in flight. Refused BEFORE the
            # expiry arm and for every door — detach included, which admits on
            # the grant alone: dropping this attachment would silently cancel
            # the pending end and discard the target's ``terminal_ended``. It
            # settles by reply, refusal or TTL; nothing else may end it.
            await self._refuse(
                session,
                CODE_END_PENDING,
                "an end for this grant is still awaiting the target's answer",
                request_id=request_id,
                grant_jti=att.grant_jti,
                terminal_id=terminal_id,
            )
            return None
        # Expiry BEFORE kind. The other order answered an expired create grant
        # ``grant_wrong_kind`` and left it registered — holding its claim record
        # and per-target listener — until some later frame's sweep reached it.
        if att.expired():
            # Claimed out of ``session.grants`` BEFORE the first await, exactly
            # as ``_evict`` claims it: the listener task's sweep runs
            # concurrently and would otherwise evict this same grant during the
            # send below, telling the waiter a second time.
            session.grants.pop(att.grant_jti, None)
            # The frame that tripped expiry is not necessarily the one WAITING
            # on this grant: an attach or create the target never answered has
            # its own waiter under ``att.request_id``, and dropping the grant
            # clears that correlation silently — so settle it, on the same
            # predicate ``_evict`` uses, rather than leave it to the source's
            # client-side timeout. That predicate errs toward telling a waiter
            # that was already answered — the source finds no waiter under that
            # id and routes by ``grant_jti``, which names no live pane for a grant
            # that never bound — never toward silence. Not for a detach: a live
            # detach tells an abandoned waiter nothing, and an expired one must
            # not either.
            if (
                settle_waiter
                and not att.attached
                and att.request_id is not None
                and att.request_id != request_id
            ):
                await self._send_to_source(
                    session,
                    {
                        "type": "remote_terminal_error",
                        "grant_jti": att.grant_jti,
                        "code": att.expired_code(),
                        "message": "grant expired",
                        "request_id": att.request_id,
                    },
                )
            # Same two-sided teardown as ``_evict``: the target learns the
            # grant is gone rather than holding a detached subscriber.
            await self._detach_target(session, att, att.terminal_id)
            await self._drop_attachment(session, att)
            await self._refuse(
                session,
                att.expired_code(),
                "grant expired",
                request_id=request_id,
                grant_jti=att.grant_jti,
                terminal_id=terminal_id,
            )
            return None
        if require_attach_kind and att.kind != KIND_ATTACH:
            # A create grant holds no session and no terminal: it bought one
            # spawn and nothing else. Refused HERE rather than falling through
            # to the ``attached`` check below, so the answer names the reason
            # (wrong capability) instead of the symptom (nothing bound).
            await self._refuse(
                session,
                CODE_GRANT_WRONG_KIND,
                "a create grant does not attach to a terminal — mint an attach "
                "grant for the session it created",
                request_id=request_id,
                grant_jti=att.grant_jti,
                terminal_id=terminal_id,
            )
            return None
        if not require_bound and not att.attached:
            return att
        if not att.attached or att.terminal_id != terminal_id:
            await self._refuse(
                session,
                CODE_NOT_REGISTERED,
                (
                    "target has not attached a terminal for this grant yet"
                    if not att.attached
                    else "terminal_id does not match the attached terminal"
                ),
                request_id=request_id,
                grant_jti=att.grant_jti,
                terminal_id=terminal_id,
            )
            return None
        return att

    async def _forward(
        self,
        session: _SourceSession,
        msg: dict[str, Any],
        att: _Attachment,
        target_type: str,
        extra: dict[str, Any],
    ) -> bool:
        """Forward one frame to the target for an already-authorized attachment."""
        # ``extra`` FIRST: whatever it carries, the relay-owned keys below
        # win. The input arm copies the source frame into ``extra`` minus a
        # denylist; this ordering is what keeps a gap in that list from ever
        # letting a source spell the type, terminal or authority block.
        frame: dict[str, Any] = {
            **extra,
            "type": target_type,
            "terminal_id": att.terminal_id,
            "remote": att.remote_block(),
            "timestamp": utc_now().isoformat(),
        }
        sent = await session.manager.send_terminal(att.target_device_id, frame)
        if not sent:
            await self._refuse(
                session,
                CODE_TARGET_NOT_CONNECTED,
                "target device is not connected",
                request_id=msg.get("request_id"),
                grant_jti=att.grant_jti,
                terminal_id=att.terminal_id,
            )
            return False
        return True

    async def _detach_target(
        self, session: _SourceSession, att: _Attachment, terminal_id: str | None
    ) -> None:
        """Tell the PTY owner to unbind the grant. Best effort: it may be gone."""
        if att.kind != KIND_ATTACH or att.end_only:
            # An end-only grant never asked the target to bind anything, and a
            # detach racing its own ``terminal_end`` is noise at best.
            #
            # A create grant never bound a terminal, and the target admits
            # exactly one frame type under it — so a detach sent here would be
            # refused as an unadmitted type and answered as an error, which is
            # noise on the teardown path rather than cleanup.
            return
        try:
            await session.manager.send_terminal(
                att.target_device_id,
                {
                    "type": "terminal_detach",
                    "terminal_id": terminal_id,
                    "remote": att.remote_block(),
                    "timestamp": utc_now().isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001 - teardown never raises
            logger.debug(
                "remote_terminal_detach_forward_failed",
                grant_jti=att.grant_jti,
                error=str(exc),
            )

    # ------------------------------------------------------------------
    # Registry (Redis)
    # ------------------------------------------------------------------

    async def _claim_grant(self, att: _Attachment) -> bool:
        """Atomically claim the grant for this attachment; False when held.

        ``SET NX EXAT`` in one round trip: the claim can never outlive the
        grant, and a second presentation — on this socket, another socket, or
        another replica — reads False while the first attachment is live.
        """
        redis = await self._get_redis()
        ok = await _maybe_await(
            redis.set(
                claim_key(att.grant_jti), att.source_device_id, nx=True, exat=att.exp
            )
        )
        return bool(ok)

    async def _write_grant_record(self, att: _Attachment) -> None:
        redis = await self._get_redis()
        record: dict[str, str] = {
            "source_device_id": att.source_device_id,
            "target_device_id": att.target_device_id,
            "target_session_id": att.target_session_id or "",
            "kind": att.kind,
            "exp": str(att.exp),
            "request_id": att.request_id or "",
            "requested_terminal_id": att.requested_terminal_id or "",
            "terminal_id": "",
        }
        await _hset(redis, grant_key(att.grant_jti), mapping=record)
        await redis.expireat(grant_key(att.grant_jti), att.exp)

    async def _bind_terminal(self, att: _Attachment, terminal_id: str) -> bool:
        """Claim the ``(target, terminal)`` route for this grant; False when busy.

        One atomic round trip (``BIND_TERMINAL_SCRIPT``): the key is never
        observable half-written or without its TTL. On success the in-memory
        record is updated HERE, before any further await, so a teardown that
        runs next releases the key instead of leaking it until the grant's
        expiry.
        """
        redis = await self._get_redis()
        key = terminal_key(att.target_device_id, terminal_id)
        bound = await _eval(
            redis,
            BIND_TERMINAL_SCRIPT,
            key,
            att.source_device_id,
            att.grant_jti,
            str(att.exp),
        )
        if not bound:
            return False
        att.terminal_id = terminal_id
        att.attached = True
        await _hset(
            redis, grant_key(att.grant_jti), mapping={"terminal_id": terminal_id}
        )
        return True

    async def _release_registry(self, att: _Attachment) -> None:
        """Delete the attachment's keys; the terminal key only while ours.

        **A CREATE's claim key is NOT deleted.** ``SET NX EXAT`` made it expire
        with the grant, so leaving it is what "one grant, one spawn" means for
        the 15 minutes the grant lives. Deleting it here freed the jti the
        instant the create completed, and the only barriers left were a
        PROCESS-LOCAL tombstone on the target and coord's ``consumed_at`` —
        which a single detached no-retry POST sets. A coord blip during that
        POST plus a target restart inside the TTL let the source replay the
        identical frame into a second PTY, repeatably, once per restart.

        Attach keeps the delete: re-presenting an attach grant is the documented
        reattach path, not a replay.
        """
        redis = await self._get_redis()
        if att.kind == KIND_CREATE:
            await redis.delete(grant_key(att.grant_jti))
        else:
            await redis.delete(claim_key(att.grant_jti), grant_key(att.grant_jti))
        if att.terminal_id is not None:
            await _eval(
                redis,
                RELEASE_TERMINAL_SCRIPT,
                terminal_key(att.target_device_id, att.terminal_id),
                att.grant_jti,
            )

    async def _drop_attachment(self, session: _SourceSession, att: _Attachment) -> None:
        session.grants.pop(att.grant_jti, None)
        for pending in (
            session.pending_attach,
            session.pending_buffer,
            session.pending_create,
        ):
            for rid in [r for r, (_, j) in pending.items() if j == att.grant_jti]:
                pending.pop(rid, None)
        # ``pending_end`` is swept only for a FRESH-grant end, whose attachment
        # exists for that one round trip. An open tab's in-flight end outlives
        # the tab on purpose (see ``_PendingEnd``): its reply or TTL settles it.
        if att.end_only:
            for rid in [
                r
                for r, e in session.pending_end.items()
                if e.grant_jti == att.grant_jti
            ]:
                session.pending_end.pop(rid, None)
                self._cancel_end_timer(session, rid)
        try:
            # Two commands; shielded so a cancel of the caller (socket
            # teardown) cannot stop after the first and strand the second.
            await asyncio.shield(self._release_registry(att))
        except Exception as exc:  # noqa: BLE001 - registry cleanup is best effort
            logger.error(
                "remote_terminal_registry_delete_failed",
                grant_jti=att.grant_jti,
                error=str(exc),
            )
        await self._maybe_stop_listener(session, att.target_device_id)

    async def _maybe_stop_listener(
        self, session: _SourceSession, target_device_id: str
    ) -> None:
        """Stop a target's listener once nothing on this socket still needs it.

        Two kinds of thing need it: a grant held on that target, and an
        in-flight ``terminal_end`` to it. The second outlives its attachment on
        purpose — an open tab's PTY usually closes (``terminal_exit`` drops the
        tab) BEFORE the target sends ``terminal_ended`` — so tearing the route
        down on the grant count alone would leave that reply arriving on a
        channel nobody listens to, and the source reading a timeout for an end
        that succeeded. Every settlement of an end calls back in here, so the
        listener still goes once the last one settles.
        """
        if target_device_id in session.targets():
            return
        if any(
            e.target_device_id == target_device_id for e in session.pending_end.values()
        ):
            return
        await self._stop_listener(session, target_device_id)

    async def _evict(
        self, session: _SourceSession, att: _Attachment, *, code: str, message: str
    ) -> None:
        """Drop an attachment the source did not ask to end, telling both ends.

        The source gets a ``remote_terminal_error`` naming the grant (and the
        original attach ``request_id`` while the attach was never answered, so
        a pending attach can settle); the target gets ``terminal_detach``.

        Idempotent: two concurrent sweeps (the device loop's and a listener
        task's) can snapshot the same expired grant, so the grant is claimed
        out of ``session.grants`` BEFORE the first await — the loser returns
        without a second notice to either end.
        """
        if session.grants.get(att.grant_jti) is not att:
            return
        session.grants.pop(att.grant_jti, None)
        payload: dict[str, Any] = {
            "type": "remote_terminal_error",
            "grant_jti": att.grant_jti,
            "code": code,
            "message": message,
        }
        if not att.attached and att.request_id is not None:
            payload["request_id"] = att.request_id
        if att.terminal_id is not None:
            payload["terminal_id"] = att.terminal_id
        await self._send_to_source(session, payload)
        await self._detach_target(session, att, att.terminal_id)
        await self._drop_attachment(session, att)

    async def _reap_expired(
        self, session: _SourceSession, *, except_jti: str | None = None
    ) -> None:
        """Drop every expired attachment on this socket, answered or not.

        An attach the target never answers is otherwise reaped only when a
        frame touches it — and nothing does, so it would hold the per-target
        listener and the runner's ``terminal_subscribe`` for the socket's
        lifetime. Runs at the top of both frame paths.
        """
        # An ``end_only`` attachment whose end is still in flight is NOT reaped:
        # evicting it would answer ``grant_expired`` and sweep the pending end,
        # dropping the target's real ``terminal_ended``. Its reply, a target
        # refusal or the end's own TTL settles it — and releases the claim.
        ending = {e.grant_jti for e in session.pending_end.values() if e.end_only}
        expired = [
            att
            for att in session.grants.values()
            if att.grant_jti != except_jti
            and att.expired()
            and not (att.end_only and att.grant_jti in ending)
        ]
        for att in expired:
            logger.info(
                "remote_terminal_attachment_expired",
                source_device_id=session.device_id,
                target_device_id=att.target_device_id,
                grant_jti=att.grant_jti,
                terminal_id=att.terminal_id,
                attached=att.attached,
            )
            await self._evict(
                session, att, code=att.expired_code(), message="grant expired"
            )

    # ------------------------------------------------------------------
    # TARGET → SOURCE (return route)
    # ------------------------------------------------------------------

    async def publish_target_frame(self, device_id: Any, msg: dict[str, Any]) -> None:
        """Publish a TARGET frame only the remote path consumes.

        Called by ``devices_ws`` on the TARGET's replica for
        ``is_remote_only_target_frame`` frames; the source's replica picks it
        up on ``remote_response_channel``. Never raises into the device loop.
        """
        try:
            redis = await self._get_redis()
            await redis.publish(
                remote_response_channel(str(device_id)), json.dumps(msg)
            )
        except Exception as exc:  # noqa: BLE001 - mirror terminal_relay's publish arms
            logger.error(
                "remote_terminal_response_publish_failed",
                target_device_id=str(device_id),
                frame_type=msg.get("type"),
                error=str(exc),
            )

    async def _ensure_listener(
        self, session: _SourceSession, target_device_id: str
    ) -> None:
        if target_device_id in session.listeners:
            return
        redis = await self._get_redis()
        pubsub = redis.pubsub()
        channels = [
            response_channel(target_device_id),
            remote_response_channel(target_device_id),
        ]
        try:
            await pubsub.subscribe(*channels)
        except Exception:
            await self._close_pubsub(pubsub)
            raise
        task = asyncio.create_task(
            self._run_listener(session, target_device_id, pubsub)
        )
        session.listeners[target_device_id] = (pubsub, task)
        # Same subscription the mobile watcher path sends on connect: the
        # runner forwards terminal_output/terminal_exit only while it has a
        # subscriber, and keeps a counter, so one subscribe per listener is
        # matched by one unsubscribe in ``_stop_listener``.
        try:
            if await session.manager.relay.send_command_to_runner(
                target_device_id,
                {"type": "terminal_subscribe", "runner_id": target_device_id},
            ):
                if target_device_id in session.listeners:
                    session.subscribed.add(target_device_id)
                else:
                    # The listener was torn down while the subscribe was in
                    # flight (a ``runner_disconnected`` or a dead pubsub
                    # reached ``_stop_listener`` / ``_listener_lost`` before
                    # the record existed, so their unsubscribe was a no-op).
                    # Nothing will tear this record down later — match the
                    # increment now instead of orphaning it.
                    session.subscribed.add(target_device_id)
                    await self._unsubscribe_runner(session, target_device_id)
        except Exception as exc:  # noqa: BLE001 - the attach itself still stands
            logger.warning(
                "remote_terminal_subscribe_failed",
                target_device_id=target_device_id,
                error=str(exc),
            )
        logger.info(
            "remote_terminal_listener_started",
            source_device_id=session.device_id,
            target_device_id=target_device_id,
            channels=channels,
        )

    async def _stop_listener(
        self, session: _SourceSession, target_device_id: str
    ) -> None:
        entry = session.listeners.pop(target_device_id, None)
        if entry is None:
            return
        pubsub, task = entry
        if task is asyncio.current_task():
            # Reached from inside the listener itself (a ``terminal_exit`` on
            # the socket's last attachment to this target). Finish routing
            # this frame; a sibling task cancels and closes us right after.
            finisher = asyncio.get_running_loop().create_task(
                self._finish_listener(session, target_device_id, pubsub, task)
            )
            self._background.add(finisher)
            finisher.add_done_callback(self._background.discard)
            return
        await self._finish_listener(session, target_device_id, pubsub, task)

    async def _finish_listener(
        self,
        session: _SourceSession,
        target_device_id: str,
        pubsub: Any,
        task: asyncio.Task[None],
    ) -> None:
        task.cancel()
        # Wait for the task to actually leave ``pubsub.listen()`` before this
        # coroutine drives the same PubSub: two coroutines on one pubsub
        # connection desynchronise its reply stream.
        await asyncio.gather(task, return_exceptions=True)
        await self._close_pubsub(pubsub)
        await self._unsubscribe_runner(session, target_device_id)

    async def _close_pubsub(self, pubsub: Any) -> None:
        try:
            await asyncio.shield(pubsub.unsubscribe())
        except Exception:  # noqa: BLE001 - best effort cleanup
            pass
        try:
            await asyncio.shield(pubsub.close())
        except Exception:  # noqa: BLE001 - best effort cleanup
            pass

    async def _run_listener(
        self, session: _SourceSession, target_device_id: str, pubsub: Any
    ) -> None:
        try:
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    data = message["data"]
                    if isinstance(data, bytes | bytearray):
                        data = data.decode("utf-8")
                    frame = json.loads(data)
                    if isinstance(frame, dict):
                        await self.route_target_frame(session, target_device_id, frame)
                except Exception as exc:  # noqa: BLE001 - one bad frame must not end the route
                    logger.error(
                        "remote_terminal_route_failed",
                        source_device_id=session.device_id,
                        target_device_id=target_device_id,
                        error=str(exc),
                    )
        except asyncio.CancelledError:
            logger.info(
                "remote_terminal_listener_cancelled",
                source_device_id=session.device_id,
                target_device_id=target_device_id,
            )
            raise
        except Exception as exc:  # noqa: BLE001 - mirror terminal_relay's listener arms
            logger.error(
                "remote_terminal_listener_error",
                source_device_id=session.device_id,
                target_device_id=target_device_id,
                error=str(exc),
            )
        finally:
            # A listener that ends on its own (the pubsub died) must not leave
            # its registration behind, its pubsub open, or — worse — its
            # attachments registered with no return route: the source would
            # keep sending input into a route that answers nothing. When
            # ``_stop_listener`` ended us, it already popped the entry and
            # its finisher closes the pubsub after we have left ``listen()``.
            entry = session.listeners.get(target_device_id)
            if entry is not None and entry[1] is asyncio.current_task():
                session.listeners.pop(target_device_id, None)
                await self._listener_lost(session, target_device_id, pubsub)

    async def _listener_lost(
        self, session: _SourceSession, target_device_id: str, pubsub: Any
    ) -> None:
        """Tear down what a self-terminated listener was routing for.

        The entry is already popped, so ``_drop_attachment``'s own
        ``_stop_listener`` is a no-op here and the runner-side unsubscribe
        (matched to this listener's subscribe) is sent explicitly.

        Ends in flight to that target are answered FIRST, typed
        ``listener_lost``: their reply can no longer reach this socket, so
        waiting out the end TTL would only delay the same UNKNOWN verdict.
        """
        await self._settle_pending_ends_on_target(
            session,
            target_device_id,
            code=CODE_LISTENER_LOST,
            message="return route to the target was lost; the end's outcome is unknown",
        )
        for att in list(session.grants.values()):
            if att.target_device_id != target_device_id:
                continue
            await self._evict(
                session,
                att,
                code=CODE_LISTENER_LOST,
                message="return route to the target was lost",
            )
        await self._close_pubsub(pubsub)
        await self._unsubscribe_runner(session, target_device_id)

    async def _unsubscribe_runner(
        self, session: _SourceSession, target_device_id: str
    ) -> None:
        """Send the ``terminal_unsubscribe`` matching ``_ensure_listener``.

        Sent only when ``_ensure_listener`` actually published this socket's
        subscribe (``session.subscribed``): the runner's counter is shared by
        every subscriber, so an unsubscribe with no matching subscribe would
        take down a PEER's subscription rather than being a no-op. Saturation
        at zero only protects the count when nobody else is subscribed.

        When it is sent, it is published UNCONDITIONALLY — never gated on the
        target's socket being registered in *this* process. The runner's
        ``terminal_subscriber_count``
        is a process-lifetime counter it never resets, and terminal-output
        forwarding is latched on ``count > 0``, so a *dropped* unsubscribe is
        not a benign miss: it leaves the target's device-wide terminal
        firehose on for the rest of that runner's process life. The default
        in-process gate dropped exactly the two cases that matter — the
        target reconnecting to a *different* backend replica between attach
        and detach, and a momentary local deregistration at detach time — so
        the counter never came back down.

        ``require_local_connection=False`` hands the frame to Redis pub/sub on
        ``runner:commands:{rid}``, the channel the replica holding the socket
        is subscribed to, so the unsubscribe reaches the runner wherever it is
        terminated. Publishing to an absent runner is harmless: nothing is
        subscribed to the channel, and the runner's decrement saturates at
        zero.

        The matching ``terminal_subscribe`` stays on the local gate on
        purpose, mirroring the mobile watcher path: a dropped subscribe is
        transient and the attach itself already fails closed when the target
        is not local (``_forward`` -> ``send_terminal`` gates on the socket
        being live here, with no opt-out), whereas a dropped unsubscribe is
        permanent.
        """
        if target_device_id not in session.subscribed:
            return
        session.subscribed.discard(target_device_id)
        try:
            await session.manager.relay.send_command_to_runner(
                target_device_id,
                {"type": "terminal_unsubscribe", "runner_id": target_device_id},
                require_local_connection=False,
            )
        except Exception as exc:  # noqa: BLE001 - the runner may already be gone
            logger.debug(
                "remote_terminal_unsubscribe_failed",
                target_device_id=target_device_id,
                error=str(exc),
            )

    def _pop_correlated(
        self,
        session: _SourceSession,
        pending: dict[str, _Pending],
        wire_request_id: Any,
        target_device_id: str,
        *,
        what: str,
    ) -> tuple[_Pending, _Attachment | None] | None:
        """Pop one minted-request-id correlation AND bind it to the answerer.

        Every ``pending_*`` dict is keyed by request id ALONE, while one socket
        routinely holds grants on several targets — so a frame arriving on
        device C's channel under an id minted for device B correlated to B's
        attachment and was answered as B's. ``terminal_created`` grew this
        check in round 1 (review finding 3); its siblings — ``terminal_attached``
        and ``_route_target_error``'s three pops — did not, on the same dicts and
        the same socket (review round 2, finding 4).

        Minted ids are ``uuid4().hex`` and are only ever sent to the device they
        were minted for, so a sibling target cannot guess one: this is
        defence-in-depth symmetry rather than a reachable hole. It is applied
        anyway, because "unguessable" is a property of the id generator and this
        is a property of the router, and the two should not be coupled.

        On a mismatch the correlation is put BACK — the frame was not the
        answer, and the device the grant actually names may still reply.

        Three outcomes, kept distinct because the callers treat them
        differently: ``None`` is "not ours" (never correlated, or correlated to
        another device and restored); ``(correlated, None)`` is "ours, but the
        grant is no longer on this socket" — consumed, exactly as before;
        ``(correlated, att)`` is the answer.
        """
        if not isinstance(wire_request_id, str):
            return None
        correlated = pending.pop(wire_request_id, None)
        if correlated is None:
            return None
        att = session.grants.get(correlated[1])
        if att is None:
            return correlated, None
        if att.target_device_id != target_device_id:
            logger.warning(
                "remote_terminal_reply_wrong_target",
                what=what,
                grant_jti=att.grant_jti,
                granted_target=att.target_device_id,
                frame_target=target_device_id,
            )
            pending[wire_request_id] = correlated
            return None
        return correlated, att

    async def _bound_attachment(
        self, session: _SourceSession, target_device_id: str, terminal_id: Any
    ) -> _Attachment | None:
        """The live attachment bound to ``terminal_id``; an expired one is dropped."""
        att = session.by_terminal(target_device_id, terminal_id)
        if att is None:
            return None
        if att.expired():
            logger.info(
                "remote_terminal_return_route_expired",
                source_device_id=session.device_id,
                target_device_id=target_device_id,
                grant_jti=att.grant_jti,
                terminal_id=att.terminal_id,
            )
            await self._drop_attachment(session, att)
            return None
        return att

    async def route_target_frame(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """Translate one TARGET frame for this source; False when it is not ours.

        The SUCCESS path had no log line of its own. Every other stage of a
        remote attach announces itself, so the only way to tell a routed reply
        from one that never arrived was to look for the ABSENCE of a downstream
        effect — ``remote_terminal_listener_cancelled`` was the receipt that a
        refusal had been routed, and reading an absence as a verdict is exactly
        how the 20s-silent attach stayed invisible in the logs for its whole
        life. This wrapper emits the positive receipt: the frame ARRIVED on
        this session's channel, and whether it was CLAIMED (``routed``) or
        belonged to another watcher.

        ``frame_type`` is target-supplied, so it is truncated and admitted only
        as a string — a log field is not a transfer channel (the same rule
        ``namespace_target_code`` applies to ``code``).
        """
        raw_type = frame.get("type")
        safe_type = raw_type[:TARGET_CODE_MAX] if isinstance(raw_type, str) else None
        routed = await self._dispatch_target_frame(session, target_device_id, frame)
        fields: dict[str, Any] = {
            "source_device_id": session.device_id,
            "target_device_id": target_device_id,
            "frame_type": safe_type,
            "routed": routed,
        }
        if safe_type in _HIGH_VOLUME_TARGET_FRAMES:
            logger.debug("remote_terminal_target_frame_routed", **fields)
        else:
            logger.info("remote_terminal_target_frame_routed", **fields)
        return routed

    async def _dispatch_target_frame(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """The type dispatch behind :meth:`route_target_frame`."""
        await self._reap_expired(session)
        frame_type = frame.get("type")
        # Declared once for the whole dispatch. The correlated arms below narrow
        # it to non-Optional behind their own `is None` guards, which would
        # otherwise fix the inferred type at `_Attachment` and reject the
        # terminal-routed arms that legitimately assign `_Attachment | None`.
        att: _Attachment | None

        if frame_type == "terminal_attached":
            # Correlated by the MINTED id and bound to the device the grant
            # names — see ``_pop_correlated``.
            popped = self._pop_correlated(
                session,
                session.pending_attach,
                frame.get("request_id"),
                target_device_id,
                what="terminal_attached",
            )
            if popped is None or popped[1] is None:
                return False
            correlated, att = popped[0], popped[1]
            source_request_id, _jti = correlated
            terminal_id = frame.get("terminal_id")
            if not isinstance(terminal_id, str) or not terminal_id:
                await self._send_to_source(
                    session,
                    {
                        "type": "remote_terminal_error",
                        "request_id": source_request_id,
                        "grant_jti": att.grant_jti,
                        "code": "attach_terminal_missing",
                        "message": "target named no terminal_id in terminal_attached",
                    },
                )
                return True
            try:
                bound = await self._bind_terminal(att, terminal_id)
            except Exception as exc:  # noqa: BLE001 - registry failure is a typed refusal
                logger.error(
                    "remote_terminal_registry_unavailable",
                    source_device_id=session.device_id,
                    grant_jti=att.grant_jti,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
                await self._detach_target(session, att, terminal_id)
                await self._drop_attachment(session, att)
                await self._refuse(
                    session,
                    CODE_REGISTRY_UNAVAILABLE,
                    "attachment registry temporarily unavailable",
                    request_id=source_request_id,
                    grant_jti=att.grant_jti,
                    terminal_id=terminal_id,
                )
                return True
            if not bound:
                # Another grant holds this terminal. The target has just
                # bound ours to it, so tell it to unbind before dropping.
                await self._detach_target(session, att, terminal_id)
                await self._drop_attachment(session, att)
                await self._refuse(
                    session,
                    CODE_TERMINAL_BUSY,
                    "terminal is already held by another attachment",
                    request_id=source_request_id,
                    grant_jti=att.grant_jti,
                    terminal_id=terminal_id,
                )
                return True
            if (
                att.requested_terminal_id is not None
                and att.requested_terminal_id != terminal_id
            ):
                logger.info(
                    "remote_terminal_attached_other_terminal",
                    source_device_id=session.device_id,
                    target_device_id=target_device_id,
                    grant_jti=att.grant_jti,
                    requested_terminal_id=att.requested_terminal_id,
                    terminal_id=terminal_id,
                )
            await self._send_to_source(
                session,
                {
                    "type": "remote_terminal_attached",
                    "request_id": source_request_id,
                    "grant_jti": att.grant_jti,
                    "terminal_id": terminal_id,
                    "buffer": frame.get("buffer", frame.get("data")),
                    "start_offset": frame.get("start_offset"),
                    # Where the target's ring actually BEGINS, which is below
                    # `start_offset` whenever the attach shipped only the
                    # bounded tail. It is the source's `history_start`, and
                    # `RemotePaneIo::history_range()` returns None without it —
                    # so dropping it does not degrade lazy scrollback, it
                    # switches the feature off with nothing to say so.
                    "ring_start_offset": frame.get("ring_start_offset"),
                    "total_bytes_produced": frame.get("total_bytes_produced"),
                },
            )
            return True

        if frame_type == "terminal_created":
            # Correlated by the MINTED id and bound to the device the grant
            # names. Both halves live in ``_pop_correlated``: an uncorrelated
            # frame is not ours (the mobile path shares this channel and creates
            # terminals on it too), and one from the wrong device is not the
            # answer — the source would otherwise label the tab B and mint an
            # attach grant against whatever session id C's frame carried.
            popped = self._pop_correlated(
                session,
                session.pending_create,
                frame.get("request_id"),
                target_device_id,
                what="terminal_created",
            )
            if popped is None or popped[1] is None:
                return False
            correlated, att = popped[0], popped[1]
            source_request_id, _jti = correlated
            terminal = frame.get("terminal")
            terminal_id = (
                terminal.get("id")
                if isinstance(terminal, dict)
                else frame.get("terminal_id")
            )
            # `coord_session_id` is FIRST-CLASS here, not smuggled inside
            # `terminal`. The source needs it to mint the session-addressed
            # attach grant that drives what it just created, and the only
            # zero-relay-change route was an undeclared key on `terminal` — a
            # schema-typed object this relay forwards verbatim today. That
            # works right up until something validates `terminal`, at which
            # point create-then-attach breaks SILENTLY. Reading it from either
            # place keeps the older target working while the field is the
            # declared contract.
            coord_session_id = frame.get("coord_session_id")
            if coord_session_id is None and isinstance(terminal, dict):
                coord_session_id = terminal.get("coordSessionId")
            # A UUID or nothing. The source turns this straight into
            # ``POST /coord/sessions/{id}/attach-grants``, so an unparseable or
            # non-string value must read as "created but not addressable"
            # (which the source already reports) rather than travel on as an id.
            # The type check is cheap; what it forecloses is the field becoming
            # a free-text channel into a coord URL path.
            if not _is_uuid(coord_session_id):
                if coord_session_id is not None:
                    logger.warning(
                        "remote_terminal_created_bad_session_id",
                        grant_jti=att.grant_jti,
                        target_device_id=target_device_id,
                    )
                coord_session_id = None
            await self._send_to_source(
                session,
                {
                    "type": "remote_terminal_created",
                    "request_id": source_request_id,
                    "grant_jti": att.grant_jti,
                    "terminal_id": terminal_id,
                    "terminal": terminal,
                    # Absent stays ABSENT, never guessed: a create that landed
                    # with no coord row is "created but not addressable", and
                    # the source says exactly that rather than inventing an id
                    # to attach to.
                    "coord_session_id": coord_session_id,
                },
            )
            # Spent. A create grant bought one spawn; driving what it spawned
            # needs an attach grant for the new session, which coord mints
            # against the target's own attach preference. Dropping it here is
            # what makes that non-optional rather than a convention.
            await self._drop_attachment(session, att)
            return True

        if frame_type == "terminal_output":
            att = await self._bound_attachment(
                session, target_device_id, frame.get("terminal_id")
            )
            if att is None:
                return False
            await self._send_to_source(
                session,
                {
                    "type": "remote_terminal_output",
                    "grant_jti": att.grant_jti,
                    "terminal_id": att.terminal_id,
                    "data": frame.get("data"),
                },
            )
            return True

        if frame_type == "terminal_exit":
            att = await self._bound_attachment(
                session, target_device_id, frame.get("terminal_id")
            )
            if att is None:
                return False
            await self._send_to_source(
                session,
                {
                    "type": "remote_terminal_exit",
                    "grant_jti": att.grant_jti,
                    "terminal_id": att.terminal_id,
                    "exit_code": frame.get("exit_code"),
                },
            )
            await self._drop_attachment(session, att)
            return True

        if frame_type == "terminal_buffer_response":
            return await self._route_buffer_response(session, target_device_id, frame)

        if frame_type == TARGET_END_REPLY_FRAME_TYPE:
            return await self._route_end_reply(session, target_device_id, frame)

        if frame_type == TARGET_INPUT_ACK_FRAME_TYPE:
            return await self._route_input_ack(session, target_device_id, frame)

        if frame_type == "runner_disconnected":
            # A RELAY-authored notice, not a target refusal, which is why it
            # sits OUTSIDE ``TARGET_REFUSAL_FRAME_TYPES`` and above it:
            # ``RunnerWebSocketManager.unregister`` publishes it device-wide,
            # so its payload is never target-supplied and there is nothing to
            # namespace. It settles attachments rather than translating a
            # frame. Order is documentation here, not behaviour — the two
            # conditions are disjoint by construction.
            return await self._route_runner_disconnected(session, target_device_id)

        if frame_type in TARGET_REFUSAL_FRAME_TYPES:
            # Membership, not equality: a target refusal typed
            # ``remote_terminal_error`` takes the SAME path as one typed
            # ``error`` and gets no shortcut for wearing the relay's outbound
            # type. ``_route_target_error`` rebuilds the payload and puts
            # ``code`` through ``namespace_target_code``, so the namespacing a
            # target must not escape is applied identically either way. See
            # ``TARGET_REFUSAL_FRAME_TYPES``.
            return await self._route_target_error(session, target_device_id, frame)

        return False

    async def _route_runner_disconnected(
        self, session: _SourceSession, target_device_id: str
    ) -> bool:
        """Settle every attachment on a target whose relay socket just died.

        ``RunnerWebSocketManager.unregister`` publishes ``runner_disconnected``
        on the target's response channel — the channel this session's listener
        is already subscribed to — and until this arm existed the frame fell
        off the end of the dispatch unlogged. That silence is the whole defect:
        an attach the target can no longer answer had NOTHING left to settle
        it. ``_evict``'s ``att.request_id`` fallback (used only while
        ``attached`` is False, i.e. while the attach was never answered) is the
        piece that turns this into a correlated reply, so the source learns its
        counterparty is gone instead of waiting out its own timeout.

        The code is ``target_not_connected`` rather than a new spelling: it is
        the same verdict the forward path answers for the same condition (a
        dead device socket), and one condition reported under two codes is a
        vocabulary the source cannot act on. ``listener_lost`` would be wrong
        — the relay's return route is healthy; it is precisely how we learned
        this.

        Evicting the last attachment on the target makes ``_drop_attachment``
        call ``_stop_listener``, which sends the ``terminal_unsubscribe``
        matching ``_ensure_listener``'s ``terminal_subscribe``. That matters
        beyond tidiness: an unsettled attach left the target's device-wide
        output firehose switched ON for every terminal it owns, so each failed
        attach permanently ratcheted the load that kills the next socket.

        Ends in flight to that target — open-tab ones included, which outlive
        their attachment on purpose — are answered FIRST with the same code,
        rather than left to the 75 s end TTL: no reply can come from a socket
        that is gone. A fresh-grant end's attachment is released by that
        settlement, so it is not evicted a second time below.

        Returns False when this socket holds nothing on that target — the
        frame is a device-wide notice every watcher sees, and one that settles
        none of our attachments or ends is not ours.
        """
        ends = await self._settle_pending_ends_on_target(
            session,
            target_device_id,
            code=CODE_TARGET_NOT_CONNECTED,
            message="target device's relay socket disconnected; "
            "the end's outcome is unknown",
        )
        doomed = [
            att
            for att in session.grants.values()
            if att.target_device_id == target_device_id
        ]
        if not doomed:
            return ends > 0
        logger.info(
            "remote_terminal_target_disconnected",
            source_device_id=session.device_id,
            target_device_id=target_device_id,
            attachments=len(doomed),
            unanswered_attaches=sum(1 for att in doomed if not att.attached),
        )
        for att in doomed:
            await self._evict(
                session,
                att,
                code=CODE_TARGET_NOT_CONNECTED,
                message="target device's relay socket disconnected",
            )
        return True

    async def _attachment_by_remote_mark(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> _Attachment | None:
        """The attachment a remote-MARKED target frame belongs to, if it is ours.

        A frame that NAMES a grant is routed by that grant alone: one naming a
        grant this socket does not hold belongs to some other source, however
        familiar its ``terminal_id`` looks. Only an unnamed frame falls back to
        the terminal route.

        BOTH arms are scoped to the channel the frame arrived on. One socket may
        hold grants on SEVERAL targets, and this session subscribes to each
        target's channel separately — so without the ``target_device_id`` check
        a frame on target B's channel naming a grant held on target A resolves
        to A, and (terminal ids being per-device, so a collision on ``t1`` is
        ordinary rather than unlikely) passes the caller's terminal check too.
        The source would then splice B's scrollback into A's pane. The terminal
        arm has always filtered on it — ``_SourceSession.by_terminal`` — and the
        grant arm did not; that asymmetry is the bug, not the check.

        The caller decides that the frame is remote-marked at all
        (``_is_remote_marked``) — a frame the target did not mark rides the
        channel the mobile watchers share and is never ours.
        """
        remote = frame.get("remote")
        jti_hint = (
            remote.get("grant_jti") if isinstance(remote, dict) else None
        ) or frame.get("grant_jti")
        if jti_hint is None:
            return await self._bound_attachment(
                session, target_device_id, frame.get("terminal_id")
            )
        if not isinstance(jti_hint, str):
            return None
        att = session.grants.get(jti_hint)
        if att is None or att.target_device_id != target_device_id:
            return None
        return att

    async def _route_end_reply(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """Rebuild a target ``terminal_ended`` as ``remote_terminal_ended``.

        Correlated by the MINTED id and bound to the device the end was sent
        to (``_pop_pending_end``). The payload is REBUILT, never forwarded:
        ``grant_jti`` and ``session_id`` come from the snapshot taken at
        forward time (the grant is the authority on which session was ended),
        the target's ``remote`` / ``remote_echo`` blocks are dropped,
        ``outcome`` is held to the closed set — anything else reads
        ``unknown``, never ``ended`` — and ``via`` / ``reason`` are capped
        free text. ``terminal_id`` is the bound terminal for an open tab, and
        the target's report for a fresh grant (which bound nothing).

        Answered from the snapshot even when the attachment is already gone:
        an open tab whose PTY closed is usually retired by ``terminal_exit``
        before this reply lands. A fresh-grant attachment is dropped once the
        reply is sent, whatever the outcome; an open tab's never is.
        """
        entry = self._pop_pending_end(
            session, frame.get("request_id"), target_device_id
        )
        if entry is None:
            return False
        outcome = frame.get("outcome")
        if not isinstance(outcome, str) or outcome not in END_OUTCOMES:
            logger.warning(
                "remote_terminal_ended_unknown_outcome",
                source_device_id=session.device_id,
                grant_jti=entry.grant_jti,
                outcome=outcome[:TARGET_CODE_MAX] if isinstance(outcome, str) else None,
            )
            outcome = END_OUTCOME_FALLBACK
        terminal_id: str | None = entry.terminal_id
        if terminal_id is None:
            reported = frame.get("terminal_id")
            terminal_id = (
                reported[:TARGET_MESSAGE_MAX] if isinstance(reported, str) else None
            )
        payload: dict[str, Any] = {
            "type": SOURCE_END_REPLY_FRAME_TYPE,
            "request_id": entry.source_request_id,
            "grant_jti": entry.grant_jti,
            "session_id": entry.target_session_id,
            "terminal_id": terminal_id,
            "outcome": outcome,
        }
        for key, cap in (("via", TARGET_CODE_MAX), ("reason", TARGET_MESSAGE_MAX)):
            value = frame.get(key)
            if isinstance(value, str) and value:
                payload[key] = value[:cap]
        await self._answer_end_and_release(session, entry, payload)
        logger.info(
            "remote_terminal_ended_routed",
            source_device_id=session.device_id,
            target_device_id=target_device_id,
            grant_jti=entry.grant_jti,
            outcome=outcome,
            fresh_grant=entry.end_only,
        )
        return True

    async def _route_input_ack(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """Route a target ``terminal_input_ack`` to the source holding its grant.

        Routed by the grant the target echoed in ``remote`` (or a top-level
        ``grant_jti``) — the target emits an ack ONLY for a ``terminal_input``
        that carried a ``remote`` block, so an unmarked ack is not ours. The
        grant must be one THIS socket holds, on THIS target, and BOUND: an ack
        for an unknown, foreign, expired or not-yet-attached grant is dropped
        (``False``) exactly as ``terminal_output`` and the unsolicited buffer
        resync are, never turned into a refusal the source did not ask for.

        Expiry needs no arm here: ``_dispatch_target_frame`` reaps expired
        grants (and tells their sources) before any arm runs, so an ack under
        an expired grant finds no attachment and is dropped as unknown.

        The frame is copied WHOLE — see ``INPUT_ACK_RELAY_OWNED_KEYS`` — so a
        field a newer target adds reaches the source without a relay change.
        Only ``type`` is retyped; ``grant_jti`` / ``terminal_id`` come from the
        attachment record, and the relay's ``remote`` block and the relay-voice
        keys are stripped. ``error`` is target-supplied free text, so it is
        capped at ``TARGET_MESSAGE_MAX`` like a refusal's ``message``, and a
        non-string one is dropped. It is deliberately NOT namespaced: it is not
        a relay ``code`` field, and its leading token is the wire refusal code
        the source reports to coord verbatim (plan A2), which a prefix would
        break.
        """
        if not _is_remote_marked(frame):
            return False
        att = await self._attachment_by_remote_mark(session, target_device_id, frame)
        if att is None or not att.attached:
            return False
        if frame.get("terminal_id") != att.terminal_id:
            # An ack marked with our grant naming another pane: a target
            # defect. Handing it over would credit a keystroke to the wrong
            # pane's write half.
            log = logger.debug if att.ack_mismatch_warned else logger.warning
            att.ack_mismatch_warned = True
            log(
                "remote_terminal_input_ack_terminal_mismatch",
                source_device_id=session.device_id,
                grant_jti=att.grant_jti,
                expected_terminal_id=att.terminal_id,
                terminal_id=frame.get("terminal_id"),
            )
            return False
        payload: dict[str, Any] = {
            key: value
            for key, value in frame.items()
            if key not in INPUT_ACK_RELAY_OWNED_KEYS
        }
        if "error" in payload:
            error = payload["error"]
            if isinstance(error, str):
                payload["error"] = error[:TARGET_MESSAGE_MAX]
            else:
                del payload["error"]
        payload["type"] = SOURCE_INPUT_ACK_FRAME_TYPE
        payload["grant_jti"] = att.grant_jti
        payload["terminal_id"] = att.terminal_id
        await self._send_to_source(session, payload)
        return True

    async def _route_buffer_response(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """Route a target ``terminal_buffer_response``. Two shapes arrive here.

        SOLICITED — the answer to a ``remote_terminal_buffer`` this module
        forwarded. It carries the ``request_id`` we MINTED, so it correlates in
        ``pending_buffer``, and the SOURCE's own request id is echoed back: the
        source resolves its ``history:`` waiter and deliberately does not
        splice, because its stream is already past that range.

        UNSOLICITED — the target's resync after a flow RESUME that had withheld
        frames (``handle_terminal_flow``, ``FlowTransition::Resumed { skipped:
        true }``, which answers with the ring). ``terminal_flow`` is
        fire-and-forget and carries no request id, so that reply echoes
        ``request_id: null`` and correlates with nothing. Correlate-or-drop
        therefore discarded precisely the output the pause had withheld — the
        one failure backpressure exists to prevent — from the moment the flow
        frame was first admitted. It is routed instead by the grant the target
        marked it with, and forwarded WITHOUT a request id, which is what makes
        the source splice it from its own offset rather than resolve a waiter.

        A frame carrying neither our minted id nor a remote mark belongs to the
        mobile watcher path that shares this channel, and is not ours.
        """
        popped = self._pop_correlated(
            session,
            session.pending_buffer,
            frame.get("request_id"),
            target_device_id,
            what="terminal_buffer_response",
        )
        correlated = popped[0] if popped is not None else None
        source_request_id: str | None = None
        att: _Attachment | None
        if popped is not None:
            source_request_id, _jti = popped[0]
            att = popped[1]
        elif _is_remote_marked(frame):
            att = await self._attachment_by_remote_mark(
                session, target_device_id, frame
            )
            # Only a grant the TARGET has bound. ``session.grants`` carries
            # registered-but-unbound grants too, and an unbound one has
            # ``terminal_id is None`` — which the equality guard below would
            # CLEAR against a frame naming no terminal, on `None == None`. The
            # correlated arm cannot reach that state, because its pending entry
            # is written only after `_authorize(require_bound=True)`; this is
            # the unsolicited arm's equivalent of that same requirement.
            if att is not None and not att.attached:
                att = None
        else:
            return False
        if att is None:
            return False
        if frame.get("terminal_id") != att.terminal_id:
            # A reply for a terminal this grant does not hold: our own minted
            # id answered off-terminal, or a resync marked with our grant named
            # someone else's pane. A target defect either way, never something
            # to hand over.
            logger.warning(
                "remote_terminal_buffer_terminal_mismatch",
                source_device_id=session.device_id,
                grant_jti=att.grant_jti,
                expected_terminal_id=att.terminal_id,
                terminal_id=frame.get("terminal_id"),
                correlated=correlated is not None,
            )
            return False
        payload: dict[str, Any] = {
            "type": "remote_terminal_buffer",
            "grant_jti": att.grant_jti,
            "terminal_id": att.terminal_id,
            "data": frame.get("data"),
            "start_offset": frame.get("start_offset"),
            "ring_start_offset": frame.get("ring_start_offset"),
            "total_bytes_produced": frame.get("total_bytes_produced"),
        }
        # Echo the SOURCE's request id only for an RPC we correlated — the same
        # rule ``_route_target_error`` applies, and for the same reason: an id we
        # did not mint belongs to some other watcher.
        #
        # The peer's actual predicate is `rid.starts_with("history:")`, NOT
        # presence: absent, null and any non-`history:` string all splice. So
        # omitting the id is sufficient but not necessary, and the guarantee this
        # relies on is only that we never put a `history:` id on an unsolicited
        # frame. Stated because the stronger reading invites a later
        # "simplification" toward the weaker one.
        if correlated is not None and source_request_id is not None:
            payload["request_id"] = source_request_id
        await self._send_to_source(session, payload)
        return True

    def _should_represent_attach(self, att: _Attachment, frame: dict[str, Any]) -> bool:
        """True when this refusal is the attach-request RACE, not a verdict.

        Every clause is a reason a re-present would be wrong, so all of them
        have to be false. See ``TARGET_CODE_ATTACH_GRANT_UNKNOWN`` above for
        why the code test is an equality against ONE member of
        ``TARGET_ERROR_CODES`` and not a set test: ``attach_grant_expired``,
        ``attach_terminal_mismatch``, ``remote_attach_disabled`` and
        ``session_not_local`` are settled noes and must still land as refusals
        at once.

        The code goes through ``namespace_target_code`` rather than being
        compared raw, so the pass-through membership test is made in exactly
        one place in this module and a target cannot reach this branch with
        anything the source would not have been shown verbatim anyway.
        """
        if att.kind != KIND_ATTACH:
            # A create grant's twin code is ``remote_create_grant_unknown`` and
            # a create is not idempotent — re-presenting one risks a second PTY.
            return False
        if att.represented:
            # ONE shot. The second refusal is the answer.
            return False
        if att.attached or att.attach_frame is None:
            # Nothing pending to re-offer.
            return False
        if att.expired():
            # The relay's own verifier now agrees with the target.
            return False
        return (
            namespace_target_code(frame.get("code")) == TARGET_CODE_ATTACH_GRANT_UNKNOWN
        )

    def _schedule_attach_represent(
        self, session: _SourceSession, att: _Attachment
    ) -> None:
        """Arm the single delayed re-present, holding a reference to the task."""
        att.represented = True
        task = asyncio.get_running_loop().create_task(
            self._represent_attach(session, att)
        )
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _represent_attach(
        self, session: _SourceSession, att: _Attachment
    ) -> None:
        """Re-send the cached ``terminal_attach`` once, under the SAME grant.

        The delay is read from the module at call time so it is tunable (and
        testable) without threading it through every caller.
        """
        await asyncio.sleep(ATTACH_REPRESENT_DELAY_SECONDS)
        # Re-check, do not assume: the socket may have been released, the grant
        # evicted, or the target may have answered the FIRST frame after all.
        if session.grants.get(att.grant_jti) is not att:
            return
        if att.attached or att.attach_frame is None:
            return
        if att.expired():
            await self._evict(
                session, att, code=att.expired_code(), message="grant expired"
            )
            return
        # A fresh WIRE id, never a fresh GRANT: the minted request id is the
        # relay's own correlation handle and re-using it would let a duplicate
        # answer to the first frame be credited to this one. ``grant_jti``,
        # ``cols``, ``rows`` and ``have_offset`` are the source's and are
        # re-offered untouched.
        frame = dict(att.attach_frame)
        minted = uuid4().hex
        frame["request_id"] = minted
        frame["timestamp"] = utc_now().isoformat()
        session.pending_attach[minted] = (att.request_id, att.grant_jti)
        try:
            sent = await session.manager.send_terminal(att.target_device_id, frame)
        except Exception as exc:  # noqa: BLE001 - a dead target is a refusal
            logger.warning(
                "remote_terminal_attach_represent_failed",
                grant_jti=att.grant_jti,
                target_device_id=att.target_device_id,
                error=str(exc),
            )
            sent = False
        if not sent:
            session.pending_attach.pop(minted, None)
            await self._evict(
                session,
                att,
                code=CODE_TARGET_NOT_CONNECTED,
                message="target device is not connected",
            )
            return
        logger.info(
            "remote_terminal_attach_represented",
            source_device_id=session.device_id,
            target_device_id=att.target_device_id,
            grant_jti=att.grant_jti,
            request_id=att.request_id,
            forwarded_request_id=minted,
            delay_seconds=ATTACH_REPRESENT_DELAY_SECONDS,
        )

    @staticmethod
    def _target_error_payload(
        frame: dict[str, Any],
        *,
        grant_jti: str,
        request_id: str | None,
        terminal_id: Any,
    ) -> dict[str, Any]:
        """The ``remote_terminal_error`` a target refusal is REBUILT into."""
        message = frame.get("message")
        if not isinstance(message, str) or not message.strip():
            message = "target refused the remote frame"
        payload: dict[str, Any] = {
            "type": "remote_terminal_error",
            "grant_jti": grant_jti,
            # NAMESPACED, not forwarded: ``code`` is target-supplied and the
            # relay has its own vocabulary on this same field. See
            # ``namespace_target_code``.
            "code": namespace_target_code(frame.get("code")),
            "message": message[:TARGET_MESSAGE_MAX],
        }
        # Echo the SOURCE's request id only for an RPC we correlated; a
        # request id we did not mint belongs to some other watcher.
        if request_id is not None:
            payload["request_id"] = request_id
        if isinstance(terminal_id, str):
            payload["terminal_id"] = terminal_id
        # Forward the target's REMEDY fields. This payload is rebuilt rather
        # than forwarded, so anything not named here is dropped — and the
        # fields the target puts on a create refusal are precisely the ones
        # that make it actionable: which working-dir KEYS it offers, and which
        # intent repos. Without them the source can say "refused" but never
        # "here is what you may ask for instead", which is the difference
        # between an error and a remedy.
        #
        # A bounded allowlist, not a blanket merge: the target controls this
        # frame, so forwarding it wholesale would let it set `code`,
        # `grant_jti` or `request_id` on a payload the source trusts for
        # routing. Each entry is a list of short strings and is length-capped,
        # because a refusal is a diagnostic, not a transfer channel.
        for key in ("allowed_working_dir_keys", "allowed_intent_repos"):
            value = frame.get(key)
            if isinstance(value, list):
                safe = [v for v in value if isinstance(v, str) and len(v) <= 256]
                if safe:
                    payload[key] = safe[:64]
        return payload

    async def _route_end_error(
        self, session: _SourceSession, entry: _PendingEnd, frame: dict[str, Any]
    ) -> bool:
        """A target refusal of a ``terminal_end``, answered from its snapshot.

        Never torn down as a failed attach: a refused end leaves an open tab
        exactly as it was. A fresh-grant end is released, whatever the code.
        """
        terminal_id = entry.terminal_id or frame.get("terminal_id")
        await self._answer_end_and_release(
            session,
            entry,
            self._target_error_payload(
                frame,
                grant_jti=entry.grant_jti,
                request_id=entry.source_request_id,
                terminal_id=terminal_id,
            ),
        )
        return True

    async def _route_target_error(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        wire_request_id = frame.get("request_id")
        # A refused ``terminal_end`` first, and apart: its correlation is a
        # snapshot that must settle even when the attachment is already gone.
        end_entry = self._pop_pending_end(session, wire_request_id, target_device_id)
        if end_entry is not None:
            return await self._route_end_error(session, end_entry, frame)
        att: _Attachment | None = None
        correlated: _Pending | None = None
        failed_attach = False
        # Whether the correlation came off ``pending_attach`` specifically. The
        # re-present below is an ATTACH remedy and must not fire for a refused
        # create or a refused scrollback RPC, which ``failed_attach`` alone
        # cannot tell apart from an attach.
        pending_attach_rpc = False
        # All three pops go through ``_pop_correlated``, so an error arriving on
        # one target's channel under an id minted for another is not the answer
        # — the same rule ``terminal_created`` and ``terminal_attached`` apply,
        # on the same per-session dicts (review round 2, finding 4).
        for pending, is_failed_attach, is_attach_rpc in (
            (session.pending_attach, True, True),
            # A refused create leaves nothing registered either — the target
            # spawned no PTY, so the grant on this socket is garbage for the
            # same reason a refused attach's is.
            (session.pending_create, True, False),
            (session.pending_buffer, False, False),
        ):
            popped = self._pop_correlated(
                session,
                pending,
                wire_request_id,
                target_device_id,
                what="error",
            )
            if popped is not None:
                correlated, att = popped
                failed_attach = is_failed_attach
                pending_attach_rpc = is_attach_rpc
                break
        if att is None:
            # ``_pop_correlated`` has THREE outcomes and this is the third:
            # ``(correlated, None)`` — the id was ours, but the grant it names
            # is no longer on this socket (``_evict`` pops ``session.grants``
            # before its awaits while ``pending_attach`` is still live). The
            # correlation is spent and resolved nothing, so it must not be
            # carried into the fallback below, which re-resolves ``att`` from a
            # TARGET-SUPPLIED ``grant_jti``. Leaving it set applied a dead
            # correlation's verdict to a DIFFERENT live attachment: the source's
            # waiter was resolved with someone else's error, and — because the
            # attach and create arms set ``failed_attach`` — the unrelated
            # attachment was torn down and its Redis rows released, killing a
            # working pane (review round 4, item 2).
            correlated = None
            failed_attach = False
            # Reset for the same reason: the pop that set it resolved nothing,
            # and the fallback below re-resolves ``att`` from a TARGET-SUPPLIED
            # ``grant_jti`` — which is not a pending attach RPC of ours.
            pending_attach_rpc = False
            if _is_remote_marked(frame):
                # Only a frame the target marked as a remote refusal may fall
                # back to the terminal route; a mobile watcher's own
                # request-correlated error is never handed to the source.
                att = await self._attachment_by_remote_mark(
                    session, target_device_id, frame
                )
                if att is not None and att.end_only:
                    # A fresh-grant end has exactly one thing in flight, so a
                    # refusal marked with its grant answers THAT end: settle it
                    # under the source's request id rather than leave the
                    # waiter to the TTL.
                    for rid, entry in list(session.pending_end.items()):
                        if entry.grant_jti == att.grant_jti:
                            session.pending_end.pop(rid, None)
                            self._cancel_end_timer(session, rid)
                            return await self._route_end_error(session, entry, frame)
        if att is None:
            return False
        if pending_attach_rpc and self._should_represent_attach(att, frame):
            # The attach-request RACE, not a verdict: hold the pane, re-offer
            # the SAME grant once, and let the SECOND refusal (if there is one)
            # take the unchanged fatal path below. Nothing is sent to the
            # source and nothing is torn down — the grant, its Redis claim and
            # the listener all stay exactly as the first forward left them.
            logger.info(
                "remote_terminal_attach_grant_unknown_represent_armed",
                source_device_id=session.device_id,
                target_device_id=att.target_device_id,
                grant_jti=att.grant_jti,
                request_id=att.request_id,
                delay_seconds=ATTACH_REPRESENT_DELAY_SECONDS,
            )
            self._schedule_attach_represent(session, att)
            return True
        await self._send_to_source(
            session,
            self._target_error_payload(
                frame,
                grant_jti=att.grant_jti,
                request_id=correlated[0] if correlated is not None else None,
                terminal_id=att.terminal_id or frame.get("terminal_id"),
            ),
        )
        if failed_attach or att.end_only:
            # The target refused the attach itself: nothing is bound, so the
            # grant registration on this socket is garbage now. (An end-only
            # grant reaching here had no end left in flight; it is garbage too.)
            await self._drop_attachment(session, att)
        return True

    # ------------------------------------------------------------------
    # Socket teardown
    # ------------------------------------------------------------------

    async def release_source(self, websocket: Any) -> None:
        """Tear down everything the SOURCE socket held. No-op for a stranger."""
        session = self._sessions.pop(id(websocket), None)
        if session is None:
            return
        for att in list(session.grants.values()):
            await self._detach_target(session, att, att.terminal_id)
            await self._drop_attachment(session, att)
        for target_device_id in list(session.listeners):
            await self._stop_listener(session, target_device_id)
        # An open tab's in-flight end outlives its attachment by design, so
        # the socket's own teardown is what disarms whatever is left: there is
        # no source left to answer.
        for rid in list(session.pending_end):
            session.pending_end.pop(rid, None)
            self._cancel_end_timer(session, rid)
        logger.info(
            "remote_terminal_source_released",
            source_device_id=session.device_id,
        )


# Process-wide singleton — the device WS endpoint routes through it.
_relay = RemoteTerminalRelay()


def get_relay() -> RemoteTerminalRelay:
    return _relay


async def handle_source_frame(
    msg: dict[str, Any],
    device_id: Any,
    manager: Any,
    websocket: Any,
) -> None:
    await _relay.handle_source_frame(msg, device_id, manager, websocket)


async def publish_target_frame(device_id: Any, msg: dict[str, Any]) -> None:
    await _relay.publish_target_frame(device_id, msg)


async def release_source(websocket: Any) -> None:
    await _relay.release_source(websocket)
