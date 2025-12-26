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

    // Keep stable refs to store methods to avoid infinite loops
    // Zustand's useStore returns a new object on every render, but the
    // methods themselves are stable references
    const storeRef = useRef(store);
    storeRef.current = store;

    const hasHydrated = useRef(false);
    const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Hydrate on mount
    useEffect(() => {
      if (user?.id && projectName && !hasHydrated.current) {
        hasHydrated.current = true;
        storeRef.current.hydrate(projectName, user.id);
      }
    }, [user?.id, projectName]); // Don't depend on store to avoid infinite loops

    // Persist on unmount
    useEffect(() => {
      return () => {
        if (persistTimeoutRef.current) {
          clearTimeout(persistTimeoutRef.current);
        }
        storeRef.current.persist().finally(() => {
          storeRef.current.cleanup();
        });
      };
    }, []); // Only run on unmount

    // Debounced persist
    const debouncedPersist = useCallback(() => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      persistTimeoutRef.current = setTimeout(() => {
        storeRef.current.persist();
      }, 500);
    }, []);

    // beforeunload handler
    useEffect(() => {
      const handleBeforeUnload = () => {
        storeRef.current.persist();
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    }, []);

    return {
      ...store,
      persist: debouncedPersist,
    };
  };
}
