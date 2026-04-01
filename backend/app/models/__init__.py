"""
Models package for qontinui-web backend.

This package contains all SQLAlchemy models for the application.
"""

from app.models.action_execution import (
                                         ActionExecution,
                                         ActionExecutionStatus,
                                         ActionExecutionType,
)
from app.models.admin_notification_settings import AdminNotificationSettings
from app.models.ai_prompt import AIPromptTemplate, PromptSequence
from app.models.analytics_event import AnalyticsEvent
from app.models.annotation import Annotation, AnnotationSet
from app.models.application_profile import ApplicationProfile
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
from app.models.detected_issue import DetectedIssue
from app.models.device_session import DeviceSession
from app.models.discovered_state import DiscoveredState
from app.models.discovery import Discovery
from app.models.edit_command import EditCommand
from app.models.element_annotation import ElementAnnotation, ElementAnnotationSet
from app.models.embedding_generation_job import EmbeddingGenerationJob
from app.models.evaluation_dataset import DatasetItem, EvaluationDataset
from app.models.evaluation_experiment import EvaluationExperiment, ExperimentResult
from app.models.execution_issue import (
                                         ExecutionIssue,
                                         ExecutionIssueSeverity,
                                         ExecutionIssueSource,
                                         ExecutionIssueStatus,
                                         ExecutionIssueType,
)
from app.models.execution_run import ExecutionRun, ExecutionRunStatus, ExecutionRunType
from app.models.execution_screenshot import ExecutionScreenshot, ExecutionScreenshotType
from app.models.execution_tree_event import (
                                         ExecutionTreeEvent,
                                         TreeEventType,
                                         TreeNodeStatus,
                                         TreeNodeType,
)
from app.models.extraction import ExtractionAnnotation, ExtractionSession
from app.models.feedback_score import FeedbackScore
from app.models.finding_category_config import FindingCategoryConfig
from app.models.known_issue import KnownIssue
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
from app.models.project_annotation_state import ProjectAnnotationState
from app.models.project_assets import ProjectImage, ProjectScreenshot
from app.models.project_embedding import ProjectEmbedding
from app.models.project_version import ProjectVersion
from app.models.prompt_template_version import PromptTemplateVersion
from app.models.recording import (
                                         DiscoveredTransition,
                                         ProcessingLog,
                                         ProcessingPhase,
                                         Recording,
                                         RecordingContext,
                                         RecordingFrame,
                                         RecordingInteraction,
                                         RecordingStatus,
)
from app.models.render_log import (
                                         RenderImage,
                                         RenderImageType,
                                         RenderLog,
                                         RenderLogMutationType,
                                         RenderLogTrigger,
)
from app.models.runner_connection import RunnerConnection
from app.models.runner_device import RunnerDevice
from app.models.screenshot_input_association import ScreenshotInputAssociation
from app.models.session_activity import SessionActivity
from app.models.skill import Skill
from app.models.snapshot import (
                                         Pattern,
                                         Screenshot,
                                         SnapshotAction,
                                         SnapshotMatch,
                                         SnapshotPattern,
                                         SnapshotRun,
)
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.state_discovery_result import DiscoverySourceType, StateDiscoveryResult
from app.models.state_machine_config import StateMachineConfig
from app.models.state_transition import StateTransition
from app.models.storage_usage import StorageUsage
from app.models.subscription import Subscription, SubscriptionStatus, SubscriptionTier
from app.models.sync_lock import SyncLock
from app.models.task_run import (  # New unified names; Backward compatibility aliases
                                         AITask,
                                         AITaskFinding,
                                         AITaskFindingActionType,
                                         AITaskFindingCategory,
                                         AITaskFindingSeverity,
                                         AITaskFindingStatus,
                                         AITaskSession,
                                         AITaskStatus,
                                         FindingActionType,
                                         FindingCategory,
                                         FindingSeverity,
                                         FindingStatus,
                                         TaskRun,
                                         TaskRunAutomation,
                                         TaskRunFinding,
                                         TaskRunSession,
                                         TaskRunStatus,
                                         TaskType,
)
from app.models.task_run_verification_result import TaskRunVerificationResult
from app.models.template_candidate import TemplateCandidate
from app.models.test_deficiency import (
                                         DeficiencySeverity,
                                         DeficiencyStatus,
                                         DeficiencyType,
                                         TestDeficiency,
)
from app.models.test_notification_preferences import TestNotificationPreferences
from app.models.test_result import TestResult, TestResultStatus
from app.models.test_screenshot import TestScreenshot, TestScreenshotType
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
from app.models.training_job import TrainingJob, TrainingJobModelType, TrainingJobStatus
from app.models.transition_execution import (
                                         TransitionExecution,
                                         TransitionExecutionStatus,
)
from app.models.transition_reliability import TransitionReliability
from app.models.ui_bridge_state import (
                                         DomainKnowledge,
                                         UIBridgeExplorationSession,
                                         UIBridgeState,
                                         UIBridgeStateConfig,
                                         UIBridgeStateDomainKnowledge,
)
from app.models.ui_bridge_transition import UIBridgeTransition
from app.models.unified_workflow import UnifiedWorkflow
from app.models.usage_metric import UsageMetric
from app.models.user import User
from app.models.verification_test import (
                                         VerificationTest,
                                         VerificationTestCategory,
                                         VerificationTestType,
)
from app.models.video_capture import (
                                         ActionFrame,
                                         FrameIndex,
                                         HistoricalResult,
                                         InputEvent,
                                         InputEventType,
                                         StorageBackend,
                                         VideoCaptureSession,
)
from app.models.visual_baseline import VisualBaseline
from app.models.visual_comparison_result import (
                                         ReviewDecision,
                                         VisualComparisonResult,
                                         VisualComparisonStatus,
)
from app.models.workflow_execution_history import WorkflowExecutionHistory
from app.models.workflow_step_type import (
                                         GuiActionTypeConfig,
                                         StepTypeConfig,
                                         WorkflowPhaseConfig,
)
from app.models.workflow_test_association import TriggerPoint, WorkflowTestAssociation
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
    "ProjectScreenshot",
    "ProjectImage",
    "ProjectAnnotationState",
    # AI Prompt Library
    "AIPromptTemplate",
    "PromptSequence",
    "PromptTemplateVersion",
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
    # Detected Issues
    "DetectedIssue",
    # Finding Category Configs
    "FindingCategoryConfig",
    # Discoveries
    "Discovery",
    # State Discovery
    "DiscoveredState",
    "StateTransition",
    "SyncLock",
    # Automation
    "EmbeddingGenerationJob",
    "ProjectEmbedding",
    "WorkflowExecutionHistory",
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
    "SnapshotAction",
    "SnapshotPattern",
    "SnapshotMatch",
    # Runner Connections
    "RunnerConnection",
    "RunnerDevice",
    # Version History & Event Sourcing
    "ProjectVersion",
    "EditCommand",
    # Element Annotations (Project-scoped)
    "ElementAnnotation",
    "ElementAnnotationSet",
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
    # Video Capture & Historical Data
    "VideoCaptureSession",
    "InputEvent",
    "InputEventType",
    "FrameIndex",
    "ActionFrame",
    "HistoricalResult",
    "StorageBackend",
    # Software Testing
    "SoftwareTestRun",
    "TestRunStatus",
    "TransitionExecution",
    "TransitionExecutionStatus",
    "TestDeficiency",
    "DeficiencySeverity",
    "DeficiencyType",
    "DeficiencyStatus",
    "TestScreenshot",
    "TestScreenshotType",
    "TestNotificationPreferences",
    "CoverageSnapshot",
    "PathDiscovery",
    "TransitionReliability",
    # Visual Regression
    "VisualBaseline",
    "VisualComparisonResult",
    "VisualComparisonStatus",
    "ReviewDecision",
    # Unified Execution (NEW - replaces fragmented systems)
    "ExecutionRun",
    "ExecutionRunType",
    "ExecutionRunStatus",
    "ActionExecution",
    "ActionExecutionType",
    "ActionExecutionStatus",
    "ExecutionScreenshot",
    "ExecutionScreenshotType",
    "ExecutionIssue",
    "ExecutionIssueType",
    "ExecutionIssueSeverity",
    "ExecutionIssueStatus",
    "ExecutionIssueSource",
    # Tree Events (Execution Logging)
    "ExecutionTreeEvent",
    "TreeEventType",
    "TreeNodeType",
    "TreeNodeStatus",
    # Task Runs (Unified task tracking - renamed from AI Tasks)
    "TaskRun",
    "TaskRunStatus",
    "TaskRunSession",
    "TaskRunFinding",
    "TaskRunAutomation",
    "TaskType",
    "FindingCategory",
    "FindingSeverity",
    "FindingStatus",
    "FindingActionType",
    "TaskRunVerificationResult",
    # Backward compatibility aliases (deprecated)
    "AITask",
    "AITaskStatus",
    "AITaskSession",
    "AITaskFinding",
    "AITaskFindingCategory",
    "AITaskFindingSeverity",
    "AITaskFindingStatus",
    "AITaskFindingActionType",
    # Recordings (State Discovery from Video)
    "Recording",
    "RecordingStatus",
    "RecordingFrame",
    "RecordingInteraction",
    "RecordingContext",
    "DiscoveredTransition",
    "ProcessingLog",
    "ProcessingPhase",
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
    # Verification Tests
    "VerificationTest",
    "VerificationTestType",
    "VerificationTestCategory",
    "TestResult",
    "TestResultStatus",
    "WorkflowTestAssociation",
    "TriggerPoint",
    # Render Logging (Development Debugging)
    "RenderLog",
    "RenderImage",
    "RenderLogTrigger",
    "RenderLogMutationType",
    "RenderImageType",
    # UI Bridge State Discovery
    "UIBridgeStateConfig",
    "UIBridgeState",
    "UIBridgeExplorationSession",
    "DomainKnowledge",
    "UIBridgeStateDomainKnowledge",
    "UIBridgeTransition",
    # Training Jobs (ML Training Pipeline)
    "TrainingJob",
    "TrainingJobModelType",
    "TrainingJobStatus",
    # Unified State Discovery Results
    "StateDiscoveryResult",
    "DiscoverySourceType",
    # Template Capture (click-to-template)
    "TemplateCandidate",
    "ApplicationProfile",
    # State Machine Builder Configs
    "StateMachineConfig",
    # Workflow Step Type Configs
    "StepTypeConfig",
    "GuiActionTypeConfig",
    "WorkflowPhaseConfig",
    # Unified Workflows (workflow definitions - source of truth)
    "UnifiedWorkflow",
    # Skills (user-created parameterized step templates)
    "Skill",
    # Known Issues (verified/discovered issues tracked across executions)
    "KnownIssue",
    # Feedback Scores (Opik integration — quality metrics)
    "FeedbackScore",
    # Evaluation Datasets & Experiments (prompt variant evaluation)
    "EvaluationDataset",
    "DatasetItem",
    "EvaluationExperiment",
    "ExperimentResult",
]
