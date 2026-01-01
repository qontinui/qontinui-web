"""
CRUD operations for discoveries.

Provides database operations for discoveries from runners.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.discovery import Discovery
from app.schemas.discovery import (
    DiscoveryAcceptRequest,
    DiscoveryCreate,
    DiscoveryFromRunner,
    DiscoveryRejectRequest,
    DiscoveryStats,
    DiscoveryUpdate,
)


async def create_discovery(
    db: AsyncSession,
    user_id: UUID,
    discovery_data: DiscoveryCreate,
) -> Discovery:
    """Create a new discovery."""
    discovery = Discovery(
        user_id=user_id,
        project_id=discovery_data.project_id,
        runner_id=discovery_data.runner_id,
        runner_name=discovery_data.runner_name,
        config_id=discovery_data.config_id,
        config_name=discovery_data.config_name,
        discovery_type=discovery_data.discovery_type,
        title=discovery_data.title,
        description=discovery_data.description,
        discovery_data=discovery_data.discovery_data,
        evidence=discovery_data.evidence,
        confidence=discovery_data.confidence,
        runs_observed=discovery_data.runs_observed,
        status="pending",
    )
    db.add(discovery)
    await db.commit()
    await db.refresh(discovery)
    return discovery


async def create_discovery_from_runner(
    db: AsyncSession,
    user_id: UUID,
    runner_data: DiscoveryFromRunner,
) -> Discovery:
    """Create a discovery from runner submission."""
    discovery = Discovery(
        user_id=user_id,
        project_id=runner_data.project_id,
        runner_id=runner_data.runner_id,
        runner_name=runner_data.runner_name,
        config_id=runner_data.config_id,
        config_name=runner_data.config_name,
        discovery_type=runner_data.discovery_type,
        title=runner_data.title,
        description=runner_data.description,
        discovery_data=runner_data.discovery_data,
        evidence=runner_data.evidence,
        confidence=runner_data.confidence,
        runs_observed=runner_data.runs_observed,
        status="pending",
    )
    db.add(discovery)
    await db.commit()
    await db.refresh(discovery)
    return discovery


async def get_discovery(
    db: AsyncSession,
    discovery_id: UUID,
) -> Discovery | None:
    """Get a discovery by ID."""
    result = await db.execute(select(Discovery).filter(Discovery.id == discovery_id))
    return result.scalar_one_or_none()


async def get_discovery_by_user(
    db: AsyncSession,
    discovery_id: UUID,
    user_id: UUID,
) -> Discovery | None:
    """Get a discovery by ID, ensuring it belongs to the user."""
    result = await db.execute(
        select(Discovery).filter(
            Discovery.id == discovery_id,
            Discovery.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def list_discoveries(
    db: AsyncSession,
    user_id: UUID,
    skip: int = 0,
    limit: int = 50,
    project_id: UUID | None = None,
    status: str | None = None,
    discovery_type: str | None = None,
    config_id: str | None = None,
) -> tuple[list[Discovery], int]:
    """
    List discoveries with filtering.

    Returns:
        tuple of (discoveries, total_count)
    """
    query = select(Discovery).filter(Discovery.user_id == user_id)

    if project_id:
        query = query.filter(Discovery.project_id == project_id)

    if status:
        query = query.filter(Discovery.status == status)

    if discovery_type:
        query = query.filter(Discovery.discovery_type == discovery_type)

    if config_id:
        query = query.filter(Discovery.config_id == config_id)

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Order by created_at descending (most recent first)
    query = query.order_by(desc(Discovery.created_at)).offset(skip).limit(limit)
    result = await db.execute(query)
    discoveries = list(result.scalars().all())

    return discoveries, total


async def update_discovery(
    db: AsyncSession,
    discovery_id: UUID,
    user_id: UUID,
    update_data: DiscoveryUpdate,
) -> Discovery | None:
    """Update a discovery."""
    discovery = await get_discovery_by_user(db, discovery_id, user_id)
    if not discovery:
        return None

    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        if value is not None:
            setattr(discovery, key, value)

    await db.commit()
    await db.refresh(discovery)
    return discovery


async def accept_discovery(
    db: AsyncSession,
    discovery_id: UUID,
    user_id: UUID,
    request: DiscoveryAcceptRequest,
) -> Discovery | None:
    """
    Accept a discovery.

    If apply_to_config is True, the discovery will be applied to the project
    configuration using the DiscoveryApplier service.
    """
    discovery = await get_discovery_by_user(db, discovery_id, user_id)
    if not discovery:
        return None

    discovery.status = "accepted"
    discovery.reviewed_at = datetime.now(UTC)
    discovery.reviewed_by_id = user_id
    if request.user_notes:
        discovery.user_notes = request.user_notes

    # Apply to config if requested
    if request.apply_to_config:
        from app.services.discovery_applier import DiscoveryApplier

        applied = await DiscoveryApplier.apply_discovery(
            db=db,
            discovery=discovery,
            user_id=user_id,
            create_version_snapshot=True,
        )
        discovery.applied_to_config = applied
    else:
        discovery.applied_to_config = False

    await db.commit()
    await db.refresh(discovery)
    return discovery


async def reject_discovery(
    db: AsyncSession,
    discovery_id: UUID,
    user_id: UUID,
    request: DiscoveryRejectRequest,
) -> Discovery | None:
    """Reject a discovery."""
    discovery = await get_discovery_by_user(db, discovery_id, user_id)
    if not discovery:
        return None

    discovery.status = "rejected"
    discovery.reviewed_at = datetime.now(UTC)
    discovery.reviewed_by_id = user_id
    if request.user_notes:
        discovery.user_notes = request.user_notes

    await db.commit()
    await db.refresh(discovery)
    return discovery


async def defer_discovery(
    db: AsyncSession,
    discovery_id: UUID,
    user_id: UUID,
    user_notes: str | None = None,
) -> Discovery | None:
    """Defer a discovery for later review."""
    discovery = await get_discovery_by_user(db, discovery_id, user_id)
    if not discovery:
        return None

    discovery.status = "deferred"
    discovery.reviewed_at = datetime.now(UTC)
    discovery.reviewed_by_id = user_id
    if user_notes:
        discovery.user_notes = user_notes

    await db.commit()
    await db.refresh(discovery)
    return discovery


async def get_pending_count(
    db: AsyncSession,
    user_id: UUID,
    project_id: UUID | None = None,
) -> int:
    """Get count of pending discoveries."""
    query = (
        select(func.count())
        .select_from(Discovery)
        .filter(
            Discovery.user_id == user_id,
            Discovery.status == "pending",
        )
    )

    if project_id:
        query = query.filter(Discovery.project_id == project_id)

    result = await db.execute(query)
    return result.scalar_one()


async def get_discovery_stats(
    db: AsyncSession,
    user_id: UUID,
    project_id: UUID | None = None,
) -> DiscoveryStats:
    """Get aggregated discovery statistics."""
    query = select(Discovery).filter(Discovery.user_id == user_id)

    if project_id:
        query = query.filter(Discovery.project_id == project_id)

    result = await db.execute(query)
    discoveries = list(result.scalars().all())

    # Calculate stats
    by_type: dict[str, int] = {}
    pending = 0
    accepted = 0
    rejected = 0
    deferred = 0

    for discovery in discoveries:
        # Count by type
        by_type[discovery.discovery_type] = by_type.get(discovery.discovery_type, 0) + 1

        # Count by status
        if discovery.status == "pending":
            pending += 1
        elif discovery.status == "accepted":
            accepted += 1
        elif discovery.status == "rejected":
            rejected += 1
        elif discovery.status == "deferred":
            deferred += 1

    return DiscoveryStats(
        total=len(discoveries),
        pending=pending,
        accepted=accepted,
        rejected=rejected,
        deferred=deferred,
        by_type=by_type,
    )


async def delete_discovery(
    db: AsyncSession,
    discovery_id: UUID,
    user_id: UUID,
) -> bool:
    """Delete a discovery."""
    discovery = await get_discovery_by_user(db, discovery_id, user_id)
    if not discovery:
        return False

    await db.delete(discovery)
    await db.commit()
    return True
