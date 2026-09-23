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
# Single use, for a create: the grant was already presented on this socket, or
# its claim is held. The attach twin is ``attach_grant_consumed``; the rule
# above applies to it and to expiry alike — see ``_Attachment.expired_code``.
CODE_CREATE_GRANT_CONSUMED = "create_grant_consumed"
# A grant presented for frames of the other kind: a create grant driving a PTY,
# or an attach grant asking for a spawn. The capability, not the token, is what
# is wrong.
CODE_GRANT_WRONG_KIND = "grant_wrong_kind"
# Sent as a ``remote_terminal_error`` (not a refusal of a source frame) when
# the per-target pubsub listener died on its own: the attachment is dropped
# rather than left registered with no return route.
CODE_LISTENER_LOST = "listener_lost"
# Too many scrollback RPCs outstanding on this socket at once. See
# ``PENDING_BUFFER_MAX``: the source may retry once the target answers or the
# TTL sweeps the backlog.
CODE_BUFFER_BACKLOG = "buffer_backlog"

# ---------------------------------------------------------------------------
# The TARGET's own closed set of refusal codes.
# ---------------------------------------------------------------------------
# ``_route_target_error`` rebuilds the payload rather than forwarding it, but
# ``code`` was taken straight off the target's frame — so a target could emit
# any of the RELAY's codes above and the source would read them as the relay's
# own verdict. ``listener_lost`` is the clearest example: it makes the source
# believe the RELAY lost its route to the device, which is a claim only the
# relay is in a position to make.
#
# The mirror of ``mcp::remote_terminal::{AttachRefusal, CreateRefusal}::code``
# in qontinui-runner plus ``backend_relay``'s own pre-dispatch refusal. A code
# outside it is not dropped — a refusal the source cannot name is a worse
# outcome than one it can — but is NAMESPACED with
# ``TARGET_CODE_PREFIX``, which no relay code shares.
#
# ``attach_grant_unknown`` / ``attach_grant_expired`` are in BOTH vocabularies
# and stay pass-through. State the trade honestly, because two earlier drafts
# of this comment contradicted each other on it (review round 4, item 4):
#
# * What pass-through COSTS. The source cannot distinguish "the relay's
#   verifier rejected your grant" from "the counterparty you attached to claims
#   your grant is gone" — the code is the same on both. Both codes are in
#   qontinui-runner's ``FATAL_REMOTE_ERROR_CODES``
#   (``mcp::remote_terminal``), so the source CLOSES the pane on the target's
#   say-so, and will do it again on the next attach. That is a repeatable
#   pane-level denial of service.
# * Why it is nonetheless defensible. The party doing it is the target this
#   source deliberately attached to, it can already end the pane by refusing
#   the attach outright or by killing the PTY, and it gains no capability it
#   did not have: no grant is issued, no grant is re-minted (there is no
#   auto-remint path — an earlier draft claiming the source "discards live
#   grants and re-mints in a loop" was simply wrong), nothing is read. It is a
#   nuisance against yourself, not a privilege gain.
#
# Namespacing them instead would cost the working feature: the source would
# stop recognising a genuinely dead grant and hold a pane open against a
# target that has nothing left to route to it.
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
# The frame TYPES a target may spell a refusal with.
# ---------------------------------------------------------------------------
# ``error`` is the contract. ``remote_terminal_error`` is a SYNONYM for it and
# nothing more — never a pre-approved result.
#
# The second spelling is not hypothetical: qontinui-runner's
# ``AttachRefusal::SessionNotLocal`` builds its refusal as
# ``{"type": "remote_terminal_error", ...}`` while every other target refusal
# goes through ``refusal_frame`` and emits ``{"type": "error", ...}``. A frame
# already wearing the relay's OWN outbound type matched nothing on this side —
# not ``is_source_frame``, not ``is_remote_only_target_frame``, not any
# ``devices_ws`` arm — so it was discarded as ``devices_ws_unhandled_message``
# and the source was told nothing.
#
# The scope of that, stated exactly, because it is easy to overstate in both
# directions. It is LATENT: one refusal class, unreachable by the source under
# any conditions, from the day the spelling diverged. No observed incident is
# attributed to it here — the attach failure that led to the discovery was
# traced to something else entirely — and nothing in this module should be
# read as fixing a timeout. What makes it worth fixing anyway is that the
# class is dead on arrival rather than merely rare, and that fixing the
# EMITTER only fixes devices that are rebuilt; admitting the synonym here is
# what reaches a device already running the old binary.
#
# The danger the synonym introduces, and the one thing that must never be
# conceded: a frame arriving typed ``remote_terminal_error`` LOOKS
# relay-authored, and forwarding it verbatim would hand the target the relay's
# own voice — ``listener_lost`` above all, a claim only the relay is in a
# position to make. So every member of this set is dispatched to
# ``_route_target_error``, which REBUILDS the payload and puts ``code``
# through ``namespace_target_code``. The inbound type is read to decide
# routing and is then thrown away; the outbound type is the relay's literal.
# There is deliberately no branch anywhere that treats a member of this set as
# already-translated.
TARGET_REFUSAL_FRAME_TYPES: frozenset[str] = frozenset(
    {
        "error",
        "remote_terminal_error",
    }
)

# ---------------------------------------------------------------------------
# ONE bounded re-present of an attach the target answered ``attach_grant_unknown``.
# ---------------------------------------------------------------------------
# The pass-through argument above stands, and this does NOT relax it: the code
# still reaches the source unchanged, still un-namespaced, still fatal. What
# changes is that the source is told ONCE LATER instead of once immediately —
# and only for the single code where "unknown" is provably a RACE rather than a
# verdict.
#
# The race, measured 2026-09-20 on ``merytshost``. A target learns of a grant
# two ways: the push on ``qontinui.sessions.<tenant>.<device>.attach_request``,
# and a catch-up ``GET /sessions/attach-requests`` on a 60 s timer
# (qontinui-runner ``session/attach.rs``). Lose the push and the target's
# ledger has no row for the jti until the next poll tick, so it answers
# ``attach_grant_unknown`` — truthfully, about a grant coord has ALREADY
# written and that lives 15 minutes. The source treats the code as fatal
# (``FATAL_REMOTE_ERROR_CODES``), closes the pane, and every retry mints a
# FRESH jti — so the poll tick that finally lands records a jti no later frame
# ever presents again. The failure is permanent, not flaky, and it is the
# fresh-jti retry that makes it so.
#
# Why this is the narrowest fix that answers it:
#
# * it re-presents the SAME ``grant_jti`` — the one the target's next poll will
#   record. Minting a new one is the defect, not the remedy;
# * ONE shot, never a loop. The second ``attach_grant_unknown`` for a grant
#   takes the unchanged fatal path, so a genuinely dead grant still surfaces as
#   a refusal — one delay later, well inside the source's own 20 s
#   ``ATTACH_TIMEOUT``;
# * only for a grant THIS RELAY verified (signature, ``sub_type``, source
#   device, expiry) and still holds live and unbound on this socket. Never for
#   ``attach_grant_expired`` — where the target and the relay agree the
#   capability is spent — nor for a wrong-source refusal, nor for any other
#   member of the closed set above, all of which are settled noes;
# * it forges nothing: ``namespace_target_code`` still owns every code that
#   reaches the source, and this branch mints no code of its own.
#
# What it does NOT buy. One re-present at ~3 s closes only the window where the
# target's ledger catches up within that delay — the on-demand re-read landed in
# qontinui-runner ``b74a09312``, which reads coord the moment an unknown jti is
# presented. Against a target WITHOUT that build the rescuer is the 60 s poll,
# and a single retry inside a 20 s budget covers at most a ~20/60 slice of the
# tick even if it were spent entirely on waiting. It is a partial fix by
# construction; the complete one is the target-side re-read.
TARGET_CODE_ATTACH_GRANT_UNKNOWN = "attach_grant_unknown"

# How long to wait before the single re-present.
#
# Bounded from above by the SOURCE's ``ATTACH_TIMEOUT`` of 20 s: the re-present
# has to be forwarded, answered and routed back inside that budget or the
# source has already given up and the frame buys nothing. 3 s leaves ~17 s for
# the round trip, which is the whole point of picking a figure well under the
# ceiling rather than one close to it. It is also long enough to be a genuine
# second look on a target that re-reads coord on demand, where the answer turns
# over in well under a second.
ATTACH_REPRESENT_DELAY_SECONDS = 3.0

# ---------------------------------------------------------------------------
# The RELAY's own closed set of refusal codes.
# ---------------------------------------------------------------------------
# DERIVED, not transcribed. It used to be a hand-written literal list, and a
# hand-written list is the defect it exists to prevent: a ``CODE_*`` constant
# added without a matching line would be invisible to BOTH
# ``_prefix_is_disjoint_from_relay_codes`` and ``namespace_target_code``'s
# re-check, so a target could spell the new relay code and the source would
# read it as the relay's own verdict (review round 4, item 3).
#
# Two sources, because there are genuinely two:
#
# * every ``CODE_*`` module constant, swept out of the module namespace — the
#   sweep runs at import, after the constants above and before anything reads
#   the set, so a new constant joins with no second edit;
# * ``_INLINE_RELAY_ERROR_CODES``, the codes minted as a literal at the point
#   of use rather than as a constant. That set is still hand-written — a
#   string literal inside a function body cannot be swept out of the module
#   namespace — but it is now the ONLY hand-written half, and
#   ``test_relay_error_codes_covers_every_inline_code_literal`` scans this
#   module's source for ``"code": "<literal>"`` and fails on any that is not
#   here. The two must agree.
#
# ``TARGET_ERROR_CODES`` and this set deliberately intersect
# (``attach_grant_unknown`` / ``attach_grant_expired``): the source's handling
# is identical either way, so those stay pass-through. Every OTHER relay code
# must be unreachable from target input, which is the property
# ``namespace_target_code`` owns.
_INLINE_RELAY_ERROR_CODES = frozenset(
    {
        # Minted inside ``route_target_frame`` rather than as a module
        # constant, but it is the relay speaking all the same.
        "attach_terminal_missing",
    }
)

RELAY_ERROR_CODES = frozenset(
    {
        value
        for name, value in list(globals().items())
        if name.startswith("CODE_") and isinstance(value, str)
    }
    | _INLINE_RELAY_ERROR_CODES
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

# Target frame types whose ROUTED receipt is logged at debug rather than info.
# ``route_target_frame`` logs every frame it is handed (see its docstring);
# ``terminal_output`` is the firehose — one frame per PTY write across every
# terminal the target has — so it is the one type that must not be an info
# line. Everything else on these channels is a lifecycle or RPC frame, rare
# enough that an info line per frame is what makes the route auditable.
_HIGH_VOLUME_TARGET_FRAMES = frozenset({"terminal_output"})


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

    A refusal type is admitted by DEFAULT — membership in
    ``TARGET_REFUSAL_FRAME_TYPES`` is the gate, so a spelling added there is
    admitted here without a second edit, and ``devices_ws`` never grows a
    drifting copy of the list. ``error`` is the one carve-out, and only
    because the mobile watcher path shares that exact type.

    Which makes ``remote_terminal_error`` admitted UNCONDITIONALLY, and the
    asymmetry is the point rather than an oversight. Neither ``error``
    condition has a reason to apply to it: no mobile arm in ``devices_ws``
    matches that type and no mobile client consumes it, so there is no
    spurious toast to prevent and no already-routed correlated twin. Carrying
    either condition over would leave a live shape still discarded — a refusal
    correlated by the MINTED ``request_id`` and carrying no ``remote`` block
    satisfies neither — for no benefit either condition was bought for.
    Admitting it costs nothing: a frame that belongs to no attachment on a
    socket is answered ``False`` by ``route_target_frame`` and goes nowhere,
    the same fate ``terminal_attached`` already has.
    """
    msg_type = msg.get("type")
    if not isinstance(msg_type, str):
        return False
    if msg_type == "terminal_attached":
        return True
    if msg_type not in TARGET_REFUSAL_FRAME_TYPES:
        return False
    if msg_type == "error":
        return msg.get("request_id") is None and _is_remote_marked(msg)
    return True


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
    # The ``terminal_attach`` frame exactly as forwarded, minus nothing: the
    # ONE bounded re-present re-sends THIS dict with a fresh wire
    # ``request_id`` and ``timestamp`` and everything else untouched.
    #
    # Cached rather than rebuilt because the source frame is long gone by the
    # time the target refuses, and three of its fields are load-bearing on
    # replay: ``cols`` / ``rows`` (rebuilt as ``None`` they resize the pane) and
    # ``have_offset`` (dropped, the target reads "this source has nothing",
    # ships the whole ring tail, and the source writes a false DATA-LOSS marker
    # into a pane that lost nothing). See ``_handle_attach``.
    attach_frame: dict[str, Any] | None = None
    # Armed at most once, and never reset: the second ``attach_grant_unknown``
    # for this grant takes the unchanged fatal path. This is what makes the
    # re-present one-shot rather than a retry loop.
    represented: bool = False

    def expired(self, now: float | None = None) -> bool:
        return (now if now is not None else time.time()) >= self.exp

    def expired_code(self) -> str:
        """The refusal code for THIS grant having expired.

        Every relay site that REPORTS an expiry after admission (the sweep and
        ``_authorize``) goes through here, so a create that times out unanswered
        is not reported to its waiter as an expired ATTACH grant.
        """
        return (
            CODE_CREATE_GRANT_EXPIRED
            if self.kind == KIND_CREATE
            else CODE_GRANT_EXPIRED
        )

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

# How long an unanswered ``terminal_buffer`` RPC stays correlatable, and how
# many may be outstanding on one socket at once.
#
# ``pending_attach`` and ``pending_create`` are self-limiting — one entry per
# grant, and a grant is claimed once — but ``pending_buffer`` is not: every
# ``remote_terminal_buffer`` frame mints a fresh id and inserts, and an entry
# leaves only on a matching reply or on ``_drop_attachment``. So a target that
# simply DROPS ``terminal_buffer`` frames (answering nothing, refusing nothing)
# grew the dict for the grant's whole life, renewed on every reattach —
# unbounded memory in a shared backend replica, driven by one authenticated
# device (review round 4, item 5).
#
# Two bounds rather than one, because they answer different failures:
#
# * the TTL is what SELF-HEALS. A reply that has not come in this long is not
#   coming; dropping the correlation costs the source one timed-out history
#   request and nothing else.
# * the cap is the hard ceiling, enforced after the TTL sweep, and it REFUSES
#   the new frame rather than evicting an old one. Eviction would be worse than
#   the leak: the target marks a solicited ``terminal_buffer_response`` with
#   ``grant_jti``/``remote`` (``backend_relay::handle_terminal_buffer``), so a
#   reply whose correlation had been evicted falls into
#   ``_route_buffer_response``'s UNSOLICITED arm and is forwarded with no
#   request id — which makes the source splice stale scrollback into a live
#   pane instead of resolving a waiter.
PENDING_BUFFER_TTL_SECONDS = 60.0
PENDING_BUFFER_MAX = 32


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
    # ``pending_buffer`` only: the ``time.monotonic()`` deadline each entry
    # stops being correlatable at. Kept beside the dict rather than inside
    # ``_Pending`` because ``_pop_correlated`` is generic over all three
    # pendings and the other two need no clock. ``sweep_pending_buffer`` is the
    # single place both are mutated together, and it treats a MISSING deadline
    # as already expired — so a desync fails closed (drop the correlation)
    # rather than open (keep it forever, the leak being fixed).
    pending_buffer_deadline: dict[str, float] = field(default_factory=dict)
    listeners: dict[str, tuple[Any, asyncio.Task[None]]] = field(default_factory=dict)
    # Targets whose ``terminal_subscribe`` this socket actually PUBLISHED, so
    # the matching ``terminal_unsubscribe`` is sent for exactly those. The
    # subscribe is locally gated and the unsubscribe is not (see
    # ``_unsubscribe_runner``), so without this record an attach refused for
    # a non-local target would decrement a count it never incremented —
    # switching off a peer subscriber's output on the replica that holds the
    # socket.
    subscribed: set[str] = field(default_factory=set)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def sweep_pending_buffer(self, now: float) -> list[str]:
        """Drop scrollback RPCs the target never answered. Returns their ids."""
        dropped = [
            rid
            for rid in list(self.pending_buffer)
            if now >= self.pending_buffer_deadline.get(rid, 0.0)
        ]
        for rid in dropped:
            self.pending_buffer.pop(rid, None)
            self.pending_buffer_deadline.pop(rid, None)
        # A deadline whose entry was popped elsewhere (a reply, or
        # ``_drop_attachment``) is a leftover; this is the only reader, so it
        # is also the only place that can shed them.
        for rid in list(self.pending_buffer_deadline):
            if rid not in self.pending_buffer:
                self.pending_buffer_deadline.pop(rid, None)
        return dropped

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

        Returns False when this socket holds nothing on that target — the
        frame is a device-wide notice every watcher sees, and one that settles
        none of our attachments is not ours.
        """
        doomed = [
            att
            for att in session.grants.values()
            if att.target_device_id == target_device_id
        ]
        if not doomed:
            return False
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

    async def _route_target_error(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        wire_request_id = frame.get("request_id")
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
