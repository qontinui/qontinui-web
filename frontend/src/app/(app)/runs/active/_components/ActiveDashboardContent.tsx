"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { TaskRun } from "@/lib/runner";
import { useRunnerEvent } from "@/contexts/RunnerEventContext";
import { useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import { ControlBar } from "@/components/active-dashboard/ControlBar";
import { BottomBar } from "@/components/active-dashboard/BottomBar";
import { detectWidgets, type WidgetId } from "../_lib";
import { DashboardLayout } from "./DashboardLayout";
import { TabBar } from "./TabBar";
import { WidgetContent } from "./WidgetPanel";

export function ActiveDashboardContent({
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

  if (detectedWidgets.length > 0 && !detectedWidgets.includes(activeWidget)) {
    // Will correct on next render cycle
  }

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
          <WidgetContent widgetId={activeTab} runId={runId} run={run} />
        </div>
      )}

      <BottomBar run={run} />
    </div>
  );
}
