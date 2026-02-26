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
  Globe,
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
  buildSpecPrompt,
  type DiscoveredSpec,
  type SpecGroup,
} from "@/lib/spec-prompt-builder";
import {
  parseDiscoveredSpecs,
  unwrapSpecResponse,
} from "@/lib/ui-bridge/spec-parser";
import { useAppBrowser } from "@/hooks/useAppBrowser";
import { getAllSpecs } from "@/lib/spec-registry";

// =============================================================================
// Types
// =============================================================================

export interface DiscoveredPage {
  url: string;
  title: string;
}

export interface SpecSourceState {
  discoveredSpecs: DiscoveredSpec[];
  selectedGroupIds: Set<string>;
  discoveredPages: DiscoveredPage[];
  selectedPageUrls: Set<string>;
}

export interface SpecSourceSectionProps {
  onSpecsChanged: (state: SpecSourceState) => void;
}

// localStorage key
const STORAGE_KEY = "ai-generate-spec-source";
// Bump this when bundled specs change to auto-select new groups
const BUNDLED_SPEC_VERSION = 3;

interface PersistedSpecState {
  sdkUrl: string;
  discoveredSpecs: DiscoveredSpec[];
  selectedGroupIds: string[];
  bundledSpecVersion?: number;
  discoveredPages?: DiscoveredPage[];
  selectedPageUrls?: string[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Pass through all specs that have at least one group.
 * No longer filters by category — the UI selection handles filtering.
 */
function filterSelectedGroups(specs: DiscoveredSpec[]): DiscoveredSpec[] {
  return specs.filter((spec) => (spec.config?.groups ?? []).length > 0);
}

/** Get the page URL for a spec */
function getSpecPageUrl(spec: DiscoveredSpec): string {
  return spec.config?.metadata?.pageUrl || spec.specId;
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

  // Multi-page discovery state
  const [discoveredPages, setDiscoveredPages] = useState<DiscoveredPage[]>([]);
  const [selectedPageUrls, setSelectedPageUrls] = useState<Set<string>>(
    new Set()
  );
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState<string | null>(null);

  // Collapsed page URLs for hierarchical display
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set());

  // Manual URL connection
  const [manualUrl, setManualUrl] = useState("");
  const [showManualConnect, setShowManualConnect] = useState(false);

  // Build full state for parent notifications
  const buildState = useCallback(
    (
      specs: DiscoveredSpec[],
      groupIds: Set<string>,
      pages: DiscoveredPage[],
      pageUrls: Set<string>
    ): SpecSourceState => ({
      discoveredSpecs: specs,
      selectedGroupIds: groupIds,
      discoveredPages: pages,
      selectedPageUrls: pageUrls,
    }),
    []
  );

  // Load bundled semantic specs on mount, overlay persisted selection state
  useEffect(() => {
    // Start with all bundled semantic specs
    const bundled = getAllSpecs();
    const specMap = new Map(bundled.map((s) => [s.specId, s]));

    // Merge any additional specs from localStorage (e.g. from external apps)
    let persistedSelectedIds: string[] | null = null;
    let persistedPages: DiscoveredPage[] = [];
    let persistedPageUrls: string[] = [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: PersistedSpecState = JSON.parse(stored);
        persistedSelectedIds = parsed.selectedGroupIds ?? null;
        persistedPages = parsed.discoveredPages ?? [];
        persistedPageUrls = parsed.selectedPageUrls ?? [];
        if (parsed.discoveredSpecs?.length > 0) {
          const filtered = filterSelectedGroups(parsed.discoveredSpecs);
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

    // Check if bundled specs version changed
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
      for (const spec of allSpecs) {
        for (const group of spec.config?.groups ?? []) {
          selectedIds.add(group.id);
        }
      }
    } else {
      const persistedSet = new Set(persistedSelectedIds);
      for (const spec of allSpecs) {
        for (const group of spec.config?.groups ?? []) {
          if (persistedSet.has(group.id)) {
            selectedIds.add(group.id);
          }
        }
      }
    }

    const pages = persistedPages;
    const pageUrls = new Set(persistedPageUrls);

    setDiscoveredSpecs(allSpecs);
    setSelectedGroupIds(selectedIds);
    setDiscoveredPages(pages);
    setSelectedPageUrls(pageUrls);
    if (allSpecs.length > 0) {
      setIsOpen(true);
    }
    onSpecsChangedRef.current(
      buildState(allSpecs, selectedIds, pages, pageUrls)
    );
  }, [buildState]);

  // Persist state changes
  useEffect(() => {
    const toSave: PersistedSpecState = {
      sdkUrl: browser.activeConnection?.url ?? "",
      discoveredSpecs,
      selectedGroupIds: Array.from(selectedGroupIds),
      bundledSpecVersion: BUNDLED_SPEC_VERSION,
      discoveredPages,
      selectedPageUrls: Array.from(selectedPageUrls),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [
    browser.activeConnection?.url,
    discoveredSpecs,
    selectedGroupIds,
    discoveredPages,
    selectedPageUrls,
  ]);

  // Notify parent when selection changes
  const notifyParent = useCallback(
    (
      specs: DiscoveredSpec[],
      groupIds: Set<string>,
      pages?: DiscoveredPage[],
      pageUrls?: Set<string>
    ) => {
      onSpecsChanged(
        buildState(
          specs,
          groupIds,
          pages ?? discoveredPages,
          pageUrls ?? selectedPageUrls
        )
      );
    },
    [onSpecsChanged, buildState, discoveredPages, selectedPageUrls]
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

      setDiscoveredSpecs(merged);
      setSelectedGroupIds(newIds);
      notifyParent(merged, newIds);
    },
    [discoveredSpecs, selectedGroupIds, notifyParent]
  );

  // Discover semantic specs from the connected page
  const handleDiscoverSpecs = useCallback(async () => {
    if (!browser.isConnected) return;
    setIsDiscovering(true);
    try {
      const res = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
      const rawSpecs = unwrapSpecResponse(res);
      const allSpecs = parseDiscoveredSpecs(rawSpecs);
      const semanticSpecs = filterSelectedGroups(allSpecs);
      if (semanticSpecs.length === 0) return;
      mergeSpecs(semanticSpecs);
    } catch {
      // Discovery failed
    } finally {
      setIsDiscovering(false);
    }
  }, [browser.isConnected, mergeSpecs]);

  // Discover all pages via crawl, then get specs for each
  const handleDiscoverAllPages = useCallback(async () => {
    if (!browser.isConnected) return;
    setIsCrawling(true);
    setCrawlProgress("Discovering links...");
    try {
      // Step 1: Discover navigable links from the current page
      const linkRes = await runnerApi.uiBridgeDiscover({
        interactive_only: false,
      });
      const rawElements =
        (linkRes as Record<string, unknown>)?.elements ??
        ((linkRes as Record<string, unknown>)?.data as Record<string, unknown>)
          ?.elements ??
        [];

      // Extract link URLs
      const links: string[] = [];
      const seen = new Set<string>();
      const connUrl = browser.activeConnection?.url ?? "";
      const origin = connUrl ? new URL(connUrl).origin : "";

      for (const el of rawElements as Array<Record<string, unknown>>) {
        const attrs = el.attributes as Record<string, unknown> | undefined;
        const href = (attrs?.href as string) || (el.href as string);
        if (
          typeof href === "string" &&
          href.startsWith("/") &&
          !seen.has(href)
        ) {
          seen.add(href);
          links.push(origin ? `${origin}${href}` : href);
        }
      }

      if (links.length === 0) {
        setCrawlProgress("No links found on current page.");
        setTimeout(() => setCrawlProgress(null), 2000);
        return;
      }

      // Step 2: Crawl each page for specs
      const pages: DiscoveredPage[] = [];
      const newSpecs: DiscoveredSpec[] = [];
      const newPageUrls = new Set<string>();

      for (let i = 0; i < links.length; i++) {
        const url = links[i]!;
        const pathname = new URL(url).pathname;
        setCrawlProgress(`Crawling ${pathname} (${i + 1}/${links.length})...`);

        try {
          await runnerApi.uiBridgePageNavigate(url);
          await new Promise((resolve) => setTimeout(resolve, 2500));

          const specRes = await runnerApi.uiBridgeDiscover({
            action: "getSpecs",
          });
          const rawSpecs = unwrapSpecResponse(specRes);
          const specs = parseDiscoveredSpecs(rawSpecs);
          const semanticSpecs = filterSelectedGroups(specs);

          pages.push({ url: pathname, title: pathname });
          newPageUrls.add(pathname);

          if (semanticSpecs.length > 0) {
            newSpecs.push(...semanticSpecs);
          }
        } catch {
          pages.push({ url: pathname, title: pathname });
          newPageUrls.add(pathname);
        }
      }

      setDiscoveredPages(pages);
      setSelectedPageUrls(newPageUrls);

      if (newSpecs.length > 0) {
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

        setDiscoveredSpecs(merged);
        setSelectedGroupIds(newIds);
        notifyParent(merged, newIds, pages, newPageUrls);
      } else {
        notifyParent(discoveredSpecs, selectedGroupIds, pages, newPageUrls);
      }

      setIsOpen(true);
      setCrawlProgress(
        `Done! Found specs on ${newSpecs.length > 0 ? pages.length : 0} pages.`
      );
      setTimeout(() => setCrawlProgress(null), 3000);
    } catch {
      setCrawlProgress("Crawl failed.");
      setTimeout(() => setCrawlProgress(null), 2000);
    } finally {
      setIsCrawling(false);
    }
  }, [
    browser.isConnected,
    browser.activeConnection?.url,
    discoveredSpecs,
    selectedGroupIds,
    notifyParent,
  ]);

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
    setDiscoveredSpecs([]);
    setSelectedGroupIds(new Set());
    setDiscoveredPages([]);
    setSelectedPageUrls(new Set());
    notifyParent([], new Set(), [], new Set());
  }, [notifyParent]);

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
      notifyParent(discoveredSpecs, next);
    },
    [selectedGroupIds, discoveredSpecs, notifyParent]
  );

  // Toggle all groups for a page
  const togglePage = useCallback(
    (pageUrl: string) => {
      const pageGroupIds: string[] = [];
      for (const spec of discoveredSpecs) {
        if (getSpecPageUrl(spec) === pageUrl) {
          for (const group of spec.config?.groups ?? []) {
            pageGroupIds.push(group.id);
          }
        }
      }

      const next = new Set(selectedGroupIds);
      const allSelected = pageGroupIds.every((id) => next.has(id));

      if (allSelected) {
        for (const id of pageGroupIds) next.delete(id);
      } else {
        for (const id of pageGroupIds) next.add(id);
      }

      const nextPageUrls = new Set(selectedPageUrls);
      if (allSelected) {
        nextPageUrls.delete(pageUrl);
      } else {
        nextPageUrls.add(pageUrl);
      }

      setSelectedGroupIds(next);
      setSelectedPageUrls(nextPageUrls);
      notifyParent(discoveredSpecs, next, discoveredPages, nextPageUrls);
    },
    [
      discoveredSpecs,
      selectedGroupIds,
      selectedPageUrls,
      discoveredPages,
      notifyParent,
    ]
  );

  // Toggle page collapse
  const togglePageCollapse = useCallback((pageUrl: string) => {
    setCollapsedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageUrl)) {
        next.delete(pageUrl);
      } else {
        next.add(pageUrl);
      }
      return next;
    });
  }, []);

  // Select all / none
  const handleSelectAll = useCallback(() => {
    const allIds = new Set<string>();
    const allPageUrls = new Set<string>();
    for (const spec of discoveredSpecs) {
      allPageUrls.add(getSpecPageUrl(spec));
      for (const group of spec.config?.groups ?? []) {
        allIds.add(group.id);
      }
    }
    setSelectedGroupIds(allIds);
    setSelectedPageUrls(allPageUrls);
    notifyParent(discoveredSpecs, allIds, discoveredPages, allPageUrls);
  }, [discoveredSpecs, discoveredPages, notifyParent]);

  const handleSelectNone = useCallback(() => {
    const empty = new Set<string>();
    setSelectedGroupIds(empty);
    setSelectedPageUrls(new Set());
    notifyParent(discoveredSpecs, empty, discoveredPages, new Set());
  }, [discoveredSpecs, discoveredPages, notifyParent]);

  // Compute summary badge
  const totalGroups = discoveredSpecs.reduce(
    (sum, s) => sum + (s.config?.groups?.length ?? 0),
    0
  );
  const selectedCount = selectedGroupIds.size;

  // Group specs by page URL for hierarchical display
  const specsByPage = useMemo(() => {
    const map = new Map<
      string,
      { spec: DiscoveredSpec; groups: SpecGroup[] }
    >();
    for (const spec of discoveredSpecs) {
      const pageUrl = getSpecPageUrl(spec);
      if (!map.has(pageUrl)) {
        map.set(pageUrl, { spec, groups: [] });
      }
      const entry = map.get(pageUrl)!;
      for (const group of spec.config?.groups ?? []) {
        entry.groups.push(group);
      }
    }
    return map;
  }, [discoveredSpecs]);

  // Compute page checkbox states
  const getPageCheckState = useCallback(
    (pageUrl: string): "checked" | "unchecked" | "indeterminate" => {
      const entry = specsByPage.get(pageUrl);
      if (!entry || entry.groups.length === 0) return "unchecked";

      const selectedInPage = entry.groups.filter((g) =>
        selectedGroupIds.has(g.id)
      ).length;
      if (selectedInPage === 0) return "unchecked";
      if (selectedInPage === entry.groups.length) return "checked";
      return "indeterminate";
    },
    [specsByPage, selectedGroupIds]
  );

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
        {/* Connection Bar */}
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
                  onClick={handleDiscoverSpecs}
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
                  onClick={handleDiscoverAllPages}
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

        {/* Semantic Spec Group List — Hierarchical by Page */}
        {discoveredSpecs.length > 0 && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
            {/* Header with select all/none/clear */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Page Specs ({selectedCount}/{totalGroups})
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

            {/* Hierarchical page -> groups display */}
            <div className="max-h-[320px] overflow-y-auto space-y-1 pr-1">
              {Array.from(specsByPage.entries()).map(
                ([pageUrl, { groups }]) => {
                  const checkState = getPageCheckState(pageUrl);
                  const isCollapsed = collapsedPages.has(pageUrl);
                  const slugId = pageUrl.replace(/^\//, "").replace(/\//g, "-");
                  return (
                    <div
                      key={pageUrl}
                      className="rounded border border-zinc-700/50"
                    >
                      {/* Page row */}
                      <div className="flex items-center gap-2 p-1.5 hover:bg-zinc-700/20">
                        <button
                          onClick={() => togglePageCollapse(pageUrl)}
                          className="text-zinc-500 hover:text-zinc-300"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                        <Checkbox
                          data-ui-id={`page-checkbox-${slugId}`}
                          checked={
                            checkState === "indeterminate"
                              ? "indeterminate"
                              : checkState === "checked"
                          }
                          onCheckedChange={() => togglePage(pageUrl)}
                          className="mt-0"
                        />
                        <span className="text-xs text-zinc-300 font-medium flex-1 truncate">
                          {pageUrl}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {groups.length} group
                          {groups.length !== 1 ? "s" : ""}
                        </span>
                      </div>

                      {/* Nested groups */}
                      {!isCollapsed && (
                        <div className="pl-9 pb-1">
                          {groups.map((group) => (
                            <label
                              key={group.id}
                              data-ui-id={`spec-group-${slugId}`}
                              data-ui-label={`${pageUrl}: ${(group.description || group.name).slice(0, 60)}`}
                              className="flex items-start gap-2 p-1 rounded hover:bg-zinc-700/30 cursor-pointer"
                            >
                              <Checkbox
                                data-ui-id={`spec-checkbox-${slugId}`}
                                checked={selectedGroupIds.has(group.id)}
                                onCheckedChange={() => toggleGroup(group.id)}
                                className="mt-0.5"
                              />
                              <span className="text-xs text-zinc-400">
                                {group.description || group.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
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
