/**
 * Tests for the UI Bridge relay rate limiter (§4.8 of the production-safe plan).
 *
 * The unit under test is `checkRateLimit(userId, kind)`. We mock the
 * Redis client via `__setRedisClientForTest` and exercise:
 *
 *   - Counter ticks up with each call within a window.
 *   - 21st write in a minute → `allowed: false`.
 *   - 61st read in a minute → `allowed: false`.
 *   - Per-user (NOT per-tab) isolation: two users use independent counters.
 *   - Fail-open when Redis is offline (`__setRedisClientForTest(null)`).
 *   - Fail-open when a Redis op throws.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.8.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setRedisClientForTest,
  checkRateLimit,
  kindForMethod,
  rateLimitedResponse,
  READ_LIMIT_PER_MIN,
  WRITE_LIMIT_PER_MIN,
} from "./_rate-limit";

/**
 * A minimal in-memory stand-in for an ioredis client implementing only
 * the surface `checkRateLimit` uses (`pipeline().incr().expire().exec()`).
 * Counts INCR ops per key so tests can step through the window without
 * mocking time.
 */
function makeMockRedis(failOn?: string): {
  client: Parameters<typeof __setRedisClientForTest>[0];
  store: Map<string, number>;
} {
  const store = new Map<string, number>();
  const pipelineApi = {
    _ops: [] as Array<["incr" | "expire", string]>,
    incr(key: string) {
      this._ops.push(["incr", key]);
      return this;
    },
    expire(key: string) {
      this._ops.push(["expire", key]);
      return this;
    },
    async exec(): Promise<unknown> {
      const results: Array<[Error | null, unknown]> = [];
      for (const [op, key] of this._ops) {
        if (failOn && key.includes(failOn)) {
          return Promise.reject(new Error("simulated redis op failure"));
        }
        if (op === "incr") {
          const next = (store.get(key) ?? 0) + 1;
          store.set(key, next);
          results.push([null, next]);
        } else {
          results.push([null, 1]);
        }
      }
      this._ops = [];
      return results;
    },
  };
  const client = {
    pipeline: () => ({ ...pipelineApi, _ops: [] }),
    on: () => undefined,
  } as unknown as Parameters<typeof __setRedisClientForTest>[0];
  return { client, store };
}

describe("kindForMethod", () => {
  it("classifies GET/HEAD as read; everything else as write", () => {
    expect(kindForMethod("GET")).toBe("read");
    expect(kindForMethod("HEAD")).toBe("read");
    expect(kindForMethod("POST")).toBe("write");
    expect(kindForMethod("PUT")).toBe("write");
    expect(kindForMethod("DELETE")).toBe("write");
    expect(kindForMethod("PATCH")).toBe("write");
  });
});

describe("checkRateLimit", () => {
  afterEach(() => {
    __setRedisClientForTest(undefined);
  });

  it("allows the first call (count=1)", async () => {
    const { client } = makeMockRedis();
    __setRedisClientForTest(client);
    const r = await checkRateLimit("u1", "write");
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.limit).toBe(WRITE_LIMIT_PER_MIN);
    expect(r.redisOffline).toBe(false);
  });

  it("rejects the 21st write in a minute", async () => {
    const { client } = makeMockRedis();
    __setRedisClientForTest(client);
    const now = Date.now();
    let last: Awaited<ReturnType<typeof checkRateLimit>>;
    for (let i = 0; i < WRITE_LIMIT_PER_MIN; i++) {
      const r = await checkRateLimit("u1", "write", now);
      expect(r.allowed).toBe(true);
      last = r;
    }
    // The 21st call (count > limit) must be denied.
    const denied = await checkRateLimit("u1", "write", now);
    expect(denied.allowed).toBe(false);
    expect(denied.count).toBe(WRITE_LIMIT_PER_MIN + 1);
    expect(last!.count).toBe(WRITE_LIMIT_PER_MIN);
  });

  it("rejects the 61st read in a minute", async () => {
    const { client } = makeMockRedis();
    __setRedisClientForTest(client);
    const now = Date.now();
    for (let i = 0; i < READ_LIMIT_PER_MIN; i++) {
      const r = await checkRateLimit("u1", "read", now);
      expect(r.allowed).toBe(true);
    }
    const denied = await checkRateLimit("u1", "read", now);
    expect(denied.allowed).toBe(false);
    expect(denied.count).toBe(READ_LIMIT_PER_MIN + 1);
  });

  it("isolates counters per user (NOT per tab) — u1's budget doesn't shrink u2's", async () => {
    const { client } = makeMockRedis();
    __setRedisClientForTest(client);
    const now = Date.now();
    for (let i = 0; i < WRITE_LIMIT_PER_MIN; i++) {
      await checkRateLimit("u1", "write", now);
    }
    const deniedU1 = await checkRateLimit("u1", "write", now);
    expect(deniedU1.allowed).toBe(false);
    // u2 starts fresh: first call is allowed, count=1.
    const r = await checkRateLimit("u2", "write", now);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  it("isolates read vs write counters under one user", async () => {
    const { client } = makeMockRedis();
    __setRedisClientForTest(client);
    const now = Date.now();
    for (let i = 0; i < WRITE_LIMIT_PER_MIN; i++) {
      await checkRateLimit("u1", "write", now);
    }
    const deniedWrite = await checkRateLimit("u1", "write", now);
    expect(deniedWrite.allowed).toBe(false);
    // Reads still under the read limit:
    const readOk = await checkRateLimit("u1", "read", now);
    expect(readOk.allowed).toBe(true);
    expect(readOk.count).toBe(1);
  });

  it("fails open when Redis is offline (no client)", async () => {
    __setRedisClientForTest(null);
    const r = await checkRateLimit("u1", "write");
    expect(r.allowed).toBe(true);
    expect(r.redisOffline).toBe(true);
    expect(r.count).toBe(0);
  });

  it("fails open when a Redis op throws", async () => {
    const { client } = makeMockRedis("u1");
    __setRedisClientForTest(client);
    const r = await checkRateLimit("u1", "write");
    expect(r.allowed).toBe(true);
    expect(r.redisOffline).toBe(true);
  });
});

describe("rateLimitedResponse", () => {
  it("returns 429 with RATE_LIMITED envelope + Retry-After header", async () => {
    const resp = rateLimitedResponse({
      allowed: false,
      count: 21,
      limit: 20,
      retryAfterSec: 17,
      redisOffline: false,
    });
    expect(resp.status).toBe(429);
    expect(resp.headers.get("Retry-After")).toBe("17");
    const body = await resp.json();
    expect(body).toMatchObject({
      success: false,
      code: "RATE_LIMITED",
      retryAfterSec: 17,
    });
    expect(body.message).toContain("21");
  });
});

describe("environment fail-open path", () => {
  beforeEach(() => {
    __setRedisClientForTest(undefined);
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __setRedisClientForTest(undefined);
  });

  it("treats unset UI_BRIDGE_RELAY_REDIS_URL as offline (fail open)", async () => {
    const r = await checkRateLimit("u1", "write");
    expect(r.allowed).toBe(true);
    expect(r.redisOffline).toBe(true);
  });
});
