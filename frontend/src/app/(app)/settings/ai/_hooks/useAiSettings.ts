import { useState, useEffect, useCallback } from "react";
import { useRunnerHealth, runnerApi, type AiSettings } from "@/lib/runner-api";
import { toast } from "sonner";
import type {
  AiProvider,
  ClaudeCliConfig,
  ClaudeApiConfig,
  GeminiCliConfig,
  GeminiApiConfig,
} from "../types";

export function useAiSettings() {
  const { isLoading: healthLoading, isOffline } = useRunnerHealth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [provider, setProvider] = useState<AiProvider>("claude_cli");

  const [claudeCli, setClaudeCli] = useState<ClaudeCliConfig>({
    execution_mode: "auto",
    custom_path: null,
    timeout_seconds: 600,
    config_dir: null,
  });

  const [claudeApi, setClaudeApi] = useState<ClaudeApiConfig>({
    model: "claude-sonnet-4",
    max_tokens: 4096,
  });

  const [geminiCli, setGeminiCli] = useState<GeminiCliConfig>({
    execution_mode: "auto",
    custom_path: null,
    timeout_seconds: 600,
    auth_method: "oauth",
    model: "gemini-3-flash",
  });

  const [geminiApi, setGeminiApi] = useState<GeminiApiConfig>({
    model: "gemini-3-flash",
    max_output_tokens: 8192,
    temperature: 0.7,
  });

  const [autoRefineVideoIterations, setAutoRefineVideoIterations] = useState(3);
  const [interactiveSessionsEnabled, setInteractiveSessionsEnabled] =
    useState(true);

  const [claudeApiKeyConfigured, setClaudeApiKeyConfigured] = useState(false);
  const [claudeApiKeyInput, setClaudeApiKeyInput] = useState("");
  const [geminiApiKeyConfigured, setGeminiApiKeyConfigured] = useState(false);
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const settings = await runnerApi.getAiSettings();
      setProvider(settings.provider);
      setClaudeCli(settings.claude_cli);
      setClaudeApi(settings.claude_api);
      setGeminiCli(settings.gemini_cli);
      setGeminiApi(settings.gemini_api);
      setAutoRefineVideoIterations(settings.auto_refine_video_after_iterations);
      setInteractiveSessionsEnabled(settings.interactive_sessions_enabled);

      const [claudeKeyResult, geminiKeyResult] = await Promise.all([
        runnerApi.hasAiApiKey("claude_api").catch(() => ({ has_key: false })),
        runnerApi.hasAiApiKey("gemini_api").catch(() => ({ has_key: false })),
      ]);
      setClaudeApiKeyConfigured(claudeKeyResult.has_key);
      setGeminiApiKeyConfigured(geminiKeyResult.has_key);
    } catch {
      toast.error("Failed to load AI settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOffline) {
      loadSettings();
    }
  }, [isOffline, loadSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const settings: AiSettings = {
        provider,
        claude_cli: claudeCli,
        claude_api: claudeApi,
        gemini_cli: geminiCli,
        gemini_api: geminiApi,
        auto_refine_video_after_iterations: autoRefineVideoIterations,
        interactive_sessions_enabled: interactiveSessionsEnabled,
      };
      await runnerApi.saveAiSettings(settings);
      toast.success("AI settings saved");
    } catch {
      toast.error("Failed to save AI settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      const result = await runnerApi.testAiConnection();
      if (result.success) {
        toast.success(result.message || "Connection successful");
      } else {
        toast.error(result.message || "Connection failed");
      }
    } catch {
      toast.error("Failed to test AI connection");
    } finally {
      setTesting(false);
    }
  };

  const handleSaveApiKey = async (
    providerKey: string,
    key: string,
    setConfigured: (v: boolean) => void,
    setInput: (v: string) => void
  ) => {
    if (!key.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    try {
      await runnerApi.saveAiApiKey(providerKey, key.trim());
      setConfigured(true);
      setInput("");
      toast.success("API key saved securely");
    } catch {
      toast.error("Failed to save API key");
    }
  };

  const handleDeleteApiKey = async (
    providerKey: string,
    setConfigured: (v: boolean) => void
  ) => {
    try {
      await runnerApi.deleteAiApiKey(providerKey);
      setConfigured(false);
      toast.success("API key deleted");
    } catch {
      toast.error("Failed to delete API key");
    }
  };

  return {
    healthLoading,
    isOffline,
    loading,
    saving,
    testing,

    provider,
    setProvider,

    claudeCli,
    setClaudeCli,
    claudeApi,
    setClaudeApi,
    geminiCli,
    setGeminiCli,
    geminiApi,
    setGeminiApi,

    autoRefineVideoIterations,
    setAutoRefineVideoIterations,
    interactiveSessionsEnabled,
    setInteractiveSessionsEnabled,

    claudeApiKeyConfigured,
    setClaudeApiKeyConfigured,
    claudeApiKeyInput,
    setClaudeApiKeyInput,
    geminiApiKeyConfigured,
    setGeminiApiKeyConfigured,
    geminiApiKeyInput,
    setGeminiApiKeyInput,

    handleSave,
    handleTestConnection,
    handleSaveApiKey,
    handleDeleteApiKey,
  };
}
