"""
API endpoints for library item management.

Provides generic CRUD for all library types: checks, check groups,
shell commands, saved API requests, contexts, macros, and scriptlets.
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_async_db
from app.crud import library as crud
from app.models.library import (
    Check,
    CheckGroup,
    Context,
    Macro,
    SavedApiRequest,
    Scriptlet,
    ShellCommand,
)
from app.models.user import User
from app.schemas.library import (
    CheckCreate,
    CheckGroupCreate,
    CheckGroupListResponse,
    CheckGroupResponse,
    CheckGroupUpdate,
    CheckListResponse,
    CheckResponse,
    CheckUpdate,
    ContextCreate,
    ContextListResponse,
    ContextResponse,
    ContextUpdate,
    MacroCreate,
    MacroListResponse,
    MacroResponse,
    MacroUpdate,
    Pagination,
    SavedApiRequestCreate,
    SavedApiRequestListResponse,
    SavedApiRequestResponse,
    SavedApiRequestUpdate,
    ScriptletCreate,
    ScriptletListResponse,
    ScriptletResponse,
    ScriptletUpdate,
    ShellCommandCreate,
    ShellCommandListResponse,
    ShellCommandResponse,
    ShellCommandUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


# =============================================================================
# Checks
# =============================================================================


@router.get("/checks", response_model=CheckListResponse)
async def list_checks(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID | None = Query(None),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List checks for the current user."""
    items, total = await crud.list_items(
        db,
        Check,
        current_user.id,
        project_id=project_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    return CheckListResponse(
        items=[CheckResponse.model_validate(i) for i in items],
        pagination=Pagination(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post(
    "/checks", response_model=CheckResponse, status_code=status.HTTP_201_CREATED
)
async def create_check(
    data: CheckCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new check."""
    item = await crud.create_item(db, Check, current_user.id, data.model_dump())
    logger.info("check_created", check_id=item.id, user_id=current_user.id)
    return CheckResponse.model_validate(item)


@router.get("/checks/{check_id}", response_model=CheckResponse)
async def get_check(
    check_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a check by ID."""
    item = await crud.get_item(db, Check, check_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Check not found"
        )
    return CheckResponse.model_validate(item)


@router.put("/checks/{check_id}", response_model=CheckResponse)
async def update_check(
    check_id: UUID,
    data: CheckUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update a check."""
    item = await crud.get_item(db, Check, check_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Check not found"
        )
    updated = await crud.update_item(db, item, data.model_dump(exclude_unset=True))
    logger.info("check_updated", check_id=check_id, user_id=current_user.id)
    return CheckResponse.model_validate(updated)


@router.delete("/checks/{check_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_check(
    check_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete a check."""
    item = await crud.get_item(db, Check, check_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Check not found"
        )
    await crud.delete_item(db, item)
    logger.info("check_deleted", check_id=check_id, user_id=current_user.id)


# =============================================================================
# Check Groups
# =============================================================================


@router.get("/check-groups", response_model=CheckGroupListResponse)
async def list_check_groups(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID | None = Query(None),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List check groups for the current user."""
    items, total = await crud.list_items(
        db,
        CheckGroup,
        current_user.id,
        project_id=project_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    return CheckGroupListResponse(
        items=[CheckGroupResponse.model_validate(i) for i in items],
        pagination=Pagination(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post(
    "/check-groups",
    response_model=CheckGroupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_check_group(
    data: CheckGroupCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new check group."""
    item = await crud.create_item(db, CheckGroup, current_user.id, data.model_dump())
    logger.info("check_group_created", check_group_id=item.id, user_id=current_user.id)
    return CheckGroupResponse.model_validate(item)


@router.get("/check-groups/{group_id}", response_model=CheckGroupResponse)
async def get_check_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a check group by ID."""
    item = await crud.get_item(db, CheckGroup, group_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Check group not found"
        )
    return CheckGroupResponse.model_validate(item)


@router.put("/check-groups/{group_id}", response_model=CheckGroupResponse)
async def update_check_group(
    group_id: UUID,
    data: CheckGroupUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update a check group."""
    item = await crud.get_item(db, CheckGroup, group_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Check group not found"
        )
    updated = await crud.update_item(db, item, data.model_dump(exclude_unset=True))
    logger.info("check_group_updated", check_group_id=group_id, user_id=current_user.id)
    return CheckGroupResponse.model_validate(updated)


@router.delete("/check-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_check_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete a check group."""
    item = await crud.get_item(db, CheckGroup, group_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Check group not found"
        )
    await crud.delete_item(db, item)
    logger.info("check_group_deleted", check_group_id=group_id, user_id=current_user.id)


# =============================================================================
# Shell Commands
# =============================================================================


@router.get("/shell-commands", response_model=ShellCommandListResponse)
async def list_shell_commands(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID | None = Query(None),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List shell commands for the current user."""
    items, total = await crud.list_items(
        db,
        ShellCommand,
        current_user.id,
        project_id=project_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    return ShellCommandListResponse(
        items=[ShellCommandResponse.model_validate(i) for i in items],
        pagination=Pagination(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post(
    "/shell-commands",
    response_model=ShellCommandResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_shell_command(
    data: ShellCommandCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new shell command."""
    item = await crud.create_item(db, ShellCommand, current_user.id, data.model_dump())
    logger.info(
        "shell_command_created", shell_command_id=item.id, user_id=current_user.id
    )
    return ShellCommandResponse.model_validate(item)


@router.get("/shell-commands/{command_id}", response_model=ShellCommandResponse)
async def get_shell_command(
    command_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a shell command by ID."""
    item = await crud.get_item(db, ShellCommand, command_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Shell command not found"
        )
    return ShellCommandResponse.model_validate(item)


@router.put("/shell-commands/{command_id}", response_model=ShellCommandResponse)
async def update_shell_command(
    command_id: UUID,
    data: ShellCommandUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update a shell command."""
    item = await crud.get_item(db, ShellCommand, command_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Shell command not found"
        )
    updated = await crud.update_item(db, item, data.model_dump(exclude_unset=True))
    logger.info(
        "shell_command_updated", shell_command_id=command_id, user_id=current_user.id
    )
    return ShellCommandResponse.model_validate(updated)


@router.delete("/shell-commands/{command_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shell_command(
    command_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete a shell command."""
    item = await crud.get_item(db, ShellCommand, command_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Shell command not found"
        )
    await crud.delete_item(db, item)
    logger.info(
        "shell_command_deleted", shell_command_id=command_id, user_id=current_user.id
    )


# =============================================================================
# Saved API Requests
# =============================================================================


@router.get("/api-requests", response_model=SavedApiRequestListResponse)
async def list_api_requests(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID | None = Query(None),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List saved API requests for the current user."""
    items, total = await crud.list_items(
        db,
        SavedApiRequest,
        current_user.id,
        project_id=project_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    return SavedApiRequestListResponse(
        items=[SavedApiRequestResponse.model_validate(i) for i in items],
        pagination=Pagination(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post(
    "/api-requests",
    response_model=SavedApiRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_request(
    data: SavedApiRequestCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new saved API request."""
    item = await crud.create_item(
        db, SavedApiRequest, current_user.id, data.model_dump()
    )
    logger.info("api_request_created", api_request_id=item.id, user_id=current_user.id)
    return SavedApiRequestResponse.model_validate(item)


@router.get("/api-requests/{request_id}", response_model=SavedApiRequestResponse)
async def get_api_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a saved API request by ID."""
    item = await crud.get_item(db, SavedApiRequest, request_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="API request not found"
        )
    return SavedApiRequestResponse.model_validate(item)


@router.put("/api-requests/{request_id}", response_model=SavedApiRequestResponse)
async def update_api_request(
    request_id: UUID,
    data: SavedApiRequestUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update a saved API request."""
    item = await crud.get_item(db, SavedApiRequest, request_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="API request not found"
        )
    updated = await crud.update_item(db, item, data.model_dump(exclude_unset=True))
    logger.info(
        "api_request_updated", api_request_id=request_id, user_id=current_user.id
    )
    return SavedApiRequestResponse.model_validate(updated)


@router.delete("/api-requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete a saved API request."""
    item = await crud.get_item(db, SavedApiRequest, request_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="API request not found"
        )
    await crud.delete_item(db, item)
    logger.info(
        "api_request_deleted", api_request_id=request_id, user_id=current_user.id
    )


# =============================================================================
# Contexts
# =============================================================================


@router.get("/contexts", response_model=ContextListResponse)
async def list_contexts(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID | None = Query(None),
    search: str | None = Query(None),
    category: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List contexts for the current user."""
    items, total = await crud.list_items(
        db,
        Context,
        current_user.id,
        project_id=project_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    # Apply category filter if specified
    if category:
        items = [i for i in items if i.category == category]
    return ContextListResponse(
        items=[ContextResponse.model_validate(i) for i in items],
        pagination=Pagination(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post(
    "/contexts", response_model=ContextResponse, status_code=status.HTTP_201_CREATED
)
async def create_context(
    data: ContextCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new context."""
    item = await crud.create_item(db, Context, current_user.id, data.model_dump())
    logger.info("context_created", context_id=item.id, user_id=current_user.id)
    return ContextResponse.model_validate(item)


@router.get("/contexts/{context_id}", response_model=ContextResponse)
async def get_context(
    context_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a context by ID."""
    item = await crud.get_item(db, Context, context_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Context not found"
        )
    return ContextResponse.model_validate(item)


@router.put("/contexts/{context_id}", response_model=ContextResponse)
async def update_context(
    context_id: UUID,
    data: ContextUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update a context."""
    item = await crud.get_item(db, Context, context_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Context not found"
        )
    updated = await crud.update_item(db, item, data.model_dump(exclude_unset=True))
    logger.info("context_updated", context_id=context_id, user_id=current_user.id)
    return ContextResponse.model_validate(updated)


@router.delete("/contexts/{context_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_context(
    context_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete a context."""
    item = await crud.get_item(db, Context, context_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Context not found"
        )
    await crud.delete_item(db, item)
    logger.info("context_deleted", context_id=context_id, user_id=current_user.id)


# =============================================================================
# Macros
# =============================================================================


@router.get("/macros", response_model=MacroListResponse)
async def list_macros(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID | None = Query(None),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List macros for the current user."""
    items, total = await crud.list_items(
        db,
        Macro,
        current_user.id,
        project_id=project_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    return MacroListResponse(
        items=[MacroResponse.model_validate(i) for i in items],
        pagination=Pagination(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post(
    "/macros", response_model=MacroResponse, status_code=status.HTTP_201_CREATED
)
async def create_macro(
    data: MacroCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new macro."""
    # Convert steps to dicts for JSONB storage
    payload = data.model_dump()
    payload["steps"] = [
        s.model_dump() if hasattr(s, "model_dump") else s for s in data.steps
    ]
    item = await crud.create_item(db, Macro, current_user.id, payload)
    logger.info("macro_created", macro_id=item.id, user_id=current_user.id)
    return MacroResponse.model_validate(item)


@router.get("/macros/{macro_id}", response_model=MacroResponse)
async def get_macro(
    macro_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a macro by ID."""
    item = await crud.get_item(db, Macro, macro_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found"
        )
    return MacroResponse.model_validate(item)


@router.put("/macros/{macro_id}", response_model=MacroResponse)
async def update_macro(
    macro_id: UUID,
    data: MacroUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update a macro."""
    item = await crud.get_item(db, Macro, macro_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found"
        )
    payload = data.model_dump(exclude_unset=True)
    if "steps" in payload and payload["steps"] is not None and data.steps is not None:
        payload["steps"] = [
            s.model_dump() if hasattr(s, "model_dump") else s for s in data.steps
        ]
    updated = await crud.update_item(db, item, payload)
    logger.info("macro_updated", macro_id=macro_id, user_id=current_user.id)
    return MacroResponse.model_validate(updated)


@router.delete("/macros/{macro_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_macro(
    macro_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete a macro."""
    item = await crud.get_item(db, Macro, macro_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found"
        )
    await crud.delete_item(db, item)
    logger.info("macro_deleted", macro_id=macro_id, user_id=current_user.id)


# =============================================================================
# Scriptlets
# =============================================================================


@router.get("/scriptlets", response_model=ScriptletListResponse)
async def list_scriptlets(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    project_id: UUID | None = Query(None),
    search: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List scriptlets for the current user."""
    items, total = await crud.list_items(
        db,
        Scriptlet,
        current_user.id,
        project_id=project_id,
        search=search,
        offset=offset,
        limit=limit,
    )
    return ScriptletListResponse(
        items=[ScriptletResponse.model_validate(i) for i in items],
        pagination=Pagination(
            total=total, limit=limit, offset=offset, has_more=(offset + limit) < total
        ),
    )


@router.post(
    "/scriptlets", response_model=ScriptletResponse, status_code=status.HTTP_201_CREATED
)
async def create_scriptlet(
    data: ScriptletCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Create a new scriptlet."""
    item = await crud.create_item(db, Scriptlet, current_user.id, data.model_dump())
    logger.info("scriptlet_created", scriptlet_id=item.id, user_id=current_user.id)
    return ScriptletResponse.model_validate(item)


@router.get("/scriptlets/{scriptlet_id}", response_model=ScriptletResponse)
async def get_scriptlet(
    scriptlet_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Get a scriptlet by ID."""
    item = await crud.get_item(db, Scriptlet, scriptlet_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Scriptlet not found"
        )
    return ScriptletResponse.model_validate(item)


@router.put("/scriptlets/{scriptlet_id}", response_model=ScriptletResponse)
async def update_scriptlet(
    scriptlet_id: UUID,
    data: ScriptletUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Update a scriptlet."""
    item = await crud.get_item(db, Scriptlet, scriptlet_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Scriptlet not found"
        )
    updated = await crud.update_item(db, item, data.model_dump(exclude_unset=True))
    logger.info("scriptlet_updated", scriptlet_id=scriptlet_id, user_id=current_user.id)
    return ScriptletResponse.model_validate(updated)


@router.delete("/scriptlets/{scriptlet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scriptlet(
    scriptlet_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
):
    """Delete a scriptlet."""
    item = await crud.get_item(db, Scriptlet, scriptlet_id, current_user.id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Scriptlet not found"
        )
    await crud.delete_item(db, item)
    logger.info("scriptlet_deleted", scriptlet_id=scriptlet_id, user_id=current_user.id)
