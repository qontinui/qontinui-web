/**
 * The execution-event WebSocket is opened only on the active runner's
 * loopback route; for a relayed runner nothing is opened and the state says
 * the stream is unavailable (UNKNOWN), never an empty "connected" stream.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunnerTarget } from "@/lib/runner/target";

let activeTarget: RunnerTarget;
vi.mock("@/contexts/active-runner-context", () => ({
  useRunnerTarget: () => activeTarget,
}));

import {
  EXECUTION_EVENTS_UNAVAILABLE_MESSAGE,
  useExecutionEvents,
} from "./useExecutionEvents";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static urls: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  constructor(url: string) {
    FakeWebSocket.urls.push(url);
  }
  send() {}
  close() {}
}

describe("useExecutionEvents transport", () => {
  beforeEach(() => {
    FakeWebSocket.urls = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("opens the socket on a local runner's loopback port", async () => {
    activeTarget = {
      kind: "runner",
      runner: { id: "r-local", port: 9877 },
      locality: "local",
    };
    const { result } = renderHook(() => useExecutionEvents());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("connecting")
    );
    expect(FakeWebSocket.urls).toEqual(["ws://127.0.0.1:9877/ws/events"]);
  });

  it("opens nothing for a relayed runner and reports unavailable", async () => {
    activeTarget = {
      kind: "runner",
      runner: { id: "r-remote", port: 9877 },
      locality: "not_local",
    };
    const { result } = renderHook(() => useExecutionEvents());
    await waitFor(() =>
      expect(result.current.connectionState).toBe("unavailable")
    );
    expect(result.current.lastError).toBe(EXECUTION_EVENTS_UNAVAILABLE_MESSAGE);
    expect(FakeWebSocket.urls).toEqual([]);
  });
});
