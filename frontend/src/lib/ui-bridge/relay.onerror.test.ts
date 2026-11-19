/**
 * relay.ts passes an `onError` to `createRedisRelayBus` (ui-bridge >= 0.53).
 * The SDK reports EVERY fire-and-forget command rejection through it, so the
 * handler must (a) route the summary through the redactor so a secret the SDK
 * summary carried never reaches the log, and (b) throttle to one line per role per 30 s. The real-ioredis
 * tripwire only drives one error per role, so neither the throttle nor the
 * per-role independence is pinned there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Summary = {
  role: "pub" | "sub";
  name: string;
  code?: string;
  message: string;
};
type Options = { onError?: (s: Summary) => void };

const createRedisRelayBusMock = vi.fn();

vi.mock("@qontinui/ui-bridge/server", () => ({
  CommandRelay: class {},
  createRelayHandlers: () => ({}),
  createRedisRelayBus: (url: string | undefined | null, options?: Options) =>
    createRedisRelayBusMock(url, options),
}));
vi.mock("ioredis", () => ({ default: class {} }));

const URL = "redis://default:SECRETPW123@host.example:6379";

describe("relay onError handler", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let onError: (s: Summary) => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
    createRedisRelayBusMock.mockReset();
    createRedisRelayBusMock.mockResolvedValue({});
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", URL);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.resetModules();
    const mod = await import("./relay");
    expect(mod.getRelayBusStatus()).toBe("redis");
    const options = createRedisRelayBusMock.mock.calls[0]![1] as Options;
    expect(typeof options?.onError).toBe("function");
    onError = options.onError!;
  });
  afterEach(() => {
    warnSpy?.mockRestore();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const summary = (role: "pub" | "sub"): Summary => ({
    role,
    name: "ReplyError",
    code: "WRONGPASS",
    message: `auth failed for ${URL}`,
  });

  it("logs a redacted line that names role, name and code", () => {
    onError(summary("pub"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = warnSpy.mock.calls[0]!.map(String).join(" ");
    expect(line).toContain("pub error");
    expect(line).toContain("ReplyError (WRONGPASS)");
    expect(line).not.toContain("SECRETPW123");
  });

  it("omits the code suffix when the summary has none", () => {
    onError({
      role: "sub",
      name: "Error",
      message: "auth failed: SECRETPW123",
    });
    const line = warnSpy.mock.calls[0]!.map(String).join(" ");
    expect(line).toContain("sub error");
    expect(line).toContain("Error: auth failed");
    expect(line).not.toContain("(");
    expect(line).not.toContain("SECRETPW123");
  });

  it("throttles to one line per role per 30 s, roles independent", () => {
    onError(summary("pub"));
    onError(summary("pub"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    onError(summary("sub"));
    expect(warnSpy).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(29_999);
    onError(summary("pub"));
    expect(warnSpy).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    onError(summary("pub"));
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });
});
