"use client";

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Loader2,
  Wifi,
  WifiOff,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { runnerApi } from "@/lib/runner-api";
import {
  buildSemanticSpecPrompt,
  type DiscoveredSpec,
  type SpecGroup,
} from "@/lib/spec-prompt-builder";
import {
  parseDiscoveredSpecs,
  unwrapSpecResponse,
} from "@/lib/ui-bridge/spec-parser";
import { useAppBrowser } from "@/hooks/useAppBrowser";
import { getAllSemanticSpecs } from "@/lib/semantic-spec-registry";

// =============================================================================
// Types
// =============================================================================

export interface SpecSourceState {
  discoveredSpecs: DiscoveredSpec[];
  selectedGroupIds: Set<string>;
}

export interface SpecSourceSectionProps {
  onSpecsChanged: (state: SpecSourceState) => void;
}

// localStorage key
const STORAGE_KEY = "ai-generate-spec-source";
// Bump this when bundled specs change to auto-select new groups
const BUNDLED_SPEC_VERSION = 2;

interface PersistedSpecState {
  sdkUrl: string;
  discoveredSpecs: DiscoveredSpec[];
  selectedGroupIds: string[];
  bundledSpecVersion?: number;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Filter specs to only keep groups where category === "semantic".
 * Removes specs that end up with no semantic groups.
 */
function filterSemanticGroups(specs: DiscoveredSpec[]): DiscoveredSpec[] {
  const filtered: DiscoveredSpec[] = [];
  for (const spec of specs) {
    const semanticGroups = (spec.config?.groups ?? []).filter(
      (g) => g.category === "semantic"
    );
    if (semanticGroups.length > 0) {
      filtered.push({
        ...spec,
        config: {
          ...spec.config,
          groups: semanticGroups,
        },
      });
    }
  }
  return filtered;
}

// =============================================================================
// Component
// =============================================================================

export function SpecSourceSection({ onSpecsChanged }: SpecSourceSectionProps) {
  const onSpecsChangedRef = useRef(onSpecsChanged);
  onSpecsChangedRef.current = onSpecsChanged;

  const [isOpen, setIsOpen] = useState(false);

  // App browser hook for connection (auto-scan + auto-connect)
  const browser = useAppBrowser();

  // Spec discovery state
  const [discoveredSpecs, setDiscoveredSpecs] = useState<DiscoveredSpec[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set()
  );
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Manual URL connection
  const [manualUrl, setManualUrl] = useState("");
  const [showManualConnect, setShowManualConnect] = useState(false);

  // Load bundled semantic specs on mount, overlay persisted selection state
  useEffect(() => {
    // Start with all bundled semantic specs
    const bundled = getAllSemanticSpecs();
    const specMap = new Map(bundled.map((s) => [s.specId, s]));

    // Merge any additional specs from localStorage (e.g. from external apps)
    let persistedSelectedIds: string[] | null = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: PersistedSpecState = JSON.parse(stored);
        persistedSelectedIds = parsed.selectedGroupIds ?? null;
        if (parsed.discoveredSpecs?.length > 0) {
          const filtered = filterSemanticGroups(parsed.discoveredSpecs);
          for (const spec of filtered) {
            if (!specMap.has(spec.specId)) {
              specMap.set(spec.specId, spec);
            }
          }
        }
      }
    } catch {
      // Ignore parse errors
    }

    const allSpecs = Array.from(specMap.values());

    // Build selected IDs
    const selectedIds = new Set<string>();

    // Check if bundled specs version changed — if so, select all (fresh start)
    let storedVersion = 0;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        storedVersion = JSON.parse(stored).bundledSpecVersion ?? 0;
      }
    } catch {
      // ignore
    }

    const versionChanged = storedVersion !== BUNDLED_SPEC_VERSION;

    if (versionChanged || persistedSelectedIds === null) {
      // New version or first time: select all groups
      for (const spec of allSpecs) {
        for (const group of spec.config?.groups ?? []) {
          selectedIds.add(group.id);
        }
      }
    } else {
      // Same version: respect persisted selection
      const persistedSet = new Set(persistedSelectedIds);
      for (const spec of allSpecs) {
        for (const group of spec.config?.groups ?? []) {
          if (persistedSet.has(group.id)) {
            selectedIds.add(group.id);
          }
        }
      }
    }

    setDiscoveredSpecs(allSpecs);
    setSelectedGroupIds(selectedIds);
    if (allSpecs.length > 0) {
      setIsOpen(true);
    }
    onSpecsChangedRef.current({
      discoveredSpecs: allSpecs,
      selectedGroupIds: selectedIds,
    });
  }, []);

  // Persist state changes
  useEffect(() => {
    const toSave: PersistedSpecState = {
      sdkUrl: browser.activeConnection?.url ?? "",
      discoveredSpecs,
      selectedGroupIds: Array.from(selectedGroupIds),
      bundledSpecVersion: BUNDLED_SPEC_VERSION,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [browser.activeConnection?.url, discoveredSpecs, selectedGroupIds]);

  // Notify parent when selection changes
  const updateSelection = useCallback(
    (specs: DiscoveredSpec[], ids: Set<string>) => {
      setDiscoveredSpecs(specs);
      setSelectedGroupIds(ids);
      onSpecsChanged({ discoveredSpecs: specs, selectedGroupIds: ids });
    },
    [onSpecsChanged]
  );

  // Merge new specs helper
  const mergeSpecs = useCallback(
    (newSpecs: DiscoveredSpec[]) => {
      const existingMap = new Map(discoveredSpecs.map((s) => [s.specId, s]));
      for (const spec of newSpecs) {
        existingMap.set(spec.specId, spec);
      }
      const merged = Array.from(existingMap.values());

      const newIds = new Set(selectedGroupIds);
      for (const spec of newSpecs) {
        for (const group of spec.config?.groups ?? []) {
          newIds.add(group.id);
        }
      }

      updateSelection(merged, newIds);
    },
    [discoveredSpecs, selectedGroupIds, updateSelection]
  );

  // Discover semantic specs from the connected page
  const handleDiscoverSpecs = useCallback(async () => {
    if (!browser.isConnected) return;
    setIsDiscovering(true);
    try {
      const res = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
      const rawSpecs = unwrapSpecResponse(res);
      const allSpecs = parseDiscoveredSpecs(rawSpecs);
      const semanticSpecs = filterSemanticGroups(allSpecs);
      if (semanticSpecs.length === 0) return;
      mergeSpecs(semanticSpecs);
    } catch {
      // Discovery failed
    } finally {
      setIsDiscovering(false);
    }
  }, [browser.isConnected, mergeSpecs]);

  // Manual connect
  const handleManualConnect = useCallback(async () => {
    const url = manualUrl.trim();
    if (!url) return;
    await browser.connect(url);
    setManualUrl("");
    setShowManualConnect(false);
  }, [manualUrl, browser]);

  // Clear all accumulated specs
  const handleClearAll = useCallback(() => {
    updateSelection([], new Set());
  }, [updateSelection]);

  // Toggle a spec group
  const toggleGroup = useCallback(
    (groupId: string) => {
      const next = new Set(selectedGroupIds);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      setSelectedGroupIds(next);
      onSpecsChanged({ discoveredSpecs, selectedGroupIds: next });
    },
    [selectedGroupIds, discoveredSpecs, onSpecsChanged]
  );

  // Select all / none
  const handleSelectAll = useCallback(() => {
    const allIds = new Set<string>();
    for (const spec of discoveredSpecs) {
      for (const group of spec.config?.groups ?? []) {
        allIds.add(group.id);
      }
    }
    setSelectedGroupIds(allIds);
    onSpecsChanged({ discoveredSpecs, selectedGroupIds: allIds });
  }, [discoveredSpecs, onSpecsChanged]);

  const handleSelectNone = useCallback(() => {
    const empty = new Set<string>();
    setSelectedGroupIds(empty);
    onSpecsChanged({ discoveredSpecs, selectedGroupIds: empty });
  }, [discoveredSpecs, onSpecsChanged]);

  // Compute summary badge
  const totalGroups = discoveredSpecs.reduce(
    (sum, s) => sum + (s.config?.groups?.length ?? 0),
    0
  );
  const selectedCount = selectedGroupIds.size;

  // Group specs by page URL for display
  const specsByPage = new Map<
    string,
    { spec: DiscoveredSpec; groups: SpecGroup[] }
  >();
  for (const spec of discoveredSpecs) {
    const pageUrl = spec.config?.metadata?.pageUrl || spec.specId;
    if (!specsByPage.has(pageUrl)) {
      specsByPage.set(pageUrl, { spec, groups: [] });
    }
    const entry = specsByPage.get(pageUrl)!;
    for (const group of spec.config?.groups ?? []) {
      entry.groups.push(group);
    }
  }

  // Prompt preview
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const promptPreview = useMemo(() => {
    if (selectedCount === 0) return null;
    return buildSemanticSpecPrompt({ discoveredSpecs, selectedGroupIds });
  }, [discoveredSpecs, selectedGroupIds, selectedCount]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
        {isOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <ShieldCheck className="w-4 h-4" />
        Page Specs
        {selectedCount > 0 && (
          <Badge variant="secondary" className="text-xs ml-1">
            {selectedCount} group{selectedCount !== 1 ? "s" : ""}
          </Badge>
        )}
        {browser.isConnected && (
          <span className="flex items-center gap-1 text-xs text-green-400 ml-auto">
            <Wifi className="w-3 h-3" />
            {browser.connectedAppName}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-3">
        {/* Minimal Connection Bar */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
          {browser.isConnected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-sm text-zinc-300">
                  {browser.connectedAppName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleDiscoverSpecs}
                  disabled={isDiscovering}
                >
                  {isDiscovering ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3 h-3 mr-1" />
                  )}
                  {isDiscovering ? "Discovering..." : "Discover Page Specs"}
                </Button>
                <button
                  onClick={() => browser.disconnect()}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Disconnect
                </button>
              </div>
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
                  {/* Auto-detected apps */}
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
                        onClick={() => setShowManualConnect((v) => !v)}
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
                        onClick={() => setShowManualConnect((v) => !v)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 ml-auto"
                      >
                        Connect manually
                      </button>
                    </div>
                  )}

                  {/* Manual URL input */}
                  {showManualConnect && (
                    <div className="flex gap-2">
                      <Input
                        className="bg-zinc-900 border-zinc-700 text-zinc-200 text-xs h-7 flex-1"
                        placeholder="http://localhost:3001"
                        value={manualUrl}
                        onChange={(e) => setManualUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleManualConnect();
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleManualConnect}
                        disabled={!manualUrl.trim()}
                      >
                        Connect
                      </Button>
                    </div>
                  )}
                </>
              )}

              {browser.connectionError && (
                <p className="text-xs text-red-400">
                  {browser.connectionError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Semantic Spec Group List */}
        {discoveredSpecs.length > 0 && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
            {/* Header with select all/none/clear */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Semantic Specs ({selectedCount}/{totalGroups})
              </span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={handleSelectAll}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  All
                </button>
                <span className="text-zinc-600">/</span>
                <button
                  onClick={handleSelectNone}
                  className="text-zinc-500 hover:text-zinc-200"
                >
                  None
                </button>
                <span className="text-zinc-700">|</span>
                <button
                  onClick={handleClearAll}
                  className="text-zinc-500 hover:text-red-400 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All
                </button>
              </div>
            </div>

            {/* Groups grouped by page URL */}
            <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
              {Array.from(specsByPage.entries()).map(
                ([pageUrl, { groups }]) => (
                  <div key={pageUrl}>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                      {pageUrl}
                    </p>
                    {groups.map((group) => {
                      const slugId = pageUrl
                        .replace(/^\//, "")
                        .replace(/\//g, "-");
                      return (
                        <label
                          key={group.id}
                          data-ui-id={`spec-group-${slugId}`}
                          data-ui-label={`${pageUrl}: ${(group.description || group.name).slice(0, 60)}`}
                          className="flex items-start gap-2 p-1.5 rounded hover:bg-zinc-700/30 cursor-pointer"
                        >
                          <Checkbox
                            data-ui-id={`spec-checkbox-${slugId}`}
                            data-ui-label={`Select ${pageUrl} spec`}
                            checked={selectedGroupIds.has(group.id)}
                            onCheckedChange={() => toggleGroup(group.id)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-sm text-zinc-300 block">
                              {group.description || group.name}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* Prompt Preview */}
            {promptPreview && (
              <div className="border-t border-zinc-700 pt-2">
                <button
                  onClick={() => setShowPromptPreview((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPromptPreview ? (
                    <EyeOff className="w-3 h-3" />
                  ) : (
                    <Eye className="w-3 h-3" />
                  )}
                  {showPromptPreview ? "Hide" : "Preview"} AI prompt
                  <span className="text-zinc-600">
                    ({promptPreview.totalGroups} group
                    {promptPreview.totalGroups !== 1 ? "s" : ""} from{" "}
                    {promptPreview.pageCount} page
                    {promptPreview.pageCount !== 1 ? "s" : ""})
                  </span>
                </button>
                {showPromptPreview && (
                  <pre className="mt-2 max-h-[200px] overflow-auto rounded-md bg-zinc-900 border border-zinc-700 p-3 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap">
                    {promptPreview.prompt}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
