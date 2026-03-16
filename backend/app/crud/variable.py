"""
CRUD operations for workflow variables.

Provides database operations for:
- Creating, reading, updating, and deleting variables
- Recording variable changes in history
- Querying variable history
"""

import uuid
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workflow_variable import VariableHistory, WorkflowVariable
from app.models.workflow_variable import VariableScope as ModelVariableScope
from app.schemas.variable import VariableCreate, VariableScope, VariableUpdate

logger = structlog.get_logger(__name__)


async def create_variable(
    db: AsyncSession,
    variable_data: VariableCreate,
    project_id: UUID,
    workflow_id: UUID | None = None,
) -> WorkflowVariable:
    """
    Create a new workflow variable.

    Args:
        db: Database session
        variable_data: Variable creation data
        project_id: Project ID
        workflow_id: Optional workflow ID (required for WORKFLOW scope)

    Returns:
        Created WorkflowVariable instance

    Raises:
        ValueError: If workflow_id is missing for WORKFLOW scope
    """
    if variable_data.scope == VariableScope.WORKFLOW and workflow_id is None:
        raise ValueError("workflow_id is required for WORKFLOW scope variables")

    # Convert schema enum to model enum
    model_scope = (
        ModelVariableScope.WORKFLOW
        if variable_data.scope == VariableScope.WORKFLOW
        else ModelVariableScope.GLOBAL
    )

    db_variable = WorkflowVariable(
        id=str(uuid.uuid4()),
        project_id=project_id,
        workflow_id=(
            workflow_id if variable_data.scope == VariableScope.WORKFLOW else None
        ),
        name=variable_data.name,
        value=variable_data.value,
        scope=model_scope,
        description=variable_data.description,
    )

    db.add(db_variable)
    await db.commit()
    await db.refresh(db_variable)

    logger.info(
        "variable_created",
        variable_id=str(db_variable.id),
        name=variable_data.name,
        scope=variable_data.scope,
        project_id=str(project_id),
        workflow_id=str(workflow_id) if workflow_id else None,
    )

    return db_variable


async def get_variable(
    db: AsyncSession,
    project_id: UUID,
    name: str,
    workflow_id: UUID | None = None,
) -> WorkflowVariable | None:
    """
    Get a variable by name and scope.

    Args:
        db: Database session
        project_id: Project ID
        name: Variable name
        workflow_id: Optional workflow ID (for workflow-scoped variables)

    Returns:
        WorkflowVariable instance or None if not found
    """
    if workflow_id is None:
        # Get global variable
        query = select(WorkflowVariable).where(
            and_(
                WorkflowVariable.project_id == project_id,
                WorkflowVariable.name == name,
                WorkflowVariable.scope == ModelVariableScope.GLOBAL,
            )
        )
    else:
        # Get workflow variable
        query = select(WorkflowVariable).where(
            and_(
                WorkflowVariable.project_id == project_id,
                WorkflowVariable.workflow_id == workflow_id,
                WorkflowVariable.name == name,
                WorkflowVariable.scope == ModelVariableScope.WORKFLOW,
            )
        )

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_variable_by_id(
    db: AsyncSession, variable_id: UUID
) -> WorkflowVariable | None:
    """
    Get a variable by its ID.

    Args:
        db: Database session
        variable_id: Variable ID

    Returns:
        WorkflowVariable instance or None if not found
    """
    result = await db.execute(
        select(WorkflowVariable).where(WorkflowVariable.id == variable_id)
    )
    return result.scalar_one_or_none()


async def list_variables(
    db: AsyncSession,
    project_id: UUID,
    workflow_id: UUID | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[WorkflowVariable], int]:
    """
    List variables with pagination.

    Args:
        db: Database session
        project_id: Project ID
        workflow_id: Optional workflow ID (if None, returns global variables)
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (variables list, total count)
    """
    if workflow_id is None:
        # List global variables
        base_query = select(WorkflowVariable).where(
            and_(
                WorkflowVariable.project_id == project_id,
                WorkflowVariable.scope == ModelVariableScope.GLOBAL,
            )
        )
    else:
        # List workflow variables
        base_query = select(WorkflowVariable).where(
            and_(
                WorkflowVariable.project_id == project_id,
                WorkflowVariable.workflow_id == workflow_id,
                WorkflowVariable.scope == ModelVariableScope.WORKFLOW,
            )
        )

    # Get total count
    from sqlalchemy import func

    count_query = select(func.count()).select_from(base_query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # Get paginated results
    query = base_query.offset(skip).limit(limit).order_by(WorkflowVariable.name)
    result = await db.execute(query)
    variables = list(result.scalars().all())

    return variables, total


async def update_variable(
    db: AsyncSession,
    variable: WorkflowVariable,
    variable_update: VariableUpdate,
) -> WorkflowVariable:
    """
    Update an existing variable.

    Args:
        db: Database session
        variable: Existing WorkflowVariable instance
        variable_update: Update data

    Returns:
        Updated WorkflowVariable instance
    """
    update_data = variable_update.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(variable, field, value)

    db.add(variable)
    await db.commit()
    await db.refresh(variable)

    logger.info(
        "variable_updated",
        variable_id=str(variable.id),
        name=variable.name,
        scope=variable.scope,
    )

    return variable


async def delete_variable(db: AsyncSession, variable: WorkflowVariable) -> bool:
    """
    Delete a variable.

    Args:
        db: Database session
        variable: WorkflowVariable instance to delete

    Returns:
        True if deleted successfully
    """
    variable_id = variable.id
    name = variable.name

    await db.delete(variable)
    await db.commit()

    logger.info(
        "variable_deleted",
        variable_id=str(variable_id),
        name=name,
    )

    return True


async def record_variable_change(
    db: AsyncSession,
    variable_id: UUID,
    old_value: Any,
    new_value: Any,
    workflow_run_id: UUID | None = None,
    changed_by_action: str | None = None,
) -> VariableHistory:
    """
    Record a variable change in history.

    Args:
        db: Database session
        variable_id: ID of the variable that changed
        old_value: Previous value
        new_value: New value
        workflow_run_id: Optional workflow run ID
        changed_by_action: Optional description of the action that triggered the change

    Returns:
        Created VariableHistory instance
    """
    db_history = VariableHistory(
        variable_id=variable_id,
        workflow_run_id=workflow_run_id,
        old_value=old_value,
        new_value=new_value,
        changed_by_action=changed_by_action,
    )

    db.add(db_history)
    await db.commit()
    await db.refresh(db_history)

    logger.info(
        "variable_change_recorded",
        variable_id=str(variable_id),
        history_id=str(db_history.id),
        workflow_run_id=str(workflow_run_id) if workflow_run_id else None,
    )

    return db_history


async def get_variable_history(
    db: AsyncSession,
    variable_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[VariableHistory], int]:
    """
    Get change history for a specific variable.

    Args:
        db: Database session
        variable_id: Variable ID
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (history list, total count)
    """
    from sqlalchemy import func

    # Get total count
    count_query = select(func.count()).where(VariableHistory.variable_id == variable_id)
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # Get paginated results, ordered by most recent first
    query = (
        select(VariableHistory)
        .where(VariableHistory.variable_id == variable_id)
        .order_by(VariableHistory.changed_at.desc())
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    history = list(result.scalars().all())

    return history, total


async def get_run_variable_changes(
    db: AsyncSession,
    workflow_run_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[VariableHistory], int]:
    """
    Get all variable changes during a specific workflow run.

    Args:
        db: Database session
        workflow_run_id: Workflow run ID
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (history list, total count)
    """
    from sqlalchemy import func

    # Get total count
    count_query = select(func.count()).where(
        VariableHistory.workflow_run_id == workflow_run_id
    )
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # Get paginated results, ordered by change time
    query = (
        select(VariableHistory)
        .where(VariableHistory.workflow_run_id == workflow_run_id)
        .order_by(VariableHistory.changed_at.asc())
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    history = list(result.scalars().all())

    return history, total


async def get_run_variables_snapshot(
    db: AsyncSession,
    project_id: UUID,
    workflow_id: UUID,
) -> list[WorkflowVariable]:
    """
    Get a snapshot of all variables available for a workflow run.

    Includes both global variables (project-scoped) and workflow variables.

    Args:
        db: Database session
        project_id: Project ID
        workflow_id: Workflow ID

    Returns:
        List of all applicable variables (global + workflow)
    """
    query = select(WorkflowVariable).where(
        and_(
            WorkflowVariable.project_id == project_id,
            (
                (WorkflowVariable.scope == ModelVariableScope.GLOBAL)
                | (
                    and_(
                        WorkflowVariable.scope == ModelVariableScope.WORKFLOW,
                        WorkflowVariable.workflow_id == workflow_id,
                    )
                )
            ),
        )
    )

    result = await db.execute(query)
    variables = list(result.scalars().all())

    return variables
