import { useCallback } from "react";
import { toast } from "sonner";
import type { ExtractionState } from "./useExtractionState";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseUITarsExtraction");

interface UseUITarsExtractionArgs {
  state: ExtractionState;
  uitarsConfig: {
    maxSteps: number;
    urls?: string[];
    applicationName?: string;
    goal: string;
    provider: string;
    modelSize: string;
    quantization: string;
    timeoutSeconds: number;
    saveScreenshots: boolean;
    huggingfaceEndpoint?: string;
    huggingfaceApiToken?: string;
    vllmServerUrl?: string;
  };
  configMethod: string;
  selectedMonitors: number[];
  getRunnerUrl: (runnerId: string | null) => string | null;
}

export function useUITarsExtraction({
  state,
  uitarsConfig,
  configMethod,
  selectedMonitors,
  getRunnerUrl,
}: UseUITarsExtractionArgs) {
  // Poll for UI-TARS extraction status
  const pollExtractionStatus = useCallback(async () => {
    const runnerUrl = getRunnerUrl(state.selectedRunnerId);
    if (!runnerUrl) return;

    try {
      const response = await fetch(`${runnerUrl}/uitars-extraction/status`);
      if (!response.ok) {
        logger.error("Failed to get extraction status:", response.statusText);
        return;
      }
      const data = await response.json();
      if (data.success && data.data) {
        const status = data.data;
        state.setUitarsProgress({
          status: status.status || "idle",
          currentStep: status.current_step || 0,
          maxSteps: status.max_steps || uitarsConfig.maxSteps,
          elapsedSeconds: status.elapsed_seconds || 0,
          lastThought: status.last_thought,
          lastAction: status.last_action,
          statesDiscovered: status.states_discovered || 0,
          transitionsDiscovered: status.transitions_discovered || 0,
          errorMessage: status.error_message,
        });

        if (
          status.status === "completed" ||
          status.status === "failed" ||
          status.status === "stopped"
        ) {
          state.setIsExtracting(false);
          if (state.pollingRef.current) {
            clearInterval(state.pollingRef.current);
            state.pollingRef.current = null;
          }
          if (status.status === "completed") {
            toast.success("Extraction completed successfully!");
          } else if (status.status === "failed") {
            toast.error(
              `Extraction failed: ${status.error_message || "Unknown error"}`
            );
          }
        }
      }
    } catch (error) {
      logger.error("Error polling extraction status:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
  }, [uitarsConfig.maxSteps, getRunnerUrl, state.selectedRunnerId]);

  // Start UI-TARS extraction
  const startUITarsExtraction = useCallback(async () => {
    const runnerUrl = getRunnerUrl(state.selectedRunnerId);
    if (!runnerUrl) {
      toast.error("Please select a connected runner");
      return;
    }

    state.setUitarsProgress({
      status: "starting",
      currentStep: 0,
      maxSteps: uitarsConfig.maxSteps,
      elapsedSeconds: 0,
      statesDiscovered: 0,
      transitionsDiscovered: 0,
    });

    const target =
      configMethod === "uitars-web"
        ? uitarsConfig.urls?.[0] || ""
        : uitarsConfig.applicationName || "";

    const requestBody = {
      target_type: configMethod === "uitars-web" ? "web" : "desktop",
      target,
      goal: uitarsConfig.goal,
      provider: uitarsConfig.provider,
      model_size: uitarsConfig.modelSize,
      quantization: uitarsConfig.quantization,
      max_steps: uitarsConfig.maxSteps,
      timeout_seconds: uitarsConfig.timeoutSeconds,
      save_screenshots: uitarsConfig.saveScreenshots,
      huggingface_endpoint: uitarsConfig.huggingfaceEndpoint,
      huggingface_api_token: uitarsConfig.huggingfaceApiToken,
      vllm_server_url: uitarsConfig.vllmServerUrl,
      monitor_index: selectedMonitors[0] || 0,
    };

    const response = await fetch(`${runnerUrl}/uitars-extraction/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.success) {
      toast.info(`Starting ${configMethod} extraction...`);
      state.setIsExtracting(true);
      state.setMainTab("results");
    } else {
      throw new Error(data.error || "Failed to start extraction");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
  }, [
    getRunnerUrl,
    state.selectedRunnerId,
    uitarsConfig,
    configMethod,
    selectedMonitors,
  ]);

  return {
    pollExtractionStatus,
    startUITarsExtraction,
  };
}
