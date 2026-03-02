"use client";

import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw } from "lucide-react";
import { useAgenticSettings } from "./_hooks/useAgenticSettings";
import { CompressionSection } from "./_components/CompressionSection";
import { RetrySection } from "./_components/RetrySection";
import { RoutingSection } from "./_components/RoutingSection";

export default function AgenticSettingsPage() {
  const {
    healthLoading,
    isOffline,
    loading,
    saving,
    compression,
    setCompression,
    retry,
    setRetry,
    routing,
    setRouting,
    handleSave,
    handleResetDefaults,
  } = useAgenticSettings();

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
        <h1 className="text-lg font-semibold">Advanced AI (Agentic)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure memory compression, retry behavior, and intelligent task
          routing
        </p>
      </div>

      <CompressionSection value={compression} onChange={setCompression} />
      <RetrySection value={retry} onChange={setRetry} />
      <RoutingSection value={routing} onChange={setRouting} />

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleResetDefaults}
          className="text-muted-foreground"
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
