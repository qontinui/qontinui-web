/**
 * The route against the REAL SDK handler, gate on: a caller the request body
 * names never reaches the relay, whatever the body's encoding.
 *
 * `route.caller-identity.test.ts` reads what the route forwards to a mocked
 * SDK. These tests leave `@qontinui/ui-bridge/server` unmocked and read what
 * the SDK itself does with the forwarded request, so a disagreement between
 * the route's body peek and the SDK's parser shows up here. The relay is a
 * real `CommandRelay` built by the real `createRelayHandlers`; only its
 * `queueCommand` is replaced by a recorder (so every dispatch the SDK makes,
 * with the `ownerCheck` it attaches, is observed without a browser) and it
 * reports a listener attached (so browser-required routes are reached).
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UI_BRIDGE_ROUTES } from "@qontinui/ui-bridge/server";

import { __resetAuthCache } from "./_auth";
import { __setRedisClientForTest } from "./_rate-limit";

/** Every command the SDK dispatched to the relay, in order. */
const dispatched = vi.hoisted(
  () => [] as Array<{ action: string; options: unknown }>
);

vi.mock("@/lib/ui-bridge/relay", async () => {
  const sdk = await vi.importActual<
    typeof import("@qontinui/ui-bridge/server")
  >("@qontinui/ui-bridge/server");
  const relay = new sdk.CommandRelay();
  vi.spyOn(relay, "hasCommandListeners").mockReturnValue(true);
  vi.spyOn(relay, "queueCommand").mockImplementation(
    async (action, _payload, options) => {
      dispatched.push({ action, options });
      return {} as never;
    }
  );
  return {
    relay,
    handlers: sdk.createRelayHandlers(relay, { version: "test" }),
    getRelayBusStatus: () => "in-memory",
  };
});

vi.mock("./_audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_audit")>();
  return { ...actual, recordAudit: async () => undefined };
});

// Import the route (and the relay it uses) AFTER the mocks are declared.
import * as route from "./route";
import { relay } from "@/lib/ui-bridge/relay";

const VERIFIED = "user-b";
const SPOOFED = "user-a";
const BOM = [0xef, 0xbb, 0xbf];

/** `json` as UTF-8 bytes behind `count` byte-order marks. */
function withBoms(count: number, json: string): Uint8Array {
  return new Uint8Array([
    ...Array.from({ length: count }, () => BOM).flat(),
    ...new TextEncoder().encode(json),
  ]);
}

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

function send(
  method: "POST" | "PUT",
  path: string,
  body: Uint8Array,
  contentType: string
): Promise<Response> {
  __resetAuthCache();
  __setRedisClientForTest(admittingRedis());
  const request = new NextRequest(`http://localhost/api/ui-bridge${path}`, {
    method,
    headers: {
      authorization: "Bearer a-good-token",
      origin: "https://qontinui.io",
      "content-type": contentType,
    },
    body,
  });
  const context = {
    params: Promise.resolve({ path: path.slice(1).split("/") }),
  };
  return method === "PUT"
    ? route.PUT(request, context)
    : route.POST(request, context);
}

/** The `ownerCheck.userId` of a recorded dispatch, or null when it has none. */
function ownerOf(options: unknown): string | null {
  const owner = (options as { ownerCheck?: { userId?: unknown } } | undefined)
    ?.ownerCheck?.userId;
  return typeof owner === "string" ? owner : null;
}

describe("route.ts + the real SDK, gate on: a body cannot name its caller", () => {
  beforeEach(() => {
    dispatched.length = 0;
    vi.stubEnv("BACKEND_URL", "http://backend.test");
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

  it("dispatches an action whose body names another caller behind two byte-order marks under the verified owner", async () => {
    const res = await send(
      "POST",
      "/control/element/save/action",
      withBoms(
        2,
        `{"action":"click","callerUserId":"${SPOOFED}","__callerUserId":"${SPOOFED}","request":{"__callerUserId":"${SPOOFED}"}}`
      ),
      "application/json"
    );
    expect(res.status).toBe(200);
    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched.map(({ options }) => ownerOf(options))).toEqual(
      dispatched.map(() => VERIFIED)
    );
  });

  it("registers a tab a two-byte-order-mark heartbeat claims for another user to the verified caller", async () => {
    const res = await send(
      "POST",
      "/heartbeat",
      withBoms(
        2,
        `{"tabId":"tab-heartbeat","registrationMetadata":{"userId":"${SPOOFED}","sessionId":"s1"}}`
      ),
      "text/plain"
    );
    expect(res.status).toBe(200);
    expect(relay.getOwnership("tab-heartbeat")?.userId).toBe(VERIFIED);
  });

  it("never dispatches under a caller the body names, on any body route, in any encoding", async () => {
    // The caller is named at the top level, in the nested `request` (the two
    // positions the SDK reads one from), and also in every other nested
    // object a handler might forward, so a read position the route does not
    // strip would surface here as a dispatch under the spoofed owner.
    const named = { callerUserId: SPOOFED, __callerUserId: SPOOFED };
    const body = JSON.stringify({
      text: "Save",
      action: "click",
      url: "https://qontinui.io/",
      instruction: "open settings",
      query: "settings",
      name: "settings",
      ...named,
      request: { action: "click", ...named, params: { ...named } },
      params: { ...named },
      options: { ...named },
      payload: { ...named },
      context: { ...named },
      criteria: { ...named },
      config: { ...named },
      steps: [{ action: "click", ...named }],
    });
    const encodings = [
      { label: "JSON", bytes: withBoms(0, body), type: "application/json" },
      { label: "text/plain", bytes: withBoms(0, body), type: "text/plain" },
      { label: "one mark", bytes: withBoms(1, body), type: "application/json" },
      {
        label: "two marks",
        bytes: withBoms(2, body),
        type: "application/json",
      },
      {
        label: "two marks, text/plain",
        bytes: withBoms(2, body),
        type: "text/plain",
      },
      {
        label: "three marks",
        bytes: withBoms(3, body),
        type: "application/json",
      },
    ];
    const routes = [
      ...UI_BRIDGE_ROUTES.filter(
        (r) => r.method === "POST" || r.method === "PUT"
      ).map((r) => ({ method: r.method as "POST" | "PUT", path: r.path })),
      // The relay-transport POST routes this route forwards, outside
      // UI_BRIDGE_ROUTES (`_browser-required.ts`); only /commands reads a body.
      { method: "POST" as const, path: "/commands" },
      { method: "POST" as const, path: "/tabs/:id/activate" },
      { method: "POST" as const, path: "/tabs/:id/close" },
    ];

    const spoofedCells: string[] = [];
    const unrefusedCells: string[] = [];
    for (const r of routes) {
      const path = r.path.replace(/:[^/]+/g, "x1");
      for (const encoding of encodings) {
        const before = dispatched.length;
        const res = await send(r.method, path, encoding.bytes, encoding.type);
        const cell = `${r.method} ${r.path} (${encoding.label})`;
        if (
          dispatched
            .slice(before)
            .some(
              ({ options }) =>
                ownerOf(options) !== null && ownerOf(options) !== VERIFIED
            )
        ) {
          spoofedCells.push(cell);
        }
        if (encoding.label === "three marks" && res.status !== 400) {
          unrefusedCells.push(`${cell} -> ${res.status}`);
        }
      }
    }

    expect(spoofedCells).toEqual([]);
    expect(unrefusedCells).toEqual([]);
    // Not vacuous: the sweep reached the relay under the verified owner, so
    // its silence about a spoofed owner is evidence rather than an empty run.
    expect(routes.length).toBeGreaterThan(100);
    expect(
      dispatched.filter(({ options }) => ownerOf(options) === VERIFIED).length
    ).toBeGreaterThan(100);
  }, 120_000);

  it("never dispatches under a caller the query names, on any GET route", async () => {
    // Both names, repeated, and percent-encoded, beside a parameter the
    // route keeps, so the query still reaches the handler as an argument.
    const query =
      `?recency=any&__callerUserId=${SPOOFED}&callerUserId=${SPOOFED}` +
      `&%5F%5FcallerUserId=${SPOOFED}&caller%55serId=${SPOOFED}`;
    // Streams and the blocking tab wait never return on their own.
    const unending = new Set([
      "/commands/stream",
      "/control/events/stream",
      "/control/changes/stream",
      "/tabs/wait",
    ]);
    const routes = [
      ...UI_BRIDGE_ROUTES.filter((r) => r.method === "GET").map((r) => r.path),
      "/health",
      "/status",
      "/tabs",
    ].filter((path) => !unending.has(path));

    const spoofedCells: string[] = [];
    for (const routePath of routes) {
      const path = routePath.replace(/:[^/]+/g, "x1");
      __resetAuthCache();
      __setRedisClientForTest(admittingRedis());
      const before = dispatched.length;
      const request = new NextRequest(
        `http://localhost/api/ui-bridge${path}${query}`,
        {
          method: "GET",
          headers: {
            authorization: "Bearer a-good-token",
            origin: "https://qontinui.io",
          },
        }
      );
      await route.GET(request, {
        params: Promise.resolve({ path: path.slice(1).split("/") }),
      });
      if (
        dispatched
          .slice(before)
          .some(
            ({ options }) =>
              ownerOf(options) !== null && ownerOf(options) !== VERIFIED
          )
      ) {
        spoofedCells.push(`GET ${routePath}`);
      }
    }

    expect(spoofedCells).toEqual([]);
    // Not vacuous: the sweep covered the GET routes and reached the relay
    // under the verified owner (19 dispatches on SDK 0.30.0).
    expect(routes.length).toBeGreaterThan(80);
    expect(
      dispatched.filter(({ options }) => ownerOf(options) === VERIFIED).length
    ).toBeGreaterThan(10);
  }, 120_000);
});

describe("the installed SDK's Next handler reads request bodies only with request.json()", () => {
  // `route.ts` refuses, under the gate, a body `request.json()` cannot parse,
  // exempting no route, because the SDK reads no body any other way. This pins
  // that census: a release whose Next adapter reads a body as text, form data
  // or bytes must revisit the exemption list in `route.ts` before it ships.
  it("finds request.json() reads and no other request-body reader", () => {
    const bundle = readFileSync(
      createRequire(import.meta.url).resolve("@qontinui/ui-bridge/server"),
      "utf8"
    );
    const start = bundle.indexOf("// src/server/nextjs.ts");
    expect(
      start,
      "the SDK bundle has no src/server/nextjs.ts section"
    ).toBeGreaterThan(-1);
    const end = bundle.indexOf("\n// src/", start + 1);
    const nextAdapter = bundle.slice(start, end === -1 ? undefined : end);

    expect(
      nextAdapter.match(/\brequest\.json\(\)/g)?.length ?? 0
    ).toBeGreaterThan(0);
    expect(
      nextAdapter.match(
        /\b(?:request|req)\.(?:text|formData|arrayBuffer|blob)\(|\b(?:request|req)\.body\b/g
      ) ?? []
    ).toEqual([]);
  });
});
