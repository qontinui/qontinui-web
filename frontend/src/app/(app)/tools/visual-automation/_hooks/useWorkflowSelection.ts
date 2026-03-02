import { useState, useMemo } from "react";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";

export function useWorkflowSelection() {
  const {
    data: workflows,
    isLoading: workflowsLoading,
    error: workflowsError,
  } = useUnifiedWorkflows();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );

  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    if (!searchQuery.trim()) return workflows;
    const lower = searchQuery.toLowerCase();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(lower) ||
        w.description?.toLowerCase().includes(lower)
    );
  }, [workflows, searchQuery]);

  const selectedWorkflow = useMemo(() => {
    if (!selectedWorkflowId || !workflows) return null;
    return workflows.find((w) => w.id === selectedWorkflowId) ?? null;
  }, [selectedWorkflowId, workflows]);

  return {
    workflows,
    workflowsLoading,
    workflowsError,
    searchQuery,
    setSearchQuery,
    selectedWorkflowId,
    setSelectedWorkflowId,
    filteredWorkflows,
    selectedWorkflow,
  };
}
