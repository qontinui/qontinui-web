/**
 * useInspector Hook
 *
 * Unified SDK connection model for the Inspector page.
 * All apps (including the runner itself) connect via the SDK connection manager.
 * No separate "browser" vs "desktop" modes — everything goes through SDK.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { runnerApi } from "@/lib/runner/runner-api-object";

// =============================================================================
// Types
// =============================================================================

export interface ExternalElement {
  id: string;
  tagName: string;
  type: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visible: boolean;
  enabled: boolean;
  focused: boolean;
  value?: string;
  checked?: boolean;
  text?: string;
  label?: string;
  parent?: string | null;
  children?: string[];
  actions: string[];
  hasUiId?: boolean;
  role?: string;
  accessibleName?: string;
  is_interactive?: boolean;
  ref?: string;
  selector?: string;
  classes?: string[];
  href?: string;
  dataRoute?: string;
  title?: string;
  placeholder?: string;
  name?: string;
  inputType?: string;
  interactive?: boolean;
  tag?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration?: number;
}

export interface DiscoveredSpec {
  specId: string;
  config: unknown;
}

export interface CommandHistoryEntry {
  id: number;
  timestamp: number;
  action: string;
  params?: Record<string, unknown>;
  result: CommandResult;
}

export interface SdkConnection {
  url: string;
  app: { appId?: string; appName?: string; version?: string };
  connectedAt: number;
  isActive: boolean;
}

export interface DiscoveredLink {
  url: string;
  text: string;
}

export type InspectorTab =
  | "elements"
  | "actions"
  | "accessibility"
  | "search"
  | "specs"
  | "api";

export interface UseInspectorReturn {
  // Tabs
  activeTab: InspectorTab;
  setActiveTab: (t: InspectorTab) => void;

  // SDK Connection management
  connections: SdkConnection[];
  activeConnection: SdkConnection | null;
  connectUrl: string;
  setConnectUrl: (url: string) => void;
  isConnecting: boolean;
  connect: (url: string) => Promise<void>;
  disconnect: (url?: string) => Promise<void>;
  switchTo: (url: string) => Promise<void>;
  refreshConnections: () => Promise<void>;

  // Element inspection
  elements: ExternalElement[];
  selectedElement: ExternalElement | null;
  selectElement: (el: ExternalElement | null) => void;
  discoverElements: () => Promise<void>;
  isDiscovering: boolean;
  executeAction: (
    id: string,
    action: string,
    params?: Record<string, unknown>
  ) => Promise<CommandResult>;
  highlightElement: (id: string) => Promise<void>;

  // Specs
  discoverSpecs: () => Promise<DiscoveredSpec[]>;

  // Discovered links (read-only page tree)
  discoveredLinks: DiscoveredLink[];

  // Tab targeting
  tabs: string[];
  targetTabId: string | null;
  setTargetTabId: (tabId: string | null) => void;
  refreshTabs: () => Promise<void>;

  // Page navigation (for SiteTreePanel)
  navigateToPage: (url: string, tabId?: string) => Promise<void>;
  isNavigating: boolean;

  // API command (raw)
  sendCommand: <T = unknown>(
    action: string,
    params?: Record<string, unknown>
  ) => Promise<CommandResult<T>>;
  commandHistory: CommandHistoryEntry[];
  lastCommandResult: CommandResult | null;
  clearCommandHistory: () => void;

  // Unified state
  isConnected: boolean;
  error: string | null;
  isLoadingElements: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const MAX_COMMAND_HISTORY = 50;

// =============================================================================
// Hook
// =============================================================================

export function useInspector(): UseInspectorReturn {
  const [activeTab, setActiveTab] = useState<InspectorTab>("elements");

  // Connection state
  const [connections, setConnections] = useState<SdkConnection[]>([]);
  const [activeConnection, setActiveConnection] =
    useState<SdkConnection | null>(null);
  const [connectUrl, setConnectUrl] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Element state
  const [elements, setElements] = useState<ExternalElement[]>([]);
  const [selectedElement, setSelectedElement] =
    useState<ExternalElement | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredLinks, setDiscoveredLinks] = useState<DiscoveredLink[]>([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [targetTabId, setTargetTabId] = useState<string | null>(null);

  // Command history (for API tab)
  const [lastCommandResult, setLastCommandResult] =
    useState<CommandResult | null>(null);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>(
    []
  );
  const commandIdRef = useRef(0);

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
      // Runner might be offline — leave state as-is
    }
  }, []);

  const refreshTabs = useCallback(async () => {
    try {
      const result = await runnerApi.uiBridgeTabs();
      const data = result as unknown as Record<string, unknown>;
      // Extract tabs array from response: try data.data.tabs, data.tabs, data.data
      let tabList: string[] = [];
      if (
        data?.data &&
        typeof data.data === "object" &&
        !Array.isArray(data.data)
      ) {
        const inner = data.data as Record<string, unknown>;
        tabList = (inner.tabs as string[]) ?? [];
      } else if (Array.isArray(data?.tabs)) {
        tabList = data.tabs as string[];
      } else if (Array.isArray(data?.data)) {
        tabList = data.data as string[];
      }
      setTabs(tabList);
    } catch {
      // SDK app might not support tabs endpoint
    }
  }, []);

  const connect = useCallback(
    async (url: string) => {
      setIsConnecting(true);
      setError(null);
      try {
        await runnerApi.uiBridgeConnect({ url });
        await refreshConnections();
        await refreshTabs();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to connect to app"
        );
      } finally {
        setIsConnecting(false);
      }
    },
    [refreshConnections, refreshTabs]
  );

  const disconnect = useCallback(
    async (url?: string) => {
      try {
        await runnerApi.uiBridgeDisconnect(url);
        setElements([]);
        setSelectedElement(null);
        await refreshConnections();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to disconnect");
      }
    },
    [refreshConnections]
  );

  const switchTo = useCallback(
    async (url: string) => {
      try {
        await runnerApi.uiBridgeSwitch(url);
        setElements([]);
        setSelectedElement(null);
        await refreshConnections();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to switch connection"
        );
      }
    },
    [refreshConnections]
  );

  // -------------------------------------------------------------------------
  // Element inspection
  // -------------------------------------------------------------------------

  /**
   * Transform raw SDK elements into ExternalElement shape.
   * SDK elements have: { id, type, label, state: { visible, enabled, rect, textContent }, actions, category }
   * ExternalElement expects: { id, tagName, type, bounds, visible, enabled, text, actions, ... }
   */
  const transformSdkElements = useCallback(
    (rawElems: unknown[]): ExternalElement[] => {
      return rawElems.map((raw) => {
        const el = raw as Record<string, unknown>;
        const state = (el.state ?? {}) as Record<string, unknown>;
        const rect = (state.rect ?? {}) as Record<string, number>;
        const identifier = (el.identifier ?? {}) as Record<string, unknown>;

        return {
          id: (el.id as string) ?? "",
          tagName: (el.tagName as string) ?? (el.type as string) ?? "",
          type: (el.type as string) ?? "",
          bounds: {
            x: rect.x ?? rect.left ?? 0,
            y: rect.y ?? rect.top ?? 0,
            width: rect.width ?? 0,
            height: rect.height ?? 0,
          },
          visible: (state.visible as boolean) ?? true,
          enabled: (state.enabled as boolean) ?? true,
          focused: (state.focused as boolean) ?? false,
          value: state.value as string | undefined,
          text:
            (el.label as string) ?? (state.textContent as string) ?? undefined,
          label: (el.label as string) ?? undefined,
          actions: (el.actions as string[]) ?? [],
          role: (el.role as string) ?? undefined,
          accessibleName: (el.accessibleName as string) ?? undefined,
          is_interactive: el.category === "interactive",
          interactive: el.category === "interactive",
          ref: (identifier.uiId as string) ?? undefined,
          selector: (identifier.selector as string) ?? undefined,
          href: (el.href as string) ?? (state.href as string) ?? undefined,
          dataRoute: (state.dataRoute as string) ?? undefined,
        } as ExternalElement;
      });
    },
    []
  );

  /** Extract navigable pages from SDK-discovered elements.
   *  Looks for: elements with data-route, anchor elements with href,
   *  and navigation buttons with route metadata. */
  const extractLinks = useCallback(
    (elems: ExternalElement[]): DiscoveredLink[] => {
      const links: DiscoveredLink[] = [];
      const seenUrls = new Set<string>();

      const addLink = (url: string, text: string) => {
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          links.push({ url, text });
        }
      };

      for (const el of elems) {
        const id = el.id || "";
        const label =
          el.text?.replace(/hidden$/i, "").trim() ||
          el.label?.replace(/hidden$/i, "").trim() ||
          "";

        // 1. Elements with data-route (nav items, route buttons)
        if (el.dataRoute && !el.dataRoute.includes(":")) {
          addLink(el.dataRoute, label || id);
          continue;
        }

        // 2. Anchor/link elements with href
        if (
          (el.tagName === "a" || el.tagName === "A" || el.role === "link") &&
          el.href
        ) {
          try {
            const href = el.href;
            if (
              href.startsWith("/") ||
              (activeConnection &&
                href.startsWith(new URL(activeConnection.url).origin))
            ) {
              const normalizedUrl = href.startsWith("/")
                ? href
                : new URL(href).pathname;
              addLink(
                normalizedUrl,
                label || el.accessibleName || normalizedUrl
              );
            }
          } catch {
            // Invalid URL — skip
          }
        }
      }

      return links.sort((a, b) => a.url.localeCompare(b.url));
    },
    [activeConnection]
  );

  const discoverElements = useCallback(async () => {
    setIsDiscovering(true);
    setError(null);
    try {
      // Discover triggers element scan and returns elements in the response.
      // SDK proxy endpoints return {data: ...} without "success", so
      // runnerFetch does NOT unwrap the envelope. We handle it here.
      const raw = await runnerApi.uiBridgeDiscover({ interactive_only: false });
      const wrapped = raw as unknown as Record<string, unknown>;

      // Extract elements: try wrapped.data.elements, then wrapped.elements, then wrapped.data (array)
      let rawElems: unknown[] = [];
      if (
        wrapped?.data &&
        typeof wrapped.data === "object" &&
        !Array.isArray(wrapped.data)
      ) {
        const inner = wrapped.data as Record<string, unknown>;
        rawElems = (inner.elements ?? []) as unknown[];
      } else if (Array.isArray(wrapped?.data)) {
        rawElems = wrapped.data;
      } else if (wrapped?.elements) {
        rawElems = wrapped.elements as unknown[];
      } else if (Array.isArray(wrapped)) {
        rawElems = wrapped;
      }

      const elemList = transformSdkElements(rawElems);
      setElements(elemList);
      setSelectedElement(null);

      // Extract links for page tree
      const links = extractLinks(elemList);
      setDiscoveredLinks((prev) => {
        const existingUrls = new Set(prev.map((l) => l.url));
        const newLinks = links.filter((l) => !existingUrls.has(l.url));
        return [...prev, ...newLinks];
      });

      // Refresh connected tabs
      await refreshTabs();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to discover elements"
      );
    } finally {
      setIsDiscovering(false);
    }
  }, [extractLinks, transformSdkElements, refreshTabs]);

  /**
   * Navigate the connected app to a URL and re-discover elements.
   * Uses targetTabId to avoid navigating the inspector tab itself.
   */
  const navigateToPage = useCallback(
    async (url: string, tabId?: string) => {
      setIsNavigating(true);
      setError(null);
      try {
        const effectiveTabId = tabId ?? targetTabId ?? undefined;
        await runnerApi.uiBridgePageNavigate(url, effectiveTabId);
        // Wait for navigation to settle before re-discovering
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await discoverElements();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Navigation failed");
      } finally {
        setIsNavigating(false);
      }
    },
    [discoverElements, targetTabId]
  );

  const selectElement = useCallback((el: ExternalElement | null) => {
    setSelectedElement(el);
  }, []);

  const executeAction = useCallback(
    async (
      id: string,
      action: string,
      params?: Record<string, unknown>
    ): Promise<CommandResult> => {
      try {
        await runnerApi.uiBridgeElementAction(id, action, params);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Action failed",
        };
      }
    },
    []
  );

  const highlightElement = useCallback(async (id: string) => {
    try {
      await runnerApi.uiBridgeHighlight(id);
    } catch {
      // Best effort — don't surface errors for highlight
    }
  }, []);

  // -------------------------------------------------------------------------
  // Spec discovery
  // -------------------------------------------------------------------------

  const discoverSpecs = useCallback(async (): Promise<DiscoveredSpec[]> => {
    try {
      const raw = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
      // SDK proxy returns {data: ...} without "success" → not unwrapped by runnerFetch
      const wrapped = raw as unknown as Record<string, unknown>;
      const inner = (wrapped?.data ?? wrapped) as Record<string, unknown>;

      if (inner?.specs && Array.isArray(inner.specs)) {
        return (inner.specs as Array<{ specId: string; config: unknown }>).map(
          (s) => ({ specId: s.specId, config: s.config })
        );
      }

      // Fallback: try snapshot approach
      const snapRaw = await runnerApi.uiBridgeSnapshot();
      const snapWrapped = snapRaw as unknown as Record<string, unknown>;
      const snapInner = (snapWrapped?.data ?? snapWrapped) as Record<
        string,
        unknown
      >;
      const specStore = snapInner?.specStore || snapInner?.specs;
      if (specStore && typeof specStore === "object") {
        return Object.entries(specStore).map(([specId, config]) => ({
          specId,
          config,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }, []);

  // -------------------------------------------------------------------------
  // Raw API command (for API tab)
  // -------------------------------------------------------------------------

  const sendCommand = useCallback(
    async <T = unknown>(
      action: string,
      params: Record<string, unknown> = {}
    ): Promise<CommandResult<T>> => {
      const startTime = Date.now();
      try {
        // Route through SDK element action if it looks like an element command
        const response = await fetch(
          `http://localhost:9876/ui-bridge/sdk/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          }
        );
        const duration = Date.now() - startTime;
        const data = await response.json();
        const result: CommandResult<T> = {
          success: response.ok,
          data: data as T,
          error: response.ok ? undefined : `HTTP ${response.status}`,
          duration,
        };
        const entry: CommandHistoryEntry = {
          id: ++commandIdRef.current,
          timestamp: Date.now(),
          action,
          params: Object.keys(params).length > 0 ? params : undefined,
          result,
        };
        setCommandHistory((prev) =>
          [entry, ...prev].slice(0, MAX_COMMAND_HISTORY)
        );
        setLastCommandResult(result);
        return result;
      } catch (err) {
        const duration = Date.now() - startTime;
        const result: CommandResult<T> = {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
          duration,
        };
        const entry: CommandHistoryEntry = {
          id: ++commandIdRef.current,
          timestamp: Date.now(),
          action,
          params: Object.keys(params).length > 0 ? params : undefined,
          result,
        };
        setCommandHistory((prev) =>
          [entry, ...prev].slice(0, MAX_COMMAND_HISTORY)
        );
        setLastCommandResult(result);
        return result;
      }
    },
    []
  );

  const clearCommandHistory = useCallback(() => {
    setCommandHistory([]);
    setLastCommandResult(null);
  }, []);

  // -------------------------------------------------------------------------
  // On mount: detect existing connections
  // -------------------------------------------------------------------------

  useEffect(() => {
    refreshConnections();
  }, [refreshConnections]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const isConnected = activeConnection !== null;

  return {
    activeTab,
    setActiveTab,

    connections,
    activeConnection,
    connectUrl,
    setConnectUrl,
    isConnecting,
    connect,
    disconnect,
    switchTo,
    refreshConnections,

    elements,
    selectedElement,
    selectElement,
    discoverElements,
    isDiscovering,
    executeAction,
    highlightElement,

    discoverSpecs,

    discoveredLinks,

    tabs,
    targetTabId,
    setTargetTabId,
    refreshTabs,

    navigateToPage,
    isNavigating,

    sendCommand,
    commandHistory,
    lastCommandResult,
    clearCommandHistory,

    isConnected,
    error,
    isLoadingElements: isDiscovering,
  };
}
