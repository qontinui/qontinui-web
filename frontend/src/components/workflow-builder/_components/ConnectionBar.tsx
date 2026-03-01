import React from "react";
import { Loader2, WifiOff, ShieldCheck, Globe, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UseAppBrowserReturn } from "@/hooks/useAppBrowser";

interface ConnectionBarProps {
  browser: UseAppBrowserReturn;
  isDiscovering: boolean;
  isCrawling: boolean;
  crawlProgress: string | null;
  manualUrl: string;
  setManualUrl: (url: string) => void;
  showManualConnect: boolean;
  setShowManualConnect: (show: boolean | ((v: boolean) => boolean)) => void;
  onDiscoverSpecs: () => void;
  onDiscoverAllPages: () => void;
  onManualConnect: () => void;
}

export function ConnectionBar({
  browser,
  isDiscovering,
  isCrawling,
  crawlProgress,
  manualUrl,
  setManualUrl,
  showManualConnect,
  setShowManualConnect,
  onDiscoverSpecs,
  onDiscoverAllPages,
  onManualConnect,
}: ConnectionBarProps) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
      {browser.isConnected ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-sm text-zinc-300">
                {browser.connectedAppName}
              </span>
            </div>
            <button
              onClick={() => browser.disconnect()}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Disconnect
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onDiscoverSpecs}
              disabled={isDiscovering || isCrawling}
            >
              {isDiscovering ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <ShieldCheck className="w-3 h-3 mr-1" />
              )}
              {isDiscovering ? "Discovering..." : "Discover Page Specs"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onDiscoverAllPages}
              disabled={isDiscovering || isCrawling}
            >
              {isCrawling ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Globe className="w-3 h-3 mr-1" />
              )}
              {isCrawling ? "Crawling..." : "Discover All Pages"}
            </Button>
          </div>
          {crawlProgress && (
            <p className="text-[11px] text-zinc-500">{crawlProgress}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {browser.isScanning ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Scanning for apps...
            </div>
          ) : browser.isConnecting ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Connecting...
            </div>
          ) : (
            <>
              {browser.availableApps.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <WifiOff className="w-3.5 h-3.5 text-zinc-500" />
                  {browser.availableApps.map((app) => (
                    <Button
                      key={app.url}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => browser.connect(app.url)}
                    >
                      {app.appName || app.url}
                    </Button>
                  ))}
                  <button
                    onClick={() => setShowManualConnect((v: boolean) => !v)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto"
                  >
                    Manual
                  </button>
                  <button
                    onClick={() => browser.scanForApps()}
                    className="text-zinc-500 hover:text-zinc-300"
                    title="Rescan"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <WifiOff className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-xs text-zinc-500">
                    No SDK apps detected.
                  </span>
                  <button
                    onClick={() => browser.scanForApps()}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Rescan
                  </button>
                  <button
                    onClick={() => setShowManualConnect((v: boolean) => !v)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto"
                  >
                    Connect manually
                  </button>
                </div>
              )}

              {showManualConnect && (
                <div className="flex gap-2">
                  <Input
                    className="bg-zinc-900 border-zinc-700 text-zinc-200 text-xs h-7 flex-1"
                    placeholder="http://localhost:3001"
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onManualConnect();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={onManualConnect}
                    disabled={!manualUrl.trim()}
                  >
                    Connect
                  </Button>
                </div>
              )}
            </>
          )}

          {browser.connectionError && (
            <p className="text-xs text-red-400">{browser.connectionError}</p>
          )}
        </div>
      )}
    </div>
  );
}
