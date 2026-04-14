from app.core.config import settings
from app.core.security import get_password_hash
# Import models to register them with Base
from app.db.base_class import *  # noqa
from app.models.user import User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def init_db(db: AsyncSession) -> None:
    """Initialize database with first superuser (async version)."""
    # Tables are created via Alembic migrations, not here
    # Base.metadata.create_all(bind=engine) is incompatible with async engines

    # Create first superuser if it doesn't exist
    if settings.FIRST_SUPERUSER_EMAIL:
        # Use async select query
        result = await db.execute(
            select(User).filter(User.email == settings.FIRST_SUPERUSER_EMAIL)  # type: ignore[arg-type]
        )
        user = result.scalar_one_or_none()

        if not user:
            # Create user directly
            hashed_password = get_password_hash(settings.FIRST_SUPERUSER_PASSWORD)  # type: ignore[arg-type]
            user = User(
                email=settings.FIRST_SUPERUSER_EMAIL,
                username=settings.FIRST_SUPERUSER_EMAIL.split("@")[0],
                hashed_password=hashed_password,
                full_name="Admin User",
                is_superuser=True,
                is_verified=True,
                is_active=True,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
            print(f"Created first superuser: {settings.FIRST_SUPERUSER_EMAIL}")
