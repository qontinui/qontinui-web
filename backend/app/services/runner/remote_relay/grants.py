"""Grant authorization for the remote-terminal relay.

``GrantAuthorizer`` holds the three checks every grant-bearing source frame goes
through: ``_verify_grant`` (the coord JWKS verifier, the declared ``sub_type``,
the source device, expiry and ``jti``), ``_attach_target`` (the ``attach``
claims of a verified attach grant) and ``_authorize`` (admission of a
post-attach frame for a grant registered on this socket).

``coord_jwks_client`` is imported as the OBJECT, so a test's
``patch.object(coord_jwks_client, "verify_token", ...)`` reaches the call here
whichever module it reached the object through.
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID

import structlog

from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenExpiredError,
    CoordTokenInvalidError,
    coord_jwks_client,
    jwks_failure_log_fields,
)
from app.services.runner.remote_relay.core import RelayCore
from app.services.runner.remote_relay.protocol import (
    CODE_END_PENDING,
    CODE_GRANT_INVALID,
    CODE_GRANT_WRONG_KIND,
    CODE_NOT_REGISTERED,
    CODE_VERIFIER_UNAVAILABLE,
    KIND_ATTACH,
)
from app.services.runner.remote_relay.state import _Attachment, _SourceSession

logger = structlog.get_logger(__name__)


class GrantAuthorizer:
    """Verify and admit grants. Refusals go back through the core (plan D2)."""

    def __init__(self, core: RelayCore) -> None:
        self.core = core

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
            await self.core._refuse(
                session, code_invalid, "grant missing", request_id=request_id
            )
            return None

        try:
            claims = await coord_jwks_client.verify_token(grant)
        except CoordTokenExpiredError as exc:
            await self.core._refuse(
                session, code_expired, str(exc), request_id=request_id
            )
            return None
        except CoordTokenInvalidError as exc:
            await self.core._refuse(
                session, code_invalid, str(exc), request_id=request_id
            )
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
            await self.core._refuse(
                session,
                CODE_VERIFIER_UNAVAILABLE,
                "grant verifier temporarily unavailable",
                request_id=request_id,
            )
            return None

        if claims.get("sub_type") != sub_type:
            await self.core._refuse(
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
            await self.core._refuse(
                session,
                code_invalid,
                "grant device_id malformed",
                request_id=request_id,
            )
            return None
        if grant_source != socket_source:
            await self.core._refuse(
                session,
                code_wrong_source,
                "grant was minted for a different source device",
                request_id=request_id,
            )
            return None

        exp = claims.get("exp")
        if not isinstance(exp, int | float) or exp <= time.time():
            await self.core._refuse(
                session, code_expired, "grant expired", request_id=request_id
            )
            return None

        jti = claims.get("jti")
        if not isinstance(jti, str) or not jti:
            await self.core._refuse(
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
            await self.core._refuse(
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
            await self.core._refuse(
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
            await self.core._refuse(
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
            await self.core._refuse(
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
                await self.core._send_to_source(
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
            await self.core._detach_target(session, att, att.terminal_id)
            await self.core._drop_attachment(session, att)
            await self.core._refuse(
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
            await self.core._refuse(
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
            await self.core._refuse(
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
