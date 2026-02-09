/**
 * useInspector Hook
 *
 * Composition hook for the unified Inspector page.
 * Auto-detects available connections (browser extension, desktop runner).
 * The active element source switches automatically based on the last
 * connect/discover action — no manual mode selection.
 */

import { useState, useCallback, useRef } from "react";
import {
  useExternalUIBridge,
  type ExternalElement,
  type CommandResult,
  type DiscoveredSpec,
  type UseExternalUIBridgeReturn,
} from "@/hooks/use-external-ui-bridge";

// =============================================================================
// Types
// =============================================================================

/** Which connection provided the current elements */
export type ActiveSource = "browser" | "desktop" | null;

export type InspectorTab =
  | "elements"
  | "actions"
  | "accessibility"
  | "search"
  | "specs"
  | "api";

const RUNNER_API_BASE = "http://localhost:9876";

export interface DesktopState {
  elements: ExternalElement[];
  selectedElement: ExternalElement | null;
  isDiscovering: boolean;
  error: string | null;
  discover: () => Promise<void>;
  selectElement: (el: ExternalElement | null) => void;
  executeAction: (
    elId: string,
    action: string,
    params?: Record<string, unknown>
  ) => Promise<CommandResult>;
  discoverSpecs: () => Promise<DiscoveredSpec[]>;
}

export interface UseInspectorReturn {
  // Active source (auto-set by last connect/discover action)
  activeSource: ActiveSource;

  // Tabs (all always available)
  activeTab: InspectorTab;
  setActiveTab: (t: InspectorTab) => void;

  // Browser connection (delegates to useExternalUIBridge)
  bridge: UseExternalUIBridgeReturn;

  // Desktop connection
  desktop: DesktopState;

  // Unified accessors (resolve based on activeSource)
  elements: ExternalElement[];
  selectedElement: ExternalElement | null;
  selectElement: (el: ExternalElement | null) => void;
  isConnected: boolean;
  error: string | null;
  isLoadingElements: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useInspector(): UseInspectorReturn {
  const [activeSource, setActiveSource] = useState<ActiveSource>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("elements");

  // Browser connection via existing hook (always called unconditionally)
  const bridge = useExternalUIBridge();

  // Desktop control-mode state
  const [desktopElements, setDesktopElements] = useState<ExternalElement[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [selectedDesktopElement, setSelectedDesktopElement] =
    useState<ExternalElement | null>(null);

  const activeSourceRef = useRef(activeSource);
  activeSourceRef.current = activeSource;

  // Desktop: discover elements via control endpoints
  // Automatically sets activeSource to "desktop"
  const discoverDesktopElements = useCallback(async () => {
    setIsDiscovering(true);
    setDesktopError(null);
    try {
      const discoverRes = await fetch(
        `${RUNNER_API_BASE}/ui-bridge/control/discover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interactive_only: false }),
        }
      );
      if (!discoverRes.ok)
        throw new Error(`Discover failed: ${discoverRes.status}`);

      const elemRes = await fetch(
        `${RUNNER_API_BASE}/ui-bridge/control/elements`
      );
      if (!elemRes.ok)
        throw new Error(`Elements fetch failed: ${elemRes.status}`);

      const data = await elemRes.json();
      const elemList: ExternalElement[] = Array.isArray(data)
        ? data
        : (data.elements ?? []);
      setDesktopElements(elemList);
      setSelectedDesktopElement(null);
      setActiveSource("desktop");
    } catch (err) {
      setDesktopError(
        err instanceof Error ? err.message : "Failed to discover elements"
      );
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  // Desktop: execute action
  const desktopExecuteAction = useCallback(
    async (
      elId: string,
      action: string,
      params?: Record<string, unknown>
    ): Promise<CommandResult> => {
      try {
        const res = await fetch(
          `${RUNNER_API_BASE}/ui-bridge/control/element/${elId}/action`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, params }),
          }
        );
        if (!res.ok) throw new Error(`Action failed: ${res.status}`);
        return { success: true, data: undefined };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Action failed",
        };
      }
    },
    []
  );

  // Desktop: discover specs from runner snapshot
  const desktopDiscoverSpecs = useCallback(async (): Promise<
    DiscoveredSpec[]
  > => {
    try {
      const res = await fetch(`${RUNNER_API_BASE}/ui-bridge/control/snapshot`);
      if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
      const snapshot = await res.json();
      const specStore = snapshot?.specStore || snapshot?.specs;
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

  const desktop: DesktopState = {
    elements: desktopElements,
    selectedElement: selectedDesktopElement,
    isDiscovering,
    error: desktopError,
    discover: discoverDesktopElements,
    selectElement: setSelectedDesktopElement,
    executeAction: desktopExecuteAction,
    discoverSpecs: desktopDiscoverSpecs,
  };

  // Auto-set activeSource to "browser" when a browser tab connection succeeds
  // (the bridge hook handles connection internally; we observe its status)
  const prevBrowserConnected = useRef(false);
  const isBrowserConnected = bridge.connectionStatus === "connected";
  if (isBrowserConnected && !prevBrowserConnected.current) {
    // Just became connected — switch source to browser
    setActiveSource("browser");
  }
  prevBrowserConnected.current = isBrowserConnected;

  // Unified accessors
  const elements =
    activeSource === "desktop" ? desktopElements : bridge.elements;
  const selectedElement =
    activeSource === "desktop"
      ? selectedDesktopElement
      : bridge.selectedElement;
  const selectElement = useCallback(
    (el: ExternalElement | null) => {
      if (activeSourceRef.current === "desktop") {
        setSelectedDesktopElement(el);
      } else {
        bridge.selectElement(el?.id ?? null);
      }
    },
    [bridge]
  );
  const isConnected = activeSource === "desktop" ? true : isBrowserConnected;
  const error = activeSource === "desktop" ? desktopError : bridge.error;
  const isLoadingElements =
    activeSource === "desktop" ? isDiscovering : bridge.isLoadingElements;

  return {
    activeSource,
    activeTab,
    setActiveTab,
    bridge,
    desktop,
    elements,
    selectedElement,
    selectElement,
    isConnected,
    error,
    isLoadingElements,
  };
}
