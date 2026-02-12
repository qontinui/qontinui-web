"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  TaskRun,
  CurrentExecutionStepsResponse,
  VerificationData,
  TaskRunKnowledge,
  Screenshot,
  McpCall,
  Finding,
} from "@/lib/runner-api";
import {
  RunnerEventProvider,
  useEventTriggeredFetch,
  useRunnerEvent,
} from "@/contexts/RunnerEventContext";
import {
  SharedRunnerDataProvider,
  useSharedStepsData,
} from "@/contexts/SharedRunnerDataContext";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ControlBar } from "@/components/active-dashboard/ControlBar";
import { BottomBar } from "@/components/active-dashboard/BottomBar";
import { AiConversationWidget } from "@/components/active-dashboard/widgets/AiConversationWidget";
import { ExecutionTimelineWidget } from "@/components/active-dashboard/widgets/ExecutionTimelineWidget";
import { FindingsWidget } from "@/components/active-dashboard/widgets/FindingsWidget";
import { VerificationWidget } from "@/components/active-dashboard/widgets/VerificationWidget";
import { ExecutionStatusWidget } from "@/components/active-dashboard/widgets/ExecutionStatusWidget";
import { McpCallsWidget } from "@/components/active-dashboard/widgets/McpCallsWidget";
import { ScreenshotsWidget } from "@/components/active-dashboard/widgets/ScreenshotsWidget";
import { toast } from "sonner";
import { runnerApi } from "@/lib/runner-api";
import {
  AUTO_RUN_AFTER_GENERATE_KEY,
  type AutoRunAfterGenerate,
} from "@/components/workflow-builder/AiGeneratePanel";
import { cn } from "@/lib/utils";
import {
  Activity,
  RefreshCw,
  PlayCircle,
  Inbox,
  Clock,
  MessageSquare,
  Bug,
  ShieldCheck,
  Gauge,
  Plug,
  Camera,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Image as ImageIcon,
  ChevronRight,
  RotateCcw,
  Terminal,
  Globe,
  FileCode,
  GitBranch,
  Lock,
  Hash,
  History,
  Rocket,
} from "lucide-react";

// =============================================================================
// Transform helpers (replicating runner-api hook transforms)
// =============================================================================

function transformScreenshots(raw: unknown): Screenshot[] {
  const obj = raw as Record<string, unknown>;
  if (obj && typeof obj === "object" && "screenshots" in obj && Array.isArray(obj.screenshots))
    return obj.screenshots as Screenshot[];
  if (Array.isArray(raw)) return raw as Screenshot[];
  return [];
}

function transformVerification(raw: unknown): VerificationData {
  const obj = raw as Record<string, unknown>;
  if (obj && typeof obj === "object" && "results" in obj && Array.isArray(obj.results)) {
    return {
      results: obj.results as import("@/lib/runner-api").VerificationResult[],
      summary: (obj.summary as import("@/lib/runner-api").VerificationSummary) ?? null,
    };
  }
  if (Array.isArray(raw))
    return { results: raw as import("@/lib/runner-api").VerificationResult[], summary: null };
  return { results: [], summary: null };
}

function transformKnowledge(raw: unknown): TaskRunKnowledge {
  const obj = raw as Record<string, unknown>;
  if (obj && typeof obj === "object" && "knowledge" in obj && Array.isArray(obj.knowledge)) {
    const items = obj.knowledge as Array<Record<string, unknown>>;
    return {
      findings: items.filter((k) => k.category === "finding") as unknown as Finding[],
      observations: items
        .filter((k) => k.category === "observation")
        .map((k) => String(k.content || k.title || "")),
      hypotheses: items
        .filter((k) => k.category === "hypothesis")
        .map((k) => String(k.content || k.title || "")),
    };
  }
  if (obj && "findings" in obj) return obj as unknown as TaskRunKnowledge;
  return { findings: [], observations: [], hypotheses: [] };
}

function transformMcpCalls(raw: unknown): McpCall[] {
  const obj = raw as Record<string, unknown>;
  if (obj && typeof obj === "object" && "calls" in obj && Array.isArray(obj.calls))
    return obj.calls as McpCall[];
  if (Array.isArray(raw)) return raw as McpCall[];
  return [];
}

// =============================================================================
// Widget Configuration
// =============================================================================

type WidgetId =
  | "timeline"
  | "ai-conversation"
  | "screenshots"
  | "verification"
  | "findings"
  | "mcp-calls"
  | "status"
  | "shell-command"
  | "api-request"
  | "script"
  | "workflow-ref"
  | "flow-execution";

interface WidgetConfig {
  id: WidgetId;
  label: string;
  icon: typeof Clock;
  accentColor: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  priority: number;
}

const WIDGET_CONFIGS: WidgetConfig[] = [
  {
    id: "timeline",
    label: "Timeline",
    icon: Clock,
    accentColor: "cyan",
    textColor: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/40",
    priority: 5,
  },
  {
    id: "ai-conversation",
    label: "AI Conversation",
    icon: MessageSquare,
    accentColor: "green",
    textColor: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/40",
    priority: 20,
  },
  {
    id: "screenshots",
    label: "Screenshots",
    icon: Camera,
    accentColor: "blue",
    textColor: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/40",
    priority: 10,
  },
  {
    id: "verification",
    label: "Verification",
    icon: ShieldCheck,
    accentColor: "teal",
    textColor: "text-teal-400",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/40",
    priority: 15,
  },
  {
    id: "findings",
    label: "Findings",
    icon: Bug,
    accentColor: "amber",
    textColor: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/40",
    priority: 30,
  },
  {
    id: "mcp-calls",
    label: "MCP Calls",
    icon: Plug,
    accentColor: "violet",
    textColor: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/40",
    priority: 24,
  },
  {
    id: "status",
    label: "Execution Status",
    icon: Gauge,
    accentColor: "cyan",
    textColor: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/40",
    priority: 35,
  },
  {
    id: "shell-command",
    label: "Shell Commands",
    icon: Terminal,
    accentColor: "orange",
    textColor: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/40",
    priority: 22,
  },
  {
    id: "api-request",
    label: "API Requests",
    icon: Globe,
    accentColor: "sky",
    textColor: "text-sky-400",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/40",
    priority: 23,
  },
  {
    id: "script",
    label: "Scripts",
    icon: FileCode,
    accentColor: "lime",
    textColor: "text-lime-400",
    bgColor: "bg-lime-500/10",
    borderColor: "border-lime-500/40",
    priority: 26,
  },
  {
    id: "workflow-ref",
    label: "Sub-Workflows",
    icon: GitBranch,
    accentColor: "pink",
    textColor: "text-pink-400",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/40",
    priority: 28,
  },
  {
    id: "flow-execution",
    label: "Flow Execution",
    icon: Activity,
    accentColor: "rose",
    textColor: "text-rose-400",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/40",
    priority: 32,
  },
];

function getWidgetConfig(id: WidgetId): WidgetConfig {
  return WIDGET_CONFIGS.find((w) => w.id === id)!;
}

// =============================================================================
// Widget Detection
// =============================================================================

function detectWidgets(
  stepsData: CurrentExecutionStepsResponse | null
): WidgetId[] {
  // Always show these core widgets
  const widgets: WidgetId[] = [
    "timeline",
    "ai-conversation",
    "status",
    "findings",
  ];

  if (!stepsData?.executions) {
    return widgets.sort(
      (a, b) => getWidgetConfig(a).priority - getWidgetConfig(b).priority
    );
  }

  const stepTypes = new Set(
    stepsData.executions.map((e) => e.step_type.toLowerCase())
  );

  // Detect screenshots widget
  const guiTypes = [
    "screenshot",
    "click",
    "gui_action",
    "gui_automation",
    "action",
    "workflow",
  ];
  if (guiTypes.some((t) => stepTypes.has(t))) {
    widgets.push("screenshots");
  }

  // Detect verification widget (aligned with runner's mapCheckType)
  const verificationTypes = [
    "playwright",
    "test",
    "check",
    "check_group",
    "verification",
    "error_check",
    "log_check",
    "shell",
    "gui_automation",
    "repo_test",
  ];
  if (
    verificationTypes.some((t) => stepTypes.has(t)) ||
    [...stepTypes].some((t) => t.includes("check") || t.includes("verification"))
  ) {
    widgets.push("verification");
  }

  // Detect MCP widget
  const mcpTypes = ["mcp_call", "mcp", "tool_call"];
  if (mcpTypes.some((t) => stepTypes.has(t))) {
    widgets.push("mcp-calls");
  }

  // Detect shell command widget
  const shellTypes = ["shell_command", "shell", "command", "bash"];
  if (shellTypes.some((t) => stepTypes.has(t))) {
    widgets.push("shell-command");
  }

  // Detect API request widget
  const apiTypes = ["api_request", "api_call", "http_request", "http"];
  if (apiTypes.some((t) => stepTypes.has(t))) {
    widgets.push("api-request");
  }

  // Detect script widget
  const scriptTypes = ["script", "python", "node", "script_execution"];
  if (scriptTypes.some((t) => stepTypes.has(t))) {
    widgets.push("script");
  }

  // Detect workflow ref widget
  const workflowRefTypes = ["workflow_ref", "sub_workflow", "workflow_call"];
  if (workflowRefTypes.some((t) => stepTypes.has(t))) {
    widgets.push("workflow-ref");
  }

  // Detect flow execution widget
  const flowTypes = ["flow", "flow_execution", "state_machine"];
  if (flowTypes.some((t) => stepTypes.has(t))) {
    widgets.push("flow-execution");
  }

  // If no specific types detected yet, add all optional widgets
  if (widgets.length <= 4) {
    if (!widgets.includes("screenshots")) widgets.push("screenshots");
    if (!widgets.includes("verification")) widgets.push("verification");
    if (!widgets.includes("mcp-calls")) widgets.push("mcp-calls");
  }

  // Deduplicate and sort by priority
  const unique = [...new Set(widgets)];
  return unique.sort(
    (a, b) => getWidgetConfig(a).priority - getWidgetConfig(b).priority
  );
}

// =============================================================================
// Active Runs Bar
// =============================================================================

function ActiveRunsBar({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: TaskRun[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (runs.length <= 1) return;
      const currentIdx = runs.findIndex((r) => r.id === selectedRunId);

      // Arrow keys
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = currentIdx > 0 ? currentIdx - 1 : runs.length - 1;
        onSelect(runs[prev]!.id);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIdx < runs.length - 1 ? currentIdx + 1 : 0;
        onSelect(runs[next]!.id);
      }
      // Number keys 1-9
      else if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (idx < runs.length) {
          onSelect(runs[idx]!.id);
        }
      }
      // Ctrl+Tab
      else if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        const next = e.shiftKey
          ? currentIdx > 0
            ? currentIdx - 1
            : runs.length - 1
          : currentIdx < runs.length - 1
            ? currentIdx + 1
            : 0;
        onSelect(runs[next]!.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [runs, selectedRunId, onSelect]);

  if (runs.length <= 1) return null;

  return (
    <div
      ref={containerRef}
      className="flex gap-2 px-4 py-2 bg-surface-canvas/50 border-b border-border-subtle/50 overflow-x-auto items-center"
    >
      {runs.map((run, idx) => (
        <CompactRunCard
          key={run.id}
          run={run}
          index={idx}
          isSelected={selectedRunId === run.id}
          onSelect={() => onSelect(run.id)}
        />
      ))}
    </div>
  );
}

function CompactRunCard({
  run,
  index,
  isSelected,
  onSelect,
}: {
  run: TaskRun;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { data: orchState } = useEventTriggeredFetch<{
    active_agent?: string;
    activity_type?: string;
    current_action?: string;
    is_paused?: boolean;
    bridges_count?: number;
    gui_locked?: boolean;
    plan_phase?: string;
    plan_total_phases?: number;
  }>("orchestrator-state-change", `/task-runs/${run.id}/orchestrator-state`, {
    fallbackPollMs: 10000, // 10s — this is just a status indicator in the multi-run bar
  });

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all shrink-0",
        isSelected
          ? "bg-brand-primary/10 border border-brand-primary/40 text-text-primary"
          : "bg-surface-raised/50 border border-border-subtle/50 text-text-muted hover:border-border-default"
      )}
    >
      {/* Keyboard shortcut hint */}
      <span className="text-[9px] text-text-muted/50 font-mono">
        {index + 1}
      </span>

      <PlayCircle className="size-3 text-blue-500 animate-pulse" />
      <span
        className="font-medium truncate max-w-[120px]"
        data-content-role="label"
        data-content-label="active-run-name"
      >
        {run.task_name}
      </span>
      <Badge variant="outline" className="text-[10px]">
        {run.phase || "\u2014"}
      </Badge>

      {/* GUI Lock indicator */}
      {orchState?.gui_locked && <Lock className="size-3 text-amber-400" />}

      {/* Bridge count */}
      {orchState?.bridges_count != null && orchState.bridges_count > 0 && (
        <Badge
          variant="outline"
          className="text-[9px] gap-0.5 text-cyan-400 border-cyan-500/20"
        >
          <Hash className="size-2" />
          {orchState.bridges_count}
        </Badge>
      )}
    </button>
  );
}

// =============================================================================
// Summary Components
// =============================================================================

function TimelineSummary({ stepsData }: { runId: string; stepsData: CurrentExecutionStepsResponse | null }) {
  const executions = stepsData?.executions || [];
  const total = executions.length;
  const completed = executions.filter(
    (e) => e.status === "success" || e.status === "failed"
  ).length;
  const failed = executions.filter((e) => e.status === "failed").length;
  const currentStep = executions.find((e) => e.status === "running");
  const progressPercent = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="space-y-2">
      {total > 0 && (
        <div>
          <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
            <span>
              {completed}/{total} steps
            </span>
            {failed > 0 && (
              <span className="text-red-400">{failed} failed</span>
            )}
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                failed > 0
                  ? "bg-red-500"
                  : completed === total && total > 0
                    ? "bg-green-500"
                    : "bg-cyan-500"
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}
      {currentStep && (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="size-3 text-blue-400 animate-spin shrink-0" />
          <span className="text-text-muted truncate">
            {currentStep.step_name}
          </span>
        </div>
      )}
      {stepsData?.current_stage && (
        <Badge variant="outline" className="text-[10px]">
          {stepsData.current_stage}
        </Badge>
      )}
      {total === 0 && (
        <p className="text-xs text-text-muted">Waiting for steps...</p>
      )}
    </div>
  );
}

function AiConversationSummary({ runId }: { runId: string }) {
  // Use the output endpoint (populated via chunks during execution)
  // instead of task_run_events (only populated after session completes)
  const { data: outputData } = useEventTriggeredFetch<{ output?: string; output_log?: string; sessions_count?: number }>(
    "ai-output",
    `/task-runs/${runId}/output`,
  );

  const output = outputData?.output_log ?? outputData?.output ?? "";
  const sessionCount = outputData?.sessions_count ?? 0;

  // Count meaningful content: user messages
  const userMessages = (output.match(/\[USER_MESSAGE\]/g) || []).length;
  const hasContent = output.trim().length > 0;

  // Get last meaningful line for preview
  const lastLine = (() => {
    if (!output) return "";
    const lines = output.split("\n").filter((l) => l.trim() && !l.startsWith("["));
    return lines.length > 0 ? (lines[lines.length - 1] ?? "").trim().slice(0, 120) : "";
  })();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] gap-1">
          <MessageSquare className="size-2.5" />
          {sessionCount > 0 ? `${sessionCount} session${sessionCount !== 1 ? "s" : ""}` : hasContent ? "Active" : "0 messages"}
        </Badge>
        {userMessages > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1 text-text-muted">
            {userMessages} user msg{userMessages !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>
      {lastLine && (
        <p className="text-xs text-text-muted line-clamp-2">{lastLine}</p>
      )}
      {!hasContent && (
        <p className="text-xs text-text-muted">No AI messages yet...</p>
      )}
    </div>
  );
}

function ScreenshotsSummary({ runId }: { runId: string }) {
  const { data: screenshots } = useEventTriggeredFetch<Screenshot[]>(
    "step-progress",
    `/task-runs/${runId}/screenshots`,
    { transform: transformScreenshots }
  );
  const count = screenshots?.length || 0;
  const latest = screenshots?.[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] gap-1">
          <ImageIcon className="size-2.5" />
          {count} screenshots
        </Badge>
      </div>
      {latest && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Camera className="size-3 shrink-0" />
          <span className="truncate">
            {latest.filename || "Latest capture"}
          </span>
        </div>
      )}
      {count === 0 && (
        <p className="text-xs text-text-muted">No screenshots yet...</p>
      )}
    </div>
  );
}

function VerificationSummary({ runId }: { runId: string }) {
  const { data } = useEventTriggeredFetch<VerificationData>(
    "step-progress",
    `/task-runs/${runId}/verification-results`,
    { transform: transformVerification }
  );
  const items = data?.results || [];
  const passed = items.filter((r) => r.passed).length;
  const failed = items.filter((r) => !r.passed).length;
  const total = items.length;

  return (
    <div className="space-y-2">
      {total > 0 ? (
        <>
          <div className="flex items-center gap-3">
            {passed > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <CheckCircle2 className="size-3 text-green-500" />
                <span className="text-green-400">{passed} passed</span>
              </div>
            )}
            {failed > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <XCircle className="size-3 text-red-500" />
                <span className="text-red-400">{failed} failed</span>
              </div>
            )}
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${total > 0 ? (passed / total) * 100 : 0}%` }}
            />
          </div>
        </>
      ) : (
        <p className="text-xs text-text-muted">
          No verification results yet...
        </p>
      )}
    </div>
  );
}

function FindingsSummary({ runId }: { runId: string }) {
  const { data: knowledge } = useEventTriggeredFetch<TaskRunKnowledge>(
    ["finding_detected", "finding_resolved"],
    `/task-runs/${runId}/knowledge`,
    { transform: transformKnowledge }
  );
  const findings = knowledge?.findings || [];
  const total = findings.length;
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;

  return (
    <div className="space-y-2">
      {total > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={cn(
                "size-3.5",
                critical > 0 ? "text-red-500" : "text-amber-400"
              )}
            />
            <span
              className="text-xs text-text-primary"
              data-content-role="metric"
              data-content-label="findings-count"
            >
              {total} finding{total !== 1 ? "s" : ""}
            </span>
            {critical > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] text-red-400 border-red-500/30 animate-pulse"
              >
                {critical} critical
              </Badge>
            )}
            {high > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] text-orange-400 border-orange-500/30"
              >
                {high} high
              </Badge>
            )}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-3.5 text-green-500" />
          <span className="text-xs text-text-muted" data-content-role="status">
            No issues found
          </span>
        </div>
      )}
    </div>
  );
}

function McpCallsSummary({ runId }: { runId: string }) {
  const { data: calls } = useEventTriggeredFetch<McpCall[]>(
    "step-progress",
    `/task-runs/${runId}/mcp-calls`,
    { transform: transformMcpCalls }
  );
  const items = calls || [];
  const total = items.length;
  const latest = items[items.length - 1];

  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-[10px] gap-1">
        <Plug className="size-2.5" />
        {total} calls
      </Badge>
      {latest && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate font-mono">{latest.tool_name}</span>
        </div>
      )}
      {total === 0 && (
        <p className="text-xs text-text-muted">No MCP calls yet...</p>
      )}
    </div>
  );
}

function ShellCommandSummary({ stepsData }: { runId: string; stepsData: CurrentExecutionStepsResponse | null }) {
  const shellSteps = (stepsData?.executions || []).filter((e) =>
    ["shell_command", "shell", "command", "bash"].includes(
      e.step_type.toLowerCase()
    )
  );
  const total = shellSteps.length;
  const latest = shellSteps[shellSteps.length - 1];

  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-[10px] gap-1">
        <Terminal className="size-2.5" />
        {total} commands
      </Badge>
      {latest && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate font-mono text-[11px]">
            {latest.step_name}
          </span>
        </div>
      )}
      {total === 0 && (
        <p className="text-xs text-text-muted">No shell commands yet...</p>
      )}
    </div>
  );
}

function ApiRequestSummary({ stepsData }: { runId: string; stepsData: CurrentExecutionStepsResponse | null }) {
  const apiSteps = (stepsData?.executions || []).filter((e) =>
    ["api_request", "api_call", "http_request", "http"].includes(
      e.step_type.toLowerCase()
    )
  );
  const total = apiSteps.length;
  const latest = apiSteps[apiSteps.length - 1];

  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-[10px] gap-1">
        <Globe className="size-2.5" />
        {total} requests
      </Badge>
      {latest && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate">{latest.step_name}</span>
        </div>
      )}
      {total === 0 && (
        <p className="text-xs text-text-muted">No API requests yet...</p>
      )}
    </div>
  );
}

function ScriptSummary({ stepsData }: { runId: string; stepsData: CurrentExecutionStepsResponse | null }) {
  const scriptSteps = (stepsData?.executions || []).filter((e) =>
    ["script", "python", "node", "script_execution"].includes(
      e.step_type.toLowerCase()
    )
  );
  const total = scriptSteps.length;

  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-[10px] gap-1">
        <FileCode className="size-2.5" />
        {total} scripts
      </Badge>
      {total === 0 && (
        <p className="text-xs text-text-muted">No scripts yet...</p>
      )}
    </div>
  );
}

function WorkflowRefSummary({ stepsData }: { runId: string; stepsData: CurrentExecutionStepsResponse | null }) {
  const wfSteps = (stepsData?.executions || []).filter((e) =>
    ["workflow_ref", "sub_workflow", "workflow_call"].includes(
      e.step_type.toLowerCase()
    )
  );
  const total = wfSteps.length;

  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-[10px] gap-1">
        <GitBranch className="size-2.5" />
        {total} sub-workflows
      </Badge>
      {total === 0 && (
        <p className="text-xs text-text-muted">No sub-workflows yet...</p>
      )}
    </div>
  );
}

function FlowExecutionSummary({ stepsData }: { runId: string; stepsData: CurrentExecutionStepsResponse | null }) {
  const flowSteps = (stepsData?.executions || []).filter((e) =>
    ["flow", "flow_execution", "state_machine"].includes(
      e.step_type.toLowerCase()
    )
  );
  const total = flowSteps.length;

  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-[10px] gap-1">
        <Activity className="size-2.5" />
        {total} flow steps
      </Badge>
      {total === 0 && (
        <p className="text-xs text-text-muted">No flow execution yet...</p>
      )}
    </div>
  );
}

function StatusSummary({ run }: { run: TaskRun }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            run.status === "running"
              ? "text-blue-400 border-blue-500/30"
              : run.status === "completed"
                ? "text-green-400 border-green-500/30"
                : run.status === "failed"
                  ? "text-red-400 border-red-500/30"
                  : "text-text-muted border-border-subtle/50"
          )}
        >
          {run.status}
        </Badge>
        {run.iteration_count != null && run.iteration_count > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] gap-1 text-text-muted"
          >
            <RotateCcw className="size-2.5" />
            Iter {run.iteration_count}
          </Badge>
        )}
        {run.phase && (
          <Badge variant="outline" className="text-[10px] text-text-muted">
            {run.phase}
          </Badge>
        )}
      </div>
      {run.sessions_count != null && (
        <p className="text-xs text-text-muted">
          Session {run.sessions_count}
          {run.max_sessions ? `/${run.max_sessions}` : ""}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Summary Card Wrapper
// =============================================================================

function SummaryCard({
  config,
  isRunning,
  onClick,
  children,
}: {
  config: WidgetConfig;
  isRunning: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const Icon = config.icon;
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-lg border overflow-hidden cursor-pointer transition-all",
        "hover:border-white/20 hover:bg-white/[0.02]",
        isRunning ? config.borderColor : "border-border-subtle/50",
        "bg-surface-raised/30"
      )}
    >
      {/* Compact header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b",
          isRunning
            ? cn(config.bgColor, config.borderColor)
            : "border-border-subtle/30"
        )}
      >
        <Icon className={cn("size-3.5", config.textColor)} />
        <span
          className="text-xs font-medium text-text-primary"
          data-content-role="label"
          data-content-label="widget-name"
        >
          {config.label}
        </span>
        {isRunning && (
          <Loader2
            className={cn("size-3 animate-spin ml-auto", config.textColor)}
          />
        )}
      </div>
      {/* Summary content */}
      <div className="p-3">{children}</div>
    </div>
  );
}

// =============================================================================
// Full Widget Renderer
// =============================================================================

function FullWidget({
  widgetId,
  runId,
  run,
  config,
}: {
  widgetId: WidgetId;
  runId: string;
  run: TaskRun;
  config: WidgetConfig;
}) {
  const Icon = config.icon;
  const isRunning = run.status === "running";

  return (
    <div
      className={cn(
        "h-full rounded-xl border-2 overflow-hidden flex flex-col",
        isRunning
          ? cn(
              config.borderColor,
              "ring-2",
              `ring-${config.accentColor}-500/20`
            )
          : "border-border-subtle/50",
        "bg-surface-raised/20"
      )}
    >
      {/* Widget header */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 border-b shrink-0",
          isRunning
            ? cn(config.bgColor, config.borderColor)
            : "border-border-subtle/30"
        )}
      >
        <Icon className={cn("size-4", config.textColor)} />
        <span
          className="text-sm font-semibold text-text-primary"
          data-content-role="heading"
          data-content-label="widget-heading"
        >
          {config.label}
        </span>
        {isRunning && (
          <Loader2
            className={cn("size-3.5 animate-spin ml-auto", config.textColor)}
          />
        )}
      </div>
      {/* Widget content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <WidgetContent widgetId={widgetId} runId={runId} run={run} />
      </div>
    </div>
  );
}

function WidgetContent({
  widgetId,
  runId,
  run,
}: {
  widgetId: WidgetId;
  runId: string;
  run: TaskRun;
}) {
  switch (widgetId) {
    case "ai-conversation":
      return <AiConversationWidget runId={runId} />;
    case "timeline":
      return <ExecutionTimelineWidget runId={runId} />;
    case "findings":
      return <FindingsWidget runId={runId} />;
    case "verification":
      return <VerificationWidget runId={runId} />;
    case "status":
      return <ExecutionStatusWidget run={run} />;
    case "mcp-calls":
      return <McpCallsWidget runId={runId} />;
    case "screenshots":
      return <ScreenshotsWidget runId={runId} />;
    case "shell-command":
    case "api-request":
    case "script":
    case "workflow-ref":
    case "flow-execution":
      return <ExecutionStatusWidget run={run} />;
    default:
      return null;
  }
}

function SummaryContent({
  widgetId,
  runId,
  run,
  stepsData,
}: {
  widgetId: WidgetId;
  runId: string;
  run: TaskRun;
  stepsData: CurrentExecutionStepsResponse | null;
}) {
  switch (widgetId) {
    case "timeline":
      return <TimelineSummary runId={runId} stepsData={stepsData} />;
    case "ai-conversation":
      return <AiConversationSummary runId={runId} />;
    case "screenshots":
      return <ScreenshotsSummary runId={runId} />;
    case "verification":
      return <VerificationSummary runId={runId} />;
    case "findings":
      return <FindingsSummary runId={runId} />;
    case "mcp-calls":
      return <McpCallsSummary runId={runId} />;
    case "status":
      return <StatusSummary run={run} />;
    case "shell-command":
      return <ShellCommandSummary runId={runId} stepsData={stepsData} />;
    case "api-request":
      return <ApiRequestSummary runId={runId} stepsData={stepsData} />;
    case "script":
      return <ScriptSummary runId={runId} stepsData={stepsData} />;
    case "workflow-ref":
      return <WorkflowRefSummary runId={runId} stepsData={stepsData} />;
    case "flow-execution":
      return <FlowExecutionSummary runId={runId} stepsData={stepsData} />;
    default:
      return null;
  }
}

// =============================================================================
// Dashboard Layout
// =============================================================================

const MIN_WIDTH = 30;
const MAX_WIDTH = 80;
const STORAGE_KEY = "qontinui-web-dashboard-panel-width";

function DashboardLayout({
  activeWidget,
  summaryWidgets,
  runId,
  run,
  onWidgetClick,
  stepsData,
}: {
  activeWidget: WidgetId;
  summaryWidgets: WidgetId[];
  runId: string;
  run: TaskRun;
  onWidgetClick: (id: WidgetId) => void;
  stepsData: CurrentExecutionStepsResponse | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [leftWidthPercent, setLeftWidthPercent] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val >= MIN_WIDTH && val <= MAX_WIDTH) return val;
      }
    }
    return 65;
  });

  const isRunning = run.status === "running";
  const activeConfig = getWidgetConfig(activeWidget);

  // Persist width to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(leftWidthPercent));
  }, [leftWidthPercent]);

  // Drag handle logic
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = (x / rect.width) * 100;
      setLeftWidthPercent(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, pct)));
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // If only one widget, show full width
  if (summaryWidgets.length === 0) {
    return (
      <div className="flex-1 min-h-0 p-4">
        <FullWidget
          widgetId={activeWidget}
          runId={runId}
          run={run}
          config={activeConfig}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 p-4 gap-0">
      {/* Active widget (left panel) */}
      <div className="min-h-0" style={{ width: `${leftWidthPercent}%` }}>
        <FullWidget
          widgetId={activeWidget}
          runId={runId}
          run={run}
          config={activeConfig}
        />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1.5 mx-1 flex items-center justify-center cursor-col-resize group shrink-0"
      >
        <div className="w-0.5 h-12 bg-border-subtle/50 rounded-full group-hover:bg-white/30 group-hover:h-16 transition-all" />
      </div>

      {/* Summary widgets (right panel) */}
      <div className="min-h-0" style={{ width: `${100 - leftWidthPercent}%` }}>
        <ScrollArea className="h-full">
          <div className="space-y-3 pr-1">
            {summaryWidgets.map((widgetId) => {
              const config = getWidgetConfig(widgetId);
              return (
                <SummaryCard
                  key={widgetId}
                  config={config}
                  isRunning={isRunning}
                  onClick={() => onWidgetClick(widgetId)}
                >
                  <SummaryContent widgetId={widgetId} runId={runId} run={run} stepsData={stepsData} />
                </SummaryCard>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// =============================================================================
// Tab Bar
// =============================================================================

const TAB_ITEMS: {
  id: "dashboard" | WidgetId;
  label: string;
  icon: typeof Activity;
}[] = [
  { id: "dashboard", label: "Dashboard", icon: Activity },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "ai-conversation", label: "AI Conversation", icon: MessageSquare },
  { id: "verification", label: "Verification", icon: ShieldCheck },
  { id: "findings", label: "Findings", icon: Bug },
  { id: "mcp-calls", label: "MCP Calls", icon: Plug },
  { id: "screenshots", label: "Screenshots", icon: Camera },
  { id: "status", label: "Status", icon: Gauge },
];

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: "dashboard" | WidgetId;
  onTabChange: (tab: "dashboard" | WidgetId) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-4 py-1.5 bg-surface-canvas/60 border-b border-border-subtle/30 overflow-x-auto">
      {TAB_ITEMS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all shrink-0",
              isActive
                ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/30"
                : "text-text-muted hover:text-text-secondary hover:bg-white/[0.02]"
            )}
          >
            <Icon className="size-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// Idle State
// =============================================================================

function IdleState() {
  const router = useRouter();

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md">
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-primary/20 to-violet-500/20 animate-pulse" />
          <div className="absolute inset-2 rounded-full bg-surface-raised/80 flex items-center justify-center">
            <Inbox className="size-8 text-text-muted" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-medium text-text-secondary mb-2">
            No Active Runs
          </h3>
          <p className="text-sm text-text-muted">
            Start a workflow to see the live dashboard, or view your run
            history.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => router.push("/runs")}
            className="gap-2"
          >
            <History className="size-4" />
            Run History
          </Button>
          <Button
            onClick={() => router.push("/build/workflows")}
            className="gap-2 bg-brand-primary hover:bg-brand-primary/90"
          >
            <Rocket className="size-4" />
            Run Workflow
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompletedState({ lastRunId }: { lastRunId: string }) {
  const router = useRouter();

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <CheckCircle2 className="size-12 text-emerald-400 mx-auto" />
        <h3 className="text-lg font-medium text-text-secondary">
          Run Completed
        </h3>
        <p className="text-sm text-text-muted">
          The workflow has finished running.
        </p>
        <Button onClick={() => router.push(`/runs/${lastRunId}`)}>
          View Results
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function ActiveRunsPage() {
  return (
    <RunnerEventProvider>
      <ActiveRunsPageInner />
    </RunnerEventProvider>
  );
}

function ActiveRunsPageInner() {
  const {
    data: activeRuns,
    isLoading: runsLoading,
    isOffline: runsOffline,
    refetch: refetchRuns,
  } = useEventTriggeredFetch<TaskRun[]>(
    "task-run-update",
    "/task-runs/running"
  );

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const lastKnownRunIds = useRef<Set<string>>(new Set());

  // Track run IDs so we can show CompletedState when runs finish
  useEffect(() => {
    if (activeRuns && activeRuns.length > 0) {
      lastKnownRunIds.current = new Set(activeRuns.map((r) => r.id));
    }
  }, [activeRuns]);

  // Auto-run: when a "Generate & Run" generation task finishes, auto-start the workflow.
  // We must see the task appear in active runs at least once before treating its
  // absence as "finished" — otherwise the first fetch (before the task appears) would
  // trigger a false completion.
  const autoRunHandledRef = useRef(false);
  const autoRunSeenRef = useRef(false);
  useEffect(() => {
    if (!activeRuns || autoRunHandledRef.current) return;

    let raw: string | null;
    try {
      raw = localStorage.getItem(AUTO_RUN_AFTER_GENERATE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    let signal: AutoRunAfterGenerate;
    try {
      signal = JSON.parse(raw) as AutoRunAfterGenerate;
    } catch {
      localStorage.removeItem(AUTO_RUN_AFTER_GENERATE_KEY);
      return;
    }

    // Clear stale entries (>30 minutes)
    if (Date.now() - signal.timestamp > 30 * 60 * 1000) {
      localStorage.removeItem(AUTO_RUN_AFTER_GENERATE_KEY);
      return;
    }

    const stillRunning = activeRuns.some((r) => r.id === signal.taskRunId);

    if (stillRunning) {
      // Task is visible in active runs — mark that we've seen it
      autoRunSeenRef.current = true;
      return;
    }

    // Task is not in active runs. Only treat as "finished" if we've seen it before;
    // otherwise the first fetch simply hasn't picked it up yet.
    if (!autoRunSeenRef.current) return;

    // Generation task was seen and is now gone — it finished
    autoRunHandledRef.current = true;
    localStorage.removeItem(AUTO_RUN_AFTER_GENERATE_KEY);

    (async () => {
      try {
        const taskRun = await runnerApi.getTaskRun(signal.taskRunId);
        if (taskRun.status === "completed") {
          const resultData = await runnerApi.getTaskRunResultData(
            signal.taskRunId
          );
          const workflowId = resultData.generated_workflow_id as
            | string
            | undefined;
          if (!workflowId) {
            toast.error(
              "Workflow generated but no workflow ID found in result data"
            );
            return;
          }
          await runnerApi.runWorkflow(workflowId);
          toast.success("Workflow generated and started!");
          refetchRuns();
        } else {
          toast.error(
            `Workflow generation ${taskRun.status === "failed" ? "failed" : "was stopped"}`
          );
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to auto-run generated workflow"
        );
      }
    })();
  }, [activeRuns, refetchRuns]);

  const isOffline = runsOffline;
  if (isOffline) return <RunnerOfflineState />;

  const runs = activeRuns || [];
  const isLoading = runsLoading;
  const selectedRun =
    runs.find((r) => r.id === selectedRunId) || runs[0] || null;
  const currentRunId = selectedRun?.id || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Activity className="size-5 text-blue-500" />
            <h1 className="text-lg font-bold text-text-primary">
              Active Dashboard
            </h1>
            {runs.length > 0 && (
              <Badge variant="info">{runs.length} active</Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchRuns()}
            className="border-border-default"
          >
            <RefreshCw className="size-4 mr-1" />
            Refresh
          </Button>
        </div>
      </header>

      {/* Multi-run bar */}
      <ActiveRunsBar
        runs={runs}
        selectedRunId={currentRunId}
        onSelect={setSelectedRunId}
      />

      {/* Main content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <RefreshCw className="size-6 animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        lastKnownRunIds.current.size > 0 ? (
          <CompletedState lastRunId={[...lastKnownRunIds.current][0]!} />
        ) : (
          <IdleState />
        )
      ) : selectedRun ? (
        <SharedRunnerDataProvider runId={currentRunId}>
          <ActiveDashboardContent
            run={selectedRun}
            runId={currentRunId!}
            onRefresh={() => refetchRuns()}
          />
        </SharedRunnerDataProvider>
      ) : null}
    </div>
  );
}

function ActiveDashboardContent({
  run,
  runId,
  onRefresh,
}: {
  run: TaskRun;
  runId: string;
  onRefresh: () => void;
}) {
  const { data: stepsData } = useSharedStepsData();
  const [activeWidget, setActiveWidget] = useState<WidgetId>("timeline");
  const [activeTab, setActiveTab] = useState<"dashboard" | WidgetId>(
    "dashboard"
  );
  const userSelected = useRef(false);
  const completionRefetchedRef = useRef(false);

  // Listen for task-run-update events to detect when the run completes.
  // This provides a redundant trigger for the parent's runs list refetch,
  // covering the case where the parent's useEventTriggeredFetch misses the event.
  useRunnerEvent(
    "task-run-update",
    useCallback(
      (payload: unknown) => {
        if (completionRefetchedRef.current) return;
        const msg = payload as Record<string, unknown> | null;
        if (!msg) return;
        const data = (msg.data ?? msg) as Record<string, unknown>;
        const status = data.status as string | undefined;
        if (
          status === "completed" ||
          status === "failed" ||
          status === "stopped"
        ) {
          completionRefetchedRef.current = true;
          onRefresh();
        }
      },
      [onRefresh]
    )
  );

  // Fallback: detect completion from steps data.
  // When all execution steps are in terminal state, trigger a delayed
  // refetch of the runs list. This catches the case where the WebSocket
  // "task-run-update" event was missed but "step-progress" events arrived.
  useEffect((): void | (() => void) => {
    if (!stepsData || completionRefetchedRef.current) return;
    const executions = stepsData.executions || [];
    if (executions.length === 0) return;

    const hasRunningOrPending = executions.some(
      (e) => e.status === "running" || e.status === "pending"
    );

    // Only trigger if the completion phase has been reached
    const hasCompletionStep = executions.some(
      (e) => e.phase?.toLowerCase() === "completion"
    );

    if (!hasRunningOrPending && hasCompletionStep) {
      completionRefetchedRef.current = true;
      // Short delay to let the runner finalize the task status in the DB
      const timer = setTimeout(() => onRefresh(), 2000);
      return () => clearTimeout(timer);
    }
  }, [stepsData, onRefresh]);

  // Detect which widgets to show
  const detectedWidgets = detectWidgets(stepsData);

  // Compute summary widgets (all detected except active)
  const summaryWidgets = detectedWidgets.filter((w) => w !== activeWidget);

  // If active widget is not in detected list, reset to first detected
  if (detectedWidgets.length > 0 && !detectedWidgets.includes(activeWidget)) {
    // Can't call setState during render, but this is fine for initial mismatch
    // It will correct on next render cycle
  }

  const handleWidgetClick = (id: WidgetId) => {
    userSelected.current = true;
    setActiveWidget(id);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Control bar */}
      <ControlBar run={run} onRefresh={onRefresh} />

      {/* Tab bar */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === "dashboard" ? (
        <DashboardLayout
          activeWidget={activeWidget}
          summaryWidgets={summaryWidgets}
          runId={runId}
          run={run}
          onWidgetClick={handleWidgetClick}
          stepsData={stepsData}
        />
      ) : (
        <div className="flex-1 min-h-0 p-4">
          <WidgetContent
            widgetId={activeTab}
            runId={runId}
            run={run}
          />
        </div>
      )}

      {/* Bottom bar */}
      <BottomBar run={run} />
    </div>
  );
}
