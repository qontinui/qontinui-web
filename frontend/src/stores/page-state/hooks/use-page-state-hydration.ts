/**
 * Page State Hydration Hook
 *
 * Manages hydration and persistence lifecycle for page state stores.
 * Automatically loads state on mount and saves on unmount or before navigation.
 */

import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";

// Re-export store hooks for convenience
export { useImageExtractionStore } from "../image-extraction-store";

/**
 * Hook for Image Extraction page state hydration
 *
 * Usage:
 * ```tsx
 * const { isHydrated, isHydrating } = useImageExtractionPageState();
 * ```
 */
export function useImageExtractionPageState() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const { useImageExtractionStore } = require("../image-extraction-store");

  const hydrate = useImageExtractionStore((state: { hydrate: (projectName: string, userId: string) => Promise<void> }) => state.hydrate);
  const persist = useImageExtractionStore((state: { persist: () => Promise<void> }) => state.persist);
  const cleanup = useImageExtractionStore((state: { cleanup: () => void }) => state.cleanup);
  const isHydrated = useImageExtractionStore((state: { isHydrated: boolean }) => state.isHydrated);
  const isHydrating = useImageExtractionStore((state: { isHydrating: boolean }) => state.isHydrating);
  const hydrationError = useImageExtractionStore((state: { hydrationError: Error | null }) => state.hydrationError);

  const hasHydrated = useRef(false);
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate on mount
  useEffect(() => {
    if (user?.id && projectName && !hasHydrated.current) {
      hasHydrated.current = true;
      hydrate(projectName, user.id);
    }
  }, [user?.id, projectName, hydrate]);

  // Persist on unmount
  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      // Persist before cleanup
      persist().finally(() => {
        cleanup();
      });
    };
  }, [persist, cleanup]);

  // Debounced persist function
  const debouncedPersist = useCallback(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      persist();
    }, 500);
  }, [persist]);

  // Listen for beforeunload to persist
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Synchronous persist attempt (best effort)
      persist();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [persist]);

  return {
    isHydrated,
    isHydrating,
    hydrationError,
    persist: debouncedPersist,
  };
}

/**
 * Generic hook factory for other pages
 * Can be used to create similar hooks for other page stores
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
