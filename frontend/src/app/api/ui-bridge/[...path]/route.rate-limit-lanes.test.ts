/**
 * The relay's rate-limit LANES, through the route handler.
 *
 * Plan 2026-11-08-an-agents-relay-tab-spends-the-operators-ui-bridge-budget,
 * Phase 4. The limiter exists to defang COMMAND flooding (`_rate-limit.ts`
 * header; the design's threat row "DoS via command flooding"): a principal
 * with N tabs never gets N x the command budget. The SDK's own transport —
 * `GET /commands/stream`, `POST /heartbeat`, `POST /commands` (a tab posting
 * a command's RESULT) — is not a command. Charged to the command lanes, four
 * idle tabs' heartbeats alone exhaust the write budget: that is derived from
 * the SDK's 10-s heartbeat timer, and reproduced against the base by test (a)
 * below. The measured incident (2026-11-08, coord finding e0735415) was one
 * agent relay tab beside three operator tabs. So transport now draws on three
 * per-principal sub-lanes of its own.
 *
 * Lanes x principal kinds x thresholds x Redis offline are enumerated below.
 * Every threshold is a LITERAL (20, 21, 60, 61, 96, 97, 160, 161, 432, 433),
 * never one of the module's constants, so a constant that drifts fails here.
 *
 * Harness: the shared in-memory Redis (`@/test/rate-limit-redis-mock`, which
 * records every command it receives) and `route.audit-rl.test.ts`'s frozen
 * window. That file's mocked `UI_BRIDGE_ROUTES` lacks `POST /heartbeat`, so a
 * heartbeat there would 404 after the limiter; this file's mock carries it,
 * as the real SDK's does (`receiveHeartbeat`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { makeMockRedis, notReadyRedis } from "@/test/rate-limit-redis-mock";

import { __resetAuthCache } from "./_auth";
import { __setRedisClientForTest } from "./_rate-limit";

vi.mock("@/lib/ui-bridge/relay", () => {
  const fakeHandler = async () =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    relay: {
      hasCommandListeners: () => true,
      getWebSocketClientCount: () => 1,
    },
    handlers: {
      GET: fakeHandler,
      POST: fakeHandler,
      PUT: fakeHandler,
      DELETE: fakeHandler,
    },
    getRelayBusStatus: () => "in-memory",
  };
});

vi.mock("@qontinui/ui-bridge/server", () => {
  const fakeHandler = async () =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    createNextRouteHandlers: () => ({
      GET: fakeHandler,
      POST: fakeHandler,
      PUT: fakeHandler,
      DELETE: fakeHandler,
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
    UI_BRIDGE_ROUTES: [
      { method: "GET", path: "/control/snapshot" },
      { method: "POST", path: "/control/element/:id/action" },
      { method: "POST", path: "/control/page/navigate" },
      // The real SDK lists the heartbeat route (`receiveHeartbeat`); the
      // audit-rl harness's list does not.
      { method: "POST", path: "/heartbeat" },
    ],
  };
});

vi.mock("./_audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_audit")>();
  return { ...actual, recordAudit: async () => undefined };
});

// Imported AFTER the mocks are declared so they take effect.
import * as route from "./route";

const BACKEND_URL = "http://backend.test";
const OPERATOR_TOKEN = "operator-bearer";
const DEVICE_TOKEN = "device-jwt";
const OPERATOR_ID = "user-1";

type Method = "GET" | "POST" | "PUT" | "DELETE";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface SendOptions {
  token?: string;
  body?: unknown;
  query?: string;
}

/** One request through the route handler, as a browser or a driver sends it. */
function send(
  method: Method,
  path: string,
  { token = OPERATOR_TOKEN, body, query = "" }: SendOptions = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    origin: "https://qontinui.io",
  };
  const init: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = {
    method,
    headers,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const request = new NextRequest(
    `http://localhost/api/ui-bridge${path}${query}`,
    init
  );
  const context = {
    params: Promise.resolve({ path: path.replace(/^\//, "").split("/") }),
  };
  return route[method](request, context);
}

// The requests that bill each lane.
const heartbeat = (tabId = "tab-1", token?: string) =>
  send("POST", "/heartbeat", {
    token,
    body: {
      tabId,
      timestamp: 1,
      registrationMetadata: { userId: OPERATOR_ID, sessionId: "s-1" },
    },
  });
const result = (n: number, tabId = "tab-1", token?: string) =>
  send("POST", "/commands", {
    token,
    body: { commandId: `cmd-${n}`, success: true, result: {}, tabId },
  });
const streamOpen = (tabId = "tab-1", token?: string) =>
  send("GET", "/commands/stream", { token, query: `?tabId=${tabId}` });
const commandWrite = (tabId = "tab-1", token?: string) =>
  send("POST", "/control/element/btn-1/action", {
    token,
    body: { action: "click", tabId },
  });
const commandRead = (token?: string) =>
  send("GET", "/control/snapshot", { token });

type Hit = (n: number, token?: string) => Promise<Response>;

/** Each lane: the request that bills it, its LITERAL ceiling, and its refusal code. */
const LANES: ReadonlyArray<{
  lane: string;
  hit: Hit;
  limit: number;
  code: string;
}> = [
  {
    lane: "read",
    hit: (_n, token) => commandRead(token),
    limit: 60,
    code: "RATE_LIMITED",
  },
  {
    lane: "write",
    hit: (_n, token) => commandWrite("tab-1", token),
    limit: 20,
    code: "RATE_LIMITED",
  },
  {
    lane: "transport:stream",
    hit: (_n, token) => streamOpen("tab-1", token),
    limit: 96,
    code: "TRANSPORT_RATE_LIMITED",
  },
  {
    lane: "transport:heartbeat",
    hit: (_n, token) => heartbeat("tab-1", token),
    limit: 160,
    code: "TRANSPORT_RATE_LIMITED",
  },
  {
    lane: "transport:result",
    hit: (n, token) => result(n, "tab-1", token),
    limit: 432,
    code: "TRANSPORT_RATE_LIMITED",
  },
];

/** Send `count` requests in order; return how many got each status. */
async function burst(
  count: number,
  hit: (n: number) => Promise<Response>
): Promise<Record<number, number>> {
  const statuses: Record<number, number> = {};
  for (let n = 0; n < count; n++) {
    const res = await hit(n);
    statuses[res.status] = (statuses[res.status] ?? 0) + 1;
  }
  return statuses;
}

/** The four `X-RateLimit-*` headers a response carries (null when absent). */
function budget(res: Response) {
  return {
    lane: res.headers.get("X-RateLimit-Lane"),
    limit: res.headers.get("X-RateLimit-Limit"),
    remaining: res.headers.get("X-RateLimit-Remaining"),
    resetAfter: res.headers.get("X-RateLimit-Reset-After"),
  };
}

/** 30 s into a minute window: the furthest point from either boundary. */
const FROZEN_NOW = new Date("2026-01-01T00:00:30.000Z");

/**
 * Run `fn` with the clock frozen inside one rate-limit window, so a long
 * burst cannot straddle a minute boundary and restart a counter
 * (`route.audit-rl.test.ts` `withFrozenWindow` explains the flake it fixes).
 */
async function withFrozenWindow<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  expect(Date.now()).toBe(FROZEN_NOW.getTime());
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

describe("route.ts rate-limit lanes: SDK transport has per-principal sub-lanes of its own", () => {
  beforeEach(() => {
    __resetAuthCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        if (url.endsWith("/api/v1/auth/users/me")) {
          // An operator bearer resolves here; a device JWT is refused, which
          // sends `_auth.ts` on to `/devices/me`.
          return auth === `Bearer ${OPERATOR_TOKEN}`
            ? json({ id: OPERATOR_ID })
            : new Response(null, { status: 401 });
        }
        if (url.endsWith("/api/v1/devices/me")) {
          return auth === `Bearer ${DEVICE_TOKEN}`
            ? json({
                device_id: "device-1",
                user_id: OPERATOR_ID,
                tenant_id: "tenant-1",
              })
            : new Response(null, { status: 401 });
        }
        return new Response(null, { status: 201 });
      })
    );
    vi.stubEnv("BACKEND_URL", BACKEND_URL);
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "1");
    __setRedisClientForTest(makeMockRedis().client);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __setRedisClientForTest(undefined);
    vi.useRealTimers();
  });

  it("(a) four tabs x 10 heartbeats in one window, no commands: all admitted", async () => {
    await withFrozenWindow(async () => {
      const statuses = await burst(40, (n) => heartbeat(`tab-${n % 4}`));
      expect(statuses).toEqual({ 200: 40 });
    });
  });

  it("(b) 40 command results beside 20 command writes: all admitted; the 21st command write is RATE_LIMITED", async () => {
    await withFrozenWindow(async () => {
      const statuses: Record<number, number> = {};
      for (let n = 0; n < 40; n++) {
        const res = await result(n, `tab-${n % 4}`);
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        if (n < 20) {
          const write = await commandWrite(`tab-${n % 4}`);
          statuses[write.status] = (statuses[write.status] ?? 0) + 1;
        }
      }
      expect(statuses).toEqual({ 200: 60 });

      const denied = await commandWrite("tab-1");
      expect(denied.status).toBe(429);
      expect(await denied.json()).toMatchObject({
        success: false,
        code: "RATE_LIMITED",
      });
    });
  });

  it("(c) 20 command writes naming 3 distinct tabs, then one more: refused — N tabs buy no command budget", async () => {
    await withFrozenWindow(async () => {
      const tabs = ["tab-a", "tab-b", "tab-c"];
      const statuses = await burst(20, (n) => commandWrite(tabs[n % 3]));
      expect(statuses).toEqual({ 200: 20 });

      const denied = await commandWrite("tab-d");
      expect(denied.status).toBe(429);
      expect(await denied.json()).toMatchObject({
        success: false,
        code: "RATE_LIMITED",
      });
    });
  });

  it.each([
    ["transport:stream", 96, (_n: number) => streamOpen()],
    ["transport:heartbeat", 160, (_n: number) => heartbeat()],
    ["transport:result", 432, (n: number) => result(n)],
  ] as const)(
    "(d) %s admits %i in one window and refuses the next with TRANSPORT_RATE_LIMITED",
    async (lane, limit, hit) => {
      await withFrozenWindow(async () => {
        const statuses = await burst(limit, hit);
        expect(statuses).toEqual({ 200: limit });

        const denied = await hit(limit);
        expect(denied.status).toBe(429);
        expect(denied.headers.get("Retry-After")).toBe("30");
        expect(await denied.json()).toMatchObject({
          success: false,
          code: "TRANSPORT_RATE_LIMITED",
          lane,
          retryAfterSec: 30,
        });
      });
    },
    60_000
  );

  it("(e) an operator's exhausted lanes leave the device paired to it admitted", async () => {
    await withFrozenWindow(async () => {
      expect(await burst(160, () => heartbeat("tab-op"))).toEqual({
        200: 160,
      });
      expect((await heartbeat("tab-op")).status).toBe(429);
      expect(await burst(20, () => commandWrite("tab-op"))).toEqual({
        200: 20,
      });
      expect((await commandWrite("tab-op")).status).toBe(429);

      const deviceBeat = await heartbeat("tab-dev", DEVICE_TOKEN);
      expect(deviceBeat.status).toBe(200);
      expect(budget(deviceBeat)).toMatchObject({
        lane: "transport:heartbeat",
        remaining: "159",
      });
      const deviceWrite = await commandWrite("tab-dev", DEVICE_TOKEN);
      expect(deviceWrite.status).toBe(200);
      expect(budget(deviceWrite)).toMatchObject({
        lane: "write",
        remaining: "19",
      });
    });
  }, 60_000);

  it("(e) a device's exhausted lanes leave its paired operator admitted", async () => {
    await withFrozenWindow(async () => {
      expect(
        await burst(160, () => heartbeat("tab-dev", DEVICE_TOKEN))
      ).toEqual({ 200: 160 });
      expect((await heartbeat("tab-dev", DEVICE_TOKEN)).status).toBe(429);
      expect(await burst(60, () => commandRead(DEVICE_TOKEN))).toEqual({
        200: 60,
      });
      expect((await commandRead(DEVICE_TOKEN)).status).toBe(429);

      const operatorBeat = await heartbeat("tab-op");
      expect(operatorBeat.status).toBe(200);
      expect(budget(operatorBeat)).toMatchObject({
        lane: "transport:heartbeat",
        remaining: "159",
      });
      const operatorRead = await commandRead();
      expect(operatorRead.status).toBe(200);
      expect(budget(operatorRead)).toMatchObject({
        lane: "read",
        remaining: "59",
      });
    });
  }, 60_000);

  it.each(LANES.map((l) => [l.lane, l] as const))(
    "(f) exhausting %s leaves every other lane admitted with a full budget",
    async (_name, exhausted) => {
      await withFrozenWindow(async () => {
        expect(await burst(exhausted.limit, exhausted.hit)).toEqual({
          200: exhausted.limit,
        });
        const denied = await exhausted.hit(exhausted.limit);
        expect(denied.status).toBe(429);
        expect(await denied.json()).toMatchObject({ code: exhausted.code });

        // A counter shared with the exhausted lane shows here as a refusal,
        // or as a remaining budget below `limit - 1`.
        for (const other of LANES.filter((l) => l !== exhausted)) {
          const res = await other.hit(0);
          expect(res.status, other.lane).toBe(200);
          expect(budget(res), other.lane).toMatchObject({
            lane: other.lane,
            remaining: String(other.limit - 1),
          });
        }
      });
    },
    60_000
  );

  it.each([
    ["GET", "/commands/stream", "transport:stream", 200],
    ["POST", "/heartbeat", "transport:heartbeat", 200],
    ["POST", "/commands", "transport:result", 200],
    ["GET", "/health", "read", 200],
    ["GET", "/tabs", "read", 200],
    ["GET", "/control/snapshot", "read", 200],
    ["POST", "/control/page/navigate", "write", 200],
    // Method-qualified: a near miss bills a command lane — and, being no
    // route at all, is a 404 that is still answered after the check.
    ["GET", "/heartbeat", "read", 404],
    ["POST", "/commands/stream", "write", 404],
  ] as const)(
    "(g) %s %s bills the %s lane",
    async (method, path, lane, status) => {
      const res = await send(method, path, {
        body: method === "GET" ? undefined : { tabId: "tab-1" },
      });
      expect(res.status).toBe(status);
      expect(res.headers.get("X-RateLimit-Lane")).toBe(lane);
    }
  );

  it.each(LANES.map((l) => [l.lane, l] as const))(
    "(h) Redis offline: %s admits past its ceiling and reports its remaining budget as unknown",
    async (_name, lane) => {
      __setRedisClientForTest(null);
      await withFrozenWindow(async () => {
        expect(await burst(lane.limit + 1, lane.hit)).toEqual({
          200: lane.limit + 1,
        });

        const res = await lane.hit(lane.limit + 1);
        expect(res.status).toBe(200);
        expect(budget(res)).toEqual({
          lane: lane.lane,
          limit: String(lane.limit),
          remaining: "unknown",
          resetAfter: "30",
        });
      });
    },
    60_000
  );

  it.each(LANES.map((l) => [l.lane, l] as const))(
    "(h) a Redis connection that is not ready yet: %s admits past its ceiling and reports its remaining budget as unknown",
    async (_name, lane) => {
      // With `enableOfflineQueue: false`, ioredis REJECTS a command sent on a
      // connection that is not ready (and resolves a pipeline with an error
      // per command): every cold instance's first request, and every request
      // while Redis is down. `notReadyRedis` models both, as measured.
      __setRedisClientForTest(notReadyRedis().client);
      await withFrozenWindow(async () => {
        expect(await burst(lane.limit + 1, lane.hit)).toEqual({
          200: lane.limit + 1,
        });
        expect(budget(await lane.hit(lane.limit + 1))).toEqual({
          lane: lane.lane,
          limit: String(lane.limit),
          remaining: "unknown",
          resetAfter: "30",
        });
      });
    },
    60_000
  );

  it("(i) a 200 carries its lane's budget", async () => {
    await withFrozenWindow(async () => {
      const res = await heartbeat();
      expect(res.status).toBe(200);
      expect(budget(res)).toEqual({
        lane: "transport:heartbeat",
        limit: "160",
        remaining: "159",
        resetAfter: "30",
      });
    });
  });

  it("(i) a 429 carries its lane's budget and Retry-After", async () => {
    await withFrozenWindow(async () => {
      expect(await burst(20, () => commandWrite())).toEqual({ 200: 20 });
      const denied = await commandWrite();
      expect(denied.status).toBe(429);
      expect(denied.headers.get("Retry-After")).toBe("30");
      expect(budget(denied)).toEqual({
        lane: "write",
        limit: "20",
        remaining: "0",
        resetAfter: "30",
      });
      expect(await denied.json()).toMatchObject({
        success: false,
        code: "RATE_LIMITED",
        lane: "write",
      });
    });
  });

  it("(i) the /health augmentation carries the read lane's budget", async () => {
    await withFrozenWindow(async () => {
      const res = await send("GET", "/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ relayBus: "in-memory" });
      expect(budget(res)).toEqual({
        lane: "read",
        limit: "60",
        remaining: "59",
        resetAfter: "30",
      });
    });
  });

  it.each([
    ["read", "60"],
    ["write", "20"],
    ["transport:stream", "96"],
    ["transport:heartbeat", "160"],
    ["transport:result", "432"],
  ] as const)(
    "(i) the %s lane announces X-RateLimit-Limit %s",
    async (laneName, limit) => {
      const lane = LANES.find((l) => l.lane === laneName);
      expect(lane, laneName).toBeDefined();
      const res = await lane?.hit(0);
      expect(res?.status).toBe(200);
      expect(res && budget(res)).toMatchObject({ lane: laneName, limit });
    }
  );

  it("logs lane_refused for the 1st, 2nd and 4th refusal of a lane, naming the lane and the principal kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const refusals = () =>
      warn.mock.calls.filter((call) =>
        String(call[0]).includes("lane_refused")
      );

    await withFrozenWindow(async () => {
      expect(await burst(160, () => heartbeat())).toEqual({ 200: 160 });
      expect(refusals()).toEqual([]);

      // Four refusals in the window (overflow 1-4): logged at 1, 2 and 4.
      expect(await burst(4, () => heartbeat())).toEqual({ 429: 4 });
      expect(
        await burst(20, () => commandWrite("tab-dev", DEVICE_TOKEN))
      ).toEqual({ 200: 20 });
      expect((await commandWrite("tab-dev", DEVICE_TOKEN)).status).toBe(429);
    });

    expect(refusals().map((call) => call[1])).toEqual([
      ...[161, 162, 164].map((count) =>
        expect.objectContaining({
          lane: "transport:heartbeat",
          principalKind: "user",
          count,
          limit: 160,
        })
      ),
      expect.objectContaining({
        lane: "write",
        principalKind: "device",
        count: 21,
        limit: 20,
      }),
    ]);
  }, 60_000);
});
