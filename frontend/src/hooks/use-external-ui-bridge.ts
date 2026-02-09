/**
 * useExternalUIBridge Hook (Web version)
 *
 * Connects to an external browser via the UI Bridge HTTP API at port 9876.
 * Web-compatible port of the runner's useExternalUIBridge.ts hook
 * (no Tauri dependencies — pure HTTP).
 */

import { useState, useCallback, useEffect, useRef } from "react";

// =============================================================================
// Types
// =============================================================================

export interface BrowserTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  favIconUrl?: string;
}

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
  title?: string;
  placeholder?: string;
  name?: string;
  inputType?: string;
  interactive?: boolean;
  tag?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface PageContext {
  url: string;
  title: string;
  elements: ExternalElement[];
  timestamp: number;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration?: number;
}

export interface PageScreenshot {
  data: string;
  capturedAt: number;
  viewport: { width: number; height: number };
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

// =============================================================================
// Constants
// =============================================================================

const RUNNER_API = "http://localhost:9876";
const MAX_COMMAND_HISTORY = 50;

// =============================================================================
// Hook
// =============================================================================

export interface UseExternalUIBridgeReturn {
  connectionStatus: ConnectionStatus;
  isExtensionConnected: boolean;
  connectedTabId: number | null;
  connectedTabInfo: BrowserTab | null;
  error: string | null;

  browserTabs: BrowserTab[];
  elements: ExternalElement[];
  pageContext: PageContext | null;

  pageScreenshot: PageScreenshot | null;
  isCapturingScreenshot: boolean;

  isLoadingTabs: boolean;
  isLoadingElements: boolean;

  selectedElementId: string | null;
  selectedElement: ExternalElement | null;
  selectElement: (elementId: string | null) => void;

  checkExtensionStatus: () => Promise<boolean>;
  refreshTabs: () => Promise<void>;
  connectToTab: (tabId: number) => Promise<void>;
  disconnect: () => void;
  refreshElements: () => Promise<void>;
  capturePageScreenshot: () => Promise<string | null>;
  executeAction: (
    elementId: string,
    action: string,
    params?: Record<string, unknown>
  ) => Promise<CommandResult>;
  highlightElement: (elementId: string) => Promise<void>;

  getSpecs: () => Promise<CommandResult<{ specs: DiscoveredSpec[] }>>;

  sendCommand: <T = unknown>(
    action: string,
    params?: Record<string, unknown>
  ) => Promise<CommandResult<T>>;
  lastCommandResult: CommandResult | null;
  commandHistory: CommandHistoryEntry[];
  clearCommandHistory: () => void;
}

export function useExternalUIBridge(): UseExternalUIBridgeReturn {
  // Connection state
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [isExtensionConnected, setIsExtensionConnected] = useState(false);
  const [connectedTabId, setConnectedTabId] = useState<number | null>(null);
  const [connectedTabInfo, setConnectedTabInfo] = useState<BrowserTab | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  // Data
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [elements, setElements] = useState<ExternalElement[]>([]);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);

  // Loading states
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);
  const [isLoadingElements, setIsLoadingElements] = useState(false);

  // Screenshot state
  const [pageScreenshot, setPageScreenshot] = useState<PageScreenshot | null>(
    null
  );
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  // Selection
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null
  );

  // Command history
  const [lastCommandResult, setLastCommandResult] =
    useState<CommandResult | null>(null);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>(
    []
  );
  const commandIdRef = useRef(0);

  // Stable refs for internal methods
  const connectedTabInfoRef = useRef(connectedTabInfo);
  connectedTabInfoRef.current = connectedTabInfo;

  const connectionStatusRef = useRef(connectionStatus);
  connectionStatusRef.current = connectionStatus;

  // Computed
  const selectedElement = selectedElementId
    ? elements.find((el) => el.id === selectedElementId) || null
    : null;

  /**
   * Send a command to the UI Bridge HTTP API
   */
  const sendCommand = useCallback(
    async <T = unknown>(
      action: string,
      params: Record<string, unknown> = {}
    ): Promise<CommandResult<T>> => {
      const startTime = Date.now();

      try {
        const response = await fetch(`${RUNNER_API}/extension/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, params }),
        });

        const duration = Date.now() - startTime;

        if (!response.ok) {
          const result: CommandResult<T> = {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
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

        const data = await response.json();
        const result: CommandResult<T> = {
          success: data.success,
          data: data.data as T,
          error: data.error,
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

  const checkExtensionStatus = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${RUNNER_API}/extension/status`);
      if (!response.ok) {
        setIsExtensionConnected(false);
        return false;
      }
      const data = await response.json();
      const connected = data.success && data.data?.connected === true;
      setIsExtensionConnected(connected);
      return connected;
    } catch {
      setIsExtensionConnected(false);
      return false;
    }
  }, []);

  const refreshTabs = useCallback(async () => {
    setIsLoadingTabs(true);
    setError(null);
    try {
      const result = await sendCommand<{ tabs: BrowserTab[] }>("listTabs");
      if (result.success && result.data?.tabs) {
        setBrowserTabs(result.data.tabs);
        setIsExtensionConnected(true);
      } else {
        setBrowserTabs([]);
        if (!result.success) setIsExtensionConnected(false);
      }
    } catch {
      setBrowserTabs([]);
      setIsExtensionConnected(false);
    } finally {
      setIsLoadingTabs(false);
    }
  }, [sendCommand]);

  /**
   * Internal element refresh
   */
  const refreshElementsInternal = useCallback(async () => {
    setIsLoadingElements(true);
    try {
      const result = await sendCommand<{ elements: ExternalElement[] }>(
        "getElements"
      );
      if (result.success && result.data?.elements) {
        setElements(result.data.elements);
        const tabInfo = connectedTabInfoRef.current;
        if (tabInfo) {
          setPageContext({
            url: tabInfo.url,
            title: tabInfo.title,
            elements: result.data.elements,
            timestamp: Date.now(),
          });
        }
      } else {
        setElements([]);
      }
    } catch {
      setElements([]);
    } finally {
      setIsLoadingElements(false);
    }
  }, [sendCommand]);

  const connectToTab = useCallback(
    async (tabId: number) => {
      setConnectionStatus("connecting");
      setError(null);

      try {
        const selectResult = await sendCommand<{
          title?: string;
          url?: string;
        }>("selectTab", { tabId });

        if (!selectResult.success) {
          throw new Error(selectResult.error || "Failed to select tab");
        }

        const connectResult = await sendCommand("connect");
        if (!connectResult.success) {
          throw new Error(
            connectResult.error || "UI Bridge not available on this page"
          );
        }

        const tabInfo = browserTabs.find((t) => t.id === tabId) || {
          id: tabId,
          url: selectResult.data?.url || "",
          title: selectResult.data?.title || `Tab ${tabId}`,
          active: true,
          windowId: 0,
        };

        setConnectedTabId(tabId);
        setConnectedTabInfo(tabInfo);
        setConnectionStatus("connected");

        // Auto-refresh elements after connecting
        await refreshElementsInternal();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to connect to tab"
        );
        setConnectionStatus("error");
        setConnectedTabId(null);
        setConnectedTabInfo(null);
      }
    },
    [browserTabs, sendCommand, refreshElementsInternal]
  );

  const disconnect = useCallback(() => {
    if (connectedTabId !== null) {
      sendCommand("clearSelectedTab").catch(() => {});
    }
    setConnectedTabId(null);
    setConnectedTabInfo(null);
    setConnectionStatus("disconnected");
    setElements([]);
    setPageContext(null);
    setPageScreenshot(null);
    setSelectedElementId(null);
    setError(null);
  }, [connectedTabId, sendCommand]);

  const refreshElements = useCallback(async () => {
    if (connectionStatusRef.current !== "connected") return;
    await refreshElementsInternal();
  }, [refreshElementsInternal]);

  const selectElement = useCallback((elementId: string | null) => {
    setSelectedElementId(elementId);
  }, []);

  const executeAction = useCallback(
    async (
      elementId: string,
      action: string,
      params: Record<string, unknown> = {}
    ): Promise<CommandResult> => {
      if (connectionStatusRef.current !== "connected") {
        return { success: false, error: "Not connected to a browser tab" };
      }
      const result = await sendCommand("executeAction", {
        elementId,
        action,
        params,
      });
      if (result.success) {
        await refreshElementsInternal();
      }
      return result;
    },
    [sendCommand, refreshElementsInternal]
  );

  const highlightElement = useCallback(
    async (elementId: string) => {
      if (connectionStatusRef.current !== "connected") return;
      await sendCommand("highlightElement", { elementId });
    },
    [sendCommand]
  );

  const capturePageScreenshot = useCallback(async (): Promise<
    string | null
  > => {
    if (connectionStatusRef.current !== "connected") return null;
    setIsCapturingScreenshot(true);
    try {
      const result = await sendCommand<{
        screenshot: string;
        capturedAt: number;
        viewport: { width: number; height: number };
      }>("capturePageScreenshot", {});
      if (result.success && result.data?.screenshot) {
        setPageScreenshot({
          data: result.data.screenshot,
          capturedAt: result.data.capturedAt,
          viewport: result.data.viewport,
        });
        return result.data.screenshot;
      }
      return null;
    } catch {
      return null;
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [sendCommand]);

  const getSpecs = useCallback(async () => {
    if (connectionStatusRef.current !== "connected") {
      return {
        success: false,
        error: "Not connected to a browser tab",
      } as CommandResult<{ specs: DiscoveredSpec[] }>;
    }
    return sendCommand<{ specs: DiscoveredSpec[] }>("getSpecs");
  }, [sendCommand]);

  // Check extension status on mount
  useEffect(() => {
    checkExtensionStatus();
  }, [checkExtensionStatus]);

  // Periodic status check when disconnected
  useEffect(() => {
    if (connectionStatus === "disconnected") {
      const interval = setInterval(() => {
        checkExtensionStatus();
      }, 5000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [connectionStatus, checkExtensionStatus]);

  return {
    connectionStatus,
    isExtensionConnected,
    connectedTabId,
    connectedTabInfo,
    error,

    browserTabs,
    elements,
    pageContext,

    pageScreenshot,
    isCapturingScreenshot,

    isLoadingTabs,
    isLoadingElements,

    selectedElementId,
    selectedElement,
    selectElement,

    checkExtensionStatus,
    refreshTabs,
    connectToTab,
    disconnect,
    refreshElements,
    capturePageScreenshot,
    executeAction,
    highlightElement,

    getSpecs,

    sendCommand,
    lastCommandResult,
    commandHistory,
    clearCommandHistory,
  };
}

export default useExternalUIBridge;
