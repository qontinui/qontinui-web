import { useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import type { DiscoveredState, StateDetectionResponse } from "../types";

export function useStateDetection(initialSessionId?: string) {
  const [sessionId, setSessionId] = useState<string>(initialSessionId || "");
  const [states, setStates] = useState<DiscoveredState[]>([]);
  const [selectedState, setSelectedState] = useState<DiscoveredState | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingStateId, setEditingStateId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [algorithm, setAlgorithm] = useState("timestamp_clustering");
  const [stateThreshold, setStateThreshold] = useState(2.0);
  const [maxInputDistance, setMaxInputDistance] = useState(5.0);
  const [metadata, setMetadata] = useState<StateDetectionResponse | null>(null);

  const loadStates = useCallback(async () => {
    if (!sessionId) {
      setError("Please enter a session ID");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient["fetchWithAuth"](
        `/state-discovery/sessions/${sessionId}/discovered-states?algorithm=${algorithm}&state_threshold_seconds=${stateThreshold}&max_input_distance_seconds=${maxInputDistance}`,
        { method: "GET" }
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: "Failed to load states" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const data: StateDetectionResponse = await response.json();
      setStates(data.states);
      setMetadata(data);
      setSelectedState(data.states[0] || null);
      toast.success(
        `Loaded ${data.total_states} states in ${data.processing_time_ms.toFixed(1)}ms`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load states";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, algorithm, stateThreshold, maxInputDistance]);

  const handleRenameState = useCallback(
    async (stateId: string, newName: string) => {
      if (!newName.trim()) {
        toast.error("State name cannot be empty");
        return;
      }

      try {
        const response = await apiClient["fetchWithAuth"](
          `/state-detection/states/${stateId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ name: newName }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to rename state");
        }

        setStates((prev) =>
          prev.map((s) =>
            s.state_id === stateId ? { ...s, state_id: newName } : s
          )
        );

        if (selectedState?.state_id === stateId) {
          setSelectedState((prev) =>
            prev ? { ...prev, state_id: newName } : null
          );
        }

        setEditingStateId(null);
        setEditValue("");
        toast.success("State renamed successfully");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to rename state";
        toast.error(message);
      }
    },
    [selectedState]
  );

  const handleExport = useCallback(
    async (onExport?: (states: DiscoveredState[]) => void) => {
      if (states.length === 0) {
        toast.error("No states to export");
        return;
      }

      if (onExport) {
        onExport(states);
        return;
      }

      try {
        const response = await apiClient["fetchWithAuth"](
          "/automation/import-state",
          {
            method: "POST",
            body: JSON.stringify({ states, session_id: sessionId }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to export states");
        }

        const result = await response.json();
        toast.success(
          `Exported ${result.imported_count} states to automation project`
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to export states";
        toast.error(message);
      }
    },
    [states, sessionId]
  );

  const filteredStates = states.filter((state) =>
    state.state_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return {
    sessionId,
    setSessionId,
    states,
    selectedState,
    setSelectedState,
    searchQuery,
    setSearchQuery,
    isLoading,
    error,
    editingStateId,
    setEditingStateId,
    editValue,
    setEditValue,
    algorithm,
    setAlgorithm,
    stateThreshold,
    setStateThreshold,
    maxInputDistance,
    setMaxInputDistance,
    metadata,
    filteredStates,
    loadStates,
    handleRenameState,
    handleExport,
  };
}
