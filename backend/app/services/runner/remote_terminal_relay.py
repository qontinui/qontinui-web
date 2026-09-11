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
channel and two sources choosing equal ids would otherwise cross-bind.
Anything else on the channel is ignored. The Redis registry —
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
import re
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
    jwks_failure_log_fields,
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
        # Phase 5 backpressure. The SOURCE's `EmissionGate` closes over the
        # wire, not just locally: without this the frame is refused as an
        # unknown source type and the target never learns to withhold output,
        # so the second hop's buffer grows unbounded under exactly the load
        # that produces backpressure.
        "remote_terminal_flow",
        # Remote CREATE (plan
        # `2026-09-11-headless-runner-parity-from-a-headed-runner`). Forwarded
        # as `terminal_create`, and admitted under a CREATE grant only — a
        # different `sub_type`, a different device preference on the target,
        # and no session of its own. See `_handle_create`.
        "remote_terminal_create",
    }
)

# The grant's ``sub_type`` claim. A device JWT reads ``device`` here; a grant
# is a capability token and is never accepted as one.
ATTACH_GRANT_SUB_TYPE = "attach_grant"
# The CREATE grant's ``sub_type``. A separate capability from the attach grant,
# addressed by DEVICE rather than by session (``coord.SubType::CreateGrant``,
# minted at ``POST /coord/devices/{device_id}/create-grants``): it names a
# target device and NO session, because the session it is about does not exist
# yet. The two are never interchangeable — ``_handle_create`` refuses an attach
# grant and ``_authorize`` refuses a create grant, so neither can be spent on
# the other's frames.
CREATE_GRANT_SUB_TYPE = "create_grant"

# Which capability an attachment on this socket holds.
KIND_ATTACH = "attach"
KIND_CREATE = "create"

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
# Remote-create refusals. Spelled separately from the attach ones rather than
# reused: a source reading ``attach_grant_invalid`` after asking for a CREATE
# would go looking for the wrong token.
CODE_CREATE_GRANT_INVALID = "create_grant_invalid"
CODE_CREATE_GRANT_EXPIRED = "create_grant_expired"
CODE_CREATE_GRANT_WRONG_SOURCE = "create_grant_wrong_source"
# A grant presented for frames of the other kind: a create grant driving a PTY,
# or an attach grant asking for a spawn. The capability, not the token, is what
# is wrong.
CODE_GRANT_WRONG_KIND = "grant_wrong_kind"
# Sent as a ``remote_terminal_error`` (not a refusal of a source frame) when
# the per-target pubsub listener died on its own: the attachment is dropped
# rather than left registered with no return route.
CODE_LISTENER_LOST = "listener_lost"

# ---------------------------------------------------------------------------
# The TARGET's own closed set of refusal codes.
# ---------------------------------------------------------------------------
# ``_route_target_error`` rebuilds the payload rather than forwarding it, but
# ``code`` was taken straight off the target's frame — so a target could emit
# any of the RELAY's codes above and the source would read them as the relay's
# own verdict. Two are directly exploitable: ``attach_grant_expired`` makes the
# source discard live grants and re-mint in a loop, and ``listener_lost`` makes
# it believe the relay lost its route to the device.
#
# The mirror of ``mcp::remote_terminal::{AttachRefusal, CreateRefusal}::code``
# in qontinui-runner plus ``backend_relay``'s own pre-dispatch refusal. A code
# outside it is not dropped — a refusal the source cannot name is a worse
# outcome than one it can — but is NAMESPACED with
# ``TARGET_CODE_PREFIX``, which no relay code shares.
#
# ``attach_grant_unknown`` / ``attach_grant_expired`` are in BOTH vocabularies
# and stay pass-through: the source's handling of them is identical either way
# (the grant is gone), so nothing is gained by making them distinguishable and
# a working feature would be lost.
TARGET_ERROR_CODES = frozenset(
    {
        # AttachRefusal
        "attach_grant_unknown",
        "attach_grant_expired",
        "attach_terminal_mismatch",
        "remote_attach_disabled",
        "session_not_local",
        # CreateRefusal
        "remote_create_disabled",
        "remote_create_grant_required",
        "remote_create_grant_unknown",
        "remote_create_grant_expired",
        "remote_create_no_target_directory",
        "remote_create_working_dir_not_allowed",
        "remote_create_intent_repo_not_allowed",
        "remote_create_source_user_not_allowed",
        # backend_relay's pre-dispatch refusal
        "remote_type_not_admitted",
    }
)

# ---------------------------------------------------------------------------
# The RELAY's own closed set of refusal codes.
# ---------------------------------------------------------------------------
# Enumerated so the namespacing below can be CHECKED against it rather than
# asserted about. ``TARGET_ERROR_CODES`` and this set deliberately intersect
# (``attach_grant_unknown`` / ``attach_grant_expired``): the source's handling
# is identical either way, so those stay pass-through. Every OTHER relay code
# must be unreachable from target input, which is the property
# ``namespace_target_code`` owns.
RELAY_ERROR_CODES = frozenset(
    {
        CODE_GRANT_INVALID,
        CODE_GRANT_EXPIRED,
        CODE_GRANT_WRONG_SOURCE,
        CODE_NOT_REGISTERED,
        CODE_VERIFIER_UNAVAILABLE,
        CODE_REGISTRY_UNAVAILABLE,
        CODE_GRANT_CONSUMED,
        CODE_TERMINAL_BUSY,
        CODE_TARGET_NOT_CONNECTED,
        CODE_CREATE_GRANT_INVALID,
        CODE_CREATE_GRANT_EXPIRED,
        CODE_CREATE_GRANT_WRONG_SOURCE,
        CODE_GRANT_WRONG_KIND,
        CODE_LISTENER_LOST,
        # Minted inside ``route_target_frame`` rather than as a module
        # constant, but it is the relay speaking all the same.
        "attach_terminal_missing",
    }
)

# The prefix a target-supplied code is namespaced under.
#
# It used to be ``target_``, and the docstring claimed collision was impossible
# "by construction" — which was false: ``CODE_TARGET_NOT_CONNECTED`` IS
# ``target_not_connected``, so a connected target answering ``not_connected``
# (or ``Not Connected``, or ``not-connected``, or ``  NOT CONNECTED  ``, all of
# which reduce to the same slug) forged the relay's own "the target is not
# connected" verdict. Nothing branches on that code today, which is why this
# was a 🟠 and not a 🔴 — but a prefix chosen so the claim is TRUE costs
# nothing (review round 2, finding 3).
#
# ``_prefix_is_disjoint_from_relay_codes`` below is the standing check, and
# ``namespace_target_code`` re-checks its own output, so a relay code added
# later that happens to start with this prefix cannot be reached by accident.
TARGET_CODE_PREFIX = "target_said_"

# Longest target-supplied ``code`` / ``message`` forwarded to the source. The
# allowlist above caps its members implicitly; these two fields did not,
# which made a diagnostic into a transfer channel.
TARGET_CODE_MAX = 64
TARGET_MESSAGE_MAX = 512

# What an unusable ``code`` becomes. Namespaced like everything else, so the
# fallback cannot collide either.
TARGET_CODE_FALLBACK = f"{TARGET_CODE_PREFIX}unknown"


def _prefix_is_disjoint_from_relay_codes() -> bool:
    """True when no relay code could be spelled by the namespacing branch.

    Checked at import (below) rather than only in a test: the two vocabularies
    live in one module and a new ``CODE_*`` is exactly the edit that would
    reintroduce the collision.
    """
    return not any(code.startswith(TARGET_CODE_PREFIX) for code in RELAY_ERROR_CODES)


if not _prefix_is_disjoint_from_relay_codes():  # pragma: no cover - import guard
    raise RuntimeError(
        "TARGET_CODE_PREFIX collides with a relay refusal code; pick a prefix "
        "outside the relay's own vocabulary"
    )


def namespace_target_code(raw: Any) -> str:
    """The ``code`` a target refusal may present to the source.

    In ``TARGET_ERROR_CODES`` -> itself. Anything else ->
    ``TARGET_CODE_PREFIX + <slug>``, with the slug reduced to ``[a-z0-9_]`` and
    capped, so a target can neither spell a relay code nor smuggle structure
    through the field. Unusable input (not a string, empty, nothing left after
    the reduction) -> ``TARGET_CODE_FALLBACK``.

    The namespaced branch is re-checked against ``RELAY_ERROR_CODES`` before it
    is returned. That is belt-and-braces over the import-time prefix check, and
    it is cheap: the invariant this function exists to hold is stated once, in
    the place that would have to break it.
    """
    if not isinstance(raw, str):
        return TARGET_CODE_FALLBACK
    code = raw.strip()
    if code in TARGET_ERROR_CODES:
        return code
    slug = re.sub(r"[^a-z0-9_]+", "_", code.lower()).strip("_")[:TARGET_CODE_MAX]
    if not slug:
        return TARGET_CODE_FALLBACK
    namespaced = f"{TARGET_CODE_PREFIX}{slug}"
    if namespaced in RELAY_ERROR_CODES:  # pragma: no cover - prefix check forecloses it
        return TARGET_CODE_FALLBACK
    return namespaced


def _is_uuid(value: Any) -> bool:
    """True when ``value`` is a string spelling a UUID."""
    if not isinstance(value, str):
        return False
    try:
        UUID(value.strip())
    except (ValueError, AttributeError, TypeError):
        return False
    return True


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


# The per-terminal route is claimed and released by two server-side scripts so
# each is ONE atomic round trip. The bind runs inside the listener task, which
# ``release_source`` cancels: as four separate commands, a cancel landing
# between ``HSETNX`` and ``EXPIREAT`` left a busy terminal key with no TTL —
# forever. The release is compare-and-delete: an expired in-memory attachment
# dropped lazily must not delete a key another grant has since bound to the
# same terminal, which would break the one-holder invariant.
#
# BIND — KEYS[1] terminal key; ARGV[1] source_device_id, ARGV[2] grant_jti,
# ARGV[3] exp. Returns 1 when this grant holds the key afterwards (fresh claim
# or its own re-bind), 0 when another grant holds it.
BIND_TERMINAL_SCRIPT = """
local holder = redis.call('HGET', KEYS[1], 'grant_jti')
if holder and holder ~= ARGV[2] then
  return 0
end
redis.call('HSET', KEYS[1],
  'source_device_id', ARGV[1], 'grant_jti', ARGV[2], 'exp', ARGV[3])
redis.call('EXPIREAT', KEYS[1], tonumber(ARGV[3]))
return 1
"""

# RELEASE — KEYS[1] terminal key; ARGV[1] grant_jti. Deletes the key only
# while THIS grant holds it; returns the number of keys deleted (0 or 1).
RELEASE_TERMINAL_SCRIPT = """
if redis.call('HGET', KEYS[1], 'grant_jti') == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


async def _eval(redis: aioredis.Redis, script: str, key: str, *args: str) -> int:
    """Run one of the module's scripts against a single key; the integer reply."""
    return int(await _maybe_await(redis.eval(script, 1, key, *args)))


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


def create_target_device_id(claims: dict[str, Any]) -> str | None:
    """The device a CREATE grant authorises a spawn on; ``None`` when unusable.

    The create claims carry a target DEVICE and no session at all — the
    session a create is about does not exist until the target answers — so
    there is deliberately nothing here corresponding to the attach grant's
    ``target_session_id``.

    Read from ``create.target_device_id`` (symmetric with the attach grant's
    ``attach`` block) and, failing that, from a top-level ``target_device_id``.
    Both spellings are the coord-signed token's own; accepting either costs no
    authority and keeps a claims-layout choice on coord's side from silently
    refusing every create.
    """
    block = claims.get("create")
    raw = (
        block.get("target_device_id")
        if isinstance(block, dict)
        else claims.get("target_device_id")
    )
    try:
        return str(UUID(str(raw)))
    except (ValueError, TypeError):
        return None


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
    # The session the grant is ABOUT. ``None`` for a create grant, whose whole
    # point is that the session does not exist yet — which is why this is not
    # merely optional in the schema sense: the relay used to parse it as a
    # REQUIRED UUID, so a session-less grant died at the parse rather than
    # being understood.
    target_session_id: str | None
    exp: int
    request_id: str | None
    # ``attach`` or ``create``; see KIND_ATTACH / KIND_CREATE. A create
    # attachment never binds a terminal and never admits a session-scoped
    # frame.
    kind: str = KIND_ATTACH
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
        block: dict[str, Any] = {
            "source_device_id": self.source_device_id,
            "grant_jti": self.grant_jti,
        }
        # Stamped only for a create grant, so the attach wire stays
        # byte-identical to what shipped. The target reads an absent ``kind``
        # as ``attach`` — the narrower capability — so the asymmetry fails
        # closed in the direction it should.
        if self.kind == KIND_CREATE:
            block["kind"] = KIND_CREATE
        return block


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
    pending_create: dict[str, _Pending] = field(default_factory=dict)
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
                # Phase 5 lazy scrollback asks for an absolute HALF-OPEN range,
                # and the target reads both ends (`handle_terminal_buffer`).
                # Forwarding only the lower bound turns `[from, to)` into
                # `[from, end-of-ring)`: the operator asks for the window above
                # the attach seed and is answered with the whole ring.
                for bound in ("from_offset", "to_offset"):
                    if msg.get(bound) is not None:
                        extra[bound] = msg.get(bound)
                # Register BEFORE forwarding: the reply can race back on the
                # listener before ``send_terminal`` returns.
                session.pending_buffer[minted] = (
                    source_request_id if isinstance(source_request_id, str) else None,
                    att.grant_jti,
                )
                if not await self._forward(session, msg, att, "terminal_buffer", extra):
                    session.pending_buffer.pop(minted, None)
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
                session, msg, require_bound=False, require_attach_kind=False
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

        attach = claims.get("attach")
        if not isinstance(attach, dict):
            await self._refuse(
                session,
                CODE_GRANT_INVALID,
                "grant missing attach claims",
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
        # A REATTACH carries `have_offset`: the absolute offset of the last byte
        # the source still holds. Dropping it here is not cosmetic — the target
        # reads its absence as "this source has nothing", ships the whole 64 KiB
        # ring tail, and the source then sees a gap where none existed and
        # writes a DATA-LOSS marker into the pane. Forwarded only when present,
        # so a first attach still takes the tail arm deliberately rather than by
        # omission.
        if msg.get("have_offset") is not None:
            frame["have_offset"] = msg.get("have_offset")
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
                CODE_GRANT_CONSUMED,
                "grant is already held by a live attachment",
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

    async def _authorize(
        self,
        session: _SourceSession,
        msg: dict[str, Any],
        *,
        require_bound: bool = True,
        require_attach_kind: bool = True,
    ) -> _Attachment | None:
        """Admit a post-attach frame only for a registered, live grant.

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
        if att.expired():
            # Same two-sided teardown as ``_evict``: the target learns the
            # grant is gone rather than holding a detached subscriber.
            await self._detach_target(session, att, att.terminal_id)
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
        if att.kind != KIND_ATTACH:
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
        if att.target_device_id not in session.targets():
            await self._stop_listener(session, att.target_device_id)

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
        expired = [
            att
            for att in session.grants.values()
            if att.grant_jti != except_jti and att.expired()
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
                session, att, code=CODE_GRANT_EXPIRED, message="grant expired"
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
        """
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
        """Translate one TARGET frame for this source; False when it is not ours."""
        await self._reap_expired(session)
        frame_type = frame.get("type")

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

        if frame_type == "error":
            return await self._route_target_error(session, target_device_id, frame)

        return False

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

    async def _route_target_error(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        wire_request_id = frame.get("request_id")
        att: _Attachment | None = None
        correlated: _Pending | None = None
        failed_attach = False
        # All three pops go through ``_pop_correlated``, so an error arriving on
        # one target's channel under an id minted for another is not the answer
        # — the same rule ``terminal_created`` and ``terminal_attached`` apply,
        # on the same per-session dicts (review round 2, finding 4).
        for pending, is_failed_attach in (
            (session.pending_attach, True),
            # A refused create leaves nothing registered either — the target
            # spawned no PTY, so the grant on this socket is garbage for the
            # same reason a refused attach's is.
            (session.pending_create, True),
            (session.pending_buffer, False),
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
                break
        if att is None and _is_remote_marked(frame):
            # Only a frame the target marked as a remote refusal may fall
            # back to the terminal route; a mobile watcher's own
            # request-correlated error is never handed to the source.
            att = await self._attachment_by_remote_mark(
                session, target_device_id, frame
            )
        if att is None:
            return False
        message = frame.get("message")
        if not isinstance(message, str) or not message.strip():
            message = "target refused the remote frame"
        payload: dict[str, Any] = {
            "type": "remote_terminal_error",
            "grant_jti": att.grant_jti,
            # NAMESPACED, not forwarded: ``code`` is target-supplied and the
            # relay has its own vocabulary on this same field. See
            # ``namespace_target_code``.
            "code": namespace_target_code(frame.get("code")),
            "message": message[:TARGET_MESSAGE_MAX],
        }
        # Echo the SOURCE's request id only for an RPC we correlated; a
        # request id we did not mint belongs to some other watcher.
        if correlated is not None and correlated[0] is not None:
            payload["request_id"] = correlated[0]
        terminal_id = att.terminal_id or frame.get("terminal_id")
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
    manager: Any,
    websocket: Any,
) -> None:
    await _relay.handle_source_frame(msg, device_id, manager, websocket)


async def publish_target_frame(device_id: Any, msg: dict[str, Any]) -> None:
    await _relay.publish_target_frame(device_id, msg)


async def release_source(websocket: Any) -> None:
    await _relay.release_source(websocket)
