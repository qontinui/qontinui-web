"use client";

/**
 * use-discovered-specs.ts
 *
 * React hooks over the runtime spec cache. The non-React loader and
 * cache state live in `./discovered-specs.ts` (universal — server-safe),
 * so server-side callers (Route Handlers, RSC, MCP) can import the
 * loaders directly from there without tripping Next.js's RSC boundary.
 *
 * The loader functions are re-exported from this file for backward
 * compatibility with existing client-side imports — but server-side
 * code MUST import them from `./discovered-specs` directly, since this
 * file is `"use client"`.
 */

import { useEffect, useState } from "react";
import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";
import {
  loadDiscoveredSpecs,
  __subscribeToSpecCache,
  __getSpecCacheSnapshot,
  __refreshSpecCache,
  __shouldTriggerInitialLoad,
} from "./discovered-specs";

// Stable reference for the empty case. Returning a fresh `[]` from the hook
// when the cache is null caused infinite re-render loops in any consumer that
// memo'd on the array identity (notably useSpecSourceState, which feeds the
// /build/workflows AiGeneratePanel). One module-level constant fixes it.
const EMPTY_SPECS: readonly DiscoveredSpec[] = Object.freeze([]);

// Re-exported for client-side ergonomics. Server-side callers must
// import from `./discovered-specs` instead — this module is `"use client"`.
export {
  loadDiscoveredSpecs,
  loadDiscoveredSpec,
} from "./discovered-specs";

interface UseDiscoveredSpecsResult {
  specs: DiscoveredSpec[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useDiscoveredSpecs(): UseDiscoveredSpecsResult {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const unsubscribe = __subscribeToSpecCache(bump);

    // Trigger the load on first mount. Errors are captured into the
    // module-scoped error state and surfaced via the subscriber bump —
    // no need to handle here.
    if (__shouldTriggerInitialLoad()) {
      void loadDiscoveredSpecs().catch(() => {
        // Already handled by the loader; the bump will surface the error.
      });
    }

    return unsubscribe;
  }, []);

  const snapshot = __getSpecCacheSnapshot();

  const refresh = async (): Promise<void> => {
    try {
      await __refreshSpecCache();
    } catch {
      // Error is already captured; the subscriber bump surfaces it.
    }
  };

  return {
    specs: snapshot.specs ?? (EMPTY_SPECS as DiscoveredSpec[]),
    loading: snapshot.loading,
    error: snapshot.error,
    refresh,
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
    const bump = () => setVersion((v) => v + 1);
    const unsubscribe = __subscribeToSpecCache(bump);

    if (__shouldTriggerInitialLoad()) {
      void loadDiscoveredSpecs().catch(() => {
        // Already handled by the loader; the bump will surface the error.
      });
    }

    return unsubscribe;
  }, []);

  const { specs } = __getSpecCacheSnapshot();
  if (specs === null) return null;
  return specs.find((s) => s.specId === id) ?? null;
}
