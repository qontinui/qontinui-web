"use client";

import { useState } from "react";
import { Globe, Monitor, Loader2, Search, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type { DiscoveredApp } from "@/lib/runner/types/exploration";

interface AppSelectorProps {
  referenceApp: DiscoveredApp | null;
  targetApp: DiscoveredApp | null;
  onSetReference: (app: DiscoveredApp) => void;
  onSetTarget: (app: DiscoveredApp) => void;
}

export function AppSelector({
  referenceApp,
  targetApp,
  onSetReference,
  onSetTarget,
}: AppSelectorProps) {
  const [scanning, setScanning] = useState(false);
  const [apps, setApps] = useState<DiscoveredApp[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const [webRes, desktopRes] = await Promise.allSettled([
        runnerApi.uiBridgeScanWeb(),
        runnerApi.uiBridgeScanDesktop(),
      ]);

      const discovered: DiscoveredApp[] = [];
      if (webRes.status === "fulfilled" && Array.isArray(webRes.value.apps)) {
        discovered.push(...(webRes.value.apps as DiscoveredApp[]));
      }
      if (
        desktopRes.status === "fulfilled" &&
        Array.isArray(desktopRes.value.apps)
      ) {
        discovered.push(...(desktopRes.value.apps as DiscoveredApp[]));
      }

      if (discovered.length === 0) {
        setError(
          "No apps discovered. Ensure UI Bridge SDK is integrated in your apps.",
        );
      }
      setApps(discovered);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const webApps = apps.filter((a) => a.appType === "web");
  const desktopApps = apps.filter((a) => a.appType === "desktop");

  const isReference = (app: DiscoveredApp) => referenceApp?.appId === app.appId;
  const isTarget = (app: DiscoveredApp) => targetApp?.appId === app.appId;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Scan Button */}
      <div className="text-center">
        <Button
          onClick={handleScan}
          disabled={scanning}
          className="bg-cyan-600 hover:bg-cyan-700 text-white"
        >
          {scanning ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Scanning...
            </>
          ) : (
            <>
              <Search className="size-4 mr-2" />
              Scan for Apps
            </>
          )}
        </Button>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>

      {/* Web Apps */}
      {webApps.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="size-4 text-blue-400" />
            <h3 className="text-sm font-medium text-text-primary">Web Apps</h3>
            <Badge variant="secondary" className="text-[10px]">
              {webApps.length}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {webApps.map((app) => (
              <AppCard
                key={app.appId}
                app={app}
                isReference={isReference(app)}
                isTarget={isTarget(app)}
                onSetReference={() => onSetReference(app)}
                onSetTarget={() => onSetTarget(app)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Desktop Apps */}
      {desktopApps.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Monitor className="size-4 text-purple-400" />
            <h3 className="text-sm font-medium text-text-primary">
              Desktop Apps
            </h3>
            <Badge variant="secondary" className="text-[10px]">
              {desktopApps.length}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {desktopApps.map((app) => (
              <AppCard
                key={app.appId}
                app={app}
                isReference={isReference(app)}
                isTarget={isTarget(app)}
                onSetReference={() => onSetReference(app)}
                onSetTarget={() => onSetTarget(app)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Selection Summary */}
      {(referenceApp || targetApp) && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
          <h4 className="text-xs font-medium text-text-muted mb-2">
            Selection
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wider">
                Reference
              </span>
              {referenceApp ? (
                <div className="flex items-center gap-2 mt-1">
                  <CheckCircle2 className="size-3 text-cyan-400" />
                  <span className="text-sm text-text-primary">
                    {referenceApp.appName}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-text-muted mt-1">Not selected</p>
              )}
            </div>
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wider">
                Target
              </span>
              {targetApp ? (
                <div className="flex items-center gap-2 mt-1">
                  <CheckCircle2 className="size-3 text-cyan-400" />
                  <span className="text-sm text-text-primary">
                    {targetApp.appName}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-text-muted mt-1">Not selected</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// App Card
// =============================================================================

function AppCard({
  app,
  isReference,
  isTarget,
  onSetReference,
  onSetTarget,
}: {
  app: DiscoveredApp;
  isReference: boolean;
  isTarget: boolean;
  onSetReference: () => void;
  onSetTarget: () => void;
}) {
  const icon =
    app.appType === "web" ? (
      <Globe className="size-4 text-blue-400" />
    ) : (
      <Monitor className="size-4 text-purple-400" />
    );

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        isReference
          ? "border-cyan-500/50 bg-cyan-500/5"
          : isTarget
            ? "border-emerald-500/50 bg-emerald-500/5"
            : "border-border-subtle"
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-text-primary flex-1 truncate">
          {app.appName}
        </span>
        {isReference && (
          <Badge className="text-[10px] bg-cyan-500/15 text-cyan-400 border-cyan-500/30">
            Ref
          </Badge>
        )}
        {isTarget && (
          <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
            Target
          </Badge>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap text-[10px]">
        <span className="text-text-muted font-mono">:{app.port}</span>
        {app.framework && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1 bg-surface-raised"
          >
            {app.framework}
          </Badge>
        )}
        {app.elementCount != null && (
          <span className="text-text-muted">{app.elementCount} elements</span>
        )}
      </div>

      {app.capabilities.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {app.capabilities.slice(0, 4).map((cap) => (
            <Badge
              key={cap}
              variant="secondary"
              className="text-[9px] px-1 bg-surface-raised/50"
            >
              {cap}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className={`h-6 text-[10px] flex-1 ${isReference ? "border-cyan-500/50 text-cyan-400" : ""}`}
          onClick={onSetReference}
        >
          {isReference ? "Reference" : "Set as Reference"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={`h-6 text-[10px] flex-1 ${isTarget ? "border-emerald-500/50 text-emerald-400" : ""}`}
          onClick={onSetTarget}
        >
          {isTarget ? "Target" : "Set as Target"}
        </Button>
      </div>
    </div>
  );
}
