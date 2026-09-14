/**
 * `useDeviceStatusStream` — what marks the stream seeded, what clears a
 * fleet-read failure, and who owns the retry.
 *
 * Two rules under test:
 *
 * 1. Only a FLEET read (the REST seed or poll) sets `everSeeded` or clears
 *    `error`. A pushed WebSocket frame is one device's row; if it could do
 *    either, a REST route that keeps failing behind a working socket would
 *    vanish from the devops strip's tooltip and `DeviceStatusTile`'s badge.
 * 2. Reads are SEQUENCED and the retry is owned by ONE generation. A response
 *    that lands after a newer read started is discarded; the CURRENT read's
 *    failure arms the retry whichever path it came from, but only while the
 *    socket is the live feed; and no retry timer outlives its chain, its
 *    socket, polling taking over, or unmount.
 *
 * Driven through the real hook: `httpClient.fetch` answers from a queue (a
 * queued promise is a slow response the test resolves later), `WebSocket` is a
 * fake the test opens, closes and pushes frames through, and timers are faked
 * so retry, poll and reconnect timers can be counted with `vi.getTimerCount()`.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const httpFetch = vi.fn();
const getWebSocketToken = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => httpFetch(...args),
    getWebSocketToken: () => getWebSocketToken(),
  },
}));

import { useDeviceStatusStream } from "./useDeviceStatusStream";
import { DEVICE_STATUS_POLL_FALLBACK_MS } from "./utils";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  /** The server (or network) closed the socket. */
  serverClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  push(row: Record<string, unknown>) {
    this.onmessage?.({
      data: JSON.stringify({ kind: "device_status.changed", row }),
    });
  }
}

function deviceRow(deviceId: string, hostname: string) {
  return {
    device_id: deviceId,
    hostname,
    current_task: null,
    current_repo: null,
    current_branch: null,
    free_text: null,
    details: {},
    tenant_id: null,
    updated_at: "2026-09-14T10:00:00Z",
  };
}

type Resp = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function ok(devices: unknown[] = []): Resp {
  return { ok: true, status: 200, json: async () => ({ devices }) };
}

function fail(status = 503): Resp {
  return { ok: false, status, json: async () => ({}) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * The fetch queue: each read takes the next entry. An entry may be a promise —
 * a response that lands only when the test resolves it. An exhausted queue
 * answers `HTTP 599`, so an unexpected extra read shows up as a failure.
 */
let queue: Array<Resp | Promise<Resp>> = [];
let calls = 0;

/** Let pending fetch/json promise chains and React updates settle. */
async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

/** Mount the hook and let the mount seed settle. */
async function mount() {
  const hook = renderHook(() => useDeviceStatusStream());
  await flush();
  return hook;
}

/** Open the newest socket the hook created and let its on-open read settle. */
async function openLatestSocket() {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("the hook opened no WebSocket");
  await act(async () => {
    ws.open();
  });
  await flush();
  return ws;
}

describe("useDeviceStatusStream", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    queue = [];
    calls = 0;
    httpFetch.mockReset();
    httpFetch.mockImplementation(async () => {
      calls += 1;
      const next = queue.shift();
      return next === undefined ? fail(599) : await next;
    });
    getWebSocketToken.mockReset();
    getWebSocketToken.mockResolvedValue("token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("only a fleet read seeds the stream or clears its failure", () => {
    it("(i) a frame after a failed seed does not mark it seeded or clear the error", async () => {
      queue = [fail(500), fail(500)];
      const hook = await mount();
      const ws = await openLatestSocket();
      expect(hook.result.current.everSeeded).toBe(false);
      expect(hook.result.current.error).toBe("HTTP 500");

      await act(async () => {
        ws.push(deviceRow("d-1", "msi"));
      });
      await flush();

      // The frame's row is applied…
      expect(hook.result.current.byHostname.get("msi")?.device_id).toBe("d-1");
      // …but one device's row is not a read of the fleet.
      expect(hook.result.current.everSeeded).toBe(false);
      expect(hook.result.current.error).toBe("HTTP 500");
      hook.unmount();
    });

    it("(ii) a failed re-seed after a good one keeps everSeeded and reports the error, through frames", async () => {
      queue = [ok([deviceRow("d-1", "msi")]), fail(502)];
      const hook = await mount();
      expect(hook.result.current.everSeeded).toBe(true);
      expect(hook.result.current.error).toBeNull();

      const ws = await openLatestSocket();
      expect(hook.result.current.everSeeded).toBe(true);
      expect(hook.result.current.error).toBe("HTTP 502");

      await act(async () => {
        ws.push(deviceRow("d-2", "spaceship"));
      });
      await flush();
      expect(hook.result.current.error).toBe("HTTP 502");
      expect(hook.result.current.everSeeded).toBe(true);
      hook.unmount();
    });
  });

  describe("the seed retry", () => {
    it("(iii) retries a failed on-open re-seed, clears the error once it succeeds, then stops", async () => {
      queue = [ok(), fail(503), ok([deviceRow("d-1", "msi")])];
      const hook = await mount();
      await openLatestSocket();
      expect(hook.result.current.error).toBe("HTTP 503");
      expect(calls).toBe(2);
      expect(vi.getTimerCount()).toBe(1);

      await advance(DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(calls).toBe(3);
      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.byHostname.get("msi")?.device_id).toBe("d-1");

      // Once a read succeeds nothing keeps re-reading behind the live socket.
      expect(vi.getTimerCount()).toBe(0);
      await advance(5 * 60_000);
      expect(calls).toBe(3);
      hook.unmount();
    });

    it("backs the retry off while the route stays down, and cancels it on unmount", async () => {
      queue = [ok(), fail(503), fail(503), fail(503)];
      const hook = await mount();
      await openLatestSocket();
      expect(calls).toBe(2);

      // First retry at the poll interval…
      await advance(DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(calls).toBe(3);
      // …the next one waits twice as long.
      await advance(DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(calls).toBe(3);
      await advance(DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(calls).toBe(4);
      expect(hook.result.current.error).toBe("HTTP 503");
      expect(vi.getTimerCount()).toBe(1);

      hook.unmount();
      expect(vi.getTimerCount()).toBe(0);
      await advance(10 * 60_000);
      expect(calls).toBe(4);
    });

    it("(A) a failed Refresh behind a live socket arms the retry, which clears the error", async () => {
      queue = [ok(), ok(), fail(500), ok()];
      const hook = await mount();
      await openLatestSocket();
      expect(hook.result.current.error).toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      await act(async () => {
        await hook.result.current.refetch();
      });
      await flush();
      expect(hook.result.current.error).toBe("HTTP 500");
      // The trigger is the failure, not the path it came from.
      expect(vi.getTimerCount()).toBe(1);

      await advance(DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(calls).toBe(4);
      expect(hook.result.current.error).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      hook.unmount();
    });

    it("(B) a slow failing mount seed that lands after a successful on-open seed is discarded", async () => {
      const slowMount = deferred<Resp>();
      queue = [slowMount.promise, ok([deviceRow("d-1", "msi")])];
      const hook = await mount();
      await openLatestSocket();
      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.everSeeded).toBe(true);

      await act(async () => {
        slowMount.resolve(fail(504));
      });
      await flush();

      // The older read was overtaken: it sets no error and arms no retry.
      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.everSeeded).toBe(true);
      expect(hook.result.current.byHostname.get("msi")?.device_id).toBe("d-1");
      expect(vi.getTimerCount()).toBe(0);
      const before = calls;
      await advance(10 * 60_000);
      expect(calls).toBe(before);
      hook.unmount();
    });

    it("(C) a stale in-flight retry failing after a reconnect leaves one retry timer, and none survives close or unmount", async () => {
      const staleRetry = deferred<Resp>();
      // mount ok · ws1 on-open fails · its retry's read hangs
      queue = [ok(), fail(503), staleRetry.promise];
      const hook = await mount();
      const ws1 = await openLatestSocket();
      await advance(DEVICE_STATUS_POLL_FALLBACK_MS); // retry fires; read pending
      expect(calls).toBe(3);
      expect(vi.getTimerCount()).toBe(0);

      // ws1 drops: polling + a 1s reconnect take over.
      await act(async () => {
        ws1.serverClose();
      });
      await flush();
      expect(vi.getTimerCount()).toBe(2);

      await advance(1_000); // reconnect → ws2
      const ws2 = FakeWebSocket.instances.at(-1)!;
      expect(ws2).not.toBe(ws1);

      queue = [fail(503)]; // ws2's on-open read fails fast
      await openLatestSocket();
      expect(hook.result.current.error).toBe("HTTP 503");
      // Polling stopped on open; exactly the one retry is armed.
      expect(vi.getTimerCount()).toBe(1);

      // The retry read from ws1's chain finally fails — it was overtaken.
      await act(async () => {
        staleRetry.resolve(fail(503));
      });
      await flush();
      expect(vi.getTimerCount()).toBe(1);

      // ws2 drops: its retry goes with it; only poll + reconnect remain.
      await act(async () => {
        ws2.serverClose();
      });
      await flush();
      expect(vi.getTimerCount()).toBe(2);

      hook.unmount();
      await flush();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("(D) an on-open read that resolves after unmount arms nothing", async () => {
      const lateOpenRead = deferred<Resp>();
      queue = [ok(), lateOpenRead.promise];
      const hook = await mount();
      await openLatestSocket();
      hook.unmount();
      await flush();
      expect(vi.getTimerCount()).toBe(0);

      await act(async () => {
        lateOpenRead.resolve(fail(503));
      });
      await flush();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("never runs beside polling: a socket closing with a retry pending leaves only poll and reconnect", async () => {
      queue = [ok(), fail(503)];
      const hook = await mount();
      const ws = await openLatestSocket();
      expect(vi.getTimerCount()).toBe(1); // the retry

      await act(async () => {
        ws.serverClose();
      });
      await flush();
      // The retry is gone; the poll interval and the reconnect timeout remain.
      expect(vi.getTimerCount()).toBe(2);

      // Past the retry's due time: the reconnect fires (its socket stays
      // unopened) and the poll ticks once. That poll read fails, and with
      // polling running it arms no retry — so one read, one timer (the poll).
      const before = calls;
      await advance(DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(calls - before).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
      hook.unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
