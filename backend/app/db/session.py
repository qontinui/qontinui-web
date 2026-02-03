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
    connect_args["ssl"] = False  # type: ignore[assignment]

# ============================================================================
# OPTIMIZED CONNECTION POOL CONFIGURATION
# ============================================================================

# Get pool settings from environment or use defaults based on environment
import os

environment = getattr(settings, "ENVIRONMENT", "development")
num_instances = int(os.getenv("APP_INSTANCE_COUNT", "1"))

# Pool size configuration by environment
if environment == "production":
    base_pool_size = int(os.getenv("DB_POOL_SIZE", "10"))
    base_max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "15"))
    pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "30"))
    pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "1800"))  # 30 minutes
elif environment == "staging":
    base_pool_size = int(os.getenv("DB_POOL_SIZE", "8"))
    base_max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "12"))
    pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "30"))
    pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "1800"))
else:  # development
    base_pool_size = int(os.getenv("DB_POOL_SIZE", "5"))
    base_max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "10"))
    pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "10"))
    pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "600"))  # 10 minutes

# Divide pool size by number of instances (for auto-scaling)
pool_size = max(base_pool_size // num_instances, 3)  # Minimum 3 per instance
max_overflow = max(base_max_overflow // num_instances, 5)  # Minimum 5 overflow

# Get pre_ping setting (default: True)
pool_pre_ping = os.getenv("DB_POOL_PRE_PING", "true").lower() == "true"

async_engine = create_async_engine(
    async_database_url,
    echo=settings.DEBUG if hasattr(settings, "DEBUG") else False,
    future=True,
    # Connection pool settings (optimized)
    pool_size=pool_size,  # Core persistent connections
    max_overflow=max_overflow,  # Additional connections when pool exhausted
    pool_timeout=pool_timeout,  # Max seconds to wait for connection
    pool_recycle=pool_recycle,  # Recycle connections after N seconds (prevents stale connections)
    pool_pre_ping=pool_pre_ping,  # Test connection validity before checkout
    pool_use_lifo=True,  # LIFO ordering for better connection locality
    connect_args=connect_args,
)

# Log pool configuration on startup
import structlog

logger = structlog.get_logger(__name__)
logger.info(
    "database_pool_configured",
    environment=environment,
    pool_size=pool_size,
    max_overflow=max_overflow,
    max_connections=pool_size + max_overflow,
    pool_timeout=pool_timeout,
    pool_recycle=pool_recycle,
    pool_pre_ping=pool_pre_ping,
    num_instances=num_instances,
)

# ============================================================================

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
    """Dependency for getting async database sessions.

    WARNING: This function is designed to be used as a FastAPI dependency.
    Do NOT use it with `async for` and `break` - this leaves the generator
    in an invalid state and causes IllegalStateChangeError.

    For WebSocket handlers or other non-dependency contexts, use
    AsyncSessionLocal() directly:
        async with AsyncSessionLocal() as session:
            # ... your code ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except GeneratorExit:
            # Generator was closed prematurely (e.g., client disconnect, break from loop)
            # Don't try to commit or rollback - just let the context manager handle cleanup
            # This prevents IllegalStateChangeError when close() is called while
            # another operation is in progress
            pass
        except Exception:
            await session.rollback()
            raise
        # Note: No explicit session.close() needed - the async context manager handles it
