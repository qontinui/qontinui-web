"use client";

import { toast } from "sonner";
import { useUIBridgeExploration } from "@/hooks/ui-bridge";
import { useUIBridgeRecording } from "@/hooks/useUIBridgeRecording";
import { ExplorationConfigPanel, RecordingPanel } from "@/components/ui-bridge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Play,
  CheckCircle2,
  Layers,
  FileJson,
  Save,
  FolderOpen,
  Compass,
  Circle,
} from "lucide-react";
import type { Runner } from "@qontinui/shared-types";
import type {
  UIBridgeDiscoveryResult,
  SavedConfig,
  RenderLogSession,
  DiscoveryStrategy,
} from "../_types";

export interface UIBridgeConfigSectionProps {
  projectId: string | null;
  exploration: ReturnType<typeof useUIBridgeExploration>;
  explorationRenders: unknown[] | null;
  setExplorationRenders: (renders: unknown[] | null) => void;
  recording: ReturnType<typeof useUIBridgeRecording>;
  recordingRenders: unknown[] | null;
  setRecordingRenders: (renders: unknown[] | null) => void;
  sessionRenders: unknown[] | null;
  setSessionRenders: (renders: unknown[] | null) => void;
  uploadedRenders: unknown[] | null;
  setUploadedRenders: (renders: unknown[] | null) => void;
  renderLogSessions: RenderLogSession[];
  isLoadingSessions: boolean;
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  isLoadingSessionRenders: boolean;
  loadRenderLogSessions: () => void;
  loadSessionRenders: (sessionId: string) => void;
  savedConfigs: SavedConfig[];
  selectedConfigId: string | null;
  setSelectedConfigId: (id: string | null) => void;
  loadSavedConfig: (id: string) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  rendersToAnalyze: unknown[] | null | undefined;
  discoveryResult: UIBridgeDiscoveryResult | null;
  configName: string;
  setConfigName: (name: string) => void;
  isDiscovering: boolean;
  runDiscovery: () => void;
  isSaving: boolean;
  saveDiscoveredStates: () => void;
  setDiscoveryResult: (result: UIBridgeDiscoveryResult | null) => void;
  setStateDescriptions: (descriptions: Record<string, string>) => void;
  setCurrentSavedConfigId: (id: string | null) => void;
  setStateUuidMap: (map: Record<string, string>) => void;
  discoveryStrategy: DiscoveryStrategy;
  setDiscoveryStrategy: (strategy: DiscoveryStrategy) => void;
  runners: Runner[];
  runnersLoading: boolean;
  selectedRunnerId: string | null;
  onRunnerChange: (runnerId: string | null) => void;
  getRunnerUrl: (runnerId: string | null) => string | null;
  onRefreshBrowserTabs: () => void;
  onSelectBrowserTab: (tabId: number | null) => Promise<void>;
}

export function UIBridgeConfigSection({
  projectId,
  exploration,
  explorationRenders,
  setExplorationRenders,
  recording,
  recordingRenders,
  setRecordingRenders,
  sessionRenders,
  setSessionRenders,
  uploadedRenders,
  setUploadedRenders,
  renderLogSessions,
  isLoadingSessions,
  selectedSessionId,
  setSelectedSessionId,
  isLoadingSessionRenders,
  loadRenderLogSessions,
  loadSessionRenders,
  savedConfigs,
  selectedConfigId,
  setSelectedConfigId,
  loadSavedConfig,
  handleFileUpload,
  rendersToAnalyze,
  discoveryResult,
  configName,
  setConfigName,
  isDiscovering,
  runDiscovery,
  isSaving,
  saveDiscoveredStates,
  setDiscoveryResult,
  setStateDescriptions,
  setCurrentSavedConfigId,
  setStateUuidMap,
  discoveryStrategy,
  setDiscoveryStrategy,
  runners,
  runnersLoading,
  selectedRunnerId,
  onRunnerChange,
  getRunnerUrl,
  onRefreshBrowserTabs,
  onSelectBrowserTab,
}: UIBridgeConfigSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Render Log Source</CardTitle>
        <CardDescription>
          Collect render logs automatically or load from existing sources
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Discovery Strategy Selector */}
        <div className="flex items-center gap-4 p-3 bg-surface-raised/50 rounded-lg border border-border-subtle">
          <span className="text-sm font-medium text-text-secondary">
            Discovery Strategy:
          </span>
          <div className="flex gap-2">
            <Button
              variant={discoveryStrategy === "auto" ? "default" : "outline"}
              size="sm"
              onClick={() => setDiscoveryStrategy("auto")}
              className="text-xs"
            >
              Auto
            </Button>
            <Button
              variant={
                discoveryStrategy === "fingerprint" ? "default" : "outline"
              }
              size="sm"
              onClick={() => setDiscoveryStrategy("fingerprint")}
              className="text-xs"
            >
              Fingerprint
            </Button>
          </div>
          <span className="text-xs text-text-muted ml-auto">
            {discoveryStrategy === "auto" &&
              "Uses fingerprint if available, otherwise co-occurrence"}
            {discoveryStrategy === "fingerprint" &&
              "Enhanced cross-page element matching"}
          </span>
        </div>

        <Tabs defaultValue="explore" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="explore" className="flex items-center gap-2">
              <Compass className="h-4 w-4" />
              Auto Explore
            </TabsTrigger>
            <TabsTrigger value="recording" className="flex items-center gap-2">
              <Circle className="h-4 w-4" />
              Manual Recording
            </TabsTrigger>
            <TabsTrigger value="session" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              From Session
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <FileJson className="h-4 w-4" />
              Upload / Load
            </TabsTrigger>
          </TabsList>

          {/* Auto Explore Tab */}
          <TabsContent value="explore" className="space-y-4">
            <ExplorationConfigPanel
              config={exploration.config}
              onConfigChange={exploration.updateConfig}
              progress={exploration.progress}
              isRunning={exploration.isRunning}
              runners={runners}
              runnersLoading={runnersLoading}
              selectedRunnerId={selectedRunnerId}
              onRunnerChange={onRunnerChange}
              browserTabs={exploration.browserTabs}
              browserTabsLoading={exploration.browserTabsLoading}
              browserTabsError={exploration.browserTabsError}
              onRefreshBrowserTabs={onRefreshBrowserTabs}
              onSelectBrowserTab={onSelectBrowserTab}
              onStart={async () => {
                const runnerUrl = getRunnerUrl(selectedRunnerId);
                if (!runnerUrl) {
                  toast.error("Please select a connected runner");
                  return;
                }
                setExplorationRenders(null);

                let results;
                if (exploration.config.targetType !== "web") {
                  results =
                    await exploration.startUIBridgeExploration(runnerUrl);
                } else {
                  results = await exploration.startExploration(runnerUrl);
                }

                if (results && results.renderLogs.length > 0) {
                  const renders = results.renderLogs.map((log) => ({
                    id: log.id,
                    type: "dom_snapshot",
                    page_url: log.url,
                    snapshot: log.snapshot,
                    timestamp: log.timestamp,
                    trigger: log.trigger,
                  }));
                  setExplorationRenders(renders);
                  setSessionRenders(null);
                  setUploadedRenders(null);
                  setSelectedSessionId(null);
                  setDiscoveryResult(null);
                  setStateDescriptions({});
                  setCurrentSavedConfigId(null);
                  setStateUuidMap({});
                  toast.success(
                    `Collected ${renders.length} render logs from exploration`
                  );
                }
              }}
              onStop={() => {
                const runnerUrl = getRunnerUrl(selectedRunnerId);
                exploration.stopExploration(runnerUrl || undefined);
              }}
            />

            {explorationRenders && explorationRenders.length > 0 && (
              <div className="flex items-center justify-between p-3 bg-brand-success/10 border border-brand-success/30 rounded-lg">
                <div className="flex items-center gap-2 text-brand-success">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {explorationRenders.length} render logs collected from
                    exploration
                  </span>
                </div>
                <Button
                  onClick={runDiscovery}
                  disabled={isDiscovering}
                  size="sm"
                >
                  {isDiscovering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Discovering...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Discover States
                    </>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Manual Recording Tab */}
          <TabsContent value="recording" className="space-y-4">
            <RecordingPanel
              session={recording.session}
              isStarting={recording.isStarting}
              isStopping={recording.isStopping}
              onStartRecording={async (tabId, options) => {
                const runnerUrl = getRunnerUrl(selectedRunnerId);
                if (!runnerUrl) {
                  toast.error("Please select a connected runner");
                  return;
                }
                setRecordingRenders(null);
                await recording.startRecording(runnerUrl, tabId, options);
                recording.startPolling(runnerUrl);
              }}
              onStopRecording={async () => {
                const runnerUrl = getRunnerUrl(selectedRunnerId);
                if (!runnerUrl) return;
                recording.stopPolling();
                const result = await recording.stopRecording(runnerUrl);
                if (result.success && result.snapshots) {
                  const renders = recording.getSnapshotsAsRenderLogs();
                  if (renders.length > 0) {
                    setRecordingRenders(renders);
                    setExplorationRenders(null);
                    setSessionRenders(null);
                    setUploadedRenders(null);
                    setSelectedSessionId(null);
                    setDiscoveryResult(null);
                    setStateDescriptions({});
                    setCurrentSavedConfigId(null);
                    setStateUuidMap({});
                    toast.success(
                      `Captured ${renders.length} snapshots from recording`
                    );
                  }
                }
              }}
              onCaptureNow={async () => {
                const runnerUrl = getRunnerUrl(selectedRunnerId);
                if (runnerUrl) {
                  await recording.captureNow(runnerUrl);
                }
              }}
              onResetSession={() => {
                recording.resetSession();
                setRecordingRenders(null);
              }}
              onRunDiscovery={() => {
                if (
                  !recordingRenders &&
                  recording.session.snapshots.length > 0
                ) {
                  const renders = recording.getSnapshotsAsRenderLogs();
                  setRecordingRenders(renders);
                }
                runDiscovery();
              }}
              isDiscovering={isDiscovering}
              browserTabs={exploration.browserTabs}
              browserTabsLoading={exploration.browserTabsLoading}
              onRefreshTabs={onRefreshBrowserTabs}
              selectedTabId={exploration.config.selectedBrowserTabId}
              onSelectTab={async (tabId) => {
                await onSelectBrowserTab(tabId);
              }}
            />

            {recordingRenders && recordingRenders.length > 0 && (
              <div className="flex items-center justify-between p-3 bg-brand-success/10 border border-brand-success/30 rounded-lg">
                <div className="flex items-center gap-2 text-brand-success">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {recordingRenders.length} snapshots captured from recording
                  </span>
                </div>
                <Button
                  onClick={runDiscovery}
                  disabled={isDiscovering}
                  size="sm"
                >
                  {isDiscovering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Discovering...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Discover States
                    </>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* From Session Tab */}
          <TabsContent value="session" className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              {renderLogSessions.length > 0 ? (
                <Select
                  value={selectedSessionId || ""}
                  onValueChange={(value) => {
                    loadSessionRenders(value);
                    setExplorationRenders(null);
                    setRecordingRenders(null);
                  }}
                  disabled={isLoadingSessionRenders}
                >
                  <SelectTrigger className="w-[280px]">
                    <Layers className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Select a captured session" />
                  </SelectTrigger>
                  <SelectContent>
                    {renderLogSessions.map((session) => (
                      <SelectItem
                        key={session.session_id}
                        value={session.session_id}
                      >
                        {session.snapshot_count} renders ({session.unique_pages}{" "}
                        pages)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-text-muted">
                  No captured sessions found. Browse the app to capture render
                  logs automatically.
                </p>
              )}

              {isLoadingSessionRenders && (
                <div className="flex items-center gap-2 text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading session...</span>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={loadRenderLogSessions}
                disabled={isLoadingSessions}
              >
                {isLoadingSessions ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Refresh"
                )}
              </Button>
            </div>

            {sessionRenders && !isLoadingSessionRenders && (
              <div className="flex items-center justify-between p-3 bg-brand-success/10 border border-brand-success/30 rounded-lg">
                <div className="flex items-center gap-2 text-brand-success">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {sessionRenders.length} renders loaded from session
                  </span>
                </div>
                <Button
                  onClick={runDiscovery}
                  disabled={isDiscovering}
                  size="sm"
                >
                  {isDiscovering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Discovering...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Discover States
                    </>
                  )}
                </Button>
              </div>
            )}

            <p className="text-sm text-text-muted">
              Render logs are automatically captured as you browse the
              application. Select a session to load its render logs for state
              discovery.
            </p>
          </TabsContent>

          {/* Upload / Load Tab */}
          <TabsContent value="upload" className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <label
                aria-label="Upload file"
                htmlFor="type--file-0"
                className="cursor-pointer"
              >
                <input
                  id="type--file-0"
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    handleFileUpload(e);
                    setExplorationRenders(null);
                    setRecordingRenders(null);
                  }}
                  className="hidden"
                />
                <Button variant="outline" asChild>
                  <span>
                    <FileJson className="h-4 w-4 mr-2" />
                    Upload JSON File
                  </span>
                </Button>
              </label>

              {projectId && savedConfigs.length > 0 && (
                <Select
                  value={selectedConfigId || ""}
                  onValueChange={(value) => {
                    setSelectedConfigId(value);
                    loadSavedConfig(value);
                    setExplorationRenders(null);
                    setRecordingRenders(null);
                  }}
                >
                  <SelectTrigger className="w-[200px]">
                    <FolderOpen className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Load saved config" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedConfigs.map((cfg) => (
                      <SelectItem key={cfg.id} value={cfg.id}>
                        {cfg.name} ({cfg.render_count} renders)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {uploadedRenders &&
              !sessionRenders &&
              !explorationRenders &&
              !recordingRenders && (
                <div className="flex items-center justify-between p-3 bg-brand-success/10 border border-brand-success/30 rounded-lg">
                  <div className="flex items-center gap-2 text-brand-success">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      {uploadedRenders.length} renders loaded from file
                    </span>
                  </div>
                  <Button
                    onClick={runDiscovery}
                    disabled={isDiscovering}
                    size="sm"
                  >
                    {isDiscovering ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Discovering...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Discover States
                      </>
                    )}
                  </Button>
                </div>
              )}

            <p className="text-sm text-text-muted">
              Upload a JSON file containing render logs, or load from a
              previously saved configuration.
            </p>
          </TabsContent>
        </Tabs>

        {/* Config Name and Save */}
        {rendersToAnalyze && projectId && discoveryResult && (
          <div className="flex items-center gap-4 pt-4 border-t">
            <Input
              placeholder="Config name"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              className="w-[200px]"
            />
            <Button
              variant="secondary"
              onClick={saveDiscoveredStates}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save to Project
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
