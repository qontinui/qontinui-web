/**
 * AutomationProvider V2
 *
 * Simplified provider that delegates all state management to Zustand store.
 * This eliminates the dual-state problem by making Zustand the single source of truth.
 *
 * ARCHITECTURE:
 * - Zustand store is the SINGLE source of truth for all automation data
 * - This provider simply wraps children with the context that uses the Zustand bridge
 * - No duplicate state management (no useState for data)
 * - Persistence is handled by Zustand store subscriptions
 *
 * MIGRATION:
 * - Set NEXT_PUBLIC_USE_ZUSTAND_BRIDGE=true to enable this provider
 * - Components using useAutomation() will continue to work unchanged
 * - Eventually, components should migrate to useAutomationStore() directly
 */

"use client";

import { type ReactNode, useMemo } from "react";
import { useAutomationBridge } from "@/lib/persistence/zustand-bridge";
import { AutomationContext } from "./context";

// Re-export useAutomation from shared context
export { useAutomation } from "./context";

interface AutomationProviderProps {
  children: ReactNode;
}

/**
 * AutomationProvider V2 - Simplified provider using Zustand bridge.
 *
 * This provider eliminates the dual-state problem by:
 * 1. Not maintaining its own useState-based state
 * 2. Delegating all state access and mutations to the Zustand store via the bridge
 * 3. Relying on Zustand store subscriptions for persistence
 */
export function AutomationProviderV2({ children }: AutomationProviderProps) {
  // Get the bridge - this is the full AutomationContextType interface
  // backed by the Zustand store
  const automationBridge = useAutomationBridge();

  // Memoize the context value based on data properties only.
  // The bridge creates a new object every render (due to useAutomationStore()
  // subscribing to the entire store), but the context value should only change
  // when actual data properties change. This prevents cascading re-renders
  // of all useAutomation() consumers on every store update.
  // The bridge object is recreated every render by useAutomationStore(), so including
  // it in deps would defeat memoization. We list individual data properties to re-memoize only when
  // actual data changes, preventing cascading re-renders of all useAutomation() consumers.
  /* eslint-disable react-hooks/exhaustive-deps */
  const contextValue = useMemo(
    () => automationBridge,
    [
      automationBridge.projectName,
      automationBridge.projectId,
      automationBridge.workflows,
      automationBridge.states,
      automationBridge.transitions,
      automationBridge.images,
      automationBridge.screenshots,
      automationBridge.categories,
      automationBridge.settings,
      automationBridge.schedules,
      automationBridge.executionRecords,
      automationBridge.lastSaved,
      automationBridge.isLoadingFromBackend,
    ]
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <AutomationContext.Provider value={contextValue}>
      {children}
    </AutomationContext.Provider>
  );
}

// Also export as AutomationProvider for direct replacement
export { AutomationProviderV2 as AutomationProvider };
