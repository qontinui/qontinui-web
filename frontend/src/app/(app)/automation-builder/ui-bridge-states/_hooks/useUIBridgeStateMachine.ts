"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useAutomationStore } from "@/stores/automation";
import type { ConfigWithStatesAndTransitions } from "../_types";

interface SavedConfig {
  id: string;
  name: string;
  description: string | null;
  render_count: number;
  element_count: number;
  created_at: string;
}

export function useUIBridgeStateMachine() {
  const projectId = useAutomationStore((s) => s.projectId);

  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [fullConfig, setFullConfig] = useState<ConfigWithStatesAndTransitions | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);

  // Load available configs
  const loadConfigs = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/ui-bridge-configs`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.items || []);
      }
    } catch (err) {
      console.error("Failed to load configs:", err);
    }
  }, [projectId]);

  // Load full config (states + transitions)
  const loadFullConfig = useCallback(async (configId: string) => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}/full`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data: ConfigWithStatesAndTransitions = await res.json();
        setFullConfig(data);
      } else {
        toast.error("Failed to load configuration");
      }
    } catch (err) {
      console.error("Failed to load full config:", err);
      toast.error("Failed to load configuration");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Auto-load configs on mount
  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  // Auto-load full config when selection changes
  useEffect(() => {
    if (selectedConfigId) {
      loadFullConfig(selectedConfigId);
    } else {
      setFullConfig(null);
    }
  }, [selectedConfigId, loadFullConfig]);

  // Get selected state details
  const selectedState = fullConfig?.states.find(
    (s) => s.state_id === selectedStateId || s.id === selectedStateId
  ) ?? null;

  // Get selected transition details
  const selectedTransition = fullConfig?.transitions.find(
    (t) => t.transition_id === selectedTransitionId || t.id === selectedTransitionId
  ) ?? null;

  return {
    projectId,
    configs,
    selectedConfigId,
    setSelectedConfigId,
    fullConfig,
    isLoading,
    selectedStateId,
    setSelectedStateId,
    selectedTransitionId,
    setSelectedTransitionId,
    selectedState,
    selectedTransition,
    loadConfigs,
    loadFullConfig,
    refresh: () => selectedConfigId && loadFullConfig(selectedConfigId),
  };
}
