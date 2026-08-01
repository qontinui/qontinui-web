from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.user import UserProfileUpdate, UserUpdate


async def get_user(db: AsyncSession, user_id: UUID) -> User | None:
    result = await db.execute(select(User).filter(User.id == user_id))  # type: ignore[arg-type]
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).filter(User.email == email))  # type: ignore[arg-type]
    return result.scalar_one_or_none()


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).filter(User.username == username))
    return result.scalar_one_or_none()


async def get_users(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[User]:
    result = await db.execute(select(User).offset(skip).limit(limit))
    return list(result.scalars().all())


async def _persist_update(
    db: AsyncSession, user: User, update_data: dict[str, Any]
) -> User:
    """Apply an ALREADY-FILTERED field dict to ``user`` and commit.

    Deliberately private: every caller must go through one of the three
    public wrappers in this module (``update_user_self``,
    ``update_user_privileged``, ``update_user_profile``) so the
    privileged/self-service decision is made explicitly at the call site,
    never by whatever fields happened to be on the wire. There is
    intentionally no shared, unfiltered ``update_user`` helper — a
    permissive one is exactly how ``PUT /api/v1/users/me`` came to accept
    ``is_superuser`` (plan
    ``2026-07-29-web-put-users-me-self-privilege-escalation``).
    """
    for field, value in update_data.items():
        setattr(user, field, value)

    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update_user_self(
    db: AsyncSession, user: User, user_update: UserUpdate
) -> User:
    """Self-service update — the caller is editing their OWN row.

    Field policy is delegated to fastapi-users' ``create_update_dict()``,
    which excludes ``{id, is_superuser, is_active, is_verified,
    oauth_accounts}`` (``fastapi_users/schemas.py``,
    ``CreateUpdateDictModel``). Delegating keeps this writer's policy
    identical to the library's own ``PATCH /me`` arm — one definition of
    "self-service field", not two that can drift apart.

    NOT a fail-safe default: that exclude set is a hardcoded literal in
    fastapi-users (v15.0.5), so a NEW flag on ``BaseUserUpdate`` passes
    through unless upstream also adds it to the literal. Any privileged
    field this repo adds to ``UserUpdate`` must therefore be excluded
    explicitly in ``UserUpdate.create_update_dict``, exactly as
    ``password`` already is (Cognito is the sole authenticator; there is
    no local password column, so a stale client's ``password`` must never
    reach ``setattr``).
    """
    return await _persist_update(db, user, user_update.create_update_dict())


async def update_user_privileged(
    db: AsyncSession, user: User, user_update: UserUpdate
) -> User:
    """Privileged update — a superuser editing an ARBITRARY row.

    Uses ``create_update_dict_superuser()`` (excludes only ``id``), so
    ``is_active`` / ``is_superuser`` / ``is_verified`` DO apply. Callers
    must be gated on ``get_current_superuser_async``.

    ``is_active`` transitions additionally have to be sequenced through
    ``apply_activation_transition`` so the coord-side disable/enable rides
    along (plan
    ``2026-07-24-web-deactivation-must-revoke-coord-membership``); this
    helper performs the local write only.
    """
    return await _persist_update(db, user, user_update.create_update_dict_superuser())


async def delete_user(db: AsyncSession, user_id: UUID) -> bool:
    user = await get_user(db, user_id)
    if user:
        await db.delete(user)
        await db.commit()
        return True
    return False


async def update_user_profile(
    db: AsyncSession, user: User, profile_update: UserProfileUpdate
) -> User:
    """Update user profile with specific profile fields (self-service).

    ``PUT /api/v1/users/me/profile`` is gated on
    ``get_current_active_user_async`` — any authenticated user — so this is
    a self-service writer and gets the self-service field policy.
    ``UserProfileUpdate`` declares only ``full_name`` / ``company`` /
    ``phone`` today, so ``create_update_dict()`` is a no-op filter right
    now; it is applied anyway so that adding a privileged field to the
    schema later cannot silently reopen the escalation this same ``setattr``
    idiom caused on ``PUT /me``.
    """
    return await _persist_update(db, user, profile_update.create_update_dict())


async def update_user_avatar(db: AsyncSession, user: User, avatar_url: str) -> User:
    """Update user avatar URL"""
    user.avatar_url = avatar_url
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def get_user_activity(
    db: AsyncSession, user_id: UUID, skip: int = 0, limit: int = 20
) -> list[AuditLog]:
    """Get recent user activity from audit logs"""
    result = await db.execute(
        select(AuditLog)
        .filter(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())
