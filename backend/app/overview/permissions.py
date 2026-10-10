"""Who may edit what, for the project being viewed — one answer, two uses.

Plan ``2026-09-20-overview-authoring-layer`` §1 and §4a. The same function
decides whether a write is allowed AND what every read tells the UI about
editing, so a control can never be shown for a write the API will refuse.

Why this module exists: the frontend's ``isCoordAdmin`` is a UNION across
every tenant the operator belongs to. Administer project A and you saw edit
controls on project B, only to have the save refused. The server gate was
right; the affordance lied. Every overview surface now renders its controls
from :class:`OverviewAccess`, resolved for the ACTIVE tenant only.

Three rules, chosen by what a resource is and where it is stored:

* ``editing_roles`` — web-owned content. The tenant's
  ``overview.settings.editing_roles`` (default ``{admin}``) names the coord
  roles that may write; a qontinui superuser may always write, as on every
  other web-owned admin surface.
* ``project_admin`` — web-owned AUTHORITY, i.e. the settings that say who may
  edit. An admin of the tenant (or a superuser) only: a setting that widens
  access must not be writable by the people it widens it to.
* ``coord_admin`` — a resource stored somewhere that enforces its OWN rule.
  Coord's prompt documents accept a write only from an admin of the tenant,
  so that is the only honest answer here: promising a member an edit that
  coord will refuse is the defect this module closes. ``editing_roles`` does
  not widen it and a superuser flag does not bypass it — coord knows neither.

Two kinds of caller (plan ``2026-10-07-agents-publish-documents-to-the-project-overview``
D1). A Cognito user resolves exactly as before. A coord DEVICE JWT acts as the
device's owning user, with that user's roles, but only in a project the device
is bound to and names explicitly — never a degrade to a home project. Two rules
refuse a device outright, reads included (:data:`DEVICE_REFUSALS`): a
``coord_admin`` resource, because coord stores those behind operator routes
that reject a device JWT; and ``project_admin``, because those settings decide
who else may edit, and a device acts for its user with nobody watching.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps as api_deps
from app.api.deps import DeviceTokenContext, current_active_user_optional, get_async_db
from app.api.v1.endpoints.operations import (
    ACTIVE_TENANT_HEADER,
    _effective_tenant_id,
    capture_caller_bearer,
)
from app.models.overview import OverviewSettings
from app.models.user import User as UserModel
from app.services.coord_device_memberships import get_device_memberships
from app.services.coord_identity import get_coord_identity
from app.services.coord_jwks import kid_outside_coord_family

PermissionRule = Literal["editing_roles", "project_admin", "coord_admin"]

#: Which credential proved the caller. ``user`` — a Cognito user JWT (a person
#: in a browser, or anything holding their token). ``device`` — a coord device
#: JWT, acting as the device's owning user (plan
#: ``2026-10-07-agents-publish-documents-to-the-project-overview`` D1).
PrincipalKind = Literal["user", "device"]

#: The refusal codes this module raises. The CODE strings are the contract
#: the publish tool and the frontend read (plan contract C2).
TENANT_NOT_BOUND = "tenant_not_bound"
DEVICE_NOT_SUPPORTED_FOR_COORD_BACKED = "device_not_supported_for_coord_backed_resource"
DEVICE_NOT_SUPPORTED_FOR_PROJECT_ADMIN = "device_not_supported_for_project_admin"
NOT_A_DEVICE_PRINCIPAL = "not_a_device_principal"

#: The rules a device principal is refused on OUTRIGHT, reads as well as
#: writes and before any store runs, with the code and message each refusal
#: carries. Every other rule treats a device exactly as its user.
#:
#: * ``coord_admin`` — coord stores these behind its operator-only routes,
#:   which reject a device JWT, and a device bearer is never forwarded to one.
#: * ``project_admin`` — the settings, ``editing_roles`` among them, that
#:   decide who else may edit. A device acts for its user unattended, so an
#:   agent must not be able to widen who may write — "a setting that widens
#:   access must not be writable by the people it widens it to", above.
#:   Decided as a security-surface fork at the pre-PR review of this plan's
#:   adoption (coord finding e45abfce-c462-4a91-9f67-38fffc329fb8).
DEVICE_REFUSALS: dict[PermissionRule, tuple[str, str]] = {
    "coord_admin": (
        DEVICE_NOT_SUPPORTED_FOR_COORD_BACKED,
        "This resource is stored in coord behind operator-only routes; sign in "
        "as a person to read or edit it.",
    ),
    "project_admin": (
        DEVICE_NOT_SUPPORTED_FOR_PROJECT_ADMIN,
        "Project settings decide who may edit this project, so only a person "
        "signed in as a project administrator may change them or read their "
        "history.",
    ),
}


def _refusal(status_code: int, code: str, message: str) -> HTTPException:
    """The overview's refusal envelope: ``error`` is the router's existing
    key; ``code`` carries the same string for readers keyed on it."""
    return HTTPException(
        status_code=status_code,
        detail={"error": code, "code": code, "message": message},
    )


@dataclass(frozen=True)
class OverviewPrincipal:
    """Who proved themselves on this request, and with which credential.

    Resolved ONCE per request by :func:`get_overview_principal` (FastAPI
    caches a dependency within a request, so every consumer shares this one
    object and a device JWT is verified exactly once).

    Deliberately not :class:`app.api.deps.ActorPrincipal`: that type is the
    narrow "which arm" answer and forbids carrying claims, while a device
    principal here needs its claims (``device_id`` for attribution) and its
    verified bearer (forwarded to coord's device-membership door, and nowhere
    else).
    """

    kind: PrincipalKind
    user: UserModel
    #: The verified device JWT's ``device_id`` claim; ``None`` for a user.
    device_id: UUID | None = None
    #: The verified device JWT's claim set; ``None`` for a user.
    claims: dict[str, Any] | None = None
    #: The verified device bearer itself; ``None`` for a user. Only ever sent
    #: to coord's ``/coord/devices/me/memberships``.
    token: str | None = None


_overview_bearer = HTTPBearer(auto_error=False)


async def get_overview_principal(
    user: UserModel | None = Depends(current_active_user_optional),
    credentials: HTTPAuthorizationCredentials | None = Depends(_overview_bearer),
) -> OverviewPrincipal:
    """The caller: a Cognito user first, else a coord device JWT.

    * A resolved Cognito user wins outright; a device bearer beside it is not
      consulted (a forwarded device token cannot override the browser user).
    * A bearer whose header names a ``kid`` outside coord's key family is not
      a coord token at all (a Cognito token that did not resolve, say), so it
      is a plain 401 without ever reaching coord's verifier. Verifying it
      would log ``coord_identity_mismatch``, the wiring alarm for a token
      minted by ANOTHER coord, on what is ordinary traffic.
    * Otherwise the bearer is verified as a coord device JWT — once — keeping
      the claims and the owning user. A bearer that fails (unparseable,
      expired, foreign issuer, no ``user_id``, the owning user missing or
      inactive) propagates the verifier's 401, or its 503 when coord's JWKS is
      unreachable. A token without a usable ``device_id`` is a 401 too.
    * A verified token that is not a DEVICE principal (``sub_type`` other than
      ``device``: an agent credential, a service token, a capability grant) is
      a 403 ``not_a_device_principal``, decided here, before anything is
      forwarded to coord. ``device_id`` alone never proves a paired device
      (``deps.DEVICE_SUB_TYPE``).
    * Neither → 401. There is no anonymous path.

    ``_verify_device_jwt`` is looked up on the module at call time, so a test
    can stub coord's JWKS at ``app.api.deps._verify_device_jwt``.
    """
    if user is not None:
        return OverviewPrincipal(kind="user", user=user)
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    token = credentials.credentials
    if kid_outside_coord_family(token):
        raise HTTPException(status_code=401, detail="Authentication required.")
    claims, device_user = await api_deps._verify_device_jwt(token)
    if claims.get("sub_type") != api_deps.DEVICE_SUB_TYPE:
        raise _refusal(
            403,
            NOT_A_DEVICE_PRINCIPAL,
            "This door accepts a person's session or a paired device's token; "
            "this token is neither.",
        )
    context = DeviceTokenContext(claims=claims, user=device_user, token=token)
    return OverviewPrincipal(
        kind="device",
        user=device_user,
        device_id=context.device_id,  # 401 when missing or malformed
        claims=claims,
        token=token,
    )


@dataclass(frozen=True)
class OverviewAccess:
    """The caller, as the overview sees them, in the ACTIVE project."""

    tenant_id: UUID
    #: The caller's coord roles in THIS tenant — never a union across tenants.
    roles: tuple[str, ...]
    #: The project's ``editing_roles`` setting (``("admin",)`` when unsaved).
    editing_roles: tuple[str, ...]
    #: A qontinui superuser (staff). Read from the user row, never written —
    #: named apart from ``is_superuser`` so no reader mistakes this object for
    #: a writer of that flag (``tests/test_no_raw_is_superuser_writer.py``).
    qontinui_staff: bool
    user_id: UUID | None
    actor: str | None
    #: Which credential proved the caller.
    kind: PrincipalKind
    #: The device the request came through, when ``kind == "device"``. The
    #: change log records it beside ``actor`` (plan D2).
    via_device: UUID | None

    def can_edit(self, rule: PermissionRule) -> bool:
        if rule in DEVICE_REFUSALS and self.via_device is not None:
            # A rule only a person may exercise (see DEVICE_REFUSALS): the
            # catalog says so rather than offering an edit the door refuses.
            return False
        is_admin = "admin" in self.roles
        if rule == "coord_admin":
            return is_admin
        if is_admin or self.qontinui_staff:
            return True
        if rule == "project_admin":
            return False
        return any(role in self.editing_roles for role in self.roles)


@dataclass(frozen=True)
class OverviewCaller:
    """Who is asking, and in which project — resolved from coord alone."""

    tenant_id: UUID
    #: The caller's roles in THIS tenant — never a union across tenants.
    roles: tuple[str, ...]


async def _operator_caller(request: Request) -> OverviewCaller:
    """A Cognito user's ACTIVE project and roles, from coord ``/admin/coord/me``.

    The project comes from ``X-Qontinui-Active-Tenant``, validated against
    the caller's own memberships (a project they do not belong to degrades to
    their home project, never widens — the same rule as
    ``operations._effective_tenant_id`` and coord's own
    ``apply_active_tenant_override``). The roles are that tenant's
    per-tenant roles, not the cross-tenant union.
    """
    capture_caller_bearer(request)
    identity = await get_coord_identity(request)
    active = request.headers.get(ACTIVE_TENANT_HEADER)
    tenant_id = _effective_tenant_id(identity, active)
    if tenant_id is None:
        raise HTTPException(status_code=403, detail="tenant_not_resolved")
    # The roles are read from THIS tenant's membership row and nowhere else.
    # `operations._effective_tenant_roles` falls back to the top-level roles
    # (a union across tenants) when the row is missing; here a missing row
    # means no roles, because an unknown answer must not grant an edit.
    roles: tuple[str, ...] = ()
    for membership in identity.tenants:
        if membership.tenant_id == tenant_id:
            roles = tuple(membership.roles)
            break
    return OverviewCaller(tenant_id=tenant_id, roles=roles)


async def _device_caller(
    request: Request, principal: OverviewPrincipal
) -> OverviewCaller:
    """A device's ACTIVE project and roles, from coord's device-membership door.

    Stricter than the operator path on purpose (plan D1): the active tenant
    must be NAMED, as a UUID, and must be one of the device's memberships
    (its user's tenants intersected with the tenants the device is bound to).
    Absent, malformed or unbound is a 403 ``tenant_not_bound`` — never a
    degrade to a home tenant, and never the token's own ``tenant_id`` claim,
    because a device has no "home project" a person chose.

    The caller's bearer is NOT captured for the coord proxies here: those
    reach coord's operator routes, which a device JWT must never be sent to.
    """
    raw = (request.headers.get(ACTIVE_TENANT_HEADER) or "").strip()
    try:
        tenant_id = UUID(raw) if raw else None
    except ValueError:
        tenant_id = None
    if tenant_id is None:
        raise _refusal(
            403,
            TENANT_NOT_BOUND,
            f"A device must name its project in {ACTIVE_TENANT_HEADER} "
            "(a tenant id this device is bound to).",
        )
    assert principal.token is not None  # a device principal always has one
    memberships = await get_device_memberships(request, principal.token)
    # Coord answers for the bearer it was sent. An answer naming another
    # device or user is about somebody else, so it grants nothing.
    for named, verified in (
        (memberships.device_id, principal.device_id),
        (memberships.user_id, getattr(principal.user, "id", None)),
    ):
        if named is not None and named != verified:
            raise _refusal(
                502,
                "coord_memberships_malformed",
                "coord's device-membership answer named a different device or "
                "user than the verified token.",
            )
    membership = memberships.membership(tenant_id)
    if membership is None:
        raise _refusal(
            403,
            TENANT_NOT_BOUND,
            "This device is not bound to that project, or its user is not a "
            "member of it.",
        )
    return OverviewCaller(tenant_id=tenant_id, roles=membership.roles)


async def get_overview_caller(
    request: Request,
    principal: OverviewPrincipal = Depends(get_overview_principal),
) -> OverviewCaller:
    """The ACTIVE project and the caller's roles in it.

    A Cognito user resolves through coord ``/admin/coord/me``
    (:func:`_operator_caller`, unchanged); a device through coord's
    device-membership door (:func:`_device_caller`).

    Kept separate from :func:`get_overview_access` so a test can stand in for
    coord here and still exercise the real ``editing_roles`` resolution.
    """
    if principal.kind == "device":
        return await _device_caller(request, principal)
    return await _operator_caller(request)


async def get_overview_access(
    caller: OverviewCaller = Depends(get_overview_caller),
    principal: OverviewPrincipal = Depends(get_overview_principal),
    db: AsyncSession = Depends(get_async_db),
) -> OverviewAccess:
    """The caller plus the project's ``editing_roles`` — everything
    :meth:`OverviewAccess.can_edit` needs."""
    settings = await db.get(OverviewSettings, caller.tenant_id)
    user = principal.user
    access = OverviewAccess(
        tenant_id=caller.tenant_id,
        roles=caller.roles,
        editing_roles=(
            tuple(settings.editing_roles)
            if settings is not None and settings.editing_roles is not None
            else ("admin",)
        ),
        qontinui_staff=bool(getattr(user, "is_superuser", False)),
        user_id=getattr(user, "id", None),
        actor=(user.email or str(user.id)) if user is not None else None,
        kind=principal.kind,
        via_device=principal.device_id,
    )
    # End the read transaction here. Several resources then call another
    # service (coord) before touching this database again, and an open
    # transaction would hold a pooled connection idle through every one of
    # those calls.
    #
    # The consequence, stated so nobody reads more into it: the permission
    # read and the write it authorises are separate transactions. A write
    # re-reads what it COMPARES (the record's version) under a lock, but an
    # `editing_roles` change landing between this read and that write does
    # not stop a write already past this gate.
    await db.commit()
    return access


def refuse_device_on_operator_only(
    access: OverviewAccess, rule: PermissionRule
) -> None:
    """403 a device on a rule only a person may exercise (:data:`DEVICE_REFUSALS`).

    * ``coord_admin``: coord's operator routes (``/coord/prompt-documents``)
      authorize the forwarded bearer as an SSO operator and reject a device
      JWT, and forwarding a device bearer to an operator route is itself what
      plan D1 forbids.
    * ``project_admin``: the settings decide who else may edit, so a device
      may neither rewrite them nor read their history.

    The refusal is made here, before any store runs, for reads as well as
    writes, and carries the rule's own code.
    """
    refusal = DEVICE_REFUSALS.get(rule)
    if refusal is not None and access.via_device is not None:
        code, message = refusal
        raise _refusal(403, code, message)


def require_read(rule: PermissionRule):
    """A dependency for a resource's READ routes: any member of the active
    project, except a device on a rule in :data:`DEVICE_REFUSALS`."""

    async def dependency(
        access: OverviewAccess = Depends(get_overview_access),
    ) -> OverviewAccess:
        refuse_device_on_operator_only(access, rule)
        return access

    return dependency


def require_edit(rule: PermissionRule):
    """A dependency that refuses a write the caller may not make — decided by
    the same :meth:`OverviewAccess.can_edit` the reads serve."""

    async def dependency(
        access: OverviewAccess = Depends(get_overview_access),
    ) -> OverviewAccess:
        refuse_device_on_operator_only(access, rule)
        if not access.can_edit(rule):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "not_permitted",
                    "message": "You can read this project's overview but not edit it.",
                },
            )
        return access

    return dependency
