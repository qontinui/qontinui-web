/**
 * discovered-specs.ts
 *
 * Runtime spec loader. Replaces the build-time `getAllSpecs()` registry
 * with a fetch from the runner's multi-tenant Spec API
 * (`GET /apps/qontinui-web/spec/list` on the TARGET runner, through the
 * per-request transport resolver: loopback for a runner proven local, the
 * backend relay otherwise), with a module-singleton cache KEYED BY TARGET
 * (`targetKey`) — one runner's specs are never served as another's — and
 * SSE-driven invalidation on `spec.changed` where a stream can exist.
 *
 * This module has zero React imports. The React hooks live in
 * `./use-discovered-specs.ts` (which subscribes to the cache exposed here
 * and passes the active runner's target). Every loader names its target:
 * there is no global runner. Server-side code has no runner target at all
 * (it cannot reach the user's runner), so it does not load specs.
 *
 * Entry points:
 *   - `loadDiscoveredSpecs(target)` — async loader for non-React contexts.
 *   - `loadDiscoveredSpec(target, id)` — single-spec async accessor.
 *   - `__subscribeToSpecCache(fn)` — internal cache subscription used by
 *     the React hooks. Not for app-code use; prefer the hooks.
 *   - `__getSpecCacheSnapshot(target)` — internal snapshot for hook reads.
 */

// The loopback-origin gate, re-exported for other runner consumers (e.g.
// RunnerOfflineState) so it stays in one place: `@/lib/runner/origin`.
export { isRunnerReachable } from "@/lib/runner/origin";
import { runnerRequest } from "@/lib/runner/api-client";
import {
  routeOfTarget,
  runnerLoopbackUrl,
  targetKey,
  type RunnerTarget,
} from "@/lib/runner/target";
import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";

// spec-multi-app Stream F.4: the runner's Spec API is multi-tenant since
// 2026-05-20. Web specs are addressed via the `qontinui-web` app id.
const SPEC_LIST_PATH = "/apps/qontinui-web/spec/list";
const SPEC_SUBSCRIBE_PATH = "/apps/qontinui-web/spec/subscribe";

/**
 * Whether spec-change events can reach this page for a target.
 *
 * - `live`        — an EventSource is (being) held on the target's loopback
 *                   route; the cache auto-invalidates on `spec.changed`.
 * - `unavailable` — no stream can exist (the target is reached through the
 *                   relay, which carries no SSE, or nothing is resolved yet):
 *                   the cache does NOT auto-invalidate. Changes are seen on
 *                   an explicit refresh only — silence is not "unchanged".
 */
export type SpecStreamState = "live" | "unavailable";

// =============================================================================
// Module-scoped state, keyed by target
// =============================================================================

interface SpecCacheEntry {
  specs: DiscoveredSpec[] | null;
  error: Error | null;
  inFlight: Promise<DiscoveredSpec[]> | null;
}

const cache = new Map<string, SpecCacheEntry>();

function entryFor(key: string): SpecCacheEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { specs: null, error: null, inFlight: null };
    cache.set(key, entry);
  }
  return entry;
}

/**
 * A target whose route is not resolved yet (`measuring`) has no stable key:
 * its answer could come from whichever runner it settles on, so nothing is
 * cached under it.
 */
function isCacheableTarget(target: RunnerTarget): boolean {
  return routeOfTarget(target).kind !== "measuring";
}

/** The one spec-change stream, for the loopback URL it was opened on. */
let eventSource: EventSource | null = null;
let eventSourceUrl: string | null = null;

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
// SSE — lazy-init once the target's runner has answered a /spec/list
// =============================================================================

function initSse(target: RunnerTarget): void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    // SSR or environment without EventSource — skip cleanly. The cache
    // simply won't auto-invalidate. Explicit refresh() still works.
    return;
  }

  // EventSource cannot ride the relay: a stream exists ONLY for a loopback
  // route (a runner proven local, or the empty-list default).
  const url = runnerLoopbackUrl(target, SPEC_SUBSCRIBE_PATH);
  if (url === null || url === eventSourceUrl) return;

  // One stream at a time: the previous target's stream is closed.
  eventSource?.close();
  eventSource = null;
  eventSourceUrl = url;
  const key = targetKey(target);

  try {
    eventSource = new EventSource(url);
    eventSource.addEventListener("spec.changed", () => {
      // Invalidate this target's cache and refetch in the background.
      // Subscribers are notified twice: once when the cache clears (so
      // reads see loading rather than stale data), and once when the
      // refetch resolves.
      const entry = entryFor(key);
      entry.specs = null;
      entry.inFlight = null;
      notifySubscribers();
      void loadDiscoveredSpecs(target).catch(() => {
        // Errors are captured into the entry's `error` by the loader.
      });
    });
    eventSource.onerror = () => {
      // EventSource auto-reconnects; nothing to do. Don't log to avoid
      // console spam when the runner is offline.
    };
  } catch {
    // Defensive: if construction fails, keep `eventSourceUrl` so we don't
    // retry on every call.
    eventSource = null;
  }
}

/** Whether spec-change events can reach this page for `target`. */
export function specStreamState(target: RunnerTarget): SpecStreamState {
  const url = runnerLoopbackUrl(target, SPEC_SUBSCRIBE_PATH);
  return url !== null && url === eventSourceUrl && eventSource !== null
    ? "live"
    : "unavailable";
}

// =============================================================================
// Async loader (non-React)
// =============================================================================

interface SpecListResponse {
  ok: boolean;
  specs?: DiscoveredSpec[];
  reason?: string;
}

async function fetchSpecs(target: RunnerTarget): Promise<DiscoveredSpec[]> {
  // The resolver decides the transport — and refuses (typed error) when no
  // runner can be addressed, rather than a silent empty list.
  const response = await runnerRequest(target, SPEC_LIST_PATH, {
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

export async function loadDiscoveredSpecs(
  target: RunnerTarget
): Promise<DiscoveredSpec[]> {
  if (!isCacheableTarget(target)) {
    return fetchSpecs(target);
  }
  const key = targetKey(target);
  const entry = entryFor(key);
  if (entry.specs !== null) {
    return entry.specs;
  }
  if (entry.inFlight !== null) {
    return entry.inFlight;
  }

  const promise = fetchSpecs(target)
    .then((specs) => {
      entry.specs = specs;
      entry.error = null;
      entry.inFlight = null;
      // Only open the SSE subscription once the runner has answered at
      // least one /spec/list request. Opening it eagerly (before the
      // fetch) keeps a perpetually-pending HTTP connection alive when
      // the runner is offline — browsers auto-reconnect EventSource on
      // error, so Playwright's `networkidle` never settles. The whole
      // E2E suite hits this on every page.goto + waitForLoadState pair.
      initSse(target);
      notifySubscribers();
      return specs;
    })
    .catch((err: unknown) => {
      entry.error = err instanceof Error ? err : new Error(String(err));
      entry.inFlight = null;
      notifySubscribers();
      // Keep any previously cached array intact. Re-throw so callers see
      // the failure on first load; subsequent reads see the cache.
      throw entry.error;
    });

  entry.inFlight = promise;
  return promise;
}

/**
 * Single-spec async accessor for non-React contexts. Reuses the
 * target's cache via `loadDiscoveredSpecs(target)`. Resolves to `null`
 * if no spec with the given id is loaded.
 */
export async function loadDiscoveredSpec(
  target: RunnerTarget,
  id: string
): Promise<DiscoveredSpec | null> {
  const specs = await loadDiscoveredSpecs(target);
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

/**
 * @internal — used by `./use-discovered-specs.ts`. A target whose route is
 * not resolved yet reads as loading.
 */
export function __getSpecCacheSnapshot(target: RunnerTarget): {
  specs: DiscoveredSpec[] | null;
  error: Error | null;
  loading: boolean;
  stream: SpecStreamState;
} {
  if (!isCacheableTarget(target)) {
    return { specs: null, error: null, loading: true, stream: "unavailable" };
  }
  const entry = cache.get(targetKey(target));
  return {
    specs: entry?.specs ?? null,
    error: entry?.error ?? null,
    loading: entry?.inFlight != null,
    stream: specStreamState(target),
  };
}

/** @internal — invalidates the target's cache and triggers a fresh fetch. */
export function __refreshSpecCache(
  target: RunnerTarget
): Promise<DiscoveredSpec[]> {
  if (isCacheableTarget(target)) {
    const entry = entryFor(targetKey(target));
    entry.specs = null;
    entry.inFlight = null;
  }
  notifySubscribers();
  return loadDiscoveredSpecs(target);
}

/**
 * @internal — true iff the target's cache has never resolved and nothing is
 * in flight. False for a target whose route is not resolved yet (nothing is
 * loaded until it is).
 */
export function __shouldTriggerInitialLoad(target: RunnerTarget): boolean {
  if (!isCacheableTarget(target)) return false;
  const entry = cache.get(targetKey(target));
  return !entry || (entry.specs === null && entry.inFlight === null);
}
