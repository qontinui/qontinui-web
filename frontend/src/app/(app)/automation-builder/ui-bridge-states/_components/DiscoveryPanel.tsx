"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Compass,
  Camera,
  Loader2,
  CheckCircle2,
  Save,
  RotateCcw,
  Sparkles,
  Layers,
  Hash,
  Scan,
  Plug,
  Circle,
  Square,
  MonitorSmartphone,
} from "lucide-react";
import { ExplorationConfigPanel } from "@/components/ui-bridge/ExplorationConfigPanel";
import { useUIBridgeExploration } from "@/hooks/useUIBridgeExploration";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { useStateMachineDiscovery } from "../_hooks/useStateMachineDiscovery";
import { useSDKApps } from "../_hooks/useSDKApps";
import type { SDKApp } from "../_hooks/useSDKApps";

const LOCAL_RUNNER_URL = "http://localhost:9876";
const DIRECT_CONNECTION_ID = -1;

interface DiscoveryPanelProps {
  discovery: ReturnType<typeof useStateMachineDiscovery>;
  onConfigCreated: (configId: string) => void;
}

export function DiscoveryPanel({
  discovery,
  onConfigCreated,
}: DiscoveryPanelProps) {
  const [collectTab, setCollectTab] = useState<"explore" | "record">("explore");
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    number | null
  >(null);
  // Hooks
  const exploration = useUIBridgeExploration();
  const { connections, isLoading: connectionsLoading } =
    useRealtimeConnections();

  // Check if local runner is available directly (fallback when backend WS registration fails)
  const { data: localRunnerAvailable = false, isLoading: checkingLocalRunner } =
    useQuery({
      queryKey: ["local-runner-status"],
      queryFn: async () => {
        const res = await fetch(`${LOCAL_RUNNER_URL}/status`);
        return res.ok;
      },
      retry: false,
      staleTime: 30000,
    });

  // Auto-select local runner when no backend connections but local runner is available
  useEffect(() => {
    if (
      !connectionsLoading &&
      !checkingLocalRunner &&
      connections.length === 0 &&
      localRunnerAvailable &&
      selectedConnectionId === null
    ) {
      setSelectedConnectionId(DIRECT_CONNECTION_ID);
    }
  }, [
    connectionsLoading,
    checkingLocalRunner,
    connections.length,
    localRunnerAvailable,
    selectedConnectionId,
  ]);

  // Derive runner URL from selected connection
  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId]
  );

  const runnerUrl = useMemo(() => {
    if (selectedConnectionId === DIRECT_CONNECTION_ID) return LOCAL_RUNNER_URL;
    if (!selectedConnection) return null;
    const ip = selectedConnection.ip_address || "localhost";
    return `http://${ip}:9876`;
  }, [selectedConnectionId, selectedConnection]);

  // SDK app discovery and connection
  const sdk = useSDKApps(runnerUrl);
  const { refreshConnections: sdkRefreshConnections } = sdk;

  // Auto-refresh SDK connections and trigger scan when runner URL changes
  useEffect(() => {
    if (runnerUrl) {
      sdkRefreshConnections();
      // Auto-scan for apps when runner becomes available
      if (sdk.apps.length === 0 && !sdk.isScanning) {
        sdk.scanForApps();
      }
    }
    // Only trigger on runnerUrl change, not on sdk state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerUrl, sdkRefreshConnections]);

  // Auto-configure exploration when an SDK app is connected
  const { updateConfig: explorationUpdateConfig } = exploration;
  useEffect(() => {
    if (sdk.activeApp) {
      explorationUpdateConfig({
        targetType: "web",
        targetUrl: sdk.activeApp.url,
      });
    }
  }, [sdk.activeApp, explorationUpdateConfig]);

  // Auto-load completed exploration results from runner (survives page navigation)
  const { data: pendingExplorationResults } = useQuery({
    queryKey: ["exploration-pending-results", runnerUrl],
    queryFn: async () => {
      const statusRes = await fetch(`${runnerUrl}/ui-bridge/explore/status`);
      if (!statusRes.ok) return null;
      const statusData = await statusRes.json();
      const status = statusData.data || statusData;
      if (status.status !== "completed" || !status.has_results) return null;

      const resultsRes = await fetch(`${runnerUrl}/ui-bridge/explore/results`);
      if (!resultsRes.ok) return null;
      const resultsData = await resultsRes.json();
      const results = resultsData.data?.data || resultsData.data || resultsData;
      const renderLogs = results?.render_logs || [];
      if (renderLogs.length === 0) return null;

      return renderLogs.map(
        (
          log: {
            id?: string;
            type?: string;
            url?: string;
            timestamp?: string;
            snapshot?: Record<string, unknown>;
          },
          idx: number
        ) => ({
          id: log.id || `render_${idx}`,
          type: "dom_snapshot" as const,
          page_url: log.url || "",
          snapshot: log.snapshot || { root: {} },
          timestamp: log.timestamp
            ? new Date(log.timestamp).getTime()
            : Date.now(),
          trigger: idx === 0 ? "initial_load" : "action",
        })
      );
    },
    enabled: !!runnerUrl && !discovery.renders,
    retry: false,
    staleTime: 10000,
  });

  // Apply pending exploration results when they arrive
  useEffect(() => {
    if (pendingExplorationResults && !discovery.renders) {
      discovery.setRenders(pendingExplorationResults, "explore");
    }
  }, [pendingExplorationResults, discovery.renders, discovery.setRenders]);

  // Exploration handlers
  const handleStartExploration = useCallback(async () => {
    if (!runnerUrl) return;
    const results = await exploration.startUIBridgeExploration(runnerUrl);
    if (results && results.renderLogs.length > 0) {
      // Use returned results directly — React state hasn't committed yet
      const renderLogs = results.renderLogs.map((log) => ({
        id: log.id,
        type: "dom_snapshot" as const,
        page_url: log.url,
        snapshot: log.snapshot,
        timestamp: log.timestamp,
        trigger: log.trigger,
      }));
      discovery.setRenders(renderLogs, "explore");
    }
  }, [runnerUrl, exploration, discovery]);

  const handleStopExploration = useCallback(async () => {
    if (!runnerUrl) return;
    await exploration.stopExploration(runnerUrl);
    // After stop, state may have committed — try both approaches
    const renderLogs = exploration.getRenderLogsForDiscovery();
    if (renderLogs.length > 0) {
      discovery.setRenders(renderLogs, "explore");
    }
  }, [runnerUrl, exploration, discovery]);

  // Recording handlers (SDK-based)
  const handleStopRecording = useCallback(() => {
    sdk.stopRecording();
    const renderLogs = sdk.getSnapshotsAsRenderLogs();
    if (renderLogs.length > 0) {
      discovery.setRenders(renderLogs, "record");
    }
  }, [sdk, discovery]);

  const handleUseRecordedSnapshots = useCallback(() => {
    const renderLogs = sdk.getSnapshotsAsRenderLogs();
    if (renderLogs.length > 0) {
      discovery.setRenders(renderLogs, "record");
    }
  }, [sdk, discovery]);

  // Save handler
  const handleSave = useCallback(async () => {
    const configId = await discovery.saveToProject();
    if (configId) {
      onConfigCreated(configId);
    }
  }, [discovery, onConfigCreated]);

  // State checks
  const hasRenders = discovery.renders && discovery.renders.length > 0;
  const hasDiscoveryResult = discovery.discoveryResult !== null;
  const hasActiveSDKApp = sdk.activeApp !== null;

  return (
    <div className="p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Phase 1: Collect Renders */}
        {!hasRenders && (
          <>
            {/* Runner + SDK App Connection — compact when connected */}
            <Card>
              <CardContent className="py-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Plug className="size-4 text-text-muted" />
                  <span className="text-sm font-medium">
                    Connect to SDK App
                  </span>
                </div>

                {/* Compact row: Runner + SDK status */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Select
                      value={selectedConnectionId?.toString() ?? ""}
                      onValueChange={(v) =>
                        setSelectedConnectionId(v ? Number(v) : null)
                      }
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue
                          placeholder={
                            connectionsLoading && checkingLocalRunner
                              ? "Loading..."
                              : "Select a runner..."
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {localRunnerAvailable && (
                          <SelectItem value={DIRECT_CONNECTION_ID.toString()}>
                            <span className="flex items-center gap-1.5">
                              <MonitorSmartphone className="size-3.5 text-green-500" />
                              Local Runner (localhost:9876)
                            </span>
                          </SelectItem>
                        )}
                        {connections.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>
                            {c.runner_name} ({c.ip_address ?? "localhost"})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {runnerUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={sdk.scanForApps}
                      disabled={sdk.isScanning}
                    >
                      {sdk.isScanning ? (
                        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Scan className="size-3.5 mr-1.5" />
                      )}
                      Scan
                    </Button>
                  )}
                </div>

                {!connectionsLoading &&
                  !checkingLocalRunner &&
                  connections.length === 0 &&
                  !localRunnerAvailable && (
                    <p className="text-xs text-text-muted">
                      No runners detected. Start the qontinui-runner app to
                      connect.
                    </p>
                  )}

                {/* SDK app discovery results */}
                {runnerUrl && (
                  <>
                    {/* Active connection banner */}
                    {sdk.activeApp && (
                      <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded-md">
                        <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                        <span className="text-sm text-text-primary truncate">
                          Connected:{" "}
                          <strong>{sdk.activeApp.app.appName}</strong>
                        </span>
                        <Badge
                          variant="outline"
                          className="ml-auto text-xs shrink-0"
                        >
                          {sdk.activeApp.url}
                        </Badge>
                      </div>
                    )}

                    {/* Discovered apps list — hidden when already connected */}
                    {!sdk.activeApp && sdk.apps.length > 0 && (
                      <div className="space-y-2">
                        {sdk.apps.map((app: SDKApp) => {
                          const isConnected = sdk.connections.some(
                            (c) => c.url === app.url
                          );
                          const isActive = sdk.activeApp?.url === app.url;
                          return (
                            <div
                              key={app.appId}
                              className="flex items-center justify-between p-2 border border-border-primary rounded-md"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-text-primary truncate">
                                  {app.appName}
                                </div>
                                <div className="text-xs text-text-muted">
                                  {app.url}{" "}
                                  {app.framework && `(${app.framework})`}
                                </div>
                              </div>
                              {isActive ? (
                                <Badge variant="secondary" className="shrink-0">
                                  Active
                                </Badge>
                              ) : isConnected ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => sdk.switchActive(app.url)}
                                >
                                  Switch
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => sdk.connectToApp(app.url)}
                                  disabled={sdk.isConnecting}
                                >
                                  {sdk.isConnecting ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    "Connect"
                                  )}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!sdk.activeApp &&
                      sdk.apps.length === 0 &&
                      !sdk.isScanning && (
                        <p className="text-xs text-text-muted">
                          Click Scan to find apps with the UI Bridge SDK
                          installed.
                        </p>
                      )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Collection tabs — only shown when SDK app is connected */}
            {hasActiveSDKApp && (
              <Tabs
                value={collectTab}
                onValueChange={(v) => setCollectTab(v as "explore" | "record")}
              >
                <TabsList>
                  <TabsTrigger value="explore" className="gap-1.5">
                    <Compass className="size-3.5" />
                    Explore
                  </TabsTrigger>
                  <TabsTrigger value="record" className="gap-1.5">
                    <Camera className="size-3.5" />
                    Record
                  </TabsTrigger>
                </TabsList>

                {/* Explore tab — automated UI Bridge exploration */}
                <TabsContent value="explore" className="mt-3">
                  <ExplorationConfigPanel
                    config={exploration.config}
                    onConfigChange={exploration.updateConfig}
                    progress={exploration.progress}
                    isRunning={exploration.isRunning}
                    onStart={handleStartExploration}
                    onStop={handleStopExploration}
                    connections={connections}
                    connectionsLoading={connectionsLoading}
                    selectedConnectionId={selectedConnectionId}
                    onConnectionChange={setSelectedConnectionId}
                    hideRunnerSection
                  />
                </TabsContent>

                {/* Record tab — SDK snapshot-based recording */}
                <TabsContent value="record" className="mt-3">
                  <Card>
                    <CardContent className="py-3 space-y-3">
                      <p className="text-sm text-text-muted">
                        Capture snapshots from the connected SDK app. Navigate
                        the app manually while recording to capture different UI
                        states.
                      </p>

                      {/* Recording controls */}
                      <div className="flex items-center gap-3">
                        {!sdk.isRecording ? (
                          <Button
                            onClick={() => sdk.startRecording()}
                            variant="default"
                            size="sm"
                          >
                            <Circle className="size-3.5 mr-1.5 text-red-400" />
                            Start Recording
                          </Button>
                        ) : (
                          <Button
                            onClick={handleStopRecording}
                            variant="destructive"
                            size="sm"
                          >
                            <Square className="size-3.5 mr-1.5" />
                            Stop Recording
                          </Button>
                        )}

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={sdk.captureNow}
                          disabled={
                            !sdk.isRecording && sdk.snapshots.length === 0
                          }
                        >
                          <Camera className="size-3.5 mr-1.5" />
                          Capture Now
                        </Button>

                        {sdk.snapshots.length > 0 && !sdk.isRecording && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={sdk.resetRecording}
                          >
                            <RotateCcw className="size-3.5 mr-1.5" />
                            Reset
                          </Button>
                        )}
                      </div>

                      {/* Recording status */}
                      {(sdk.isRecording || sdk.snapshots.length > 0) && (
                        <div className="flex items-center gap-4">
                          <Badge
                            variant={
                              sdk.isRecording ? "destructive" : "secondary"
                            }
                          >
                            {sdk.isRecording && (
                              <span className="size-2 rounded-full bg-red-400 mr-1.5 animate-pulse" />
                            )}
                            {sdk.snapshots.length} snapshots
                          </Badge>
                          {sdk.snapshots.length > 0 && (
                            <span className="text-xs text-text-muted">
                              {sdk.snapshots.at(-1)!.elements.length} elements
                              in last snapshot
                            </span>
                          )}
                        </div>
                      )}

                      {/* Use snapshots button — shown when not recording and snapshots exist */}
                      {!sdk.isRecording && sdk.snapshots.length > 0 && (
                        <Button
                          onClick={handleUseRecordedSnapshots}
                          className="w-full"
                        >
                          <Sparkles className="size-4 mr-2" />
                          Use {sdk.snapshots.length} Snapshots for Discovery
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}
          </>
        )}

        {/* Phase 2: Discovery Results */}
        {hasRenders && (
          <>
            {/* Render summary */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Layers className="size-4" />
                    Render Logs Collected
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={discovery.reset}>
                    <RotateCcw className="size-3.5 mr-1.5" />
                    Start Over
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <Badge variant="secondary" className="text-sm">
                    <Hash className="size-3 mr-1" />
                    {discovery.renders!.length} render logs
                  </Badge>
                  <Badge variant="outline" className="text-sm capitalize">
                    via {discovery.renderSource}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Discover States */}
            {!hasDiscoveryResult && (
              <Card>
                <CardContent className="py-6 flex flex-col items-center gap-4">
                  <p className="text-sm text-text-secondary">
                    Run state discovery on the collected render logs to identify
                    UI states.
                  </p>
                  <Button
                    onClick={discovery.runDiscovery}
                    disabled={discovery.isDiscovering}
                    size="lg"
                  >
                    {discovery.isDiscovering ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="size-4 mr-2" />
                    )}
                    Discover States
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Discovery Results + Save */}
            {hasDiscoveryResult && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-500" />
                    Discovery Complete
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Badge variant="secondary">
                      {discovery.discoveryResult!.states.length} states
                    </Badge>
                    <Badge variant="secondary">
                      {discovery.discoveryResult!.unique_element_count} elements
                    </Badge>
                    <Badge variant="outline">
                      {discovery.discoveryResult!.render_count} renders
                    </Badge>
                    {discovery.discoveryResult!.strategy_used && (
                      <Badge variant="outline" className="capitalize">
                        {discovery.discoveryResult!.strategy_used} strategy
                      </Badge>
                    )}
                  </div>

                  {/* State preview */}
                  <div className="border border-border-primary rounded-md p-3 space-y-1.5 max-h-40 overflow-y-auto">
                    {discovery.discoveryResult!.states.map((state) => (
                      <div
                        key={state.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-text-primary">{state.name}</span>
                        <span className="text-text-muted">
                          {(state.confidence * 100).toFixed(0)}% confidence
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Save form */}
                  <div className="border-t border-border-primary pt-4 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="config-name">Configuration Name</Label>
                      <Input
                        id="config-name"
                        placeholder="e.g., My App States"
                        value={discovery.configName}
                        onChange={(e) =>
                          discovery.setConfigName(e.target.value)
                        }
                      />
                    </div>
                    <Button
                      onClick={handleSave}
                      disabled={
                        discovery.isSaving || !discovery.configName.trim()
                      }
                      className="w-full"
                    >
                      {discovery.isSaving ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="size-4 mr-2" />
                      )}
                      Save to Project
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
