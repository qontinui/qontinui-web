import { useState } from "react";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type { ExplorationForm, ExplorationStrategy } from "../types";

export function useExploration(form: ExplorationForm) {
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  const handleExecute = async () => {
    setExecuting(true);
    setExecResult(null);
    setExecError(null);
    try {
      const res = await runnerApi.startExploration({
        config_path: "",
        strategy: form.strategy,
        max_states: form.max_states || undefined,
        max_duration_seconds: form.max_duration_seconds || undefined,
        target_state_ids: form.target_state_ids
          ? form.target_state_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        target_transition_ids: form.target_transition_ids
          ? form.target_transition_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        capture_screenshots: form.capture_screenshots,
        stop_on_first_failure: form.stop_on_first_failure,
      });
      setExecResult(`Exploration started: ${res.run_id}`);
    } catch (e) {
      setExecError(e instanceof Error ? e.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  };

  return { executing, execResult, execError, handleExecute };
}

export function useAiAdvisor(
  updateField: <K extends keyof ExplorationForm>(
    field: K,
    value: ExplorationForm[K]
  ) => void
) {
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await runnerApi.aiSuggestExplorationStrategy(prompt);
      setAiResult(res as Record<string, unknown>);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiAccept = () => {
    if (!aiResult) return;
    const data =
      (aiResult.data as Record<string, unknown>) || aiResult;
    if (typeof data.strategy === "string") {
      updateField("strategy", data.strategy as ExplorationStrategy);
    }
    if (typeof data.max_states === "number") {
      updateField("max_states", data.max_states);
    }
    if (typeof data.max_duration_seconds === "number") {
      updateField("max_duration_seconds", data.max_duration_seconds);
    }
    setAiResult(null);
  };

  return { aiGenerating, aiError, aiResult, handleAiGenerate, handleAiAccept };
}
