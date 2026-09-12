"""Per-user Claude account roster API.

Two audiences:

- A RUNNER (device-JWT authenticated) reads the roster to populate its local
  ``claude-accounts.json`` (``qontinui-runner/src-tauri/src/claude_accounts.rs``),
  which is the file the existing account-rotation/spawn logic already reads —
  this endpoint changes nothing about how a runner picks or launches an
  account, only where the roster of account NAMES comes from.
- A HUMAN (Cognito session) manages their own roster.

See app/models/claude_account.py for field semantics.
"""

from typing import Any

import structlog
from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    DeviceTokenContext,
    get_async_db,
    get_authenticated_device,
    get_current_active_user_async,
)
from app.models.claude_account import ClaudeAccountProfile
from app.models.user import User
from app.schemas.claude_account import (
    ClaudeAccountEntryResponse,
    ClaudeAccountRosterResponse,
    ClaudeAccountRosterUpdate,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


async def _load_roster(db: AsyncSession, user_id: Any) -> list[ClaudeAccountProfile]:
    result = await db.execute(
        select(ClaudeAccountProfile)
        .where(ClaudeAccountProfile.user_id == user_id)
        .order_by(ClaudeAccountProfile.created_at)
    )
    return list(result.scalars().all())


@router.get("", response_model=ClaudeAccountRosterResponse)
async def get_claude_account_roster(
    *,
    db: AsyncSession = Depends(get_async_db),
    device_ctx: DeviceTokenContext = Depends(get_authenticated_device),
) -> Any:
    """Return the caller device's owning user's Claude account roster.

    This is the endpoint runners fetch from — device-JWT authenticated
    (`get_authenticated_device`), same as every other runner-facing surface.
    """
    profiles = await _load_roster(db, device_ctx.user.id)
    logger.info(
        "claude_accounts_fetched_by_device",
        user_id=device_ctx.user.id,
        device_id=str(device_ctx.claims.get("device_id", "")),
        count=len(profiles),
    )
    return ClaudeAccountRosterResponse(
        accounts=[ClaudeAccountEntryResponse.model_validate(p) for p in profiles]
    )


@router.get("/mine", response_model=ClaudeAccountRosterResponse)
async def get_my_claude_account_roster(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Return the current human user's own Claude account roster."""
    profiles = await _load_roster(db, current_user.id)
    return ClaudeAccountRosterResponse(
        accounts=[ClaudeAccountEntryResponse.model_validate(p) for p in profiles]
    )


@router.put("/mine", response_model=ClaudeAccountRosterResponse)
async def replace_my_claude_account_roster(
    *,
    db: AsyncSession = Depends(get_async_db),
    roster_update: ClaudeAccountRosterUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Replace the current user's full roster.

    The whole list is the unit (matches accounts.json's declarative-roster
    semantics) — this deletes every existing row for the user and re-inserts
    the given list, rather than diffing individual entries.
    """
    await db.execute(
        delete(ClaudeAccountProfile).where(
            ClaudeAccountProfile.user_id == current_user.id
        )
    )
    for entry in roster_update.accounts:
        db.add(
            ClaudeAccountProfile(
                user_id=current_user.id,
                account_key=entry.account_key,
                shortcut=entry.shortcut,
                email=entry.email,
                dir_name=entry.dir_name,
            )
        )
    await db.commit()

    profiles = await _load_roster(db, current_user.id)
    logger.info(
        "claude_accounts_replaced",
        user_id=current_user.id,
        count=len(profiles),
    )
    return ClaudeAccountRosterResponse(
        accounts=[ClaudeAccountEntryResponse.model_validate(p) for p in profiles]
    )
