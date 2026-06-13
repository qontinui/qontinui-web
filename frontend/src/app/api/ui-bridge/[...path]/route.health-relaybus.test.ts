/**
 * Integration test for the `GET /health` relay-bus merge (friction-2).
 *
 * The SDK's `/health` returns transport diagnostics but has no notion of the
 * cross-instance relay BUS mode. The route handler merges
 * `relayBus: "redis" | "in-memory" | "in-memory-degraded"` from
 * `@/lib/ui-bridge/relay::getRelayBusStatus()` so a single probe reveals
 * whether cross-instance routing is live (the "navigate 200 but page never
 * moves" alerting signal on serverless).
 *
 * The relay module is mocked so the SDK `/health` handler returns a fixed
 * diagnostics body and `getRelayBusStatus` is controllable per case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { __resetAuthCache } from "./_auth";

let relayBusStatus: "redis" | "in-memory" | "in-memory-degraded" = "in-memory";

vi.mock("@/lib/ui-bridge/relay", () => {
  const healthHandler = async () =>
    new Response(
      JSON.stringify({ success: true, buildId: "test", connectedTabs: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  return {
    relay: {
      hasCommandListeners: () => true,
      getWebSocketClientCount: () => 1,
    },
    handlers: {
      GET: healthHandler,
      POST: healthHandler,
      PUT: healthHandler,
      DELETE: healthHandler,
    },
    getRelayBusStatus: () => relayBusStatus,
  };
});

vi.mock("@qontinui/ui-bridge/server", () => {
  const healthHandler = async () =>
    new Response(
      JSON.stringify({ success: true, buildId: "test", connectedTabs: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  return {
    createNextRouteHandlers: () => ({
      GET: healthHandler,
      POST: healthHandler,
      PUT: healthHandler,
      DELETE: healthHandler,
    }),
    createRedisRelayBus: async () => null,
    CommandRelay: class {
      hasCommandListeners() {
        return true;
      }
      getWebSocketClientCount() {
        return 1;
      }
    },
    createRelayHandlers: () => ({}),
    SSEManager: class {},
    UI_BRIDGE_ROUTES: [],
  };
});

import * as route from "./route";

function healthRequest(): NextRequest {
  return new NextRequest("http://localhost/api/ui-bridge/health", {
    method: "GET",
    headers: { origin: "https://qontinui.io" },
  });
}

function healthContext(): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path: ["health"] }) };
}

describe("GET /health relay-bus merge", () => {
  beforeEach(() => {
    __resetAuthCache();
    // Auth gate off (default) so /health is reachable anonymously.
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("merges relayBus:'in-memory' into the diagnostics body", async () => {
    relayBusStatus = "in-memory";
    const res = await route.GET(healthRequest(), healthContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.relayBus).toBe("in-memory");
    // SDK diagnostics fields are preserved.
    expect(body.buildId).toBe("test");
    expect(body.success).toBe(true);
  });

  it("reports 'redis' when the bus is live", async () => {
    relayBusStatus = "redis";
    const res = await route.GET(healthRequest(), healthContext());
    const body = await res.json();
    expect(body.relayBus).toBe("redis");
  });

  it("reports 'in-memory-degraded' when the bus failed to init", async () => {
    relayBusStatus = "in-memory-degraded";
    const res = await route.GET(healthRequest(), healthContext());
    const body = await res.json();
    expect(body.relayBus).toBe("in-memory-degraded");
  });
});
