"use client";

import React from "react";
import type {
  TaskRun,
  CurrentExecutionStepsResponse,
  VerificationData,
  TaskRunKnowledge,
} from "@/lib/runner";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ChevronRight,
  RotateCcw,
  Terminal,
  Monitor,
  GitBranch,
} from "lucide-react";
import {
  transformKnowledge,
  transformVerification,
  type WidgetConfig,
  type WidgetId,
} from "../_lib";

// ---------------------------------------------------------------------------
// Step type sets for filtering
// ---------------------------------------------------------------------------

const COMMAND_STEP_TYPES = new Set([
  "command",
  "shell_command",
  "shell",
  "check",
  "check_group",
  "test",
  "api_request",
  "api_call",
  "http_request",
  "http",
  "mcp_call",
  "mcp",
  "tool_call",
  "script",
  "python",
  "node",
  "script_execution",
  "bash",
  "cmd",
  "powershell",
]);

const UI_BRIDGE_STEP_TYPES = new Set(["ui_bridge", "uibridge"]);

const FLOW_STEP_TYPES = new Set(["flow", "flow_execution", "state_machine"]);

// ---------------------------------------------------------------------------
// Summary Components
// ---------------------------------------------------------------------------

function TimelineSummary({
  stepsData,
}: {
  runId: string;
  stepsData: CurrentExecutionStepsResponse | null;
}) {
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
      <div className="flex items-center gap-1.5 flex-wrap">
        {stepsData?.current_stage && (
          <Badge variant="outline" className="text-[10px]">
            {stepsData.current_stage}
          </Badge>
        )}
        {stepsData?.total_stages != null && stepsData.total_stages > 1 && (
          <Badge
            variant="outline"
            className="text-[10px] text-amber-400 border-amber-500/30"
          >
            Stage {(stepsData.current_stage_index ?? 0) + 1}/
            {stepsData.total_stages}
          </Badge>
        )}
      </div>
      {total === 0 && (
        <p className="text-xs text-text-muted">Waiting for steps...</p>
      )}
    </div>
  );
}

function AiConversationSummary({ runId }: { runId: string }) {
  const { data: outputData, isLoading } = useEventTriggeredFetch<{
    output?: string;
    output_log?: string;
    sessions_count?: number;
  }>("ai-output", `/task-runs/${runId}/output`);

  const output = outputData?.output_log ?? outputData?.output ?? "";
  const sessionCount = outputData?.sessions_count ?? 0;

  const userMessages = (output.match(/\[USER_MESSAGE\]/g) || []).length;
  const hasContent = output.trim().length > 0;

  // Count total message lines (non-empty, non-marker lines)
  const messageCount = hasContent
    ? output.split("\n").filter((l: string) => l.trim() && !l.startsWith("["))
        .length
    : 0;

  // Track output length changes to detect "thinking" state
  const prevLenRef = React.useRef(0);
  const lastChangeRef = React.useRef(0);
  const [isThinking, setIsThinking] = React.useState(false);

  React.useEffect(() => {
    const currentLen = output.length;
    if (currentLen !== prevLenRef.current && currentLen > 0) {
      prevLenRef.current = currentLen;
      lastChangeRef.current = Date.now();
      setIsThinking(true);
    }
    const timer = setInterval(() => {
      if (
        lastChangeRef.current > 0 &&
        Date.now() - lastChangeRef.current > 5000
      ) {
        setIsThinking(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [output]);

  const lastLine = (() => {
    if (!output) return "";
    const lines = output
      .split("\n")
      .filter((l: string) => l.trim() && !l.startsWith("["));
    return lines.length > 0
      ? (lines[lines.length - 1] ?? "").trim().slice(0, 120)
      : "";
  })();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] gap-1">
          <MessageSquare className="size-2.5" />
          {sessionCount > 0
            ? `${sessionCount} session${sessionCount !== 1 ? "s" : ""}`
            : hasContent
              ? "Active"
              : "0 messages"}
        </Badge>
        {messageCount > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] gap-1 text-text-muted"
          >
            {messageCount} msg{messageCount !== 1 ? "s" : ""}
          </Badge>
        )}
        {userMessages > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] gap-1 text-text-muted"
          >
            {userMessages} user
          </Badge>
        )}
        {isThinking && !isLoading && (
          <div className="flex items-center gap-1 text-[10px] text-blue-400 animate-pulse">
            <Loader2 className="size-2.5 animate-spin" />
            Thinking...
          </div>
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
            <span className="text-xs font-medium text-text-primary">
              {passed}/{total} passed
            </span>
            {failed > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <XCircle className="size-3 text-red-500" />
                <span className="text-red-400">{failed} failed</span>
              </div>
            )}
          </div>
          <div className="h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                failed > 0 ? "bg-red-500" : "bg-green-500"
              )}
              style={{ width: `${total > 0 ? (passed / total) * 100 : 0}%` }}
            />
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-xs text-text-muted py-1">
          <CheckCircle2 className="size-3.5 opacity-50" />
          <span>No verification results yet</span>
        </div>
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

function CommandSummary({
  stepsData,
}: {
  runId: string;
  stepsData: CurrentExecutionStepsResponse | null;
}) {
  const commandSteps = (stepsData?.executions || []).filter((e) =>
    COMMAND_STEP_TYPES.has(e.step_type.toLowerCase())
  );
  const total = commandSteps.length;
  const failed = commandSteps.filter((e) => e.status === "failed").length;
  const latest = commandSteps[commandSteps.length - 1];

  // Count by mode
  const shellCount = commandSteps.filter((e) => {
    const mode = e.command_mode?.toLowerCase();
    const t = e.step_type.toLowerCase();
    return (
      mode === "shell" ||
      (!mode &&
        (t === "shell_command" ||
          t === "shell" ||
          t === "bash" ||
          t === "cmd" ||
          t === "powershell"))
    );
  }).length;
  const checkCount = commandSteps.filter((e) => {
    const mode = e.command_mode?.toLowerCase();
    const t = e.step_type.toLowerCase();
    return (
      mode === "check" ||
      mode === "check_group" ||
      (!mode && (t === "check" || t === "check_group"))
    );
  }).length;
  const testCount = commandSteps.filter((e) => {
    const mode = e.command_mode?.toLowerCase();
    const t = e.step_type.toLowerCase();
    return mode === "test" || (!mode && (t === "test" || t === "playwright"));
  }).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] gap-1">
          <Terminal className="size-2.5" />
          {total} command{total !== 1 ? "s" : ""}
        </Badge>
        {failed > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] text-red-400 border-red-500/30"
          >
            {failed} failed
          </Badge>
        )}
      </div>
      {(shellCount > 0 || checkCount > 0 || testCount > 0) && (
        <div className="flex items-center gap-1.5">
          {shellCount > 0 && (
            <Badge
              variant="outline"
              className="text-[9px] text-slate-400 border-slate-500/30"
            >
              SH {shellCount}
            </Badge>
          )}
          {checkCount > 0 && (
            <Badge
              variant="outline"
              className="text-[9px] text-blue-400 border-blue-500/30"
            >
              CHK {checkCount}
            </Badge>
          )}
          {testCount > 0 && (
            <Badge
              variant="outline"
              className="text-[9px] text-indigo-400 border-indigo-500/30"
            >
              TST {testCount}
            </Badge>
          )}
        </div>
      )}
      {latest && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate font-mono text-[11px]">
            {latest.step_name}
          </span>
        </div>
      )}
      {total === 0 && (
        <div className="flex items-center gap-2 text-xs text-text-muted py-1">
          <Terminal className="size-3.5 opacity-50" />
          <span>No commands yet</span>
        </div>
      )}
    </div>
  );
}

function UiBridgeSummary({
  stepsData,
}: {
  runId: string;
  stepsData: CurrentExecutionStepsResponse | null;
}) {
  const uiBridgeSteps = (stepsData?.executions || []).filter((e) =>
    UI_BRIDGE_STEP_TYPES.has(e.step_type.toLowerCase())
  );
  const total = uiBridgeSteps.length;
  const assertions = uiBridgeSteps.filter((e) => {
    const name = e.step_name.toLowerCase();
    return (
      name.includes("assert") ||
      name.includes("verify") ||
      name.includes("check")
    );
  });
  const assertionsPassed = assertions.filter(
    (e) => e.status === "success"
  ).length;
  const latest = uiBridgeSteps[uiBridgeSteps.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] gap-1">
          <Monitor className="size-2.5" />
          {total} action{total !== 1 ? "s" : ""}
        </Badge>
        {assertions.length > 0 && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              assertionsPassed === assertions.length
                ? "text-green-400 border-green-500/30"
                : "text-amber-400 border-amber-500/30"
            )}
          >
            {assertionsPassed}/{assertions.length} assertions
          </Badge>
        )}
      </div>
      {latest && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate">{latest.step_name}</span>
        </div>
      )}
      {total === 0 && (
        <p className="text-xs text-text-muted">No UI Bridge actions yet...</p>
      )}
    </div>
  );
}

function FlowExecutionSummary({
  stepsData,
}: {
  runId: string;
  stepsData: CurrentExecutionStepsResponse | null;
}) {
  const flowSteps = (stepsData?.executions || []).filter((e) =>
    FLOW_STEP_TYPES.has(e.step_type.toLowerCase())
  );
  const total = flowSteps.length;

  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-[10px] gap-1">
        <GitBranch className="size-2.5" />
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

// ---------------------------------------------------------------------------
// Summary Card wrapper & dispatcher
// ---------------------------------------------------------------------------

export function SummaryCard({
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
      <div className="p-3">{children}</div>
    </div>
  );
}

export function SummaryContent({
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
    case "verification":
      return <VerificationSummary runId={runId} />;
    case "findings":
      return <FindingsSummary runId={runId} />;
    case "command":
      return <CommandSummary runId={runId} stepsData={stepsData} />;
    case "ui-bridge":
      return <UiBridgeSummary runId={runId} stepsData={stepsData} />;
    case "flow-execution":
      return <FlowExecutionSummary runId={runId} stepsData={stepsData} />;
    case "status":
      return <StatusSummary run={run} />;
    default:
      return null;
  }
}
