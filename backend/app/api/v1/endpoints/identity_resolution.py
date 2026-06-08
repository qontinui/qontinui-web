"""Responsible-user resolution endpoint (identity-contract I3-web).

A thin authed wrapper over
:func:`app.services.identity_resolver.resolve_responsible_users`. Given a
``(repo, pr_number)``, returns the responsible qontinui user(s) — never
empty — each tagged with the ``source`` that resolved them so consumers can
be honest about confidence.

Path::

    GET /api/v1/identity/responsible-users/{repo}/{pr_number}

Auth: the caller authenticates as their canonical account
(``get_current_active_user_async``). Their Cognito bearer + user id are
forwarded to coord (``x-qontinui-user-id``) so coord tenant-scopes the
``responsible-context`` read — every hop is tenant-scoped; no cross-tenant
identity is resolved or leaked.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.services import coord_device, identity_resolver

router = APIRouter()


class ResponsibleUserOut(BaseModel):
    """One responsible user + the resolution source."""

    user_id: str = Field(description="The qontinui user id (UUID).")
    source: str = Field(
        description='Resolution source: "github-author" | "device-owner" | '
        '"tenant-fallback".'
    )


class ResponsibleUsersResponse(BaseModel):
    """Response for the responsible-users resolver. Never empty."""

    responsible_users: list[ResponsibleUserOut] = Field(default_factory=list)


@router.get(
    "/responsible-users/{repo:path}/{pr_number}",
    response_model=ResponsibleUsersResponse,
)
async def get_responsible_users(
    request: Request,
    repo: str = Path(description="The GitHub repo (owner/name or short name)."),
    pr_number: int = Path(ge=1, description="The pull-request number."),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> ResponsibleUsersResponse:
    """Resolve the responsible qontinui user(s) for ``(repo, pr_number)``.

    Composes (in priority order) the PR's GitHub author -> linked user, the
    resolving agent's device-owner user, and a tenant-member fallback — so
    the result is always non-empty.
    """
    bearer = coord_device.extract_bearer(request)
    users = await identity_resolver.resolve_responsible_users(
        db,
        repo,
        pr_number,
        bearer=bearer,
        acting_user_id=str(current_user.id),
    )
    return ResponsibleUsersResponse(
        responsible_users=[
            ResponsibleUserOut(user_id=str(u.user_id), source=u.source) for u in users
        ]
    )
