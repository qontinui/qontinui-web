/**
 * Page State Hydration Hook Factory
 *
 * Creates hooks that manage hydration and persistence lifecycle for page state stores.
 * Automatically loads state on mount and saves on unmount or before navigation.
 */

import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";

/**
 * Generic hook factory for page state stores
 * Can be used to create hydration hooks for any page store that follows the pattern
 */
export function createPageStateHook<T>(
  useStore: () => {
    hydrate: (projectName: string, userId: string) => Promise<void>;
    persist: () => Promise<void>;
    cleanup: () => void;
    isHydrated: boolean;
    isHydrating: boolean;
    hydrationError: Error | null;
  } & T
) {
  return function usePageState() {
    const { user } = useAuth();
    const { projectName } = useAutomation();
    const store = useStore();

    const hasHydrated = useRef(false);
    const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Hydrate on mount
    useEffect(() => {
      if (user?.id && projectName && !hasHydrated.current) {
        hasHydrated.current = true;
        store.hydrate(projectName, user.id);
      }
    }, [user?.id, projectName, store]);

    // Persist on unmount
    useEffect(() => {
      return () => {
        if (persistTimeoutRef.current) {
          clearTimeout(persistTimeoutRef.current);
        }
        store.persist().finally(() => {
          store.cleanup();
        });
      };
    }, [store]);

    // Debounced persist
    const debouncedPersist = useCallback(() => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      persistTimeoutRef.current = setTimeout(() => {
        store.persist();
      }, 500);
    }, [store]);

    // beforeunload handler
    useEffect(() => {
      const handleBeforeUnload = () => {
        store.persist();
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    }, [store]);

    return {
      ...store,
      persist: debouncedPersist,
    };
  };
}
