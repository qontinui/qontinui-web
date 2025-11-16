"""
Models package for qontinui-web backend.

This package contains all SQLAlchemy models for the application.
"""

from app.models.annotation import Annotation, AnnotationSet
from app.models.audit_log import AuditLog
from app.models.automation import AutomationInputEvent
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.automation_video import AutomationVideo
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.models.discovered_state import DiscoveredState
from app.models.state_transition import StateTransition
from app.models.snapshot import SnapshotRun, Screenshot, Pattern
from app.models.collaboration import (
    ActionType,
    ActivityLog,
    ProjectComment,
    ProjectLock,
    ResourceType,
)
from app.models.device_session import DeviceSession
from app.models.organization import (
    Organization,
    OrganizationInvitation,
    PermissionLevel,
    ProjectAccessControl,
    TeamMember,
    TeamRole,
)
from app.models.project import Project
from app.models.session_activity import SessionActivity
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
    # Automation
    "AutomationSession",
    "AutomationScreenshot",
    "AutomationInputEvent",
    "AutomationLog",
    "ScreenshotInputAssociation",
    "AutomationVideo",
    # State Discovery
    "DiscoveredState",
    "StateTransition",
    # Snapshots
    "SnapshotRun",
    "Screenshot",
    "Pattern",
]
