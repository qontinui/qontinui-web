"""
CRUD operations for runner tokens and connections.

This module provides database operations for managing desktop runner
authentication tokens and tracking connection history.
"""

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import generate_runner_token, hash_runner_token
from app.models.runner_connection import RunnerConnection
from app.models.runner_token import RunnerToken

# ============================================================================
# Runner Token CRUD Operations
# ============================================================================


async def create_runner_token(
    db: AsyncSession,
    user_id: UUID,
    name: str,
    expires_in_days: int | None = None,
) -> tuple[RunnerToken, str]:
    """
    Create a new runner token for a user.

    Args:
        db: Database session
        user_id: ID of the user creating the token
        name: User-friendly name for the token
        expires_in_days: Number of days until expiration (None = never expires)

    Returns:
        Tuple of (RunnerToken model, plain text token)
        The plain text token is only returned here and never stored!

    Raises:
        ValueError: If user has reached max tokens limit
    """
    # Check if user has reached max tokens
    count_query = select(func.count(RunnerToken.id)).where(
        and_(
            RunnerToken.user_id == user_id,
            RunnerToken.is_revoked.is_(False),
        )
    )
    result = await db.execute(count_query)
    active_count = result.scalar_one()

    if active_count >= settings.RUNNER_TOKEN_MAX_PER_USER:
        raise ValueError(
            f"Maximum number of runner tokens reached ({settings.RUNNER_TOKEN_MAX_PER_USER}). "
            "Please revoke an existing token before creating a new one."
        )

    # Generate token
    plain_token = generate_runner_token()
    token_hash = hash_runner_token(plain_token)

    # Calculate expiration
    expires_at = None
    if expires_in_days:
        expires_at = datetime.utcnow() + timedelta(days=expires_in_days)

    # Create token record
    db_token = RunnerToken(
        user_id=user_id,
        name=name,
        token_hash=token_hash,
        expires_at=expires_at,
    )

    db.add(db_token)
    await db.commit()
    await db.refresh(db_token)

    return db_token, plain_token


async def get_runner_tokens(
    db: AsyncSession,
    user_id: UUID,
    include_revoked: bool = False,
) -> list[tuple[RunnerToken, int]]:
    """
    Get all runner tokens for a user with connection counts.

    Args:
        db: Database session
        user_id: ID of the user
        include_revoked: Whether to include revoked tokens

    Returns:
        List of tuples: (RunnerToken, connection_count)
    """
    # Build query
    query = (
        select(RunnerToken, func.count(RunnerConnection.id).label("connection_count"))
        .outerjoin(RunnerConnection, RunnerToken.id == RunnerConnection.runner_token_id)
        .where(RunnerToken.user_id == user_id)
        .group_by(RunnerToken.id)
        .order_by(RunnerToken.created_at.desc())
    )

    # Filter revoked if needed
    if not include_revoked:
        query = query.where(RunnerToken.is_revoked.is_(False))

    result = await db.execute(query)
    return list(result.all())  # type: ignore[arg-type]


async def get_runner_token_by_id(
    db: AsyncSession,
    token_id: UUID,
    user_id: UUID,
) -> RunnerToken | None:
    """
    Get a specific runner token by ID.

    Args:
        db: Database session
        token_id: ID of the token
        user_id: ID of the user (for authorization)

    Returns:
        RunnerToken or None if not found
    """
    query = select(RunnerToken).where(
        and_(
            RunnerToken.id == token_id,
            RunnerToken.user_id == user_id,
        )
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_runner_token_by_hash(
    db: AsyncSession,
    token_hash: str,
) -> RunnerToken | None:
    """
    Get a runner token by its hash (for authentication).

    Args:
        db: Database session
        token_hash: SHA-256 hash of the token

    Returns:
        RunnerToken or None if not found
    """
    query = select(RunnerToken).where(RunnerToken.token_hash == token_hash)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def validate_runner_token(
    db: AsyncSession,
    plain_token: str,
) -> RunnerToken | None:
    """
    Validate a runner token and return the token record if valid.

    Args:
        db: Database session
        plain_token: The plain text token to validate

    Returns:
        RunnerToken if valid, None otherwise
    """
    # Hash the token
    token_hash = hash_runner_token(plain_token)

    # Get token from database
    token = await get_runner_token_by_hash(db, token_hash)

    if not token:
        return None

    # Check if valid
    if not token.is_valid():
        return None

    return token


async def revoke_runner_token(
    db: AsyncSession,
    token_id: UUID,
    user_id: UUID,
) -> RunnerToken | None:
    """
    Revoke a runner token (soft delete).

    Args:
        db: Database session
        token_id: ID of the token to revoke
        user_id: ID of the user (for authorization)

    Returns:
        Revoked RunnerToken or None if not found
    """
    token = await get_runner_token_by_id(db, token_id, user_id)

    if not token:
        return None

    token.is_revoked = True
    token.revoked_at = datetime.utcnow()

    await db.commit()
    await db.refresh(token)

    return token


async def delete_runner_token(
    db: AsyncSession,
    token_id: UUID,
    user_id: UUID,
) -> bool:
    """
    Permanently delete a runner token (hard delete).

    Args:
        db: Database session
        token_id: ID of the token to delete
        user_id: ID of the user (for authorization)

    Returns:
        True if deleted, False if not found
    """
    token = await get_runner_token_by_id(db, token_id, user_id)

    if not token:
        return False

    await db.delete(token)
    await db.commit()

    return True


async def update_token_last_used(
    db: AsyncSession,
    token_id: UUID,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """
    Update the last_used_at timestamp and metadata for a token.

    Args:
        db: Database session
        token_id: ID of the token
        ip_address: Optional IP address to record
        user_agent: Optional user agent to record
    """
    query = select(RunnerToken).where(RunnerToken.id == token_id)
    result = await db.execute(query)
    token = result.scalar_one_or_none()

    if token:
        token.last_used_at = datetime.utcnow()
        if ip_address:
            token.last_ip_address = ip_address
        if user_agent:
            token.last_user_agent = user_agent
        await db.commit()


async def update_runner_token_name(
    db: AsyncSession,
    token_id: UUID,
    user_id: UUID,
    new_name: str,
) -> RunnerToken | None:
    """
    Update the name of a runner token.

    Args:
        db: Database session
        token_id: ID of the token
        user_id: ID of the user (for authorization)
        new_name: New name for the token

    Returns:
        Updated RunnerToken or None if not found
    """
    token = await get_runner_token_by_id(db, token_id, user_id)

    if not token:
        return None

    token.name = new_name
    await db.commit()
    await db.refresh(token)

    return token


# ============================================================================
# Runner Connection CRUD Operations
# ============================================================================


async def create_connection_record(
    db: AsyncSession,
    user_id: UUID,
    token_id: UUID | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    project_id: UUID | None = None,
    session_id: str | None = None,
    runner_name: str | None = None,
) -> RunnerConnection:
    """
    Log the start of a runner connection.

    Args:
        db: Database session
        user_id: ID of the user
        token_id: Optional ID of the runner token used (None for JWT auth)
        ip_address: Optional IP address
        user_agent: Optional user agent
        project_id: Optional project ID
        session_id: Optional WebSocket session ID
        runner_name: Optional custom name for the runner

    Returns:
        Created RunnerConnection record
    """
    connection = RunnerConnection(
        runner_token_id=token_id,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent,
        project_id=project_id,
        session_id=session_id,
        runner_name=runner_name,
    )

    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    # Also update token's last_used_at if using runner token
    if token_id:
        await update_token_last_used(db, token_id, ip_address, user_agent)

    return connection


async def update_connection_runner_name(
    db: AsyncSession,
    connection_id: int,
    runner_name: str,
) -> RunnerConnection | None:
    """
    Update the runner_name for a connection record.

    Args:
        db: Database session
        connection_id: ID of the connection record
        runner_name: Custom name for the runner

    Returns:
        Updated RunnerConnection or None if not found
    """
    query = select(RunnerConnection).where(RunnerConnection.id == connection_id)
    result = await db.execute(query)
    connection = result.scalar_one_or_none()

    if not connection:
        return None

    connection.runner_name = runner_name
    await db.commit()
    await db.refresh(connection)

    return connection


async def close_connection_record(
    db: AsyncSession,
    connection_id: int,
) -> RunnerConnection | None:
    """
    Log the end of a runner connection.

    Args:
        db: Database session
        connection_id: ID of the connection record

    Returns:
        Updated RunnerConnection or None if not found
    """
    query = select(RunnerConnection).where(RunnerConnection.id == connection_id)
    result = await db.execute(query)
    connection = result.scalar_one_or_none()

    if not connection:
        return None

    connection.disconnected_at = datetime.utcnow()
    connection.calculate_duration()

    await db.commit()
    await db.refresh(connection)

    return connection


async def get_connection_history(
    db: AsyncSession,
    user_id: UUID,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[RunnerConnection], int]:
    """
    Get paginated connection history for a user.

    Args:
        db: Database session
        user_id: ID of the user
        limit: Maximum number of records to return
        offset: Number of records to skip

    Returns:
        Tuple of (list of connections, total count)
    """
    # Get total count
    count_query = select(func.count(RunnerConnection.id)).where(
        RunnerConnection.user_id == user_id
    )
    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    # Get paginated connections
    query = (
        select(RunnerConnection)
        .where(RunnerConnection.user_id == user_id)
        .order_by(RunnerConnection.connected_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    connections = list(result.scalars().all())

    return connections, total


async def get_active_connections(
    db: AsyncSession,
    user_id: UUID,
) -> list[RunnerConnection]:
    """
    Get currently active connections for a user.

    Args:
        db: Database session
        user_id: ID of the user

    Returns:
        List of active RunnerConnection records
    """
    query = (
        select(RunnerConnection)
        .where(
            and_(
                RunnerConnection.user_id == user_id,
                RunnerConnection.disconnected_at.is_(None),
            )
        )
        .order_by(RunnerConnection.connected_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_active_connection_for_project(
    db: AsyncSession,
    project_id: UUID,
) -> RunnerConnection | None:
    """
    Get the active runner connection for a specific project.

    Args:
        db: Database session
        project_id: ID of the project

    Returns:
        Active RunnerConnection record if found, None otherwise
    """
    query = (
        select(RunnerConnection)
        .where(
            and_(
                RunnerConnection.project_id == project_id,
                RunnerConnection.disconnected_at.is_(None),
            )
        )
        .order_by(RunnerConnection.connected_at.desc())
    )
    result = await db.execute(query)
    return result.scalars().first()


async def close_orphaned_connections(
    db: AsyncSession,
    user_id: UUID,
    exclude_connection_id: int | None = None,
    runner_token_id: UUID | None = None,
) -> list[int]:
    """
    Close any orphaned connections for a user, optionally filtered by runner token.

    This is used to clean up stale connections that weren't properly closed
    (e.g., due to network issues or crashes). Called when a new connection
    is established to ensure only one active connection per runner token.

    Args:
        db: Database session
        user_id: ID of the user
        exclude_connection_id: Optional connection ID to exclude from closing
        runner_token_id: Optional runner token ID to filter by (only close connections
                        from the same runner token, not all user connections)

    Returns:
        List of connection IDs that were closed
    """
    # Build the query to find orphaned connections
    conditions = [
        RunnerConnection.user_id == user_id,
        RunnerConnection.disconnected_at.is_(None),
    ]

    # If runner_token_id is provided, only close connections from the same token
    # This prevents closing connections from other runner devices
    if runner_token_id is not None:
        conditions.append(RunnerConnection.runner_token_id == runner_token_id)

    if exclude_connection_id is not None:
        conditions.append(RunnerConnection.id != exclude_connection_id)

    query = select(RunnerConnection).where(and_(*conditions))
    result = await db.execute(query)
    orphaned = list(result.scalars().all())

    closed_ids: list[int] = []
    for conn in orphaned:
        conn.disconnected_at = datetime.utcnow()
        conn.calculate_duration()
        closed_ids.append(conn.id)

    if closed_ids:
        await db.commit()

    return closed_ids


async def get_connection_by_session_id(
    db: AsyncSession,
    session_id: str,
) -> RunnerConnection | None:
    """
    Get a connection record by WebSocket session ID.

    Args:
        db: Database session
        session_id: WebSocket session ID

    Returns:
        RunnerConnection or None if not found
    """
    query = select(RunnerConnection).where(RunnerConnection.session_id == session_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def create_test_connection(
    db: AsyncSession,
    user_id: UUID,
    token_id: UUID | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> RunnerConnection:
    """
    Create a test connection record (immediately closed).

    This is used when the runner tests its connection settings.
    The connection is created and immediately marked as disconnected
    with a duration of 0 seconds.

    Args:
        db: Database session
        user_id: ID of the user
        token_id: Optional ID of the runner token used
        ip_address: Optional IP address
        user_agent: Optional user agent

    Returns:
        Created and closed RunnerConnection record
    """
    connection = RunnerConnection(
        runner_token_id=token_id,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent,
        disconnected_at=datetime.utcnow(),
        duration_seconds=0,
    )

    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    # Update token's last_used_at if using runner token
    if token_id:
        await update_token_last_used(db, token_id, ip_address, user_agent)

    return connection


async def get_runner_token_stats(
    db: AsyncSession,
    user_id: UUID,
) -> dict:
    """
    Get statistics about runner tokens and connections for a user.

    Args:
        db: Database session
        user_id: ID of the user

    Returns:
        Dictionary with statistics
    """
    # Count tokens by status
    tokens_query = select(
        func.count(RunnerToken.id).label("total"),
        func.count(RunnerToken.id)
        .filter(RunnerToken.is_revoked.is_(False))
        .label("active"),
        func.count(RunnerToken.id)
        .filter(RunnerToken.is_revoked.is_(True))
        .label("revoked"),
        func.count(RunnerToken.id)
        .filter(
            and_(
                RunnerToken.expires_at.isnot(None),
                RunnerToken.expires_at < datetime.utcnow(),
                RunnerToken.is_revoked.is_(False),
            )
        )
        .label("expired"),
    ).where(RunnerToken.user_id == user_id)

    tokens_result = await db.execute(tokens_query)
    tokens_stats = tokens_result.one()

    # Count connections
    connections_query = select(
        func.count(RunnerConnection.id).label("total"),
        func.count(RunnerConnection.id)
        .filter(RunnerConnection.disconnected_at.is_(None))
        .label("active"),
        func.max(RunnerConnection.connected_at).label("most_recent"),
    ).where(RunnerConnection.user_id == user_id)

    connections_result = await db.execute(connections_query)
    connections_stats = connections_result.one()

    return {
        "total_tokens": tokens_stats.total or 0,
        "active_tokens": tokens_stats.active or 0,
        "revoked_tokens": tokens_stats.revoked or 0,
        "expired_tokens": tokens_stats.expired or 0,
        "total_connections": connections_stats.total or 0,
        "active_connections": connections_stats.active or 0,
        "most_recent_connection": connections_stats.most_recent,
    }
