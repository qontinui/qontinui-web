/**
 * With the auth gate on, the request the route hands the SDK names no caller
 * except the verified one.
 *
 * The SDK relay reads a caller identity under two names, `__callerUserId` and
 * `callerUserId`. With the gate on, the only identity it may act on is the
 * verified `X-Caller-User-Id`, so the route removes either name from the
 * query and the JSON body before forwarding. A body the route cannot parse
 * the way the SDK parses it is refused with a typed 400 rather than
 * forwarded unstripped. These tests go through the real `route.ts` handler
 * and read what it forwards to the SDK: the query, the header, and the body
 * read with `.json()` on the forwarded request — the SDK's own call. With
 * the gate off the route forwards the request as it came, and the last tests
 * pin that it is left untouched.
 *
 * The byte-order-mark cases pin, as a precondition, what the platform's
 * `Request.json()` does with the bytes (measured on Node 22 and 24: it drops
 * two leading marks and refuses a third), so a platform that changes that
 * fails here by name rather than as a mystery.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { __resetAuthCache } from "./_auth";
import { __setRedisClientForTest } from "./_rate-limit";

/** Every request the route forwarded to the SDK's handler, in order. */
const forwarded = vi.hoisted(() => [] as Request[]);

vi.mock("@/lib/ui-bridge/relay", () => ({
  relay: {
    hasCommandListeners: () => true,
    getWebSocketClientCount: () => 1,
  },
  handlers: {},
  getRelayBusStatus: () => "in-memory",
}));

vi.mock("@qontinui/ui-bridge/server", () => {
  const capture = async (request: Request) => {
    forwarded.push(request);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return {
    createNextRouteHandlers: () => ({
      GET: capture,
      POST: capture,
      PUT: capture,
      DELETE: capture,
    }),
    createRedisRelayBus: async () => null,
    CommandRelay: class {},
    createRelayHandlers: () => ({}),
    SSEManager: class {},
    UI_BRIDGE_ROUTES: [
      { method: "GET", path: "/control/snapshot" },
      { method: "GET", path: "/control/element/:id/state" },
      { method: "POST", path: "/control/find" },
      { method: "POST", path: "/control/element/:id/action" },
    ],
  };
});

vi.mock("./_audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_audit")>();
  return { ...actual, recordAudit: async () => undefined };
});

// Import the route AFTER the mocks are declared so they take effect.
import * as route from "./route";

const BACKEND_URL = "http://backend.test";
const VERIFIED = "user-b";

/** A rate-limit store that always admits (the route keys it per principal). */
function admittingRedis() {
  const pipeline = {
    incr() {
      return pipeline;
    },
    expire() {
      return pipeline;
    },
    async exec() {
      return [
        [null, 1],
        [null, 1],
      ];
    },
  };
  return {
    pipeline: () => pipeline,
    on: () => undefined,
  } as unknown as Parameters<typeof __setRedisClientForTest>[0];
}

function call(
  method: "GET" | "POST",
  pathAndQuery: string,
  body?: BodyInit,
  headers: Record<string, string> = {}
): Promise<Response> {
  const request = new NextRequest(
    `http://localhost/api/ui-bridge${pathAndQuery}`,
    {
      method,
      headers: {
        authorization: "Bearer a-good-token",
        origin: "https://qontinui.io",
        ...headers,
      },
      ...(body !== undefined ? { body } : {}),
    }
  );
  const path = pathAndQuery.split("?")[0].slice(1).split("/");
  const context = { params: Promise.resolve({ path }) };
  return method === "GET"
    ? route.GET(request, context)
    : route.POST(request, context);
}

/**
 * The last forwarded request: its query entries, header, raw body bytes, and
 * the body read with `.json()` on the forwarded request itself — exactly the
 * call the SDK makes on it.
 */
async function lastForwarded() {
  const request = forwarded.at(-1);
  if (!request) throw new Error("the route forwarded nothing");
  const bytes = new Uint8Array(await request.clone().arrayBuffer());
  return {
    query: [...new URL(request.url).searchParams.entries()],
    callerHeader: request.headers.get("x-caller-user-id"),
    bytes,
    body: bytes.byteLength > 0 ? await request.json() : undefined,
  };
}

const BOM = [0xef, 0xbb, 0xbf];

/** `json` as UTF-8 bytes behind `count` byte-order marks. */
function withBoms(count: number, json: string): Uint8Array {
  return new Uint8Array([
    ...Array.from({ length: count }, () => BOM).flat(),
    ...new TextEncoder().encode(json),
  ]);
}

/** Whether the platform's `Request.json()` — the SDK's parser — reads `bytes`. */
async function platformParses(bytes: Uint8Array): Promise<boolean> {
  return new Request("http://localhost/", { method: "POST", body: bytes })
    .json()
    .then(
      () => true,
      () => false
    );
}

const SPOOFED_BODY =
  '{"text":"Save","callerUserId":"user-a","__callerUserId":"user-a","request":{"action":"click","__callerUserId":"user-a"}}';

describe("route.ts, gate on: a request cannot name its caller", () => {
  beforeEach(() => {
    forwarded.length = 0;
    __resetAuthCache();
    __setRedisClientForTest(admittingRedis());
    vi.stubEnv("BACKEND_URL", BACKEND_URL);
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/api/v1/auth/users/me")
          ? new Response(JSON.stringify({ id: VERIFIED }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          : new Response(null, { status: 201 })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    __setRedisClientForTest(undefined);
  });

  it("drops both spellings from the query and keeps every other parameter", async () => {
    const res = await call(
      "GET",
      "/control/snapshot?recency=any&__callerUserId=user-a&tabId=t1&callerUserId=user-a"
    );
    expect(res.status).toBe(200);
    const sent = await lastForwarded();
    expect(sent.query).toEqual([
      ["recency", "any"],
      ["tabId", "t1"],
    ]);
    expect(sent.callerHeader).toBe(VERIFIED);
  });

  it("drops every occurrence of a repeated query key, encoded spellings included", async () => {
    await call(
      "GET",
      "/control/element/save/state?callerUserId=user-a&callerUserId=user-c&%5F%5FcallerUserId=user-a"
    );
    expect((await lastForwarded()).query).toEqual([]);
  });

  it("drops both spellings from the body, top level and the nested request", async () => {
    await call(
      "POST",
      "/control/find",
      JSON.stringify({
        text: "Save",
        callerUserId: "user-a",
        __callerUserId: "user-a",
        request: { action: "click", __callerUserId: "user-a" },
      }),
      { "content-type": "application/json" }
    );
    const sent = await lastForwarded();
    expect(sent.body).toEqual({ text: "Save", request: { action: "click" } });
    expect(sent.callerHeader).toBe(VERIFIED);
  });

  it("drops a repeated body key: the SDK parses the last one, the route drops them all", async () => {
    await call(
      "POST",
      "/control/find",
      '{"text":"Save","callerUserId":"user-a","callerUserId":"user-c"}',
      { "content-type": "application/json" }
    );
    expect((await lastForwarded()).body).toEqual({ text: "Save" });
  });

  it("strips a body behind one byte-order mark, sent as text/plain", async () => {
    const bytes = withBoms(1, '{"text":"Save","__callerUserId":"user-a"}');
    expect(await platformParses(bytes)).toBe(true);
    const res = await call("POST", "/control/find", bytes, {
      "content-type": "text/plain",
    });
    expect(res.status).toBe(200);
    const sent = await lastForwarded();
    expect(sent.body).toEqual({ text: "Save" });
    expect(sent.callerHeader).toBe(VERIFIED);
  });

  it("strips a body behind two byte-order marks, sent as JSON or as text/plain", async () => {
    const bytes = withBoms(2, SPOOFED_BODY);
    // Precondition: the SDK's parser reads this body.
    expect(await platformParses(bytes)).toBe(true);
    for (const contentType of ["application/json", "text/plain"]) {
      forwarded.length = 0;
      const res = await call("POST", "/control/find", bytes, {
        "content-type": contentType,
      });
      expect(res.status).toBe(200);
      const sent = await lastForwarded();
      expect(sent.body).toEqual({ text: "Save", request: { action: "click" } });
      expect(sent.callerHeader).toBe(VERIFIED);
    }
  });

  it("refuses a body behind three byte-order marks, which the SDK's parser cannot read", async () => {
    const bytes = withBoms(3, SPOOFED_BODY);
    // Precondition: the SDK's parser refuses this body.
    expect(await platformParses(bytes)).toBe(false);
    const res = await call("POST", "/control/find", bytes, {
      "content-type": "application/json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "BODY_NOT_JSON",
    });
    expect(forwarded).toHaveLength(0);
  });

  it("refuses a body that is not JSON and forwards nothing", async () => {
    const res = await call(
      "POST",
      "/control/element/save/action",
      "action=click&callerUserId=user-a",
      { "content-type": "application/x-www-form-urlencoded" }
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "BODY_NOT_JSON",
    });
    expect(forwarded).toHaveLength(0);
  });

  it("refuses a body that cannot be read and forwards nothing", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("the client went away"));
      },
    });
    const res = await call("POST", "/control/find", failing, {
      "content-type": "application/json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "BODY_UNREADABLE",
    });
    expect(forwarded).toHaveLength(0);
  });

  it("still forces registrationMetadata.userId to the verified id after the strip", async () => {
    await call(
      "POST",
      "/control/element/save/action",
      JSON.stringify({
        action: "click",
        callerUserId: "user-a",
        registrationMetadata: { userId: "user-a", sessionId: "s1" },
      }),
      { "content-type": "application/json" }
    );
    expect((await lastForwarded()).body).toEqual({
      action: "click",
      registrationMetadata: { userId: VERIFIED, sessionId: "s1" },
    });
  });

  it("leaves a request that names no caller as it was", async () => {
    await call(
      "POST",
      "/control/find?recency=any",
      JSON.stringify({ text: "Save" }),
      {
        "content-type": "application/json",
      }
    );
    const sent = await lastForwarded();
    expect(sent.query).toEqual([["recency", "any"]]);
    expect(sent.body).toEqual({ text: "Save" });
  });
});

describe("route.ts, gate off: the request is forwarded untouched", () => {
  beforeEach(() => {
    forwarded.length = 0;
    __resetAuthCache();
    vi.stubEnv("UI_BRIDGE_REQUIRE_AUTH", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the query and the body exactly as sent, with no caller header", async () => {
    await call(
      "POST",
      "/control/find?__callerUserId=user-a",
      JSON.stringify({ text: "Save", callerUserId: "user-a" }),
      { "content-type": "application/json" }
    );
    const sent = await lastForwarded();
    expect(sent.query).toEqual([["__callerUserId", "user-a"]]);
    expect(sent.body).toEqual({ text: "Save", callerUserId: "user-a" });
    expect(sent.callerHeader).toBeNull();
  });

  it("forwards a body the SDK's parser cannot read byte for byte, refusing nothing", async () => {
    const bytes = withBoms(3, SPOOFED_BODY);
    const res = await call("POST", "/control/find", bytes, {
      "content-type": "application/json",
    });
    expect(res.status).toBe(200);
    const request = forwarded.at(-1);
    if (!request) throw new Error("the route forwarded nothing");
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
    expect(request.headers.get("x-caller-user-id")).toBeNull();
  });
});
