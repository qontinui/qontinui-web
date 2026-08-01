"""Propagate a web user's ``is_active`` transition to coord.

Plan: ``2026-07-24-web-deactivation-must-revoke-coord-membership``, Phase 3
(the qontinui-web half).

## Why this module exists

Since web#845 landed, ``operations.get_tenant_id`` no longer takes a
``current_user`` param, so the 118 coord-proxy routes that depend on it no
longer consult web's local ``auth.users.is_active`` flag at all — **coord
tenant membership is the sole authority there**. Deactivating a user in web's
DB therefore did NOT revoke their access to those routes: a
deactivated-but-still-valid Cognito principal kept full access.

This module closes that gap. Every writer that flips ``is_active`` routes the
write through :func:`apply_activation_transition`, which runs the coord call
and the local persist in the order that keeps the safe invariant below.

## The invariant: web is never MORE permissive than coord

There is no distributed transaction here, so the ordering is chosen so that
the only reachable divergence is the harmless one — coord stricter than web:

* **Deactivation** calls coord FIRST, then persists. A coord failure leaves
  web untouched (nobody was deactivated, and the caller is told). A local
  failure after a successful coord disable leaves the principal disabled in
  coord but active in web — coord-stricter, so no access is retained.
* **Reactivation** persists FIRST, then calls coord. The reverse order would
  hand back all 118 coord-proxy routes and then fail the local write, leaving
  someone coord-enabled while web still believes they are deactivated —
  exactly the hole this plan exists to close. This way a coord failure leaves
  them active in web but still disabled in coord.

Either way the caller sees an error; nothing fails silently.

## Loud failure is the point

A deactivation that silently leaves coord access live is the exact hole being
closed, so nothing here is best-effort:

* No caller bearer (or no request at all) → :class:`CoordActivationSyncError`
  (401). Coord authorizes the disable on the ACTING superuser's identity;
  without it we cannot even attempt the call, so we refuse the flip.
* Target user cannot be mapped to a coord operator → 502
  ``coord_operator_not_found`` / 409 ``coord_operator_ambiguous``. We never
  "skip the coord call because we couldn't find them".
* Coord answers 4xx/5xx (403 not-a-coord-admin, 404 no-such-operator, 503
  ``column_not_present`` in the pre-migration window) → surfaced. 401/403 pass
  through verbatim because they are actionable auth answers about the CALLER;
  everything else becomes a 502 carrying coord's original code as
  ``coord_status``, so an upstream 404 is never confused with this route's own
  "user not found" and an upstream 500 never reads as "web crashed".
* Coord unreachable / times out → 502.

## Identifier mapping (web ``User`` → coord ``operator_id``)

Coord's write surface is ``POST /coord/operators/{operator_id}/{disable,enable}``
and its Axum handler binds ``Path<Uuid>`` — it takes coord's own
``coord.operators.operator_id`` UUID, NOT a Cognito subject. Web holds no such
column, so the id is resolved per call from coord's own operator directory
(``GET /admin/coord/operators``, tenant-scoped + admin-gated coord-side).

**The match key is the Cognito subject, and ONLY the Cognito subject.**
``coord.operators`` is UNIQUE on ``(sso_provider, sso_subject)`` and
``sso_subject`` IS the Cognito ``sub`` that web stores in ``User.cognito_sub``,
so this is exact by construction. Email is deliberately NOT used as a fallback
key: ``UserUpdate.email`` is settable by the user themselves (fastapi-users'
``create_update_dict()`` excludes ``is_active``/``is_superuser``/
``is_verified`` but not ``email``), coord's ``coord.operators.email`` is not
unique, and coord's disable is operator-global. An email-keyed match would
therefore let a user steer a privileged cross-principal disable at a victim by
renaming themselves. Unresolvable → loud failure, never a guess.

**Cross-repo contract:** coord's ``GET /admin/coord/operators`` returns
``sso_subject`` and accepts an optional ``?sso_subject=<sub>`` exact-match
filter (``routes_phase3.rs::get_operators_list``, coord PR #1293). We send the
filter, so coord returns at most one row instead of every operator in the
tenant. The filter is ANDed with coord's pre-existing tenant scope, never
replacing it, so it cannot widen what the acting admin may see.

Both halves of that contract are load-bearing and are re-checked here: the
filter narrows, and :func:`_match_operator` still verifies the subject on
whatever comes back. Until coord #1293 deploys, every transition fails loudly
with ``coord_operator_not_found`` rather than disabling the wrong principal.

## Import surface

Bearer forwarding reuses ``app.api.coord_proxy`` — the single shared import
point for the proxy plumbing whose implementations deliberately stay in
``app.api.v1.endpoints.operations`` (see that module's docstring: the proxy
test suite patches ``operations.httpx.AsyncClient``, so moving the bodies
would silently defeat those patches). This module grows no third private copy.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from fastapi import HTTPException, Request

from app.api.coord_proxy import (
    ACTIVE_TENANT_HEADER,
    _caller_active_tenant,
    _caller_bearer,
    _extract_caller_token,
    _proxy_coord_get,
    _proxy_coord_post,
)
from app.models.user import User

logger = structlog.get_logger(__name__)

# Coord's tenant-scoped operator directory. Admin-gated coord-side, so a
# non-admin acting superuser gets a 403 here rather than at the write.
#
# Always called with the ``sso_subject`` filter, so the response holds at most
# one row and this resolution does not depend on coord serving the list
# unpaginated — the coupling an earlier revision had to warn about.
_OPERATORS_LIST_PATH = "/admin/coord/operators"

# Coord status codes that answer something actionable about the CALLER and so
# pass through to the browser verbatim. Everything else becomes a 502 with
# coord's code preserved in the payload.
_PASSTHROUGH_STATUSES = frozenset({401, 403})

_BEARER_MISSING_MESSAGE = (
    "no caller bearer to authorize the coord operator disable/enable with; "
    "the activation change was NOT applied"
)


class CoordActivationSyncError(HTTPException):
    """A deactivation/reactivation could not be propagated to coord.

    The detail always names the failed operation, so it is never mistaken for
    a failure of the web-local update itself, and carries coord's own status
    code as ``coord_status`` when there was one.
    """

    def __init__(
        self,
        status_code: int,
        error: str,
        message: str,
        coord_status: int | None = None,
    ) -> None:
        detail: dict[str, Any] = {
            "error": error,
            "message": message,
            "operation": "coord_operator_activation_sync",
        }
        if coord_status is not None:
            detail["coord_status"] = coord_status
        super().__init__(status_code=status_code, detail=detail)
        self.error = error


def _capture_caller_context(request: Request) -> None:
    """Capture the acting caller's bearer for ``_tenant_headers`` to forward.

    The two deactivation writers are gated by ``get_current_superuser_async`` /
    fastapi-users' superuser dependency — NOT by ``get_tenant_id``, which is
    what normally populates these ContextVars. So we populate them here from
    the same two sources (``access_token`` cookie, then ``Authorization``
    header) the rest of the stack reads.
    """
    token = _extract_caller_token(request)
    if not token:
        raise CoordActivationSyncError(
            401, "coord_bearer_missing", _BEARER_MISSING_MESSAGE
        )
    _caller_bearer.set(token)
    _caller_active_tenant.set(request.headers.get(ACTIVE_TENANT_HEADER))


def _coord_failure(exc: HTTPException, error: str) -> CoordActivationSyncError:
    """Re-raise a shared-proxy ``HTTPException`` as a named sync failure."""
    status_code = exc.status_code if exc.status_code in _PASSTHROUGH_STATUSES else 502
    return CoordActivationSyncError(
        status_code,
        error,
        f"coord refused or could not complete the request ({exc.detail!r}); "
        "the activation change was NOT applied",
        coord_status=exc.status_code,
    )


def _require_subject(user: User) -> str:
    """The user's Cognito subject, or a loud failure.

    Resolved before the coord call because it is BOTH the server-side filter
    value and the client-side match key.
    """
    subject = (user.cognito_sub or "").strip()
    if not subject:
        raise CoordActivationSyncError(
            502,
            "coord_operator_subject_missing",
            "this user has no Cognito subject, so they cannot be matched to a "
            "coord operator; the activation change was NOT applied",
        )
    return subject


def _match_operator(operators: list[Any], subject: str) -> str:
    """Pick the one coord operator whose subject IS ``subject``, or raise loudly.

    Matches on the Cognito subject only — see the module docstring for why
    email is not an acceptable fallback key here.

    This runs even though the request already asked coord to filter by the
    same subject. The filter is a narrowing optimization, NOT a trust
    boundary: re-checking locally means a coord that ignored, mis-parsed, or
    silently widened the parameter cannot cause the wrong principal to be
    disabled. The cost is one list comprehension over a response that is now
    expected to hold at most one row.
    """
    matches = [
        o
        for o in operators
        if isinstance(o, dict) and str(o.get("sso_subject") or "").strip() == subject
    ]
    if len(matches) > 1:
        # Coord's UNIQUE (sso_provider, sso_subject) makes this impossible
        # within one provider; >1 means several providers share the subject,
        # which must not be disambiguated by guessing.
        raise CoordActivationSyncError(
            409,
            "coord_operator_ambiguous",
            f"{len(matches)} coord operators share this Cognito subject; "
            "refusing to guess — the activation change was NOT applied",
        )
    if not matches:
        raise CoordActivationSyncError(
            502,
            "coord_operator_not_found",
            "no coord operator matches this user's Cognito subject in the "
            "acting admin's tenant (note: coord's operator list must expose "
            "`sso_subject` for this match to resolve); the activation change "
            "was NOT applied",
        )

    operator_id = str(matches[0].get("operator_id") or "")
    if not operator_id:
        raise CoordActivationSyncError(
            502,
            "coord_operator_id_missing",
            "the matched coord operator carries no operator_id; the "
            "activation change was NOT applied",
        )
    return operator_id


async def _resolve_operator_id(user: User) -> str:
    """Resolve ``user`` to coord's ``operator_id`` UUID, or raise loudly."""
    subject = _require_subject(user)
    try:
        payload = await _proxy_coord_get(
            _OPERATORS_LIST_PATH,
            params={"sso_subject": subject},
            forward_bearer=True,
        )
    except HTTPException as exc:
        raise _coord_failure(exc, "coord_operator_lookup_failed") from exc

    operators = payload.get("operators") if isinstance(payload, dict) else None
    if not isinstance(operators, list):
        raise CoordActivationSyncError(
            502,
            "coord_operator_list_malformed",
            "coord GET /admin/coord/operators did not return an `operators` "
            "list; the activation change was NOT applied",
        )
    return _match_operator(operators, subject)


def transition_for(user: User, requested_is_active: bool | None) -> str | None:
    """``"disable"`` / ``"enable"`` for a real transition, else ``None``.

    ``None`` — the field was absent from the update, or it already matches the
    user's current state — means NO coord traffic at all.
    """
    if requested_is_active is None:
        return None
    if bool(requested_is_active) == bool(user.is_active):
        return None
    return "enable" if requested_is_active else "disable"


async def _sync(
    *, request: Request, user: User, action: str, actor: User | None
) -> None:
    """Perform the coord disable/enable for ``user``, or raise loudly."""
    _capture_caller_context(request)
    operator_id = await _resolve_operator_id(user)

    body: dict[str, Any] | None = None
    if action == "disable":
        actor_label = (actor.email if actor is not None else None) or "an administrator"
        body = {"reason": f"deactivated in qontinui-web by {actor_label}"}

    try:
        await _proxy_coord_post(
            f"/coord/operators/{operator_id}/{action}",
            body,
            forward_bearer=True,
        )
    except HTTPException as exc:
        raise _coord_failure(exc, f"coord_operator_{action}_failed") from exc

    logger.info(
        "coord_operator_activation_synced",
        action=action,
        operator_id=operator_id,
        user_id=str(user.id),
    )


async def apply_activation_transition(
    *,
    request: Request | None,
    user: User,
    requested_is_active: bool | None,
    actor: User | None,
    persist: Callable[[], Awaitable[User]],
) -> User:
    """Run ``persist`` and the coord sync in the order that stays fail-closed.

    ``persist`` is the caller's local write
    (``crud.user.update_user_privileged`` / ``BaseUserManager.update``). Both
    are PRIVILEGED writers — the self-service arms
    (``crud.user.update_user_self``, ``UserManager.update(safe=True)``) drop
    ``is_active`` via fastapi-users' ``create_update_dict()`` and so never
    reach here. ``persist`` is invoked exactly once on every path:

    * no ``is_active`` transition → ``persist`` only, zero coord traffic;
    * deactivation → coord disable, THEN ``persist``;
    * reactivation → ``persist``, THEN coord enable.

    See the module docstring for why the two directions differ. Raises
    :class:`CoordActivationSyncError` on any coord-side failure — for a
    deactivation that means the local write never ran.
    """
    action = transition_for(user, requested_is_active)
    if action is None:
        return await persist()

    if request is None:
        # A programmatic flip has no caller bearer to authorize coord with.
        # Failing loudly is the whole point: silently flipping the flag here
        # would recreate the gap this guard closes.
        raise CoordActivationSyncError(
            401, "coord_bearer_missing", _BEARER_MISSING_MESSAGE
        )

    try:
        if action == "disable":
            await _sync(request=request, user=user, action=action, actor=actor)
            return await persist()
        result = await persist()
        await _sync(request=request, user=user, action=action, actor=actor)
        return result
    except CoordActivationSyncError as exc:
        logger.warning(
            "coord_operator_activation_failed",
            action=action,
            user_id=str(user.id),
            error=exc.error,
            status_code=exc.status_code,
        )
        raise
