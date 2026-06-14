/**
 * Unit contract for the relay-bus degradation surfacing (friction-2).
 *
 * `relay.ts` builds the cross-instance relay bus from `UI_BRIDGE_RELAY_REDIS_URL`
 * at module load (top-level await). Before this fix, an init FAILURE degraded
 * silently to single-process in-memory (only a `console.error`) — on serverless
 * that re-introduces the "navigate returns 200 but the page never moves" class
 * with no health signal. These tests pin the module-level status the `/health`
 * route now reports, the structured warn (HOST ONLY, never creds), and the
 * optional `UI_BRIDGE_RELAY_REQUIRE_REDIS=1` fail-fast.
 *
 * The module runs top-level await + reads env at load, so each case mocks the
 * SDK's `createRedisRelayBus`, stubs env, resets the module registry, and
 * dynamically re-imports for a clean module instance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stubs shared by every dynamic import below. `createRedisRelayBus` is
// overridden per-case via `createRedisRelayBusMock`.
const createRedisRelayBusMock = vi.fn();

vi.mock("@qontinui/ui-bridge/server", () => ({
  CommandRelay: class {},
  createRelayHandlers: () => ({}),
  createRedisRelayBus: (url: string | undefined | null) =>
    createRedisRelayBusMock(url),
}));

// ioredis is only imported as a @vercel/nft trace anchor; a bare default
// export is enough for the module to load.
vi.mock("ioredis", () => ({ default: class {} }));

// The relay constructs handlers from discovered specs at load; stub the loader
// so no network fetch happens.
vi.mock("./discovered-specs", () => ({
  loadDiscoveredSpecs: async () => [],
}));

async function importRelayFresh() {
  vi.resetModules();
  return import("./relay");
}

describe("relay-bus status surfacing", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createRedisRelayBusMock.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("reports 'in-memory' when no Redis URL is configured", async () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "");
    // SDK returns null for an unset/empty URL (in-memory by design).
    createRedisRelayBusMock.mockResolvedValue(null);

    const mod = await importRelayFresh();

    expect(mod.getRelayBusStatus()).toBe("in-memory");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reports 'redis' when the bus initializes successfully", async () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "redis://cache.internal:6379");
    // A non-null bus object means Redis is live.
    createRedisRelayBusMock.mockResolvedValue({ close: async () => undefined });

    const mod = await importRelayFresh();

    expect(mod.getRelayBusStatus()).toBe("redis");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("reports 'in-memory-degraded' and warns when bus init fails", async () => {
    vi.stubEnv(
      "UI_BRIDGE_RELAY_REDIS_URL",
      "rediss://user:s3cr3t@cache.internal:6380/0",
    );
    createRedisRelayBusMock.mockRejectedValue(
      new Error("ECONNREFUSED 10.0.0.5:6380"),
    );

    const mod = await importRelayFresh();

    expect(mod.getRelayBusStatus()).toBe("in-memory-degraded");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("logs the HOST ONLY on failure — never credentials or the full URL", async () => {
    vi.stubEnv(
      "UI_BRIDGE_RELAY_REDIS_URL",
      "rediss://user:s3cr3t@cache.internal:6380/0",
    );
    createRedisRelayBusMock.mockRejectedValue(new Error("boom"));

    await importRelayFresh();

    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).toContain("cache.internal:6380");
    expect(logged).not.toContain("s3cr3t");
    expect(logged).not.toContain("user:");
    expect(logged).not.toContain("/0");
  });

  it("fails fast when UI_BRIDGE_RELAY_REQUIRE_REDIS=1 and init fails", async () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "redis://cache.internal:6379");
    vi.stubEnv("UI_BRIDGE_RELAY_REQUIRE_REDIS", "1");
    createRedisRelayBusMock.mockRejectedValue(new Error("down"));

    await expect(importRelayFresh()).rejects.toThrow(
      /UI_BRIDGE_RELAY_REQUIRE_REDIS=1/,
    );
  });

  it("does NOT fail fast on success even when REQUIRE_REDIS=1", async () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "redis://cache.internal:6379");
    vi.stubEnv("UI_BRIDGE_RELAY_REQUIRE_REDIS", "1");
    createRedisRelayBusMock.mockResolvedValue({ close: async () => undefined });

    const mod = await importRelayFresh();

    expect(mod.getRelayBusStatus()).toBe("redis");
  });
});
