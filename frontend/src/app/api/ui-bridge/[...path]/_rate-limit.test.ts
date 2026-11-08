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
 *   - The lanes (plan 2026-11-08-an-agents-relay-tab-spends-the-operators-
 *     ui-bridge-budget, Phase 4): `laneFor` sends the SDK's three transport
 *     routes to their own sub-lanes and everything else to read/write; each
 *     transport sub-lane has its own counter and its derived ceiling; the
 *     refusal and the `X-RateLimit-*` headers name the lane.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.8.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setRedisClientForTest,
  checkRateLimit,
  kindForMethod,
  laneFor,
  rateLimitedResponse,
  rateLimitHeaders,
  READ_LIMIT_PER_MIN,
  TRANSPORT_ENVELOPE_DRIVERS,
  TRANSPORT_ENVELOPE_TABS,
  TRANSPORT_HEARTBEAT_LIMIT_PER_MIN,
  TRANSPORT_RESULT_LIMIT_PER_MIN,
  TRANSPORT_STREAM_LIMIT_PER_MIN,
  withRateLimitHeaders,
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
      kind: "write",
    });
    expect(resp.status).toBe(429);
    expect(resp.headers.get("Retry-After")).toBe("17");
    const body = await resp.json();
    expect(body).toMatchObject({
      success: false,
      code: "RATE_LIMITED",
      lane: "write",
      retryAfterSec: 17,
    });
    expect(body.message).toContain("21");
  });

  it.each([
    ["transport:stream", 97, 96],
    ["transport:heartbeat", 161, 160],
    ["transport:result", 433, 432],
  ] as const)(
    "answers a %s refusal with TRANSPORT_RATE_LIMITED, naming the lane",
    async (kind, count, limit) => {
      const resp = rateLimitedResponse({
        allowed: false,
        count,
        limit,
        retryAfterSec: 12,
        redisOffline: false,
        kind,
      });
      expect(resp.status).toBe(429);
      expect(resp.headers.get("Retry-After")).toBe("12");
      expect(resp.headers.get("X-RateLimit-Lane")).toBe(kind);
      expect(resp.headers.get("X-RateLimit-Remaining")).toBe("0");
      const body = await resp.json();
      expect(body).toMatchObject({
        success: false,
        code: "TRANSPORT_RATE_LIMITED",
        lane: kind,
        retryAfterSec: 12,
      });
      expect(body.message).toContain(String(count));
    }
  );
});

describe("laneFor", () => {
  it.each([
    // The SDK's own transport, each to its own sub-lane.
    ["GET", "/commands/stream", "transport:stream"],
    ["POST", "/heartbeat", "transport:heartbeat"],
    ["POST", "/commands", "transport:result"],
    // The method dimension: the same paths under another method are not transport.
    ["GET", "/heartbeat", "read"],
    ["GET", "/commands", "read"],
    ["HEAD", "/commands/stream", "read"],
    ["POST", "/commands/stream", "write"],
    ["PUT", "/heartbeat", "write"],
    ["DELETE", "/commands", "write"],
    // Near misses.
    ["POST", "/commands/streamx", "write"],
    ["POST", "/heartbeat/", "write"],
    // Relay routes a driver calls, and user commands: the command lanes.
    ["GET", "/health", "read"],
    ["GET", "/tabs", "read"],
    ["GET", "/control/snapshot", "read"],
    ["POST", "/control/element/btn-1/action", "write"],
    ["POST", "/tabs/t1/close", "write"],
  ])("%s %s → %s", (method, path, lane) => {
    expect(laneFor(path, method)).toBe(lane);
  });
});

describe("transport lanes", () => {
  afterEach(() => {
    __setRedisClientForTest(undefined);
  });

  it("derives each ceiling from the envelope and the SDK cadences", () => {
    expect(TRANSPORT_ENVELOPE_TABS).toBe(16);
    expect(TRANSPORT_ENVELOPE_DRIVERS).toBe(3);
    // 16 tabs x 6 stream opens a minute (60 s / 10 s reconnect delay)
    expect(TRANSPORT_STREAM_LIMIT_PER_MIN).toBe(96);
    // 16 tabs x (6 timer + 4 ping-driven heartbeats a minute)
    expect(TRANSPORT_HEARTBEAT_LIMIT_PER_MIN).toBe(160);
    // 16 tabs x 2 relay snapshots x 6 opens + 3 drivers x (60 + 20)
    expect(TRANSPORT_RESULT_LIMIT_PER_MIN).toBe(432);
    // The command lanes are unchanged.
    expect(READ_LIMIT_PER_MIN).toBe(60);
    expect(WRITE_LIMIT_PER_MIN).toBe(20);
  });

  it.each([
    ["transport:stream", 96],
    ["transport:heartbeat", 160],
    ["transport:result", 432],
  ] as const)(
    "%s admits %i in a window and refuses the next, carrying its kind",
    async (kind, limit) => {
      const { client } = makeMockRedis();
      __setRedisClientForTest(client);
      const now = Date.now();
      for (let i = 0; i < limit; i++) {
        const r = await checkRateLimit("u1", kind, now);
        expect(r.allowed).toBe(true);
      }
      const denied = await checkRateLimit("u1", kind, now);
      expect(denied).toMatchObject({
        allowed: false,
        count: limit + 1,
        limit,
        kind,
        redisOffline: false,
      });
    }
  );

  it("keeps every lane on its own counter key, so one request is one INCR on one key", async () => {
    const { client, store } = makeMockRedis();
    __setRedisClientForTest(client);
    const now = Date.UTC(2026, 0, 1, 0, 0, 30);
    const windowIdx = Math.floor(now / 60_000);
    for (const kind of [
      "read",
      "write",
      "transport:stream",
      "transport:heartbeat",
      "transport:result",
    ] as const) {
      await checkRateLimit("u1", kind, now);
    }
    expect([...store.entries()].sort()).toEqual(
      [
        [`bridge:rl:r:u1:${windowIdx}`, 1],
        [`bridge:rl:w:u1:${windowIdx}`, 1],
        [`bridge:rl:t:s:u1:${windowIdx}`, 1],
        [`bridge:rl:t:h:u1:${windowIdx}`, 1],
        [`bridge:rl:t:c:u1:${windowIdx}`, 1],
      ].sort()
    );
  });

  it("an exhausted transport sub-lane leaves the write lane untouched", async () => {
    const { client } = makeMockRedis();
    __setRedisClientForTest(client);
    const now = Date.now();
    for (let i = 0; i < 161; i++) {
      await checkRateLimit("u1", "transport:heartbeat", now);
    }
    const write = await checkRateLimit("u1", "write", now);
    expect(write).toMatchObject({ allowed: true, count: 1, kind: "write" });
  });

  it("fails open on every transport sub-lane when Redis is offline", async () => {
    __setRedisClientForTest(null);
    for (const kind of [
      "transport:stream",
      "transport:heartbeat",
      "transport:result",
    ] as const) {
      const r = await checkRateLimit("u1", kind);
      expect(r).toMatchObject({
        allowed: true,
        redisOffline: true,
        count: 0,
        kind,
      });
    }
  });
});

describe("rateLimitHeaders", () => {
  it("names the lane, its limit, what is left and when the window resets", () => {
    expect(
      rateLimitHeaders({
        allowed: true,
        count: 5,
        limit: 20,
        retryAfterSec: 17,
        redisOffline: false,
        kind: "write",
      })
    ).toEqual({
      "X-RateLimit-Lane": "write",
      "X-RateLimit-Limit": "20",
      "X-RateLimit-Remaining": "15",
      "X-RateLimit-Reset-After": "17",
    });
  });

  it("never reports a negative remaining budget", () => {
    expect(
      rateLimitHeaders({
        allowed: false,
        count: 170,
        limit: 160,
        retryAfterSec: 3,
        redisOffline: false,
        kind: "transport:heartbeat",
      })["X-RateLimit-Remaining"]
    ).toBe("0");
  });

  it("says unknown, never a number, when Redis is offline", () => {
    expect(
      rateLimitHeaders({
        allowed: true,
        count: 0,
        limit: 432,
        retryAfterSec: 40,
        redisOffline: true,
        kind: "transport:result",
      })
    ).toEqual({
      "X-RateLimit-Lane": "transport:result",
      "X-RateLimit-Limit": "432",
      "X-RateLimit-Remaining": "unknown",
      "X-RateLimit-Reset-After": "40",
    });
  });
});

describe("withRateLimitHeaders", () => {
  const budget = {
    allowed: true,
    count: 1,
    limit: 96,
    retryAfterSec: 30,
    redisOffline: false,
    kind: "transport:stream",
  } as const;

  it("stamps the budget onto a response whose headers are mutable", async () => {
    const original = new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const stamped = withRateLimitHeaders(original, budget);
    expect(stamped.headers.get("X-RateLimit-Lane")).toBe("transport:stream");
    expect(stamped.headers.get("X-RateLimit-Remaining")).toBe("95");
    expect(stamped.headers.get("Content-Type")).toBe("application/json");
    expect(await stamped.text()).toBe("{}");
  });

  it("rebuilds a response whose headers are immutable, keeping its status and headers", () => {
    const original = Response.redirect("https://qontinui.io/next", 302);
    expect(() => original.headers.set("X-Probe", "1")).toThrow();
    const stamped = withRateLimitHeaders(original, budget);
    expect(stamped.status).toBe(302);
    expect(stamped.headers.get("Location")).toBe("https://qontinui.io/next");
    expect(stamped.headers.get("X-RateLimit-Lane")).toBe("transport:stream");
    expect(stamped.headers.get("X-RateLimit-Limit")).toBe("96");
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
