/**
 * AutomationProvider
 *
 * React component that provides automation store context.
 * With Zustand, the store is global, so this is primarily a pass-through
 * component that can be used for initialization or compatibility.
 */

"use client";

import type { ReactNode } from "react";

interface AutomationProviderProps {
  children: ReactNode;
}

/**
 * AutomationProvider wraps children with automation store access.
 * Since Zustand stores are global, this is a simple pass-through.
 * It can be extended to handle initialization if needed.
 */
export function AutomationProvider({ children }: AutomationProviderProps) {
  // With Zustand, the store is global and doesn't need a provider.
  // This component exists for API compatibility and potential future
  // initialization logic.
  return <>{children}</>;
}
