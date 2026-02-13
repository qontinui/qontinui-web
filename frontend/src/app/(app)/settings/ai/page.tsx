"use client";

import { useState, useEffect, useCallback } from "react";
import { useRunnerHealth, runnerApi } from "@/lib/runner-api";
import type { AiSettings } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Bot,
  Terminal,
  Zap,
  Sparkles,
  Video,
  MessageSquare,
  Play,
  Loader2,
  Trash2,
  CheckCircle,
  KeyRound,
} from "lucide-react";

type AiProvider = AiSettings["provider"];

const CLAUDE_MODELS = [
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-opus", label: "Claude 3 Opus" },
];

const GEMINI_MODELS = [
  { value: "gemini-3-flash", label: "Gemini 3 Flash" },
  { value: "gemini-3-pro", label: "Gemini 3 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

const EXECUTION_MODES = [
  { value: "auto", label: "Auto-detect" },
  { value: "windows_native", label: "Windows Native" },
  { value: "wsl", label: "WSL" },
  { value: "native_unix", label: "Native Unix" },
];

export default function AiSettingsPage() {
  const { isLoading: healthLoading, isOffline } = useRunnerHealth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Provider
  const [provider, setProvider] = useState<AiProvider>("claude_cli");

  // Claude CLI
  const [claudeCli, setClaudeCli] = useState({
    execution_mode: "auto",
    custom_path: null as string | null,
    timeout_seconds: 600,
    config_dir: null as string | null,
  });

  // Claude API
  const [claudeApi, setClaudeApi] = useState({
    model: "claude-sonnet-4",
    max_tokens: 4096,
  });

  // Gemini CLI
  const [geminiCli, setGeminiCli] = useState({
    execution_mode: "auto",
    custom_path: null as string | null,
    timeout_seconds: 600,
    auth_method: "oauth" as "oauth" | "api_key",
    model: "gemini-3-flash",
  });

  // Gemini API
  const [geminiApi, setGeminiApi] = useState({
    model: "gemini-3-flash",
    max_output_tokens: 8192,
    temperature: 0.7,
  });

  // Auto-refine & session mode
  const [autoRefineVideoIterations, setAutoRefineVideoIterations] = useState(3);
  const [interactiveSessionsEnabled, setInteractiveSessionsEnabled] =
    useState(true);

  // API key states
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

      // Check API key status for each provider
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

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-text-muted" />
      </div>
    );
  }

  const providerOptions: {
    value: AiProvider;
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "claude_cli",
      label: "Claude Code CLI",
      description: "Uses your Claude Code subscription",
      icon: <Terminal className="size-5" />,
    },
    {
      value: "claude_api",
      label: "Claude API",
      description: "Direct API access with per-token billing",
      icon: <Bot className="size-5" />,
    },
    {
      value: "gemini_cli",
      label: "Gemini CLI",
      description: "Google's Gemini CLI with OAuth or API key",
      icon: <Sparkles className="size-5" />,
    },
    {
      value: "gemini_api",
      label: "Gemini API",
      description: "Direct Gemini API access with per-token billing",
      icon: <Zap className="size-5" />,
    },
  ];

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">
          AI Providers
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Configure your AI provider for automation and analysis
        </p>
      </div>

      {/* Provider Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4" />
            Provider Selection
          </CardTitle>
          <CardDescription>
            Choose which AI provider to use for automation tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {providerOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setProvider(opt.value)}
                className={`relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  provider === opt.value
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-border/80 hover:bg-accent/50"
                }`}
              >
                <div
                  className={`mt-0.5 ${provider === opt.value ? "text-primary" : "text-muted-foreground"}`}
                >
                  {opt.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {opt.label}
                    {opt.value === "claude_cli" && (
                      <span
                        data-content-role="badge"
                        data-content-label="recommended provider"
                        className="ml-1.5 text-xs text-primary font-normal"
                      >
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {opt.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Claude CLI Settings */}
      {provider === "claude_cli" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4" />
              Claude CLI Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Execution Mode</Label>
              <Select
                value={claudeCli.execution_mode}
                onValueChange={(v) =>
                  setClaudeCli({ ...claudeCli, execution_mode: v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXECUTION_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Custom Executable Path</Label>
              <Input
                placeholder="Leave empty for default"
                value={claudeCli.custom_path ?? ""}
                onChange={(e) =>
                  setClaudeCli({
                    ...claudeCli,
                    custom_path: e.target.value || null,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Config Directory</Label>
              <Input
                placeholder="Leave empty for default"
                value={claudeCli.config_dir ?? ""}
                onChange={(e) =>
                  setClaudeCli({
                    ...claudeCli,
                    config_dir: e.target.value || null,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Timeout (seconds)</Label>
              <Input
                type="number"
                min={60}
                max={3600}
                value={claudeCli.timeout_seconds}
                onChange={(e) =>
                  setClaudeCli({
                    ...claudeCli,
                    timeout_seconds: Number(e.target.value),
                  })
                }
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Claude API Settings */}
      {provider === "claude_api" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" />
              Claude API Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* API Key Management */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <KeyRound className="size-3.5" />
                API Key
              </Label>
              {claudeApiKeyConfigured ? (
                <div className="flex items-center justify-between rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                  <div
                    data-content-role="status"
                    data-content-label="claude api key status"
                    className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
                  >
                    <CheckCircle className="size-4" />
                    API key configured securely
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleDeleteApiKey(
                        "claude_api",
                        setClaudeApiKeyConfigured
                      )
                    }
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="sk-ant-..."
                    value={claudeApiKeyInput}
                    onChange={(e) => setClaudeApiKeyInput(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleSaveApiKey(
                        "claude_api",
                        claudeApiKeyInput,
                        setClaudeApiKeyConfigured,
                        setClaudeApiKeyInput
                      )
                    }
                  >
                    Save Key
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Select
                value={claudeApi.model}
                onValueChange={(v) => setClaudeApi({ ...claudeApi, model: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLAUDE_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Max Tokens</Label>
              <Input
                type="number"
                min={256}
                max={32768}
                value={claudeApi.max_tokens}
                onChange={(e) =>
                  setClaudeApi({
                    ...claudeApi,
                    max_tokens: Number(e.target.value),
                  })
                }
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Gemini CLI Settings */}
      {provider === "gemini_cli" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Gemini CLI Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Auth Method</Label>
              <div className="flex gap-3">
                {(["oauth", "api_key"] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() =>
                      setGeminiCli({ ...geminiCli, auth_method: method })
                    }
                    className={`flex-1 rounded-lg border p-2.5 text-sm text-center transition-colors ${
                      geminiCli.auth_method === method
                        ? "border-primary bg-primary/5 ring-1 ring-primary font-medium"
                        : "border-border hover:border-border/80 hover:bg-accent/50"
                    }`}
                  >
                    {method === "oauth" ? "OAuth" : "API Key"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Select
                value={geminiCli.model}
                onValueChange={(v) => setGeminiCli({ ...geminiCli, model: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEMINI_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Execution Mode</Label>
              <Select
                value={geminiCli.execution_mode}
                onValueChange={(v) =>
                  setGeminiCli({ ...geminiCli, execution_mode: v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXECUTION_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Timeout (seconds)</Label>
              <Input
                type="number"
                min={60}
                max={3600}
                value={geminiCli.timeout_seconds}
                onChange={(e) =>
                  setGeminiCli({
                    ...geminiCli,
                    timeout_seconds: Number(e.target.value),
                  })
                }
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Gemini API Settings */}
      {provider === "gemini_api" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4" />
              Gemini API Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* API Key Management */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <KeyRound className="size-3.5" />
                API Key
              </Label>
              {geminiApiKeyConfigured ? (
                <div className="flex items-center justify-between rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                  <div
                    data-content-role="status"
                    data-content-label="gemini api key status"
                    className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
                  >
                    <CheckCircle className="size-4" />
                    API key configured securely
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleDeleteApiKey(
                        "gemini_api",
                        setGeminiApiKeyConfigured
                      )
                    }
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="AIza..."
                    value={geminiApiKeyInput}
                    onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleSaveApiKey(
                        "gemini_api",
                        geminiApiKeyInput,
                        setGeminiApiKeyConfigured,
                        setGeminiApiKeyInput
                      )
                    }
                  >
                    Save Key
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Select
                value={geminiApi.model}
                onValueChange={(v) => setGeminiApi({ ...geminiApi, model: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEMINI_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Max Output Tokens</Label>
              <Input
                type="number"
                min={256}
                max={32768}
                value={geminiApi.max_output_tokens}
                onChange={(e) =>
                  setGeminiApi({
                    ...geminiApi,
                    max_output_tokens: Number(e.target.value),
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Temperature</Label>
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={geminiApi.temperature}
                onChange={(e) =>
                  setGeminiApi({
                    ...geminiApi,
                    temperature: Number(e.target.value),
                  })
                }
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto-Refine Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="size-4" />
            Auto-Refine Defaults
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label>Include Video After Iterations</Label>
            <Input
              type="number"
              min={0}
              max={20}
              value={autoRefineVideoIterations}
              onChange={(e) =>
                setAutoRefineVideoIterations(Number(e.target.value))
              }
            />
            <p className="text-xs text-muted-foreground">
              Number of iterations before including video context for
              auto-refinement. Set to 0 to always include video.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Session Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="size-4" />
            Session Mode
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label>Interactive Sessions</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable interactive mode for AI sessions
              </p>
            </div>
            <Switch
              checked={interactiveSessionsEnabled}
              onCheckedChange={setInteractiveSessionsEnabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Test Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="size-4" />
            Test Connection
          </CardTitle>
          <CardDescription>
            Verify your AI provider is properly configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {testing ? "Testing..." : "Test Connection"}
          </Button>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
