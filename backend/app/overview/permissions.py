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
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints.operations import (
    ACTIVE_TENANT_HEADER,
    _effective_tenant_id,
    capture_caller_bearer,
)
from app.models.overview import OverviewSettings
from app.models.user import User as UserModel
from app.services.coord_identity import get_coord_identity

PermissionRule = Literal["editing_roles", "project_admin", "coord_admin"]


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

    def can_edit(self, rule: PermissionRule) -> bool:
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


async def get_overview_caller(request: Request) -> OverviewCaller:
    """The ACTIVE project and the caller's roles in it.

    The project comes from ``X-Qontinui-Active-Tenant``, validated against
    the caller's own memberships (a project they do not belong to degrades to
    their home project, never widens — the same rule as
    ``operations._effective_tenant_id`` and coord's own
    ``apply_active_tenant_override``). The roles are that tenant's
    per-tenant roles, not the cross-tenant union.

    Kept separate from :func:`get_overview_access` so a test can stand in for
    coord here and still exercise the real ``editing_roles`` resolution.
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


async def get_overview_access(
    caller: OverviewCaller = Depends(get_overview_caller),
    user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> OverviewAccess:
    """The caller plus the project's ``editing_roles`` — everything
    :meth:`OverviewAccess.can_edit` needs."""
    settings = await db.get(OverviewSettings, caller.tenant_id)
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


def require_edit(rule: PermissionRule):
    """A dependency that refuses a write the caller may not make — decided by
    the same :meth:`OverviewAccess.can_edit` the reads serve."""

    async def dependency(
        access: OverviewAccess = Depends(get_overview_access),
    ) -> OverviewAccess:
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
