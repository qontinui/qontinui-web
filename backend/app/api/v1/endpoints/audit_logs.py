"""
Audit log query endpoints for admins.

Provides comprehensive audit log querying capabilities for:
- Viewing all audit logs with filtering
- Querying logs by user
- Querying logs by resource
- Getting audit statistics

All endpoints are admin-only for security compliance.
"""

from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.api.deps import get_async_db, get_current_superuser_async
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.audit import AuditLogListResponse, AuditLogResponse, AuditLogStatsResponse

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/", response_model=AuditLogListResponse)
async def list_audit_logs(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_superuser_async),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    user_id: Optional[UUID] = Query(None, description="Filter by user who performed action"),
    target_user_id: Optional[UUID] = Query(None, description="Filter by user affected by action"),
    action: Optional[str] = Query(None, description="Filter by action"),
    resource_type: Optional[str] = Query(None, description="Filter by resource type"),
    resource_id: Optional[str] = Query(None, description="Filter by resource ID"),
    event_category: Optional[str] = Query(None, description="Filter by event category"),
    correlation_id: Optional[str] = Query(None, description="Filter by correlation ID"),
    start_date: Optional[datetime] = Query(None, description="Filter events after this date"),
    end_date: Optional[datetime] = Query(None, description="Filter events before this date"),
) -> Any:
    """
    List audit logs with comprehensive filtering (admin only).

    Supports filtering by:
    - User who performed action
    - User affected by action
    - Action type
    - Resource type and ID
    - Event category
    - Correlation ID (to trace related events)
    - Date range

    Returns paginated results with user information enriched.
    """
    logger.info(
        "list_audit_logs_request",
        admin_user_id=current_user.id,
        filters={
            "user_id": user_id,
            "target_user_id": target_user_id,
            "action": action,
            "resource_type": resource_type,
            "event_category": event_category,
        },
    )

    # Build query with filters
    query = select(AuditLog).options(
        joinedload(AuditLog.user),
        joinedload(AuditLog.target_user),
    )

    # Apply filters
    conditions = []
    if user_id:
        conditions.append(AuditLog.user_id == user_id)
    if target_user_id:
        conditions.append(AuditLog.target_user_id == target_user_id)
    if action:
        conditions.append(AuditLog.action == action)
    if resource_type:
        conditions.append(AuditLog.resource_type == resource_type)
    if resource_id:
        conditions.append(AuditLog.resource_id == resource_id)
    if event_category:
        conditions.append(AuditLog.event_category == event_category)
    if correlation_id:
        conditions.append(AuditLog.correlation_id == correlation_id)
    if start_date:
        conditions.append(AuditLog.created_at >= start_date)
    if end_date:
        conditions.append(AuditLog.created_at <= end_date)

    if conditions:
        query = query.where(and_(*conditions))

    # Get total count
    count_query = select(func.count()).select_from(AuditLog)
    if conditions:
        count_query = count_query.where(and_(*conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Get paginated results
    query = query.order_by(desc(AuditLog.created_at)).offset(skip).limit(limit)
    result = await db.execute(query)
    audit_logs = result.unique().scalars().all()

    # Build response with enriched user data
    log_responses = []
    for log in audit_logs:
        response = AuditLogResponse.model_validate(log)

        # Enrich with user data
        if log.user:
            response.user_email = log.user.email
            response.user_username = log.user.username

        if log.target_user:
            response.target_user_email = log.target_user.email
            response.target_user_username = log.target_user.username

        log_responses.append(response)

    logger.info(
        "list_audit_logs_response",
        total=total,
        returned=len(log_responses),
        skip=skip,
        limit=limit,
    )

    return AuditLogListResponse(
        total=total,
        logs=log_responses,
        skip=skip,
        limit=limit,
    )


@router.get("/user/{user_id}", response_model=AuditLogListResponse)
async def get_user_audit_logs(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_superuser_async),
    user_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    event_category: Optional[str] = Query(None, description="Filter by event category"),
    start_date: Optional[datetime] = Query(None, description="Filter events after this date"),
    end_date: Optional[datetime] = Query(None, description="Filter events before this date"),
) -> Any:
    """
    Get audit logs for a specific user (admin only).

    Returns all logs where the user either:
    - Performed the action (user_id)
    - Was affected by the action (target_user_id)

    Useful for investigating a specific user's activity or changes made to their account.
    """
    logger.info(
        "get_user_audit_logs_request",
        admin_user_id=current_user.id,
        target_user_id=user_id,
    )

    # Build query - include both user_id and target_user_id
    query = select(AuditLog).options(
        joinedload(AuditLog.user),
        joinedload(AuditLog.target_user),
    )

    conditions = [
        or_(
            AuditLog.user_id == user_id,
            AuditLog.target_user_id == user_id,
        )
    ]

    # Apply additional filters
    if event_category:
        conditions.append(AuditLog.event_category == event_category)
    if start_date:
        conditions.append(AuditLog.created_at >= start_date)
    if end_date:
        conditions.append(AuditLog.created_at <= end_date)

    query = query.where(and_(*conditions))

    # Get total count
    count_query = select(func.count()).select_from(AuditLog).where(and_(*conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Get paginated results
    query = query.order_by(desc(AuditLog.created_at)).offset(skip).limit(limit)
    result = await db.execute(query)
    audit_logs = result.unique().scalars().all()

    # Build response with enriched user data
    log_responses = []
    for log in audit_logs:
        response = AuditLogResponse.model_validate(log)

        if log.user:
            response.user_email = log.user.email
            response.user_username = log.user.username

        if log.target_user:
            response.target_user_email = log.target_user.email
            response.target_user_username = log.target_user.username

        log_responses.append(response)

    logger.info(
        "get_user_audit_logs_response",
        user_id=user_id,
        total=total,
        returned=len(log_responses),
    )

    return AuditLogListResponse(
        total=total,
        logs=log_responses,
        skip=skip,
        limit=limit,
    )


@router.get("/resource/{resource_type}/{resource_id}", response_model=AuditLogListResponse)
async def get_resource_audit_logs(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_superuser_async),
    resource_type: str,
    resource_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    event_category: Optional[str] = Query(None, description="Filter by event category"),
    start_date: Optional[datetime] = Query(None, description="Filter events after this date"),
    end_date: Optional[datetime] = Query(None, description="Filter events before this date"),
) -> Any:
    """
    Get audit logs for a specific resource (admin only).

    Returns all audit events affecting a particular resource.

    Example:
        GET /api/v1/admin/audit-logs/resource/project/123
        Returns all audit events for project ID 123

    Useful for investigating:
    - Who accessed a project
    - Permission changes on a resource
    - Resource modification history
    """
    logger.info(
        "get_resource_audit_logs_request",
        admin_user_id=current_user.id,
        resource_type=resource_type,
        resource_id=resource_id,
    )

    # Build query
    query = select(AuditLog).options(
        joinedload(AuditLog.user),
        joinedload(AuditLog.target_user),
    )

    conditions = [
        AuditLog.resource_type == resource_type,
        AuditLog.resource_id == resource_id,
    ]

    # Apply additional filters
    if event_category:
        conditions.append(AuditLog.event_category == event_category)
    if start_date:
        conditions.append(AuditLog.created_at >= start_date)
    if end_date:
        conditions.append(AuditLog.created_at <= end_date)

    query = query.where(and_(*conditions))

    # Get total count
    count_query = select(func.count()).select_from(AuditLog).where(and_(*conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Get paginated results
    query = query.order_by(desc(AuditLog.created_at)).offset(skip).limit(limit)
    result = await db.execute(query)
    audit_logs = result.unique().scalars().all()

    # Build response with enriched user data
    log_responses = []
    for log in audit_logs:
        response = AuditLogResponse.model_validate(log)

        if log.user:
            response.user_email = log.user.email
            response.user_username = log.user.username

        if log.target_user:
            response.target_user_email = log.target_user.email
            response.target_user_username = log.target_user.username

        log_responses.append(response)

    logger.info(
        "get_resource_audit_logs_response",
        resource_type=resource_type,
        resource_id=resource_id,
        total=total,
        returned=len(log_responses),
    )

    return AuditLogListResponse(
        total=total,
        logs=log_responses,
        skip=skip,
        limit=limit,
    )


@router.get("/stats", response_model=AuditLogStatsResponse)
async def get_audit_stats(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_superuser_async),
) -> Any:
    """
    Get audit log statistics (admin only).

    Returns:
    - Total event count
    - Events grouped by category
    - Events grouped by action
    - Recent activity counts (24h, 7d)
    - Top active users

    Useful for:
    - Security dashboards
    - Compliance reporting
    - Activity monitoring
    """
    logger.info("get_audit_stats_request", admin_user_id=current_user.id)

    # Total events
    total_result = await db.execute(select(func.count()).select_from(AuditLog))
    total_events = total_result.scalar_one()

    # Events by category
    category_query = select(
        AuditLog.event_category,
        func.count().label("count")
    ).group_by(AuditLog.event_category)
    category_result = await db.execute(category_query)
    events_by_category = {
        row[0] or "uncategorized": row[1]
        for row in category_result.all()
    }

    # Events by action (top 20)
    action_query = select(
        AuditLog.action,
        func.count().label("count")
    ).group_by(AuditLog.action).order_by(desc("count")).limit(20)
    action_result = await db.execute(action_query)
    events_by_action = {
        row[0]: row[1]
        for row in action_result.all()
    }

    # Recent events (24 hours)
    now = datetime.utcnow()
    twenty_four_hours_ago = now - timedelta(hours=24)
    recent_24h_query = select(func.count()).select_from(AuditLog).where(
        AuditLog.created_at >= twenty_four_hours_ago
    )
    recent_24h_result = await db.execute(recent_24h_query)
    recent_events_24h = recent_24h_result.scalar_one()

    # Recent events (7 days)
    seven_days_ago = now - timedelta(days=7)
    recent_7d_query = select(func.count()).select_from(AuditLog).where(
        AuditLog.created_at >= seven_days_ago
    )
    recent_7d_result = await db.execute(recent_7d_query)
    recent_events_7d = recent_7d_result.scalar_one()

    # Top users (by event count, top 10)
    top_users_query = select(
        AuditLog.user_id,
        User.email,
        User.username,
        func.count().label("event_count")
    ).join(User, AuditLog.user_id == User.id).group_by(
        AuditLog.user_id, User.email, User.username
    ).order_by(desc("event_count")).limit(10)

    top_users_result = await db.execute(top_users_query)
    top_users = [
        {
            "user_id": str(row[0]),
            "email": row[1],
            "username": row[2],
            "event_count": row[3],
        }
        for row in top_users_result.all()
    ]

    logger.info(
        "get_audit_stats_response",
        total_events=total_events,
        categories=len(events_by_category),
        actions=len(events_by_action),
    )

    return AuditLogStatsResponse(
        total_events=total_events,
        events_by_category=events_by_category,
        events_by_action=events_by_action,
        recent_events_24h=recent_events_24h,
        recent_events_7d=recent_events_7d,
        top_users=top_users,
    )
