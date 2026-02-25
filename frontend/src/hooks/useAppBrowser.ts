/**
 * useAppBrowser Hook
 *
 * Shared hook for scanning available SDK apps, managing multi-connections,
 * discovering navigable pages, and selecting tab targets.
 * Used by Inspector, Workflows, and Page Sweep pages.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { discoverCurrentPageLinks } from "@/lib/ui-bridge/page-crawler";
import type {
  DiscoveredLink,
  PageNodeStatus,
  SdkConnection,
  Target,
} from "@/lib/ui-bridge/types";
import type { DiscoveredApp } from "@/lib/runner/types/exploration";

// =============================================================================
// Types
// =============================================================================

export interface UseAppBrowserOptions {
  /** Auto-scan for available apps on mount. Default: true */
  autoScan?: boolean;
  /** Auto-connect if exactly 1 app found. Default: true */
  autoConnect?: boolean;
  /** Pathname to filter self out of discovered apps and tab targets */
  selfPathname?: string;
}

export interface UseAppBrowserReturn {
  // Available apps (from scan)
  availableApps: DiscoveredApp[];
  isScanning: boolean;
  lastScanCount: number | null;
  scanForApps: () => Promise<DiscoveredApp[]>;

  // Multi-connection management
  connections: SdkConnection[];
  activeConnection: SdkConnection | null;
  isConnecting: boolean;
  isConnected: boolean;
  connectedAppName: string;
  connectionError: string | null;
  connect: (url: string) => Promise<void>;
  disconnect: (url?: string) => Promise<void>;
  switchTo: (url: string) => Promise<void>;
  refreshConnections: () => Promise<void>;

  // Tab / target selection
  targets: Target[];
  selectedTargetId: string | null;
  setSelectedTargetId: (id: string | null) => void;
  refreshTargets: () => Promise<void>;
  isLoadingTargets: boolean;

  // Page discovery
  discoveredLinks: DiscoveredLink[];
  isDiscoveringPages: boolean;
  discoverPages: () => Promise<void>;

  // Page status (for tree node indicators)
  pageStatus: Map<string, PageNodeStatus>;
  updatePageStatus: (url: string, status: PageNodeStatus) => void;
  setDiscoveredLinks: React.Dispatch<React.SetStateAction<DiscoveredLink[]>>;
}

// localStorage key prefix
const TREE_STORAGE_PREFIX = "app-browser-tree";

interface PersistedTreeState {
  discoveredLinks: DiscoveredLink[];
  pageStatus: [string, PageNodeStatus][];
}

// =============================================================================
// Hook
// =============================================================================

export function useAppBrowser(
  options?: UseAppBrowserOptions
): UseAppBrowserReturn {
  const { autoScan = true, autoConnect = true, selfPathname } = options ?? {};

  // Scanning state
  const [availableApps, setAvailableApps] = useState<DiscoveredApp[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanCount, setLastScanCount] = useState<number | null>(null);

  // Connection state
  const [connections, setConnections] = useState<SdkConnection[]>([]);
  const [activeConnection, setActiveConnection] =
    useState<SdkConnection | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Target / tab state
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);
  const hasAutoSelectedTarget = useRef(false);

  // Page discovery state
  const [discoveredLinks, setDiscoveredLinks] = useState<DiscoveredLink[]>([]);
  const [isDiscoveringPages, setIsDiscoveringPages] = useState(false);
  const [pageStatus, setPageStatus] = useState<Map<string, PageNodeStatus>>(
    () => new Map()
  );

  // Track whether we've already done initial setup
  const hasInitialized = useRef(false);
  const autoConnectDone = useRef(false);

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  const refreshConnections = useCallback(async () => {
    try {
      const conns = await runnerApi.uiBridgeConnections();
      setConnections(conns);
      const active = conns.find((c) => c.isActive) ?? null;
      setActiveConnection(active);
    } catch {
      // Runner might be offline
    }
  }, []);

  // -------------------------------------------------------------------------
  // Target / tab management
  // -------------------------------------------------------------------------

  const refreshTargets = useCallback(async () => {
    setIsLoadingTargets(true);
    try {
      const allTargets: Target[] = [];

      // Fetch web tabs
      try {
        const result = await runnerApi.uiBridgeTabs();
        const data = result as unknown as Record<string, unknown>;
        const inner =
          data?.data &&
          typeof data.data === "object" &&
          !Array.isArray(data.data)
            ? (data.data as Record<string, unknown>)
            : data;

        if (Array.isArray(inner?.tabsInfo)) {
          const tabsInfo = inner.tabsInfo as Array<{
            tabId: string;
            url?: string;
            pathname?: string;
            title?: string;
          }>;
          for (const tab of tabsInfo) {
            const appName = tab.title || "Tab";
            const pathname = tab.pathname;
            const label = pathname ? `${appName} ${pathname}` : appName;
            const isSelf = selfPathname
              ? (pathname?.includes(selfPathname) ?? false)
              : false;
            allTargets.push({
              id: tab.tabId,
              type: "web",
              label,
              appName,
              pathname,
              url: tab.url,
              isSelf,
            });
          }
        } else {
          const tabIds: string[] = Array.isArray(inner?.tabs)
            ? (inner.tabs as string[])
            : [];
          for (const tabId of tabIds) {
            allTargets.push({
              id: tabId,
              type: "web",
              label: tabId,
              appName: tabId,
            });
          }
        }
      } catch {
        // SDK app might not support tabs endpoint
      }

      setTargets(allTargets);

      // Auto-select first non-self target on initial fetch
      if (!hasAutoSelectedTarget.current && allTargets.length > 0) {
        const firstSelectable = allTargets.find((t) => !t.isSelf);
        if (firstSelectable) {
          setSelectedTargetId(firstSelectable.id);
        }
        hasAutoSelectedTarget.current = true;
      }
    } catch {
      // Target fetch failed
    } finally {
      setIsLoadingTargets(false);
    }
  }, [selfPathname]);

  // -------------------------------------------------------------------------
  // Connect / disconnect / switch
  // -------------------------------------------------------------------------

  const connect = useCallback(
    async (url: string) => {
      setIsConnecting(true);
      setConnectionError(null);
      try {
        await runnerApi.uiBridgeConnect({ url });
        await refreshConnections();
        await refreshTargets();
      } catch (err) {
        setConnectionError(
          err instanceof Error ? err.message : "Failed to connect to app"
        );
      } finally {
        setIsConnecting(false);
      }
    },
    [refreshConnections, refreshTargets]
  );

  const disconnect = useCallback(
    async (url?: string) => {
      try {
        await runnerApi.uiBridgeDisconnect(url);
        await refreshConnections();
      } catch (err) {
        setConnectionError(
          err instanceof Error ? err.message : "Failed to disconnect"
        );
      }
    },
    [refreshConnections]
  );

  const switchTo = useCallback(
    async (url: string) => {
      try {
        await runnerApi.uiBridgeSwitch(url);
        await refreshConnections();
        await refreshTargets();
      } catch (err) {
        setConnectionError(
          err instanceof Error ? err.message : "Failed to switch connection"
        );
      }
    },
    [refreshConnections, refreshTargets]
  );

  // -------------------------------------------------------------------------
  // App scanning
  // -------------------------------------------------------------------------

  const scanForApps = useCallback(async () => {
    setIsScanning(true);
    setConnectionError(null);
    try {
      const results = await Promise.allSettled([
        runnerApi.uiBridgeScanWeb(),
        runnerApi.uiBridgeScanDesktop(),
      ]);

      const apps: DiscoveredApp[] = [];
      for (const result of results) {
        if (result.status === "fulfilled" && result.value?.apps) {
          const rawApps = result.value.apps as DiscoveredApp[];
          apps.push(...rawApps);
        }
      }

      // Filter out self if selfPathname is set
      const filtered = selfPathname
        ? apps.filter((app) => {
            try {
              const appPath = new URL(app.url).pathname;
              return !appPath.includes(selfPathname);
            } catch {
              return true;
            }
          })
        : apps;

      setAvailableApps(filtered);
      setLastScanCount(filtered.length);
      return filtered;
    } catch {
      setAvailableApps([]);
      setLastScanCount(0);
      return [];
    } finally {
      setIsScanning(false);
    }
  }, [selfPathname]);

  // -------------------------------------------------------------------------
  // Page discovery
  // -------------------------------------------------------------------------

  const discoverPages = useCallback(async () => {
    if (!activeConnection) return;
    setIsDiscoveringPages(true);
    try {
      const links = await discoverCurrentPageLinks(activeConnection.url);
      setDiscoveredLinks((prev) => {
        const existingUrls = new Set(prev.map((l) => l.url));
        const newLinks = links.filter((l) => !existingUrls.has(l.url));
        return newLinks.length > 0 ? [...prev, ...newLinks] : prev;
      });
    } catch {
      // Discovery failed silently — user can retry
    } finally {
      setIsDiscoveringPages(false);
    }
  }, [activeConnection]);

  const updatePageStatus = useCallback(
    (url: string, status: PageNodeStatus) => {
      setPageStatus((prev) => {
        const next = new Map(prev);
        next.set(url, status);
        return next;
      });
    },
    []
  );

  // -------------------------------------------------------------------------
  // Persistence (localStorage)
  // -------------------------------------------------------------------------

  const storageKey = `${TREE_STORAGE_PREFIX}-${selfPathname || "default"}`;

  // Restore persisted tree state on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed: PersistedTreeState = JSON.parse(stored);
        if (parsed.discoveredLinks?.length > 0) {
          setDiscoveredLinks(parsed.discoveredLinks);
        }
        if (parsed.pageStatus?.length > 0) {
          const restored = new Map<string, PageNodeStatus>();
          for (const [url, status] of parsed.pageStatus) {
            restored.set(url, { ...status, isLoading: false, isActive: false });
          }
          setPageStatus(restored);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, [storageKey]);

  // Persist tree state when it changes
  useEffect(() => {
    if (discoveredLinks.length === 0) return;
    const toSave: PersistedTreeState = {
      discoveredLinks,
      pageStatus: Array.from(pageStatus.entries()),
    };
    localStorage.setItem(storageKey, JSON.stringify(toSave));
  }, [discoveredLinks, pageStatus, storageKey]);

  // -------------------------------------------------------------------------
  // Initialization: scan + check existing connections + targets
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    (async () => {
      await refreshConnections();
      if (autoScan) {
        await scanForApps();
      }
      await refreshTargets();
    })();
  }, [autoScan, refreshConnections, scanForApps, refreshTargets]);

  // Auto-connect when exactly 1 app is found and no active connection exists
  useEffect(() => {
    if (
      autoConnect &&
      !autoConnectDone.current &&
      !isScanning &&
      availableApps.length === 1 &&
      !activeConnection &&
      connections.length === 0
    ) {
      autoConnectDone.current = true;
      connect(availableApps[0]!.url);
    }
  }, [
    autoConnect,
    isScanning,
    availableApps,
    activeConnection,
    connections.length,
    connect,
  ]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const isConnected = activeConnection !== null;
  const connectedAppName =
    activeConnection?.app?.appName || activeConnection?.url || "";

  return {
    // Scanning
    availableApps,
    isScanning,
    lastScanCount,
    scanForApps,

    // Connections
    connections,
    activeConnection,
    isConnecting,
    isConnected,
    connectedAppName,
    connectionError,
    connect,
    disconnect,
    switchTo,
    refreshConnections,

    // Targets
    targets,
    selectedTargetId,
    setSelectedTargetId,
    refreshTargets,
    isLoadingTargets,

    // Page discovery
    discoveredLinks,
    isDiscoveringPages,
    discoverPages,

    // Page status
    pageStatus,
    updatePageStatus,
    setDiscoveredLinks,
  };
}
