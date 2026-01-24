"use client";

/**
 * UI Bridge Recording Panel
 *
 * Provides controls for manual recording mode where users navigate
 * through the application and DOM snapshots are captured automatically.
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Circle,
  Square,
  Camera,
  Trash2,
  Loader2,
  AlertCircle,
  Globe,
  RefreshCw,
  CheckCircle2,
  Clock,
  MousePointer,
  Type,
  Navigation,
  Layers,
} from "lucide-react";
import type { BrowserTab } from "@/hooks/useUIBridgeExploration";
import type { RecordingSnapshot, RecordingSession } from "@/hooks/useUIBridgeRecording";

interface RecordingPanelProps {
  /** Recording session state */
  session: RecordingSession;
  /** Whether recording is starting */
  isStarting: boolean;
  /** Whether recording is stopping */
  isStopping: boolean;
  /** Start recording handler */
  onStartRecording: (tabId: number | null, options: { captureMutations: boolean }) => void;
  /** Stop recording handler */
  onStopRecording: () => void;
  /** Capture now handler */
  onCaptureNow: () => void;
  /** Reset session handler */
  onResetSession: () => void;
  /** Run state discovery on captured snapshots */
  onRunDiscovery: () => void;
  /** Whether discovery is running */
  isDiscovering: boolean;
  /** Available browser tabs */
  browserTabs: BrowserTab[];
  /** Whether tabs are loading */
  browserTabsLoading: boolean;
  /** Refresh browser tabs */
  onRefreshTabs: () => void;
  /** Selected tab ID */
  selectedTabId: number | null;
  /** Tab selection handler */
  onSelectTab: (tabId: number | null) => void;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getTriggerIcon(trigger: RecordingSnapshot["trigger"]) {
  switch (trigger) {
    case "click":
      return <MousePointer className="w-3 h-3" />;
    case "input":
      return <Type className="w-3 h-3" />;
    case "navigation":
      return <Navigation className="w-3 h-3" />;
    case "mutation":
      return <Layers className="w-3 h-3" />;
    case "initial":
      return <Circle className="w-3 h-3" />;
    case "manual":
      return <Camera className="w-3 h-3" />;
    default:
      return <Circle className="w-3 h-3" />;
  }
}

function getTriggerLabel(trigger: RecordingSnapshot["trigger"]) {
  switch (trigger) {
    case "click":
      return "Click";
    case "input":
      return "Input";
    case "navigation":
      return "Navigation";
    case "mutation":
      return "DOM Change";
    case "initial":
      return "Initial";
    case "manual":
      return "Manual";
    default:
      return trigger;
  }
}

export function RecordingPanel({
  session,
  isStarting,
  isStopping,
  onStartRecording,
  onStopRecording,
  onCaptureNow,
  onResetSession,
  onRunDiscovery,
  isDiscovering,
  browserTabs,
  browserTabsLoading,
  onRefreshTabs,
  selectedTabId,
  onSelectTab,
}: RecordingPanelProps) {
  const [captureMutations, setCaptureMutations] = useState(true);
  const [duration, setDuration] = useState(0);

  // Update duration every second while recording
  useEffect(() => {
    if (!session.isRecording || !session.startTime) {
      setDuration(0);
      return;
    }

    const interval = setInterval(() => {
      setDuration(Date.now() - session.startTime!);
    }, 1000);

    return () => clearInterval(interval);
  }, [session.isRecording, session.startTime]);

  const handleStartRecording = useCallback(() => {
    onStartRecording(selectedTabId, { captureMutations });
  }, [onStartRecording, selectedTabId, captureMutations]);

  // Group snapshots by URL
  const snapshotsByUrl = session.snapshots.reduce((acc, snapshot) => {
    const url = snapshot.url;
    if (!acc[url]) {
      acc[url] = [];
    }
    acc[url].push(snapshot);
    return acc;
  }, {} as Record<string, RecordingSnapshot[]>);

  const uniqueUrls = Object.keys(snapshotsByUrl).length;
  const totalElements = session.snapshots.reduce((sum, s) => sum + s.elementCount, 0);
  const uniqueElementIds = new Set(
    session.snapshots.flatMap((s) => s.elements.map((e) => e.id))
  ).size;

  return (
    <div className="space-y-4">
      {/* Recording Controls */}
      <Card className="border-brand-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {session.isRecording ? (
              <>
                <Circle className="w-4 h-4 fill-red-500 text-red-500 animate-pulse" />
                Recording
              </>
            ) : (
              <>
                <Circle className="w-4 h-4" />
                Manual Recording
              </>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            Navigate through the app while recording to capture UI states
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tab Selection (when not recording) */}
          {!session.isRecording && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-text-muted">Target Tab</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRefreshTabs}
                  disabled={browserTabsLoading}
                  className="h-6 px-2"
                >
                  <RefreshCw className={`w-3 h-3 ${browserTabsLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
              <Select
                value={selectedTabId?.toString() || "active"}
                onValueChange={(value) => onSelectTab(value === "active" ? null : parseInt(value, 10))}
              >
                <SelectTrigger className="bg-surface-canvas border-brand-primary/20">
                  <SelectValue placeholder="Select tab to record" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full" />
                      <span>Active Tab (auto)</span>
                    </div>
                  </SelectItem>
                  {browserTabs.map((tab) => (
                    <SelectItem key={tab.id} value={tab.id.toString()}>
                      <div className="flex items-center gap-2 max-w-[350px]">
                        {tab.favIconUrl ? (
                          <img src={tab.favIconUrl} alt="" className="w-4 h-4" />
                        ) : (
                          <Globe className="w-4 h-4 text-text-muted" />
                        )}
                        <span className="truncate">{tab.title || tab.url}</span>
                        {tab.active && (
                          <Badge variant="outline" className="text-[9px] py-0 px-1">Active</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Recording Options (when not recording) */}
          {!session.isRecording && (
            <div className="flex items-center justify-between">
              <Label className="text-xs text-text-muted" htmlFor="capture-mutations">
                Capture DOM changes
              </Label>
              <Switch
                id="capture-mutations"
                checked={captureMutations}
                onCheckedChange={setCaptureMutations}
              />
            </div>
          )}

          {/* Recording Status */}
          {session.isRecording && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 bg-surface-canvas rounded">
                <div className="text-lg font-bold text-brand-primary">
                  {formatDuration(duration)}
                </div>
                <div className="text-[10px] text-text-muted">Duration</div>
              </div>
              <div className="p-2 bg-surface-canvas rounded">
                <div className="text-lg font-bold text-brand-primary">
                  {session.snapshots.length}
                </div>
                <div className="text-[10px] text-text-muted">Snapshots</div>
              </div>
              <div className="p-2 bg-surface-canvas rounded">
                <div className="text-lg font-bold text-brand-primary">
                  {uniqueElementIds}
                </div>
                <div className="text-[10px] text-text-muted">Elements</div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {session.error && (
            <Alert variant="destructive" className="border-red-500/30 bg-red-500/10">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{session.error}</AlertDescription>
            </Alert>
          )}

          {/* Control Buttons */}
          <div className="flex gap-2">
            {!session.isRecording ? (
              <Button
                onClick={handleStartRecording}
                disabled={isStarting || browserTabs.length === 0}
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                {isStarting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 mr-2 fill-current" />
                )}
                Start Recording
              </Button>
            ) : (
              <>
                <Button
                  onClick={onStopRecording}
                  disabled={isStopping}
                  variant="destructive"
                  className="flex-1"
                >
                  {isStopping ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Square className="w-4 h-4 mr-2" />
                  )}
                  Stop
                </Button>
                <Button
                  onClick={onCaptureNow}
                  variant="outline"
                  size="icon"
                  title="Capture Now"
                >
                  <Camera className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Captured Snapshots */}
      {session.snapshots.length > 0 && (
        <Card className="border-brand-primary/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Captured Snapshots</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {session.snapshots.length} snapshots
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {uniqueUrls} pages
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-surface-canvas rounded flex items-center gap-2">
                <Layers className="w-4 h-4 text-brand-primary" />
                <span>{uniqueElementIds} unique elements</span>
              </div>
              <div className="p-2 bg-surface-canvas rounded flex items-center gap-2">
                <Clock className="w-4 h-4 text-brand-primary" />
                <span>{totalElements} total captured</span>
              </div>
            </div>

            {/* Snapshot Timeline */}
            <ScrollArea className="h-[200px]">
              <div className="space-y-1">
                {session.snapshots.map((snapshot, index) => (
                  <div
                    key={snapshot.id}
                    className="flex items-center gap-2 p-2 bg-surface-canvas/50 rounded text-xs hover:bg-surface-canvas transition-colors"
                  >
                    <div className="w-5 h-5 rounded-full bg-brand-primary/20 flex items-center justify-center text-brand-primary">
                      {getTriggerIcon(snapshot.trigger)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px] py-0">
                          {getTriggerLabel(snapshot.trigger)}
                        </Badge>
                        <span className="text-text-muted">{snapshot.elementCount} elements</span>
                      </div>
                      {snapshot.triggerElement?.textContent && (
                        <div className="text-text-muted truncate text-[10px]">
                          {snapshot.triggerElement.textContent}
                        </div>
                      )}
                    </div>
                    <div className="text-text-muted text-[10px]">
                      #{index + 1}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2 border-t border-border">
              <Button
                onClick={onRunDiscovery}
                disabled={isDiscovering || session.snapshots.length === 0}
                className="flex-1"
              >
                {isDiscovering ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Run State Discovery
                  </>
                )}
              </Button>
              <Button
                onClick={onResetSession}
                variant="outline"
                size="icon"
                title="Clear Snapshots"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      {!session.isRecording && session.snapshots.length === 0 && (
        <Alert className="border-brand-primary/30 bg-brand-primary/5">
          <AlertDescription className="text-xs space-y-2">
            <p><strong>How to use manual recording:</strong></p>
            <ol className="list-decimal list-inside space-y-1 text-text-muted">
              <li>Select the browser tab you want to record</li>
              <li>Click "Start Recording"</li>
              <li>Navigate through the app (click buttons, fill forms, etc.)</li>
              <li>Click "Stop" when done</li>
              <li>Run state discovery on the captured snapshots</li>
            </ol>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
