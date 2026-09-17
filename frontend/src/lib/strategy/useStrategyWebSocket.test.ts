/**
 * Strategy WebSocket hook tests (Phase 2.4, re-homed on the coord-events
 * bridge by plan
 * 2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose).
 *
 * Verifies:
 * - Mount → fetch a session token → open ONE bridge socket for the
 *   `strategy` subscription (never a coord `/ws?pattern=` URL); unmount →
 *   close + no further work
 * - Frame envelope parsing (channel + JSON-string payload)
 * - The caller's `pattern` is a CLIENT-SIDE filter with Redis glob
 *   semantics: a frame on `events.strategy.mention.created.<u1>` reaches
 *   only the `<u1>` subscriber
 * - Reconnect-with-backoff on close, and on a missing token
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useStrategyWebSocket,
  createChannelDispatcher,
  matchesChannelPattern,
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

const WS = MockWebSocket as unknown as typeof WebSocket;
const token = () => Promise.resolve("session-jwt");

/** The socket opens only after the token promise settles — flush it. */
const flush = () => act(async () => {});

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("matchesChannelPattern", () => {
  it("lets * span dots like Redis PSUBSCRIBE", () => {
    expect(
      matchesChannelPattern(
        "events.strategy.*",
        "events.strategy.post.created.thread-1",
      ),
    ).toBe(true);
    expect(
      matchesChannelPattern("events.strategy.*", "events.merge.proposal"),
    ).toBe(false);
  });

  it("matches a per-user pattern only for that user", () => {
    const p = "events.strategy.mention.created.u1";
    expect(matchesChannelPattern(p, "events.strategy.mention.created.u1")).toBe(
      true,
    );
    expect(matchesChannelPattern(p, "events.strategy.mention.created.u2")).toBe(
      false,
    );
    expect(
      matchesChannelPattern(p, "events.strategy.mention.created.u10"),
    ).toBe(false);
  });

  it("treats ? as one character and everything else literally", () => {
    expect(matchesChannelPattern("events.?.x", "events.a.x")).toBe(true);
    expect(matchesChannelPattern("events.?.x", "events.ab.x")).toBe(false);
    // A dot is a literal dot, not a regex wildcard.
    expect(matchesChannelPattern("events.a", "eventsXa")).toBe(false);
  });
});

describe("useStrategyWebSocket", () => {
  it("opens one bridge socket for the strategy subscription and closes on unmount", async () => {
    const onMessage = vi.fn();
    const { unmount } = renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.mention.created.u1",
        onMessage,
        WebSocketImpl: WS,
        getToken: token,
      }),
    );
    await flush();

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    // The backend bridge, with the fixed subscription and the session
    // token — never coord's `/ws?pattern=` and never a coord host.
    expect(ws.url).toContain("/api/v1/operations/coord-events/ws?");
    expect(ws.url).toContain("subscribe=strategy");
    expect(ws.url).toContain("token=session-jwt");
    expect(ws.url).not.toContain("pattern=");
    expect(ws.url).not.toContain("9870");
    expect(ws.closed).toBe(false);

    unmount();
    expect(ws.closed).toBe(true);
  });

  it("does not open a socket when the token fetch resolves after unmount", async () => {
    let resolveToken: (t: string | null) => void = () => {};
    const pending = new Promise<string | null>((r) => {
      resolveToken = r;
    });
    const { unmount } = renderHook(() =>
      useStrategyWebSocket({
        onMessage: vi.fn(),
        WebSocketImpl: WS,
        getToken: () => pending,
      }),
    );
    unmount();
    resolveToken("late-token");
    await flush();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("parses {channel, payload-as-string} envelopes and forwards parsed payloads", async () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage,
        WebSocketImpl: WS,
        getToken: token,
      }),
    );
    await flush();
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

  it("delivers a per-user mention frame only to that user's subscriber", async () => {
    // Two hooks, two patterns, one bridge subscription each. The bridge
    // fans out EVERY events.strategy.* frame to both sockets — the
    // per-user scoping that Redis PSUBSCRIBE used to do is now the
    // hook's client-side filter.
    const u1 = vi.fn();
    const u2 = vi.fn();
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.mention.created.u1",
        onMessage: u1,
        WebSocketImpl: WS,
        getToken: token,
      }),
    );
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.mention.created.u2",
        onMessage: u2,
        WebSocketImpl: WS,
        getToken: token,
      }),
    );
    await flush();
    expect(MockWebSocket.instances).toHaveLength(2);
    for (const ws of MockWebSocket.instances) {
      expect(ws.url).toContain("subscribe=strategy");
    }

    const frame = {
      channel: "events.strategy.mention.created.u1",
      payload: JSON.stringify({ mention_id: "m-1", mentioned_user_id: "u1" }),
    };
    act(() => {
      for (const ws of MockWebSocket.instances) ws.emit(frame);
    });

    expect(u1).toHaveBeenCalledTimes(1);
    expect((u1.mock.calls[0][0] as StrategyFrame).channel).toBe(frame.channel);
    expect(u2).not.toHaveBeenCalled();
  });

  it("re-filters the same socket when the pattern changes", async () => {
    const onMessage = vi.fn();
    const { rerender } = renderHook(
      ({ pattern }: { pattern: string }) =>
        useStrategyWebSocket({
          pattern,
          onMessage,
          WebSocketImpl: WS,
          getToken: token,
        }),
      { initialProps: { pattern: "events.strategy.presence.aggregate.doc-A" } },
    );
    await flush();
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];

    rerender({ pattern: "events.strategy.presence.aggregate.doc-B" });
    await flush();
    // Same subscription → same socket; no reconnect for a filter change.
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ws.closed).toBe(false);

    act(() =>
      ws.emit({
        channel: "events.strategy.presence.aggregate.doc-A",
        payload: "{}",
      }),
    );
    act(() =>
      ws.emit({
        channel: "events.strategy.presence.aggregate.doc-B",
        payload: "{}",
      }),
    );
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect((onMessage.mock.calls[0][0] as StrategyFrame).channel).toBe(
      "events.strategy.presence.aggregate.doc-B",
    );
  });

  it("reconnects with exponential backoff after a close", async () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage,
        WebSocketImpl: WS,
        getToken: token,
      }),
    );
    await flush();

    expect(MockWebSocket.instances).toHaveLength(1);
    // Close the first socket — schedule first reconnect (500ms).
    act(() => MockWebSocket.instances[0].close());
    act(() => {
      vi.advanceTimersByTime(499);
    });
    await flush();
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    await flush();
    expect(MockWebSocket.instances).toHaveLength(2);

    // Close the second socket — backoff doubles to 1000ms.
    act(() => MockWebSocket.instances[1].close());
    act(() => {
      vi.advanceTimersByTime(999);
    });
    await flush();
    expect(MockWebSocket.instances).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    await flush();
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("resets backoff after a successful open", async () => {
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage: vi.fn(),
        WebSocketImpl: WS,
        getToken: token,
      }),
    );
    await flush();
    // First close → 500ms backoff.
    act(() => MockWebSocket.instances[0].close());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();
    // Second socket opens successfully then closes — backoff should
    // reset to 500ms (not 1000).
    act(() => MockWebSocket.instances[1].open());
    act(() => MockWebSocket.instances[1].close());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("retries on the backoff ladder while no session token is available", async () => {
    const getToken = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue("session-jwt");
    renderHook(() =>
      useStrategyWebSocket({
        onMessage: vi.fn(),
        WebSocketImpl: WS,
        getToken,
      }),
    );
    await flush();
    // No token → no socket, and no request to the bridge without one.
    expect(MockWebSocket.instances).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await flush();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not open when enabled=false", async () => {
    const getToken = vi.fn(token);
    renderHook(() =>
      useStrategyWebSocket({
        pattern: "events.strategy.*",
        onMessage: vi.fn(),
        enabled: false,
        WebSocketImpl: WS,
        getToken,
      }),
    );
    await flush();
    expect(getToken).not.toHaveBeenCalled();
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
