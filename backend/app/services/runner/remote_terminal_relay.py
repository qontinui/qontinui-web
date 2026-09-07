"""Device-authed remote-terminal origination door (D6 broker, Phase 3b).

Plan ``2026-08-31-remote-session-tabs-in-runner-terminal``, design decision
D6 / transport B1. A SOURCE device (a runner whose operator clicked *Attach*
on a fleet session) speaks the ``remote_terminal_*`` family on its existing
``WS /api/v1/devices/ws`` socket. This module:

1. **verifies the attach grant** coord minted — the same JWKS verifier
   ``devices_ws`` uses for the device token itself — and refuses with a typed
   ``error`` code when the grant is not an ``attach_grant``, is expired, or
   was minted for a different source device;
2. **claims and registers the attachment** in Redis (multi-replica): the grant
   is claimed atomically (``SET NX EXAT``) so one grant admits ONE live
   attachment on ONE socket, and once the target names the terminal the
   ``(target_device_id, terminal_id)`` route is claimed the same way
   (``HSETNX``) so two grants can never hold one terminal;
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
``terminal_id`` (streaming frames) or by a ``request_id`` this module MINTED
(RPC replies) — the source's own ``request_id`` is never put on the wire to
the target, because every watcher of the target shares that channel and two
sources choosing equal ids would otherwise cross-bind. Anything else on the
channel is ignored. The Redis registry —
``remote_attach:claim:{grant_jti}`` → ``source_device_id`` (the atomic
single-use claim), ``remote_attach:grant:{grant_jti}`` → the full attachment
record, and ``remote_attach:{target_device_id}:{terminal_id}`` →
``{source_device_id, grant_jti, exp}`` — is the durable, replica-independent
record of who holds which terminal, expiring with the grant.
``release_source`` deletes all three, so a source that reconnects re-presents
its grant successfully once the old socket has torn down; a re-presentation
that races the teardown reads ``attach_grant_consumed`` and retries.

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
import inspect
import json
import time
from dataclasses import dataclass, field
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
)
from app.websockets.safe_send import BENIGN_SEND_EXCEPTIONS

logger = structlog.get_logger(__name__)

# Inbound frame types a SOURCE device may send on its device socket.
SOURCE_FRAME_TYPES: frozenset[str] = frozenset(
    {
        "remote_terminal_attach",
        "remote_terminal_input",
        "remote_terminal_resize",
        "remote_terminal_buffer",
        "remote_terminal_detach",
    }
)

# The grant's ``sub_type`` claim. A device JWT reads ``device`` here; a grant
# is a capability token and is never accepted as one.
ATTACH_GRANT_SUB_TYPE = "attach_grant"

# Typed refusal codes answered to the source (wire contract §4).
CODE_GRANT_INVALID = "attach_grant_invalid"
CODE_GRANT_EXPIRED = "attach_grant_expired"
CODE_GRANT_WRONG_SOURCE = "attach_grant_wrong_source"
CODE_NOT_REGISTERED = "attach_not_registered"
# Failures the contract's closed list does not name but that are real and
# distinct: the verifier itself is down (not the grant's fault); the
# attachment registry (Redis) is down; the grant is already held by a live
# attachment (single use); the terminal the target bound is already held by
# another grant; and the target device is not connected to this replica (the
# same local-registry predicate ``runner_terminal_ws`` answers "Runner is not
# connected." on).
CODE_VERIFIER_UNAVAILABLE = "attach_verifier_unavailable"
CODE_REGISTRY_UNAVAILABLE = "attach_registry_unavailable"
CODE_GRANT_CONSUMED = "attach_grant_consumed"
CODE_TERMINAL_BUSY = "attach_terminal_busy"
CODE_TARGET_NOT_CONNECTED = "target_not_connected"


async def _maybe_await(result: Any) -> Any:
    """Resolve a redis-py return typed as the sync/async union.

    redis-py annotates its commands as ``Awaitable[T] | T``, which ``await``
    rejects outright; narrowing on the returned object is the honest spelling
    of "this client is async".
    """
    if inspect.isawaitable(result):
        return await result
    return result


async def _hset(redis: aioredis.Redis, key: str, mapping: dict[str, str]) -> None:
    await _maybe_await(redis.hset(key, mapping=mapping))


async def _hsetnx(redis: aioredis.Redis, key: str, field_name: str, value: str) -> bool:
    return bool(await _maybe_await(redis.hsetnx(key, field_name, value)))


async def _hget(redis: aioredis.Redis, key: str, field_name: str) -> str | None:
    raw = await _maybe_await(redis.hget(key, field_name))
    if raw is None:
        return None
    if isinstance(raw, bytes | bytearray):
        return raw.decode("utf-8")
    return str(raw)


def claim_key(grant_jti: str) -> str:
    """Redis key of the atomic single-use grant claim (a string, ``SET NX EXAT``)."""
    return f"remote_attach:claim:{grant_jti}"


def grant_key(grant_jti: str) -> str:
    """Redis key of the per-grant attachment record."""
    return f"remote_attach:grant:{grant_jti}"


def terminal_key(target_device_id: str, terminal_id: str) -> str:
    """Redis key of the per-terminal return-route record."""
    return f"remote_attach:{target_device_id}:{terminal_id}"


def response_channel(target_device_id: str) -> str:
    """The target's EXISTING runner→mobile response channel."""
    return f"runner:terminal_response:{target_device_id}"


def remote_response_channel(target_device_id: str) -> str:
    """The remote-only channel for target frames no mobile watcher consumes."""
    return f"runner:remote_terminal_response:{target_device_id}"


def is_source_frame(msg_type: Any) -> bool:
    """True when ``msg_type`` is a source-side ``remote_terminal_*`` frame."""
    return isinstance(msg_type, str) and msg_type in SOURCE_FRAME_TYPES


def _is_remote_marked(msg: dict[str, Any]) -> bool:
    """True when a TARGET frame carries a ``remote`` block or a ``grant_jti``."""
    return isinstance(msg.get("remote"), dict) or msg.get("grant_jti") is not None


def is_remote_only_target_frame(msg: dict[str, Any]) -> bool:
    """True for a TARGET frame only the remote path consumes.

    ``terminal_attached`` is new with D6 and has no other consumer. An
    ``error`` with no ``request_id`` is today dropped by ``devices_ws`` (a
    generic error must not surface as a spurious mobile toast); when it
    carries a ``remote`` block or a ``grant_jti`` it is a target refusal of a
    remote keystroke and belongs to the source that sent it.
    """
    msg_type = msg.get("type")
    if msg_type == "terminal_attached":
        return True
    if msg_type == "error" and msg.get("request_id") is None:
        return _is_remote_marked(msg)
    return False


@dataclass
class _Attachment:
    grant_jti: str
    source_device_id: str
    target_device_id: str
    target_session_id: str
    exp: int
    request_id: str | None
    # The terminal the GRANT names — a claim coord wrote, forwarded to the
    # target as a hint. It binds nothing here.
    requested_terminal_id: str | None = None
    # The terminal the TARGET bound in its ``terminal_attached``. None until
    # then; the return route and every post-attach frame key on this.
    terminal_id: str | None = None
    attached: bool = False

    def expired(self, now: float | None = None) -> bool:
        return (now if now is not None else time.time()) >= self.exp

    def remote_block(self) -> dict[str, Any]:
        return {
            "source_device_id": self.source_device_id,
            "grant_jti": self.grant_jti,
        }


# ``pending_*`` entries: the MINTED request_id on the wire to the target maps
# back to (the source's own request_id, grant_jti).
_Pending = tuple[str | None, str]


@dataclass
class _SourceSession:
    """Everything one SOURCE socket holds: its grants, pending RPCs, listeners."""

    websocket: Any
    device_id: str
    manager: Any
    grants: dict[str, _Attachment] = field(default_factory=dict)
    pending_attach: dict[str, _Pending] = field(default_factory=dict)
    pending_buffer: dict[str, _Pending] = field(default_factory=dict)
    listeners: dict[str, tuple[Any, asyncio.Task[None]]] = field(default_factory=dict)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def by_terminal(
        self, target_device_id: str, terminal_id: Any
    ) -> _Attachment | None:
        """The attachment the TARGET bound to ``terminal_id``, if any."""
        if not isinstance(terminal_id, str):
            return None
        for att in self.grants.values():
            if (
                att.attached
                and att.target_device_id == target_device_id
                and att.terminal_id == terminal_id
            ):
                return att
        return None

    def targets(self) -> set[str]:
        return {att.target_device_id for att in self.grants.values()}


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
        user_id: Any,
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

        if msg_type == "remote_terminal_attach":
            await self._handle_attach(session, msg)
        elif msg_type == "remote_terminal_input":
            att = await self._authorize(session, msg)
            if att is not None:
                await self._forward(
                    session, msg, att, "terminal_input", {"data": msg.get("data")}
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
                if msg.get("from_offset") is not None:
                    extra["from_offset"] = msg.get("from_offset")
                # Register BEFORE forwarding: the reply can race back on the
                # listener before ``send_terminal`` returns.
                session.pending_buffer[minted] = (
                    source_request_id if isinstance(source_request_id, str) else None,
                    att.grant_jti,
                )
                if not await self._forward(session, msg, att, "terminal_buffer", extra):
                    session.pending_buffer.pop(minted, None)
        elif msg_type == "remote_terminal_detach":
            # Admitted on the grant alone: a source may give up an attach the
            # target never answered, and stranding that grant until expiry
            # would be the only alternative.
            att = await self._authorize(session, msg, require_bound=False)
            if att is not None:
                await self._detach_target(session, att, att.terminal_id)
                await self._drop_attachment(session, att)

    async def _handle_attach(
        self, session: _SourceSession, msg: dict[str, Any]
    ) -> None:
        request_id = msg.get("request_id")
        grant = msg.get("grant")
        if not isinstance(grant, str) or not grant:
            await self._refuse(
                session, CODE_GRANT_INVALID, "grant missing", request_id=request_id
            )
            return

        # Same verifier, same JWKS, as the device token on this very socket.
        try:
            claims = await coord_jwks_client.verify_token(grant)
        except CoordTokenExpiredError as exc:
            await self._refuse(
                session, CODE_GRANT_EXPIRED, str(exc), request_id=request_id
            )
            return
        except CoordTokenInvalidError as exc:
            await self._refuse(
                session, CODE_GRANT_INVALID, str(exc), request_id=request_id
            )
            return
        except CoordJWKSUnavailableError as exc:
            logger.error(
                "remote_terminal_verifier_unavailable",
                source_device_id=session.device_id,
                error=str(exc),
                coord_url=coord_jwks_client.coord_url,
            )
            await self._refuse(
                session,
                CODE_VERIFIER_UNAVAILABLE,
                "grant verifier temporarily unavailable",
                request_id=request_id,
            )
            return

        if claims.get("sub_type") != ATTACH_GRANT_SUB_TYPE:
            await self._refuse(
                session,
                CODE_GRANT_INVALID,
                "token is not an attach grant",
                request_id=request_id,
            )
            return

        # The grant is bound to the SOURCE device coord minted it for, and the
        # source is whoever authenticated THIS socket — never a body field.
        try:
            grant_source = str(UUID(str(claims.get("device_id"))))
            socket_source = str(UUID(session.device_id))
        except (ValueError, TypeError):
            await self._refuse(
                session,
                CODE_GRANT_INVALID,
                "grant device_id malformed",
                request_id=request_id,
            )
            return
        if grant_source != socket_source:
            await self._refuse(
                session,
                CODE_GRANT_WRONG_SOURCE,
                "grant was minted for a different source device",
                request_id=request_id,
            )
            return

        exp = claims.get("exp")
        if not isinstance(exp, int | float) or exp <= time.time():
            await self._refuse(
                session, CODE_GRANT_EXPIRED, "grant expired", request_id=request_id
            )
            return

        jti = claims.get("jti")
        attach = claims.get("attach")
        if not isinstance(jti, str) or not jti or not isinstance(attach, dict):
            await self._refuse(
                session,
                CODE_GRANT_INVALID,
                "grant missing jti or attach claims",
                request_id=request_id,
            )
            return
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
            return
        raw_terminal_id = attach.get("terminal_id")
        requested_terminal_id = (
            raw_terminal_id if isinstance(raw_terminal_id, str) else None
        )

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

        remote: dict[str, Any] = {
            **att.remote_block(),
            "session_id": target_session_id,
        }
        if requested_terminal_id is not None:
            remote["terminal_id"] = requested_terminal_id
        frame: dict[str, Any] = {
            "type": "terminal_attach",
            "request_id": minted,
            "cols": msg.get("cols"),
            "rows": msg.get("rows"),
            "remote": remote,
            "timestamp": utc_now().isoformat(),
        }
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

    async def _authorize(
        self,
        session: _SourceSession,
        msg: dict[str, Any],
        *,
        require_bound: bool = True,
    ) -> _Attachment | None:
        """Admit a post-attach frame only for a registered, live grant.

        With ``require_bound`` (the default) the TARGET must also have
        answered ``terminal_attached`` and the frame must name that terminal;
        a grant that merely NAMES a terminal admits nothing.
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
        if att.expired():
            await self._drop_attachment(session, att)
            await self._refuse(
                session,
                CODE_GRANT_EXPIRED,
                "grant expired",
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
        frame: dict[str, Any] = {
            "type": target_type,
            "terminal_id": att.terminal_id,
            **extra,
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
            "target_session_id": att.target_session_id,
            "exp": str(att.exp),
            "request_id": att.request_id or "",
            "requested_terminal_id": att.requested_terminal_id or "",
            "terminal_id": "",
        }
        await _hset(redis, grant_key(att.grant_jti), mapping=record)
        await redis.expireat(grant_key(att.grant_jti), att.exp)

    async def _bind_terminal(self, att: _Attachment, terminal_id: str) -> bool:
        """Claim the ``(target, terminal)`` route for this grant; False when busy."""
        redis = await self._get_redis()
        key = terminal_key(att.target_device_id, terminal_id)
        claimed = await _hsetnx(redis, key, "grant_jti", att.grant_jti)
        if not claimed:
            holder = await _hget(redis, key, "grant_jti")
            if holder != att.grant_jti:
                return False
        await _hset(
            redis,
            key,
            mapping={
                "source_device_id": att.source_device_id,
                "grant_jti": att.grant_jti,
                "exp": str(att.exp),
            },
        )
        await redis.expireat(key, att.exp)
        await _hset(
            redis, grant_key(att.grant_jti), mapping={"terminal_id": terminal_id}
        )
        return True

    async def _drop_attachment(self, session: _SourceSession, att: _Attachment) -> None:
        session.grants.pop(att.grant_jti, None)
        for pending in (session.pending_attach, session.pending_buffer):
            for rid in [r for r, (_, j) in pending.items() if j == att.grant_jti]:
                pending.pop(rid, None)
        try:
            redis = await self._get_redis()
            keys = [claim_key(att.grant_jti), grant_key(att.grant_jti)]
            if att.terminal_id is not None:
                keys.append(terminal_key(att.target_device_id, att.terminal_id))
            await redis.delete(*keys)
        except Exception as exc:  # noqa: BLE001 - registry cleanup is best effort
            logger.error(
                "remote_terminal_registry_delete_failed",
                grant_jti=att.grant_jti,
                error=str(exc),
            )
        if att.target_device_id not in session.targets():
            await self._stop_listener(session, att.target_device_id)

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
            await session.manager.relay.send_command_to_runner(
                target_device_id,
                {"type": "terminal_subscribe", "runner_id": target_device_id},
            )
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
        try:
            await session.manager.relay.send_command_to_runner(
                target_device_id,
                {"type": "terminal_unsubscribe", "runner_id": target_device_id},
            )
        except Exception as exc:  # noqa: BLE001 - the runner may already be gone
            logger.debug(
                "remote_terminal_unsubscribe_failed",
                target_device_id=target_device_id,
                error=str(exc),
            )

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
            # its registration behind or its pubsub open. When
            # ``_stop_listener`` ended us, it already popped the entry and
            # its finisher closes the pubsub after we have left ``listen()``.
            entry = session.listeners.get(target_device_id)
            if entry is not None and entry[1] is asyncio.current_task():
                session.listeners.pop(target_device_id, None)
                await self._close_pubsub(pubsub)

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
        """Translate one TARGET frame for this source; False when it is not ours."""
        frame_type = frame.get("type")

        if frame_type == "terminal_attached":
            wire_request_id = frame.get("request_id")
            correlated = (
                session.pending_attach.pop(wire_request_id, None)
                if isinstance(wire_request_id, str)
                else None
            )
            if correlated is None:
                return False
            source_request_id, jti = correlated
            att = session.grants.get(jti)
            if att is None:
                return False
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
            att.terminal_id = terminal_id
            att.attached = True
            await self._send_to_source(
                session,
                {
                    "type": "remote_terminal_attached",
                    "request_id": source_request_id,
                    "grant_jti": att.grant_jti,
                    "terminal_id": terminal_id,
                    "buffer": frame.get("buffer", frame.get("data")),
                    "start_offset": frame.get("start_offset"),
                    "total_bytes_produced": frame.get("total_bytes_produced"),
                },
            )
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
            wire_request_id = frame.get("request_id")
            correlated = (
                session.pending_buffer.pop(wire_request_id, None)
                if isinstance(wire_request_id, str)
                else None
            )
            if correlated is None:
                return False
            source_request_id, jti = correlated
            att = session.grants.get(jti)
            if att is None:
                return False
            if frame.get("terminal_id") != att.terminal_id:
                # Our own minted id answered for a terminal this grant does
                # not hold: a target defect, never something to hand over.
                logger.warning(
                    "remote_terminal_buffer_terminal_mismatch",
                    source_device_id=session.device_id,
                    grant_jti=att.grant_jti,
                    expected_terminal_id=att.terminal_id,
                    terminal_id=frame.get("terminal_id"),
                )
                return False
            await self._send_to_source(
                session,
                {
                    "type": "remote_terminal_buffer",
                    "request_id": source_request_id,
                    "grant_jti": att.grant_jti,
                    "terminal_id": att.terminal_id,
                    "data": frame.get("data"),
                    "start_offset": frame.get("start_offset"),
                    "total_bytes_produced": frame.get("total_bytes_produced"),
                },
            )
            return True

        if frame_type == "error":
            return await self._route_target_error(session, target_device_id, frame)

        return False

    async def _route_target_error(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        wire_request_id = frame.get("request_id")
        att: _Attachment | None = None
        correlated: _Pending | None = None
        failed_attach = False
        if isinstance(wire_request_id, str):
            correlated = session.pending_attach.pop(wire_request_id, None)
            if correlated is not None:
                failed_attach = True
            else:
                correlated = session.pending_buffer.pop(wire_request_id, None)
            if correlated is not None:
                att = session.grants.get(correlated[1])
        if att is None and _is_remote_marked(frame):
            # Only a frame the target marked as a remote refusal may fall
            # back to the terminal route; a mobile watcher's own
            # request-correlated error is never handed to the source.
            remote = frame.get("remote")
            jti_hint = (
                remote.get("grant_jti") if isinstance(remote, dict) else None
            ) or frame.get("grant_jti")
            if isinstance(jti_hint, str):
                att = session.grants.get(jti_hint)
            if att is None:
                att = await self._bound_attachment(
                    session, target_device_id, frame.get("terminal_id")
                )
        if att is None:
            return False
        payload: dict[str, Any] = {
            "type": "remote_terminal_error",
            "grant_jti": att.grant_jti,
            "code": frame.get("code") or "target_error",
            "message": frame.get("message") or "target refused the remote frame",
        }
        # Echo the SOURCE's request id only for an RPC we correlated; a
        # request id we did not mint belongs to some other watcher.
        if correlated is not None and correlated[0] is not None:
            payload["request_id"] = correlated[0]
        terminal_id = att.terminal_id or frame.get("terminal_id")
        if isinstance(terminal_id, str):
            payload["terminal_id"] = terminal_id
        await self._send_to_source(session, payload)
        if failed_attach:
            # The target refused the attach itself: nothing is bound, so the
            # grant registration on this socket is garbage now.
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
    user_id: Any,
    manager: Any,
    websocket: Any,
) -> None:
    await _relay.handle_source_frame(msg, device_id, user_id, manager, websocket)


async def publish_target_frame(device_id: Any, msg: dict[str, Any]) -> None:
    await _relay.publish_target_frame(device_id, msg)


async def release_source(websocket: Any) -> None:
    await _relay.release_source(websocket)
