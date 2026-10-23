"""The presentation scope door — ``/api/v1/presentation/scope``.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (D3.3, D3.4). The
console's presentation lens renders an item's free text only when every
repository it belongs to has a first-party owner and the text holds none of the
confidential terms; this door serves those two lists for the ACTIVE project
(the coord tenant the Project selector chose), and stores the project's own
half of them.

* ``GET "/scope"`` — any member of the active project. The one read the lens
  makes in presentation mode (D3.4): the effective lists, the stored row the
  operator edits, the defaults, and whether this caller may edit.
* ``PUT "/scope"`` — an admin of the active project, or qontinui staff.
  Replaces the stored row, as a compare-and-set on its version.

Authorization (security-surface content trigger 5). The write is gated by
:func:`require_coord_tenant_admin_target`, the dependency every tenant-scoped
admin write here uses: admin is checked in the EFFECTIVE tenant from that
tenant's own membership roles, never from ``is_admin`` / the frontend's
``isCoordAdmin``, which are unions across every tenant the operator belongs
to. The tenant the row lands in is that same effective tenant, so an admin of
project A viewing project B is checked in B and writes B. The read's
``can_edit`` is computed by the same rule, so the form never offers a save the
write would refuse. A device or service credential reaches neither route: both
require an operator's signed-in session.

Isolation (D3.4). Every row is keyed on the tenant resolved here; a caller can
name no tenant, and a project-selector value for a project the caller is not a
member of degrades to their home project (``_effective_tenant_id``), never to
the selected one.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.strict_query import StrictQueryRoute
from app.api.v1.endpoints.operations import (
    ACTIVE_TENANT_HEADER,
    _effective_tenant_id,
    _effective_tenant_roles,
    capture_caller_bearer,
    require_coord_tenant_admin_target,
)
from app.crud import presentation_scope as crud
from app.models.user import User
from app.schemas.presentation import (
    PresentationScopeConfigured,
    PresentationScopeDefaults,
    PresentationScopeOut,
    PresentationScopeWrite,
)
from app.services.coord_identity import CoordIdentity, get_coord_identity
from app.services.presentation_scope import (
    effective_scope,
    read_registered_repo_owners,
    viewer_other_tenant_names,
)

#: Strict: a query key this router does not declare is a ``422`` naming it.
router = APIRouter(route_class=StrictQueryRoute)


@dataclass(frozen=True)
class PresentationCaller:
    """The signed-in operator, the project they act in, and their edit right."""

    tenant_id: UUID
    identity: CoordIdentity
    can_edit: bool


def _may_edit(user: User, identity: CoordIdentity, active: str | None) -> bool:
    """The PUT's rule (``require_coord_tenant_admin``): admin in the effective
    tenant's own roles, or a qontinui superuser."""
    return bool(user.is_superuser) or "admin" in _effective_tenant_roles(
        identity, active
    )


async def get_presentation_caller(
    request: Request,
    user: User = Depends(get_current_active_user_async),
) -> PresentationCaller:
    """Resolve the active project (membership-validated) for a read."""
    # The bearer capture runs first and independently: the repository read
    # forwards it to coord whatever identity resolution does.
    capture_caller_bearer(request)
    identity = await get_coord_identity(request)
    active = request.headers.get(ACTIVE_TENANT_HEADER)
    tenant_id = _effective_tenant_id(identity, active)
    if tenant_id is None:
        raise HTTPException(status_code=403, detail="tenant_not_resolved")
    return PresentationCaller(
        tenant_id=tenant_id,
        identity=identity,
        can_edit=_may_edit(user, identity, active),
    )


async def _render(
    caller: PresentationCaller, stored: crud.StoredScope | None
) -> PresentationScopeOut:
    """The response for ``caller``'s project, given its stored row."""
    registered = await read_registered_repo_owners(caller.identity, caller.tenant_id)
    viewer_names = viewer_other_tenant_names(caller.identity, caller.tenant_id)
    scope = effective_scope(
        configured_owners=stored.first_party_owners if stored else None,
        configured_terms=stored.confidential_terms if stored else (),
        registered=registered,
        viewer_names=viewer_names,
    )
    return PresentationScopeOut(
        tenant_id=caller.tenant_id,
        first_party_owners=(
            None if scope.first_party_owners is None else list(scope.first_party_owners)
        ),
        first_party_owners_source=scope.first_party_owners_source,
        first_party_owners_unknown_reason=scope.first_party_owners_unknown_reason,
        confidential_terms=list(scope.confidential_terms),
        configured=PresentationScopeConfigured(
            first_party_owners=(
                None
                if stored is None or stored.first_party_owners is None
                else list(stored.first_party_owners)
            ),
            confidential_terms=list(stored.confidential_terms) if stored else [],
            version=stored.version if stored else 0,
            updated_at=stored.updated_at if stored else None,
            updated_by=stored.updated_by if stored else None,
        ),
        defaults=PresentationScopeDefaults(
            registered_repo_owners=(
                None if registered.owners is None else list(registered.owners)
            ),
            registered_repo_owners_unknown_reason=registered.unknown_reason,
            viewer_other_tenant_names=viewer_names,
        ),
        can_edit=caller.can_edit,
    )


@router.get(
    "/scope",
    response_model=PresentationScopeOut,
    summary="Read the active project's presentation scope",
)
async def read_presentation_scope(
    caller: PresentationCaller = Depends(get_presentation_caller),
    db: AsyncSession = Depends(get_async_db),
) -> PresentationScopeOut:
    stored = await crud.get_scope(db, caller.tenant_id)
    # End the read transaction before the coord read, so a slow coord never
    # holds a pooled connection idle.
    await db.commit()
    return await _render(caller, stored)


@router.put(
    "/scope",
    response_model=PresentationScopeOut,
    responses={
        403: {"description": "Not an admin of the active project."},
        409: {"description": "The stored scope moved since expected_version."},
    },
    summary="Replace the active project's stored presentation scope",
)
async def write_presentation_scope(
    payload: PresentationScopeWrite,
    request: Request,
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
    user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> PresentationScopeOut:
    try:
        stored = await crud.write_scope(
            db,
            tenant_id=tenant_id,
            first_party_owners=payload.first_party_owners,
            confidential_terms=payload.confidential_terms,
            expected_version=payload.expected_version,
            user=user,
        )
    except crud.ScopeVersionConflict as conflict:
        # Nothing was written; `get_async_db` rolls the session back as the
        # refusal propagates.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "presentation_scope_conflict",
                "message": (
                    "The presentation scope changed since it was read. Reload "
                    "it, then make the edit again."
                ),
                "current_version": conflict.current_version,
            },
        ) from conflict
    await db.commit()
    # Memoized on the request by the admin gate: no second coord call.
    identity = await get_coord_identity(request)
    return await _render(
        PresentationCaller(tenant_id=tenant_id, identity=identity, can_edit=True),
        stored,
    )
