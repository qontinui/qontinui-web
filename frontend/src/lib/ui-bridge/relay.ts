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

import { CommandRelay, createRelayHandlers } from "@qontinui/ui-bridge/server";
import { loadDiscoveredSpecs } from "./use-discovered-specs";

/** Runner screenshot endpoint — used as fallback when the browser relay is unresponsive */
const RUNNER_SCREENSHOT_URL = "http://localhost:9876/ui-bridge/sdk/screenshot";

// Pre-load specs from the runner's Spec API (Section 13 runtime loading).
// `createRelayHandlers` captures `specs` once at construction, so we await
// the initial load here. If the runner is unreachable at boot we fall back
// to an empty array — the cache will fill in as soon as the first browser
// request triggers a re-fetch (or when SSE delivers a `spec.changed`).
const initialSpecs = await loadDiscoveredSpecs().catch(() => []);

export const relay = new CommandRelay();
export const handlers = createRelayHandlers(relay, {
  version: "0.1.0",
  screenshotFallbackUrl: RUNNER_SCREENSHOT_URL,
  specs: initialSpecs,
});
