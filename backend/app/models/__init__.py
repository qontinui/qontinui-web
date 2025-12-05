"""
Models package for qontinui-web backend.

This package contains all SQLAlchemy models for the application.
"""

from app.models.admin_notification_settings import AdminNotificationSettings
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
from app.models.capture import (
    CaptureAction,
    CaptureDetectedElement,
    CaptureScreenshot,
    CaptureSession,
    LearnedWorkflow,
    ScreenshotStateMatch,
)
from app.models.code_package import (
    CodePackage,
    InstallationStatus,
    PackageCategory,
    PackageInstallation,
    PackageRating,
    PackageVersion,
    SecurityScanStatus,
)
from app.models.collaboration import (
    ActionType,
    ActivityLog,
    ProjectComment,
    ProjectLock,
    ResourceType,
)
from app.models.coverage_snapshot import CoverageSnapshot
from app.models.custom_function import CustomFunction
from app.models.device_session import DeviceSession
from app.models.edit_command import EditCommand
from app.models.extraction import ExtractionAnnotation, ExtractionSession
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
from app.models.path_discovery import PathDiscovery
from app.models.project import Project
from app.models.project_version import ProjectVersion
from app.models.region_result import (
    DetectedRegionModel,
    FusedRegionModel,
    RegionAnalysisJob,
    RegionAnalyzerResult,
)
from app.models.runner_connection import RunnerConnection
from app.models.runner_device import RunnerDevice
from app.models.runner_token import RunnerToken
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.models.session_activity import SessionActivity
from app.models.snapshot import Pattern, Screenshot, SnapshotRun
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.storage_usage import StorageUsage
from app.models.subscription import Subscription, SubscriptionStatus, SubscriptionTier
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
    TestDeficiency,
)
from app.models.training_dataset import (
    AnnotationSource,
    DatasetSource,
    ElementType,
    ExportFormat,
    ExportJobStatus,
    ReviewStatus,
    TrainingDataset,
    TrainingDatasetAnnotation,
    TrainingDatasetExportJob,
    TrainingDatasetImage,
)
from app.models.transition_execution import (
    TransitionExecution,
    TransitionExecutionStatus,
)
from app.models.transition_reliability import TransitionReliability
from app.models.usage_metric import UsageMetric
from app.models.user import User
from app.models.workflow_variable import (
    VariableHistory,
    VariableScope,
    WorkflowVariable,
)

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
    # Admin Notifications
    "AdminNotificationSettings",
    # Annotations
    "Annotation",
    "AnnotationSet",
    # Web Extraction
    "ExtractionSession",
    "ExtractionAnnotation",
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
    "RunnerDevice",
    # Version History & Event Sourcing
    "ProjectVersion",
    "EditCommand",
    # Workflow Variables
    "WorkflowVariable",
    "VariableHistory",
    "VariableScope",
    # Code Package Library
    "CodePackage",
    "PackageVersion",
    "PackageInstallation",
    "PackageRating",
    "PackageCategory",
    "SecurityScanStatus",
    "InstallationStatus",
    # Custom Functions
    "CustomFunction",
    # Workflow Learning (Capture Sessions)
    "CaptureSession",
    "CaptureScreenshot",
    "CaptureAction",
    "CaptureDetectedElement",
    "ScreenshotStateMatch",
    "LearnedWorkflow",
    # Software Testing
    "SoftwareTestRun",
    "TestRunStatus",
    "TransitionExecution",
    "TransitionExecutionStatus",
    "TestDeficiency",
    "DeficiencySeverity",
    "DeficiencyType",
    "DeficiencyStatus",
    "CoverageSnapshot",
    "PathDiscovery",
    "TransitionReliability",
    # Training Datasets
    "TrainingDataset",
    "TrainingDatasetImage",
    "TrainingDatasetAnnotation",
    "TrainingDatasetExportJob",
    "DatasetSource",
    "AnnotationSource",
    "ElementType",
    "ReviewStatus",
    "ExportFormat",
    "ExportJobStatus",
]
