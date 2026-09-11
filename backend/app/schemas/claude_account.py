"""Pydantic schemas for the per-user Claude account roster.

See app/models/claude_account.py for field semantics.
"""

from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime


class ClaudeAccountEntry(BaseSchema):
    """One roster entry, as written by a human (no id/timestamps)."""

    account_key: str = Field(
        ..., min_length=1, max_length=100, description='e.g. "gmail", "hotmail"'
    )
    shortcut: str = Field(
        ..., min_length=1, max_length=20, description='e.g. "clg" (informational)'
    )
    email: str | None = Field(
        None, description="Login address; null means unverified, not absent"
    )
    dir_name: str | None = Field(
        None,
        description='Overrides the derived local directory name '
        '(default ".claude-<account_key>")',
    )


class ClaudeAccountEntryResponse(ClaudeAccountEntry, BaseORMSchema):
    """One roster entry as returned by the API."""

    id: UUID
    user_id: UUID
    created_at: IsoDatetime
    updated_at: IsoDatetime


class ClaudeAccountRosterResponse(BaseSchema):
    """The full roster for one user."""

    accounts: list[ClaudeAccountEntryResponse]


class ClaudeAccountRosterUpdate(BaseSchema):
    """Replace the full roster — the whole list is the unit, matching the
    declarative-roster semantics of qontinui-claude-config/accounts.json."""

    accounts: list[ClaudeAccountEntry]
