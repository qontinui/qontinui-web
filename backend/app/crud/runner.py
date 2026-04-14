"""
CRUD operations for runner connections.

This module provides database operations for tracking runner connection history.
"""

from uuid import UUID

from app.models.runner_connection import RunnerConnection
from qontinui_schemas.common import utc_now
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def create_connection_record(
    db: AsyncSession,
    user_id: UUID,
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
        ip_address: Optional IP address
        user_agent: Optional user agent
        project_id: Optional project ID
        session_id: Optional WebSocket session ID
        runner_name: Optional custom name for the runner

    Returns:
        Created RunnerConnection record
    """
    connection = RunnerConnection(
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


async def update_connection_runner_port(
    db: AsyncSession,
    connection_id: int,
    runner_port: int,
) -> RunnerConnection | None:
    """
    Update the runner_port for a connection record.

    Args:
        db: Database session
        connection_id: ID of the connection record
        runner_port: HTTP API port the runner is listening on

    Returns:
        Updated RunnerConnection or None if not found
    """
    query = select(RunnerConnection).where(RunnerConnection.id == connection_id)
    result = await db.execute(query)
    connection = result.scalar_one_or_none()

    if not connection:
        return None

    connection.runner_port = runner_port
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

    connection.disconnected_at = utc_now()
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
) -> list[int]:
    """
    Close any orphaned connections for a user.

    This is used to clean up stale connections that weren't properly closed
    (e.g., due to network issues or crashes).

    Args:
        db: Database session
        user_id: ID of the user
        exclude_connection_id: Optional connection ID to exclude from closing

    Returns:
        List of connection IDs that were closed
    """
    conditions = [
        RunnerConnection.user_id == user_id,
        RunnerConnection.disconnected_at.is_(None),
    ]

    if exclude_connection_id is not None:
        conditions.append(RunnerConnection.id != exclude_connection_id)

    query = select(RunnerConnection).where(and_(*conditions))
    result = await db.execute(query)
    orphaned = list(result.scalars().all())

    closed_ids: list[int] = []
    for conn in orphaned:
        conn.disconnected_at = utc_now()
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
