"""The ``remote_terminal_end`` protocol of the remote-terminal relay.

``EndCoordinator`` forwards a source's end request as ``terminal_end`` and owns
everything that settles it: the open-tab and fresh-grant paths, the per-end TTL
timer, and the three relay-side settlements (reply, refusal, TTL — plus the
two "no reply can come" cases a target disconnect or a lost listener force).
Plan ``2026-09-30-close-remote-sessions-from-the-local-runner``, Phase 2; the
protocol itself is described in the module docstring of
``app.services.runner.remote_terminal_relay``.

``PENDING_END_TTL_SECONDS`` is defined HERE, beside the timer that reads it at
call time: to shorten it in a test, patch this module, not the relay facade.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import uuid4

import structlog
from qontinui_schemas.common import utc_now

from app.services.runner.remote_relay.core import RelayCore
from app.services.runner.remote_relay.grants import GrantAuthorizer
from app.services.runner.remote_relay.protocol import (
    ATTACH_GRANT_SUB_TYPE,
    CODE_END_PENDING,
    CODE_END_TIMEOUT,
    CODE_GRANT_CONSUMED,
    CODE_GRANT_EXPIRED,
    CODE_GRANT_INVALID,
    CODE_GRANT_WRONG_SOURCE,
    CODE_REGISTRY_UNAVAILABLE,
    CODE_TARGET_NOT_CONNECTED,
)
from app.services.runner.remote_relay.registry import RelayRegistry
from app.services.runner.remote_relay.state import (
    _Attachment,
    _PendingEnd,
    _SourceSession,
)

logger = structlog.get_logger(__name__)

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


class EndCoordinator:
    """The end protocol: forward, time out, settle, release (plan D2)."""

    def __init__(
        self, core: RelayCore, grants: GrantAuthorizer, registry: RelayRegistry
    ) -> None:
        self.core = core
        self.grants = grants
        self.registry = registry

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
            await self.core._refuse(
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
        att = await self.grants._authorize(session, authorize_msg)
        if att is None:
            return
        await self._forward_end(session, msg, att, terminal_id=att.terminal_id)

    async def _end_with_fresh_grant(
        self, session: _SourceSession, msg: dict[str, Any]
    ) -> None:
        """The fresh-grant path: verify → claim → listen → forward → always drop."""
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
        held = session.grants.get(jti)
        if held is not None and held.end_only:
            # This very token is already ending its session on this socket.
            await self.core._refuse(
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

        target = await self.grants._attach_target(session, claims, request_id)
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
            claimed = await self.registry._claim_grant(att)
            if claimed:
                await self.registry._write_grant_record(att)
                session.grants[jti] = att
                await self.core._ensure_listener(session, target_device_id)
        except Exception as exc:  # noqa: BLE001 - registry failure is a typed refusal
            logger.error(
                "remote_terminal_registry_unavailable",
                source_device_id=session.device_id,
                grant_jti=jti,
                error=str(exc),
                error_type=type(exc).__name__,
            )
            if claimed:
                await self.core._drop_attachment(session, att)
            await self.core._refuse(
                session,
                CODE_REGISTRY_UNAVAILABLE,
                "attachment registry temporarily unavailable",
                request_id=request_id,
                grant_jti=jti,
            )
            return
        if not claimed:
            await self.core._refuse(
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
            await self.core._drop_attachment(session, att)

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
            await self.core._refuse(
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
            await self.core._refuse(
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
            session.pending_end_timers[minted] = self.core.spawn_background(
                self._expire_pending_end(session, minted)
            )
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
            await self.core._send_to_source(session, payload)
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
                await self.core._drop_attachment(session, att)
                return
        await self.core._maybe_stop_listener(session, entry.target_device_id)
