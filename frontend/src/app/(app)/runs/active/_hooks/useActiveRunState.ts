"use client";

import { useState, useRef, useEffect } from "react";
import type { TaskRun } from "@/lib/runner-api";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import type { WidgetId } from "../_lib";

export interface ActiveRunStateResult {
  runs: TaskRun[];
  isLoading: boolean;
  isOffline: boolean;
  selectedRunId: string | null;
  selectedRun: TaskRun | null;
  setSelectedRunId: (id: string | null) => void;
  refetchRuns: () => void;
  lastKnownRunIds: React.MutableRefObject<Set<string>>;
  activeWidget: WidgetId;
  setActiveWidget: (id: WidgetId) => void;
  activeTab: "dashboard" | WidgetId;
  setActiveTab: (tab: "dashboard" | WidgetId) => void;
}

export function useActiveRunState(): ActiveRunStateResult {
  const {
    data: activeRuns,
    isLoading,
    isOffline,
    refetch: refetchRuns,
  } = useEventTriggeredFetch<TaskRun[]>(
    "task-run-update",
    "/task-runs/running"
  );

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeWidget, setActiveWidget] = useState<WidgetId>("timeline");
  const [activeTab, setActiveTab] = useState<"dashboard" | WidgetId>("dashboard");
  const lastKnownRunIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (activeRuns && activeRuns.length > 0) {
      lastKnownRunIds.current = new Set(activeRuns.map((r) => r.id));
    }
  }, [activeRuns]);

  const runs = activeRuns || [];
  const selectedRun =
    runs.find((r) => r.id === selectedRunId) || runs[0] || null;
  const currentRunId = selectedRun?.id || null;

  return {
    runs,
    isLoading,
    isOffline,
    selectedRunId: currentRunId,
    selectedRun,
    setSelectedRunId,
    refetchRuns,
    lastKnownRunIds,
    activeWidget,
    setActiveWidget,
    activeTab,
    setActiveTab,
  };
}
