/**
 * Strategy WebSocket hook tests (Phase 2.4).
 *
 * Verifies:
 * - Mount → open WS; unmount → close + no further work
 * - Frame envelope parsing (channel + JSON-string payload)
 * - Reconnect-with-backoff on close
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useStrategyWebSocket,
  createChannelDispatcher,
  type StrategyFrame,
} from "./useStrategyWebSocket";

// -----------------------------------------------------------------------
// Mock WebSocket — tracks instances + lets tests drive lifecycle events.
// -----------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  // Drive lifecycle from the test.
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  send() {
    /* not exercised */
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
  // Test helper.
  emit(envelope: { channel: string; payload: string }) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(envelope) }));
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useStrategyWebSocket", () => {
  it("opens on mount and closes on unmount", () => {
    const onMessage = vi.fn();
    const { unmount } = renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage,
        WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      }),
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain(
      "pattern=" + encodeURIComponent("events.strategy.*"),
    );
    expect(ws.closed).toBe(false);

    unmount();
    expect(ws.closed).toBe(true);
  });

  it("parses {channel, payload-as-string} envelopes and forwards parsed payloads", () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage,
        WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      }),
    );
    const ws = MockWebSocket.instances[0];
    act(() => ws.open());

    act(() =>
      ws.emit({
        channel: "events.strategy.presence.aggregate.doc-uuid-1",
        payload: JSON.stringify({
          doc_id: "doc-uuid-1",
          count: 3,
          users: ["a", "b", "c"],
        }),
      }),
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
    const frame = onMessage.mock.calls[0][0] as StrategyFrame;
    expect(frame.channel).toBe(
      "events.strategy.presence.aggregate.doc-uuid-1",
    );
    expect(frame.payload).toEqual({
      doc_id: "doc-uuid-1",
      count: 3,
      users: ["a", "b", "c"],
    });
  });

  it("reconnects with exponential backoff after a close", () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage,
        WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      }),
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    // Close the first socket — schedule first reconnect (500ms).
    act(() => MockWebSocket.instances[0].close());
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    // Close the second socket — backoff doubles to 1000ms.
    act(() => MockWebSocket.instances[1].close());
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("resets backoff after a successful open", () => {
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage: vi.fn(),
        WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      }),
    );
    // First close → 500ms backoff.
    act(() => MockWebSocket.instances[0].close());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Second socket opens successfully then closes — backoff should
    // reset to 500ms (not 1000).
    act(() => MockWebSocket.instances[1].open());
    act(() => MockWebSocket.instances[1].close());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("does not open when enabled=false", () => {
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage: vi.fn(),
        enabled: false,
        WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      }),
    );
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("dispatcher routes frames by channel prefix", () => {
    const presence = vi.fn();
    const posts = vi.fn();
    const dispatch = createChannelDispatcher([
      { prefix: "events.strategy.presence.", handler: presence },
      { prefix: "events.strategy.post.", handler: posts },
    ]);

    dispatch({
      channel: "events.strategy.presence.aggregate.x",
      payload: {},
    });
    dispatch({ channel: "events.strategy.post.created.y", payload: {} });
    dispatch({ channel: "events.fleet.unrelated", payload: {} });

    expect(presence).toHaveBeenCalledTimes(1);
    expect(posts).toHaveBeenCalledTimes(1);
  });
});
