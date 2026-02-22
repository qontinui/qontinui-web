from app.db.base import Base  # noqa
from app.models.analytics_event import AnalyticsEvent  # noqa
from app.models.annotation import Annotation, AnnotationSet  # noqa
from app.models.audit_log import AuditLog  # noqa
from app.models.capture import (  # noqa
    CaptureAction,
    CaptureDetectedElement,
    CaptureScreenshot,
    CaptureSession,
    LearnedWorkflow,
    ScreenshotStateMatch,
)
from app.models.device_session import DeviceSession  # noqa
from app.models.error_monitor import ErrorMonitorEntry  # noqa
from app.models.extraction import ExtractionAnnotation, ExtractionSession  # noqa
from app.models.library import (  # noqa
    Check,
    CheckGroup,
    Context,
    Macro,
    PromptSnippet,
    SavedApiRequest,
    ShellCommand,
)
from app.models.project import Project  # noqa
from app.models.session_activity import SessionActivity  # noqa
from app.models.snapshot import (  # noqa
    Pattern,
    Screenshot,
    SnapshotAction,
    SnapshotMatch,
    SnapshotPattern,
    SnapshotRun,
)
from app.models.storage_usage import StorageUsage  # noqa
from app.models.subscription import Subscription  # noqa

# Import all models here for Alembic to detect them
# Note: Import snapshot models before project to avoid circular imports
from app.models.ui_bridge_state import (  # noqa
    DomainKnowledge,
    UIBridgeExplorationSession,
    UIBridgeState,
    UIBridgeStateConfig,
    UIBridgeStateDomainKnowledge,
)
from app.models.ui_bridge_transition import UIBridgeTransition  # noqa
from app.models.usage_metric import UsageMetric  # noqa
from app.models.user import User  # noqa
from app.models.video_capture import (  # noqa
    ActionFrame,
    FrameIndex,
    HistoricalResult,
    InputEvent,
    VideoCaptureSession,
)
from app.models.workflow_sequence import WorkflowSequence  # noqa
