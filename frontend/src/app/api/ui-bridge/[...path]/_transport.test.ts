/**
 * Tests for the SDK transport classification (`_transport.ts`): which
 * relay requests are the SDK's own bookkeeping, which sub-lane each bills,
 * and the SDK cadences the transport ceilings are derived from.
 *
 * The classification is exact and method-qualified, so the method dimension
 * is enumerated in full rather than sampled: every path below is crossed
 * with every method the route can see. Values are literals, never the
 * module's constants.
 */

import { describe, expect, it } from "vitest";

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEATS_PER_TAB_PER_MIN,
  isSdkTransportRoute,
  RELAY_COMMAND_STREAM_HEARTBEAT_MS,
  RELAY_RESULTS_PER_TAB_PER_MIN,
  RELAY_SNAPSHOTS_PER_STREAM_OPEN,
  SDK_TRANSPORT_ROUTES,
  sdkTransportLane,
  SSE_RECONNECT_DELAY_MS,
  STREAM_OPENS_PER_TAB_PER_MIN,
} from "./_transport";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

/** The only three (method, path) pairs that are transport, with their lane. */
const TRANSPORT: Record<string, string> = {
  "GET /commands/stream": "stream",
  "POST /heartbeat": "heartbeat",
  "POST /commands": "result",
};

/** Paths crossed with every method: the three, their near misses, and relay routes that are NOT transport. */
const PATHS = [
  "/commands/stream",
  "/heartbeat",
  "/commands",
  // near misses: suffixes, trailing slashes, case, the mounted prefix
  "/commands/streamx",
  "/commands/stream/",
  "/heartbeat/",
  "/heartbeats",
  "/commands/",
  "/Heartbeat",
  "/api/ui-bridge/heartbeat",
  "heartbeat",
  "",
  // relay routes a DRIVER calls (`_browser-required.ts` RELAY_TRANSPORT_ROUTES)
  "/health",
  "/status",
  "/tabs",
  "/tabs/wait",
  "/tabs/t1/activate",
  "/control/events/stream",
  "/control/changes/stream",
  // user commands
  "/control/snapshot",
  "/control/element/btn-1/action",
  "/control/page/navigate",
];

describe("sdkTransportLane / isSdkTransportRoute", () => {
  it("classifies exactly three (method, path) pairs as transport, each to its own sub-lane", () => {
    const cells: Record<string, string | null> = {};
    for (const path of PATHS) {
      for (const method of METHODS) {
        cells[`${method} ${path}`] = sdkTransportLane(path, method);
      }
    }
    const transportCells = Object.fromEntries(
      Object.entries(cells).filter(([, lane]) => lane !== null),
    );
    expect(transportCells).toEqual(TRANSPORT);
    // Not vacuous: the grid really was crossed.
    expect(Object.keys(cells).length).toBe(PATHS.length * METHODS.length);
  });

  it("agrees with isSdkTransportRoute on every cell", () => {
    for (const path of PATHS) {
      for (const method of METHODS) {
        expect(
          isSdkTransportRoute(path, method),
          `${method} ${path}`,
        ).toBe(`${method} ${path}` in TRANSPORT);
      }
    }
  });

  it.each([
    ["GET", "/heartbeat"],
    ["GET", "/commands"],
    ["POST", "/commands/stream"],
    ["POST", "/commands/streamx"],
    ["POST", "/heartbeat/"],
    ["PUT", "/heartbeat"],
    ["DELETE", "/commands"],
    ["HEAD", "/commands/stream"],
  ])("%s %s is NOT transport", (method, path) => {
    expect(isSdkTransportRoute(path, method)).toBe(false);
    expect(sdkTransportLane(path, method)).toBeNull();
  });

  it.each([
    ["GET", "/commands/stream", "stream"],
    ["POST", "/heartbeat", "heartbeat"],
    ["POST", "/commands", "result"],
  ])("%s %s bills the %s sub-lane", (method, path, lane) => {
    expect(isSdkTransportRoute(path, method)).toBe(true);
    expect(sdkTransportLane(path, method)).toBe(lane);
  });

  it("lists each route once and gives every route its own sub-lane", () => {
    expect(SDK_TRANSPORT_ROUTES).toEqual([
      { method: "GET", path: "/commands/stream", lane: "stream" },
      { method: "POST", path: "/heartbeat", lane: "heartbeat" },
      { method: "POST", path: "/commands", lane: "result" },
    ]);
    expect(new Set(SDK_TRANSPORT_ROUTES.map((r) => r.lane)).size).toBe(3);
  });
});

describe("restated SDK cadences", () => {
  it("restates the SDK's values (checked against the installed SDK in route.real-sdk.test.ts)", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(10000);
    expect(SSE_RECONNECT_DELAY_MS).toBe(10000);
    expect(RELAY_COMMAND_STREAM_HEARTBEAT_MS).toBe(15000);
    expect(RELAY_SNAPSHOTS_PER_STREAM_OPEN).toBe(2);
  });

  it("derives what one live tab sends per minute", () => {
    // 60 s / 10 s reconnect delay
    expect(STREAM_OPENS_PER_TAB_PER_MIN).toBe(6);
    // 60 s / 10 s timer + 60 s / 15 s ping
    expect(HEARTBEATS_PER_TAB_PER_MIN).toBe(10);
    // 2 relay-originated snapshots x 6 opens
    expect(RELAY_RESULTS_PER_TAB_PER_MIN).toBe(12);
  });
});
