"use client";

import type { ActiveSource } from "@/hooks/use-inspector";
import type { UseExternalUIBridgeReturn } from "@/hooks/use-external-ui-bridge";
import type { DesktopState } from "@/hooks/use-inspector";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Monitor,
  RefreshCw,
  Loader2,
  Unplug,
  CheckCircle2,
  AlertCircle,
  Plug,
} from "lucide-react";

interface ConnectionPanelProps {
  activeSource: ActiveSource;
  bridge: UseExternalUIBridgeReturn;
  desktop: DesktopState;
}

export function ConnectionPanel({
  activeSource,
  bridge,
  desktop,
}: ConnectionPanelProps) {
  const hasDesktopElements = desktop.elements.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Browser Tab Connection */}
      <Card
        className={`bg-surface-raised/50 border-border-subtle/50 transition-colors ${
          activeSource === "browser" ? "ring-1 ring-purple-500/40" : ""
        }`}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Browser Tab
            </CardTitle>
            {bridge.isExtensionConnected ? (
              <Badge variant="success" className="text-[10px] gap-1">
                <Plug className="w-3 h-3" />
                Extension
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                No Extension
              </Badge>
            )}
          </div>
          <CardDescription className="text-text-muted text-xs">
            Connect via Chrome extension
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Button
              onClick={bridge.refreshTabs}
              disabled={bridge.isLoadingTabs}
              size="sm"
              variant="outline"
            >
              {bridge.isLoadingTabs ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              )}
              Refresh Tabs
            </Button>
            {bridge.connectedTabInfo && (
              <Button
                onClick={bridge.disconnect}
                size="sm"
                variant="destructive"
              >
                <Unplug className="w-3.5 h-3.5 mr-1.5" />
                Disconnect
              </Button>
            )}
          </div>

          {bridge.connectedTabInfo && (
            <div className="flex items-center gap-2 bg-green-950/20 border border-green-500/30 rounded-lg p-2.5">
              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-green-400 font-medium truncate">
                  {bridge.connectedTabInfo.title}
                </p>
                <p className="text-xs text-text-muted truncate">
                  {bridge.connectedTabInfo.url}
                </p>
              </div>
            </div>
          )}

          {bridge.browserTabs.length > 0 && !bridge.connectedTabInfo && (
            <div className="space-y-1 max-h-[150px] overflow-y-auto">
              {bridge.browserTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => bridge.connectToTab(tab.id)}
                  className="w-full text-left p-2 rounded-lg border border-border-subtle/30 bg-surface-canvas/30 hover:bg-surface-hover transition-colors"
                >
                  <p className="text-sm text-text-primary truncate">
                    {tab.title}
                  </p>
                  <p className="text-xs text-text-muted truncate">{tab.url}</p>
                </button>
              ))}
            </div>
          )}

          {bridge.error && (
            <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <p className="text-xs">{bridge.error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Desktop App Connection */}
      <Card
        className={`bg-surface-raised/50 border-border-subtle/50 transition-colors ${
          activeSource === "desktop" ? "ring-1 ring-purple-500/40" : ""
        }`}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              Desktop App
            </CardTitle>
            {hasDesktopElements && (
              <Badge variant="success" className="text-[10px] gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {desktop.elements.length} elements
              </Badge>
            )}
          </div>
          <CardDescription className="text-text-muted text-xs">
            Inspect Runner&apos;s own UI elements
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={desktop.discover}
            disabled={desktop.isDiscovering}
            size="sm"
            variant="outline"
          >
            {desktop.isDiscovering ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            Discover Elements
          </Button>

          {desktop.error && (
            <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <p className="text-xs">{desktop.error}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
