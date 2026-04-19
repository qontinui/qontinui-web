"""
Pydantic schemas for runner bearer tokens.

These schemas never expose ``token_hash`` or the plaintext token (except for
:class:`RunnerTokenCreatedResponse`, which is the one-time post-creation
payload handed back to the user).
"""

from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime


class RunnerTokenCreate(BaseSchema):
    """Request body for minting a new runner token."""

    name: str = Field(..., min_length=1, max_length=255)
    expires_in_days: int | None = Field(
        default=None,
        description=(
            "Token lifetime in days. Omit (null) for a token that never "
            "expires. Negative values mint an already-expired token."
        ),
    )


class RunnerTokenResponse(BaseORMSchema):
    """Safe view of a runner token record (no hash, no plaintext)."""

    id: UUID
    name: str
    created_at: IsoDatetime
    expires_at: IsoDatetime | None = None
    last_used_at: IsoDatetime | None = None
    is_revoked: bool
    revoked_at: IsoDatetime | None = None


class RunnerTokenCreatedResponse(BaseSchema):
    """One-time payload returned when a token is first created.

    ``plain_token`` is the ONLY moment the caller sees the raw token — it is
    not persisted anywhere after this response is returned.
    """

    token_record: RunnerTokenResponse
    plain_token: str = Field(
        ...,
        description=(
            "Plain bearer token — shown exactly once. Store it somewhere "
            "safe; it cannot be recovered later."
        ),
    )
