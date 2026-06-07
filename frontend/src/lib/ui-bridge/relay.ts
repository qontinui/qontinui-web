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

// Cross-instance relay bus (P0a). On Vercel serverless each request can hit a
// different lambda instance, so a tab's SSE stream (held on instance A) is
// invisible to a `/control/*` command POST that lands on instance B — commands
// time out / 404. Setting `UI_BRIDGE_RELAY_REDIS_URL` to a shared Redis bridges
// instances so commands reach the tab and responses route back. When unset, the
// relay is single-process in-memory exactly as before (correct for the always-on
// runner/local-dev surfaces). Init failure degrades to in-memory rather than
// breaking the relay entirely.
const relayBus = await createRedisRelayBus(
  process.env.UI_BRIDGE_RELAY_REDIS_URL,
).catch((e) => {
  console.error(
    "[ui-bridge] Redis relay bus init failed; falling back to in-memory (cross-instance routing disabled):",
    e,
  );
  return null;
});

export const relay = new CommandRelay(relayBus ? { bus: relayBus } : undefined);
export const handlers = createRelayHandlers(relay, {
  version: "0.1.0",
  screenshotFallbackUrl: RUNNER_SCREENSHOT_URL,
  specs: initialSpecs,
});
