import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  useBackendTaskRun,
  useUpdateBackendFindingStatus,
} from "@/hooks/useTaskRunsBackend";
import type { TaskRunFindingStatus } from "@/types/task-runs";

export function useTaskDetail() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;

  const { data: task, isLoading, error, refetch } = useBackendTaskRun(taskId);
  const updateFinding = useUpdateBackendFindingStatus();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

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
    user,
    authLoading,
    taskId,
    task,
    isLoading,
    error,
    refetch,
    handleFindingStatusChange,
  };
}
