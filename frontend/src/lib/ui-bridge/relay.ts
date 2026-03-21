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
import { getAllSpecs } from "../spec-registry";

/** Runner screenshot endpoint — used as fallback when the browser relay is unresponsive */
const RUNNER_SCREENSHOT_URL = "http://localhost:9876/ui-bridge/sdk/screenshot";

export const relay = new CommandRelay();
export const handlers = createRelayHandlers(relay, {
  version: "0.1.0",
  screenshotFallbackUrl: RUNNER_SCREENSHOT_URL,
  specs: getAllSpecs(),
});
