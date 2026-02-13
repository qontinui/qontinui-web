import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { ExtractionState } from "./useExtractionState";
import type { DiscoveredState, SavedState } from "../_types";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseDiscoveryConfig");

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
  // Load saved configs
  const loadConfigs = useCallback(async () => {
    if (!projectId) return;

    state.setIsLoadingConfigs(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/ui-bridge-configs`,
        { credentials: "include" }
      );

      if (response.ok) {
        const data = await response.json();
        state.setSavedConfigs(data.items || []);
      }
    } catch (error) {
      logger.error("Failed to load configs:", error);
    } finally {
      state.setIsLoadingConfigs(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
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

      state.setIsLoadingConfigs(true);
      try {
        const response = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}`,
          { credentials: "include" }
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

        state.setStateUuidMap(uuidMap);
        state.setDiscoveryResult({
          states,
          elements: [],
          element_to_renders: {},
          render_count: cfg.render_count,
          unique_element_count: cfg.element_count,
        });
        state.setStateDescriptions(descriptions);
        state.setSelectedStateId(states[0]?.id || null);
        state.setCurrentSavedConfigId(configId);
        state.setConfigName(cfg.name);

        toast.success(`Loaded config "${cfg.name}"`);
      } catch (error) {
        logger.error("Failed to load config:", error);
        toast.error("Failed to load config");
      } finally {
        state.setIsLoadingConfigs(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
    },
    [projectId]
  );

  // Run state discovery
  const runDiscovery = useCallback(async () => {
    if (!state.rendersToAnalyze || state.rendersToAnalyze.length === 0) {
      toast.error("No render logs to analyze");
      return;
    }

    state.setIsDiscovering(true);
    try {
      const response = await fetch(
        "/api/v1/state-discovery/ui-bridge/discover-states",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            renders: state.rendersToAnalyze,
            include_html_ids: false,
            strategy: state.discoveryStrategy,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "State discovery failed");
      }

      const result = await response.json();
      state.setDiscoveryResult(result);
      state.setSelectedStateId(result.states[0]?.id || null);
      state.setStateDescriptions({});
      state.setCurrentSavedConfigId(null);
      state.setStateUuidMap({});

      const strategyLabel =
        result.strategy_used === "fingerprint"
          ? " (fingerprint)"
          : result.strategy_used === "legacy"
            ? " (legacy)"
            : "";
      toast.success(
        `Discovered ${result.states.length} states from ${result.render_count} renders${strategyLabel}`
      );
    } catch (error) {
      logger.error("State discovery error:", error);
      toast.error(
        error instanceof Error ? error.message : "State discovery failed"
      );
    } finally {
      state.setIsDiscovering(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable, reads use current closure values
  }, [state.rendersToAnalyze, state.discoveryStrategy]);

  // Save discovered states
  const saveDiscoveredStates = useCallback(async () => {
    if (!projectId) {
      toast.error("Please select a project first");
      return;
    }

    if (!state.rendersToAnalyze || state.rendersToAnalyze.length === 0) {
      toast.error("No render logs to save");
      return;
    }

    state.setIsSaving(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/ui-bridge-discover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            config_name: state.configName,
            renders: state.rendersToAnalyze,
            include_html_ids: false,
            strategy: state.discoveryStrategy,
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

      state.setStateUuidMap(uuidMap);
      state.setDiscoveryResult({
        states,
        elements: state.discoveryResult?.elements || [],
        element_to_renders: state.discoveryResult?.element_to_renders || {},
        render_count: result.render_count,
        unique_element_count: result.unique_element_count,
      });
      state.setCurrentSavedConfigId(result.config.id);
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
      state.setIsSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
  }, [projectId, state.rendersToAnalyze, state.configName, state.discoveryStrategy, state.discoveryResult, loadConfigs]);

  // Update state description
  const updateStateDescription = useCallback(
    async (stateId: string, description: string) => {
      state.setStateDescriptions((prev) => ({
        ...prev,
        [stateId]: description,
      }));

      if (
        state.currentSavedConfigId &&
        projectId &&
        state.stateUuidMap[stateId]
      ) {
        try {
          await fetch(
            `/api/v1/projects/${projectId}/ui-bridge-configs/${state.currentSavedConfigId}/states/${state.stateUuidMap[stateId]}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ description }),
            }
          );
        } catch (error) {
          logger.error("Failed to save description:", error);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
    [state.currentSavedConfigId, state.stateUuidMap, projectId]
  );

  return {
    loadConfigs,
    loadSavedConfig,
    runDiscovery,
    saveDiscoveredStates,
    updateStateDescription,
  };
}
