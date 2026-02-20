"use client";

import { useState } from "react";
import { Camera, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type {
  DiscoveredApp,
  ComparisonResult,
} from "@/lib/runner/types/exploration";
import type { ComparisonConfigState } from "./AppComparisonWizard";

interface SnapshotPreviewProps {
  referenceApp: DiscoveredApp;
  targetApp: DiscoveredApp;
  config: ComparisonConfigState;
  refSnapshot: Record<string, unknown> | null;
  targetSnapshot: Record<string, unknown> | null;
  onRefSnapshot: (snap: Record<string, unknown>) => void;
  onTargetSnapshot: (snap: Record<string, unknown>) => void;
  onResults: (results: ComparisonResult) => void;
}

export function SnapshotPreview({
  referenceApp,
  targetApp,
  config,
  refSnapshot,
  targetSnapshot,
  onRefSnapshot,
  onTargetSnapshot,
  onResults,
}: SnapshotPreviewProps) {
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const handleTakeSnapshots = async () => {
    setSnapshotting(true);
    setSnapError(null);
    try {
      // Connect to reference app, navigate, snapshot
      await runnerApi.uiBridgeConnect({
        url: referenceApp.url,
        port: referenceApp.port,
      });
      if (config.refRoute) {
        await runnerApi.uiBridgeSwitch(referenceApp.url + config.refRoute);
      }
      const refSnap = await runnerApi.uiBridgeSnapshot();
      onRefSnapshot(refSnap);

      // Connect to target app, navigate, snapshot
      await runnerApi.uiBridgeConnect({
        url: targetApp.url,
        port: targetApp.port,
      });
      if (config.targetRoute) {
        await runnerApi.uiBridgeSwitch(targetApp.url + config.targetRoute);
      }
      const targetSnap = await runnerApi.uiBridgeSnapshot();
      onTargetSnapshot(targetSnap);
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : "Snapshot failed");
    } finally {
      setSnapshotting(false);
    }
  };

  const handleCompare = async () => {
    if (!refSnapshot || !targetSnapshot) return;
    setComparing(true);
    setCompareError(null);
    try {
      const res = await runnerApi.aiCompareSnapshots({
        reference_snapshot: refSnapshot,
        target_snapshot: targetSnapshot,
        comparison_mode: config.mode,
        user_prompt: config.description || undefined,
      });
      onResults(res as unknown as ComparisonResult);
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setComparing(false);
    }
  };

  const getSnapshotStats = (snap: Record<string, unknown> | null) => {
    if (!snap) return null;
    return {
      elementCount:
        typeof snap.elementCount === "number" ? snap.elementCount : 0,
      componentCount:
        typeof snap.componentCount === "number" ? snap.componentCount : 0,
      interactiveCount:
        typeof snap.interactiveCount === "number" ? snap.interactiveCount : 0,
    };
  };

  const refStats = getSnapshotStats(refSnapshot);
  const targetStats = getSnapshotStats(targetSnapshot);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Take Snapshots */}
      <div className="text-center">
        <Button
          onClick={handleTakeSnapshots}
          disabled={snapshotting}
          className="bg-cyan-600 hover:bg-cyan-700 text-white"
        >
          {snapshotting ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Taking Snapshots...
            </>
          ) : (
            <>
              <Camera className="size-4 mr-2" />
              Take Snapshots
            </>
          )}
        </Button>
        {snapError && <p className="text-xs text-red-400 mt-2">{snapError}</p>}
      </div>

      {/* Side-by-Side Preview */}
      {refSnapshot && targetSnapshot && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <SnapshotCard
              label="Reference"
              appName={referenceApp.appName}
              snapshot={refSnapshot}
              stats={refStats}
              accentColor="cyan"
            />
            <SnapshotCard
              label="Target"
              appName={targetApp.appName}
              snapshot={targetSnapshot}
              stats={targetStats}
              accentColor="emerald"
            />
          </div>

          {/* Quick Diff Bar */}
          {refStats && targetStats && (
            <div className="flex gap-4 justify-center text-xs">
              <div className="flex items-center gap-1.5">
                <div className="size-2 rounded-full bg-cyan-400" />
                <span className="text-text-muted">
                  Only in Reference:{" "}
                  <span className="text-text-primary">
                    {Math.max(
                      0,
                      refStats.elementCount - targetStats.elementCount,
                    )}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="size-2 rounded-full bg-emerald-400" />
                <span className="text-text-muted">
                  Only in Target:{" "}
                  <span className="text-text-primary">
                    {Math.max(
                      0,
                      targetStats.elementCount - refStats.elementCount,
                    )}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="size-2 rounded-full bg-gray-400" />
                <span className="text-text-muted">
                  In Both:{" "}
                  <span className="text-text-primary">
                    {Math.min(refStats.elementCount, targetStats.elementCount)}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Compare Button */}
          <div className="text-center">
            <Button
              onClick={handleCompare}
              disabled={comparing}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {comparing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Comparing with AI...
                </>
              ) : (
                <>
                  <Sparkles className="size-4 mr-2" />
                  Compare with AI
                </>
              )}
            </Button>
            {compareError && (
              <p className="text-xs text-red-400 mt-2">{compareError}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// Snapshot Card
// =============================================================================

function SnapshotCard({
  label,
  appName,
  stats,
  accentColor,
}: {
  label: string;
  appName: string;
  snapshot: Record<string, unknown>;
  stats: {
    elementCount: number;
    componentCount: number;
    interactiveCount: number;
  } | null;
  accentColor: "cyan" | "emerald";
}) {
  const borderColor =
    accentColor === "cyan" ? "border-cyan-500/30" : "border-emerald-500/30";
  const bgColor = accentColor === "cyan" ? "bg-cyan-500/5" : "bg-emerald-500/5";
  const textColor =
    accentColor === "cyan" ? "text-cyan-400" : "text-emerald-400";

  return (
    <div
      className={`rounded-lg border ${borderColor} ${bgColor} p-4 space-y-3`}
    >
      <div>
        <span
          className={`text-[10px] uppercase tracking-wider font-medium ${textColor}`}
        >
          {label}
        </span>
        <p className="text-sm font-medium text-text-primary mt-0.5">
          {appName}
        </p>
      </div>
      {stats && (
        <div className="flex gap-3">
          <StatPill label="Elements" value={stats.elementCount} />
          <StatPill label="Components" value={stats.componentCount} />
          <StatPill label="Interactive" value={stats.interactiveCount} />
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <Badge
        variant="secondary"
        className="text-[10px] px-1.5 bg-surface-raised/50"
      >
        {value}
      </Badge>
      <p className="text-[9px] text-text-muted mt-0.5">{label}</p>
    </div>
  );
}
