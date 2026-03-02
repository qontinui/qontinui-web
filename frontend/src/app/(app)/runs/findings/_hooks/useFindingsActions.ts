import { useState } from "react";
import { runnerApi } from "@/lib/runner";
import type { FindingsSummaryView } from "@/lib/task-run-mappers";
import { toast } from "sonner";

export function useFindingsActions(
  data: FindingsSummaryView | null,
  isRunnerOffline: boolean,
  refetch: () => void
) {
  const [autoFixEnabled, setAutoFixEnabled] = useState(false);
  const [isFixing, setIsFixing] = useState(false);

  const toggleAutoFix = () => {
    setAutoFixEnabled((prev) => {
      toast.info(!prev ? "Auto-fix enabled" : "Auto-fix disabled");
      return !prev;
    });
  };

  const handleFixAll = async () => {
    if (isRunnerOffline) {
      toast.error("Cannot fix findings while runner is offline");
      return;
    }
    if (!data?.recent || data.recent.length === 0) return;
    setIsFixing(true);
    try {
      const autoFixFindings = data.recent.filter(
        (f) => f.status !== "resolved"
      );
      if (autoFixFindings.length === 0) {
        toast.info("No unresolved findings to fix");
        return;
      }
      let successCount = 0;
      for (const finding of autoFixFindings) {
        try {
          await runnerApi.updateFindingStatus(
            String(finding.id),
            "in_progress"
          );
          successCount++;
        } catch {
          // Continue with remaining findings
        }
      }
      toast.success(
        `Started fixing ${successCount} of ${autoFixFindings.length} findings`
      );
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to fix findings"
      );
    } finally {
      setIsFixing(false);
    }
  };

  const handleClearAll = async () => {
    if (isRunnerOffline) {
      toast.error("Cannot clear findings while runner is offline");
      return;
    }
    if (!data?.recent || data.recent.length === 0) return;
    try {
      const taskRunId = data.recent[0]?.task_run_id;
      if (!taskRunId) {
        toast.error("No task run ID found in findings");
        return;
      }
      await runnerApi.clearAllFindings(taskRunId);
      toast.success("All findings cleared");
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to clear findings"
      );
    }
  };

  const handleResolveFinding = async (
    findingId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (isRunnerOffline) {
      toast.error("Cannot resolve findings while runner is offline");
      return;
    }
    try {
      await runnerApi.resolveFinding(findingId, "Resolved by user");
      toast.success("Finding resolved");
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to resolve finding"
      );
    }
  };

  return {
    autoFixEnabled,
    isFixing,
    toggleAutoFix,
    handleFixAll,
    handleClearAll,
    handleResolveFinding,
  };
}
