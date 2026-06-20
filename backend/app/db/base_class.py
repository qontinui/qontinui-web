from app.db.base import Base  # noqa
from app.models.analytics_event import AnalyticsEvent  # noqa
from app.models.annotation import Annotation, AnnotationSet  # noqa
from app.models.audit_log import AuditLog  # noqa
from app.models.capture import CaptureDetectedElement  # noqa
from app.models.clipboard import ClipboardEntry  # noqa
from app.models.device_session import DeviceSession  # noqa
from app.models.error_monitor import ErrorMonitorEntry  # noqa
from app.models.extraction import (
    ExtractionAnnotation,  # noqa
)
from app.models.library import Macro  # noqa
from app.models.machine_display_name import MachineDisplayName  # noqa
from app.models.phase_result import PhaseResult  # noqa
from app.models.project import Project  # noqa
from app.models.device import Device  # noqa
from app.models.device_connection import DeviceConnection  # noqa
from app.models.scheduled_workflow_run import ScheduledWorkflowRun  # noqa
from app.models.session_activity import SessionActivity  # noqa
from app.models.shared_file import SharedFile  # noqa
from app.models.snapshot import SnapshotAction  # noqa
from app.models.storage_usage import StorageUsage  # noqa
from app.models.task_run import TaskRun  # noqa

# Import all models here for Alembic to detect them
# Note: Import snapshot models before project to avoid circular imports
from app.models.ui_bridge_state import DomainKnowledge  # noqa
from app.models.ui_bridge_transition import UIBridgeTransition  # noqa
from app.models.usage_metric import UsageMetric  # noqa
from app.models.user import User  # noqa
from app.models.video_capture import FrameIndex  # noqa
from app.models.wrapper_entry import WrapperEntry  # noqa
