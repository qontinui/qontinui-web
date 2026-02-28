"use client";

import { useState, useEffect } from "react";
import { useRunnerHealth } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Download,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Info,
} from "lucide-react";

export default function UpdatesSettingsPage() {
  const {
    isOffline,
    isLoading: healthLoading,
    data: health,
    refetch,
  } = useRunnerHealth();
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    if (health) {
      setLastChecked(new Date());
    }
  }, [health]);

  const handleCheckForUpdates = async () => {
    setChecking(true);
    try {
      await refetch();
      setLastChecked(new Date());
    } finally {
      // Small delay so the spinner is visible
      setTimeout(() => setChecking(false), 500);
    }
  };

  if (healthLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Download className="size-5" />
            Updates
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Runner version and update status
          </p>
        </div>
        <Button
          onClick={handleCheckForUpdates}
          disabled={checking}
          variant="brand-primary"
          size="sm"
        >
          {checking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Check for Updates
        </Button>
      </div>

      {/* Current Version */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Download className="size-4" />
            Current Runner Version
          </h3>
          <p className="text-xs text-muted-foreground">
            The version of the connected desktop runner
          </p>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span
              data-content-role="metric"
              data-content-label="runner version"
              className="text-2xl font-semibold text-foreground font-mono"
            >
              {health?.version ?? "Unknown"}
            </span>
          </div>

          {lastChecked && (
            <p className="text-xs text-muted-foreground">
              Last checked: {lastChecked.toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Update Status */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium">Update Status</h3>
          <p className="text-xs text-muted-foreground">
            Whether your runner is up to date
          </p>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-md bg-green-500/5 border border-green-500/10">
            <CheckCircle className="size-5 text-green-400 shrink-0" />
            <div>
              <p className="text-sm text-foreground font-medium">
                Runner is connected
              </p>
              <p className="text-xs text-muted-foreground">
                {health?.version
                  ? `Running version ${health.version}`
                  : "Version information unavailable"}
              </p>
            </div>
          </div>

          {health?.uptime_seconds != null && (
            <div
              data-content-role="metric"
              data-content-label="runner uptime"
              className="text-xs text-muted-foreground"
            >
              Runner uptime: {formatUptime(health.uptime_seconds)}
            </div>
          )}
        </div>
      </div>

      {/* Desktop Update Note */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <AlertCircle className="size-4" />
            Installing Updates
          </h3>
        </div>
        <div className="p-4">
          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
            <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Updates to the Qontinui Runner are installed from the desktop
              application itself. When a new version is available, you will see
              an update notification in the runner&apos;s title bar. Click it to
              download and install the latest version. The runner will restart
              automatically after the update is applied.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours < 24) return `${hours}h ${minutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}
