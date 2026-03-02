import { useMemo } from "react";
import { useTaskRunList } from "@/hooks/useTaskRunData";
import { computeStats } from "../types";

export function useStatistics() {
  const {
    data: runs,
    isLoading,
    error,
    isRunnerOffline,
    refetch,
  } = useTaskRunList({ limit: 50 });

  const stats = useMemo(() => {
    if (!runs || runs.length === 0) return null;
    return computeStats(runs);
  }, [runs]);

  return { runs, stats, isLoading, error, isRunnerOffline, refetch };
}
