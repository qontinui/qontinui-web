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
  Replaces the stored row, as a compare-and-set on (tenant, version): the
  write names the version AND the project of the scope it was made against,
  and is refused with a 409 when either has moved.

Authorization (security-surface content trigger 5). The write is gated by
:func:`require_coord_tenant_admin_target`, the per-tenant admin gate that also
resolves the tenant the row lands in (as ``build_records`` and ``taste`` use
it): admin is checked in the EFFECTIVE tenant from that tenant's own
membership roles, never from ``is_admin`` / the frontend's ``isCoordAdmin``,
which are unions across every tenant the operator belongs to. The tenant the
row lands in is that same effective tenant, so an admin of project A viewing
project B is checked in B and writes B. The body's ``expected_tenant_id``
never chooses the row; it only refuses an edit made for another project, so a
form left open while the selection changed in another tab cannot save one
project's confidential terms into another's row. The read's ``can_edit`` is
computed by the same rule as the gate, so the form never offers a save the
write would refuse. A device or service credential reaches neither route:
both require an operator's signed-in session.

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
from app.core.refusal import (
    NextActionKind,
    RefusalCode,
    RefusalHTTPException,
    refusal_error,
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


#: The ``detail`` of the bare 403 ``get_coord_identity`` raises when coord's
#: ``/admin/coord/me`` refuses the operator, and the code this route's own
#: refusal carries for the same condition.
_TENANT_NOT_RESOLVED = "tenant_not_resolved"


def _tenant_not_resolved() -> RefusalHTTPException:
    """The one answer the read gives when no project resolves for the caller.

    Two arms reach it, and both serve this same refusal:

    * coord's ``/admin/coord/me`` answers 403, as it does for an operator it
      links to no project, and ``get_coord_identity`` raises that as a bare
      ``HTTPException(403, "tenant_not_resolved")``;
    * coord answers, but no project resolves from its answer: the operator
      has no home project, and the selection names no project they belong to.

    It is a typed refusal, not a bare string, because
    ``tests/test_refusal_ratchet.py`` counts free-text error responses and that
    count may only fall. So its wire shape is NOT the one ``coord_identity``
    and the shared tenant gates in ``operations`` give this condition
    (``get_tenant_id``, and ``require_coord_tenant_admin``, which also gates
    this path's PUT). Their bare raise is served as ``error: "FORBIDDEN"``
    with the token in ``message``. Here the token is in ``error`` and in
    ``refusal.discriminator``, and ``message`` is the sentence below. A client
    that matches ``message == "tenant_not_resolved"`` reads their shape and
    not this one, so converting one of their raises the same way changes what
    that route's clients match on.
    """
    return refusal_error(
        status.HTTP_403_FORBIDDEN,
        RefusalCode.permission_denied,
        NextActionKind.fix_request,
        "No project could be resolved for this request: select a project "
        "you belong to, or ask a project admin to add you.",
        discriminator=_TENANT_NOT_RESOLVED,
        error_code=_TENANT_NOT_RESOLVED,
    )


async def get_presentation_caller(
    request: Request,
    user: User = Depends(get_current_active_user_async),
) -> PresentationCaller:
    """Resolve the active project (membership-validated) for a read.

    No project resolving is refused with :func:`_tenant_not_resolved`, on
    either arm; every other failure keeps its own answer.
    """
    # The bearer capture runs first and independently: the repository read
    # forwards it to coord whatever identity resolution does.
    capture_caller_bearer(request)
    try:
        identity = await get_coord_identity(request)
    except HTTPException as exc:
        # Only coord refusing the operator is this condition. A missing bearer
        # (401), an unreachable or slow coord (502/504) and any other status
        # coord answers keep their own answer: a coord outage is not a
        # missing project.
        if (exc.status_code, exc.detail) == (
            status.HTTP_403_FORBIDDEN,
            _TENANT_NOT_RESOLVED,
        ):
            raise _tenant_not_resolved() from exc
        raise
    active = request.headers.get(ACTIVE_TENANT_HEADER)
    tenant_id = _effective_tenant_id(identity, active)
    if tenant_id is None:
        raise _tenant_not_resolved()
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
        409: {
            "description": (
                "The stored scope moved since expected_version, or the active "
                "project is not expected_tenant_id."
            )
        },
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
    if payload.expected_tenant_id != tenant_id:
        # The edit was made against another project's scope (the selection
        # changed under an open form). Writing it here would put that
        # project's confidential terms into this project's row, which every
        # member of this project can read.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "presentation_scope_tenant_mismatch",
                "message": (
                    "This edit was made for another project than the one now "
                    "active, so nothing was written. Re-read the active "
                    "project's scope and make the edit there."
                ),
            },
        )
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
