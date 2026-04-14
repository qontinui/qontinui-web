from uuid import UUID

from app.models.edit_command import EditCommand
from app.models.project_version import ProjectVersion
from app.schemas.version import EditCommandCreate, ProjectVersionCreate
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession


# ProjectVersion CRUD operations
async def get_version(db: AsyncSession, version_id: UUID) -> ProjectVersion | None:
    """Get a specific version by ID"""
    result = await db.execute(
        select(ProjectVersion).filter(ProjectVersion.id == version_id)
    )
    return result.scalar_one_or_none()


async def get_version_by_number(
    db: AsyncSession, project_id: UUID, version_number: int
) -> ProjectVersion | None:
    """Get a specific version by project ID and version number"""
    result = await db.execute(
        select(ProjectVersion).filter(
            ProjectVersion.project_id == project_id,
            ProjectVersion.version_number == version_number,
        )
    )
    return result.scalar_one_or_none()


async def get_versions_by_project(
    db: AsyncSession, project_id: UUID, skip: int = 0, limit: int = 100
) -> list[ProjectVersion]:
    """Get all versions for a project (ordered by version number descending)"""
    result = await db.execute(
        select(ProjectVersion)
        .filter(ProjectVersion.project_id == project_id)
        .order_by(desc(ProjectVersion.version_number))
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_latest_version(
    db: AsyncSession, project_id: UUID
) -> ProjectVersion | None:
    """Get the most recent version for a project"""
    result = await db.execute(
        select(ProjectVersion)
        .filter(ProjectVersion.project_id == project_id)
        .order_by(desc(ProjectVersion.version_number))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_version_count(db: AsyncSession, project_id: UUID) -> int:
    """Count total versions for a project"""
    result = await db.execute(
        select(func.count(ProjectVersion.id)).filter(
            ProjectVersion.project_id == project_id
        )
    )
    return result.scalar() or 0


async def create_version(
    db: AsyncSession, version_data: ProjectVersionCreate, created_by: UUID | None
) -> ProjectVersion:
    """Create a new version snapshot"""
    db_version = ProjectVersion(
        project_id=version_data.project_id,
        version_number=version_data.version_number,
        snapshot=version_data.snapshot,
        created_by=created_by,
        comment=version_data.comment,
    )
    db.add(db_version)
    await db.commit()
    await db.refresh(db_version)
    return db_version


async def delete_old_versions(
    db: AsyncSession, project_id: UUID, keep_count: int = 10
) -> int:
    """Delete old versions, keeping only the most recent N versions"""
    # Get versions to delete (all except the most recent keep_count)
    subquery = (
        select(ProjectVersion.id)
        .filter(ProjectVersion.project_id == project_id)
        .order_by(desc(ProjectVersion.version_number))
        .offset(keep_count)
    )

    result = await db.execute(subquery)
    versions_to_delete = result.scalars().all()

    if not versions_to_delete:
        return 0

    # Delete old versions
    delete_result = await db.execute(
        select(ProjectVersion).filter(ProjectVersion.id.in_(versions_to_delete))
    )
    versions = delete_result.scalars().all()

    for version in versions:
        await db.delete(version)

    await db.commit()
    return len(versions)


# EditCommand CRUD operations
async def get_command(db: AsyncSession, command_id: UUID) -> EditCommand | None:
    """Get a specific command by ID"""
    result = await db.execute(select(EditCommand).filter(EditCommand.id == command_id))
    return result.scalar_one_or_none()


async def get_commands_by_project(
    db: AsyncSession, project_id: UUID, skip: int = 0, limit: int = 100
) -> list[EditCommand]:
    """Get command history for a project (ordered by sequence number)"""
    result = await db.execute(
        select(EditCommand)
        .filter(EditCommand.project_id == project_id)
        .order_by(EditCommand.sequence_number)
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_command_count(db: AsyncSession, project_id: UUID) -> int:
    """Count total commands for a project"""
    result = await db.execute(
        select(func.count(EditCommand.id)).filter(EditCommand.project_id == project_id)
    )
    return result.scalar() or 0


async def get_next_sequence_number(db: AsyncSession, project_id: UUID) -> int:
    """Get the next sequence number for a project"""
    result = await db.execute(
        select(func.max(EditCommand.sequence_number)).filter(
            EditCommand.project_id == project_id
        )
    )
    max_seq = result.scalar()
    return (max_seq or 0) + 1


async def create_command(
    db: AsyncSession, command_data: EditCommandCreate, user_id: UUID | None
) -> EditCommand:
    """Create a new edit command"""
    sequence_number = await get_next_sequence_number(db, command_data.project_id)

    db_command = EditCommand(
        project_id=command_data.project_id,
        user_id=user_id,
        command_type=command_data.command_type,
        entity_type=command_data.entity_type,
        entity_id=command_data.entity_id,
        payload=command_data.payload,
        sequence_number=sequence_number,
    )
    db.add(db_command)
    await db.commit()
    await db.refresh(db_command)
    return db_command
