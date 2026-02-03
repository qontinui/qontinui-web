/**
 * Hook for fetching and managing state discovery results.
 *
 * Provides access to the unified state discovery results API,
 * which contains state machines from any discovery source
 * (Playwright, UI Bridge, Recording, Vision, etc.).
 */

import { useState, useEffect, useCallback } from "react";
import {
  StateDiscoveryResult,
  StateDiscoveryResultSummary,
  toStateDiscoveryResult,
  toStateDiscoveryResultSummary,
} from "@/types/state-machine";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface UseStateDiscoveryResultsOptions {
  projectId: string | null;
  autoFetch?: boolean;
}

interface UseStateDiscoveryResultsReturn {
  // List of results (summaries)
  results: StateDiscoveryResultSummary[];
  isLoading: boolean;
  error: string | null;

  // Selected result (full data)
  selectedResult: StateDiscoveryResult | null;
  isLoadingDetail: boolean;
  detailError: string | null;

  // Actions
  fetchResults: () => Promise<void>;
  selectResult: (resultId: string) => Promise<void>;
  clearSelection: () => void;
  deleteResult: (resultId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useStateDiscoveryResults({
  projectId,
  autoFetch = true,
}: UseStateDiscoveryResultsOptions): UseStateDiscoveryResultsReturn {
  const [results, setResults] = useState<StateDiscoveryResultSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedResult, setSelectedResult] = useState<StateDiscoveryResult | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    if (!projectId) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/projects/${projectId}/state-discovery-results`,
        { credentials: "include" }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json() as { items: Record<string, unknown>[]; total: number };
      setResults(data.items.map(toStateDiscoveryResultSummary));
    } catch (err) {
      console.error("Failed to fetch state discovery results:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch results");
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const selectResult = useCallback(async (resultId: string) => {
    if (!projectId) return;

    setIsLoadingDetail(true);
    setDetailError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/projects/${projectId}/state-discovery-results/${resultId}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json() as Record<string, unknown>;
      setSelectedResult(toStateDiscoveryResult(data));
    } catch (err) {
      console.error("Failed to fetch result detail:", err);
      setDetailError(err instanceof Error ? err.message : "Failed to fetch result");
      setSelectedResult(null);
    } finally {
      setIsLoadingDetail(false);
    }
  }, [projectId]);

  const clearSelection = useCallback(() => {
    setSelectedResult(null);
    setDetailError(null);
  }, []);

  const deleteResult = useCallback(async (resultId: string) => {
    if (!projectId) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/projects/${projectId}/state-discovery-results/${resultId}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Remove from local state
      setResults((prev) => prev.filter((r) => r.id !== resultId));

      // Clear selection if this was the selected result
      if (selectedResult?.id === resultId) {
        clearSelection();
      }
    } catch (err) {
      console.error("Failed to delete result:", err);
      throw err;
    }
  }, [projectId, selectedResult?.id, clearSelection]);

  const refresh = useCallback(async () => {
    await fetchResults();
    if (selectedResult) {
      await selectResult(selectedResult.id);
    }
  }, [fetchResults, selectResult, selectedResult]);

  // Auto-fetch on mount and when projectId changes
  useEffect(() => {
    if (autoFetch && projectId) {
      fetchResults();
    }
  }, [autoFetch, projectId, fetchResults]);

  return {
    results,
    isLoading,
    error,
    selectedResult,
    isLoadingDetail,
    detailError,
    fetchResults,
    selectResult,
    clearSelection,
    deleteResult,
    refresh,
  };
}
