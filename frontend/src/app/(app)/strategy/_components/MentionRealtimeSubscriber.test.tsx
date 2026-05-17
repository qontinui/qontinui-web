/**
 * MentionRealtimeSubscriber tests (Phase 2.5).
 *
 * Mounts the headless subscriber inside a `QueryClientProvider`,
 * drives a mock WebSocket, and asserts that the unread-mentions
 * query cache is invalidated when an `events.strategy.mention.created.<me>`
 * frame arrives. Confirms cross-user frames are ignored.
 */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MentionRealtimeSubscriber } from "./MentionRealtimeSubscriber";

const ME = "me-uuid";
const OTHER = "other-uuid";

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

function setup(userId: string | null) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const ui = render(
    <QueryClientProvider client={qc}>
      <MentionRealtimeSubscriber
        userId={userId}
        WebSocketImpl={MockWebSocket as unknown as typeof WebSocket}
      />
    </QueryClientProvider>
  );
  return { qc, spy, ui };
}

describe("<MentionRealtimeSubscriber>", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  it("does not open a WebSocket when userId is null", () => {
    setup(null);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("opens a tightly-scoped pattern when userId is set", () => {
    setup(ME);
    expect(MockWebSocket.instances).toHaveLength(1);
    const url = MockWebSocket.instances[0].url;
    expect(url).toContain(
      encodeURIComponent(`events.strategy.mention.created.${ME}`)
    );
  });

  it("invalidates the unread-mentions cache on a matching frame", () => {
    const { spy } = setup(ME);
    const ws = MockWebSocket.instances[0];
    act(() =>
      ws.emit(`events.strategy.mention.created.${ME}`, {
        mention_id: "m-1",
        post_id: "p-1",
        mentioned_user_id: ME,
        created_at: new Date().toISOString(),
      })
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["strategy", "mentions", "unread"],
    });
  });

  it("ignores frames addressed to a different user", () => {
    const { spy } = setup(ME);
    const ws = MockWebSocket.instances[0];
    act(() =>
      ws.emit(`events.strategy.mention.created.${OTHER}`, {
        mention_id: "m-2",
        post_id: "p-2",
        mentioned_user_id: OTHER,
        created_at: new Date().toISOString(),
      })
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
