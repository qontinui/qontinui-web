"use client";

/**
 * TimelineTab - Staged workflow timeline (matches runner's StagedTimeline)
 *
 * Displays workflow steps grouped by phase (setup, verification, agentic, completion)
 * with collapsible stage sections, status icons, durations, iteration badges,
 * progress bars, and placeholder stages for phases that never ran.
 *
 * Uses the /checkpoints endpoint to get step-level data with phase/iteration grouping.
 * Falls back to flat events if no checkpoints are available.
 */

import { useState, useMemo } from "react";
import {
  useTaskRunCheckpoints,
  useTaskRunEvents,
} from "@/lib/runner-api";
import type { Checkpoint, TaskRunEvent } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Activity,
  Settings,
  Bot,
  CheckSquare,
  Flag,
  ChevronDown,
  ChevronRight,
  Terminal,
  TestTube2,
  MousePointer2,
  MessageSquare,
  FileCode,
  PlayCircle,
  GitBranch,
  Navigation,
  Globe,
  Eye,
  Code,
  Package,
  Camera,
  AlertTriangle,
  FileType,
  Search,
  CheckCircle,
  List,
  Play,
  FileSearch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

type WorkflowPhase = "setup" | "verification" | "agentic" | "completion";

/** Parsed enrichment data from checkpoint result_json */
interface ParsedStepData {
  iconType?: string;
  workSummary?: string;
  summary?: string;
  error?: string;
  progress?: {
    current: number;
    total: number | null;
    type: string;
    description?: string;
  };
}

interface StageData {
  phase: WorkflowPhase;
  displayName: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  steps: Checkpoint[];
  iteration: number | null;
}

// =============================================================================
// Constants (matching runner's WORKFLOW_STAGE_CONFIG and step-icons.ts)
// =============================================================================

const PHASE_ORDER: Record<string, number> = {
  setup: 0,
  verification: 1,
  agentic: 2,
  completion: 3,
};

const PHASE_LABELS: Record<WorkflowPhase, string> = {
  setup: "Setup",
  verification: "Verification",
  agentic: "Agentic",
  completion: "Completion",
};

const PHASE_ICONS: Record<WorkflowPhase, LucideIcon> = {
  setup: Settings,
  verification: CheckSquare,
  agentic: Bot,
  completion: Flag,
};

// Phase colors matching runner's WORKFLOW_STAGE_CONFIG:
// setup=blue, agentic=green, verification=purple, completion=teal(cyan)
const PHASE_COLORS: Record<WorkflowPhase, { bg: string; text: string }> = {
  setup: { bg: "bg-blue-500/10", text: "text-blue-400" },
  verification: { bg: "bg-purple-500/10", text: "text-purple-400" },
  agentic: { bg: "bg-green-500/10", text: "text-green-400" },
  completion: { bg: "bg-teal-500/10", text: "text-teal-400" },
};

// Step type to icon mapping (matches runner's STEP_ICON_CONFIG in step-icons.ts)
const STEP_TYPE_ICONS: Record<string, { icon: LucideIcon; bg: string; text: string }> = {
  // AI steps
  ai_session: { icon: MessageSquare, bg: "bg-amber-500/10", text: "text-amber-400" },
  ai: { icon: MessageSquare, bg: "bg-amber-500/10", text: "text-amber-400" },
  ai_analysis: { icon: MessageSquare, bg: "bg-amber-500/10", text: "text-amber-400" },
  prompt: { icon: MessageSquare, bg: "bg-amber-500/10", text: "text-amber-400" },
  // Setup/scripting steps
  script: { icon: FileCode, bg: "bg-emerald-500/10", text: "text-emerald-400" },
  state: { icon: Navigation, bg: "bg-blue-500/10", text: "text-blue-400" },
  workflow: { icon: GitBranch, bg: "bg-purple-500/10", text: "text-purple-400" },
  workflow_ref: { icon: GitBranch, bg: "bg-purple-500/10", text: "text-purple-400" },
  // Interaction steps
  gui_action: { icon: MousePointer2, bg: "bg-orange-500/10", text: "text-orange-400" },
  action: { icon: MousePointer2, bg: "bg-orange-500/10", text: "text-orange-400" },
  automation: { icon: MousePointer2, bg: "bg-orange-500/10", text: "text-orange-400" },
  shell_command: { icon: Terminal, bg: "bg-gray-500/10", text: "text-gray-400" },
  shell: { icon: Terminal, bg: "bg-gray-500/10", text: "text-gray-400" },
  api_request: { icon: Globe, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  // Test steps
  test: { icon: TestTube2, bg: "bg-green-500/10", text: "text-green-400" },
  test_playwright: { icon: TestTube2, bg: "bg-green-500/10", text: "text-green-400" },
  playwright: { icon: TestTube2, bg: "bg-green-500/10", text: "text-green-400" },
  test_vision: { icon: Eye, bg: "bg-green-500/10", text: "text-green-400" },
  test_python: { icon: Code, bg: "bg-green-500/10", text: "text-green-400" },
  test_repository: { icon: Package, bg: "bg-green-500/10", text: "text-green-400" },
  // Check steps
  check: { icon: AlertTriangle, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  check_lint: { icon: AlertTriangle, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  check_typecheck: { icon: FileType, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  check_build: { icon: Package, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  check_group: { icon: CheckCircle, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  check_ci_cd: { icon: GitBranch, bg: "bg-purple-500/10", text: "text-purple-400" },
  log_watch: { icon: FileSearch, bg: "bg-cyan-500/10", text: "text-cyan-400" },
  error_resolved: { icon: CheckCircle, bg: "bg-green-500/10", text: "text-green-400" },
  // Other
  screenshot: { icon: Camera, bg: "bg-pink-500/10", text: "text-pink-400" },
  // AWAS step types
  awas_discover: { icon: Search, bg: "bg-teal-500/10", text: "text-teal-400" },
  awas_execute: { icon: Play, bg: "bg-teal-500/10", text: "text-teal-400" },
  awas_check_support: { icon: CheckCircle, bg: "bg-teal-500/10", text: "text-teal-400" },
  awas_list_actions: { icon: List, bg: "bg-teal-500/10", text: "text-teal-400" },
  awas_extract_elements: { icon: FileSearch, bg: "bg-teal-500/10", text: "text-teal-400" },
};

// Progress type to color mapping (matches runner's InlineProgressBar semantic coloring)
const PROGRESS_COLORS: Record<string, { bar: string; text: string }> = {
  file_progress: { bar: "bg-blue-500", text: "text-blue-400" },
  analysis_progress: { bar: "bg-purple-500", text: "text-purple-400" },
  test_progress: { bar: "bg-green-500", text: "text-green-400" },
  review_progress: { bar: "bg-amber-500", text: "text-amber-400" },
  iteration_progress: { bar: "bg-cyan-500", text: "text-cyan-400" },
  default: { bar: "bg-text-muted", text: "text-text-muted" },
};

// =============================================================================
// Formatting helpers
// =============================================================================

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60)
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

// =============================================================================
// Status icon helper (matches runner's status-icons.tsx)
// =============================================================================

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
    case "complete":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "running":
      return <Activity className="size-4 text-blue-500 animate-pulse" />;
    case "skipped":
    case "pending":
      return <AlertCircle className="size-4 text-yellow-500" />;
    default:
      return <Clock className="size-4 text-text-muted" />;
  }
}

// =============================================================================
// Step type icon helper (supports icon_type fallback like runner)
// =============================================================================

function getStepTypeIcon(
  stepType: string,
  iconType?: string,
): {
  icon: LucideIcon;
  bg: string;
  text: string;
} {
  // Prefer icon_type if available (more specific), fallback to step_type
  if (iconType && STEP_TYPE_ICONS[iconType]) {
    return STEP_TYPE_ICONS[iconType];
  }
  return (
    STEP_TYPE_ICONS[stepType] || {
      icon: Activity,
      bg: "bg-zinc-500/10",
      text: "text-zinc-400",
    }
  );
}

// =============================================================================
// Parse enrichment data from checkpoint result_json
// =============================================================================

function parseStepData(step: Checkpoint): ParsedStepData {
  const result: ParsedStepData = {};
  if (!step.result_json) return result;

  try {
    const parsed = JSON.parse(step.result_json);
    result.iconType = parsed.icon_type || undefined;
    result.workSummary = parsed.work_summary || undefined;
    result.summary = parsed.summary || parsed.message || undefined;
    if (parsed.error) result.error = parsed.error;
    if (parsed.progress && typeof parsed.progress === "object") {
      result.progress = {
        current: parsed.progress.current ?? 0,
        total: parsed.progress.total ?? null,
        type: parsed.progress.type || "default",
        description: parsed.progress.description || undefined,
      };
    }
  } catch {
    // ignore parse errors
  }

  return result;
}

// =============================================================================
// Inline progress bar (matches runner's InlineProgressBar)
// =============================================================================

function InlineProgressBar({
  current,
  total,
  progressType,
}: {
  current: number;
  total: number;
  progressType: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const colors = PROGRESS_COLORS[progressType] ?? PROGRESS_COLORS["default"]!;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex w-16 h-1.5 rounded-full bg-surface-canvas/50 overflow-hidden">
        <span
          className={`h-full rounded-full ${colors.bar} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={`text-xs ${colors.text} tabular-nums`}>
        {current}/{total}
      </span>
    </span>
  );
}

// =============================================================================
// Build stages from checkpoints (mirrors runner's stage_builder.rs)
// =============================================================================

function buildStagesFromCheckpoints(checkpoints: Checkpoint[]): StageData[] {
  // Group checkpoints by phase + iteration
  const groups = new Map<string, Checkpoint[]>();

  for (const cp of checkpoints) {
    const phase = cp.phase || "agentic";
    const iter = cp.iteration ?? 0;
    const key = `${phase}-${iter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cp);
  }

  const stages: StageData[] = [];

  for (const [key, steps] of groups) {
    const [phase, iterStr] = key.split("-");
    const iteration = parseInt(iterStr!, 10);
    const validPhase = (phase as WorkflowPhase) || "agentic";

    // Sort steps by step_index
    steps.sort((a, b) => a.step_index - b.step_index);

    // Compute stage status
    let status = "pending";
    if (steps.some((s) => s.status === "running")) {
      status = "running";
    } else if (steps.some((s) => s.status === "failed")) {
      status = "failed";
    } else if (steps.every((s) => s.status === "success")) {
      status = "success";
    } else if (steps.some((s) => s.status === "success")) {
      status = "success";
    }

    // Compute stage timing
    const timestamps = steps
      .filter((s) => s.started_at)
      .map((s) => new Date(s.started_at!).getTime());
    const endTimestamps = steps
      .filter((s) => s.completed_at)
      .map((s) => new Date(s.completed_at!).getTime());

    const startedAt =
      timestamps.length > 0
        ? steps.find(
            (s) =>
              s.started_at &&
              new Date(s.started_at).getTime() === Math.min(...timestamps)
          )?.started_at ?? null
        : null;

    const endedAt =
      endTimestamps.length > 0
        ? steps.find(
            (s) =>
              s.completed_at &&
              new Date(s.completed_at).getTime() === Math.max(...endTimestamps)
          )?.completed_at ?? null
        : null;

    // Compute total duration from individual step durations
    const totalDurationMs = steps.reduce(
      (sum, s) => sum + (s.duration_ms || 0),
      0
    );

    // Show iteration for verification/agentic when iteration is defined
    // (matches runner: shows iteration badge when stage.iteration !== undefined)
    const showIteration =
      (validPhase === "verification" || validPhase === "agentic") &&
      iteration > 0
        ? iteration
        : null;

    stages.push({
      phase: validPhase,
      displayName: PHASE_LABELS[validPhase] || validPhase,
      status,
      startedAt,
      endedAt,
      durationMs: totalDurationMs > 0 ? totalDurationMs : null,
      steps,
      iteration: showIteration,
    });
  }

  // Sort stages: setup first, then verification/agentic interleaved by iteration, completion last
  stages.sort((a, b) => {
    const aPhase = PHASE_ORDER[a.phase] ?? 2;
    const bPhase = PHASE_ORDER[b.phase] ?? 2;
    const aIter = a.iteration ?? 0;
    const bIter = b.iteration ?? 0;

    // Setup always first, completion always last
    if (aPhase === 0 || bPhase === 0 || aPhase === 3 || bPhase === 3) {
      return aPhase - bPhase;
    }

    // For verification and agentic: sort by iteration first
    if (aIter !== bIter) return aIter - bIter;

    // Same iteration: verification before agentic
    if (aPhase !== bPhase) return aPhase - bPhase;

    // Same phase and iteration: use timestamps if available
    if (a.startedAt && b.startedAt) {
      return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    }
    return 0;
  });

  return stages;
}

// =============================================================================
// StepItem - Individual step within a stage (matches runner's StepItem)
// =============================================================================

function StepItem({ step }: { step: Checkpoint }) {
  // Parse enrichment data from result_json
  const parsed = parseStepData(step);

  const {
    icon: StepIcon,
    bg: iconBg,
    text: iconText,
  } = getStepTypeIcon(step.step_type, parsed.iconType);

  // Prefer work_summary (AI-generated) over summary (deterministic), matching runner
  const displaySummary = parsed.workSummary || parsed.summary || null;
  const error = step.error || parsed.error || null;
  const showError = error && error !== displaySummary;

  const displayName = step.step_name || step.step_type;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-canvas/30 transition-colors">
      {/* Status icon */}
      <StatusIcon status={step.status} />

      {/* Step type icon */}
      <div className={`p-1 rounded ${iconBg}`}>
        <StepIcon className={`size-3 ${iconText}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-text-primary truncate">
            {displayName}
          </span>
          {step.duration_ms != null && (
            <span className="text-xs text-text-muted">
              ({formatDuration(step.duration_ms)})
            </span>
          )}
          {/* Progress bar (matches runner's InlineProgressBar) */}
          {parsed.progress && parsed.progress.total !== null && (
            <InlineProgressBar
              current={parsed.progress.current}
              total={parsed.progress.total}
              progressType={parsed.progress.type}
            />
          )}
        </div>
        {displaySummary && (
          <p className="text-xs text-text-muted truncate mt-0.5">
            {displaySummary}
          </p>
        )}
        {/* Progress description if available */}
        {parsed.progress?.description && (
          <p className="text-xs text-text-muted truncate mt-0.5">
            {parsed.progress.description}
          </p>
        )}
        {showError && (
          <p className="text-xs text-red-400 truncate mt-0.5">{error}</p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// StageSection - Collapsible stage group (matches runner's StageSection)
// =============================================================================

function StageSection({ stage }: { stage: StageData }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = PHASE_ICONS[stage.phase] || Activity;
  const colors = PHASE_COLORS[stage.phase] || PHASE_COLORS.setup;

  return (
    <div className="rounded-lg border border-border-subtle/50 bg-surface-raised/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-canvas/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded ${colors.bg}`}>
            <Icon className={`size-4 ${colors.text}`} />
          </div>
          <span className="font-medium text-text-primary">
            {stage.displayName}
          </span>
          <StatusIcon status={stage.status} />
          {/* Iteration badge for verification/agentic (matches runner) */}
          {stage.iteration != null && (
            <span className="text-xs text-text-muted bg-surface-canvas/50 px-1.5 py-0.5 rounded">
              Iteration {stage.iteration}
            </span>
          )}
          <span className="text-sm text-text-muted">
            ({stage.steps.length}{" "}
            {stage.steps.length === 1 ? "step" : "steps"})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {stage.durationMs != null && (
            <span className="text-sm text-text-muted">
              {formatDuration(stage.durationMs)}
            </span>
          )}
          {stage.steps.length > 0 &&
            (expanded ? (
              <ChevronDown className="size-4 text-text-muted" />
            ) : (
              <ChevronRight className="size-4 text-text-muted" />
            ))}
        </div>
      </button>

      {expanded && stage.steps.length > 0 && (
        <div className="border-t border-border-subtle/50 p-2 space-y-1">
          {stage.steps.map((step, i) => (
            <StepItem key={`${step.id}-${i}`} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Fallback: Flat event timeline (used when no checkpoints exist)
// =============================================================================

function FlatEventTimeline({ events }: { events: TaskRunEvent[] }) {
  return (
    <div className="relative">
      <div className="absolute left-6 top-0 bottom-0 w-px bg-border-subtle/50" />
      <div className="space-y-3">
        {events.map((event) => {
          const isComplete =
            event.event_type.includes("complete") ||
            event.event_type.includes("success");
          const isFailed =
            event.event_type.includes("fail") ||
            event.event_type.includes("error");

          return (
            <div
              key={event.id}
              className="relative flex items-start gap-4 pl-3"
            >
              <div
                className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full border-2 ${
                  isComplete
                    ? "border-green-500 bg-green-500/10"
                    : isFailed
                      ? "border-red-500 bg-red-500/10"
                      : "border-border-subtle bg-surface-raised"
                }`}
              >
                {isComplete ? (
                  <CheckCircle2 className="size-3.5 text-green-500" />
                ) : isFailed ? (
                  <XCircle className="size-3.5 text-red-500" />
                ) : (
                  <PlayCircle className="size-3.5 text-text-muted" />
                )}
              </div>
              <div className="flex-1 rounded-lg border border-border-subtle/50 bg-surface-raised/30 py-3 px-4">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    {event.event_type}
                  </Badge>
                  <span className="text-xs text-text-muted">
                    {new Date(event.timestamp).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function TimelineTab({ runId }: { runId: string }) {
  const checkpointsQuery = useTaskRunCheckpoints(runId);
  const eventsQuery = useTaskRunEvents(runId);

  const isLoading = checkpointsQuery.isLoading && eventsQuery.isLoading;
  const error = checkpointsQuery.error && eventsQuery.error;

  const checkpoints = checkpointsQuery.data ?? [];
  const events = eventsQuery.data ?? [];

  // Build stages from checkpoints
  const stages = useMemo(
    () => buildStagesFromCheckpoints(checkpoints),
    [checkpoints]
  );

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading timeline...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        Error loading timeline data
      </div>
    );
  }

  // Prefer staged view from checkpoints
  if (stages.length > 0) {
    return (
      <div className="space-y-3">
        {stages.map((stage, index) => (
          <StageSection
            key={`${stage.phase}-${stage.iteration ?? index}`}
            stage={stage}
          />
        ))}
      </div>
    );
  }

  // Fall back to flat events if no checkpoints
  if (events.length > 0) {
    return <FlatEventTimeline events={events as TaskRunEvent[]} />;
  }

  return (
    <div className="text-center py-12 text-text-muted">
      <Clock className="size-12 mx-auto mb-4 opacity-50" />
      <p>No timeline data for this run.</p>
      <p className="text-sm mt-1">
        Steps will appear here once the workflow starts executing.
      </p>
    </div>
  );
}
