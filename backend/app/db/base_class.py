from app.db.base import Base  # noqa
from app.models.analytics_event import AnalyticsEvent  # noqa
from app.models.annotation import Annotation, AnnotationSet  # noqa
from app.models.audit_log import AuditLog  # noqa
from app.models.device_session import DeviceSession  # noqa
from app.models.extraction import ExtractionAnnotation, ExtractionSession  # noqa
from app.models.project import Project  # noqa
from app.models.session_activity import SessionActivity  # noqa
from app.models.snapshot import Pattern, Screenshot, SnapshotRun  # noqa
from app.models.storage_usage import StorageUsage  # noqa
from app.models.subscription import Subscription  # noqa
from app.models.usage_metric import UsageMetric  # noqa

# Import all models here for Alembic to detect them
# Note: Import snapshot models before project to avoid circular imports
from app.models.user import User  # noqa
