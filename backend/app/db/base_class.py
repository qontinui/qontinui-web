from app.db.base import Base  # noqa
from app.models.analytics_event import AnalyticsEvent  # noqa
from app.models.annotation import Annotation, AnnotationSet  # noqa
from app.models.audit_log import AuditLog  # noqa
from app.models.capture import (CaptureAction, CaptureDetectedElement,  # noqa
                                CaptureScreenshot, CaptureSession,
                                LearnedWorkflow, ScreenshotStateMatch)
from app.models.device_session import DeviceSession  # noqa
from app.models.error_monitor import ErrorMonitorEntry  # noqa
from app.models.extraction import (ExtractionAnnotation,  # noqa
                                   ExtractionSession)
from app.models.library import (Check, CheckGroup, Context, Macro,  # noqa
                                PromptSnippet, SavedApiRequest, ShellCommand)
from app.models.project import Project  # noqa
from app.models.session_activity import SessionActivity  # noqa
from app.models.snapshot import (Pattern, Screenshot, SnapshotAction,  # noqa
                                 SnapshotMatch, SnapshotPattern, SnapshotRun)
from app.models.storage_usage import StorageUsage  # noqa
from app.models.subscription import Subscription  # noqa
from app.models.task_run import (DeferredQuestion, TaskRun,  # noqa
                                 TaskRunAutomation, TaskRunFinding,
                                 TaskRunSession)
# Import all models here for Alembic to detect them
# Note: Import snapshot models before project to avoid circular imports
from app.models.ui_bridge_state import (DomainKnowledge,  # noqa
                                        UIBridgeExplorationSession,
                                        UIBridgeState, UIBridgeStateConfig,
                                        UIBridgeStateDomainKnowledge)
from app.models.ui_bridge_transition import UIBridgeTransition  # noqa
from app.models.usage_metric import UsageMetric  # noqa
from app.models.user import User  # noqa
from app.models.video_capture import (ActionFrame, FrameIndex,  # noqa
                                      HistoricalResult, InputEvent,
                                      VideoCaptureSession)
