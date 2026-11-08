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
import { startRelayClient } from "@qontinui/ui-bridge/injected";

import { __resetAuthCache } from "./_auth";
import { __setRedisClientForTest, laneFor } from "./_rate-limit";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEATS_PER_TAB_PER_MIN,
  RELAY_COMMAND_STREAM_HEARTBEAT_MS,
  RELAY_RESULTS_PER_TAB_PER_MIN,
  RELAY_SNAPSHOTS_PER_STREAM_OPEN,
  SSE_RECONNECT_DELAY_MS,
  STREAM_OPENS_PER_TAB_PER_MIN,
} from "./_transport";

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
    // under the verified owner (a floor, not a count: the dispatch total
    // moves with the installed SDK's route table).
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

/* -------------------------------------------------------------------- */
/* The SDK's own transport: what one tab really sends                   */
/* -------------------------------------------------------------------- */

/**
 * `_rate-limit.ts` sizes the three transport sub-lanes from the SDK cadences
 * `_transport.ts` restates (the SDK keeps them module-private). These tests
 * hold that restatement to the SDK `node_modules` resolves, two ways:
 *
 *   1. the constants themselves, read out of the installed bundles (sliced
 *      by source file, as the request.json() census above slices the Next
 *      adapter);
 *   2. the behaviour: the installed `startRelayClient`
 *      (`@qontinui/ui-bridge/injected`) is driven under fake timers for three
 *      minutes against a stub relay that answers the way the SDK server does:
 *      a `ping` every RELAY_COMMAND_STREAM_HEARTBEAT_MS, the proactive
 *      snapshot and its one retry after every connect, and `tabRegistered`
 *      from whether it holds an open stream for the tab (the relay answers
 *      from the instance's open listeners, `connectedTabs`). Every request
 *      the client sends must be one of the three transport routes, billed to
 *      its own sub-lane, and within that route's per-tab cadence in EVERY
 *      60-s window — for a visible tab on a healthy stream, a hidden tab
 *      whose stream is refused, and a tab whose heartbeat is once answered
 *      `tabRegistered: false`. The one exception is measured, not assumed:
 *      when a stream starts being refused, the first heartbeat's
 *      `tabRegistered: false` forces one immediate reopen
 *      (`relay-client.ts` `forceReconnect`), which the envelope deliberately
 *      leaves out (`_transport.ts` `STREAM_OPENS_PER_TAB_PER_MIN`).
 */

/** The `// <sourceFile>` section of an installed SDK bundle. */
function bundleSection(specifier: string, sourceFile: string): string {
  const bundle = readFileSync(
    createRequire(import.meta.url).resolve(specifier),
    "utf8"
  );
  const start = bundle.indexOf(`// ${sourceFile}`);
  expect(start, `${specifier} has no ${sourceFile} section`).toBeGreaterThan(
    -1
  );
  const end = bundle.indexOf("\n// src/", start + 1);
  return bundle.slice(start, end === -1 ? undefined : end);
}

/** The number a bundle section assigns to `name` (the bundler prints 10_000 as 1e4). */
function bundledNumber(section: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\d* = ([0-9][0-9_.e]*);`).exec(section);
  const literal = match?.[1];
  return literal === undefined ? null : Number(literal.replace(/_/g, ""));
}

describe("the installed SDK's transport cadences are the ones _transport.ts restates", () => {
  it("relay client: HEARTBEAT_INTERVAL_MS and SSE_RECONNECT_DELAY_MS", () => {
    const client = bundleSection(
      "@qontinui/ui-bridge/injected",
      "src/relay/relay-client.ts"
    );
    expect(bundledNumber(client, "HEARTBEAT_INTERVAL_MS")).toBe(
      HEARTBEAT_INTERVAL_MS
    );
    expect(bundledNumber(client, "SSE_RECONNECT_DELAY_MS")).toBe(
      SSE_RECONNECT_DELAY_MS
    );
  });

  it("Next adapter: RELAY_COMMAND_STREAM_HEARTBEAT_MS", () => {
    const adapter = bundleSection(
      "@qontinui/ui-bridge/server",
      "src/server/nextjs.ts"
    );
    expect(bundledNumber(adapter, "RELAY_COMMAND_STREAM_HEARTBEAT_MS")).toBe(
      RELAY_COMMAND_STREAM_HEARTBEAT_MS
    );
  });

  it("command relay: the proactive snapshot is on by default and captures at most twice per connect", () => {
    const relaySource = bundleSection(
      "@qontinui/ui-bridge/server",
      "src/server/command-relay.ts"
    );
    expect(relaySource).toContain("options?.proactiveSnapshot ?? true");
    expect(relaySource.match(/\bcaptureSnapshot\(\)/g)?.length ?? 0).toBe(
      RELAY_SNAPSHOTS_PER_STREAM_OPEN
    );
  });
});

describe("the installed SDK's relay client sends only transport, within its cadence", () => {
  const BASE = "https://qontinui.io/api/ui-bridge";
  const BASE_PATH = "/api/ui-bridge";
  const RUN_MS = 3 * 60_000;
  const MINUTE_MS = 60_000;
  /** The fake clock's start: every run begins here. */
  const T0 = Date.UTC(2026, 0, 1);
  /** The only routes a relay client may send, and the sub-lane each bills. */
  const LANE_OF: Readonly<Record<string, string>> = {
    "GET /commands/stream": "transport:stream",
    "POST /heartbeat": "transport:heartbeat",
    "POST /commands": "transport:result",
  };

  interface Sent {
    route: string;
    at: number;
  }

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Overrides the relay's answer to one heartbeat. `holdsStream` is the
   * relay's own answer: whether it holds an open stream for the tab.
   */
  type TabRegisteredAnswer = (beat: number, holdsStream: boolean) => boolean;

  /** A stub relay answering the SDK client the way the SDK server does. */
  function stubRelay(opts: {
    streamOk: boolean;
    tabRegistered?: TabRegisteredAnswer;
  }) {
    const sent: Sent[] = [];
    const encoder = new TextEncoder();
    let beats = 0;
    let opens = 0;
    /** Streams the relay currently holds open (its `connectedTabs`). */
    let openStreams = 0;

    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    function commandStream(
      streamId: string,
      signal: AbortSignal | null | undefined
    ): Response {
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          openStreams += 1;
          const push = (frame: unknown) => {
            if (!closed) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
              );
            }
          };
          const snapshot = (attempt: string) =>
            push({
              commandId: `${streamId}-${attempt}`,
              action: "getControlSnapshot",
              payload: {},
            });
          // The relay's proactive snapshot 500 ms after connect, and its one
          // retry 1.5 s after a failed capture (`command-relay.ts`).
          const timers = [
            setTimeout(() => snapshot("snapshot"), 500),
            setTimeout(() => snapshot("snapshot-retry"), 2000),
          ];
          const ping = setInterval(
            () => push({ type: "ping" }),
            RELAY_COMMAND_STREAM_HEARTBEAT_MS
          );
          signal?.addEventListener("abort", () => {
            if (closed) {
              return;
            }
            closed = true;
            openStreams -= 1;
            timers.forEach((timer) => clearTimeout(timer));
            clearInterval(ping);
            try {
              controller.close();
            } catch {
              // already closed by the reader
            }
          });
          push({ type: "connected", streamId });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    const fetchStub = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const route = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname.slice(BASE_PATH.length)}`;
        sent.push({ route, at: Date.now() });
        if (route === "GET /commands/stream") {
          opens += 1;
          return opts.streamOk
            ? commandStream(`stream-${opens}`, init?.signal)
            : new Response("relay unavailable", { status: 503 });
        }
        if (route === "POST /heartbeat") {
          beats += 1;
          const holdsStream = openStreams > 0;
          return json({
            success: true,
            tabRegistered: opts.tabRegistered
              ? opts.tabRegistered(beats, holdsStream)
              : holdsStream,
          });
        }
        return json({ success: true });
      }
    );
    return { fetchStub, sent };
  }

  /** Run one tab's relay client for RUN_MS of fake time; return what it sent. */
  async function runTab(opts: {
    visibility: "visible" | "hidden";
    streamOk: boolean;
    tabRegistered?: TabRegisteredAnswer;
  }): Promise<Sent[]> {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => opts.visibility,
    });
    const { fetchStub, sent } = stubRelay(opts);
    vi.stubGlobal("fetch", fetchStub);

    const client = startRelayClient({
      basePath: BASE,
      tabId: "census-tab",
      execute: async () => ({ success: true }),
      authHeader: () => "census-bearer",
      registrationMetadata: () => ({
        userId: "census-user",
        sessionId: "census-session",
      }),
      onError: () => undefined,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(RUN_MS);
    client.stop();
    await vi.advanceTimersByTimeAsync(0);
    return sent;
  }

  const count = (sent: readonly Sent[], route: string) =>
    sent.filter((s) => s.route === route).length;

  /**
   * The most requests to `route` in any 60-s window [t, t + 60 s) of the run
   * that starts at or after `from`.
   */
  function peakPerMinute(
    sent: readonly Sent[],
    route: string,
    from = T0
  ): number {
    const times = sent.filter((s) => s.route === route).map((s) => s.at);
    let peak = 0;
    for (const start of times.filter((t) => t >= from)) {
      const inWindow = times.filter(
        (t) => t >= start && t < start + MINUTE_MS
      ).length;
      peak = Math.max(peak, inWindow);
    }
    return peak;
  }

  /**
   * `forcedReopens`: immediate reopens the envelope deliberately leaves out
   * (`_transport.ts` `STREAM_OPENS_PER_TAB_PER_MIN`), allowed in the run's
   * first minute only; every window after it must hold the cadence exactly.
   */
  function expectTransportWithinCadence(
    sent: readonly Sent[],
    { forcedReopens = 0 }: { forcedReopens?: number } = {}
  ): void {
    for (const route of new Set(sent.map((s) => s.route))) {
      const [method = "", path = ""] = route.split(" ");
      expect(laneFor(path, method), route).toBe(LANE_OF[route]);
    }
    expect(peakPerMinute(sent, "GET /commands/stream")).toBeLessThanOrEqual(
      STREAM_OPENS_PER_TAB_PER_MIN + forcedReopens
    );
    expect(
      peakPerMinute(sent, "GET /commands/stream", T0 + MINUTE_MS)
    ).toBeLessThanOrEqual(STREAM_OPENS_PER_TAB_PER_MIN);
    expect(peakPerMinute(sent, "POST /heartbeat")).toBeLessThanOrEqual(
      HEARTBEATS_PER_TAB_PER_MIN
    );
    expect(peakPerMinute(sent, "POST /commands")).toBeLessThanOrEqual(
      RELAY_RESULTS_PER_TAB_PER_MIN
    );
  }

  it("a visible tab on a healthy stream: one open, its two snapshot results, heartbeats within cadence", async () => {
    const sent = await runTab({ visibility: "visible", streamOk: true });
    expectTransportWithinCadence(sent);
    expect(count(sent, "GET /commands/stream")).toBe(1);
    expect(count(sent, "POST /commands")).toBe(2);
    // Not vacuous: the timer beat all through the run.
    expect(peakPerMinute(sent, "POST /heartbeat")).toBeGreaterThanOrEqual(6);
  });

  it("a hidden tab whose stream is refused: one forced reopen as the refusals start, then the reconnect cadence and no faster", async () => {
    // The relay holds no stream for the tab, so it answers every heartbeat
    // `tabRegistered: false`, and the boot heartbeat's answer reopens the
    // stream at once beside the boot open. The reopen clears the pending
    // reconnect, so from then on the client opens once per heartbeat.
    const sent = await runTab({ visibility: "hidden", streamOk: false });
    expectTransportWithinCadence(sent, { forcedReopens: 1 });
    // Read exactly, so both bounds are met rather than merely respected:
    // 6 + the one forced reopen in the first minute, 6 in every later window.
    expect(peakPerMinute(sent, "GET /commands/stream")).toBe(7);
    expect(peakPerMinute(sent, "GET /commands/stream", T0 + MINUTE_MS)).toBe(6);
    expect(count(sent, "POST /commands")).toBe(0);
    expect(peakPerMinute(sent, "POST /heartbeat")).toBeGreaterThanOrEqual(6);
  });

  it("a tab once answered tabRegistered:false: one forced reopen and its snapshots, all within cadence", async () => {
    const sent = await runTab({
      visibility: "visible",
      streamOk: true,
      // The per-instance recovery path: one heartbeat lands on an instance
      // that holds no stream for the tab.
      tabRegistered: (beat, holdsStream) => (beat === 2 ? false : holdsStream),
    });
    expectTransportWithinCadence(sent);
    expect(count(sent, "GET /commands/stream")).toBe(2);
    expect(count(sent, "POST /commands")).toBe(4);
  });

  it("bills every UI_BRIDGE_ROUTES entry to a command lane except POST /heartbeat", () => {
    const lanes = UI_BRIDGE_ROUTES.map((r) => ({
      route: `${r.method} ${r.path}`,
      lane: laneFor(r.path.replace(/:[^/]+/g, "x1"), r.method),
    }));
    expect(lanes.filter(({ lane }) => lane.startsWith("transport:"))).toEqual([
      { route: "POST /heartbeat", lane: "transport:heartbeat" },
    ]);
    expect(
      lanes.filter(
        ({ route, lane }) =>
          route !== "POST /heartbeat" && lane !== "read" && lane !== "write"
      )
    ).toEqual([]);
    // Not vacuous: the installed table is the SDK's whole route contract.
    expect(UI_BRIDGE_ROUTES.length).toBeGreaterThan(80);
  });
});
