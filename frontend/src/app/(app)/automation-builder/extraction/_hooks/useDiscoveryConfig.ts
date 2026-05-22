import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ExtractionState } from "./useExtractionState";
import type { DiscoveredState, SavedState } from "../_types";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
const logger = createLogger("UseDiscoveryConfig");
const API = `${ApiConfig.API_BASE_URL}/api/v1`;

interface UseDiscoveryConfigArgs {
  projectId: string | null;
  state: ExtractionState;
  configMethod: string;
}

export function useDiscoveryConfig({
  projectId,
  state,
  configMethod,
}: UseDiscoveryConfigArgs) {
  // Keep a ref to state so callbacks can access setters without re-creating
  const stateRef = useRef(state);
  stateRef.current = state;

  // Load saved configs
  const loadConfigs = useCallback(async () => {
    if (!projectId) return;

    stateRef.current.setIsLoadingConfigs(true);
    try {
      const response = await httpClient.fetch(
        `${API}/projects/${projectId}/ui-bridge-configs`
      );

      if (response.ok) {
        const data = await response.json();
        stateRef.current.setSavedConfigs(data.items || []);
      }
    } catch (error) {
      logger.error("Failed to load configs:", error);
    } finally {
      stateRef.current.setIsLoadingConfigs(false);
    }
  }, [projectId]);

  // Load configs when in UI Bridge mode
  useEffect(() => {
    if (configMethod === "ui-bridge") {
      loadConfigs();
    }
  }, [configMethod, loadConfigs]);

  // Load saved config
  const loadSavedConfig = useCallback(
    async (configId: string) => {
      if (!projectId) return;

      stateRef.current.setIsLoadingConfigs(true);
      try {
        const response = await httpClient.fetch(
          `${API}/projects/${projectId}/ui-bridge-configs/${configId}`
        );

        if (!response.ok) {
          throw new Error("Failed to load config");
        }

        const cfg = await response.json();

        const uuidMap: Record<string, string> = {};
        const states: DiscoveredState[] = cfg.states.map((s: SavedState) => {
          uuidMap[s.state_id] = s.id;
          return {
            id: s.state_id,
            name: s.name,
            state_image_ids: s.element_ids,
            screenshot_ids: s.render_ids,
            confidence: s.confidence,
            description: s.description,
            domain_knowledge: s.domain_knowledge || [],
          };
        });

        const descriptions: Record<string, string> = {};
        cfg.states.forEach((s: SavedState) => {
          if (s.description) {
            descriptions[s.state_id] = s.description;
          }
        });

        stateRef.current.setStateUuidMap(uuidMap);
        stateRef.current.setDiscoveryResult({
          states,
          elements: [],
          element_to_renders: {},
          render_count: cfg.render_count,
          unique_element_count: cfg.element_count,
        });
        stateRef.current.setStateDescriptions(descriptions);
        stateRef.current.setSelectedStateId(states[0]?.id || null);
        stateRef.current.setCurrentSavedConfigId(configId);
        stateRef.current.setConfigName(cfg.name);

        toast.success(`Loaded config "${cfg.name}"`);
      } catch (error) {
        logger.error("Failed to load config:", error);
        toast.error("Failed to load config");
      } finally {
        stateRef.current.setIsLoadingConfigs(false);
      }
    },
    [projectId]
  );

  // Run state discovery
  const runDiscovery = useCallback(async () => {
    const { rendersToAnalyze, discoveryStrategy } = stateRef.current;
    if (!rendersToAnalyze || rendersToAnalyze.length === 0) {
      toast.error("No render logs to analyze");
      return;
    }

    stateRef.current.setIsDiscovering(true);
    try {
      const response = await httpClient.fetch(
        `${API}/state-discovery/ui-bridge/discover-states`,
        {
          method: "POST",
          body: JSON.stringify({
            renders: rendersToAnalyze,
            include_html_ids: false,
            strategy: discoveryStrategy,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "State discovery failed");
      }

      const result = await response.json();
      stateRef.current.setDiscoveryResult(result);
      stateRef.current.setSelectedStateId(result.states[0]?.id || null);
      stateRef.current.setStateDescriptions({});
      stateRef.current.setCurrentSavedConfigId(null);
      stateRef.current.setStateUuidMap({});

      const strategyLabel =
        result.strategy_used === "fingerprint" ? " (fingerprint)" : "";
      toast.success(
        `Discovered ${result.states.length} states from ${result.render_count} renders${strategyLabel}`
      );
    } catch (error) {
      logger.error("State discovery error:", error);
      toast.error(
        error instanceof Error ? error.message : "State discovery failed"
      );
    } finally {
      stateRef.current.setIsDiscovering(false);
    }
  }, []);

  // Save discovered states
  const saveDiscoveredStates = useCallback(async () => {
    if (!projectId) {
      toast.error("Please select a project first");
      return;
    }

    const currentState = stateRef.current;
    if (
      !currentState.rendersToAnalyze ||
      currentState.rendersToAnalyze.length === 0
    ) {
      toast.error("No render logs to save");
      return;
    }

    currentState.setIsSaving(true);
    try {
      const response = await httpClient.fetch(
        `${API}/projects/${projectId}/ui-bridge-discover`,
        {
          method: "POST",
          body: JSON.stringify({
            config_name: currentState.configName,
            renders: currentState.rendersToAnalyze,
            include_html_ids: false,
            strategy: currentState.discoveryStrategy,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to save states");
      }

      const result = await response.json();

      const uuidMap: Record<string, string> = {};
      const states: DiscoveredState[] = result.states.map(
        (s: SavedState & { state_id: string }) => {
          uuidMap[s.state_id] = s.id;
          return {
            id: s.state_id,
            name: s.name,
            state_image_ids: s.element_ids,
            screenshot_ids: s.render_ids,
            confidence: s.confidence,
            description: s.description,
            domain_knowledge: [],
          };
        }
      );

      currentState.setStateUuidMap(uuidMap);
      currentState.setDiscoveryResult({
        states,
        elements: currentState.discoveryResult?.elements || [],
        element_to_renders:
          currentState.discoveryResult?.element_to_renders || {},
        render_count: result.render_count,
        unique_element_count: result.unique_element_count,
      });
      currentState.setCurrentSavedConfigId(result.config.id);
      loadConfigs();

      toast.success(
        `Saved ${result.states.length} states to "${result.config.name}"`
      );
    } catch (error) {
      logger.error("Save error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save states"
      );
    } finally {
      stateRef.current.setIsSaving(false);
    }
  }, [projectId, loadConfigs]);

  // Update state description
  const updateStateDescription = useCallback(
    async (stateId: string, description: string) => {
      stateRef.current.setStateDescriptions((prev) => ({
        ...prev,
        [stateId]: description,
      }));

      const { currentSavedConfigId, stateUuidMap } = stateRef.current;
      if (currentSavedConfigId && projectId && stateUuidMap[stateId]) {
        try {
          await httpClient.fetch(
            `${API}/projects/${projectId}/ui-bridge-configs/${currentSavedConfigId}/states/${stateUuidMap[stateId]}`,
            {
              method: "PATCH",
              body: JSON.stringify({ description }),
            }
          );
        } catch (error) {
          logger.error("Failed to save description:", error);
        }
      }
    },
    [projectId]
  );

  return {
    loadConfigs,
    loadSavedConfig,
    runDiscovery,
    saveDiscoveredStates,
    updateStateDescription,
  };
}
