"""
API endpoints for org-scoped (fleet-wide) auto-response rule management.

Operators CRUD auto-response rules for an organization they belong to. Auth is
Cognito (``get_current_active_user_async``); every endpoint verifies org
membership. The matching runner-facing (device-JWT) endpoint lives in
``runner_auto_response_rules.py``.
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import auto_response_rule as crud
from app.crud.auto_response_rule import DELETE_BUILTIN_FORBIDDEN
from app.models.user import User
from app.schemas.auto_response_rule import (
    AutoResponseRuleCreate,
    AutoResponseRuleListResponse,
    AutoResponseRuleReorder,
    AutoResponseRuleResponse,
    AutoResponseRuleUpdate,
)
from app.services.permissions.organization_access import (
    check_organization_membership,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


async def _verify_org_access(
    db: AsyncSession, organization_id: UUID, user: User
) -> None:
    """Verify the user is a member of the organization (404 / 403)."""
    membership = await check_organization_membership(db, user.id, organization_id)
    if membership is None:
        # check_organization_membership returns None both when the org/member
        # row is missing; distinguish missing-org as 404 by probing existence.
        from app.repositories.organization import organization_repo

        org = await organization_repo.get_by_id(db, organization_id)
        if org is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )


@router.get(
    "/organizations/{organization_id}/auto-response-rules",
    response_model=AutoResponseRuleListResponse,
)
async def list_rules(
    organization_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
):
    """List auto-response rules for an organization (auto-seeds defaults)."""
    await _verify_org_access(db, organization_id, current_user)
    rules = await crud.get_org_rules(db, organization_id)
    return AutoResponseRuleListResponse(
        items=[AutoResponseRuleResponse.model_validate(r) for r in rules],
        count=len(rules),
    )


@router.post(
    "/organizations/{organization_id}/auto-response-rules",
    response_model=AutoResponseRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_rule(
    organization_id: UUID,
    data: AutoResponseRuleCreate,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
):
    """Create a new (custom) auto-response rule."""
    await _verify_org_access(db, organization_id, current_user)
    rule = await crud.create_rule(db, organization_id, data)
    return AutoResponseRuleResponse.model_validate(rule)


@router.get(
    "/organizations/{organization_id}/auto-response-rules/{rule_id}",
    response_model=AutoResponseRuleResponse,
)
async def get_rule(
    organization_id: UUID,
    rule_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
):
    """Get a single auto-response rule by id."""
    await _verify_org_access(db, organization_id, current_user)
    rule = await crud.get_rule(db, organization_id, rule_id)
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Auto-response rule not found",
        )
    return AutoResponseRuleResponse.model_validate(rule)


@router.put(
    "/organizations/{organization_id}/auto-response-rules/{rule_id}",
    response_model=AutoResponseRuleResponse,
)
async def update_rule(
    organization_id: UUID,
    rule_id: UUID,
    data: AutoResponseRuleUpdate,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
):
    """Partially update an auto-response rule (built-ins editable)."""
    await _verify_org_access(db, organization_id, current_user)
    rule = await crud.update_rule(db, organization_id, rule_id, data)
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Auto-response rule not found",
        )
    return AutoResponseRuleResponse.model_validate(rule)


@router.delete(
    "/organizations/{organization_id}/auto-response-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_rule(
    organization_id: UUID,
    rule_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
):
    """Delete a custom auto-response rule (403 on built-in)."""
    await _verify_org_access(db, organization_id, current_user)
    result = await crud.delete_rule(db, organization_id, rule_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Auto-response rule not found",
        )
    if result == DELETE_BUILTIN_FORBIDDEN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete a built-in auto-response rule",
        )


@router.post(
    "/organizations/{organization_id}/auto-response-rules/reorder",
    response_model=AutoResponseRuleListResponse,
)
async def reorder_rules(
    organization_id: UUID,
    data: AutoResponseRuleReorder,
    current_user: User = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
):
    """Apply a new ordering to the org's auto-response rules."""
    await _verify_org_access(db, organization_id, current_user)
    rules = await crud.reorder_rules(db, organization_id, data.ordered_ids)
    return AutoResponseRuleListResponse(
        items=[AutoResponseRuleResponse.model_validate(r) for r in rules],
        count=len(rules),
    )
