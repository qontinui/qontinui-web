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

# Handle SSL configuration for asyncpg
# asyncpg doesn't accept sslmode in the URL, so we parse it and configure separately
import ssl

connect_args = {}
if "sslmode=require" in async_database_url:
    # Remove sslmode from URL and configure SSL via connect_args
    async_database_url = async_database_url.replace("?sslmode=require", "")
    async_database_url = async_database_url.replace("&sslmode=require", "")
    # For asyncpg with RDS, create SSL context that doesn't verify certificates
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connect_args["ssl"] = ssl_context
else:
    # For local development without SSL (Docker PostgreSQL)
    # asyncpg tries SSL by default, so we need to explicitly disable it
    connect_args["ssl"] = False

async_engine = create_async_engine(
    async_database_url,
    echo=settings.DEBUG if hasattr(settings, "DEBUG") else False,
    future=True,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    connect_args=connect_args,
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
