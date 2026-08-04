"""Agent command override API — account-versioned agent commands.

The runner ships its agent commands (``/vet-plan``, ``/implement-plan``, …)
embedded in its binary and resolves **account override → embedded default**.
These endpoints own the account layer only: there is no default row here, so
``DELETE`` removes a customization and lets the embedded default apply again —
it can never delete a default.

Every route is scoped to ONE organization. The org is either named explicitly
(``organization_id``) and checked with the existing
``check_organization_membership``, or defaults to the caller's personal
organization. Nothing here hand-rolls a tenant filter: the service takes the
resolved ``organization_id`` and filters every query by it.
"""

from typing import cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.models.user import User
from app.services.agent_command_service import (
    AgentCommandCreate,
    AgentCommandListResponse,
    AgentCommandResponse,
    AgentCommandService,
    AgentCommandUpdate,
    AgentCommandVersionListResponse,
)
from app.services.permissions.organization_access import (
    check_organization_membership,
    get_personal_organization,
)

router = APIRouter()


def get_service() -> AgentCommandService:
    return AgentCommandService()


class RevertRequest(BaseModel):
    """Revert an override to the body of an earlier version."""

    version_number: int = Field(..., ge=1)


async def _resolve_organization_id(
    db: AsyncSession,
    user: User,
    organization_id: UUID | None,
) -> UUID:
    """Resolve + authorize the account these commands belong to.

    An explicit ``organization_id`` goes through the existing membership check;
    omitting it falls back to the caller's personal organization, which every
    user gets at registration.
    """
    if organization_id is not None:
        membership = await check_organization_membership(
            db, user.id, organization_id, required_role="member"
        )
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not a member of this organization",
            )
        return organization_id

    personal = await get_personal_organization(db, user.id)
    if not personal:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No personal organization for this user; pass organization_id "
                "explicitly."
            ),
        )
    # `Organization` is a legacy `Column`-style model, so `.id` types as a
    # Column rather than a UUID.
    return cast(UUID, personal.id)


@router.get(
    "",
    response_model=AgentCommandListResponse,
    summary="List this account's agent command overrides",
)
async def list_agent_commands(
    organization_id: UUID | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentCommandService = Depends(get_service),
) -> AgentCommandListResponse:
    """Only OVERRIDES are listed — commands with no override are not rows."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    return await service.list_commands(db, org_id, offset, limit)


@router.post(
    "",
    response_model=AgentCommandResponse,
    summary="Create or replace an agent command override",
)
async def upsert_agent_command(
    data: AgentCommandCreate,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentCommandService = Depends(get_service),
) -> AgentCommandResponse:
    """Upsert by ``(organization_id, name)``; appends a new version."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    return await service.upsert_command(db, org_id, data, current_user.id)


@router.get(
    "/{name}",
    response_model=AgentCommandResponse,
    summary="Get one agent command override",
)
async def get_agent_command(
    name: str,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentCommandService = Depends(get_service),
) -> AgentCommandResponse:
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        return await service.get_command(db, org_id, name)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.patch(
    "/{name}",
    response_model=AgentCommandResponse,
    summary="Update an agent command override",
)
async def update_agent_command(
    name: str,
    data: AgentCommandUpdate,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentCommandService = Depends(get_service),
) -> AgentCommandResponse:
    """A body change appends a version; other fields do not."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        return await service.update_command(db, org_id, name, data, current_user.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.get(
    "/{name}/versions",
    response_model=AgentCommandVersionListResponse,
    summary="List an override's version history",
)
async def list_agent_command_versions(
    name: str,
    organization_id: UUID | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentCommandService = Depends(get_service),
) -> AgentCommandVersionListResponse:
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        return await service.list_versions(db, org_id, name, offset, limit)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.post(
    "/{name}/revert",
    response_model=AgentCommandResponse,
    summary="Revert an override to an earlier version",
)
async def revert_agent_command(
    name: str,
    data: RevertRequest,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentCommandService = Depends(get_service),
) -> AgentCommandResponse:
    """Appends a NEW version whose body equals the target's — never a rewrite."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    try:
        return await service.revert_to_version(
            db, org_id, name, data.version_number, current_user.id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.delete(
    "/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an override so the embedded default applies again",
)
async def delete_agent_command_override(
    name: str,
    organization_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    service: AgentCommandService = Depends(get_service),
) -> None:
    """Removes the account's customization only — there is no default row."""
    org_id = await _resolve_organization_id(db, current_user, organization_id)
    deleted = await service.delete_override(db, org_id, name)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent command override not found: {name}",
        )
