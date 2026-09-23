"use client";

/**
 * use-discovered-specs.ts
 *
 * React hooks over the runtime spec cache. The non-React loader and
 * cache state live in `./discovered-specs.ts`; the hooks bind them to the
 * active runner (`useRunnerTarget()`), and the cache is keyed by it.
 *
 * The loader functions (which take an explicit target) are re-exported
 * from this file for client-side ergonomics.
 */

import { useEffect, useState } from "react";
import { useRunnerTarget } from "@/contexts/active-runner-context";
import { targetKey } from "@/lib/runner/target";
import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";
import {
  loadDiscoveredSpecs,
  type SpecStreamState,
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

// Re-exported for client-side ergonomics.
export { loadDiscoveredSpecs, loadDiscoveredSpec } from "./discovered-specs";

interface UseDiscoveredSpecsResult {
  specs: DiscoveredSpec[];
  loading: boolean;
  error: Error | null;
  /**
   * Whether spec changes are pushed for the active runner. `unavailable`
   * (a relayed runner): the list is refreshed only on `refresh()`.
   */
  stream: SpecStreamState;
  refresh: () => Promise<void>;
}

/**
 * Subscribe to the spec cache and load the ACTIVE runner's specs (on mount
 * and whenever the active runner or its route changes).
 */
function useSpecCacheSubscription(): ReturnType<typeof useRunnerTarget> {
  const target = useRunnerTarget();
  const key = targetKey(target);
  const [, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const unsubscribe = __subscribeToSpecCache(bump);

    // Trigger the load for this target. Errors are captured into the
    // cache's error state and surfaced via the subscriber bump — no need
    // to handle here.
    if (__shouldTriggerInitialLoad(target)) {
      void loadDiscoveredSpecs(target).catch(() => {
        // Already handled by the loader; the bump will surface the error.
      });
    }

    return unsubscribe;
    // Keyed by the target's route key; the object identity may churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return target;
}

export function useDiscoveredSpecs(): UseDiscoveredSpecsResult {
  const target = useSpecCacheSubscription();
  const snapshot = __getSpecCacheSnapshot(target);

  const refresh = async (): Promise<void> => {
    try {
      await __refreshSpecCache(target);
    } catch {
      // Error is already captured; the subscriber bump surfaces it.
    }
  };

  return {
    specs: snapshot.specs ?? (EMPTY_SPECS as DiscoveredSpec[]),
    loading: snapshot.loading,
    error: snapshot.error,
    stream: snapshot.stream,
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
  const target = useSpecCacheSubscription();
  const { specs } = __getSpecCacheSnapshot(target);
  if (specs === null) return null;
  return specs.find((s) => s.specId === id) ?? null;
}
