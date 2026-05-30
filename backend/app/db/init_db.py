import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

# Import Base and all models to register them with SQLAlchemy metadata
from app.db.base import Base  # noqa: F401
from app.db.base_class import (  # noqa: F401
    AnalyticsEvent,
    Annotation,
    AnnotationSet,
    AuditLog,
    CaptureDetectedElement,
    ClipboardEntry,
    Device,
    DeviceConnection,
    DeviceSession,
    DomainKnowledge,
    ErrorMonitorEntry,
    ExtractionAnnotation,
    FrameIndex,
    Macro,
    PhaseResult,
    Project,
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
    """Initialize the database with the first superuser (async version).

    Cognito is the sole authentication mechanism, so the seeded superuser
    has no local password. It is a shell ``auth.users`` row keyed on
    ``FIRST_SUPERUSER_EMAIL``; on that operator's first Cognito login the
    provision-or-link path (see :mod:`app.services.cognito_provision`)
    stamps their ``cognito_sub`` onto this row by verified email, so they
    inherit the pre-seeded superuser grant.
    """
    # Tables are created via Alembic migrations, not here
    # Base.metadata.create_all(bind=engine) is incompatible with async engines

    # Create the first superuser shell if it doesn't exist
    if settings.FIRST_SUPERUSER_EMAIL:
        # Use async select query
        result = await db.execute(
            select(User).filter(User.email == settings.FIRST_SUPERUSER_EMAIL)  # type: ignore[arg-type]
        )
        user = result.scalar_one_or_none()

        if not user:
            user = User(
                email=settings.FIRST_SUPERUSER_EMAIL,
                username=settings.FIRST_SUPERUSER_EMAIL.split("@")[0],
                full_name="Admin User",
                is_superuser=True,
                is_verified=True,
                is_active=True,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
            logger.info("created_first_superuser", email=settings.FIRST_SUPERUSER_EMAIL)
