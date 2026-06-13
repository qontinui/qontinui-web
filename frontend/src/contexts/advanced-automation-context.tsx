"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
} from "react";

/**
 * "Show advanced automation features" setting.
 *
 * When enabled, the workflow-authoring nav items flagged `hidden: true` in the
 * shared `@qontinui/navigation` package (Workflow Builder, Step Builders)
 * reappear in the web sidebar. The sidebar reads this reactively and calls
 * `setShowHiddenItems(enabled)` before rebuilding its navigation groups, so
 * toggling the setting updates the sidebar live (no reload). The route/tab ids
 * stay registered regardless — hiding only affects sidebar rendering, so
 * direct deep-links into `/build/workflows` and `/build/templates` keep
 * working.
 *
 * Persisted in localStorage (key `showAdvancedAutomation`, matching the runner)
 * so the preference survives reloads. This is a client-only UI preference;
 * default OFF.
 */

const STORAGE_KEY = "showAdvancedAutomation";

interface AdvancedAutomationContextValue {
  showAdvancedAutomation: boolean;
  setShowAdvancedAutomation: (show: boolean) => void;
}

const AdvancedAutomationContext =
  createContext<AdvancedAutomationContextValue>({
    showAdvancedAutomation: false,
    setShowAdvancedAutomation: () => {},
  });

export function AdvancedAutomationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showAdvancedAutomation, setShowState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      // Ignore (SSR / storage unavailable)
    }
    return false;
  });

  const setShowAdvancedAutomation = useCallback((show: boolean) => {
    setShowState(show);
    try {
      localStorage.setItem(STORAGE_KEY, show ? "true" : "false");
    } catch {
      // Ignore
    }
  }, []);

  return (
    <AdvancedAutomationContext.Provider
      value={{ showAdvancedAutomation, setShowAdvancedAutomation }}
    >
      {children}
    </AdvancedAutomationContext.Provider>
  );
}

export function useAdvancedAutomation() {
  return useContext(AdvancedAutomationContext);
}
