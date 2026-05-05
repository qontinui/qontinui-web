/**
 * discovered-specs.ts
 *
 * Server-safe runtime spec loader (Section 13). The split companion to
 * `use-discovered-specs.ts`: this file has no "use client" directive
 * and can be imported from server-side contexts (RSC, route handlers,
 * relay setup, app boot before any browser exists).
 *
 * Public surface:
 *   - `loadDiscoveredSpecs()` — async loader for non-React contexts.
 *   - `loadDiscoveredSpec(id)` — single-spec async accessor.
 *
 * The state and SSE wiring live here; `use-discovered-specs.ts` builds
 * its hooks on top of the helpers exported below (`subscribeToSpecChanges`,
 * `getDiscoveredSpecsState`, `refreshDiscoveredSpecs`). Both modules
 * share the same module-scoped cache so the React tree and any
 * server-rendered or relay-scoped consumer fan out to a single fetch.
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
  initSseOnce();

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
// Internal API for use-discovered-specs.ts hooks
//
// React hooks live in a sibling "use client" module so they can call
// React hooks; they read the same module-scoped cache via these helpers.
// Not part of the public consumer API — import the loaders or hooks
// instead.
// =============================================================================

export interface DiscoveredSpecsCacheState {
  specs: DiscoveredSpec[];
  loading: boolean;
  error: Error | null;
}

export function subscribeToSpecChanges(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function getDiscoveredSpecsState(): DiscoveredSpecsCacheState {
  return {
    specs: cachedSpecs ?? [],
    loading: inFlight !== null,
    error: lastError,
  };
}

export function isDiscoveredSpecsCacheEmpty(): boolean {
  return cachedSpecs === null && inFlight === null;
}

export function getDiscoveredSpecFromCache(id: string): DiscoveredSpec | null {
  if (cachedSpecs === null) return null;
  return cachedSpecs.find((s) => s.specId === id) ?? null;
}

export async function refreshDiscoveredSpecs(): Promise<void> {
  cachedSpecs = null;
  inFlight = null;
  notifySubscribers();
  try {
    await loadDiscoveredSpecs();
  } catch {
    // Error is already captured; the subscriber bump surfaces it.
  }
}
