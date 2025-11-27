"""
API endpoints for runner token management.

Provides REST API for creating, listing, revoking, and managing
desktop runner authentication tokens and viewing connection history.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    authenticate_runner,
    get_async_db,
    get_current_active_user_async,
)
from app.crud import runner as runner_crud
from app.models.user import User as UserModel
from app.schemas.runner import (
    RunnerConnectionHistory,
    RunnerConnectionResponse,
    RunnerTokenCreate,
    RunnerTokenResponse,
    RunnerTokenStats,
    RunnerTokenUpdate,
    RunnerTokenWithSecret,
    TestConnectionResponse,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post(
    "/tokens", response_model=RunnerTokenWithSecret, status_code=status.HTTP_201_CREATED
)
async def create_runner_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    token_in: RunnerTokenCreate,
) -> Any:
    """
    Create a new runner token.

    **IMPORTANT**: The token value is only shown once during creation!
    Save it securely - it will never be shown again.

    Args:
        token_in: Token creation data (name, optional expiration)

    Returns:
        The created token with the actual token value

    Raises:
        400: If user has reached maximum token limit
    """
    try:
        db_token, plain_token = await runner_crud.create_runner_token(
            db=db,
            user_id=current_user.id,
            name=token_in.name,
            expires_in_days=token_in.expires_in_days,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # Return token with secret (only time it's exposed)
    return RunnerTokenWithSecret(
        id=db_token.id,
        name=db_token.name,
        created_at=db_token.created_at,
        expires_at=db_token.expires_at,
        last_used_at=db_token.last_used_at,
        is_revoked=db_token.is_revoked,
        last_ip_address=db_token.last_ip_address,
        connection_count=0,
        token=plain_token,
    )


@router.get("/tokens", response_model=list[RunnerTokenResponse])
async def list_runner_tokens(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    include_revoked: bool = False,
) -> Any:
    """
    List all runner tokens for the current user.

    Args:
        include_revoked: Whether to include revoked tokens in the list

    Returns:
        List of runner tokens with connection counts
    """
    tokens_with_counts = await runner_crud.get_runner_tokens(
        db=db,
        user_id=current_user.id,
        include_revoked=include_revoked,
    )

    return [
        RunnerTokenResponse(
            id=token.id,
            name=token.name,
            created_at=token.created_at,
            expires_at=token.expires_at,
            last_used_at=token.last_used_at,
            is_revoked=token.is_revoked,
            last_ip_address=token.last_ip_address,
            connection_count=count,
        )
        for token, count in tokens_with_counts
    ]


@router.get("/tokens/{token_id}", response_model=RunnerTokenResponse)
async def get_runner_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    token_id: UUID,
) -> Any:
    """
    Get a specific runner token by ID.

    Args:
        token_id: UUID of the token

    Returns:
        Runner token details

    Raises:
        404: If token not found
    """
    token = await runner_crud.get_runner_token_by_id(
        db=db,
        token_id=token_id,
        user_id=current_user.id,
    )

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner token not found",
        )

    # Get connection count
    tokens_with_counts = await runner_crud.get_runner_tokens(
        db=db,
        user_id=current_user.id,
        include_revoked=True,
    )
    connection_count = next(
        (count for t, count in tokens_with_counts if t.id == token_id), 0
    )

    return RunnerTokenResponse(
        id=token.id,
        name=token.name,
        created_at=token.created_at,
        expires_at=token.expires_at,
        last_used_at=token.last_used_at,
        is_revoked=token.is_revoked,
        last_ip_address=token.last_ip_address,
        connection_count=connection_count,
    )


@router.patch("/tokens/{token_id}", response_model=RunnerTokenResponse)
async def update_runner_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    token_id: UUID,
    token_update: RunnerTokenUpdate,
) -> Any:
    """
    Update a runner token (currently only supports renaming).

    Args:
        token_id: UUID of the token
        token_update: Update data

    Returns:
        Updated runner token

    Raises:
        404: If token not found
    """
    if token_update.name is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No update data provided",
        )

    updated_token = await runner_crud.update_runner_token_name(
        db=db,
        token_id=token_id,
        user_id=current_user.id,
        new_name=token_update.name,
    )

    if not updated_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner token not found",
        )

    # Get connection count
    tokens_with_counts = await runner_crud.get_runner_tokens(
        db=db,
        user_id=current_user.id,
        include_revoked=True,
    )
    connection_count = next(
        (count for t, count in tokens_with_counts if t.id == token_id), 0
    )

    return RunnerTokenResponse(
        id=updated_token.id,
        name=updated_token.name,
        created_at=updated_token.created_at,
        expires_at=updated_token.expires_at,
        last_used_at=updated_token.last_used_at,
        is_revoked=updated_token.is_revoked,
        last_ip_address=updated_token.last_ip_address,
        connection_count=connection_count,
    )


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_runner_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    token_id: UUID,
) -> None:
    """
    Revoke a runner token (soft delete).

    The token will be marked as revoked but kept in the database for audit trail.
    Revoked tokens cannot be used for authentication.

    Args:
        token_id: UUID of the token to revoke

    Raises:
        404: If token not found
    """
    revoked = await runner_crud.revoke_runner_token(
        db=db,
        token_id=token_id,
        user_id=current_user.id,
    )

    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner token not found",
        )


@router.delete("/tokens/{token_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def delete_runner_token(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    token_id: UUID,
) -> None:
    """
    Permanently delete a runner token (hard delete).

    **WARNING**: This action cannot be undone. The token and all its
    connection history will be permanently deleted from the database.

    Args:
        token_id: UUID of the token to delete

    Raises:
        404: If token not found
    """
    deleted = await runner_crud.delete_runner_token(
        db=db,
        token_id=token_id,
        user_id=current_user.id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner token not found",
        )


@router.get("/connections", response_model=RunnerConnectionHistory)
async def get_connection_history(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    limit: int = 50,
    offset: int = 0,
) -> Any:
    """
    Get connection history with pagination.

    Args:
        limit: Maximum number of connections to return (default: 50, max: 100)
        offset: Number of connections to skip (for pagination)

    Returns:
        Paginated connection history
    """
    # Limit max to 100
    limit = min(limit, 100)

    connections, total = await runner_crud.get_connection_history(
        db=db,
        user_id=current_user.id,
        limit=limit,
        offset=offset,
    )

    active_connections = await runner_crud.get_active_connections(
        db=db,
        user_id=current_user.id,
    )

    # Get token names for connections
    tokens_with_counts = await runner_crud.get_runner_tokens(
        db=db,
        user_id=current_user.id,
        include_revoked=True,
    )
    token_names = {token.id: token.name for token, _ in tokens_with_counts}

    return RunnerConnectionHistory(
        connections=[
            RunnerConnectionResponse(
                id=conn.id,
                runner_token_id=conn.runner_token_id,
                runner_name=(
                    token_names.get(conn.runner_token_id, "Unknown")
                    if conn.runner_token_id
                    else "Browser Session"
                ),
                connected_at=conn.connected_at,
                disconnected_at=conn.disconnected_at,
                duration_seconds=conn.duration_seconds,
                ip_address=conn.ip_address,
                project_id=conn.project_id,  # type: ignore[arg-type]
            )
            for conn in connections
        ],
        total=total,
        active_count=len(active_connections),
        limit=limit,
        offset=offset,
    )


@router.get("/connections/active", response_model=list[RunnerConnectionResponse])
async def get_active_connections(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Get currently active runner connections.

    Returns:
        List of active connections
    """
    active_connections = await runner_crud.get_active_connections(
        db=db,
        user_id=current_user.id,
    )

    # Get token names
    tokens_with_counts = await runner_crud.get_runner_tokens(
        db=db,
        user_id=current_user.id,
        include_revoked=True,
    )
    token_names = {token.id: token.name for token, _ in tokens_with_counts}

    return [
        RunnerConnectionResponse(
            id=conn.id,
            runner_token_id=conn.runner_token_id,
            runner_name=(
                token_names.get(conn.runner_token_id, "Unknown")
                if conn.runner_token_id
                else "Browser Session"
            ),
            connected_at=conn.connected_at,
            disconnected_at=conn.disconnected_at,
            duration_seconds=conn.duration_seconds,
            ip_address=conn.ip_address,
            project_id=conn.project_id,  # type: ignore[arg-type]
        )
        for conn in active_connections
    ]


@router.get("/stats", response_model=RunnerTokenStats)
async def get_runner_stats(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Get statistics about runner tokens and connections.

    Returns:
        Token and connection statistics
    """
    stats = await runner_crud.get_runner_token_stats(
        db=db,
        user_id=current_user.id,
    )

    return RunnerTokenStats(**stats)


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_runner_connection(
    request: Request,
    token: str,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """
    Test a runner connection and verify authentication.

    This endpoint is called by the desktop runner when Quick Connect
    saves settings. It validates the token and creates a test connection
    record to confirm the connection is working.

    Args:
        token: JWT access token or runner token to test

    Returns:
        Test connection response with user info and connection ID

    Raises:
        401: If authentication fails
    """
    # Authenticate using the provided token
    try:
        user, runner_token = await authenticate_runner(token)
    except Exception as e:
        logger.error("test_connection_auth_failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed. Please check your token.",
        )

    # Get client IP
    client_ip = request.client.host if request.client else None

    # Create a test connection record
    connection = await runner_crud.create_test_connection(
        db=db,
        user_id=user.id,
        token_id=runner_token.id if runner_token else None,
        ip_address=client_ip,
    )

    auth_method = "runner_token" if runner_token else "jwt"
    token_name = runner_token.name if runner_token else None

    logger.info(
        "test_connection_successful",
        user_id=str(user.id),
        username=user.username,
        auth_method=auth_method,
        token_name=token_name,
        connection_id=connection.id,
        ip_address=client_ip,
    )

    return TestConnectionResponse(
        success=True,
        message="Connection test successful! Your runner is configured correctly.",
        user_id=str(user.id),
        username=user.username,
        auth_method=auth_method,
        token_name=token_name,
        connection_id=connection.id,
        tested_at=datetime.utcnow(),
    )
