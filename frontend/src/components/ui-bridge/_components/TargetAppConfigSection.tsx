"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  AlertCircle,
  Chrome,
  Globe,
  Info,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import type {
  BrowserTab,
  TargetType,
  TargetTypeRequirement,
  UIBridgeExplorationConfig,
} from "../exploration-config-types";
import { getUrlLabel, getUrlPlaceholder } from "../exploration-config-utils";

interface TargetAppConfigSectionProps {
  config: UIBridgeExplorationConfig;
  onConfigChange: (updates: Partial<UIBridgeExplorationConfig>) => void;
  isRunning: boolean;
  currentRequirements: TargetTypeRequirement;
  browserTabs: BrowserTab[];
  browserTabsLoading: boolean;
  browserTabsError: string | null;
  onRefreshBrowserTabs?: () => void;
  onSelectBrowserTab?: (tabId: number | null) => void;
}

export function TargetAppConfigSection({
  config,
  onConfigChange,
  isRunning,
  currentRequirements,
  browserTabs,
  browserTabsLoading,
  browserTabsError,
  onRefreshBrowserTabs,
  onSelectBrowserTab,
}: TargetAppConfigSectionProps) {
  return (
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
                The target app must have the UI Bridge SDK installed. Select the
                target type that matches your application.
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
            onValueChange={(value: TargetType) =>
              onConfigChange({ targetType: value })
            }
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
                  <Badge
                    variant="outline"
                    className="ml-1 text-[10px] py-0 px-1 bg-brand-success/10 text-brand-success border-brand-success/30"
                  >
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
              {getUrlLabel(config.targetType)}
            </Label>
            <Input
              type="url"
              placeholder={getUrlPlaceholder(config.targetType)}
              value={config.targetUrl}
              onChange={(e) => onConfigChange({ targetUrl: e.target.value })}
              disabled={isRunning}
              className="bg-surface-canvas border-brand-primary/20 font-mono"
            />
            <p className="text-[10px] text-text-muted">
              {config.targetType === "web" ? (
                <>
                  The URL where your web app is running. The app must have{" "}
                  <span className="text-brand-primary">
                    @qontinui/ui-bridge
                  </span>{" "}
                  installed.
                </>
              ) : config.targetType === "desktop" ? (
                <>
                  Your Tauri app must connect to the runner via WebSocket. Enter
                  the WebSocket URL or leave blank to use the default.
                </>
              ) : (
                <>
                  Your React Native app must connect to the runner via
                  WebSocket. Enter the WebSocket URL or leave blank to use the
                  default.
                </>
              )}
            </p>
          </div>
        )}

        {/* Extension-specific: Browser Tab Selector */}
        {config.targetType === "extension" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-text-muted text-xs">
                Target Browser Tab
              </Label>
              {onRefreshBrowserTabs && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRefreshBrowserTabs}
                  disabled={isRunning || browserTabsLoading}
                  className="h-7 px-2"
                >
                  <RefreshCw
                    className={`h-3 w-3 mr-1 ${browserTabsLoading ? "animate-spin" : ""}`}
                  />
                  <span className="text-xs">Refresh</span>
                </Button>
              )}
            </div>

            {browserTabsError && (
              <Alert
                variant="destructive"
                className="border-red-500/30 bg-red-500/10"
              >
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
                  No browser tabs found. Make sure the Chrome extension is
                  connected and click Refresh.
                </AlertDescription>
              </Alert>
            ) : (
              <Select
                value={config.selectedBrowserTabId?.toString() || "active"}
                onValueChange={(value) => {
                  console.log(
                    "[ExplorationConfigPanel] Tab selection changed:",
                    value
                  );
                  const tabId = value === "active" ? null : parseInt(value, 10);
                  console.log(
                    "[ExplorationConfigPanel] Calling onSelectBrowserTab with:",
                    tabId
                  );
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
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={tab.favIconUrl}
                            alt=""
                            className="w-4 h-4"
                          />
                        ) : (
                          <Globe className="w-4 h-4 text-text-muted" />
                        )}
                        <span className="truncate flex-1" title={tab.title}>
                          {tab.title || tab.url}
                        </span>
                        {tab.active && (
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 px-1"
                          >
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
                    {browserTabs.find(
                      (t) => t.id === config.selectedBrowserTabId
                    )?.url || "Unknown"}
                  </span>
                </div>
              </div>
            )}

            <p className="text-[10px] text-text-muted">
              Select which browser tab to explore. If &quot;Use Active Tab&quot;
              is selected, the currently focused tab will be used when
              exploration starts.
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
                  Your desktop app must be running and connected to the
                  qontinui-runner. The runner acts as a WebSocket server that
                  your app connects to.
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
  );
}
