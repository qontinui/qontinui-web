/**
 * `useDeviceStatusStream` — what marks the stream seeded, what clears a
 * fleet-read failure, how reads are ordered, who owns the retry, and who owns
 * the socket.
 *
 * Rules under test:
 *
 * 1. Only a FLEET read (the REST seed or poll) sets `everSeeded` or clears
 *    `error`. A pushed WebSocket frame is one device's row; if it could do
 *    either, a REST route that keeps failing behind a working socket would
 *    vanish from the devops strip's tooltip and `DeviceStatusTile`'s badge.
 * 2. Reads are ordered by LANDING. A response is discarded only when a newer
 *    read already landed (or the hook unmounted) — so a route slower than the
 *    poll interval still lands every read, while a stale read that loses the
 *    race cannot overwrite a newer result. Polling starts no read while one is
 *    in flight.
 * 3. The retry is owned by ONE generation: an applied failure arms it whichever
 *    path it came from, only while the socket is the live feed, and no retry
 *    timer outlives its chain, its socket, polling taking over, or unmount.
 * 4. The hook owns ONE socket. A connect attempt overtaken while awaiting its
 *    token creates nothing, and a socket the hook no longer owns cannot reach
 *    state — under StrictMode's double-invoked effects and after a reconnect.
 *
 * Driven through the real hook: `httpClient.fetch` answers from a queue (a
 * queued promise or thunk is a slow response), `WebSocket` is a fake the test
 * opens, closes and pushes frames through, and timers are faked so retry, poll
 * and reconnect timers can be counted with `vi.getTimerCount()`.
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
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  /** Set when the HOOK closed this socket (as opposed to the server). */
  closedByClient = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closedByClient = true;
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

/** A response that lands `ms` later (on the faked clock). */
function after(ms: number, resp: () => Resp): () => Promise<Resp> {
  return () => new Promise<Resp>((r) => setTimeout(() => r(resp()), ms));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * The fetch queue: each read takes the next entry. An entry may be a promise or
 * a thunk — a response that lands later. An exhausted queue answers from
 * `fallback`, which defaults to `HTTP 599` so an unexpected read shows up.
 */
let queue: Array<Resp | Promise<Resp> | (() => Promise<Resp>)> = [];
let fallback: () => Resp | Promise<Resp> = () => fail(599);
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
async function mount(options?: { reactStrictMode?: boolean }) {
  const hook = renderHook(() => useDeviceStatusStream(), options);
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

/** Sockets the hook created and has not closed. */
function unclosedSockets() {
  return FakeWebSocket.instances.filter((s) => !s.closedByClient);
}

describe("useDeviceStatusStream", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    queue = [];
    fallback = () => fail(599);
    calls = 0;
    httpFetch.mockReset();
    httpFetch.mockImplementation(async () => {
      calls += 1;
      const next = queue.shift();
      if (next === undefined) return await fallback();
      if (typeof next === "function") return await next();
      return await next;
    });
    getWebSocketToken.mockReset();
    getWebSocketToken.mockResolvedValue("token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "hidden");
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

  describe("reads are ordered by landing", () => {
    it("(F) a poll route slower than the interval still lands its rows", async () => {
      getWebSocketToken.mockResolvedValue(null); // polling mode
      fallback = after(6_000, () => ok([deviceRow("d-1", "msi")]));
      const hook = await mount();

      await advance(60_000);
      expect(hook.result.current.seeded).toBe(true);
      expect(hook.result.current.everSeeded).toBe(true);
      expect(hook.result.current.byHostname.get("msi")?.device_id).toBe("d-1");
      expect(hook.result.current.error).toBeNull();
      // One read in flight at a time from polling: a 6s read spans a 5s tick,
      // so ticks are skipped rather than stacking reads (13 without the skip).
      expect(calls).toBeLessThanOrEqual(7);
      hook.unmount();
    });

    it("(F2) a poll route that fails slower than the interval still reports its error", async () => {
      getWebSocketToken.mockResolvedValue(null);
      fallback = after(6_000, () => fail(503));
      const hook = await mount();

      await advance(60_000);
      expect(hook.result.current.seeded).toBe(true);
      expect(hook.result.current.everSeeded).toBe(false);
      expect(hook.result.current.error).toBe("HTTP 503");
      hook.unmount();
    });

    it("(G1) a slow poll overtaken by a failing Refresh is discarded, and the next poll recovers", async () => {
      getWebSocketToken.mockResolvedValue(null);
      const slowPoll = deferred<Resp>();
      queue = [
        ok(),
        slowPoll.promise,
        fail(500),
        ok([deviceRow("d-9", "late")]),
      ];
      const hook = await mount();

      await advance(DEVICE_STATUS_POLL_FALLBACK_MS); // poll starts, pending
      await act(async () => {
        await hook.result.current.refetch();
      });
      await flush();
      await act(async () => {
        slowPoll.resolve(ok([deviceRow("d-2", "poll")]));
      });
      await flush();
      expect(hook.result.current.error).toBe("HTTP 500");
      expect(hook.result.current.byHostname.has("poll")).toBe(false);

      await advance(DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.byHostname.has("late")).toBe(true);
      hook.unmount();
    });

    it("(G2) a slow retry overtaken by a failing Refresh is discarded, and the re-armed retry recovers", async () => {
      const slowRetry = deferred<Resp>();
      queue = [
        ok(),
        fail(503),
        slowRetry.promise,
        fail(500),
        ok([deviceRow("d-3", "recovered")]),
      ];
      const hook = await mount();
      await openLatestSocket();
      await advance(DEVICE_STATUS_POLL_FALLBACK_MS); // retry fires, pending

      await act(async () => {
        await hook.result.current.refetch();
      });
      await flush();
      await act(async () => {
        slowRetry.resolve(ok([deviceRow("d-2", "retry")]));
      });
      await flush();
      expect(hook.result.current.error).toBe("HTTP 500");
      expect(vi.getTimerCount()).toBe(1);

      await advance(2 * DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.byHostname.has("recovered")).toBe(true);
      expect(hook.result.current.byHostname.has("retry")).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
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

      // A newer read already landed: the older one sets no error and arms no
      // retry.
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

      // The retry read from ws1's chain finally fails — a newer read landed.
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

    it("is idempotent: a second failure while a retry is pending neither re-arms it nor steps the backoff", async () => {
      // mount ok · on-open fails (arms step 1, 5s) · Refresh fails while it is
      // pending · the 5s retry fails (arms step 2) · the step-2 retry succeeds
      queue = [
        ok(),
        fail(503),
        fail(500),
        fail(502),
        ok([deviceRow("d-1", "msi")]),
      ];
      const hook = await mount();
      await openLatestSocket();
      expect(vi.getTimerCount()).toBe(1);

      await advance(2_000);
      await act(async () => {
        await hook.result.current.refetch();
      });
      await flush();
      expect(hook.result.current.error).toBe("HTTP 500");
      expect(vi.getTimerCount()).toBe(1);

      // Still the first step (5s from the on-open failure) — not re-armed at
      // 10s from the Refresh.
      await advance(DEVICE_STATUS_POLL_FALLBACK_MS - 2_000);
      expect(calls).toBe(4);
      expect(hook.result.current.error).toBe("HTTP 502");
      expect(vi.getTimerCount()).toBe(1);

      // The duplicate failure did not step the backoff either: after two
      // counted failures the next retry is step 2 (10s), NOT step 3 (20s),
      // which is where a failure bumping the attempt count on its way out of
      // the "already pending" early return would put it.
      await advance(2 * DEVICE_STATUS_POLL_FALLBACK_MS - 1_000);
      expect(calls).toBe(4);
      await advance(1_000);
      expect(calls).toBe(5);
      expect(hook.result.current.error).toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      // And nothing is still waiting to fire at the 20s mark.
      await advance(2 * DEVICE_STATUS_POLL_FALLBACK_MS);
      expect(calls).toBe(5);
      hook.unmount();
    });
  });

  describe("a stalled response body", () => {
    it("cannot stop polling: past the body deadline the read fails, and the next poll reads again", async () => {
      getWebSocketToken.mockResolvedValue(null); // polling mode
      const stalledBody: Resp = {
        ok: true,
        status: 200,
        json: () => new Promise<unknown>(() => {}),
      };
      queue = [ok(), stalledBody, ok([deviceRow("d-1", "msi")])];
      const hook = await mount();
      expect(calls).toBe(1);

      // A Refresh at t=2s whose headers arrive but whose body never does. It
      // stays in flight, so every poll tick skips.
      await advance(2_000);
      await act(async () => {
        void hook.result.current.refetch();
      });
      await flush();
      expect(calls).toBe(2);
      await advance(58_000); // t=60s, inside the deadline
      expect(calls).toBe(2);
      expect(hook.result.current.error).toBeNull();

      await advance(3_000); // t=63s, past the 60s body deadline
      expect(hook.result.current.error).toBe(
        "device-status response body timed out"
      );
      expect(calls).toBe(2);

      await advance(DEVICE_STATUS_POLL_FALLBACK_MS); // the next tick reads again
      expect(calls).toBe(3);
      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.byHostname.get("msi")?.device_id).toBe("d-1");
      hook.unmount();
      expect(vi.getTimerCount()).toBe(0);
    });

    /** The signal the hook handed `httpClient.fetch` on its `n`th read (1-based). */
    function signalOfRead(n: number): AbortSignal | undefined {
      const options = httpFetch.mock.calls[n - 1]?.[1] as
        | { signal?: AbortSignal }
        | undefined;
      return options?.signal;
    }

    it("aborts the underlying request when the body misses its deadline, not merely abandons it", async () => {
      getWebSocketToken.mockResolvedValue(null); // polling mode
      const stalledBody: Resp = {
        ok: true,
        status: 200,
        json: () => new Promise<unknown>(() => {}),
      };
      queue = [ok(), stalledBody];
      const hook = await mount();

      await act(async () => {
        void hook.result.current.refetch();
      });
      await flush();
      expect(calls).toBe(2);
      const signal = signalOfRead(2);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);

      await advance(59_000); // inside the 60s body deadline
      expect(signal?.aborted).toBe(false);

      await advance(2_000); // past it
      expect(hook.result.current.error).toBe(
        "device-status response body timed out"
      );
      expect(signal?.aborted).toBe(true);
      // A read that completed on time is never aborted.
      expect(signalOfRead(1)?.aborted).toBe(false);
      hook.unmount();
    });

    it("on unmount, clears a pending body deadline and aborts the request", async () => {
      getWebSocketToken.mockResolvedValue(null); // polling mode
      const stalledBody: Resp = {
        ok: true,
        status: 200,
        json: () => new Promise<unknown>(() => {}),
      };
      queue = [stalledBody];
      const hook = await mount();
      expect(calls).toBe(1);
      const signal = signalOfRead(1);
      expect(signal?.aborted).toBe(false);
      // The body deadline plus the poll interval.
      expect(vi.getTimerCount()).toBe(2);

      hook.unmount();
      expect(vi.getTimerCount()).toBe(0);
      expect(signal?.aborted).toBe(true);
    });

    it("on unmount, aborts a request still waiting for its headers", async () => {
      getWebSocketToken.mockResolvedValue(null); // polling mode
      const headers = deferred<Resp>();
      queue = [headers.promise];
      const hook = await mount();
      const signal = signalOfRead(1);
      expect(signal?.aborted).toBe(false);

      hook.unmount();
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("the hook owns exactly one socket", () => {
    it("under StrictMode's mount → unmount → mount, exactly one socket is ever built, and none is open after unmount", async () => {
      fallback = () => ok();
      const hook = await mount({ reactStrictMode: true });

      // The first effect pass's connect was overtaken while awaiting its token,
      // so no orphan socket was ever built.
      expect(FakeWebSocket.instances).toHaveLength(1);
      const live = await openLatestSocket();
      expect(hook.result.current.connected).toBe(true);
      expect(live.closedByClient).toBe(false);

      hook.unmount();
      await flush();
      expect(
        FakeWebSocket.instances.filter(
          (s) => s.readyState === FakeWebSocket.OPEN && !s.closedByClient
        )
      ).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a frame from a socket that was replaced after a reconnect is not applied", async () => {
      fallback = () => ok();
      const hook = await mount();
      const ws1 = await openLatestSocket();
      await act(async () => {
        ws1.serverClose();
      });
      await flush();
      await advance(1_000); // reconnect → ws2
      const ws2 = await openLatestSocket();
      expect(ws2).not.toBe(ws1);

      await act(async () => {
        ws1.push(deviceRow("stale", "stale-host"));
        ws2.push(deviceRow("d-1", "msi"));
      });
      await flush();
      expect(hook.result.current.byHostname.has("stale-host")).toBe(false);
      expect(hook.result.current.byHostname.get("msi")?.device_id).toBe("d-1");
      hook.unmount();
    });

    it("a late close from a replaced socket starts no polling, keeps the live retry, and never closes the live socket", async () => {
      // mount ok · ws1 on-open ok · ws2 on-open fails → retry armed on ws2
      queue = [ok(), ok(), fail(503)];
      const hook = await mount();
      const ws1 = await openLatestSocket();
      await act(async () => {
        ws1.serverClose();
      });
      await flush();
      await advance(1_000); // reconnect → ws2
      const ws2 = await openLatestSocket();
      expect(hook.result.current.connected).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      await act(async () => {
        ws1.serverClose(); // a duplicate close event from the old socket
      });
      await flush();
      expect(hook.result.current.connected).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      const sockets = FakeWebSocket.instances.length;
      await advance(1_200); // past any reconnect it might have scheduled
      expect(FakeWebSocket.instances).toHaveLength(sockets);
      expect(ws2.closedByClient).toBe(false);
      hook.unmount();
      expect(ws2.closedByClient).toBe(true);
    });

    it("a hide and show while the token fetch is pending leaves exactly one working socket, and none after unmount", async () => {
      fallback = () => ok();
      const tokens: Array<(value: string) => void> = [];
      getWebSocketToken.mockImplementation(
        () => new Promise<string>((resolve) => tokens.push(resolve))
      );
      let hidden = false;
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => hidden,
      });

      const hook = await mount();
      hidden = true;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      hidden = false;
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await flush();

      for (const resolve of tokens) {
        await act(async () => {
          resolve("token");
        });
      }
      await flush();
      expect(tokens.length).toBeGreaterThanOrEqual(2);
      // Exactly one: the show's connect built it, the overtaken one built none.
      expect(FakeWebSocket.instances).toHaveLength(1);
      await openLatestSocket();
      expect(hook.result.current.connected).toBe(true);

      hook.unmount();
      await flush();
      expect(unclosedSockets()).toHaveLength(0);
    });
  });
});
