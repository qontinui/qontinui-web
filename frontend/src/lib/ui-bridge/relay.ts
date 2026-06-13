/**
 * UI Bridge Relay Setup
 *
 * Instantiates the SDK's CommandRelay and creates handlers backed by it.
 * This replaces ~4000 lines of custom relay code with ~10 lines of SDK usage.
 *
 * When the browser is unresponsive (no listeners, timeout, empty snapshot),
 * the handlers fall back to the runner's xcap-based screenshot endpoint
 * so that callers still get visual context of what's on screen.
 */

import {
  CommandRelay,
  createRelayHandlers,
  createRedisRelayBus,
} from "@qontinui/ui-bridge/server";
// ── @vercel/nft trace anchor (DO NOT REMOVE) ────────────────────────────────
// `createRedisRelayBus` (below) loads ioredis via a VARIABLE-specifier dynamic
// import so the SDK stays optional-dep-clean — but @vercel/nft cannot follow a
// computed-specifier import, so on Vercel ioredis was ABSENT from the serverless
// function and the bus died at boot with `Cannot find module 'ioredis'`,
// silently degrading to per-lambda in-memory state. With cross-instance routing
// off, a `/control/*` command POST that lands on a different lambda than the
// tab's SSE stream is never delivered — the co-pilot's navigate returns 200 but
// the page never moves (verified on prod via Vercel logs, 2026-06-07).
// `serverExternalPackages: ['ioredis']` in next.config.mjs keeps ioredis
// external/un-bundled; THIS static import is what makes nft actually COPY it
// (+ its transitive deps) into the function trace so the runtime require
// resolves. Exported so tree-shaking can never drop the import.
import IORedis from "ioredis";
export const __ioredisTraceAnchor: unknown = IORedis;
import { loadDiscoveredSpecs } from "./discovered-specs";

/** Runner screenshot endpoint — used as fallback when the browser relay is unresponsive */
const RUNNER_SCREENSHOT_URL = "http://localhost:9876/ui-bridge/sdk/screenshot";

// Pre-load specs from the runner's Spec API (Section 13 runtime loading).
// `createRelayHandlers` captures `specs` once at construction, so we await
// the initial load here. If the runner is unreachable at boot we fall back
// to an empty array — the cache will fill in as soon as the first browser
// request triggers a re-fetch (or when SSE delivers a `spec.changed`).
const initialSpecs = await loadDiscoveredSpecs().catch(() => []);

/**
 * Relay-bus transport mode, surfaced via `GET /api/ui-bridge/health`.
 *
 *  - `"redis"`            — a Redis bus is active (cross-instance routing on).
 *  - `"in-memory"`        — `UI_BRIDGE_RELAY_REDIS_URL` is unset; single-process
 *                           in-memory by design (correct for the always-on
 *                           runner / local-dev surfaces).
 *  - `"in-memory-degraded"` — a Redis URL WAS configured but the bus failed to
 *                           init, so we fell back to in-memory. On serverless
 *                           this silently disables cross-instance routing (the
 *                           "navigate returns 200 but the page never moves"
 *                           class), so it is reported distinctly for health
 *                           probes / alerting.
 */
export type RelayBusStatus = "redis" | "in-memory" | "in-memory-degraded";

let relayBusStatus: RelayBusStatus = "in-memory";

/** Current relay-bus transport mode. Read by the `/health` route. */
export function getRelayBusStatus(): RelayBusStatus {
  return relayBusStatus;
}

/**
 * Extract HOST[:port] from a redis connection string for structured logging.
 * Credentials (`user:pass@`) and path/query are dropped — we never log secrets.
 * Falls back to a constant marker if the URL is unparseable.
 */
function redisHostOnly(url: string): string {
  try {
    const u = new URL(url);
    return u.host || "<unknown-host>";
  } catch {
    return "<unparseable-url>";
  }
}

// Cross-instance relay bus (P0a). On Vercel serverless each request can hit a
// different lambda instance, so a tab's SSE stream (held on instance A) is
// invisible to a `/control/*` command POST that lands on instance B — commands
// time out / 404. Setting `UI_BRIDGE_RELAY_REDIS_URL` to a shared Redis bridges
// instances so commands reach the tab and responses route back. When unset, the
// relay is single-process in-memory exactly as before (correct for the always-on
// runner/local-dev surfaces). Init failure degrades to in-memory rather than
// breaking the relay entirely — UNLESS `UI_BRIDGE_RELAY_REQUIRE_REDIS=1`, in
// which case we fail fast so a serverless deploy never silently boots without
// cross-instance routing.
const relayRedisUrl = process.env.UI_BRIDGE_RELAY_REDIS_URL;
const requireRedis = process.env.UI_BRIDGE_RELAY_REQUIRE_REDIS === "1";

const relayBus = await createRedisRelayBus(relayRedisUrl).catch((e: unknown) => {
  // A Redis URL was configured (createRedisRelayBus only attempts a connection
  // when `url` is non-empty) but init threw → degraded. Record the flag,
  // warn with the HOST ONLY (never creds / full URL), and optionally fail fast.
  relayBusStatus = "in-memory-degraded";
  const host = relayRedisUrl ? redisHostOnly(relayRedisUrl) : "<unset>";
  console.warn(
    `[ui-bridge] Redis relay bus init FAILED (host=${host}); cross-instance ` +
      `routing is DISABLED — relay degraded to single-process in-memory. ` +
      `On serverless this can cause control commands to return 200 but never ` +
      `reach the tab. Set UI_BRIDGE_RELAY_REQUIRE_REDIS=1 to fail fast instead.`,
    e instanceof Error ? e.message : e,
  );
  if (requireRedis) {
    throw new Error(
      `[ui-bridge] UI_BRIDGE_RELAY_REQUIRE_REDIS=1 but Redis relay bus init ` +
        `failed (host=${host}); refusing to boot in degraded in-memory mode.`,
    );
  }
  return null;
});

// Reflect the successful-init / unset cases (the catch above already set
// "in-memory-degraded" on failure). A non-null bus means Redis is live; a null
// bus with a configured URL would have thrown into the catch, so a null bus
// here means the URL was unset → in-memory by design.
if (relayBus) {
  relayBusStatus = "redis";
}

export const relay = new CommandRelay(relayBus ? { bus: relayBus } : undefined);
export const handlers = createRelayHandlers(relay, {
  version: "0.1.0",
  screenshotFallbackUrl: RUNNER_SCREENSHOT_URL,
  specs: initialSpecs,
});
