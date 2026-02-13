"use client";

import { useState, useEffect, useCallback } from "react";
import { useRunnerHealth, runnerApi } from "@/lib/runner-api";
import type { SelfHealingSettings } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Database,
  Eye,
  Bot,
  Server,
  Cloud,
  ChevronDown,
  ChevronRight,
  Loader2,
  Info,
  Trash2,
  CheckCircle,
  KeyRound,
  RotateCcw,
} from "lucide-react";

type LlmMode = SelfHealingSettings["llm_mode"];
type ApiProvider = SelfHealingSettings["api_provider"];

export default function SelfHealingSettingsPage() {
  const { isLoading: healthLoading, isOffline } = useRunnerHealth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Section collapse state
  const [cachingOpen, setCachingOpen] = useState(true);
  const [validationOpen, setValidationOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);

  // Settings
  const [actionCachingEnabled, setActionCachingEnabled] = useState(true);
  const [cacheTtlSeconds, setCacheTtlSeconds] = useState(300);
  const [visualValidationEnabled, setVisualValidationEnabled] = useState(true);
  const [llmMode, setLlmMode] = useState<LlmMode>("disabled");
  const [ollamaModel, setOllamaModel] = useState("llava");
  const [apiProvider, setApiProvider] = useState<ApiProvider>("open_ai");

  // API key state
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const settings = await runnerApi.getSelfHealingSettings();
      setActionCachingEnabled(settings.action_caching_enabled);
      setCacheTtlSeconds(settings.cache_ttl_seconds);
      setVisualValidationEnabled(settings.visual_validation_enabled);
      setLlmMode(settings.llm_mode);
      setOllamaModel(settings.ollama_model);
      setApiProvider(settings.api_provider);

      // Check API key status
      if (settings.llm_mode === "remote_api") {
        try {
          const result = await runnerApi.hasSelfHealingApiKey(
            settings.api_provider
          );
          setApiKeyConfigured(result.has_key);
        } catch {
          setApiKeyConfigured(false);
        }
      }
    } catch {
      toast.error("Failed to load self-healing settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOffline) {
      loadSettings();
    }
  }, [isOffline, loadSettings]);

  // Re-check API key when provider changes
  const checkApiKey = useCallback(async (provider: ApiProvider) => {
    try {
      const result = await runnerApi.hasSelfHealingApiKey(provider);
      setApiKeyConfigured(result.has_key);
    } catch {
      setApiKeyConfigured(false);
    }
  }, []);

  const handleProviderChange = (newProvider: ApiProvider) => {
    setApiProvider(newProvider);
    setApiKeyConfigured(false);
    setApiKeyInput("");
    checkApiKey(newProvider);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const settings: SelfHealingSettings = {
        action_caching_enabled: actionCachingEnabled,
        cache_ttl_seconds: cacheTtlSeconds,
        visual_validation_enabled: visualValidationEnabled,
        llm_mode: llmMode,
        ollama_model: ollamaModel,
        api_provider: apiProvider,
      };
      await runnerApi.saveSelfHealingSettings(settings);
      toast.success("Self-healing settings saved");
    } catch {
      toast.error("Failed to save self-healing settings");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) {
      toast.error("Please enter an API key");
      return;
    }
    try {
      await runnerApi.saveSelfHealingApiKey(apiProvider, apiKeyInput.trim());
      setApiKeyConfigured(true);
      setApiKeyInput("");
      toast.success("API key saved securely");
    } catch {
      toast.error("Failed to save API key");
    }
  };

  const handleDeleteApiKey = async () => {
    try {
      await runnerApi.deleteSelfHealingApiKey(apiProvider);
      setApiKeyConfigured(false);
      toast.success("API key deleted");
    } catch {
      toast.error("Failed to delete API key");
    }
  };

  const handleResetDefaults = () => {
    setActionCachingEnabled(true);
    setCacheTtlSeconds(300);
    setVisualValidationEnabled(true);
    setLlmMode("disabled");
    setOllamaModel("llava");
    setApiProvider("open_ai");
    toast.info("Settings reset to defaults (not saved yet)");
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

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">
          Self-Healing
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Configure automation recovery, caching, and visual validation
        </p>
      </div>

      {/* Action Caching */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setCachingOpen(!cachingOpen)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {cachingOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <Database className="size-4" />
              Action Caching
            </CardTitle>
            <Switch
              checked={actionCachingEnabled}
              onCheckedChange={setActionCachingEnabled}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </CardHeader>
        {cachingOpen && (
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
              <Info className="size-4 mt-0.5 text-blue-500 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Action caching stores the results of recently executed actions
                so they can be reused without re-executing, improving
                performance for repeated operations.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Cache TTL (seconds)</Label>
              <Input
                type="number"
                min={30}
                max={3600}
                step={30}
                value={cacheTtlSeconds}
                onChange={(e) => setCacheTtlSeconds(Number(e.target.value))}
                disabled={!actionCachingEnabled}
              />
              <p className="text-xs text-muted-foreground">
                How long cached action results remain valid
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Visual Validation */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setValidationOpen(!validationOpen)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {validationOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <Eye className="size-4" />
              Visual Validation
            </CardTitle>
            <Switch
              checked={visualValidationEnabled}
              onCheckedChange={setVisualValidationEnabled}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </CardHeader>
        {validationOpen && (
          <CardContent>
            <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
              <Info className="size-4 mt-0.5 text-blue-500 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Visual validation captures screenshots after actions to verify
                the expected state was reached. When validation fails, the
                self-healing system can attempt corrective actions
                automatically.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* LLM Assistance */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setLlmOpen(!llmOpen)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {llmOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              <Bot className="size-4" />
              LLM Assistance
            </CardTitle>
          </div>
        </CardHeader>
        {llmOpen && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>LLM Mode</Label>
              <Select
                value={llmMode}
                onValueChange={(v) => setLlmMode(v as LlmMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">
                    <span className="flex items-center gap-2">Disabled</span>
                  </SelectItem>
                  <SelectItem value="local_ollama">
                    <span className="flex items-center gap-2">
                      <Server className="size-3.5" />
                      Local Ollama
                    </span>
                  </SelectItem>
                  <SelectItem value="remote_api">
                    <span className="flex items-center gap-2">
                      <Cloud className="size-3.5" />
                      Remote API
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Ollama Configuration */}
            {llmMode === "local_ollama" && (
              <div className="space-y-2 rounded-lg border p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Server className="size-4 text-muted-foreground" />
                  <span
                    data-content-role="heading"
                    data-content-label="ollama config section"
                    className="text-sm font-medium"
                  >
                    Ollama Configuration
                  </span>
                </div>
                <div className="space-y-2">
                  <Label>Model Name</Label>
                  <Input
                    placeholder="llava"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Remote API Configuration */}
            {llmMode === "remote_api" && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Cloud className="size-4 text-muted-foreground" />
                  <span
                    data-content-role="heading"
                    data-content-label="remote api config section"
                    className="text-sm font-medium"
                  >
                    Remote API Configuration
                  </span>
                </div>

                <div className="space-y-2">
                  <Label>API Provider</Label>
                  <Select
                    value={apiProvider}
                    onValueChange={(v) =>
                      handleProviderChange(v as ApiProvider)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open_ai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* API Key Management */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <KeyRound className="size-3.5" />
                    API Key
                  </Label>
                  {apiKeyConfigured ? (
                    <div className="flex items-center justify-between rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                      <div
                        data-content-role="status"
                        data-content-label="self-healing api key status"
                        className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
                      >
                        <CheckCircle className="size-4" />
                        API key configured securely
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDeleteApiKey}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder={
                          apiProvider === "open_ai" ? "sk-..." : "sk-ant-..."
                        }
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                      />
                      <Button variant="outline" onClick={handleSaveApiKey}>
                        Save Key
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Actions */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleResetDefaults}
          className="text-text-muted"
        >
          <RotateCcw className="size-4 mr-2" />
          Reset to Defaults
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
