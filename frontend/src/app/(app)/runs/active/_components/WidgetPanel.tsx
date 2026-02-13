"use client";

import type { TaskRun } from "@/lib/runner";
import { AiConversationWidget } from "@/components/active-dashboard/widgets/AiConversationWidget";
import { ExecutionTimelineWidget } from "@/components/active-dashboard/widgets/ExecutionTimelineWidget";
import { FindingsWidget } from "@/components/active-dashboard/widgets/FindingsWidget";
import { VerificationWidget } from "@/components/active-dashboard/widgets/VerificationWidget";
import { ExecutionStatusWidget } from "@/components/active-dashboard/widgets/ExecutionStatusWidget";
import { McpCallsWidget } from "@/components/active-dashboard/widgets/McpCallsWidget";
import { ScreenshotsWidget } from "@/components/active-dashboard/widgets/ScreenshotsWidget";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { WidgetId, WidgetConfig } from "../_lib";

export function WidgetContent({
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

export function FullWidget({
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
      <div className="flex-1 min-h-0 overflow-hidden">
        <WidgetContent widgetId={widgetId} runId={runId} run={run} />
      </div>
    </div>
  );
}
