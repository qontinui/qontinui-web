import { useParams } from "next/navigation";
import {
  useBackendTaskRun,
  useUpdateBackendFindingStatus,
} from "@/hooks/useTaskRunsBackend";
import type { TaskRunFindingStatus } from "@/types/task-runs";

export function useTaskDetail() {
  const params = useParams();
  const taskId = params.id as string;

  const { data: task, isLoading, error, refetch } = useBackendTaskRun(taskId);
  const updateFinding = useUpdateBackendFindingStatus();

  const handleFindingStatusChange = async (
    findingId: string,
    newStatus: string
  ) => {
    try {
      await updateFinding.mutateAsync({
        taskId,
        findingId,
        data: { status: newStatus as TaskRunFindingStatus },
      });
    } catch (err) {
      console.error("Failed to update finding status:", err);
    }
  };

  return {
    taskId,
    task,
    isLoading,
    error,
    refetch,
    handleFindingStatusChange,
  };
}
