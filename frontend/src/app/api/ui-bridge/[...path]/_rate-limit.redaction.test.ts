/**
 * The limiter's Redis error paths must never log the Redis URL's password,
 * with or without a `rediss://` scheme (finding 56d2bd32).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctor = vi.hoisted(() => ({
  impl: null as null | ((url: string) => unknown),
}));

vi.mock("ioredis", () => ({
  default: class {
    constructor(url: string) {
      return ctor.impl!(url) as object;
    }
  },
}));

const URLS = [
  "redis://default:secret@host.example:6379",
  "default:secret@host.example:6379",
];

describe.each(URLS)("limiter logging with %s", (url) => {
  let spies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", url);
    spies = (["warn", "error", "info", "debug", "log"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined)
    );
  });
  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    vi.unstubAllEnvs();
  });

  const logged = () =>
    JSON.stringify(
      spies.flatMap((s) =>
        s.mock.calls.map((c) =>
          c.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        )
      )
    );

  it("redacts an error event whose message embeds the URL", async () => {
    let handler: ((e: Error) => void) | undefined;
    ctor.impl = () => ({
      on: (_ev: string, h: (e: Error) => void) => {
        handler = h;
      },
    });
    const mod = await import("./_rate-limit");
    await mod.checkRateLimit?.("u1", "read").catch(() => undefined);
    expect(handler).toBeTypeOf("function");
    handler!(new Error(`Redis connect failed: ${url}`));
    expect(logged()).toContain("redis_error_failing_open");
    expect(logged()).not.toContain("secret");
  });

  it("redacts a constructor throw whose message embeds the URL", async () => {
    ctor.impl = () => {
      throw new Error(`Invalid URL: ${url}`);
    };
    const mod = await import("./_rate-limit");
    await mod.checkRateLimit?.("u1", "read").catch(() => undefined);
    expect(logged()).toContain("redis_init_failed_failing_open");
    expect(logged()).not.toContain("secret");
  });

  /** A ready client whose INCR/EXPIRE fail with the URL in the message. */
  const failingClient = (which: "incr" | "expire") => ({
    status: "ready",
    incr: async () => {
      if (which === "incr") throw new Error(`INCR failed for ${url}`);
      return 1;
    },
    expire: async () => {
      throw new Error(`EXPIRE failed for ${url}`);
    },
  });

  it("redacts the INCR failing-open warning", async () => {
    const mod = await import("./_rate-limit");
    mod.__setRedisClientForTest(failingClient("incr") as never);
    await mod.checkRateLimit("u1", "read");
    expect(logged()).toContain("rate_limit_redis_op_failed_failing_open");
    expect(logged()).toContain("INCR failed");
    expect(logged()).not.toContain("secret");
  });

  it("redacts the EXPIRE-failed warning", async () => {
    const mod = await import("./_rate-limit");
    mod.__setRedisClientForTest(failingClient("expire") as never);
    await mod.checkRateLimit("u1", "read");
    await new Promise((r) => setTimeout(r, 0));
    expect(logged()).toContain("rate_limit_expire_failed");
    expect(logged()).toContain("EXPIRE failed");
    expect(logged()).not.toContain("secret");
  });
});
