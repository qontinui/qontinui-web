/**
 * SnapshotCapturePanel
 *
 * Shows runner connection status, browser tab selector, and the Capture
 * Snapshot button.  Also provides Compare to Previous for snapshot comparison.
 */

import { Camera, RefreshCw, GitCompare, Wifi, WifiOff, Monitor, ChevronDown } from "lucide-react";
import type { BrowserTab } from "../SnapshotTestGenerator";

interface SnapshotCapturePanelProps {
  isConnected: boolean;
  isCapturing: boolean;
  hasPreviousSnapshot: boolean;
  onCapture: () => void;
  onCompare: () => void;
  runnerUrl: string;
  /** Available browser tabs from the extension */
  browserTabs: BrowserTab[];
  /** Currently selected tab id (null = extension default) */
  selectedTabId: number | null;
  /** Callback when user picks a tab */
  onSelectTab: (tabId: number) => void;
  /** Refresh the tab list */
  onRefreshTabs: () => void;
  isLoadingTabs: boolean;
  /** Error message from last capture attempt */
  captureError?: string | null;
}

export function SnapshotCapturePanel({
  isConnected,
  isCapturing,
  hasPreviousSnapshot,
  onCapture,
  onCompare,
  runnerUrl,
  browserTabs,
  selectedTabId,
  onSelectTab,
  onRefreshTabs,
  isLoadingTabs,
  captureError,
}: SnapshotCapturePanelProps) {
  const selectedTab = browserTabs.find((t) => t.id === selectedTabId);

  return (
    <div className="flex flex-col border-b border-neutral-700 bg-neutral-800/50">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Connection status */}
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-400" />
          )}
          <span className={`text-xs ${isConnected ? "text-emerald-400" : "text-red-400"}`}>
            {isConnected ? "Connected" : "Disconnected"}
          </span>
          <span className="text-xs text-neutral-500 truncate max-w-[200px]">{runnerUrl}</span>
        </div>

        <div className="flex-1" />

        {/* Tab selector */}
        {isConnected && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-neutral-400">
              <Monitor className="w-3.5 h-3.5" />
              Tab:
            </span>
            <div className="relative">
              <select
                value={selectedTabId ?? ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!isNaN(v)) onSelectTab(v);
                }}
                className="appearance-none pl-2 pr-6 py-1 text-xs bg-neutral-900 border border-neutral-600 rounded text-neutral-200 focus:outline-none focus:border-blue-500 max-w-[250px] truncate"
              >
                <option value="" disabled>
                  Select a tab...
                </option>
                {browserTabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.title || tab.url}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400 pointer-events-none" />
            </div>
            <button
              onClick={onRefreshTabs}
              disabled={isLoadingTabs}
              className="p-1 text-neutral-400 hover:text-neutral-200 transition-colors"
              title="Refresh tab list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTabs ? "animate-spin" : ""}`} />
            </button>
          </div>
        )}

        {/* Capture button */}
        <button
          onClick={onCapture}
          disabled={!isConnected || isCapturing}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {isCapturing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
          {isCapturing ? "Capturing..." : "Capture Snapshot"}
        </button>

        {/* Compare button */}
        {hasPreviousSnapshot && (
          <button
            onClick={onCompare}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-neutral-700 text-neutral-300 rounded-md hover:bg-neutral-600 transition-colors"
          >
            <GitCompare className="w-4 h-4" />
            Compare to Previous
          </button>
        )}
      </div>

      {/* Selected tab info / error */}
      {(selectedTab || captureError) && (
        <div className="flex items-center gap-3 px-4 pb-2 text-xs">
          {selectedTab && !captureError && (
            <span className="text-neutral-500 truncate">
              {selectedTab.url}
            </span>
          )}
          {captureError && (
            <span className="text-red-400">{captureError}</span>
          )}
        </div>
      )}
    </div>
  );
}
