"use client";

/**
 * use-discovered-specs.ts
 *
 * React hooks over the runtime spec loader (Section 13). The non-React
 * loader and module-scoped cache live in `./discovered-specs` (no
 * "use client" — server-safe). This file provides:
 *
 *   - `useDiscoveredSpecs()` — React hook returning the full list.
 *   - `useDiscoveredSpec(id)` — single-spec hook.
 *
 * Both subscribe to the same module-scoped cache used by the loaders,
 * so SSE-driven `spec.changed` invalidations re-render every consumer.
 *
 * The async loaders (`loadDiscoveredSpecs`, `loadDiscoveredSpec`) are
 * re-exported here for backward compatibility, but **server-side
 * callers must import from `./discovered-specs`** — importing from
 * this file pulls in a "use client" module and Next.js's RSC compiler
 * refuses to evaluate it from the server.
 */

import { useEffect, useState } from "react";
import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";
import {
  getDiscoveredSpecFromCache,
  getDiscoveredSpecsState,
  isDiscoveredSpecsCacheEmpty,
  loadDiscoveredSpec,
  loadDiscoveredSpecs,
  refreshDiscoveredSpecs,
  subscribeToSpecChanges,
} from "./discovered-specs";

// Re-export the loaders so client-side non-component code can keep
// importing from this path. New code should prefer `./discovered-specs`
// for consistency (and is required for server-side callers).
export { loadDiscoveredSpec, loadDiscoveredSpecs };

interface UseDiscoveredSpecsResult {
  specs: DiscoveredSpec[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useDiscoveredSpecs(): UseDiscoveredSpecsResult {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToSpecChanges(() => setVersion((v) => v + 1));

    // Trigger the load on first mount. Errors are captured into the
    // module-scoped cache state and surfaced via the subscriber bump
    // — no need to handle here.
    if (isDiscoveredSpecsCacheEmpty()) {
      void loadDiscoveredSpecs().catch(() => {
        // Already handled by the loader; the bump will surface the error.
      });
    }

    return unsubscribe;
  }, []);

  const state = getDiscoveredSpecsState();

  return {
    specs: state.specs,
    loading: state.loading,
    error: state.error,
    refresh: refreshDiscoveredSpecs,
  };
}

/**
 * Single-spec React hook. Subscribes to the same module-scoped cache
 * used by `useDiscoveredSpecs`, so it re-renders on cache updates and
 * SSE-driven `spec.changed` invalidations. Returns `null` while loading
 * or if the id is not present in the cache.
 */
export function useDiscoveredSpec(id: string): DiscoveredSpec | null {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToSpecChanges(() => setVersion((v) => v + 1));

    if (isDiscoveredSpecsCacheEmpty()) {
      void loadDiscoveredSpecs().catch(() => {
        // Already handled by the loader; the bump will surface the error.
      });
    }

    return unsubscribe;
  }, []);

  return getDiscoveredSpecFromCache(id);
}
