"""Wire vocabulary of the remote-terminal relay: frame types, refusal codes, predicates.

Pure: no I/O, no state, and no import from ``app`` (only the standard library,
``qontinui_schemas`` and third-party packages). The import boundary is pinned by
``tests/test_remote_terminal_relay_await_shape.py``. The protocol itself is
described in the module docstring of ``app.services.runner.remote_terminal_relay``,
which re-exports these names for reading. Patch them HERE, never through the
re-export: a patch on the facade does not reach code that reads this module.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

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
        # END a remote session (plan
        # `2026-09-30-close-remote-sessions-from-the-local-runner`, Phase 2).
        # Forwarded as `terminal_end` under an ATTACH grant — the open tab's,
        # or a fresh one presented for this frame alone. See `_handle_end`.
        "remote_terminal_end",
    }
)

# The TARGET's reply to a ``terminal_end`` and the SOURCE-side frame the relay
# rebuilds it into. ``outcome`` is a closed set on the wire contract; anything
# else a target sends is reported as ``unknown`` — never as ``ended``.
TARGET_END_REPLY_FRAME_TYPE = "terminal_ended"
SOURCE_END_REPLY_FRAME_TYPE = "remote_terminal_ended"
END_OUTCOMES: frozenset[str] = frozenset(
    {"ended", "refused", "still_running", "unknown", "not_found"}
)
END_OUTCOME_FALLBACK = "unknown"

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
# A ``remote_terminal_end`` the target did not answer within
# ``PENDING_END_TTL_SECONDS``. Typed rather than silent: the source's own
# timeout is longer, so this is how it learns the relay gave up first. The
# source must read it as an UNKNOWN outcome, never as ``ended``.
CODE_END_TIMEOUT = "end_reply_timeout"
# A second ``remote_terminal_end`` for a grant whose first one is still
# unanswered. One end in flight per grant is what bounds ``pending_end``.
CODE_END_PENDING = "end_already_pending"

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
# ``attach_grant_expired`` is in BOTH vocabularies, and it and
# ``attach_grant_unknown`` (the target's own "that grant is gone"; the relay
# never mints it) stay pass-through. State the trade honestly, because two
# earlier drafts of this comment contradicted each other on it (review round 4,
# item 4):
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
        # The remote-block checks (attach, detach, flow — and end once
        # qontinui-runner#1883 lands): a frame with no
        # ``remote`` block. The relay always sends one, so this is a target
        # disagreeing with the relay about the frame, not a relay verdict.
        "remote_block_required",
        # backend_relay's refusal of a ``terminal_flow`` with no boolean
        # ``paused``.
        "flow_paused_required",
        # backend_relay's ``terminal_create`` replies: the spawned PTY exited
        # before coord confirmed it, or coord never confirmed the registration.
        "terminal_exited",
        "coord_registration_unconfirmed",
        # ``handle_terminal_create``'s coord device-drain deferral
        # (``coord_drain_state::DeferClass::code``): the target is drained, or
        # cannot read its drain state. Refused before any grant is spent.
        "device_drained",
        "drain_unreadable",
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
#   ``test_relay_error_codes_covers_every_inline_code_literal`` scans the
#   relay module's source (``remote_terminal_relay``, where the literals are
#   minted) for ``"code": "<literal>"`` and fails on any that is not here. The
#   two must agree. That test also reads the ``CODE_*`` constants through the
#   relay facade, so a new constant here is re-exported there as well.
#
# ``TARGET_ERROR_CODES`` and this set deliberately intersect on exactly
# ``attach_grant_expired``: the source's handling is identical either way, so
# it stays pass-through. Every OTHER relay code
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
#
# ``terminal_input_ack`` is the firehose's twin in the other direction: one
# per keystroke frame the source sends, so it is logged at debug too.
_HIGH_VOLUME_TARGET_FRAMES = frozenset({"terminal_output", "terminal_input_ack"})

# ---------------------------------------------------------------------------
# Input acknowledgement (plan
# ``2026-09-20-remote-session-interactivity-is-a-query-and-both-halves-hold``,
# Phase A1).
# ---------------------------------------------------------------------------
# The target answers every ``terminal_input`` that carried a ``remote`` block,
# once the grant gate passed, with a ``terminal_input_ack`` — accepted or not.
# The relay publishes it (``is_remote_only_target_frame``), retypes it and
# hands it to the source that holds the grant. Until that frame existed the
# write half of a remote session was blind: an accepted keystroke, a dropped
# one and an undecodable one all looked identical to the source.
TARGET_INPUT_ACK_FRAME_TYPE = "terminal_input_ack"
SOURCE_INPUT_ACK_FRAME_TYPE = "remote_terminal_input_ack"

# Keys of a source ``remote_terminal_input`` the relay OWNS on the forward.
# Everything else is copied to the target verbatim — ``data``, ``seq``,
# ``probe`` and whatever a newer source adds — because rebuilding the forward
# frame from a known field set is how fields die in transit: the 08-31 attach
# work lost ``have_offset`` and three more fields that way (web#1301), and an
# input forward that dropped ``probe`` would turn every liveness probe into a
# real zero-byte keystroke on the target.
#
# Why each key is the relay's:
# - ``type`` — the outbound type is ``terminal_input``, the relay's literal.
# - ``remote`` — the relay's authority block, rebuilt from the attachment;
#   a source must never be able to name its own grant to the target.
# - ``grant_jti`` — routing identity; it travels inside ``remote``.
# - ``terminal_id`` — the terminal the TARGET bound, from the attachment.
# - ``request_id`` — never forwarded on input (the relay mints its own ids for
#   the RPCs that need one). Forwarding it would ALSO misroute the target's
#   refusal of this keystroke: an ``error`` carrying a ``request_id`` is the
#   mobile watcher's shape and is not published on the remote-only channel.
# - ``timestamp`` — stamped by the relay at forward time.
INPUT_FORWARD_RELAY_OWNED_KEYS: frozenset[str] = frozenset(
    {"type", "remote", "grant_jti", "terminal_id", "request_id", "timestamp"}
)

# Keys of a target ``terminal_input_ack`` the relay OWNS on the return. The
# rest of the frame — ``seq``, ``bytes``, ``accepted``, ``error``, ``via``,
# ``accepted_at`` and any field a newer target adds — reaches the source
# verbatim. ``grant_jti`` and ``terminal_id`` are set FROM THE ATTACHMENT
# RECORD (the rule every return frame follows), and the ``remote`` block is
# stripped: it is the relay's own routing block, and no other return frame
# hands it to the source.
#
# ``request_id`` and ``code`` are stripped too, because on the source's wire
# they are the relay's voice: a ``request_id`` resolves a waiting RPC (an ack
# answers none), and ``code`` is the field a relay refusal speaks through —
# the one ``namespace_target_code`` exists to keep a target out of. An ack
# states its outcome through ``accepted`` / ``error`` instead.
INPUT_ACK_RELAY_OWNED_KEYS: frozenset[str] = frozenset(
    {"type", "remote", "grant_jti", "terminal_id", "request_id", "code"}
)


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
    if msg_type == TARGET_END_REPLY_FRAME_TYPE:
        # New with remote END (plan
        # `2026-09-30-close-remote-sessions-from-the-local-runner`); no mobile
        # arm consumes it. Without this arm it would die at
        # ``devices_ws_unhandled_message`` and every end would time out.
        return True
    if msg_type == TARGET_INPUT_ACK_FRAME_TYPE:
        # New with the input-ack wire (Phase A1); no mobile arm consumes it,
        # so it is admitted unconditionally like ``terminal_attached``. One
        # that names no grant this socket holds is answered ``False`` by
        # ``route_target_frame`` and goes nowhere.
        return True
    if msg_type not in TARGET_REFUSAL_FRAME_TYPES:
        return False
    if msg_type == "error":
        return msg.get("request_id") is None and _is_remote_marked(msg)
    return True
