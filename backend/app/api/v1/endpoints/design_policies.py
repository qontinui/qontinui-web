"""
API endpoints for tenant-scoped design/UX policies.

Read model: any resolved tenant member may list the policies (agents need to
read them). Write model: tenant admins may create/edit/delete/reset, mirroring
the coord policy write gate.

These records are the tool-agnostic source of truth for design guidance —
Claude, OpenAI/Codex, Gemini, or a CI script all consume the same
GET /api/v1/design-policies response.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.api.v1.endpoints.operations import (
    get_tenant_id,
    require_coord_tenant_admin,
)
from app.crud import design_policy as crud
from app.models.user import User
from app.schemas.design_policy import (
    DesignPolicyCreate,
    DesignPolicyListResponse,
    DesignPolicyResponse,
    DesignPolicyUpdate,
)

router = APIRouter()


def _actor(user: User) -> str:
    """Best-effort human-readable actor for created_by/updated_by."""
    return getattr(user, "email", None) or str(user.id)


@router.get(
    "/",
    response_model=DesignPolicyListResponse,
    summary="List design policies for the caller's tenant",
)
async def list_policies(
    db: AsyncSession = Depends(get_async_db),
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: User = Depends(current_active_user),
) -> DesignPolicyListResponse:
    policies = await crud.get_tenant_policies(db, tenant_id, _actor(current_user))
    return DesignPolicyListResponse(
        items=[DesignPolicyResponse.model_validate(p) for p in policies],
        count=len(policies),
    )


@router.post(
    "/",
    response_model=DesignPolicyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom design policy",
)
async def create_policy(
    data: DesignPolicyCreate,
    db: AsyncSession = Depends(get_async_db),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
    current_user: User = Depends(current_active_user),
) -> DesignPolicyResponse:
    policy = await crud.create_policy(db, tenant_id, data, _actor(current_user))
    return DesignPolicyResponse.model_validate(policy)


@router.put(
    "/{policy_id}",
    response_model=DesignPolicyResponse,
    summary="Update a design policy",
)
async def update_policy(
    policy_id: UUID,
    data: DesignPolicyUpdate,
    db: AsyncSession = Depends(get_async_db),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
    current_user: User = Depends(current_active_user),
) -> DesignPolicyResponse:
    policy = await crud.update_policy(
        db, tenant_id, policy_id, data, _actor(current_user)
    )
    if policy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found"
        )
    return DesignPolicyResponse.model_validate(policy)


@router.delete(
    "/{policy_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a custom design policy",
)
async def delete_policy(
    policy_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> None:
    result = await crud.delete_policy(db, tenant_id, policy_id)
    if result is True:
        return
    if result == "Policy not found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found"
        )
    if result == "Cannot delete built-in policy":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete built-in policy",
        )


@router.post(
    "/reset",
    response_model=DesignPolicyListResponse,
    summary="Reset design policies to the built-in defaults",
)
async def reset_policies(
    db: AsyncSession = Depends(get_async_db),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
    current_user: User = Depends(current_active_user),
) -> DesignPolicyListResponse:
    policies = await crud.reset_to_defaults(db, tenant_id, _actor(current_user))
    return DesignPolicyListResponse(
        items=[DesignPolicyResponse.model_validate(p) for p in policies],
        count=len(policies),
    )
