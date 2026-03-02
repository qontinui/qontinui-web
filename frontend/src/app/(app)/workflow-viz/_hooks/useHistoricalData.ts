import { useEffect, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ImageRecognitionEvent } from "@/hooks/useExecutionEvents";
import type { TestRunSummary, HistoricalResult } from "../types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function useHistoricalData(
  projectId: string | null | undefined,
  canvasMode: "perception" | "config",
  isLiveMode: boolean
) {
  const [testRuns, setTestRuns] = useState<TestRunSummary[]>([]);
  const [selectedTestRunId, setSelectedTestRunId] = useState<string | null>(
    null
  );
  const [loadingTestRuns, setLoadingTestRuns] = useState(false);

  const fetchTestRuns = useCallback(async () => {
    if (!projectId) {
      setTestRuns([]);
      return;
    }

    setLoadingTestRuns(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/testing/runs?project_id=${projectId}&limit=50&sort_order=desc`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch test runs");
      const data = (await res.json()) as {
        runs: TestRunSummary[];
        total: number;
      };
      setTestRuns(data.runs || []);
    } catch (error) {
      console.error("Failed to fetch test runs:", error);
      setTestRuns([]);
    } finally {
      setLoadingTestRuns(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (canvasMode === "perception" && !isLiveMode) {
      fetchTestRuns();
    }
  }, [projectId, canvasMode, isLiveMode, fetchTestRuns]);

  const { data: historicalResults = [], isLoading: loadingHistoricalData } =
    useQuery({
      queryKey: ["historical-results", selectedTestRunId],
      queryFn: async () => {
        const res = await fetch(
          `${API_BASE_URL}/api/v1/historical/test-run/${selectedTestRunId}`,
          { credentials: "include" }
        );
        if (!res.ok) throw new Error("Failed to fetch historical results");
        const data = (await res.json()) as {
          test_run_id: string;
          total_results: number;
          results: HistoricalResult[];
        };
        if (data.results?.length > 0) {
          const { toast } = await import("sonner");
          toast.success(`Loaded ${data.results.length} recognition results`);
        }
        return data.results || [];
      },
      enabled: !!selectedTestRunId,
      retry: false,
      staleTime: 30000,
      meta: {
        errorMessage: "Failed to load historical data",
      },
    });

  const historicalFoundImages = useMemo(() => {
    if (historicalResults.length === 0)
      return new Map<string, ImageRecognitionEvent>();

    const foundMap = new Map<string, ImageRecognitionEvent>();

    for (const result of historicalResults) {
      if (
        result.pattern_id &&
        result.match_x != null &&
        result.match_y != null
      ) {
        foundMap.set(result.pattern_id, {
          imageId: result.pattern_id,
          stateId: "",
          patternId: result.pattern_id,
          x: result.match_x,
          y: result.match_y,
          width: result.match_width || 0,
          height: result.match_height || 0,
          confidence: 1.0,
          found: result.success,
          timestamp: Date.now(),
        });
      }
    }

    return foundMap;
  }, [historicalResults]);

  const historicalActiveStateIds = useMemo(() => {
    const stateIds = new Set<string>();
    for (const result of historicalResults) {
      if (result.active_states) {
        for (const state of result.active_states) {
          stateIds.add(state);
        }
      }
    }
    return stateIds;
  }, [historicalResults]);

  return {
    testRuns,
    selectedTestRunId,
    setSelectedTestRunId,
    loadingTestRuns,
    historicalResults,
    loadingHistoricalData,
    historicalFoundImages,
    historicalActiveStateIds,
  };
}
