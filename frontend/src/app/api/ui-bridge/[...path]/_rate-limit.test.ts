/**
 * Tests for the UI Bridge relay rate limiter (§4.8 of the production-safe plan).
 *
 * The unit under test is `checkRateLimit(userId, kind)`. We mock the
 * Redis client via `__setRedisClientForTest` (with the shared stand-in,
 * `@/test/rate-limit-redis-mock`) and exercise:
 *
 *   - Counter ticks up with each call within a window.
 *   - 21st write in a minute → `allowed: false`.
 *   - 61st read in a minute → `allowed: false`.
 *   - Per-user (NOT per-tab) isolation: two users use independent counters.
 *   - Fail-open when Redis is offline (`__setRedisClientForTest(null)`).
 *   - Fail-open when a Redis op throws, or its connection is not ready.
 *   - The lanes (plan 2026-11-08-an-agents-relay-tab-spends-the-operators-
 *     ui-bridge-budget, Phase 4): `laneFor` sends the SDK's three transport
 *     routes to their own sub-lanes and everything else to read/write; each
 *     transport sub-lane has its own counter and its derived ceiling; the
 *     refusal and the `X-RateLimit-*` headers name the lane.
 *   - The EXPIRE that only a key's first INCR sends (plan
 *     2026-11-09-webpack-bundles-the-relay-sdks-ioredis-import-so-the-
 *     deployed-relay-bus-never-starts, Phase 4): its failure neither refuses
 *     nor uncounts a request, and is logged at most once a window. What a
 *     request costs in commands is counted through the route, in
 *     `route.rate-limit-lanes.test.ts`.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.8.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMockRedis, notReadyRedis } from "@/test/rate-limit-redis-mock";

import {
  __setRedisClientForTest,
  checkRateLimit,
  kindForMethod,
  laneFor,
  logLaneRefused,
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
    const { client } = makeMockRedis({ failOn: "u1" });
    __setRedisClientForTest(client);
    const r = await checkRateLimit("u1", "write");
    expect(r.allowed).toBe(true);
    expect(r.redisOffline).toBe(true);
  });

  it("fails open when the INCR answers something that is not a count", async () => {
    for (const value of [null, "OK", 0, Number.NaN]) {
      __setRedisClientForTest(makeMockRedis({ incrReply: () => value }).client);
      const r = await checkRateLimit("u1", "write");
      expect(r, String(value)).toMatchObject({
        allowed: true,
        count: 0,
        redisOffline: true,
      });
    }
  });

  it("warns about failing open at most once per minute window", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      __setRedisClientForTest(notReadyRedis().client);
      // A window no other test touches, so the throttle starts fresh.
      const now = Date.UTC(2031, 0, 1, 0, 0, 30);
      await checkRateLimit("u1", "write", now);
      await checkRateLimit("u1", "read", now + 1_000);
      await checkRateLimit("u1", "transport:result", now + 60_000);
      const warnings = warn.mock.calls.filter((call) =>
        String(call[0]).includes("rate_limit_redis_op_failed_failing_open")
      );
      // Redis's own error, and the client's connection state beside it
      // (`_rate-limit.ts` `logFailingOpen` says what each state can mean).
      expect(warnings.map((call) => call[1])).toEqual([
        {
          error:
            "Stream isn't writeable and enableOfflineQueue options is false",
          kind: "write",
          status: "connecting",
        },
        expect.objectContaining({ kind: "transport:result" }),
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * Plan 2026-11-09-webpack-bundles-the-relay-sdks-ioredis-import-so-the-
 * deployed-relay-bus-never-starts, Phase 4, tests (4) and (5). A counted
 * request sends one INCR, and the INCR that answers 1 also sends the key's
 * EXPIRE, unawaited. Tests (1)-(3) and (6) count the commands through the
 * route, in `route.rate-limit-lanes.test.ts`.
 */
describe("checkRateLimit: one INCR per request, EXPIRE on the first", () => {
  /** 30 s into a minute window no other test in this file uses (window 32608800). */
  const NOW = Date.UTC(2032, 0, 1, 0, 0, 30);

  /** Lets the handlers of the commands a request did not await run. */
  const nextMacrotask = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    __setRedisClientForTest(undefined);
  });

  it("(4) a connection that is not ready (its INCR rejects, as measured) fails open, saying the count is unknown", async () => {
    for (const status of ["connecting", "reconnecting"] as const) {
      __setRedisClientForTest(notReadyRedis(status).client);
      const r = await checkRateLimit("u1", "transport:heartbeat", NOW);
      expect(r, status).toEqual({
        allowed: true,
        count: 0,
        limit: 160,
        retryAfterSec: 30,
        redisOffline: true,
        kind: "transport:heartbeat",
      });
      expect(rateLimitHeaders(r)["X-RateLimit-Remaining"], status).toBe(
        "unknown"
      );
    }
  });

  it("(5) an EXPIRE that fails after its INCR answered 1 admits and counts the request, and is logged once a window", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const redis = makeMockRedis({
        expireError: new Error("ERR simulated EXPIRE failure"),
      });
      __setRedisClientForTest(redis.client);
      const expireFailures = () =>
        warn.mock.calls
          .filter((call) =>
            String(call[0]).includes("rate_limit_expire_failed")
          )
          .map((call) => call[1]);

      // Two keys' first INCRs in one window, so two EXPIREs fail in it.
      for (const user of ["u1", "u2"]) {
        expect(await checkRateLimit(user, "write", NOW), user).toEqual({
          allowed: true,
          count: 1,
          limit: 20,
          retryAfterSec: 30,
          redisOffline: false,
          kind: "write",
        });
      }
      await nextMacrotask();
      expect(expireFailures()).toEqual([
        {
          error: "ERR simulated EXPIRE failure",
          kind: "write",
          status: "ready",
        },
      ]);
      expect(
        redis.commands.filter((command) => command.name === "expire")
      ).toEqual([
        {
          name: "expire",
          key: "bridge:rl:w:u1:32608800",
          seconds: 70,
          via: "direct",
          error: "ERR simulated EXPIRE failure",
        },
        {
          name: "expire",
          key: "bridge:rl:w:u2:32608800",
          seconds: 70,
          via: "direct",
          error: "ERR simulated EXPIRE failure",
        },
      ]);

      // The next window's failure is logged again: the throttle is per window.
      const next = await checkRateLimit("u1", "write", NOW + 60_000);
      expect(next).toMatchObject({
        allowed: true,
        count: 1,
        redisOffline: false,
      });
      await nextMacrotask();
      expect(expireFailures()).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not wait for the EXPIRE: a request whose EXPIRE never settles is still answered", async () => {
    const redis = makeMockRedis();
    // An EXPIRE the server never answers: a request that awaited it would hang.
    (redis.client as unknown as { expire: () => Promise<number> }).expire =
      () => new Promise<number>(() => undefined);
    __setRedisClientForTest(redis.client);
    const pending = Symbol("pending");
    const answered = await Promise.race([
      checkRateLimit("u1", "write", NOW),
      nextMacrotask().then(() => pending),
    ]);
    expect(answered).toMatchObject({
      allowed: true,
      count: 1,
      redisOffline: false,
    });
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

  it("answers every transport refusal with TRANSPORT_RATE_LIMITED, naming its lane", async () => {
    const refusals = [
      ["transport:stream", 97, 96],
      ["transport:heartbeat", 161, 160],
      ["transport:result", 433, 432],
    ] as const;
    for (const [kind, count, limit] of refusals) {
      const resp = rateLimitedResponse({
        allowed: false,
        count,
        limit,
        retryAfterSec: 12,
        redisOffline: false,
        kind,
      });
      expect(resp.status, kind).toBe(429);
      expect(resp.headers.get("Retry-After"), kind).toBe("12");
      expect(resp.headers.get("X-RateLimit-Lane"), kind).toBe(kind);
      expect(resp.headers.get("X-RateLimit-Remaining"), kind).toBe("0");
      const body = await resp.json();
      expect(body, kind).toMatchObject({
        success: false,
        code: "TRANSPORT_RATE_LIMITED",
        lane: kind,
        retryAfterSec: 12,
      });
      expect(body.message, kind).toContain(String(count));
    }
  });
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

  it("each transport sub-lane admits exactly its ceiling in a window and refuses the next", async () => {
    const ceilings = [
      ["transport:stream", 96],
      ["transport:heartbeat", 160],
      ["transport:result", 432],
    ] as const;
    for (const [kind, limit] of ceilings) {
      const { client } = makeMockRedis();
      __setRedisClientForTest(client);
      const now = Date.now();
      for (let i = 0; i < limit; i++) {
        const r = await checkRateLimit("u1", kind, now);
        expect(r.allowed, `${kind} call ${i + 1}`).toBe(true);
      }
      const denied = await checkRateLimit("u1", kind, now);
      expect(denied, kind).toMatchObject({
        allowed: false,
        count: limit + 1,
        limit,
        kind,
        redisOffline: false,
      });
    }
  });

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

describe("logLaneRefused", () => {
  it("logs the 1st, 2nd, 4th and 8th refusal of a lane in a window, naming the lane and principal kind", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (let count = 161; count <= 170; count++) {
        logLaneRefused(
          {
            allowed: false,
            count,
            limit: 160,
            retryAfterSec: 9,
            redisOffline: false,
            kind: "transport:heartbeat",
          },
          "device"
        );
      }
      const lines = warn.mock.calls
        .filter((call) => String(call[0]).includes("lane_refused"))
        .map((call) => call[1]);
      expect(lines).toEqual(
        [161, 162, 164, 168].map((count) =>
          expect.objectContaining({
            lane: "transport:heartbeat",
            principalKind: "device",
            count,
            limit: 160,
          })
        )
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("names a principal it was not told as unknown, never as a default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      logLaneRefused(
        {
          allowed: false,
          count: 21,
          limit: 20,
          retryAfterSec: 9,
          redisOffline: false,
          kind: "write",
        },
        null
      );
      expect(warn.mock.calls.map((call) => call[1])).toEqual([
        expect.objectContaining({ lane: "write", principalKind: "unknown" }),
      ]);
    } finally {
      warn.mockRestore();
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
