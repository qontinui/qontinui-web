import { useState, useEffect, useCallback } from "react";
import { runnerRequest, useRunnerTarget } from "@/lib/runner";
import type { AvailableState, AvailableTransition } from "../types";

export function useConfigLoader() {
  const runnerTarget = useRunnerTarget();
  const [configPath, setConfigPath] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [availableStates, setAvailableStates] = useState<AvailableState[]>([]);
  const [availableTransitions, setAvailableTransitions] = useState<AvailableTransition[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);

  const loadConfigFile = useCallback(async (path: string) => {
    setLoadingConfig(true);
    setConfigError(null);
    try {
      const res = await runnerRequest(runnerTarget, "/configs/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(`Failed to parse: ${res.statusText}`);
      const result = await res.json();
      const data = result.data ?? result;
      setAvailableStates(data.states ?? []);
      setAvailableTransitions(data.transitions ?? []);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Failed to load config");
    } finally {
      setLoadingConfig(false);
    }
  }, [runnerTarget]);

  useEffect(() => {
    const checkRunnerConfig = async () => {
      try {
        const res = await runnerRequest(runnerTarget, "/status");
        if (res.ok) {
          const status = await res.json();
          const path = status.data?.config_path ?? status.config_path;
          if (path) {
            setConfigPath(path);
            await loadConfigFile(path);
          }
        }
      } catch {
        // Runner not reachable (or /status not carried by the relay): no
        // config to preload — the user can still enter a path.
      }
    };
    checkRunnerConfig();
  }, [runnerTarget, loadConfigFile]);

  return {
    configPath,
    setConfigPath,
    loadingConfig,
    availableStates,
    availableTransitions,
    configError,
    loadConfigFile,
  };
}
