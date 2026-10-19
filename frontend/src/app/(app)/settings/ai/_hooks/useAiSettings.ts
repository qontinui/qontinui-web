import { useState, useEffect, useCallback, useRef } from "react";
import {
  useRunnerHealth,
  useRunnerApi,
  runnerFailureMessage,
  type AiSettings,
  type AiSettingsView,
} from "@/lib/runner-api";
import { toast } from "sonner";
import type {
  AiProvider,
  ClaudeCliConfig,
  ClaudeApiConfig,
  GeminiCliConfig,
  GeminiApiConfig,
} from "../types";

/** The three roster keys a save sends only when the user edited them. */
const ROSTER_KEYS = [
  "config_dir",
  "account_selection_mode",
  "account_selection_pinned",
] as const;
type RosterKey = (typeof ROSTER_KEYS)[number];
type RosterBaseline = Partial<Record<RosterKey, unknown>>;

/**
 * Read-only keys the runner derives and serves beside the stored settings.
 * Each is tracked on its own: an absent key is UNKNOWN (older runner), and
 * `fleet === null` means "the fleet has no opinion" — different things.
 */
export interface DerivedAccountSelection {
  effective?: string;
  source?: "fleet" | "local" | "pinned";
  /** undefined = key absent (UNKNOWN); null = no fleet opinion. */
  fleet?: string | null;
}

function readDerived(view: AiSettingsView): DerivedAccountSelection {
  const d: DerivedAccountSelection = {};
  if (typeof view.effective_account_selection_mode === "string")
    d.effective = view.effective_account_selection_mode;
  if (
    view.account_selection_source === "fleet" ||
    view.account_selection_source === "local" ||
    view.account_selection_source === "pinned"
  )
    d.source = view.account_selection_source;
  if ("fleet_account_selection_mode" in view)
    d.fleet = view.fleet_account_selection_mode ?? null;
  return d;
}

function rosterOf(cli: Record<string, unknown>): RosterBaseline {
  const out: RosterBaseline = {};
  for (const k of ROSTER_KEYS) if (k in cli) out[k] = cli[k];
  return out;
}

export function useAiSettings() {
  const runnerApi = useRunnerApi();
  const { isLoading: healthLoading, isOffline } = useRunnerHealth();

  const [loading, setLoading] = useState(true);
  // True only after getAiSettings succeeded: a save from defaults would
  // overwrite the stored document with values the user never saw.
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [derived, setDerived] = useState<DerivedAccountSelection>({});
  const baselineRef = useRef<RosterBaseline>({});
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
      const view = await runnerApi.getAiSettings();
      // Derived keys live beside the stored document, never inside it.
      const settings: AiSettings = view;
      setDerived(readDerived(view));
      baselineRef.current = rosterOf(settings.claude_cli);
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
      setLoaded(true);
      setLoadError(null);
    } catch (err) {
      const msg = runnerFailureMessage(err, "Failed to load AI settings");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [runnerApi]);

  useEffect(() => {
    if (!isOffline) {
      loadSettings();
    }
  }, [isOffline, loadSettings]);

  const handleSave = async () => {
    if (!loaded) return;
    try {
      setSaving(true);
      // Roster keys are sent only when edited: an absent key keeps the stored
      // value, while an explicit null CLEARS it, so an unedited key is deleted
      // from the body rather than sent as undefined/null.
      const cli: Record<string, unknown> = { ...claudeCli };
      const baseline = baselineRef.current;
      for (const k of ROSTER_KEYS) {
        if (!(k in cli) || cli[k] === baseline[k]) delete cli[k];
      }
      const settings: AiSettings = {
        provider,
        claude_cli: cli as AiSettings["claude_cli"],
        claude_api: claudeApi,
        gemini_cli: geminiCli,
        gemini_api: geminiApi,
        auto_refine_video_after_iterations: autoRefineVideoIterations,
        interactive_sessions_enabled: interactiveSessionsEnabled,
      };
      await runnerApi.saveAiSettings(settings);
      baselineRef.current = rosterOf(claudeCli);
      toast.success("AI settings saved");
      // Refresh only the derived read-out (the effective mode may have moved);
      // the form is left alone. Best effort: a failure keeps the old read-out.
      try {
        setDerived(readDerived(await runnerApi.getAiSettings()));
      } catch {
        /* keep the previous derived values */
      }
    } catch (err) {
      toast.error(runnerFailureMessage(err, "Failed to save AI settings"));
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
    } catch (err) {
      toast.error(runnerFailureMessage(err, "Failed to test AI connection"));
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
    } catch (err) {
      toast.error(runnerFailureMessage(err, "Failed to save API key"));
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
    } catch (err) {
      toast.error(runnerFailureMessage(err, "Failed to delete API key"));
    }
  };

  return {
    healthLoading,
    isOffline,
    loading,
    loaded,
    loadError,
    retryLoad: loadSettings,
    derived,
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
