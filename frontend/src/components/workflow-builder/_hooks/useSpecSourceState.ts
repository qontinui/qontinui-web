import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { runnerApi } from "@/lib/runner-api";
import type { DiscoveredSpec, SpecGroup } from "@/lib/spec-prompt-builder";
import { buildSpecPrompt } from "@/lib/spec-prompt-builder";
import {
  parseDiscoveredSpecs,
  unwrapSpecResponse,
} from "@/lib/ui-bridge/spec-parser";
import { useAppBrowser } from "@/hooks/useAppBrowser";
import { useDiscoveredSpecs } from "@/lib/ui-bridge/use-discovered-specs";
import type {
  DiscoveredPage,
  SpecSourceState,
  PersistedSpecState,
} from "../spec-source-types";
import { STORAGE_KEY, BUNDLED_SPEC_VERSION } from "../spec-source-types";
import { filterSelectedGroups, getSpecPageUrl } from "../spec-source-utils";

export function useSpecSourceState(
  onSpecsChanged: (state: SpecSourceState) => void
) {
  const onSpecsChangedRef = useRef(onSpecsChanged);
  onSpecsChangedRef.current = onSpecsChanged;

  const [isOpen, setIsOpen] = useState(false);

  const browser = useAppBrowser();
  const { specs: bundled } = useDiscoveredSpecs();

  const [discoveredSpecs, setDiscoveredSpecs] = useState<DiscoveredSpec[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set()
  );
  const [isDiscovering, setIsDiscovering] = useState(false);

  const [discoveredPages, setDiscoveredPages] = useState<DiscoveredPage[]>([]);
  const [selectedPageUrls, setSelectedPageUrls] = useState<Set<string>>(
    new Set()
  );
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState<string | null>(null);

  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(new Set());

  const [manualUrl, setManualUrl] = useState("");
  const [showManualConnect, setShowManualConnect] = useState(false);

  const [showPromptPreview, setShowPromptPreview] = useState(false);

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

  // Load bundled semantic specs on mount, overlay persisted selection state.
  // Re-runs when `bundled` populates from the runtime spec loader.
  useEffect(() => {
    const specMap = new Map(bundled.map((s) => [s.specId, s]));

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

    const selectedIds = new Set<string>();

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
  }, [buildState, bundled]);

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

  const handleDiscoverSpecs = useCallback(async () => {
    if (!browser.isConnected) return;
    setIsDiscovering(true);
    try {
      const res = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
      const rawSpecs = unwrapSpecResponse(res);
      const allSpecs = parseDiscoveredSpecs(rawSpecs);
      const semanticSpecs = filterSelectedGroups(allSpecs);
      if (semanticSpecs.length === 0) return;
      const appName = browser.connectedAppName || undefined;
      const tagged = semanticSpecs.map((s) => ({ ...s, appName }));
      mergeSpecs(tagged);
    } catch {
      // Discovery failed
    } finally {
      setIsDiscovering(false);
    }
  }, [browser.isConnected, browser.connectedAppName, mergeSpecs]);

  const handleDiscoverAllPages = useCallback(async () => {
    if (!browser.isConnected) return;
    setIsCrawling(true);
    setCrawlProgress("Discovering links...");
    try {
      const linkRes = await runnerApi.uiBridgeDiscover({
        interactive_only: false,
      });
      const rawElements =
        (linkRes as Record<string, unknown>)?.elements ??
        ((linkRes as Record<string, unknown>)?.data as Record<string, unknown>)
          ?.elements ??
        [];

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
            const appName = browser.connectedAppName || undefined;
            newSpecs.push(...semanticSpecs.map((s) => ({ ...s, appName })));
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
    browser.connectedAppName,
    discoveredSpecs,
    selectedGroupIds,
    notifyParent,
  ]);

  const handleManualConnect = useCallback(async () => {
    const url = manualUrl.trim();
    if (!url) return;
    await browser.connect(url);
    setManualUrl("");
    setShowManualConnect(false);
  }, [manualUrl, browser]);

  const handleClearAll = useCallback(() => {
    setDiscoveredSpecs([]);
    setSelectedGroupIds(new Set());
    setDiscoveredPages([]);
    setSelectedPageUrls(new Set());
    notifyParent([], new Set(), [], new Set());
  }, [notifyParent]);

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

  const totalGroups = discoveredSpecs.reduce(
    (sum, s) => sum + (s.config?.groups?.length ?? 0),
    0
  );
  const selectedCount = selectedGroupIds.size;

  const specsByPage = useMemo(() => {
    const map = new Map<
      string,
      { spec: DiscoveredSpec; groups: SpecGroup[]; appName?: string }
    >();
    for (const spec of discoveredSpecs) {
      const pageUrl = getSpecPageUrl(spec);
      if (!map.has(pageUrl)) {
        map.set(pageUrl, { spec, groups: [], appName: spec.appName });
      }
      const entry = map.get(pageUrl)!;
      if (!entry.appName && spec.appName) {
        entry.appName = spec.appName;
      }
      for (const group of spec.config?.groups ?? []) {
        entry.groups.push(group);
      }
    }
    return map;
  }, [discoveredSpecs]);

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

  const promptPreview = useMemo(() => {
    if (selectedCount === 0) return null;
    return buildSpecPrompt({ discoveredSpecs, selectedGroupIds });
  }, [discoveredSpecs, selectedGroupIds, selectedCount]);

  return {
    isOpen,
    setIsOpen,
    browser,
    discoveredSpecs,
    selectedGroupIds,
    isDiscovering,
    isCrawling,
    crawlProgress,
    collapsedPages,
    manualUrl,
    setManualUrl,
    showManualConnect,
    setShowManualConnect,
    showPromptPreview,
    setShowPromptPreview,
    totalGroups,
    selectedCount,
    specsByPage,
    getPageCheckState,
    promptPreview,
    handleDiscoverSpecs,
    handleDiscoverAllPages,
    handleManualConnect,
    handleClearAll,
    toggleGroup,
    togglePage,
    togglePageCollapse,
    handleSelectAll,
    handleSelectNone,
  };
}
