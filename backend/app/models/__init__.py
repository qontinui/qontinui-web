"""
Database Models

This package contains all SQLAlchemy database models for the application.
"""

# Existing models
from app.models.user import User
from app.models.project import Project
from app.models.session_activity import SessionActivity
from app.models.device_session import DeviceSession
from app.models.storage_usage import StorageUsage
from app.models.subscription import Subscription
from app.models.usage_metric import UsageMetric
from app.models.audit_log import AuditLog
from app.models.analytics_event import AnalyticsEvent
from app.models.annotation import AnnotationSet, Annotation
from app.models.snapshot import SnapshotRun, Screenshot, Pattern
from app.models.analysis_result import (
    AnalysisJob,
    AnalyzerResult,
    DetectedElementModel,
    FusedElement
)
from app.models.region_result import (
    RegionAnalysisJob,
    RegionAnalyzerResult,
    DetectedRegionModel,
    FusedRegionModel
)

# Automation WebSocket models
from app.models.automation_session import AutomationSession
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.screenshot_input_association import ScreenshotInputAssociation

__all__ = [
    # User and authentication
    "User",
    "SessionActivity",
    "DeviceSession",

    # Project and resources
    "Project",
    "StorageUsage",

    # Subscription and usage
    "Subscription",
    "UsageMetric",

    # Audit and analytics
    "AuditLog",
    "AnalyticsEvent",

    # Annotations
    "AnnotationSet",
    "Annotation",

    # Snapshots
    "SnapshotRun",
    "Screenshot",
    "Pattern",

    # Analysis results
    "AnalysisJob",
    "AnalyzerResult",
    "DetectedElementModel",
    "FusedElement",
    "RegionAnalysisJob",
    "RegionAnalyzerResult",
    "DetectedRegionModel",
    "FusedRegionModel",

    # Automation WebSocket models
    "AutomationSession",
    "AutomationLog",
    "AutomationScreenshot",
    "ScreenshotInputAssociation",
]
