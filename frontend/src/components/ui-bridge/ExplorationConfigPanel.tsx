"use client";

/**
 * UI Bridge Exploration Configuration Panel
 *
 * Allows users to configure automated exploration settings for
 * collecting render logs for state discovery.
 */

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  RotateCcw,
  Compass,
  ShieldAlert,
  Clock,
  Globe,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type {
  UIBridgeExplorationConfig,
  ExplorationProgress,
} from "@/hooks/useUIBridgeExploration";
import type { RunnerConnection } from "@/types/runner";

interface ExplorationConfigPanelProps {
  config: UIBridgeExplorationConfig;
  onConfigChange: (updates: Partial<UIBridgeExplorationConfig>) => void;
  progress: ExplorationProgress;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  /** Available runner connections */
  connections: RunnerConnection[];
  /** Whether connections are loading */
  connectionsLoading: boolean;
  /** Currently selected connection ID */
  selectedConnectionId: number | null;
  /** Handler for connection selection change */
  onConnectionChange: (connectionId: number | null) => void;
}

export function ExplorationConfigPanel({
  config,
  onConfigChange,
  progress,
  isRunning,
  onStart,
  onStop,
  onReset,
  connections,
  connectionsLoading,
  selectedConnectionId,
  onConnectionChange,
}: ExplorationConfigPanelProps) {
  const progressPercent =
    progress.elementsDiscovered > 0
      ? Math.round(
          (progress.elementsClicked / Math.min(progress.elementsDiscovered, config.maxTotalElements)) * 100
        )
      : 0;

  // Check if we can start exploration
  const canStart = selectedConnectionId !== null && config.targetUrl && progress.status !== "completed";

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
                : !config.targetUrl
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
        <Button
          onClick={onReset}
          variant="outline"
          disabled={isRunning}
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset
        </Button>

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
            Connected Runner
          </Label>
        </div>

        <div className="space-y-4">
          {connectionsLoading ? (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading runners...</span>
            </div>
          ) : connections.length === 0 ? (
            <Alert className="bg-yellow-500/10 border-yellow-500/30">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <AlertDescription className="text-yellow-400">
                No runners connected.{" "}
                <Link href="/connect-runner" className="underline hover:text-yellow-300">
                  Connect a runner
                </Link>{" "}
                to start exploring.
              </AlertDescription>
            </Alert>
          ) : (
            <Select
              value={selectedConnectionId?.toString() || ""}
              onValueChange={(value) => onConnectionChange(value ? parseInt(value, 10) : null)}
              disabled={isRunning}
            >
              <SelectTrigger className="bg-surface-canvas border-brand-primary/20">
                <SelectValue placeholder="Select a connected runner" />
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

      {/* Target Application URL */}
      <Card className="p-4 bg-surface-raised/60 border-brand-primary/30">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-4 h-4 text-brand-primary" />
          <Label className="text-brand-primary font-mono text-sm uppercase tracking-wider">
            Target Application
          </Label>
        </div>

        <div className="space-y-2">
          <Label className="text-text-muted text-xs">URL to Explore</Label>
          <Input
            type="url"
            placeholder="https://example.com"
            value={config.targetUrl}
            onChange={(e) => onConfigChange({ targetUrl: e.target.value })}
            disabled={isRunning}
            className="bg-surface-canvas border-brand-primary/20 font-mono"
          />
          <p className="text-[10px] text-text-muted">
            The URL of the web application to explore and collect render logs from.
          </p>
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
