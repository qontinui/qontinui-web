"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  useRunnerHealth,
  runnerApi,
  type GlobalLogSourceSettings,
  type LogSourceAiSelectionMode,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  FolderOpen,
  ExternalLink,
  FileText,
  Sparkles,
  Info,
} from "lucide-react";

// ============================================================================
// AI Mode Display
// ============================================================================

const AI_MODE_LABELS: Record<LogSourceAiSelectionMode, string> = {
  dynamic: "Dynamic",
  static: "Static",
  disabled: "Disabled",
};

const AI_MODE_DESCRIPTIONS: Record<LogSourceAiSelectionMode, string> = {
  dynamic:
    "AI automatically selects relevant log sources based on the task context",
  static: "A fixed profile of log sources is always used",
  disabled: "AI does not have access to any log sources",
};

const AI_MODE_COLORS: Record<LogSourceAiSelectionMode, string> = {
  dynamic: "text-green-400",
  static: "text-blue-400",
  disabled: "text-muted-foreground",
};

// ============================================================================
// Main Page
// ============================================================================

export default function LogSourcesSettingsPage() {
  const router = useRouter();
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<GlobalLogSourceSettings | null>(
    null
  );

  const loadSettings = useCallback(async () => {
    try {
      const data = await runnerApi.getGlobalLogSourceSettings();
      setSettings(data);
    } catch {
      toast.error("Failed to load log source settings");
    }
  }, []);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      await loadSettings();
      setLoading(false);
    })();
  }, [isOffline, loadSettings]);

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  const aiMode = settings?.ai_selection_mode ?? "dynamic";
  const sourceCount = settings?.sources?.length ?? 0;
  const profileCount = settings?.profiles?.length ?? 0;
  const enabledCount = settings?.sources?.filter((s) => s.enabled).length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FolderOpen className="size-5" />
          Log Sources
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Global log source configuration for AI analysis
        </p>
      </div>

      {/* Info Note */}
      <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
        <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Full log source configuration, including adding, editing, and removing
          sources, is managed from the Configure section. This page shows a
          summary of the current configuration.
        </p>
      </div>

      {/* Current Configuration Summary */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="size-4" />
            AI Selection Mode
          </h3>
          <p className="text-xs text-muted-foreground">
            How the AI selects log sources during task execution
          </p>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className={`text-xs ${AI_MODE_COLORS[aiMode]}`}
            >
              {AI_MODE_LABELS[aiMode]}
            </Badge>
            <span
              data-content-role="description"
              data-content-label="ai mode description"
              className="text-xs text-muted-foreground"
            >
              {AI_MODE_DESCRIPTIONS[aiMode]}
            </span>
          </div>
        </div>
      </div>

      {/* Source Stats */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <FileText className="size-4" />
            Source Overview
          </h3>
          <p className="text-xs text-muted-foreground">
            Summary of configured log sources
          </p>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-background border border-border">
              <span
                data-content-role="metric"
                data-content-label="total sources count"
                className="text-2xl font-semibold text-foreground"
              >
                {sourceCount}
              </span>
              <span
                data-content-role="label"
                data-content-label="total sources label"
                className="text-xs text-muted-foreground"
              >
                Total Sources
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-background border border-border">
              <span
                data-content-role="metric"
                data-content-label="enabled sources count"
                className="text-2xl font-semibold text-green-400"
              >
                {enabledCount}
              </span>
              <span
                data-content-role="label"
                data-content-label="enabled label"
                className="text-xs text-muted-foreground"
              >
                Enabled
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-background border border-border">
              <span
                data-content-role="metric"
                data-content-label="profiles count"
                className="text-2xl font-semibold text-foreground"
              >
                {profileCount}
              </span>
              <span
                data-content-role="label"
                data-content-label="profiles label"
                className="text-xs text-muted-foreground"
              >
                Profiles
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigate to full configuration */}
      <Button
        variant="brand-primary"
        size="sm"
        onClick={() => router.push("/configure/log-sources")}
      >
        <ExternalLink className="size-4" />
        Go to Log Sources Configuration
      </Button>
    </div>
  );
}
