/**
 * Shared Automation Context
 *
 * This file exports the React Context and useAutomation hook that are shared
 * between the legacy AutomationProvider and the new V2 provider.
 *
 * This ensures that all components use the same context, regardless of which
 * provider is wrapping the app.
 */

"use client";

import { createContext, useContext } from "react";
import type { AutomationContextType } from "./types";

/**
 * The shared React Context for automation state.
 * Both AutomationProvider (legacy) and AutomationProviderV2 (bridge) use this context.
 */
export const AutomationContext = createContext<
  AutomationContextType | undefined
>(undefined);

/**
 * Hook to access automation context.
 * Throws if used outside of an AutomationProvider.
 */
export const useAutomation = (): AutomationContextType => {
  const context = useContext(AutomationContext);
  if (!context) {
    throw new Error("useAutomation must be used within an AutomationProvider");
  }
  return context;
};
