"""
Runner fleet API endpoints.

Exposes two classes of routes:

* **User-authenticated** (``Authorization: Bearer <access-JWT>``) endpoints
  for a logged-in web user to manage their runner tokens and view registered
  runners.
* **Runner-authenticated** (``Authorization: Bearer qontinui_runner_…``)
  endpoints for the runner itself — registration and heartbeats.

The older ``runners.py`` module is left untouched; it owns the legacy
connection-history endpoints mounted at the same ``/runners`` prefix.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_async_db,
    get_authenticated_runner,
    get_current_active_user_async,
)
from app.crud import runner_crud
from app.models.runner_token import RunnerToken
from app.models.user import User as UserModel
from app.schemas.runner_fleet import (
    RunnerHeartbeatRequest,
    RunnerRegistrationRequest,
    RunnerRegistrationResponse,
    RunnerResponse,
)
from app.schemas.runner_token import (
    RunnerTokenCreate,
    RunnerTokenCreatedResponse,
    RunnerTokenResponse,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# User-authenticated routes
# ---------------------------------------------------------------------------


@router.post(
    "/tokens",
    response_model=RunnerTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    payload: RunnerTokenCreate,
) -> Any:
    """Mint a new runner bearer token for the current user.

    The plaintext token is only returned on this response. Store it — it
    cannot be recovered later.
    """
    record, plain_token = await runner_crud.create_runner_token(
        db=db,
        user_id=current_user.id,
        name=payload.name,
        expires_in_days=payload.expires_in_days,
    )
    logger.info(
        "runner_token_created",
        user_id=str(current_user.id),
        token_id=str(record.id),
        name=record.name,
        expires_in_days=payload.expires_in_days,
    )
    return RunnerTokenCreatedResponse(
        token_record=RunnerTokenResponse.model_validate(record),
        plain_token=plain_token,
    )


@router.get("/tokens", response_model=list[RunnerTokenResponse])
async def list_tokens(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Return the current user's runner tokens (hashes hidden)."""
    tokens = await runner_crud.list_runner_tokens(db, current_user.id)
    return [RunnerTokenResponse.model_validate(t) for t in tokens]


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    token_id: UUID,
) -> None:
    """Revoke a runner token owned by the current user."""
    await runner_crud.revoke_runner_token(
        db=db, token_id=token_id, user_id=current_user.id
    )
    logger.info(
        "runner_token_revoked",
        user_id=str(current_user.id),
        token_id=str(token_id),
    )


@router.get("", response_model=list[RunnerResponse])
async def list_runners(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """List all server-mode runners owned by the current user."""
    runners = await runner_crud.list_runners(db, current_user.id)
    return [RunnerResponse.model_validate(r) for r in runners]


@router.get("/{runner_id}", response_model=RunnerResponse)
async def get_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    runner_id: UUID,
) -> Any:
    """Fetch a single runner by id (must be owned by the current user)."""
    runner = await runner_crud.get_runner(db, runner_id)
    if runner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Runner not found"
        )
    if runner.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this runner",
        )
    return RunnerResponse.model_validate(runner)


@router.delete("/{runner_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deregister_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    runner_id: UUID,
) -> None:
    """Deregister (delete) a runner owned by the current user."""
    await runner_crud.delete_runner(db, runner_id, current_user.id)
    logger.info(
        "runner_deregistered",
        user_id=str(current_user.id),
        runner_id=str(runner_id),
    )


# ---------------------------------------------------------------------------
# Runner-authenticated routes
# ---------------------------------------------------------------------------


@router.post("/register", response_model=RunnerRegistrationResponse)
async def register_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    runner_token: RunnerToken = Depends(get_authenticated_runner),
    payload: RunnerRegistrationRequest,
) -> Any:
    """Register a server-mode runner, authenticated with a runner token.

    Idempotent on ``(user_id, name)``: a subsequent call with the same name
    updates the existing row rather than creating a duplicate.
    """
    record = await runner_crud.register_runner(
        db,
        user_id=runner_token.user_id,
        name=payload.name,
        hostname=payload.hostname,
        port=payload.port,
        capabilities=payload.capabilities,
        server_mode=payload.server_mode,
        restate_enabled=payload.restate_enabled,
        restate_healthy=payload.restate_healthy,
        runner_token_id=runner_token.id,
    )
    logger.info(
        "runner_registered",
        user_id=str(runner_token.user_id),
        runner_id=str(record.id),
        name=record.name,
        hostname=record.hostname,
        port=record.port,
    )
    return RunnerRegistrationResponse(
        runner_id=record.id,
        registered_at=record.last_heartbeat or record.created_at,
        dispatch_secret=record.dispatch_secret,
    )


@router.post("/{runner_id}/heartbeat", response_model=RunnerResponse)
async def heartbeat(
    *,
    db: AsyncSession = Depends(get_async_db),
    runner_token: RunnerToken = Depends(get_authenticated_runner),
    runner_id: UUID,
    payload: RunnerHeartbeatRequest,
) -> Any:
    """Record a heartbeat from a runner.

    The presented runner token must belong to the same user that owns the
    target runner.
    """
    existing = await runner_crud.get_runner(db, runner_id)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Runner not found"
        )
    if existing.user_id != runner_token.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Runner belongs to a different user",
        )

    updated = await runner_crud.heartbeat_runner(
        db,
        runner_id=runner_id,
        restate_healthy=payload.restate_healthy,
        status_value=payload.status,
    )
    # Cannot reach None branch after the existence check above.
    assert updated is not None  # noqa: S101
    return RunnerResponse.model_validate(updated)
