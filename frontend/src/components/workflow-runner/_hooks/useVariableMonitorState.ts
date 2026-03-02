import { useState, useMemo, useCallback } from "react";
import { useWorkflowVariables } from "@/hooks/useWorkflowVariables";
import type { VariableScope } from "@/types/workflow-variables";
import { toast } from "sonner";

export type VariableMonitorTab = "current" | "history" | "global";

interface UseVariableMonitorStateOptions {
  runId: string;
  refreshInterval: number;
  defaultTab: VariableMonitorTab;
  onRefreshIntervalChange?: (interval: number) => void;
}

export function useVariableMonitorState({
  runId,
  refreshInterval,
  defaultTab,
  onRefreshIntervalChange,
}: UseVariableMonitorStateOptions) {
  const [activeTab, setActiveTab] = useState<VariableMonitorTab>(defaultTab);
  const [searchTerm, setSearchTerm] = useState("");
  const [scopeFilter, setScopeFilter] = useState<VariableScope | "all">("all");
  const [isRefreshing, setIsRefreshing] = useState(true);

  const {
    flattenedVariables,
    variablesSnapshot,
    history,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useWorkflowVariables(runId, isRefreshing ? refreshInterval : 0);

  const filteredVariables = useMemo(() => {
    return flattenedVariables.filter((variable) => {
      if (
        searchTerm &&
        !variable.name.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }
      if (scopeFilter !== "all" && variable.scope !== scopeFilter) {
        return false;
      }
      return true;
    });
  }, [flattenedVariables, searchTerm, scopeFilter]);

  const globalVariables = useMemo(() => {
    return flattenedVariables.filter((v) => v.scope === "global");
  }, [flattenedVariables]);

  const handleExport = useCallback(() => {
    try {
      const exportData = {
        run_id: runId,
        exported_at: new Date().toISOString(),
        variables: variablesSnapshot,
        history: history,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workflow-variables-${runId}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Variables exported successfully");
    } catch {
      toast.error("Failed to export variables");
    }
  }, [runId, variablesSnapshot, history]);

  const toggleRefresh = useCallback(() => {
    const newValue = !isRefreshing;
    setIsRefreshing(newValue);
    if (onRefreshIntervalChange) {
      onRefreshIntervalChange(newValue ? refreshInterval : 0);
    }
  }, [isRefreshing, onRefreshIntervalChange, refreshInterval]);

  return {
    activeTab,
    setActiveTab,
    searchTerm,
    setSearchTerm,
    scopeFilter,
    setScopeFilter,
    isRefreshing,
    filteredVariables,
    globalVariables,
    history,
    isLoading,
    error,
    refetch,
    isFetching,
    handleExport,
    toggleRefresh,
    refreshInterval,
  };
}
