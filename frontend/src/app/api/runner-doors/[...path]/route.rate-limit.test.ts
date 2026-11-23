/**
 * The runner door proxy draws on its OWN rate-limit lanes, and its 429 names
 * them.
 *
 * Plan 2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429,
 * Phase 2 (design decision D1). The proxy used to bill a runner-door call to
 * the UI Bridge relay's COMMAND lanes (`kindForMethod` → `r` / `w`), so a page
 * polling a runner door spent the same per-user budget the operator's relay
 * commands draw on, and a 429 from either could not be told apart. Now:
 *
 *   (a) `runner-door:write` is exhausted by 20 door writes while a relay
 *       command write for the SAME user is still admitted;
 *   (b) the door's 429 is `RUNNER_DOOR_RATE_LIMITED` with
 *       `X-RateLimit-Lane: runner-door:write`, and every response after the
 *       check carries the lane's budget.
 *
 * Thresholds are LITERALS (20, 21, 60, 61), never the module's constants, so a
 * constant that drifts fails here.
 *
 * Harness: the shared in-memory Redis (`@/test/rate-limit-redis-mock`) and a
 * frozen clock (only `Date` is faked — the ownership probe's timers stay
 * real), so every call lands in one minute window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { makeMockRedis } from "@/test/rate-limit-redis-mock";

import { __resetAuthCache } from "../../ui-bridge/[...path]/_auth";
import {
  __setRedisClientForTest,
  checkRateLimit,
  laneFor,
} from "../../ui-bridge/[...path]/_rate-limit";
import { __resetRunnerOwnershipCache } from "../../_runner-hop/bridge-session";
import * as route from "./route";

const BACKEND_URL = "http://backend.test";
const USER_TOKEN = "operator-bearer";
const USER_ID = "user-1";
const FROZEN_NOW = new Date("2026-11-23T12:00:05.000Z");

type Method = "GET" | "POST" | "PUT" | "DELETE";

/** The devices the operator owns; a runner outside them is not proxied. */
let ownedDeviceIds: string[] = ["DEV-OWN"];
/**
 * How the runner answers a door call: a 200, its own 429, or no answer (the
 * fetch rejects; `abort` aborts the request's signal first, as a browser
 * giving up does).
 */
let runnerAnswer: "ok" | "429" | "unreachable" = "ok";
let abortBeforeFailing: AbortController | null = null;
/** Whether the backend rate-limits the auth probe or the ownership probe. */
let backend429: "none" | "auth" | "devices" = "none";

/** A backend 429 as `rate_limit_exceeded_handler` answers it. */
function backendRefusal(lane: string): Response {
  return Response.json(
    { error: "RATE_LIMIT_EXCEEDED", lane, key_kind: "ip" },
    {
      status: 429,
      headers: {
        "retry-after": "30",
        "x-ratelimit-lane": lane,
        "x-ratelimit-key-kind": "ip",
      },
    }
  );
}

function installFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      if (url.startsWith(BACKEND_URL)) {
        if (backend429 === "auth" && url.endsWith("/api/v1/auth/users/me")) {
          return backendRefusal("default:/api/v1/auth/users/me");
        }
        if (backend429 === "devices" && url.endsWith("/api/v1/devices")) {
          return backendRefusal("user:/api/v1/devices");
        }
        if (
          url.endsWith("/api/v1/auth/users/me") &&
          auth === `Bearer ${USER_TOKEN}`
        ) {
          return Response.json({ id: USER_ID });
        }
        if (
          url.endsWith("/api/v1/devices") &&
          auth === `Bearer ${USER_TOKEN}`
        ) {
          return Response.json(ownedDeviceIds.map((id) => ({ id })));
        }
        return new Response(null, { status: 401 });
      }
      if (url.endsWith("/settings/device-info")) {
        return Response.json({ success: true, data: { device_id: "dev-own" } });
      }
      if (runnerAnswer === "429") {
        return Response.json(
          { success: false, code: "RUNNER_BUSY" },
          { status: 429, headers: { "retry-after": "7" } }
        );
      }
      if (runnerAnswer === "unreachable") {
        abortBeforeFailing?.abort();
        throw new TypeError("fetch failed");
      }
      return Response.json({ success: true, data: { ok: true } });
    })
  );
}

function door(
  method: Method,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  const host = "localhost:3001";
  const req = new NextRequest(`http://${host}/api/runner-doors${path}`, {
    method,
    signal,
    headers: {
      host,
      origin: `http://${host}`,
      authorization: `Bearer ${USER_TOKEN}`,
      "content-type": "application/json",
      "x-qontinui-runner-port": "9876",
    },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
  const segments = path.split("/").filter(Boolean);
  const ctx = { params: Promise.resolve({ path: segments }) };
  // Each verb is named, so the call site states the route entry it uses.
  switch (method) {
    case "GET":
      return route.GET(req, ctx);
    case "POST":
      return route.POST(req, ctx);
    case "PUT":
      return route.PUT(req, ctx);
    case "DELETE":
      return route.DELETE(req, ctx);
  }
}

beforeEach(() => {
  __resetAuthCache();
  __resetRunnerOwnershipCache();
  ownedDeviceIds = ["DEV-OWN"];
  runnerAnswer = "ok";
  abortBeforeFailing = null;
  backend429 = "none";
  vi.stubEnv("BACKEND_URL", BACKEND_URL);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QONTINUI_WEB_RUNNER_DOOR_PROXY", "");
  installFetch();
  __setRedisClientForTest(makeMockRedis().client);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FROZEN_NOW);
  expect(Date.now()).toBe(FROZEN_NOW.getTime());
});

afterEach(() => {
  vi.useRealTimers();
  __setRedisClientForTest(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runner door proxy — its own lanes (D1)", () => {
  it("(a) 20 door writes exhaust runner-door:write while a relay command write for the same user is still admitted", async () => {
    for (let n = 1; n <= 20; n++) {
      const res = await door("POST", "/hooks/abc/test");
      expect(res.status, `door write ${n}`).toBe(200);
    }
    expect((await door("POST", "/hooks/abc/test")).status).toBe(429);

    // The relay bills a command write through `laneFor`; the operator's
    // command budget is untouched by the door's 21 writes.
    const relayWrite = await checkRateLimit(
      USER_ID,
      laneFor("/control/page/navigate", "POST")
    );
    expect(relayWrite.kind).toBe("write");
    expect(relayWrite.allowed).toBe(true);
    expect(relayWrite.count).toBe(1);
  });

  it("door reads draw on runner-door:read, apart from the relay's read lane: 60 admitted, the 61st refused", async () => {
    for (let n = 1; n <= 60; n++) {
      const res = await door("GET", "/settings/backup/summary");
      expect(res.status, `door read ${n}`).toBe(200);
    }
    const refused = await door("GET", "/settings/backup/summary");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-RateLimit-Lane")).toBe("runner-door:read");

    const relayRead = await checkRateLimit(
      USER_ID,
      laneFor("/control/snapshot", "GET")
    );
    expect(relayRead.allowed).toBe(true);
    expect(relayRead.count).toBe(1);
  });

  it("(b) the door's 429 is RUNNER_DOOR_RATE_LIMITED and names runner-door:write", async () => {
    for (let n = 1; n <= 20; n++) {
      await door("POST", "/hooks/abc/test");
    }
    const refused = await door("POST", "/hooks/abc/test");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-RateLimit-Lane")).toBe("runner-door:write");
    expect(refused.headers.get("X-RateLimit-Limit")).toBe("20");
    expect(refused.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(refused.headers.get("Retry-After")).not.toBeNull();
    const body = await refused.json();
    expect(body).toMatchObject({
      success: false,
      code: "RUNNER_DOOR_RATE_LIMITED",
      lane: "runner-door:write",
    });
  });

  it("PUT and DELETE door calls draw on runner-door:write too", async () => {
    for (const method of ["PUT", "DELETE"] as const) {
      const res = await door(method, "/hooks/abc");
      expect(res.status, method).toBe(200);
      expect(res.headers.get("X-RateLimit-Lane"), method).toBe(
        "runner-door:write"
      );
    }
    const third = await door("POST", "/hooks/abc/test");
    expect(third.headers.get("X-RateLimit-Remaining")).toBe("17");
  });

  it("every response after the check carries the lane's budget", async () => {
    const res = await door("POST", "/hooks/abc/test");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Lane")).toBe("runner-door:write");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("20");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("19");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("with Redis offline the door fails open and says its remaining budget is unknown", async () => {
    __setRedisClientForTest(null);
    const res = await door("GET", "/settings/backup/summary");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Lane")).toBe("runner-door:read");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("unknown");
  });
});

/** The four budget headers a response after the check carries. */
function expectBudget(res: Response, lane: string): void {
  expect(res.headers.get("X-RateLimit-Lane")).toBe(lane);
  expect(res.headers.get("X-RateLimit-Limit")).not.toBeNull();
  expect(res.headers.get("X-RateLimit-Remaining")).not.toBeNull();
  expect(res.headers.get("X-RateLimit-Reset-After")).not.toBeNull();
}

describe("runner door proxy — every arm after the check carries the budget", () => {
  it("a runner that is not the operator's own → 403 with the budget", async () => {
    ownedDeviceIds = ["someone-elses-runner"];
    const res = await door("POST", "/hooks/abc/test");
    expect(res.status).toBe(403);
    expectBudget(res, "runner-door:write");
  });

  it("the browser giving up → 499 with the budget", async () => {
    runnerAnswer = "unreachable";
    abortBeforeFailing = new AbortController();
    const res = await door(
      "GET",
      "/settings/backup/summary",
      abortBeforeFailing.signal
    );
    expect(res.status).toBe(499);
    expectBudget(res, "runner-door:read");
  });

  it("a runner that does not answer → 502 with the budget", async () => {
    runnerAnswer = "unreachable";
    const res = await door("POST", "/hooks/abc/test");
    expect(res.status).toBe(502);
    expectBudget(res, "runner-door:write");
  });
});

describe("runner door proxy — a runner's own 429 is not the door's", () => {
  it("passes the runner's 429 through, marked refused by the runner, with no door lane or budget", async () => {
    runnerAnswer = "429";
    const res = await door("POST", "/hooks/abc/test");
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Refused-By")).toBe("runner");
    expect(res.headers.get("retry-after")).toBe("7");
    for (const name of [
      "X-RateLimit-Lane",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset-After",
    ]) {
      expect(res.headers.get(name), name).toBeNull();
    }
    expect(await res.json()).toMatchObject({ code: "RUNNER_BUSY" });
  });

  it("the door's own 429 is marked by neither the runner nor a missing lane", async () => {
    for (let n = 1; n <= 20; n++) await door("POST", "/hooks/abc/test");
    const refused = await door("POST", "/hooks/abc/test");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("X-RateLimit-Refused-By")).toBeNull();
    expect(refused.headers.get("X-RateLimit-Lane")).toBe("runner-door:write");
  });
});

describe("runner door proxy — a refusal is logged server-side", () => {
  it("logs lane_refused naming the lane and the method, never the user id or the path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (let n = 1; n <= 20; n++) await door("POST", "/hooks/abc123/test");
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes("lane_refused"))
      ).toHaveLength(0);
      await door("POST", "/hooks/abc123/test");
      const lines = warn.mock.calls.filter((c) =>
        String(c[0]).includes("lane_refused")
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]![1]).toMatchObject({
        lane: "runner-door:write",
        method: "POST",
        principalKind: "user",
        count: 21,
        limit: 20,
      });
      const text = JSON.stringify(lines[0]);
      expect(text).not.toContain(USER_ID);
      expect(text).not.toContain(USER_TOKEN);
      expect(text).not.toContain("abc123");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("runner door proxy — a backend's 429 is the backend's", () => {
  const DOOR_BUDGET = [
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset-After",
  ];

  it("the ownership probe's 429 carries the backend's lane and key kind, refused by the backend, and no door budget", async () => {
    backend429 = "devices";
    const res = await door("POST", "/hooks/abc/test");
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Refused-By")).toBe("backend");
    expect(res.headers.get("X-RateLimit-Lane")).toBe("user:/api/v1/devices");
    expect(res.headers.get("X-RateLimit-Key-Kind")).toBe("ip");
    expect(res.headers.get("Retry-After")).toBe("30");
    for (const name of DOOR_BUDGET) {
      expect(res.headers.get(name), name).toBeNull();
    }
  });

  it("the operator auth probe's 429 carries the backend's lane and key kind, refused by the backend", async () => {
    backend429 = "auth";
    const res = await door("GET", "/settings/backup/summary");
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Refused-By")).toBe("backend");
    expect(res.headers.get("X-RateLimit-Lane")).toBe(
      "default:/api/v1/auth/users/me"
    );
    expect(res.headers.get("X-RateLimit-Key-Kind")).toBe("ip");
    expect(res.headers.get("Retry-After")).toBe("30");
    for (const name of DOOR_BUDGET) {
      expect(res.headers.get(name), name).toBeNull();
    }
  });
});
