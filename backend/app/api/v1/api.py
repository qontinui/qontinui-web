"""API v1 router configuration.

This file mounts every router that ships with the OSS qontinui-web. The
qontinui.cloud deployment additionally attaches its proprietary cloud-only
routers (billing, cloud-admin, organizations multi-tenant, fleet-health,
beta-signup, cross-tenant audit-logs) by registering them with the
extension hook ``register_cloud_extensions(api_router)`` called at the
bottom of this module.

In the M1 scaffolding state of the cloud-control carve-out (post-3a,
mid-3b), some cloud-only routers are still imported directly here as well
— that is the carve-target. M2 of 3b moves those imports into
qontinui-cloud-control and they go away from this file. The hook call at
the bottom is already in place so the move is a delete-only diff in OSS.

See: D:/qontinui-root/qontinui-cloud-control/  (private repo)
     D:/qontinui-root/tmp_cloud_control_carve_out.md  §3 (register-hook
     surface) and §2 (file-by-file split).
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    admin_dev,
    agent_sessions,
    ai_prompts,
    analytics,
    annotations,
    annotations_ws,
    automation,
    automation_ws,
    background_removal,
    batch_import,
    capture,
    chat_sessions,
    clipboard,
    co_pilot_activity,
    code_execution,
    code_packages,
    collaboration,
    collaboration_ws,
    conflicts,
    constraints,
    custom_functions,
    devenv,
    devenv_agent,
    device_bridge_ws,
    devices,
    devices_ws,
    digital_twin,
    discoveries,
    element_annotations,
    error_monitor,
    evaluation,
    design_policies,
    events,
    execution,
    export,
    exports,
    extraction,
    feedback,
    feedback_scores,
    files_sharing,
    finding_categories,
    fleet_dispatch,
    health,
    historical,
    identity_resolution,
    images,
    integration_testing,
    issues,
    known_issues,
    library,
    notifications,
    operations,
    organizations,
    pair_codes,
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
    releases,
    render_logs,
    runner_chat,
    runner_chat_ws,
    runner_command_ws,
    runner_logs,
    runner_status_ws,
    runner_terminal_ws,
    runner_wake,
    runs_drift,
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
    strategy,
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
from app.extensions import register_cloud_extensions

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(public.router, prefix="/public", tags=["public"])
api_router.include_router(auth_pkg.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
# UI Bridge co-pilot activity feed (§4.8 of production-safe UI Bridge plan).
# Mounted as a sibling under /users/me so the Next.js relay's
# server-to-server insert lives under the caller's own URL space.
api_router.include_router(
    co_pilot_activity.router,
    prefix="/users/me/co-pilot",
    tags=["co-pilot-activity"],
)
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
api_router.include_router(releases.router, prefix="/releases", tags=["releases"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
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
# Unified devices registry — Phase 5 of plan
# ``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md`` retired
# ``/api/v1/runners/*`` (rename, no deprecation alias) in favour of
# ``/api/v1/devices/*``.
api_router.include_router(devices.router, prefix="/devices", tags=["devices"])
# Single-use pair codes (Phase 2a.1) — mounted under /devices/pair-codes.
# Sits next to devices.router because the redeem endpoint is the runner's
# entry point and lives in the same conceptual namespace.
api_router.include_router(
    organizations.router, prefix="/organizations", tags=["organizations"]
)
api_router.include_router(
    pair_codes.router, prefix="/devices/pair-codes", tags=["pair-codes"]
)
# Unified device-side WebSocket — coord-issued device-token JWT auth.
api_router.include_router(
    devices_ws.router, prefix="/devices", tags=["devices-websocket"]
)
# Wake an offline device from the web (Phase F.2 of scheduler reliability plan)
api_router.include_router(runner_wake.router, prefix="/device", tags=["device-wake"])
# Operations — fleet aggregation + cross-machine Claude session monitoring.
api_router.include_router(operations.router, prefix="/operations", tags=["operations"])
# Digital Twin Explorer (Phase 1) — coord-backed completeness matrix.
api_router.include_router(
    digital_twin.router, prefix="/digital-twin", tags=["digital-twin"]
)
# Environments digital-twin — user-scoped management API + machine-key agent API.
api_router.include_router(devenv.router, prefix="/devenv", tags=["environments"])
api_router.include_router(
    devenv_agent.router, prefix="/devenv", tags=["environments-agent"]
)
# Identity-contract I3-web — PR -> responsible qontinui user(s) resolver.
api_router.include_router(
    identity_resolution.router, prefix="/identity", tags=["identity-resolution"]
)
# Device process logs proxy — read persisted process logs from the device's PG DB
api_router.include_router(
    runner_logs.router, prefix="/device-logs", tags=["device-logs"]
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
    runner_command_ws.router, prefix="/devices", tags=["device-command-websockets"]
)
api_router.include_router(
    runner_chat_ws.router, prefix="/devices", tags=["device-chat-websockets"]
)
api_router.include_router(
    runner_terminal_ws.router,
    prefix="/devices",
    tags=["device-terminal-websockets"],
)
api_router.include_router(runner_chat.router, prefix="/devices", tags=["device-chat"])
api_router.include_router(chat_sessions.router, tags=["chat-sessions"])
api_router.include_router(runner_status_ws.router, tags=["device-status-websockets"])
api_router.include_router(rag_builder.router, prefix="/rag", tags=["rag-builder"])
api_router.include_router(
    rag_dashboard.router, prefix="/projects", tags=["rag-dashboard"]
)
api_router.include_router(issues.router, prefix="/issues", tags=["issues"])
api_router.include_router(
    historical.router, prefix="/testing/historical", tags=["historical-data"]
)
api_router.include_router(execution.router, prefix="/execution", tags=["execution"])
# Drift report endpoints — placeholder routes until the runner proxy lands.
# See: app/api/v1/endpoints/runs_drift.py
api_router.include_router(runs_drift.router, prefix="/runs", tags=["runs-drift"])
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
# Design/UX policies (tenant-scoped, auto-seeded, tool-agnostic source of truth)
api_router.include_router(
    design_policies.router,
    prefix="/design-policies",
    tags=["design-policies"],
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
# Fleet-fresh P4 — freshness-aware test-host resolution
api_router.include_router(
    fleet_dispatch.router, prefix="/dispatch", tags=["fleet-dispatch"]
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
# Strategy Collaboration (Phase 1, read-only doc proxy → coord)
api_router.include_router(strategy.router, prefix="/strategy", tags=["strategy"])
# Agent sessions observability — Side D / Phase 4 of plan
# coord-agent-session-id-tracking.md. Lists sessions from
# coord.agent_sessions + per-session lineage timeline.
api_router.include_router(
    agent_sessions.router, prefix="/admin", tags=["admin-agent-sessions"]
)
# Superuser gates & rollout dashboard — proxies coord GET /coord/dev-overview.
# NOTE: no prefix — the route already starts with /admin-dev, so the final
# path is /api/v1/admin-dev/overview (it must NOT inherit agent_sessions'
# /admin prefix).
api_router.include_router(admin_dev.router, tags=["admin-dev"])

# Cloud-control extension hook — no-op when no cloud-control package has
# registered any route extensions. Cloud-control's
# qontinui_cloud_control/__init__.py registers its routers via
# add_route_registrar(); this call fires those registrars onto api_router.
register_cloud_extensions(api_router)
