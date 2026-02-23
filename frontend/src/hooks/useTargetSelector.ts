import { useState, useCallback, useEffect, useRef } from "react";
import { runnerApi } from "@/lib/runner/runner-api-object";

// =============================================================================
// Types
// =============================================================================

export interface Target {
  id: string;
  type: "web" | "desktop" | "mobile";
  label: string;
  appName: string;
  pathname?: string;
  url?: string;
  isSelf?: boolean;
}

export interface UseTargetSelectorOptions {
  /** Pathname of the current page — matching tabs are marked as disabled. */
  selfPathname?: string;
  /** Call uiBridgeScanDesktop() to include desktop apps. Default: false. */
  includeDesktop?: boolean;
  /** Future: include mobile targets. Default: false. */
  includeMobile?: boolean;
}

export interface UseTargetSelectorReturn {
  targets: Target[];
  selectedTargetId: string | null;
  setSelectedTargetId: (id: string | null) => void;
  refresh: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

// =============================================================================
// Hook
// =============================================================================

export function useTargetSelector(
  options?: UseTargetSelectorOptions
): UseTargetSelectorReturn {
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAutoSelected = useRef(false);

  const selfPathname = options?.selfPathname;
  const includeDesktop = options?.includeDesktop ?? false;

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const allTargets: Target[] = [];

      // Fetch web tabs
      try {
        const result = await runnerApi.uiBridgeTabs();
        const data = result as unknown as Record<string, unknown>;

        // Unwrap nested data envelope
        const inner =
          data?.data &&
          typeof data.data === "object" &&
          !Array.isArray(data.data)
            ? (data.data as Record<string, unknown>)
            : data;

        // Prefer tabsInfo (rich data) over plain tab IDs
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
          // Fallback: plain string tab IDs
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

      // Fetch desktop apps
      if (includeDesktop) {
        try {
          const result = await runnerApi.uiBridgeScanDesktop();
          const data = result as unknown as Record<string, unknown>;
          const apps = Array.isArray(data?.apps)
            ? (data.apps as Array<Record<string, unknown>>)
            : [];

          for (const app of apps) {
            const appName =
              (app.name as string) || (app.appName as string) || "Desktop App";
            allTargets.push({
              id: (app.id as string) || appName,
              type: "desktop",
              label: appName,
              appName,
            });
          }
        } catch {
          // Desktop scan not available
        }
      }

      setTargets(allTargets);

      // Auto-select first non-self target on initial fetch
      if (!hasAutoSelected.current && allTargets.length > 0) {
        const firstSelectable = allTargets.find((t) => !t.isSelf);
        if (firstSelectable) {
          setSelectedTargetId(firstSelectable.id);
        }
        hasAutoSelected.current = true;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch targets");
    } finally {
      setIsLoading(false);
    }
  }, [selfPathname, includeDesktop]);

  // Refresh on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    targets,
    selectedTargetId,
    setSelectedTargetId,
    refresh,
    isLoading,
    error,
  };
}
