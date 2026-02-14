"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { TaskRun } from "@/lib/runner-api";
import {
  useEventTriggeredFetch,
  useRunnerEvent,
} from "@/contexts/RunnerEventContext";
import { SharedRunnerDataProvider, useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ControlBar } from "@/components/active-dashboard/ControlBar";
import { BottomBar } from "@/components/active-dashboard/BottomBar";
import { runnerApi } from "@/lib/runner-api";
import {
  AUTO_RUN_AFTER_GENERATE_KEY,
  type AutoRunAfterGenerate,
} from "@/components/workflow-builder/AiGeneratePanel";
import { toast } from "sonner";
import { Activity, RefreshCw } from "lucide-react";
import type { WidgetId } from "../_lib";
import { detectWidgets } from "../_lib";
import { ActiveRunsBar } from "./ActiveRunsBar";
import { DashboardLayout } from "./DashboardLayout";
import { TabBar } from "./TabBar";
import { WidgetContent } from "./WidgetPanel";
import { IdleState, CompletedState } from "./EmptyStates";

export function ActiveRunsContent() {
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

  // Auto-run logic
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

    if (Date.now() - signal.timestamp > 30 * 60 * 1000) {
      localStorage.removeItem(AUTO_RUN_AFTER_GENERATE_KEY);
      return;
    }

    const stillRunning = activeRuns.some((r) => r.id === signal.taskRunId);

    if (stillRunning) {
      autoRunSeenRef.current = true;
      return;
    }

    if (!autoRunSeenRef.current) return;

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
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white flex flex-col">
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
          <ActiveDashboardInner
            run={selectedRun}
            runId={currentRunId!}
            onRefresh={() => refetchRuns()}
          />
        </SharedRunnerDataProvider>
      ) : null}
    </div>
  );
}

function ActiveDashboardInner({
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

  useEffect((): void | (() => void) => {
    if (!stepsData || completionRefetchedRef.current) return;
    const executions = stepsData.executions || [];
    if (executions.length === 0) return;

    const hasRunningOrPending = executions.some(
      (e) => e.status === "running" || e.status === "pending"
    );

    const hasCompletionStep = executions.some(
      (e) => e.phase?.toLowerCase() === "completion"
    );

    if (!hasRunningOrPending && hasCompletionStep) {
      completionRefetchedRef.current = true;
      const timer = setTimeout(() => onRefresh(), 2000);
      return () => clearTimeout(timer);
    }
  }, [stepsData, onRefresh]);

  const detectedWidgets = detectWidgets(stepsData);
  const summaryWidgets = detectedWidgets.filter((w) => w !== activeWidget);

  const handleWidgetClick = (id: WidgetId) => {
    userSelected.current = true;
    setActiveWidget(id);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ControlBar run={run} onRefresh={onRefresh} />

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

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

      <BottomBar run={run} />
    </div>
  );
}
