"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import type { UIBridgeDiscoveryResult } from "../../extraction/_types";

const API = `${ApiConfig.API_BASE_URL}/api/v1`;

interface DiscoverAndSaveResponse {
  config: {
    id: string;
    name: string;
    description: string | null;
    render_count: number;
    element_count: number;
  };
  states: Array<{
    id: string;
    state_id: string;
    name: string;
    confidence: number;
  }>;
  render_count: number;
  unique_element_count: number;
}

// --- localStorage persistence ---

const STORAGE_KEY_PREFIX = "qontinui-sm-discovery-";

interface PersistedDiscoveryState {
  renders: unknown[] | null;
  renderSource: "explore" | "record" | null;
  discoveryResult: UIBridgeDiscoveryResult | null;
  configName: string;
}

function getStorageKey(projectId: string | null): string | null {
  return projectId ? `${STORAGE_KEY_PREFIX}${projectId}` : null;
}

function loadPersistedState(
  projectId: string | null
): PersistedDiscoveryState | null {
  if (typeof window === "undefined") return null;
  const key = getStorageKey(projectId);
  if (!key) return null;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as PersistedDiscoveryState;
  } catch {
    // ignore parse errors
  }
  return null;
}

function savePersistedState(
  projectId: string | null,
  state: PersistedDiscoveryState
): void {
  if (typeof window === "undefined") return;
  const key = getStorageKey(projectId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function clearPersistedState(projectId: string | null): void {
  if (typeof window === "undefined") return;
  const key = getStorageKey(projectId);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function useStateMachineDiscovery(projectId: string | null) {
  // Load persisted state once on mount
  const [initial] = useState(() => loadPersistedState(projectId));

  const [renders, setRendersState] = useState<unknown[] | null>(
    initial?.renders ?? null
  );
  const [renderSource, setRenderSource] = useState<"explore" | "record" | null>(
    initial?.renderSource ?? null
  );
  const [discoveryResult, setDiscoveryResult] =
    useState<UIBridgeDiscoveryResult | null>(initial?.discoveryResult ?? null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [configName, setConfigName] = useState(initial?.configName ?? "");
  const [isSaving, setIsSaving] = useState(false);

  // Persist to localStorage when relevant state changes
  useEffect(() => {
    if (!renders && !discoveryResult && !configName) {
      clearPersistedState(projectId);
      return;
    }
    savePersistedState(projectId, {
      renders,
      renderSource,
      discoveryResult,
      configName,
    });
  }, [projectId, renders, renderSource, discoveryResult, configName]);

  const setRenders = useCallback(
    (newRenders: unknown[], source: "explore" | "record") => {
      setRendersState(newRenders);
      setRenderSource(source);
      setDiscoveryResult(null);
    },
    []
  );

  const runDiscovery = useCallback(async () => {
    if (!renders || renders.length === 0) {
      toast.error("No render logs to discover states from");
      return null;
    }

    setIsDiscovering(true);
    try {
      const res = await httpClient.fetch(
        `${API}/state-discovery/ui-bridge/discover-states`,
        {
          method: "POST",
          body: JSON.stringify({
            renders,
            include_html_ids: true,
            strategy: "auto",
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Discovery failed");
      }

      const result: UIBridgeDiscoveryResult = await res.json();
      setDiscoveryResult(result);
      toast.success(`Discovered ${result.states.length} states`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Discovery failed";
      toast.error(message);
      return null;
    } finally {
      setIsDiscovering(false);
    }
  }, [renders]);

  const saveToProject = useCallback(async (): Promise<string | null> => {
    if (!projectId) {
      toast.error("No project selected");
      return null;
    }
    if (!renders || renders.length === 0) {
      toast.error("No render logs available");
      return null;
    }
    if (!configName.trim()) {
      toast.error("Please enter a config name");
      return null;
    }

    setIsSaving(true);
    try {
      const res = await httpClient.fetch(
        `${API}/projects/${projectId}/ui-bridge-discover`,
        {
          method: "POST",
          body: JSON.stringify({
            renders,
            include_html_ids: true,
            config_name: configName.trim(),
            strategy: "auto",
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to save config");
      }

      const data: DiscoverAndSaveResponse = await res.json();
      toast.success(
        `Saved config "${data.config.name}" with ${data.states.length} states`
      );

      // Clear discovery state — data is now persisted in DB
      setRendersState(null);
      setRenderSource(null);
      setDiscoveryResult(null);
      setConfigName("");

      return data.config.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error(message);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [projectId, renders, configName]);

  const reset = useCallback(() => {
    setRendersState(null);
    setRenderSource(null);
    setDiscoveryResult(null);
    setConfigName("");
    clearPersistedState(projectId);
  }, [projectId]);

  return {
    renders,
    renderSource,
    discoveryResult,
    isDiscovering,
    configName,
    setConfigName,
    isSaving,
    setRenders,
    runDiscovery,
    saveToProject,
    reset,
  };
}
