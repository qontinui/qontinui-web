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
import time
from collections.abc import Coroutine
from typing import Any
from uuid import uuid4

import structlog
from qontinui_schemas.common import utc_now
from redis import asyncio as aioredis

from app.config.redis_config import get_redis
from app.services.coord_jwks import coord_jwks_client
from app.services.runner.remote_relay.end import PENDING_END_TTL_SECONDS, EndCoordinator
from app.services.runner.remote_relay.grants import GrantAuthorizer
from app.services.runner.remote_relay.listeners import ListenerPool
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
    RelayRegistry,
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
from app.services.runner.remote_relay.target_frames import (
    ATTACH_REPRESENT_DELAY_SECONDS,
    TargetFrameRouter,
)
from app.websockets.safe_send import BENIGN_SEND_EXCEPTIONS

logger = structlog.get_logger(__name__)

# The relay is the module facade: ``devices_ws`` and the tests read the wire
# vocabulary, the socket state and the registry primitives through it, so the
# names imported above from ``remote_relay`` are re-exported here (``__all__``).
# Re-exported for READING only. To PATCH one, patch the module that defines it
# (``remote_relay.protocol`` / ``.state`` / ``.registry`` / ``.end`` /
# ``.target_frames``): code reads a name from its own module's globals at call
# time, so a patch on this facade does not reach code that lives there. (``coord_jwks_client`` is an OBJECT whose
# method tests patch, which reaches ``remote_relay.grants`` from here too.)
__all__ = [
    "ATTACH_GRANT_SUB_TYPE",
    "ATTACH_REPRESENT_DELAY_SECONDS",
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
    "PENDING_END_TTL_SECONDS",
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
    "coord_jwks_client",
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


class RemoteTerminalRelay:
    """Broker between a SOURCE device socket and a TARGET device's terminals."""

    def __init__(self, redis_client: aioredis.Redis | None = None) -> None:
        self._redis = redis_client
        # id(websocket) -> session. The socket object is the identity: one
        # device may reconnect (new socket, same device_id) while the old
        # session is still tearing down.
        self._sessions: dict[int, _SourceSession] = {}
        # Tasks spawned by ``spawn_background`` (end timers, listener
        # finishers, attach re-presents); held so the event loop cannot
        # garbage-collect them mid-flight.
        self._background: set[asyncio.Task[None]] = set()
        # Collaborators, in dependency order: each is handed the siblings it
        # calls and the core (``remote_relay.core.RelayCore``), nothing else.
        self.registry = RelayRegistry(self)
        self.grants = GrantAuthorizer(self)
        self.end = EndCoordinator(self, self.grants, self.registry)
        self.router = TargetFrameRouter(self, self.end, self.registry)
        self.listeners = ListenerPool(self, self.end)

    # ------------------------------------------------------------------
    # Plumbing
    # ------------------------------------------------------------------

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = await get_redis()
        return self._redis

    def spawn_background(self, coro: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
        """Run ``coro`` as a task the relay holds until it finishes.

        Synchronous on purpose: spawning adds no suspend point to the caller.
        """
        task = asyncio.get_running_loop().create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    def _ensure_listener(
        self, session: _SourceSession, target_device_id: str
    ) -> Coroutine[Any, Any, None]:
        """``ListenerPool._ensure_listener``, for the end protocol.

        ``EndCoordinator`` is built before ``ListenerPool`` (which settles
        ends when a listener dies), so it reaches the listener through the
        core. Returns the coroutine rather than awaiting it: the delegation
        adds no suspend point.
        """
        return self.listeners._ensure_listener(session, target_device_id)

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
            await self.end._handle_end(session, msg)
        elif msg_type == "remote_terminal_input":
            att = await self.grants._authorize(session, msg)
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
            att = await self.grants._authorize(session, msg)
            if att is not None:
                await self._forward(
                    session,
                    msg,
                    att,
                    "terminal_resize",
                    {"cols": msg.get("cols"), "rows": msg.get("rows")},
                )
        elif msg_type == "remote_terminal_buffer":
            att = await self.grants._authorize(session, msg)
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
            att = await self.grants._authorize(session, msg)
            if att is not None:
                await self._forward(
                    session, msg, att, "terminal_flow", {"paused": msg.get("paused")}
                )
        elif msg_type == "remote_terminal_detach":
            # Admitted on the grant alone: a source may give up an attach the
            # target never answered, and stranding that grant until expiry
            # would be the only alternative.
            att = await self.grants._authorize(
                session,
                msg,
                require_bound=False,
                require_attach_kind=False,
                settle_waiter=False,
            )
            if att is not None:
                await self._detach_target(session, att, att.terminal_id)
                await self._drop_attachment(session, att)

    async def _handle_attach(
        self, session: _SourceSession, msg: dict[str, Any]
    ) -> None:
        request_id = msg.get("request_id")
        verified = await self.grants._verify_grant(
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

        target = await self.grants._attach_target(session, claims, request_id)
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
            claimed = await self.registry._claim_grant(att)
            if claimed:
                await self.registry._write_grant_record(att)
                session.grants[jti] = att
                session.pending_attach[minted] = (att.request_id, jti)
                await self.listeners._ensure_listener(session, target_device_id)
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
        verified = await self.grants._verify_grant(
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
            claimed = await self.registry._claim_grant(att)
            if claimed:
                await self.registry._write_grant_record(att)
                session.grants[jti] = att
                session.pending_create[minted] = (att.request_id, jti)
                await self.listeners._ensure_listener(session, target_device_id)
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
    # Forwarding
    # ------------------------------------------------------------------

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
    # Teardown
    # ------------------------------------------------------------------

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
                self.end._cancel_end_timer(session, rid)
        try:
            # Two commands; shielded so a cancel of the caller (socket
            # teardown) cannot stop after the first and strand the second.
            await asyncio.shield(self.registry._release_registry(att))
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
        await self.listeners._stop_listener(session, target_device_id)

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

    def publish_target_frame(
        self, device_id: Any, msg: dict[str, Any]
    ) -> Coroutine[Any, Any, None]:
        """``ListenerPool.publish_target_frame``; returns its coroutine."""
        return self.listeners.publish_target_frame(device_id, msg)

    def route_target_frame(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> Coroutine[Any, Any, bool]:
        """``TargetFrameRouter.route_target_frame``; returns its coroutine.

        Kept on the relay because ``ListenerPool`` routes through the core and
        the tests drive the return path here. Returning the coroutine rather
        than awaiting it adds no suspend point.
        """
        return self.router.route_target_frame(session, target_device_id, frame)

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
            await self.listeners._stop_listener(session, target_device_id)
        # An open tab's in-flight end outlives its attachment by design, so
        # the socket's own teardown is what disarms whatever is left: there is
        # no source left to answer.
        for rid in list(session.pending_end):
            session.pending_end.pop(rid, None)
            self.end._cancel_end_timer(session, rid)
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
