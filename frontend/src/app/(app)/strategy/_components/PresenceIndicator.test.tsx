/**
 * PresenceIndicator tests (Phase 2.4).
 *
 * Drives a mock WebSocket to push aggregate events through the WS
 * hook and asserts the badge renders / hides / updates correctly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PresenceIndicator } from "./PresenceIndicator";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly url: string;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send() {
    /* noop */
  }
  close() {
    this.onclose?.(new CloseEvent("close"));
  }
  emit(channel: string, payloadObj: unknown) {
    const envelope = {
      channel,
      payload: JSON.stringify(payloadObj),
    };
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(envelope) }));
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
});

describe("<PresenceIndicator>", () => {
  it("renders nothing when docId is null", () => {
    const { container } = render(
      <PresenceIndicator
        docId={null}
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />,
    );
    expect(container.firstChild).toBeNull();
    // Should not even open a WS until docId is known.
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("renders nothing when count <= 1 (just me)", () => {
    render(
      <PresenceIndicator
        docId="doc-uuid-1"
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />,
    );
    const ws = MockWebSocket.instances[0];
    act(() =>
      ws.emit("events.strategy.presence.aggregate.doc-uuid-1", {
        doc_id: "doc-uuid-1",
        count: 1,
        users: ["me"],
      }),
    );
    expect(screen.queryByTestId("presence-indicator")).toBeNull();
  });

  it("renders the badge when count >= 2", () => {
    render(
      <PresenceIndicator
        docId="doc-uuid-1"
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />,
    );
    const ws = MockWebSocket.instances[0];
    act(() =>
      ws.emit("events.strategy.presence.aggregate.doc-uuid-1", {
        doc_id: "doc-uuid-1",
        count: 3,
        users: ["a", "b", "c"],
      }),
    );
    const badge = screen.getByTestId("presence-indicator");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain("3 viewing");
  });

  it("updates count on subsequent aggregate events", () => {
    render(
      <PresenceIndicator
        docId="doc-uuid-1"
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />,
    );
    const ws = MockWebSocket.instances[0];
    act(() =>
      ws.emit("events.strategy.presence.aggregate.doc-uuid-1", {
        doc_id: "doc-uuid-1",
        count: 5,
        users: ["a", "b", "c", "d", "e"],
      }),
    );
    expect(screen.getByTestId("presence-indicator").textContent).toContain(
      "5 viewing",
    );
    act(() =>
      ws.emit("events.strategy.presence.aggregate.doc-uuid-1", {
        doc_id: "doc-uuid-1",
        count: 2,
        users: ["a", "b"],
      }),
    );
    expect(screen.getByTestId("presence-indicator").textContent).toContain(
      "2 viewing",
    );
    // Drop to 1 → badge disappears.
    act(() =>
      ws.emit("events.strategy.presence.aggregate.doc-uuid-1", {
        doc_id: "doc-uuid-1",
        count: 1,
        users: ["a"],
      }),
    );
    expect(screen.queryByTestId("presence-indicator")).toBeNull();
  });

  it("ignores aggregate events for OTHER docs", () => {
    render(
      <PresenceIndicator
        docId="doc-uuid-1"
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />,
    );
    const ws = MockWebSocket.instances[0];
    // Frame from a different doc — match by payload.doc_id should
    // reject this even if the channel pattern somehow matched.
    act(() =>
      ws.emit("events.strategy.presence.aggregate.doc-uuid-OTHER", {
        doc_id: "doc-uuid-OTHER",
        count: 7,
        users: ["x"],
      }),
    );
    expect(screen.queryByTestId("presence-indicator")).toBeNull();
  });
});
