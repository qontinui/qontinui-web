import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_password_hash

# Import Base and all models to register them with SQLAlchemy metadata
from app.db.base import Base  # noqa: F401
from app.db.base_class import (  # noqa: F401
    AnalyticsEvent,
    Annotation,
    AnnotationSet,
    AuditLog,
    CaptureDetectedElement,
    ClipboardEntry,
    DeviceSession,
    DomainKnowledge,
    ErrorMonitorEntry,
    ExtractionAnnotation,
    FrameIndex,
    Macro,
    PhaseResult,
    Project,
    Runner,
    RunnerToken,
    ScheduledWorkflowRun,
    SessionActivity,
    SharedFile,
    SnapshotAction,
    StorageUsage,
    TaskRun,
    UIBridgeTransition,
    UsageMetric,
    WrapperEntry,
)
from app.models.user import User

logger = structlog.get_logger(__name__)


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
            logger.info("created_first_superuser", email=settings.FIRST_SUPERUSER_EMAIL)
