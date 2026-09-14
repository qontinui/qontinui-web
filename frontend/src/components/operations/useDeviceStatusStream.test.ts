/**
 * `useDeviceStatusStream` — what marks the stream seeded, and what clears a
 * fleet-read failure.
 *
 * The rule under test: only a FLEET read (the REST seed or poll) does either.
 * A pushed WebSocket frame is one device's row. If a frame could set
 * `everSeeded` or clear `error`, a REST route that keeps failing behind a
 * working socket would disappear from the devops strip's tooltip (which would
 * go back to blaming the runners) and from `DeviceStatusTile`'s error badge.
 *
 * Driven through the real hook: `httpClient` is mocked, `WebSocket` is a fake
 * the test opens and pushes frames through, and timers are faked so the
 * re-seed retry is observable without waiting.
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
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
  open() {
    this.onopen?.();
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

function okResponse(devices: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ devices }) };
}

function failResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

/** Let pending fetch/json promise chains and React updates settle. */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Mount the hook, let the mount seed settle, and return the opened socket. */
async function mountAndOpen() {
  const hook = renderHook(() => useDeviceStatusStream());
  await flush();
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("the hook opened no WebSocket");
  await act(async () => {
    ws.open();
  });
  await flush();
  return { hook, ws };
}

describe("useDeviceStatusStream — only a fleet read seeds the stream or clears its failure", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    httpFetch.mockReset();
    getWebSocketToken.mockReset();
    getWebSocketToken.mockResolvedValue("token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("(i) a frame after a failed seed does not mark it seeded or clear the error", async () => {
    httpFetch.mockResolvedValue(failResponse(500));

    const { hook, ws } = await mountAndOpen();
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
    httpFetch
      .mockResolvedValueOnce(okResponse([deviceRow("d-1", "msi")]))
      .mockResolvedValue(failResponse(502));

    const hook = renderHook(() => useDeviceStatusStream());
    await flush();
    expect(hook.result.current.everSeeded).toBe(true);
    expect(hook.result.current.error).toBeNull();

    const ws = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws.open();
    });
    await flush();
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

  it("(iii) retries a failed on-open re-seed, clears the error once it succeeds, then stops", async () => {
    httpFetch
      .mockResolvedValueOnce(okResponse([])) // mount seed
      .mockResolvedValueOnce(failResponse(503)) // on-open re-seed
      .mockResolvedValue(okResponse([deviceRow("d-1", "msi")])); // retry

    const { hook } = await mountAndOpen();
    expect(hook.result.current.error).toBe("HTTP 503");
    expect(httpFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEVICE_STATUS_POLL_FALLBACK_MS);
    });
    await flush();

    expect(httpFetch).toHaveBeenCalledTimes(3);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.byHostname.get("msi")?.device_id).toBe("d-1");

    // Bounded: once a read succeeds nothing keeps re-reading behind the live
    // socket — no retry left armed, and no polling started beside it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(httpFetch).toHaveBeenCalledTimes(3);
    hook.unmount();
  });

  it("backs the retry off while the route stays down, and cancels it on unmount", async () => {
    httpFetch
      .mockResolvedValueOnce(okResponse([]))
      .mockResolvedValue(failResponse(503));

    const { hook } = await mountAndOpen();
    expect(httpFetch).toHaveBeenCalledTimes(2);

    // First retry at the poll interval…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEVICE_STATUS_POLL_FALLBACK_MS);
    });
    await flush();
    expect(httpFetch).toHaveBeenCalledTimes(3);

    // …the next one waits twice as long, not one poll interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEVICE_STATUS_POLL_FALLBACK_MS);
    });
    await flush();
    expect(httpFetch).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEVICE_STATUS_POLL_FALLBACK_MS);
    });
    await flush();
    expect(httpFetch).toHaveBeenCalledTimes(4);
    expect(hook.result.current.error).toBe("HTTP 503");

    hook.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(httpFetch).toHaveBeenCalledTimes(4);
  });
});
