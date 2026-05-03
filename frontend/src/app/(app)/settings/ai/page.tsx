"use client";

import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useAiSettings } from "./_hooks/useAiSettings";
import { ProviderSelector } from "./_components/ProviderSelector";
import { ClaudeCliSettings } from "./_components/ClaudeCliSettings";
import { ClaudeApiSettings } from "./_components/ClaudeApiSettings";
import { GeminiCliSettings } from "./_components/GeminiCliSettings";
import { GeminiApiSettings } from "./_components/GeminiApiSettings";
import { GeneralAiSettings } from "./_components/GeneralAiSettings";
import { TestConnection } from "./_components/TestConnection";
import { ProviderHealthStatus } from "./_components/ProviderHealthStatus";

export default function AiSettingsPage() {
  const discoveredSpec = useDiscoveredSpec("ai-settings");
  usePageSpecs(
    discoveredSpec
      ? { "ai-settings": discoveredSpec.config as SpecConfig }
      : {}
  );

  const {
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
  } = useAiSettings();

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">AI Providers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your AI provider for automation and analysis
        </p>
      </div>

      <ProviderHealthStatus />

      <ProviderSelector provider={provider} onProviderChange={setProvider} />

      {provider === "claude_cli" && (
        <ClaudeCliSettings config={claudeCli} onChange={setClaudeCli} />
      )}

      {provider === "claude_api" && (
        <ClaudeApiSettings
          config={claudeApi}
          onChange={setClaudeApi}
          apiKeyConfigured={claudeApiKeyConfigured}
          setApiKeyConfigured={setClaudeApiKeyConfigured}
          apiKeyInput={claudeApiKeyInput}
          setApiKeyInput={setClaudeApiKeyInput}
          onSaveApiKey={handleSaveApiKey}
          onDeleteApiKey={handleDeleteApiKey}
        />
      )}

      {provider === "gemini_cli" && (
        <GeminiCliSettings config={geminiCli} onChange={setGeminiCli} />
      )}

      {provider === "gemini_api" && (
        <GeminiApiSettings
          config={geminiApi}
          onChange={setGeminiApi}
          apiKeyConfigured={geminiApiKeyConfigured}
          setApiKeyConfigured={setGeminiApiKeyConfigured}
          apiKeyInput={geminiApiKeyInput}
          setApiKeyInput={setGeminiApiKeyInput}
          onSaveApiKey={handleSaveApiKey}
          onDeleteApiKey={handleDeleteApiKey}
        />
      )}

      <GeneralAiSettings
        autoRefineVideoIterations={autoRefineVideoIterations}
        onAutoRefineVideoIterationsChange={setAutoRefineVideoIterations}
        interactiveSessionsEnabled={interactiveSessionsEnabled}
        onInteractiveSessionsEnabledChange={setInteractiveSessionsEnabled}
      />

      <TestConnection testing={testing} onTest={handleTestConnection} />

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
