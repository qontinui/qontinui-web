"use client";

import { useState } from "react";
import type { UseAppBrowserReturn } from "@/hooks/useAppBrowser";
import type { DiscoveredLink } from "@/lib/ui-bridge/types";
import { PageTreePanel } from "@/components/shared/PageTree";
import { TargetSelector } from "@/components/ui-bridge/TargetSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Plug,
  Unplug,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Network,
  Radio,
  Search,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

export interface AppBrowserProps {
  browser: UseAppBrowserReturn;
  onPageClick?: (url: string, link: DiscoveredLink) => void;
  isBusy?: boolean;
  showSpecStatus?: boolean;
  treeMaxHeight?: string;
  treeTitle?: string;
  connectPlaceholder?: string;
  /** "card" wraps in a Card with border; "flat" renders borderless for embedding inside other containers. */
  variant?: "card" | "flat";
  children?: React.ReactNode;
}

// =============================================================================
// Component
// =============================================================================

export function AppBrowser({
  browser,
  onPageClick,
  isBusy,
  showSpecStatus,
  treeMaxHeight,
  treeTitle,
  connectPlaceholder = "http://localhost:3001",
  variant = "card",
  children,
}: AppBrowserProps) {
  const [connectUrl, setConnectUrl] = useState("");
  const [showConnectInput, setShowConnectInput] = useState(false);

  const handleConnect = () => {
    const url = connectUrl.trim();
    if (url) {
      browser.connect(url);
      setConnectUrl("");
      setShowConnectInput(false);
    }
  };

  const handleAppSelect = (url: string) => {
    if (url) {
      browser.connect(url);
    }
  };

  const content = (
    <div className="space-y-2">
      {/* Scanning indicator */}
      {browser.isScanning && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Scanning for apps...
        </div>
      )}

      {/* Scan result summary (shown briefly after scan completes) */}
      {!browser.isScanning &&
        browser.lastScanCount !== null &&
        browser.connections.length === 0 &&
        browser.availableApps.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Search className="w-3.5 h-3.5" />
            No SDK apps detected.
            <button
              onClick={() => browser.scanForApps()}
              className="text-purple-400 hover:text-purple-300 transition-colors underline underline-offset-2"
            >
              Rescan
            </button>
          </div>
        )}

      {/* Available apps selector (when >1 found and not yet connected) */}
      {!browser.isScanning &&
        browser.availableApps.length > 1 &&
        browser.connections.length === 0 && (
          <div className="space-y-1">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">
              Found {browser.availableApps.length} apps
            </span>
            <div className="space-y-1">
              {browser.availableApps.map((app) => (
                <button
                  key={app.url}
                  onClick={() => handleAppSelect(app.url)}
                  disabled={browser.isConnecting}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-sm bg-surface-raised/30 border border-border-subtle/30 hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors"
                >
                  <Plug className="w-3 h-3 text-text-muted flex-shrink-0" />
                  <span className="text-text-primary truncate">
                    {app.appName}
                  </span>
                  <span className="text-text-muted text-xs ml-auto flex-shrink-0">
                    {app.url}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

      {/* Connection switcher dropdown (when multiple connections exist) */}
      {browser.connections.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={browser.activeConnection?.url ?? ""}
            onChange={(e) => {
              if (e.target.value) {
                browser.switchTo(e.target.value);
              }
            }}
            className="flex-1 h-9 rounded-md border border-border-subtle/50 bg-surface-raised/50 px-3 text-sm text-white focus:border-purple-500/50 focus:outline-none"
          >
            {browser.connections.map((conn) => (
              <option key={conn.url} value={conn.url}>
                {conn.app.appName || conn.url}
                {conn.app.appName ? ` (${conn.url})` : ""}
              </option>
            ))}
          </select>
          {browser.activeConnection && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => browser.disconnect(browser.activeConnection?.url)}
              className="h-9"
            >
              <Unplug className="w-3.5 h-3.5 mr-1.5" />
              Disconnect
            </Button>
          )}
        </div>
      )}

      {/* Connect new app */}
      {showConnectInput || browser.connections.length === 0 ? (
        <div className="flex items-center gap-2">
          <Input
            placeholder={connectPlaceholder}
            value={connectUrl}
            onChange={(e) => setConnectUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            className="flex-1 h-8 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted text-sm"
          />
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={browser.isConnecting || !connectUrl.trim()}
            className="h-8"
          >
            {browser.isConnecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plug className="w-3.5 h-3.5 mr-1.5" />
            )}
            {browser.isConnecting ? "" : "Connect"}
          </Button>
          {browser.connections.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowConnectInput(false)}
              className="h-8 px-2"
            >
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowConnectInput(true)}
          className="h-8"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Connect New App
        </Button>
      )}

      {/* Error display */}
      {browser.connectionError && (
        <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <p className="text-xs">{browser.connectionError}</p>
        </div>
      )}

      {/* Target selector (when connected and multiple tabs) */}
      {browser.isConnected && browser.targets.length > 1 && (
        <TargetSelector
          targets={browser.targets}
          selectedTargetId={browser.selectedTargetId}
          onTargetChange={browser.setSelectedTargetId}
          onRefresh={browser.refreshTargets}
          isLoading={browser.isLoadingTargets}
        />
      )}

      {/* Custom content slot (e.g., Discover Specs button, Discover All Pages) */}
      {children}

      {/* Discover Pages button */}
      {browser.isConnected && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs"
          onClick={browser.discoverPages}
          disabled={browser.isDiscoveringPages || isBusy}
        >
          {browser.isDiscoveringPages ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <Network className="w-3.5 h-3.5 mr-1" />
          )}
          {browser.isDiscoveringPages
            ? "Discovering Pages..."
            : "Discover Pages"}
        </Button>
      )}

      {/* Page Tree */}
      {browser.discoveredLinks.length > 0 && (
        <PageTreePanel
          discoveredLinks={browser.discoveredLinks}
          onPageClick={onPageClick}
          isBusy={isBusy}
          pageStatus={browser.pageStatus}
          showSpecStatus={showSpecStatus}
          title={treeTitle}
          maxHeight={treeMaxHeight || "400px"}
        />
      )}
    </div>
  );

  if (variant === "flat") {
    return content;
  }

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Radio className="w-3.5 h-3.5" />
            App Browser
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => browser.scanForApps()}
              disabled={browser.isScanning}
              className="text-text-muted hover:text-white h-7 px-2"
              title="Rescan for apps"
            >
              <RefreshCw
                className={`w-3 h-3 ${browser.isScanning ? "animate-spin" : ""}`}
              />
            </Button>
            {browser.isConnected && (
              <Badge variant="success" className="text-[10px] gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {browser.connectedAppName || "Connected"}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3">{content}</CardContent>
    </Card>
  );
}
