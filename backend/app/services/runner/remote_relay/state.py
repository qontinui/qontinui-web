"""Per-socket state of the remote-terminal relay.

``_SourceSession`` is everything one SOURCE socket holds; ``_Attachment`` is one
grant on it; ``_PendingEnd`` is one in-flight ``terminal_end``. All mutable relay
state lives on these objects, which the relay passes to every method, so no part
of the relay keeps per-session state of its own.

``PENDING_END_TTL_SECONDS`` is NOT here: it is read at call time by the end
timer in ``remote_relay.end``, so that is where it is defined (and patched).
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from app.services.runner.remote_relay.protocol import (
    CODE_CREATE_GRANT_EXPIRED,
    CODE_GRANT_EXPIRED,
    KIND_ATTACH,
    KIND_CREATE,
)


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
    # Set once the first ``terminal_input_ack`` naming another terminal under
    # this grant has been logged at warning; the rest go to debug. An ack is
    # per keystroke, so a target stuck on the defect would otherwise emit one
    # warning per key.
    ack_mismatch_warned: bool = False
    # Armed at most once, and never reset: the second ``attach_grant_unknown``
    # for this grant takes the unchanged fatal path. This is what makes the
    # re-present one-shot rather than a retry loop.
    represented: bool = False
    # True for an attach grant presented ONLY to end its session (the fresh-
    # grant path of ``_handle_end``). It never binds a terminal and admits no
    # post-attach frame; it exists to hold the claim and the return route for
    # one ``terminal_end`` round trip, and is ALWAYS dropped when that round
    # trip settles — reply, refusal or TTL — so the Redis claim is never held
    # until the grant expires.
    end_only: bool = False

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

    def session_remote_block(self) -> dict[str, Any]:
        """The ``remote`` block of a SESSION-addressed frame (attach, end).

        :meth:`remote_block` plus the grant's ``session_id`` and, when the
        grant names one, its ``terminal_id`` hint. One builder, so
        ``terminal_end`` carries exactly what ``terminal_attach`` carries.
        """
        block: dict[str, Any] = {
            **self.remote_block(),
            "session_id": self.target_session_id,
        }
        if self.requested_terminal_id is not None:
            block["terminal_id"] = self.requested_terminal_id
        return block


# ``pending_*`` entries: the MINTED request_id on the wire to the target maps
# back to (the source's own request_id, grant_jti).
_Pending = tuple[str | None, str]


@dataclass(frozen=True)
class _PendingEnd:
    """One in-flight ``terminal_end``, snapshotted at forward time.

    A SNAPSHOT rather than a ``_Pending`` pointing at ``session.grants``,
    because an end's settlement must not depend on its attachment surviving
    the round trip. The ordinary success of an open-tab end is the PTY
    closing, and the target's ``terminal_exit`` (which retires the tab and
    drops its attachment) usually arrives BEFORE its ``terminal_ended`` —
    an entry keyed to the live attachment would be swept with it and the
    source left in silence. So the reply and the TTL answer from this record
    alone, and only an ``end_only`` (fresh-grant) attachment's drop sweeps it.
    """

    source_request_id: str | None
    grant_jti: str
    target_device_id: str
    target_session_id: str | None
    # The bound terminal for an open tab; ``None`` for a fresh grant.
    terminal_id: str | None
    end_only: bool


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
    # ``terminal_end`` RPCs, keyed by the MINTED wire id like the other three
    # but holding a snapshot (``_PendingEnd``), so an entry outlives the
    # attachment it was forwarded under. Bounded by one entry per grant
    # (``CODE_END_PENDING``) and expired by a per-entry timer
    # (``_expire_pending_end``), not by a sweep.
    pending_end: dict[str, _PendingEnd] = field(default_factory=dict)
    # The TTL task of each ``pending_end`` entry, cancelled when the entry is
    # settled (reply, refusal, drop) so no timer outlives its correlation.
    pending_end_timers: dict[str, asyncio.Task[None]] = field(default_factory=dict)
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
