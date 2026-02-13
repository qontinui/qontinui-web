"use client";

import type {
  TaskRun,
  CurrentExecutionStepsResponse,
  VerificationData,
  TaskRunKnowledge,
  Screenshot,
  McpCall,
} from "@/lib/runner";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Activity,
  MessageSquare,
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
} from "lucide-react";
import type { WidgetId, WidgetConfig } from "../_lib";
import {
  transformScreenshots,
  transformVerification,
  transformKnowledge,
  transformMcpCalls,
} from "../_lib";

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
  const { data: outputData } = useEventTriggeredFetch<{ output?: string; output_log?: string; sessions_count?: number }>(
    "ai-output",
    `/task-runs/${runId}/output`,
  );

  const output = outputData?.output_log ?? outputData?.output ?? "";
  const sessionCount = outputData?.sessions_count ?? 0;

  const userMessages = (output.match(/\[USER_MESSAGE\]/g) || []).length;
  const hasContent = output.trim().length > 0;

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
