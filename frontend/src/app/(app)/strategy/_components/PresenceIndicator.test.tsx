/**
 * PresenceIndicator tests (Phase 2.4).
 *
 * Drives a mock WebSocket to push aggregate events through the WS
 * hook and asserts the badge renders / hides / updates correctly.
 *
 * The hook opens its socket through the web backend's coord-events
 * bridge, which needs a session token first — `httpClient` is mocked to
 * supply one, and each test flushes that fetch before reading the socket.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PresenceIndicator } from "./PresenceIndicator";

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    getWebSocketToken: vi.fn(async () => "test-session-token"),
  },
}));

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

/** The socket opens only after the token fetch settles — flush it. */
const flush = () => act(async () => {});

async function mount(docId: string | null) {
  const ui = render(
    <PresenceIndicator
      docId={docId}
      WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
    />,
  );
  await flush();
  return ui;
}

beforeEach(() => {
  MockWebSocket.instances = [];
});

describe("<PresenceIndicator>", () => {
  it("renders nothing when docId is null", async () => {
    const { container } = await mount(null);
    expect(container.firstChild).toBeNull();
    // Should not even open a WS until docId is known.
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("opens the bridge's strategy subscription, not a coord socket", async () => {
    await mount("doc-uuid-1");
    expect(MockWebSocket.instances).toHaveLength(1);
    const url = MockWebSocket.instances[0].url;
    expect(url).toContain("/api/v1/operations/coord-events/ws?");
    expect(url).toContain("subscribe=strategy");
    expect(url).toContain("token=test-session-token");
    expect(url).not.toContain("pattern=");
  });

  it("renders nothing when count <= 1 (just me)", async () => {
    await mount("doc-uuid-1");
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

  it("renders the badge when count >= 2", async () => {
    await mount("doc-uuid-1");
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

  it("updates count on subsequent aggregate events", async () => {
    await mount("doc-uuid-1");
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

  it("ignores aggregate events for OTHER docs", async () => {
    await mount("doc-uuid-1");
    const ws = MockWebSocket.instances[0];
    // The bridge fans out EVERY events.strategy.* frame to this socket;
    // the hook's client-side pattern filter drops the other doc's frame
    // before the dispatcher, and the payload.doc_id check is the
    // defensive second line.
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
