"use client";

import {
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
  Accessibility,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AccessibilitySnapshot } from "@qontinui/shared-types/accessibility";

interface ExplorerHeaderProps {
  snapshot: AccessibilitySnapshot | null;
  isLoading: boolean;
  showSettings: boolean;
  onToggleSettings: () => void;
  onCapture: () => void;
}

export function ExplorerHeader({
  snapshot,
  isLoading,
  showSettings,
  onToggleSettings,
  onCapture,
}: ExplorerHeaderProps) {
  return (
    <div className="flex items-center justify-between p-3 border-b border-border-default bg-surface-panel">
      <div className="flex items-center gap-2">
        <Accessibility className="h-5 w-5 text-purple-400" />
        <h2 className="text-sm font-semibold">Accessibility Explorer</h2>
        {snapshot && (
          <Badge variant="secondary" className="text-xs">
            {snapshot.interactiveNodes} interactive
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1">
        {/* Connection status */}
        {snapshot ? (
          <Badge variant="outline" className="gap-1 text-xs text-green-400">
            <Wifi className="h-3 w-3" />
            Connected
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="gap-1 text-xs text-muted-foreground"
          >
            <WifiOff className="h-3 w-3" />
            Disconnected
          </Badge>
        )}

        {/* Settings toggle */}
        {showSettings && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSettings}
            className="h-7 w-7 p-0"
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}

        {/* Capture button */}
        <Button
          variant="default"
          size="sm"
          onClick={onCapture}
          disabled={isLoading}
          className="h-7 gap-1"
        >
          <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          Capture
        </Button>
      </div>
    </div>
  );
}
