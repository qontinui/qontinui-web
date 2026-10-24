"""The TARGET → SOURCE return route of the remote-terminal relay.

``TargetFrameRouter`` takes every frame a target publishes on the channels the
source socket's listener is subscribed to, decides whether it belongs to this
socket, and translates the ones that do into the ``remote_terminal_*`` frame
the source reads: correlation of the ids the relay MINTED
(``_pop_correlated``), the terminal-bound streaming frames, the end and
input-ack replies, the device-wide ``runner_disconnected`` notice, target
refusals (rebuilt and namespaced, never forwarded), and the one-shot attach
re-present. Plan ``2026-10-04-web-remote-terminal-relay-is-one-class-of-four-protocols``,
Phase 4; the routing itself is described in the module docstring of
``app.services.runner.remote_terminal_relay``.

``ATTACH_REPRESENT_DELAY_SECONDS`` is defined HERE, beside the re-present that
reads it at call time: to shorten it in a test, patch this module, not the
relay facade.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any
from uuid import uuid4

import structlog
from qontinui_schemas.common import utc_now

from app.services.runner.remote_relay.core import RelayCore
from app.services.runner.remote_relay.end import EndCoordinator
from app.services.runner.remote_relay.protocol import (
    _HIGH_VOLUME_TARGET_FRAMES,
    CODE_REGISTRY_UNAVAILABLE,
    CODE_TARGET_NOT_CONNECTED,
    CODE_TERMINAL_BUSY,
    END_OUTCOME_FALLBACK,
    END_OUTCOMES,
    INPUT_ACK_RELAY_OWNED_KEYS,
    KIND_ATTACH,
    SOURCE_END_REPLY_FRAME_TYPE,
    SOURCE_INPUT_ACK_FRAME_TYPE,
    TARGET_CODE_ATTACH_GRANT_UNKNOWN,
    TARGET_CODE_MAX,
    TARGET_END_REPLY_FRAME_TYPE,
    TARGET_INPUT_ACK_FRAME_TYPE,
    TARGET_MESSAGE_MAX,
    TARGET_REFUSAL_FRAME_TYPES,
    _is_remote_marked,
    _is_uuid,
    namespace_target_code,
)
from app.services.runner.remote_relay.registry import RelayRegistry
from app.services.runner.remote_relay.state import (
    _Attachment,
    _Pending,
    _PendingEnd,
    _SourceSession,
)

logger = structlog.get_logger(__name__)

# One entry of the dispatch table: answers whether the frame was ours.
_TargetFrameHandler = Callable[
    [_SourceSession, str, dict[str, Any]], Coroutine[Any, Any, bool]
]

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


class TargetFrameRouter:
    """The return route: correlate, dispatch, re-present, rebuild (plan D2)."""

    def __init__(
        self, core: RelayCore, end: EndCoordinator, registry: RelayRegistry
    ) -> None:
        self.core = core
        self.end = end
        self.registry = registry
        # Frame type -> handler, one flat table. Every handler answers whether
        # the frame was this socket's (False: not ours).
        self._target_frame_handlers: dict[str, _TargetFrameHandler] = {
            # Membership, not equality: a target refusal typed
            # ``remote_terminal_error`` takes the SAME path as one typed
            # ``error`` and gets no shortcut for wearing the relay's outbound
            # type. ``_route_target_error`` rebuilds the payload and puts
            # ``code`` through ``namespace_target_code``, so the namespacing a
            # target must not escape is applied identically either way. See
            # ``TARGET_REFUSAL_FRAME_TYPES``. Listed first, so a named entry
            # below would win a clash, as the ``if`` chain this replaced did;
            # there is none by construction.
            **dict.fromkeys(TARGET_REFUSAL_FRAME_TYPES, self._route_target_error),
            "terminal_attached": self._route_attached,
            "terminal_created": self._route_created,
            "terminal_output": self._route_output,
            "terminal_exit": self._route_exit,
            "terminal_buffer_response": self._route_buffer_response,
            TARGET_END_REPLY_FRAME_TYPE: self._route_end_reply,
            TARGET_INPUT_ACK_FRAME_TYPE: self._route_input_ack,
            # A RELAY-authored notice, not a target refusal, which is why it
            # sits OUTSIDE ``TARGET_REFUSAL_FRAME_TYPES``:
            # ``RunnerWebSocketManager.unregister`` publishes it device-wide,
            # so its payload is never target-supplied and there is nothing to
            # namespace. It settles attachments rather than translating a
            # frame.
            "runner_disconnected": self._route_runner_disconnected,
        }

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
            await self.core._drop_attachment(session, att)
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
        """The type dispatch behind :meth:`route_target_frame`.

        The expiry sweep runs FIRST, before any handler: every handler may then
        assume an attachment it finds is live (``_route_input_ack`` relies on
        it). A type with no handler is not ours.
        """
        await self.core._reap_expired(session)
        # Target-supplied and looked up as it came, exactly as the ``if`` chain
        # this table replaced compared it: a type with no entry (a non-string
        # one included) is not ours. ``Any``, not ``str``, for that reason.
        frame_type: Any = frame.get("type")
        handler = self._target_frame_handlers.get(frame_type)
        if handler is None:
            return False
        return await handler(session, target_device_id, frame)

    async def _route_attached(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """Bind the terminal a target ``terminal_attached`` names; answer the source."""
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
            await self.core._send_to_source(
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
            bound = await self.registry._bind_terminal(att, terminal_id)
        except Exception as exc:  # noqa: BLE001 - registry failure is a typed refusal
            logger.error(
                "remote_terminal_registry_unavailable",
                source_device_id=session.device_id,
                grant_jti=att.grant_jti,
                error=str(exc),
                error_type=type(exc).__name__,
            )
            await self.core._detach_target(session, att, terminal_id)
            await self.core._drop_attachment(session, att)
            await self.core._refuse(
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
            await self.core._detach_target(session, att, terminal_id)
            await self.core._drop_attachment(session, att)
            await self.core._refuse(
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
        await self.core._send_to_source(
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

    async def _route_created(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """Forward a target ``terminal_created`` as ``remote_terminal_created``; spend the grant."""
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
        await self.core._send_to_source(
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
        await self.core._drop_attachment(session, att)
        return True

    async def _route_output(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """Forward ``terminal_output`` for a bound terminal as ``remote_terminal_output``."""
        att = await self._bound_attachment(
            session, target_device_id, frame.get("terminal_id")
        )
        if att is None:
            return False
        await self.core._send_to_source(
            session,
            {
                "type": "remote_terminal_output",
                "grant_jti": att.grant_jti,
                "terminal_id": att.terminal_id,
                "data": frame.get("data"),
            },
        )
        return True

    async def _route_exit(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
    ) -> bool:
        """Forward ``terminal_exit`` for a bound terminal, then drop its attachment."""
        att = await self._bound_attachment(
            session, target_device_id, frame.get("terminal_id")
        )
        if att is None:
            return False
        await self.core._send_to_source(
            session,
            {
                "type": "remote_terminal_exit",
                "grant_jti": att.grant_jti,
                "terminal_id": att.terminal_id,
                "exit_code": frame.get("exit_code"),
            },
        )
        await self.core._drop_attachment(session, att)
        return True

    async def _route_runner_disconnected(
        self, session: _SourceSession, target_device_id: str, frame: dict[str, Any]
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

        ``frame`` is not read: the notice carries nothing but its type. The
        parameter is the dispatch table's one handler shape.
        """
        ends = await self.end._settle_pending_ends_on_target(
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
            await self.core._evict(
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
        entry = self.end._pop_pending_end(
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
        await self.end._answer_end_and_release(session, entry, payload)
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
        await self.core._send_to_source(session, payload)
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
        await self.core._send_to_source(session, payload)
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
        self.core.spawn_background(self._represent_attach(session, att))

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
            await self.core._evict(
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
            await self.core._evict(
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
        await self.end._answer_end_and_release(
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
        end_entry = self.end._pop_pending_end(
            session, wire_request_id, target_device_id
        )
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
                            self.end._cancel_end_timer(session, rid)
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
        await self.core._send_to_source(
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
            await self.core._drop_attachment(session, att)
        return True
