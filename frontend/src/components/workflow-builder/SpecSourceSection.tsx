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
  Plug,
  PlugZap,
  Loader2,
  AlertCircle,
  Wifi,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { runnerApi } from "@/lib/runner-api";
import {
  buildSpecPrompt,
  type DiscoveredSpec,
  type SpecGroup,
  type SpecAssertion,
  type SpecConfig,
} from "@/lib/spec-prompt-builder";

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

interface PersistedSpecState {
  sdkUrl: string;
  discoveredSpecs: DiscoveredSpec[];
  selectedGroupIds: string[];
}

// =============================================================================
// Runtime parser for discover response
// =============================================================================

function parseAssertion(raw: Record<string, unknown>): SpecAssertion | null {
  if (typeof raw.id !== "string" || typeof raw.description !== "string") {
    return null;
  }
  return {
    id: raw.id,
    description: raw.description,
    category: typeof raw.category === "string" ? raw.category : "unknown",
    severity:
      raw.severity === "critical" ||
      raw.severity === "warning" ||
      raw.severity === "info"
        ? raw.severity
        : "info",
    enabled: raw.enabled !== false,
    target: raw.target as Record<string, unknown> | undefined,
    assertionType:
      typeof raw.assertionType === "string" ? raw.assertionType : undefined,
    condition: raw.condition as Record<string, unknown> | undefined,
  };
}

function parseGroup(raw: Record<string, unknown>): SpecGroup | null {
  if (typeof raw.id !== "string" || typeof raw.name !== "string") {
    return null;
  }
  const rawAssertions = Array.isArray(raw.assertions) ? raw.assertions : [];
  const assertions = rawAssertions
    .map((a: unknown) => parseAssertion(a as Record<string, unknown>))
    .filter((a): a is SpecAssertion => a !== null);
  return {
    id: raw.id,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    category: typeof raw.category === "string" ? raw.category : "unknown",
    assertions,
    source: typeof raw.source === "string" ? raw.source : undefined,
  };
}

function parseDiscoveredSpecs(rawSpecs: unknown): DiscoveredSpec[] {
  if (!Array.isArray(rawSpecs)) return [];
  const results: DiscoveredSpec[] = [];
  for (const raw of rawSpecs) {
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.specId !== "string") continue;
    const rawConfig = obj.config as Record<string, unknown> | undefined;
    if (!rawConfig) continue;
    const rawGroups = Array.isArray(rawConfig.groups) ? rawConfig.groups : [];
    const groups = rawGroups
      .map((g: unknown) => parseGroup(g as Record<string, unknown>))
      .filter((g): g is SpecGroup => g !== null);
    const config: SpecConfig = {
      version:
        typeof rawConfig.version === "string" ? rawConfig.version : "1.0.0",
      description:
        typeof rawConfig.description === "string" ? rawConfig.description : "",
      groups,
      metadata: rawConfig.metadata as SpecConfig["metadata"],
    };
    results.push({ specId: obj.specId, config });
  }
  return results;
}

// =============================================================================
// Component
// =============================================================================

export function SpecSourceSection({ onSpecsChanged }: SpecSourceSectionProps) {
  const onSpecsChangedRef = useRef(onSpecsChanged);
  onSpecsChangedRef.current = onSpecsChanged;

  const [isOpen, setIsOpen] = useState(false);

  // Connection state
  const [sdkUrl, setSdkUrl] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedAppName, setConnectedAppName] = useState("");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Spec discovery state
  const [discoveredSpecs, setDiscoveredSpecs] = useState<DiscoveredSpec[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set()
  );
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Restore persisted state on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: PersistedSpecState = JSON.parse(stored);
        if (parsed.sdkUrl) setSdkUrl(parsed.sdkUrl);
        if (parsed.discoveredSpecs?.length > 0) {
          setDiscoveredSpecs(parsed.discoveredSpecs);
          const ids = new Set(parsed.selectedGroupIds || []);
          setSelectedGroupIds(ids);
          setIsOpen(true);
          onSpecsChangedRef.current({
            discoveredSpecs: parsed.discoveredSpecs,
            selectedGroupIds: ids,
          });
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Persist state changes
  useEffect(() => {
    const toSave: PersistedSpecState = {
      sdkUrl,
      discoveredSpecs,
      selectedGroupIds: Array.from(selectedGroupIds),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [sdkUrl, discoveredSpecs, selectedGroupIds]);

  useEffect(() => {
    runnerApi
      .uiBridgeStatus()
      .then((res) => {
        if (res.data?.connected) {
          setIsConnected(true);
          setConnectedAppName(res.data.app?.app_name || "SDK App");
          if (res.data.url) setSdkUrl((prev) => prev || res.data.url || "");
        }
      })
      .catch(() => {
        // Runner not available, ignore
      });
  }, []);

  // Notify parent when selection changes
  const updateSelection = useCallback(
    (specs: DiscoveredSpec[], ids: Set<string>) => {
      setDiscoveredSpecs(specs);
      setSelectedGroupIds(ids);
      onSpecsChanged({ discoveredSpecs: specs, selectedGroupIds: ids });
    },
    [onSpecsChanged]
  );

  // Connect to SDK app
  const handleConnect = useCallback(async () => {
    if (!sdkUrl.trim()) return;
    setIsConnecting(true);
    setConnectionError(null);
    try {
      await runnerApi.uiBridgeConnect({ url: sdkUrl.trim() });
      const status = await runnerApi.uiBridgeStatus();
      if (status.data?.connected) {
        setIsConnected(true);
        setConnectedAppName(status.data.app?.app_name || "SDK App");
      } else {
        throw new Error("Connection failed");
      }
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Failed to connect"
      );
    } finally {
      setIsConnecting(false);
    }
  }, [sdkUrl]);

  // Disconnect
  const handleDisconnect = useCallback(async () => {
    try {
      await runnerApi.uiBridgeDisconnect();
    } catch {
      // Ignore
    }
    setIsConnected(false);
    setConnectedAppName("");
    setConnectionError(null);
  }, []);

  // Discover specs from the connected page
  const handleDiscoverSpecs = useCallback(async () => {
    if (!isConnected) return;
    setIsDiscovering(true);
    try {
      const res = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
      if (!res.success && res.error) {
        throw new Error(res.error);
      }
      const newSpecs = parseDiscoveredSpecs(res.data?.specs);
      if (newSpecs.length === 0) {
        setConnectionError("No specs found on the current page");
        return;
      }

      // Accumulate: merge new specs with existing, replacing duplicates by specId
      const existingMap = new Map(discoveredSpecs.map((s) => [s.specId, s]));
      for (const spec of newSpecs) {
        existingMap.set(spec.specId, spec);
      }
      const merged = Array.from(existingMap.values());

      // Auto-select all groups from newly discovered specs
      const newIds = new Set(selectedGroupIds);
      for (const spec of newSpecs) {
        for (const group of spec.config?.groups ?? []) {
          newIds.add(group.id);
        }
      }

      updateSelection(merged, newIds);
      setConnectionError(null);
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Failed to discover specs"
      );
    } finally {
      setIsDiscovering(false);
    }
  }, [isConnected, discoveredSpecs, selectedGroupIds, updateSelection]);

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
  const totalAssertions = discoveredSpecs.reduce((sum, s) => {
    for (const g of s.config?.groups ?? []) {
      if (selectedGroupIds.has(g.id)) {
        sum += g.assertions.filter((a) => a.enabled).length;
      }
    }
    return sum;
  }, 0);

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
    return buildSpecPrompt({ discoveredSpecs, selectedGroupIds });
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
            {selectedCount} group{selectedCount !== 1 ? "s" : ""},{" "}
            {totalAssertions} assertion{totalAssertions !== 1 ? "s" : ""}
          </Badge>
        )}
        {isConnected && (
          <span className="flex items-center gap-1 text-xs text-green-400 ml-auto">
            <Wifi className="w-3 h-3" />
            {connectedAppName}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-3">
        {/* SDK Connection Bar */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm h-8 flex-1"
              placeholder="http://localhost:3001"
              value={sdkUrl}
              onChange={(e) => setSdkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isConnected) handleConnect();
              }}
              disabled={isConnected}
            />
            {isConnected ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                onClick={handleDisconnect}
              >
                <PlugZap className="w-3.5 h-3.5 mr-1" />
                Disconnect
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleConnect}
                disabled={isConnecting || !sdkUrl.trim()}
              >
                {isConnecting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Plug className="w-3.5 h-3.5 mr-1" />
                )}
                {isConnecting ? "Connecting..." : "Connect"}
              </Button>
            )}
          </div>

          {connectionError && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {connectionError}
            </div>
          )}

          {/* Discover Specs button */}
          {isConnected && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={handleDiscoverSpecs}
              disabled={isDiscovering}
            >
              {isDiscovering ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 mr-1" />
              )}
              {isDiscovering ? "Discovering..." : "Discover Specs"}
            </Button>
          )}

          {!isConnected && !connectionError && (
            <p className="text-xs text-zinc-500">
              Connect to an SDK-integrated app, navigate to a page with specs,
              then click Discover Specs.
            </p>
          )}
        </div>

        {/* Spec Group List */}
        {discoveredSpecs.length > 0 && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
            {/* Header with select all/none/clear */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Spec Groups ({selectedCount}/{totalGroups})
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
                    {groups.map((group) => (
                      <label
                        key={group.id}
                        className="flex items-start gap-2 p-1.5 rounded hover:bg-zinc-700/30 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedGroupIds.has(group.id)}
                          onCheckedChange={() => toggleGroup(group.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm text-zinc-300 block truncate">
                            {group.name}
                          </span>
                          {group.description && (
                            <span className="text-[10px] text-zinc-500 block truncate">
                              {group.description}
                            </span>
                          )}
                          <span className="text-[10px] text-zinc-500">
                            {group.assertions.filter((a) => a.enabled).length}{" "}
                            assertion
                            {group.assertions.filter((a) => a.enabled)
                              .length !== 1
                              ? "s"
                              : ""}
                            {" · "}
                            {group.category}
                          </span>
                        </div>
                      </label>
                    ))}
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
                    {promptPreview.totalGroups !== 1 ? "s" : ""},{" "}
                    {promptPreview.totalAssertions} assertion
                    {promptPreview.totalAssertions !== 1 ? "s" : ""} from{" "}
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
