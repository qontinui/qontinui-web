"""
Models package for qontinui-web backend.

This package contains all SQLAlchemy models for the application.
"""

from app.models.analysis_result import (
    AnalysisJob,
    AnalyzerResult,
    DetectedElementModel,
    FusedElement,
)
from app.models.analytics_event import AnalyticsEvent
from app.models.annotation import Annotation, AnnotationSet
from app.models.audit_log import AuditLog
from app.models.automation import AutomationInputEvent
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.automation_video import AutomationVideo
from app.models.collaboration import (
    ActionType,
    ActivityLog,
    ProjectComment,
    ProjectLock,
    ResourceType,
)
from app.models.device_session import DeviceSession
from app.models.edit_command import EditCommand
from app.models.notification import (
    Notification,
    NotificationPreferences,
    NotificationType,
)
from app.models.organization import (
    Organization,
    OrganizationInvitation,
    PermissionLevel,
    ProjectAccessControl,
    TeamMember,
    TeamRole,
)
from app.models.project import Project
from app.models.project_version import ProjectVersion
from app.models.region_result import (
    DetectedRegionModel,
    FusedRegionModel,
    RegionAnalysisJob,
    RegionAnalyzerResult,
)
from app.models.runner_connection import RunnerConnection
from app.models.runner_token import RunnerToken
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.models.session_activity import SessionActivity
from app.models.snapshot import Pattern, Screenshot, SnapshotRun
from app.models.storage_usage import StorageUsage
from app.models.subscription import Subscription, SubscriptionStatus, SubscriptionTier
from app.models.usage_metric import UsageMetric
from app.models.user import User

__all__ = [
    # User and Auth
    "User",
    # Projects
    "Project",
    # Organizations and Teams
    "Organization",
    "TeamMember",
    "TeamRole",
    "OrganizationInvitation",
    "ProjectAccessControl",
    "PermissionLevel",
    # Collaboration
    "ProjectLock",
    "ProjectComment",
    "ActivityLog",
    "ActionType",
    "ResourceType",
    # Notifications
    "Notification",
    "NotificationPreferences",
    "NotificationType",
    # Annotations
    "Annotation",
    "AnnotationSet",
    # Subscriptions
    "Subscription",
    "SubscriptionStatus",
    "SubscriptionTier",
    # Usage and Storage
    "UsageMetric",
    "StorageUsage",
    # Sessions and Activity
    "DeviceSession",
    "SessionActivity",
    # Audit
    "AuditLog",
    # Analytics
    "AnalyticsEvent",
    # Automation
    "AutomationSession",
    "AutomationLog",
    "AutomationScreenshot",
    "AutomationInputEvent",
    "ScreenshotInputAssociation",
    "AutomationVideo",
    # Snapshots
    "SnapshotRun",
    "Screenshot",
    "Pattern",
    # Analysis
    "AnalysisJob",
    "AnalyzerResult",
    "DetectedElementModel",
    "FusedElement",
    "RegionAnalysisJob",
    "RegionAnalyzerResult",
    "DetectedRegionModel",
    "FusedRegionModel",
    # Runner Tokens
    "RunnerToken",
    "RunnerConnection",
    # Version History & Event Sourcing
    "ProjectVersion",
    "EditCommand",
]
