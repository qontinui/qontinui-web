"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import type { UIBridgeDiscoveryResult } from "../../extraction/_types";

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

export function useStateMachineDiscovery(projectId: string | null) {
  const [renders, setRendersState] = useState<unknown[] | null>(null);
  const [renderSource, setRenderSource] = useState<"explore" | "record" | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<UIBridgeDiscoveryResult | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [configName, setConfigName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const setRenders = useCallback((newRenders: unknown[], source: "explore" | "record") => {
    setRendersState(newRenders);
    setRenderSource(source);
    setDiscoveryResult(null);
  }, []);

  const runDiscovery = useCallback(async () => {
    if (!renders || renders.length === 0) {
      toast.error("No render logs to discover states from");
      return null;
    }

    setIsDiscovering(true);
    try {
      const res = await fetch("/api/v1/state-discovery/ui-bridge/discover-states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          renders,
          include_html_ids: true,
          strategy: "auto",
        }),
      });

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
      const res = await fetch(`/api/v1/projects/${projectId}/ui-bridge-discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          renders,
          include_html_ids: true,
          config_name: configName.trim(),
          strategy: "auto",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to save config");
      }

      const data: DiscoverAndSaveResponse = await res.json();
      toast.success(`Saved config "${data.config.name}" with ${data.states.length} states`);
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
  }, []);

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
