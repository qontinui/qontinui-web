from collections.abc import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

# Sync engine only for Alembic migrations and init_db
database_url_str = str(settings.DATABASE_URL)
sync_engine = create_engine(database_url_str)

# Export as 'engine' for Alembic
engine = sync_engine

# Sync session only for init_db and metrics flush (to be migrated)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)

# Async engine with asyncpg for PostgreSQL
if database_url_str.startswith("postgresql://"):
    async_database_url = database_url_str.replace(
        "postgresql://", "postgresql+asyncpg://"
    )
else:
    async_database_url = database_url_str

async_engine = create_async_engine(
    async_database_url,
    echo=settings.DEBUG if hasattr(settings, "DEBUG") else False,
    future=True,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

AsyncSessionLocal = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


def get_sync_db():
    """Dependency for getting sync database sessions (for Alembic migrations and init_db)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
