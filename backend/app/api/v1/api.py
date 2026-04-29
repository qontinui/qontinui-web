"""API v1 router configuration."""

from fastapi import APIRouter

from app.api.v1.endpoints import admin as admin_pkg
from app.api.v1.endpoints import (
    admin_ws,
    ai_prompts,
    analytics,
    annotations,
    annotations_ws,
    audit_logs,
    automation,
    automation_ws,
    background_removal,
    batch_import,
    billing,
    capture,
    chat_sessions,
    clipboard,
    code_execution,
    code_packages,
    collaboration,
    collaboration_ws,
    conflicts,
    constraints,
    custom_functions,
    device_bridge_ws,
    discoveries,
    element_annotations,
    error_monitor,
    evaluation,
    events,
    execution,
    export,
    exports,
    extraction,
    feedback,
    feedback_scores,
    files_sharing,
    finding_categories,
    health,
    historical,
    images,
    integration_testing,
    issues,
    known_issues,
    library,
    notifications,
    operations,
    organizations,
    phase_results,
    project_files,
    project_images,
    project_screenshots,
    project_sync,
    projects,
    prompt_versions,
    public,
    push_devices,
    rag_builder,
    rag_dashboard,
    recording_pipeline,
    recordings,
    render_logs,
    runner_chat,
    runner_chat_ws,
    runner_command_ws,
    runner_logs,
    runner_status_ws,
    runner_terminal_ws,
    runner_wake,
    runners,
    runners_ws,
    scheduled_runs,
    screenshots,
    security_endpoints,
    semantic_search,
    settings,
    skills,
    snapshots,
    state_discovery,
    state_discovery_results,
    state_machine_configs,
    task_runs,
    template_capture,
    training,
    training_datasets,
    ui_bridge_states,
    unified_workflows,
    users,
    variables,
    versions,
    videos,
    visual_baselines,
    visual_comparison,
    workflow_dispatch,
    workflow_step_types,
)
from app.api.v1.endpoints import auth as auth_pkg
from app.api.v1.endpoints import testing as testing_pkg

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(public.router, prefix="/public", tags=["public"])
api_router.include_router(auth_pkg.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(project_sync.router, tags=["project-sync"])
api_router.include_router(
    project_files.router, prefix="/projects", tags=["project-files"]
)
api_router.include_router(export.router, prefix="/projects", tags=["export"])
api_router.include_router(images.router, prefix="/projects", tags=["images"])
api_router.include_router(
    project_images.router, prefix="/projects", tags=["project-images"]
)
api_router.include_router(
    project_screenshots.router, prefix="/projects", tags=["project-screenshots"]
)
api_router.include_router(
    integration_testing.router,
    prefix="/integration-testing",
    tags=["integration-testing"],
)
api_router.include_router(snapshots.router, prefix="/snapshots", tags=["snapshots"])
api_router.include_router(background_removal.router, tags=["background-removal"])
api_router.include_router(analytics.router, tags=["analytics"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(admin_pkg.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_ws.router, prefix="/admin", tags=["admin-websockets"])
api_router.include_router(
    audit_logs.router, prefix="/admin/audit-logs", tags=["audit-logs"]
)
api_router.include_router(automation.router, prefix="/automation", tags=["automation"])
api_router.include_router(
    automation_ws.router, prefix="/automation", tags=["automation-websockets"]
)
api_router.include_router(
    code_execution.router, prefix="/code-execution", tags=["code-execution"]
)
api_router.include_router(
    annotations.router, prefix="/annotations", tags=["annotations"]
)
api_router.include_router(annotations_ws.router, tags=["annotations-websockets"])
api_router.include_router(feedback.router, tags=["feedback"])
api_router.include_router(
    organizations.router, prefix="/organizations", tags=["organizations"]
)
api_router.include_router(
    collaboration.router, prefix="/projects", tags=["collaboration"]
)
api_router.include_router(collaboration_ws.router, tags=["collaboration-websockets"])
api_router.include_router(conflicts.router, tags=["conflicts"])
api_router.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)
api_router.include_router(
    state_discovery.router, prefix="/state-discovery", tags=["state-discovery"]
)
api_router.include_router(videos.router, prefix="/videos", tags=["videos"])
api_router.include_router(runners.router, prefix="/runners", tags=["runners"])
# Unified runner-side WebSocket (Phase 2B) — runner-token bearer auth.
api_router.include_router(
    runners_ws.router, prefix="/runners", tags=["runners-websocket"]
)
# Wake an offline runner from the web (Phase F.2 of scheduler reliability plan)
api_router.include_router(runner_wake.router, prefix="/runner", tags=["runner-wake"])
# Operations — fleet aggregation + cross-machine Claude session monitoring.
api_router.include_router(operations.router, prefix="/operations", tags=["operations"])
# Runner process logs proxy — read persisted process logs from runner's PG DB
api_router.include_router(
    runner_logs.router, prefix="/runner-logs", tags=["runner-logs"]
)
api_router.include_router(versions.router, prefix="/projects", tags=["versions"])
api_router.include_router(
    security_endpoints.router, prefix="/security", tags=["security"]
)
api_router.include_router(variables.router, tags=["variables"])
api_router.include_router(
    code_packages.router, prefix="/code-packages", tags=["code-packages"]
)
api_router.include_router(custom_functions.router, tags=["custom-functions"])
api_router.include_router(ai_prompts.router, tags=["ai-prompts"])
api_router.include_router(capture.router, prefix="/capture", tags=["capture-sessions"])
api_router.include_router(testing_pkg.router, prefix="/testing", tags=["testing"])
api_router.include_router(
    visual_baselines.router, prefix="/testing", tags=["visual-regression"]
)
api_router.include_router(
    visual_comparison.router, prefix="/testing", tags=["visual-regression"]
)
api_router.include_router(
    training_datasets.router, prefix="/datasets", tags=["training-datasets"]
)
api_router.include_router(recordings.router, prefix="/recordings", tags=["recordings"])
# Recording pipeline — process UI Bridge recordings into state machines
api_router.include_router(
    recording_pipeline.router,
    prefix="/recording-pipeline",
    tags=["recording-pipeline"],
)
api_router.include_router(extraction.router, tags=["extraction"])
api_router.include_router(
    runner_command_ws.router, prefix="/runners", tags=["runner-command-websockets"]
)
api_router.include_router(
    runner_chat_ws.router, prefix="/runners", tags=["runner-chat-websockets"]
)
api_router.include_router(
    runner_terminal_ws.router,
    prefix="/runners",
    tags=["runner-terminal-websockets"],
)
api_router.include_router(runner_chat.router, prefix="/runners", tags=["runner-chat"])
api_router.include_router(chat_sessions.router, tags=["chat-sessions"])
api_router.include_router(runner_status_ws.router, tags=["runner-status-websockets"])
api_router.include_router(rag_builder.router, prefix="/rag", tags=["rag-builder"])
api_router.include_router(
    rag_dashboard.router, prefix="/projects", tags=["rag-dashboard"]
)
api_router.include_router(issues.router, prefix="/issues", tags=["issues"])
api_router.include_router(
    historical.router, prefix="/testing/historical", tags=["historical-data"]
)
api_router.include_router(execution.router, prefix="/execution", tags=["execution"])
api_router.include_router(
    discoveries.router, prefix="/discoveries", tags=["discoveries"]
)
# Unified task runs - the single endpoint for all task types
api_router.include_router(task_runs.router, prefix="/task-runs", tags=["task-runs"])
# Render logging for development debugging (disabled in production)
api_router.include_router(
    render_logs.router, prefix="/render-logs", tags=["render-logs"]
)
# UI Bridge state discovery and management
api_router.include_router(ui_bridge_states.router, tags=["ui-bridge-states"])
# Training data export endpoints (S3 and local filesystem)
api_router.include_router(exports.router, prefix="/exports", tags=["exports"])
# Element annotations (project-scoped)
api_router.include_router(
    element_annotations.router, prefix="/projects", tags=["element-annotations"]
)
# Training jobs (ML training pipeline)
api_router.include_router(training.router, prefix="/training", tags=["training"])
# Batch import annotations from folder
api_router.include_router(
    batch_import.router, prefix="/annotations", tags=["batch-import"]
)
# Unified state discovery results (from any source: Playwright, UI Bridge, etc.)
api_router.include_router(
    state_discovery_results.router, tags=["state-discovery-results"]
)
# Template capture (click-to-template system)
api_router.include_router(
    template_capture.router, prefix="/template-capture", tags=["template-capture"]
)
# State machine builder configs (persisted to PostgreSQL)
api_router.include_router(state_machine_configs.router, tags=["state-machine-configs"])
# Finding category configurations (per-user, auto-seeded)
api_router.include_router(
    finding_categories.router,
    prefix="/finding-categories",
    tags=["finding-categories"],
)
# Workflow step types, GUI action types, and phases (per-user, auto-seeded)
api_router.include_router(
    workflow_step_types.router,
    prefix="/workflow-config",
    tags=["workflow-config"],
)
# Skills (user-created parameterized step templates)
api_router.include_router(skills.router, prefix="/skills", tags=["skills"])
# Unified workflows (workflow definitions - source of truth)
api_router.include_router(
    unified_workflows.router, prefix="/unified-workflows", tags=["unified-workflows"]
)
# Workflow dispatch — user-triggered routing to server-mode runners
api_router.include_router(
    workflow_dispatch.router, prefix="/workflows", tags=["workflow-dispatch"]
)
# Scheduled workflow runs (cron-driven dispatch via celery-beat / redbeat)
api_router.include_router(
    scheduled_runs.router,
    prefix="/scheduled-runs",
    tags=["scheduled-runs"],
)
# Cross-entity semantic search
api_router.include_router(
    semantic_search.router, prefix="/search", tags=["semantic-search"]
)
# Library items (checks, check groups, shell commands, API requests, contexts, macros, prompt snippets)
api_router.include_router(library.router, prefix="/library", tags=["library"])
# Error monitor entries
api_router.include_router(
    error_monitor.router, prefix="/error-monitor", tags=["error-monitor"]
)
# Known issues (verified/discovered issues tracked across executions)
api_router.include_router(
    known_issues.router, prefix="/known-issues", tags=["known-issues"]
)
# Screenshot proxy (serves verification screenshots from runner's .dev-logs)
api_router.include_router(
    screenshots.router, prefix="/screenshots", tags=["screenshots"]
)
# Constraint engine proxy (forwards to runner HTTP API)
api_router.include_router(
    constraints.router, prefix="/constraints", tags=["constraints"]
)
# Feedback scores (Opik integration — quality metrics on runs and actions)
api_router.include_router(feedback_scores.router, tags=["feedback-scores"])
# Prompt versions (Opik integration — prompt template version history and diff)
api_router.include_router(prompt_versions.router, tags=["prompt-versions"])
# Evaluation datasets and experiments (Opik integration — dataset management and experiment tracking)
api_router.include_router(evaluation.router, prefix="/evaluation", tags=["evaluation"])
# Workflow events (runner-to-cloud event ingestion for push notifications)
api_router.include_router(events.router, prefix="/events", tags=["events"])
# Phase results (server-mode runner phase-completion history)
api_router.include_router(
    phase_results.router, prefix="/phase-results", tags=["phase-results"]
)
# Push device registration (mobile push notification tokens)
api_router.include_router(push_devices.router, prefix="/devices", tags=["push-devices"])
# Clipboard sync relay (cross-device clipboard sharing)
api_router.include_router(clipboard.router, prefix="/clipboard", tags=["clipboard"])
# File sharing (cross-device file upload/download)
api_router.include_router(files_sharing.router, prefix="/files", tags=["files-sharing"])
# Device bridge (cloud relay for physical mobile device UI Bridge connections)
api_router.include_router(
    device_bridge_ws.router, prefix="/device-bridge", tags=["device-bridge"]
)
