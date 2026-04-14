from uuid import UUID

from app.core.security import get_password_hash, verify_password
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.user import UserCreate, UserProfileUpdate, UserUpdate
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


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


async def create_user(db: AsyncSession, user: UserCreate) -> User:
    hashed_password = get_password_hash(user.password)
    db_user = User(
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        hashed_password=hashed_password,
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user


async def update_user(db: AsyncSession, user: User, user_update: UserUpdate) -> User:
    update_data = user_update.dict(exclude_unset=True)

    if "password" in update_data:
        hashed_password = get_password_hash(update_data["password"])
        del update_data["password"]
        update_data["hashed_password"] = hashed_password

    for field, value in update_data.items():
        setattr(user, field, value)

    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(db: AsyncSession, user_id: UUID) -> bool:
    user = await get_user(db, user_id)
    if user:
        await db.delete(user)
        await db.commit()
        return True
    return False


async def authenticate_user(
    db: AsyncSession, username: str, password: str
) -> User | None:
    user = await get_user_by_username(db, username)
    if not user:
        user = await get_user_by_email(db, username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def update_user_profile(
    db: AsyncSession, user: User, profile_update: UserProfileUpdate
) -> User:
    """Update user profile with specific profile fields"""
    update_data = profile_update.dict(exclude_unset=True)

    for field, value in update_data.items():
        setattr(user, field, value)

    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


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
