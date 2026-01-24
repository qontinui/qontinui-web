"use client";

/**
 * UI Bridge Exploration Configuration Panel
 *
 * Allows users to configure automated exploration settings for
 * collecting render logs for state discovery.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Square,
  Compass,
  ShieldAlert,
  Clock,
  Globe,
  Loader2,
  AlertCircle,
  Info,
  ChevronDown,
  Monitor,
  Smartphone,
  Chrome,
} from "lucide-react";
import type { TargetType, BrowserTab } from "@/hooks/useUIBridgeExploration";
import type {
  UIBridgeExplorationConfig,
  ExplorationProgress,
} from "@/hooks/useUIBridgeExploration";
import type { RunnerConnection } from "@/types/runner";
import { RefreshCw } from "lucide-react";

interface ExplorationConfigPanelProps {
  config: UIBridgeExplorationConfig;
  onConfigChange: (updates: Partial<UIBridgeExplorationConfig>) => void;
  progress: ExplorationProgress;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  /** Available runner connections from database */
  connections: RunnerConnection[];
  /** Whether connections are loading */
  connectionsLoading: boolean;
  /** Currently selected connection ID */
  selectedConnectionId: number | null;
  /** Handler for connection selection change */
  onConnectionChange: (connectionId: number | null) => void;
  /** Browser tabs available for extension exploration */
  browserTabs?: BrowserTab[];
  /** Whether browser tabs are loading */
  browserTabsLoading?: boolean;
  /** Error fetching browser tabs */
  browserTabsError?: string | null;
  /** Handler to refresh browser tabs */
  onRefreshBrowserTabs?: () => void;
  /** Handler to select a browser tab */
  onSelectBrowserTab?: (tabId: number | null) => void;
}

export function ExplorationConfigPanel({
  config,
  onConfigChange,
  progress,
  isRunning,
  onStart,
  onStop,
  connections,
  connectionsLoading,
  selectedConnectionId,
  onConnectionChange,
  browserTabs = [],
  browserTabsLoading = false,
  browserTabsError = null,
  onRefreshBrowserTabs,
  onSelectBrowserTab,
}: ExplorationConfigPanelProps) {
  const [isRequirementsOpen, setIsRequirementsOpen] = useState(false);

  const progressPercent =
    progress.elementsDiscovered > 0
      ? Math.round(
          (progress.elementsClicked / Math.min(progress.elementsDiscovered, config.maxTotalElements)) * 100
        )
      : 0;

  // Check if we can start exploration
  // Extension type doesn't need a targetUrl - it uses the active browser tab
  const canStart = selectedConnectionId !== null &&
    (config.targetType === "extension" || !!config.targetUrl) &&
    progress.status !== "completed";

  // Target type descriptions for the requirements section
  const targetTypeRequirements: Record<TargetType, { title: string; requirements: string[]; icon: React.ReactNode; recommended?: boolean }> = {
    extension: {
      title: "Browser Extension (Recommended)",
      icon: <Chrome className="h-4 w-4" />,
      recommended: true,
      requirements: [
        "Qontinui DevTools extension must be installed in Chrome",
        "Extension must be connected to the runner (check popup)",
        "Target page should have elements with data-ui-id attributes",
      ],
    },
    web: {
      title: "Web Application (Direct HTTP)",
      icon: <Globe className="h-4 w-4" />,
      requirements: [
        "Target app must expose UI Bridge server endpoints",
        "Requires custom server-side element synchronization",
        "Use Browser Extension for most web apps instead",
      ],
    },
    desktop: {
      title: "Desktop App",
      icon: <Monitor className="h-4 w-4" />,
      requirements: [
        "Desktop app must be running (Electron, Tauri, etc.)",
        "UI Bridge SDK must be installed in the frontend",
        "App must connect to qontinui-runner via WebSocket",
      ],
    },
    mobile: {
      title: "Mobile (React Native)",
      icon: <Smartphone className="h-4 w-4" />,
      requirements: [
        "React Native app must be running",
        "UI Bridge SDK must be installed",
        "App must connect to qontinui-runner via WebSocket",
      ],
    },
  };

  const currentTargetType = config.targetType || "web";
  const currentRequirements = targetTypeRequirements[currentTargetType as TargetType];

  return (
    <div className="space-y-4">
      {/* Control Buttons */}
      <div className="flex items-center gap-3">
        {!isRunning ? (
          <Button
            onClick={onStart}
            className="bg-brand-success hover:bg-brand-success/80 text-white"
            disabled={!canStart}
            title={
              !selectedConnectionId
                ? "Select a connected runner"
                : config.targetType !== "extension" && !config.targetUrl
                  ? "Enter a target URL to explore"
                  : undefined
            }
          >
            <Play className="w-4 h-4 mr-2" />
            Start Exploration
          </Button>
        ) : (
          <Button
            onClick={onStop}
            variant="destructive"
          >
            <Square className="w-4 h-4 mr-2" />
            Stop
          </Button>
        )}

        {progress.status !== "idle" && (
          <div className="flex items-center gap-2 ml-auto">
            <Badge
              variant="outline"
              className={
                progress.status === "running"
                  ? "border-brand-primary text-brand-primary animate-pulse"
                  : progress.status === "completed"
                    ? "border-brand-success text-brand-success"
                    : progress.status === "failed"
                      ? "border-red-500 text-red-500"
                      : "border-yellow-500 text-yellow-500"
              }
            >
              {progress.status.toUpperCase()}
            </Badge>
          </div>
        )}
      </div>

      {/* Requirements Info Section */}
      <Collapsible open={isRequirementsOpen} onOpenChange={setIsRequirementsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between text-text-muted hover:text-text-secondary"
          >
            <span className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              How UI Bridge Exploration Works
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isRequirementsOpen ? "rotate-180" : ""}`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <Alert variant="info" className="border-blue-500/30 bg-blue-500/5">
            <Info className="h-4 w-4" />
            <AlertTitle>UI Bridge SDK Required</AlertTitle>
            <AlertDescription className="text-xs space-y-2">
              <p>
                UI Bridge exploration connects to applications that have the{" "}
                <strong>UI Bridge SDK</strong> installed. This is different from
                browser automation (like Playwright) which can work with any website.
              </p>
              <div className="mt-3 space-y-2">
                <p className="font-medium">Requirements for {currentRequirements.title}:</p>
                <ul className="list-disc list-inside space-y-1 text-text-muted">
                  {currentRequirements.requirements.map((req, idx) => (
                    <li key={idx}>{req}</li>
                  ))}
                </ul>
              </div>
              <p className="mt-3 text-text-muted">
                For browser automation without SDK requirements, use{" "}
                <span className="text-brand-primary">Playwright extraction</span> instead.
              </p>
            </AlertDescription>
          </Alert>
        </CollapsibleContent>
      </Collapsible>

      {/* Progress Section */}
      {progress.status !== "idle" && (
        <Card className="p-4 bg-surface-raised/60 border-brand-primary/30">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Progress</span>
              <span className="text-brand-primary font-mono">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-brand-primary">
                  {progress.elementsDiscovered}
                </div>
                <div className="text-[10px] text-text-muted uppercase tracking-wider">
                  Discovered
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-brand-success">
                  {progress.elementsClicked}
                </div>
                <div className="text-[10px] text-text-muted uppercase tracking-wider">
                  Clicked
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-500">
                  {progress.elementsSkipped}
                </div>
                <div className="text-[10px] text-text-muted uppercase tracking-wider">
                  Skipped
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-brand-secondary">
                  {progress.renderLogsCollected}
                </div>
                <div className="text-[10px] text-text-muted uppercase tracking-wider">
                  Render Logs
                </div>
              </div>
            </div>

            {progress.currentElement && isRunning && (
              <div className="mt-3 p-2 bg-surface-canvas/50 rounded text-xs">
                <span className="text-text-muted">Current: </span>
                <span className="text-white font-mono">{progress.currentElement}</span>
              </div>
            )}

            {progress.error && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                {progress.error}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Runner Selection */}
      <Card className="p-4 bg-surface-raised/60 border-brand-primary/30">
        <div className="flex items-center gap-2 mb-4">
          <Compass className="w-4 h-4 text-brand-primary" />
          <Label className="text-brand-primary font-mono text-sm uppercase tracking-wider">
            Runner
          </Label>
        </div>

        <div className="space-y-4">
          {connectionsLoading ? (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading runners...</span>
            </div>
          ) : connections.length === 0 ? (
            <Alert variant="destructive" className="border-red-500/30 bg-red-500/10">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                No runners connected. Connect a runner from the Runners page first.
              </AlertDescription>
            </Alert>
          ) : (
            <Select
              value={selectedConnectionId?.toString() || ""}
              onValueChange={(value) => onConnectionChange(value ? parseInt(value, 10) : null)}
              disabled={isRunning}
            >
              <SelectTrigger className="bg-surface-canvas border-brand-primary/20">
                <SelectValue placeholder="Select a runner" />
              </SelectTrigger>
              <SelectContent>
                {connections.map((conn) => (
                  <SelectItem key={conn.id} value={conn.id.toString()}>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span>{conn.runner_name}</span>
                      {conn.project_name && (
                        <span className="text-text-muted text-xs">({conn.project_name})</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </Card>

      {/* Target Application */}
      <Card className="p-4 bg-surface-raised/60 border-brand-primary/30">
        <div className="flex items-center gap-2 mb-4">
          {currentRequirements.icon}
          <Label className="text-brand-primary font-mono text-sm uppercase tracking-wider">
            Target Application
          </Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-text-muted cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">
                  The target app must have the UI Bridge SDK installed.
                  Select the target type that matches your application.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="space-y-4">
          {/* Target Type Selector */}
          <div className="space-y-2">
            <Label className="text-text-muted text-xs">Target Type</Label>
            <Select
              value={config.targetType}
              onValueChange={(value: TargetType) => onConfigChange({ targetType: value })}
              disabled={isRunning}
            >
              <SelectTrigger className="bg-surface-canvas border-brand-primary/20">
                <SelectValue placeholder="Select target type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="extension">
                  <div className="flex items-center gap-2">
                    <Chrome className="h-4 w-4" />
                    <span>Browser Extension</span>
                    <Badge variant="outline" className="ml-1 text-[10px] py-0 px-1 bg-brand-success/10 text-brand-success border-brand-success/30">
                      Recommended
                    </Badge>
                  </div>
                </SelectItem>
                <SelectItem value="web">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    <span>Web (Direct HTTP)</span>
                  </div>
                </SelectItem>
                <SelectItem value="desktop">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4" />
                    <span>Desktop App</span>
                  </div>
                </SelectItem>
                <SelectItem value="mobile">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4" />
                    <span>Mobile (React Native)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* URL / Connection Input */}
          {config.targetType !== "extension" && (
            <div className="space-y-2">
              <Label className="text-text-muted text-xs">
                {config.targetType === "web" ? "Application URL" : "Connection URL"}
              </Label>
              <Input
                type="url"
                placeholder={
                  config.targetType === "web"
                    ? "https://localhost:3000"
                    : config.targetType === "desktop"
                      ? "ws://localhost:9877"
                      : "ws://localhost:9877"
                }
                value={config.targetUrl}
                onChange={(e) => onConfigChange({ targetUrl: e.target.value })}
                disabled={isRunning}
                className="bg-surface-canvas border-brand-primary/20 font-mono"
              />
              <p className="text-[10px] text-text-muted">
                {config.targetType === "web" ? (
                  <>
                    The URL where your web app is running. The app must have{" "}
                    <span className="text-brand-primary">@qontinui/ui-bridge</span> installed.
                  </>
                ) : config.targetType === "desktop" ? (
                  <>
                    Your Tauri app must connect to the runner via WebSocket.
                    Enter the WebSocket URL or leave blank to use the default.
                  </>
                ) : (
                  <>
                    Your React Native app must connect to the runner via WebSocket.
                    Enter the WebSocket URL or leave blank to use the default.
                  </>
                )}
              </p>
            </div>
          )}

          {/* Extension-specific: Browser Tab Selector */}
          {config.targetType === "extension" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-text-muted text-xs">Target Browser Tab</Label>
                {onRefreshBrowserTabs && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRefreshBrowserTabs}
                    disabled={isRunning || browserTabsLoading}
                    className="h-7 px-2"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${browserTabsLoading ? "animate-spin" : ""}`} />
                    <span className="text-xs">Refresh</span>
                  </Button>
                )}
              </div>

              {browserTabsError && (
                <Alert variant="destructive" className="border-red-500/30 bg-red-500/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {browserTabsError}
                  </AlertDescription>
                </Alert>
              )}

              {browserTabsLoading ? (
                <div className="flex items-center gap-2 text-text-muted p-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs">Loading browser tabs...</span>
                </div>
              ) : browserTabs.length === 0 ? (
                <Alert className="border-yellow-500/30 bg-yellow-500/5">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <AlertDescription className="text-xs text-yellow-600">
                    No browser tabs found. Make sure the Chrome extension is connected and click Refresh.
                  </AlertDescription>
                </Alert>
              ) : (
                <Select
                  value={config.selectedBrowserTabId?.toString() || "active"}
                  onValueChange={(value) => {
                    console.log("[ExplorationConfigPanel] Tab selection changed:", value);
                    const tabId = value === "active" ? null : parseInt(value, 10);
                    console.log("[ExplorationConfigPanel] Calling onSelectBrowserTab with:", tabId);
                    onSelectBrowserTab?.(tabId);
                  }}
                  disabled={isRunning}
                >
                  <SelectTrigger className="bg-surface-canvas border-brand-primary/20">
                    <SelectValue placeholder="Select a browser tab" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="active">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-yellow-500 rounded-full" />
                        <span>Use Active Tab (auto)</span>
                      </div>
                    </SelectItem>
                    {browserTabs.map((tab) => (
                      <SelectItem key={tab.id} value={tab.id.toString()}>
                        <div className="flex items-center gap-2 max-w-[400px]">
                          {tab.favIconUrl ? (
                            <img src={tab.favIconUrl} alt="" className="w-4 h-4" />
                          ) : (
                            <Globe className="w-4 h-4 text-text-muted" />
                          )}
                          <span className="truncate flex-1" title={tab.title}>
                            {tab.title || tab.url}
                          </span>
                          {tab.active && (
                            <Badge variant="outline" className="text-[9px] py-0 px-1">
                              Active
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {config.selectedBrowserTabId !== null && (
                <div className="p-2 bg-surface-canvas/50 rounded text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">Selected:</span>
                    <span className="text-brand-primary font-mono truncate flex-1">
                      {browserTabs.find(t => t.id === config.selectedBrowserTabId)?.url || "Unknown"}
                    </span>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-text-muted">
                Select which browser tab to explore. If "Use Active Tab" is selected,
                the currently focused tab will be used when exploration starts.
              </p>
            </div>
          )}

          {/* Target-specific guidance */}
          {config.targetType !== "web" && config.targetType !== "extension" && (
            <Alert className="border-yellow-500/30 bg-yellow-500/5">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <AlertDescription className="text-xs text-yellow-600">
                {config.targetType === "desktop" ? (
                  <>
                    Your desktop app must be running and connected to the qontinui-runner.
                    The runner acts as a WebSocket server that your app connects to.
                  </>
                ) : (
                  <>
                    Your React Native app must be running on a device or emulator
                    and connected to the qontinui-runner via WebSocket.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </Card>

      {/* Configuration Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Exploration Limits */}
        <Card className="p-4 bg-surface-raised/60 border-brand-secondary/30">
          <div className="flex items-center gap-2 mb-4">
            <Compass className="w-4 h-4 text-brand-secondary" />
            <Label className="text-brand-secondary font-mono text-sm uppercase tracking-wider">
              Exploration Limits
            </Label>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-text-muted text-xs">Max Navigation Depth</Label>
              <Input
                type="number"
                min={0}
                max={5}
                value={config.maxDepth}
                onChange={(e) =>
                  onConfigChange({ maxDepth: parseInt(e.target.value) || 0 })
                }
                disabled={isRunning}
                className="bg-surface-canvas border-brand-secondary/20"
              />
              <p className="text-[10px] text-text-muted">
                0 = current page only, higher values explore linked pages
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-text-muted text-xs">Elements/Page</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={config.maxElementsPerPage}
                  onChange={(e) =>
                    onConfigChange({
                      maxElementsPerPage: parseInt(e.target.value) || 1,
                    })
                  }
                  disabled={isRunning}
                  className="bg-surface-canvas border-brand-secondary/20"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-text-muted text-xs">Total Elements</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={config.maxTotalElements}
                  onChange={(e) =>
                    onConfigChange({
                      maxTotalElements: parseInt(e.target.value) || 1,
                    })
                  }
                  disabled={isRunning}
                  className="bg-surface-canvas border-brand-secondary/20"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Timing */}
        <Card className="p-4 bg-surface-raised/60 border-brand-success/30">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-brand-success" />
            <Label className="text-brand-success font-mono text-sm uppercase tracking-wider">
              Timing & Behavior
            </Label>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-text-muted text-xs">Action Delay (ms)</Label>
              <Input
                type="number"
                min={100}
                max={5000}
                step={100}
                value={config.actionDelayMs}
                onChange={(e) =>
                  onConfigChange({ actionDelayMs: parseInt(e.target.value) || 500 })
                }
                disabled={isRunning}
                className="bg-surface-canvas border-brand-success/20"
              />
              <p className="text-[10px] text-text-muted">
                Wait time between actions (longer = safer)
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-2 bg-surface-canvas/50 rounded">
                <Label className="text-text-secondary text-xs">
                  Capture Render Logs
                </Label>
                <Switch
                  checked={config.captureRenderLogs}
                  onCheckedChange={(checked) =>
                    onConfigChange({ captureRenderLogs: checked })
                  }
                  disabled={isRunning}
                />
              </div>
              <div className="flex items-center justify-between p-2 bg-surface-canvas/50 rounded">
                <Label className="text-text-secondary text-xs">
                  Track Visited States
                </Label>
                <Switch
                  checked={config.trackVisitedStates}
                  onCheckedChange={(checked) =>
                    onConfigChange({ trackVisitedStates: checked })
                  }
                  disabled={isRunning}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Safety Filters */}
        <Card className="p-4 bg-surface-raised/60 border-red-500/30 md:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            <Label className="text-red-400 font-mono text-sm uppercase tracking-wider">
              Safety Filters
            </Label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-text-muted text-xs">
                Blocked Keywords (comma-separated)
              </Label>
              <Input
                value={config.blockedKeywords.join(", ")}
                onChange={(e) =>
                  onConfigChange({
                    blockedKeywords: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                disabled={isRunning}
                placeholder="delete, logout, remove..."
                className="bg-surface-canvas border-red-500/20"
              />
              <p className="text-[10px] text-text-muted">
                Skip elements containing these words
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-text-muted text-xs">
                Safe Keywords (comma-separated)
              </Label>
              <Input
                value={config.safeKeywords.join(", ")}
                onChange={(e) =>
                  onConfigChange({
                    safeKeywords: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                disabled={isRunning}
                placeholder="delete item from cart..."
                className="bg-surface-canvas border-brand-success/20"
              />
              <p className="text-[10px] text-text-muted">
                Allow elements even if they contain blocked words
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-text-muted text-xs">
                Blocked Selectors (comma-separated)
              </Label>
              <Input
                value={config.blockedSelectors.join(", ")}
                onChange={(e) =>
                  onConfigChange({
                    blockedSelectors: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                disabled={isRunning}
                placeholder="[data-no-explore], .dangerous-button..."
                className="bg-surface-canvas border-red-500/20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-text-muted text-xs">
                Allowed Element Types (comma-separated)
              </Label>
              <Input
                value={config.allowedTypes.join(", ")}
                onChange={(e) =>
                  onConfigChange({
                    allowedTypes: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                disabled={isRunning}
                placeholder="button, link, tab, menuitem..."
                className="bg-surface-canvas border-brand-primary/20"
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
