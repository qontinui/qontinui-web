/**
 * discovered-specs.ts
 *
 * Universal (server + client) runtime spec loader. Replaces the build-time
 * `getAllSpecs()` registry with a fetch from the runner's Spec API
 * (`GET http://localhost:9876/spec/list`), with module-singleton caching
 * and automatic SSE-driven invalidation on `spec.changed`.
 *
 * This module has zero React imports and no `"use client"` directive, so
 * it can be imported from server-side code (Next.js Route Handlers, RSC,
 * MCP, app boot) as well as client components. The React hooks live in
 * `./use-discovered-specs.ts` (which subscribes to the cache exposed
 * here).
 *
 * Entry points:
 *   - `loadDiscoveredSpecs()` — async loader for non-React contexts
 *     (relay handlers, app boot, RSC handlers, MCP).
 *   - `loadDiscoveredSpec(id)` — single-spec async accessor.
 *   - `__subscribeToSpecCache(fn)` — internal cache subscription used by
 *     the React hooks. Not for app-code use; prefer the hooks.
 *   - `__getSpecCacheSnapshot()` — internal snapshot for hook reads.
 */

import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";

const SPEC_LIST_URL = "http://localhost:9876/spec/list";
const SPEC_SUBSCRIBE_URL = "http://localhost:9876/spec/subscribe";

// =============================================================================
// Module-scoped state
// =============================================================================

let cachedSpecs: DiscoveredSpec[] | null = null;
let lastError: Error | null = null;
let inFlight: Promise<DiscoveredSpec[]> | null = null;
let sseInitialized = false;
let eventSource: EventSource | null = null;

const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // A misbehaving subscriber must not break siblings.
    }
  }
}

// =============================================================================
// SSE — lazy-init on first call to either entry point
// =============================================================================

function initSseOnce(): void {
  if (sseInitialized) return;
  sseInitialized = true;

  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    // SSR or environment without EventSource — skip cleanly. The cache
    // simply won't auto-invalidate. Explicit refresh() still works.
    return;
  }

  try {
    eventSource = new EventSource(SPEC_SUBSCRIBE_URL);
    eventSource.addEventListener("spec.changed", () => {
      // Invalidate the cache and refetch in the background. Subscribers
      // are notified twice: once when the cache clears (so reads return
      // stale data is avoided — they'll see loading), and once when the
      // refetch resolves.
      cachedSpecs = null;
      inFlight = null;
      notifySubscribers();
      void loadDiscoveredSpecs().catch(() => {
        // Errors are captured into `lastError` by the loader.
      });
    });
    eventSource.onerror = () => {
      // EventSource auto-reconnects; nothing to do. Don't log to avoid
      // console spam when the runner is offline.
    };
  } catch {
    // Defensive: if construction fails, leave `sseInitialized = true`
    // so we don't retry on every call.
    eventSource = null;
  }
}

// =============================================================================
// Async loader (non-React)
// =============================================================================

interface SpecListResponse {
  ok: boolean;
  specs?: DiscoveredSpec[];
  reason?: string;
}

async function fetchSpecs(): Promise<DiscoveredSpec[]> {
  const response = await fetch(SPEC_LIST_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `GET /spec/list failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const body = (await response.json()) as SpecListResponse;
  if (!body.ok) {
    throw new Error(
      `GET /spec/list returned ok=false${body.reason ? `: ${body.reason}` : ""}`
    );
  }

  return body.specs ?? [];
}

export async function loadDiscoveredSpecs(): Promise<DiscoveredSpec[]> {
  if (cachedSpecs !== null) {
    return cachedSpecs;
  }
  if (inFlight !== null) {
    return inFlight;
  }

  const promise = fetchSpecs()
    .then((specs) => {
      cachedSpecs = specs;
      lastError = null;
      inFlight = null;
      // Only open the SSE subscription once the runner has answered at
      // least one /spec/list request. Opening it eagerly (before the
      // fetch) keeps a perpetually-pending HTTP connection alive when
      // the runner is offline — browsers auto-reconnect EventSource on
      // error, so Playwright's `networkidle` never settles. The whole
      // E2E suite hits this on every page.goto + waitForLoadState pair.
      initSseOnce();
      notifySubscribers();
      return specs;
    })
    .catch((err: unknown) => {
      lastError = err instanceof Error ? err : new Error(String(err));
      inFlight = null;
      notifySubscribers();
      // Keep any previously cached array intact. Re-throw so callers see
      // the failure on first load; subsequent reads see the cache.
      throw lastError;
    });

  inFlight = promise;
  return promise;
}

/**
 * Single-spec async accessor for non-React contexts. Reuses the
 * module-singleton cache via `loadDiscoveredSpecs()`. Resolves to `null`
 * if no spec with the given id is loaded.
 */
export async function loadDiscoveredSpec(
  id: string
): Promise<DiscoveredSpec | null> {
  const specs = await loadDiscoveredSpecs();
  return specs.find((s) => s.specId === id) ?? null;
}

// =============================================================================
// Cache access for React hooks (internal — prefer the hooks in app code)
// =============================================================================

/**
 * @internal — used by `./use-discovered-specs.ts`. App code should use
 * `useDiscoveredSpecs` / `useDiscoveredSpec` instead.
 */
export function __subscribeToSpecCache(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** @internal — used by `./use-discovered-specs.ts`. */
export function __getSpecCacheSnapshot(): {
  specs: DiscoveredSpec[] | null;
  error: Error | null;
  loading: boolean;
} {
  return {
    specs: cachedSpecs,
    error: lastError,
    loading: inFlight !== null,
  };
}

/** @internal — invalidates the cache and triggers a fresh fetch. */
export function __refreshSpecCache(): Promise<DiscoveredSpec[]> {
  cachedSpecs = null;
  inFlight = null;
  notifySubscribers();
  return loadDiscoveredSpecs();
}

/** @internal — true iff the cache has never resolved or is mid-flight. */
export function __shouldTriggerInitialLoad(): boolean {
  return cachedSpecs === null && inFlight === null;
}
