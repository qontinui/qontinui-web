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

import type { ReactNode } from "react";
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

  return (
    <AutomationContext.Provider value={automationBridge}>
      {children}
    </AutomationContext.Provider>
  );
}

// Also export as AutomationProvider for direct replacement
export { AutomationProviderV2 as AutomationProvider };
