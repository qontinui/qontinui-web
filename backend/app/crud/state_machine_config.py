"""CRUD operations for state machine configuration management."""

from uuid import UUID

import structlog
from app.models.state_machine_config import StateMachineConfig
from app.schemas.state_machine_config import (
    StateMachineConfigCreate,
    StateMachineConfigUpdate,
)
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


async def create_config(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
    data: StateMachineConfigCreate,
) -> StateMachineConfig:
    """Create a new state machine config."""
    config = StateMachineConfig(
        project_id=project_id,
        created_by=user_id,
        name=data.name,
        description=data.description,
        configuration=data.configuration,
        tags=data.tags or [],
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)

    logger.info(
        "state_machine_config_created",
        config_id=str(config.id),
        project_id=str(project_id),
    )
    return config


async def get_config(
    db: AsyncSession, project_id: UUID, config_id: UUID
) -> StateMachineConfig | None:
    """Get a config by ID, scoped to project."""
    result = await db.execute(
        select(StateMachineConfig).where(
            StateMachineConfig.id == config_id,
            StateMachineConfig.project_id == project_id,
        )
    )
    return result.scalar_one_or_none()


async def update_config(
    db: AsyncSession,
    config: StateMachineConfig,
    data: StateMachineConfigUpdate,
) -> StateMachineConfig:
    """Update a config with partial data."""
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    await db.commit()
    await db.refresh(config)

    logger.info("state_machine_config_updated", config_id=str(config.id))
    return config


async def delete_config(db: AsyncSession, config: StateMachineConfig) -> bool:
    """Delete a config."""
    config_id = str(config.id)
    await db.delete(config)
    await db.commit()
    logger.info("state_machine_config_deleted", config_id=config_id)
    return True


async def list_configs(
    db: AsyncSession, project_id: UUID, skip: int = 0, limit: int = 50
) -> tuple[list[StateMachineConfig], int]:
    """List configs for a project with pagination."""
    # Count
    count_result = await db.execute(
        select(func.count())
        .select_from(StateMachineConfig)
        .where(StateMachineConfig.project_id == project_id)
    )
    total = count_result.scalar_one()

    # Fetch
    result = await db.execute(
        select(StateMachineConfig)
        .where(StateMachineConfig.project_id == project_id)
        .order_by(desc(StateMachineConfig.updated_at))
        .offset(skip)
        .limit(limit)
    )
    configs = list(result.scalars().all())

    return configs, total
