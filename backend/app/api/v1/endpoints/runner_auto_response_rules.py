"""
Runner-facing endpoint for fetching org-scoped auto-response rules.

Authenticated by a coord-issued device-token JWT (``get_authenticated_device_user``).
Every runner in an org polls this to obtain the enabled auto-response rules.

Supports conditional requests: the response carries a weak ``ETag`` derived
from the org's rule count and the newest ``updated_at``; a matching
``If-None-Match`` short-circuits to ``304 Not Modified``.

Multi-org devices: a device's owning user may belong to several orgs. For now
we serve the PRIMARY org = the user's EARLIEST-created membership org. A
multi-org union is deferred (documented here intentionally).
"""

from typing import cast
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_authenticated_device_user
from app.crud.auto_response_rule import get_org_rules, org_rules_version
from app.models.user import User
from app.repositories.organization import organization_repo
from app.schemas.auto_response_rule import (
    RunnerRule,
    RunnerRulesResponse,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get(
    "/auto-response-rules",
    response_model=RunnerRulesResponse,
    responses={304: {"description": "Not Modified"}},
)
async def get_runner_rules(
    response: Response,
    device_user: User = Depends(get_authenticated_device_user),
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    db: AsyncSession = Depends(get_async_db),
):
    """Return the enabled auto-response rules for the device's primary org."""
    orgs = await organization_repo.list_by_user(db, device_user.id, limit=100)
    if not orgs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device user belongs to no organization",
        )
    # PRIMARY org = earliest created_at. (list_by_user orders DESC by
    # created_at, so the earliest is the last element.) Multi-org union of
    # rules is deferred.
    primary_org = min(orgs, key=lambda o: o.created_at)
    org_id = cast(UUID, primary_org.id)

    # Auto-seeds the built-in default rule on first read.
    rules = await get_org_rules(db, org_id)
    count, max_updated = await org_rules_version(db, org_id)

    etag = f'W/"{org_id}:{count}:{int(max_updated.timestamp())}"'
    response.headers["ETag"] = etag

    if if_none_match is not None and if_none_match == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED)

    return RunnerRulesResponse(
        rules=[RunnerRule.model_validate(r) for r in rules if r.enabled],
        updated_at=max_updated,
        etag=etag,
    )
