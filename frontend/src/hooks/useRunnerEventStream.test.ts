/**
 * The runner event stream is a WebSocket and cannot ride the relay (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 2): a
 * socket is opened only for a target whose route is loopback, built from THAT
 * target; a relayed runner gets no socket and an explicit `unavailable` state
 * (UNKNOWN), never a silent empty stream.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runnerEventStreamUrl, useRunnerEventStream } from "./useRunnerEventStream";
import type { RunnerTarget } from "@/lib/runner/target";

const originalLocation = window.location;
const sockets: string[] = [];

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(url: string) {
    sockets.push(url);
  }
  send() {}
  close() {}
}

function runnerTarget(locality: "local" | "not_local" | "unknown"): RunnerTarget {
  return {
    kind: "runner",
    runner: { id: "r1", port: 9877, name: "box" },
    locality,
  };
}

beforeEach(() => {
  sockets.length = 0;
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin: "http://localhost:3001" },
    writable: true,
  });
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
  vi.unstubAllGlobals();
});

describe("runner event stream transport", () => {
  it("a proven-local target opens its OWN port's socket", () => {
    const { result, unmount } = renderHook(() =>
      useRunnerEventStream(runnerTarget("local"))
    );
    expect(sockets).toEqual(["ws://127.0.0.1:9877/ws/events"]);
    expect(result.current.state).toBe("live");
    unmount();
  });

  it("a relayed target (remote or unknown) opens no socket and says the stream is unavailable", () => {
    for (const locality of ["not_local", "unknown"] as const) {
      const { result, unmount } = renderHook(() =>
        useRunnerEventStream(runnerTarget(locality))
      );
      expect(result.current.state).toBe("unavailable");
      unmount();
    }
    expect(sockets).toEqual([]);
  });

  it("a pending or unavailable target opens no socket", () => {
    expect(runnerEventStreamUrl({ kind: "pending" })).toBeNull();
    expect(
      runnerEventStreamUrl({ kind: "unavailable", reason: "list_unavailable" })
    ).toBeNull();
  });

  it("a production origin opens no socket even for a runner once measured local", () => {
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, origin: "https://app.qontinui.io" },
      writable: true,
    });
    const { result, unmount } = renderHook(() =>
      useRunnerEventStream(runnerTarget("local"))
    );
    expect(result.current.state).toBe("unavailable");
    expect(sockets).toEqual([]);
    unmount();
  });

  it("switching to another local runner reconnects to that runner's port", () => {
    let target = runnerTarget("local");
    const { rerender, unmount } = renderHook(() => useRunnerEventStream(target));
    target = {
      kind: "runner",
      runner: { id: "r2", port: 9878 },
      locality: "local",
    };
    rerender();
    expect(sockets).toEqual([
      "ws://127.0.0.1:9877/ws/events",
      "ws://127.0.0.1:9878/ws/events",
    ]);
    unmount();
  });
});
