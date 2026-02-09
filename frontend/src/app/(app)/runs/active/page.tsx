"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRunningTaskRuns, useExecutorStatus } from "@/lib/runner-api";
import type { TaskRun } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ControlBar } from "@/components/active-dashboard/ControlBar";
import { AiConversationWidget } from "@/components/active-dashboard/widgets/AiConversationWidget";
import { ExecutionTimelineWidget } from "@/components/active-dashboard/widgets/ExecutionTimelineWidget";
import { FindingsWidget } from "@/components/active-dashboard/widgets/FindingsWidget";
import { VerificationWidget } from "@/components/active-dashboard/widgets/VerificationWidget";
import { ExecutionStatusWidget } from "@/components/active-dashboard/widgets/ExecutionStatusWidget";
import { McpCallsWidget } from "@/components/active-dashboard/widgets/McpCallsWidget";
import { ScreenshotsWidget } from "@/components/active-dashboard/widgets/ScreenshotsWidget";
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
  Terminal,
  Camera,
} from "lucide-react";

type WidgetView =
  | "ai-conversation"
  | "timeline"
  | "findings"
  | "verification"
  | "status"
  | "mcp-calls"
  | "screenshots";

const WIDGET_TABS: { id: WidgetView; label: string; icon: React.ReactNode }[] =
  [
    {
      id: "ai-conversation",
      label: "AI",
      icon: <MessageSquare className="size-3.5" />,
    },
    {
      id: "timeline",
      label: "Timeline",
      icon: <Clock className="size-3.5" />,
    },
    {
      id: "findings",
      label: "Findings",
      icon: <Bug className="size-3.5" />,
    },
    {
      id: "verification",
      label: "Verify",
      icon: <ShieldCheck className="size-3.5" />,
    },
    { id: "status", label: "Status", icon: <Gauge className="size-3.5" /> },
    { id: "mcp-calls", label: "MCP", icon: <Terminal className="size-3.5" /> },
    {
      id: "screenshots",
      label: "Screenshots",
      icon: <Camera className="size-3.5" />,
    },
  ];

function ActiveRunsBar({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: TaskRun[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  if (runs.length <= 1) return null;

  return (
    <div className="flex gap-2 px-4 py-2 bg-surface-canvas/50 border-b border-border-subtle/50 overflow-x-auto">
      {runs.map((run) => (
        <button
          key={run.id}
          onClick={() => onSelect(run.id)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all shrink-0 ${
            selectedRunId === run.id
              ? "bg-brand-primary/10 border border-brand-primary/40 text-text-primary"
              : "bg-surface-raised/50 border border-border-subtle/50 text-text-muted hover:border-border-default"
          }`}
        >
          <PlayCircle className="size-3 text-blue-500 animate-pulse" />
          <span className="font-medium truncate max-w-[150px]">
            {run.task_name}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {run.phase || "\u2014"}
          </Badge>
        </button>
      ))}
    </div>
  );
}

function WidgetPanel({
  activeWidget,
  runId,
  run,
}: {
  activeWidget: WidgetView;
  runId: string;
  run: TaskRun;
}) {
  switch (activeWidget) {
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
    default:
      return null;
  }
}

export default function ActiveRunsPage() {
  const router = useRouter();
  const {
    data: activeRuns,
    isLoading: runsLoading,
    isOffline: runsOffline,
    refetch: refetchRuns,
  } = useRunningTaskRuns();
  const { isOffline: statusOffline } = useExecutorStatus();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [leftWidget, setLeftWidget] = useState<WidgetView>("ai-conversation");
  const [rightWidget, setRightWidget] = useState<WidgetView>("ai-conversation");

  const isOffline = runsOffline || statusOffline;
  if (isOffline) return <RunnerOfflineState />;

  const runs = activeRuns || [];
  const isLoading = runsLoading;

  // Auto-select first run
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
        <div className="flex-1 flex items-center justify-center">
          <Card className="bg-surface-raised/50 border-border-subtle/50 max-w-md">
            <CardContent className="py-12 text-center">
              <Inbox className="size-16 mx-auto mb-4 text-text-muted" />
              <h3 className="text-lg font-medium text-text-secondary mb-2">
                No Active Runs
              </h3>
              <p className="text-sm text-text-muted mb-4">
                Start a workflow to see the live dashboard.
              </p>
              <Button variant="outline" onClick={() => router.push("/runs")}>
                View Run History
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : selectedRun ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Control bar */}
          <ControlBar run={selectedRun} onRefresh={() => refetchRuns()} />

          {/* Widget tab selectors */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-border-subtle/50 bg-surface-canvas/30">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-text-muted mr-1">Left:</span>
              {WIDGET_TABS.map((tab) => (
                <Button
                  key={tab.id}
                  variant={leftWidget === tab.id ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setLeftWidget(tab.id)}
                  className={`h-7 px-2 text-xs gap-1 ${
                    leftWidget === tab.id
                      ? "bg-brand-primary/20 text-brand-primary"
                      : "text-text-muted"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </Button>
              ))}
            </div>
            <div className="h-4 w-px bg-border-subtle" />
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-text-muted mr-1">Right:</span>
              {WIDGET_TABS.map((tab) => (
                <Button
                  key={tab.id}
                  variant={rightWidget === tab.id ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setRightWidget(tab.id)}
                  className={`h-7 px-2 text-xs gap-1 ${
                    rightWidget === tab.id
                      ? "bg-brand-primary/20 text-brand-primary"
                      : "text-text-muted"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Widget panels - 65/35 split */}
          <div className="flex-1 flex min-h-0 p-4 gap-4">
            <div className="flex-[65] min-w-0 min-h-0">
              <WidgetPanel
                activeWidget={leftWidget}
                runId={currentRunId!}
                run={selectedRun}
              />
            </div>
            <div className="flex-[35] min-w-0 min-h-0">
              <WidgetPanel
                activeWidget={rightWidget}
                runId={currentRunId!}
                run={selectedRun}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
