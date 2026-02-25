/**
 * useInspector Hook
 *
 * Unified SDK connection model for the Inspector page.
 * Delegates connection management to useAppBrowser while keeping
 * inspector-specific state (elements, specs, command history).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { runnerApi } from "@/lib/runner/runner-api-object";
import {
  transformSdkElements as transformSdkElementsPure,
  extractLinks as extractLinksPure,
  unwrapElementResponse,
} from "@/lib/ui-bridge/link-extractor";
import { unwrapSpecResponse } from "@/lib/ui-bridge/spec-parser";
import { useAppBrowser } from "@/hooks/useAppBrowser";
import type { UseAppBrowserReturn } from "@/hooks/useAppBrowser";

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

// Re-export shared types from their canonical location
import type { DiscoveredLink } from "@/lib/ui-bridge/types";
export type { DiscoveredLink } from "@/lib/ui-bridge/types";

export type InspectorTab =
  | "elements"
  | "actions"
  | "accessibility"
  | "search"
  | "specs"
  | "api";

export interface UseInspectorReturn {
  // App browser (shared connection + page discovery)
  browser: UseAppBrowserReturn;

  // Tabs
  activeTab: InspectorTab;
  setActiveTab: (t: InspectorTab) => void;

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

  // Discovered links (from element discovery)
  discoveredLinks: DiscoveredLink[];

  // Page navigation
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

  // Delegate connection management to useAppBrowser
  const browser = useAppBrowser({ selfPathname: "/tools/inspector" });

  // Inspector-specific error state (connection errors come from browser)
  const [error, setError] = useState<string | null>(null);

  // Element state
  const [elements, setElements] = useState<ExternalElement[]>([]);
  const [selectedElement, setSelectedElement] =
    useState<ExternalElement | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  // Command history (for API tab)
  const [lastCommandResult, setLastCommandResult] =
    useState<CommandResult | null>(null);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>(
    []
  );
  const commandIdRef = useRef(0);

  // -------------------------------------------------------------------------
  // Element inspection
  // -------------------------------------------------------------------------

  const transformSdkElements = useCallback(
    (rawElems: unknown[]): ExternalElement[] =>
      transformSdkElementsPure(rawElems),
    []
  );

  const extractLinks = useCallback(
    (elems: ExternalElement[]): DiscoveredLink[] =>
      extractLinksPure(elems, browser.activeConnection?.url),
    [browser.activeConnection]
  );

  const discoverElements = useCallback(async () => {
    setIsDiscovering(true);
    setError(null);
    try {
      const raw = await runnerApi.uiBridgeDiscover({ interactive_only: false });
      const rawElems = unwrapElementResponse(raw);
      const elemList = transformSdkElements(rawElems);
      setElements(elemList);
      setSelectedElement(null);

      // Extract links and merge into browser's discovered links
      const links = extractLinks(elemList);
      browser.setDiscoveredLinks((prev) => {
        const existingUrls = new Set(prev.map((l) => l.url));
        const newLinks = links.filter((l) => !existingUrls.has(l.url));
        return newLinks.length > 0 ? [...prev, ...newLinks] : prev;
      });

      await browser.refreshTargets();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to discover elements"
      );
    } finally {
      setIsDiscovering(false);
    }
  }, [extractLinks, transformSdkElements, browser]);

  const navigateToPage = useCallback(
    async (url: string, tabId?: string) => {
      setIsNavigating(true);
      setError(null);
      try {
        const effectiveTabId = tabId ?? browser.selectedTargetId ?? undefined;
        await runnerApi.uiBridgePageNavigate(url, effectiveTabId);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await discoverElements();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Navigation failed");
      } finally {
        setIsNavigating(false);
      }
    },
    [discoverElements, browser.selectedTargetId]
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
      // Best effort
    }
  }, []);

  // -------------------------------------------------------------------------
  // Spec discovery
  // -------------------------------------------------------------------------

  const discoverSpecs = useCallback(async (): Promise<DiscoveredSpec[]> => {
    try {
      const raw = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
      const specs = unwrapSpecResponse(raw);
      if (specs.length > 0) {
        return specs.map((s) => {
          const obj = s as Record<string, unknown>;
          return { specId: obj.specId as string, config: obj.config };
        });
      }

      const snapRaw = await runnerApi.uiBridgeSnapshot();
      const snapSpecs = unwrapSpecResponse(snapRaw);
      return snapSpecs.map((s) => {
        const obj = s as Record<string, unknown>;
        return { specId: obj.specId as string, config: obj.config };
      });
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
  // Clear inspector state when active connection changes
  // -------------------------------------------------------------------------

  const activeConnectionUrl = browser.activeConnection?.url;
  const prevConnectionUrl = useRef(activeConnectionUrl);
  useEffect(() => {
    if (prevConnectionUrl.current !== activeConnectionUrl) {
      setElements([]);
      setSelectedElement(null);
      prevConnectionUrl.current = activeConnectionUrl;
    }
  }, [activeConnectionUrl]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    browser,

    activeTab,
    setActiveTab,

    elements,
    selectedElement,
    selectElement,
    discoverElements,
    isDiscovering,
    executeAction,
    highlightElement,

    discoverSpecs,

    discoveredLinks: browser.discoveredLinks,

    navigateToPage,
    isNavigating,

    sendCommand,
    commandHistory,
    lastCommandResult,
    clearCommandHistory,

    isConnected: browser.isConnected,
    error: error || browser.connectionError,
    isLoadingElements: isDiscovering,
  };
}
