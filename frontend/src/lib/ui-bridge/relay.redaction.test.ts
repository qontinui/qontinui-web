/**
 * relay.ts's degraded-bus warning must never carry the Redis URL's password,
 * including when the failure is Node's ERR_INVALID_URL (whose `input` property
 * and wrapped messages hold the full URL) and when the URL has no scheme.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createRedisRelayBusMock = vi.fn();

vi.mock("@qontinui/ui-bridge/server", () => ({
  CommandRelay: class {},
  createRelayHandlers: () => ({}),
  createRedisRelayBus: (url: string | undefined | null) =>
    createRedisRelayBusMock(url),
}));
vi.mock("ioredis", () => ({ default: class {} }));

describe.each([
  "redis://default:secret@host.example:6379",
  "default:secret@host.example:6379",
])("relay degraded warning with %s", (url) => {
  let spies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    createRedisRelayBusMock.mockReset();
    vi.resetModules();
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", url);
    spies = (["warn", "error", "log", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined)
    );
  });
  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    vi.unstubAllEnvs();
  });

  const logged = () =>
    JSON.stringify(
      spies.flatMap((s) => s.mock.calls.map((c) => c.map(String)))
    );

  it.each([
    ["an Error whose message embeds the URL", () => new Error(`bad ${url}`)],
    ["a non-Error thrown value", () => `bad ${url}`],
    [
      "an ERR_INVALID_URL with input",
      () => Object.assign(new TypeError("Invalid URL"), { input: url }),
    ],
  ])("never logs the password for %s", async (_name, make) => {
    createRedisRelayBusMock.mockRejectedValue(make());
    const mod = await import("./relay");
    expect(mod.getRelayBusStatus()).toBe("in-memory-degraded");
    expect(spies[0]!.mock.calls.length).toBeGreaterThan(0);
    expect(logged()).not.toContain("secret");
  });
});
