/**
 * `useChatWebSocket` reports the failures it used to drop.
 *
 * Each frame below has the shape its emitter writes — the runner
 * (`backend_relay.rs`) or the backend (`runner_chat_ws.py`) — except where a
 * test says otherwise. Whether a runner frame reaches this socket at all is
 * the backend relay's decision (`devices_ws.py` `_route_device_message`,
 * which forwards only the runner's `chat_response` frames); these tests pin
 * how the hook reads each frame once it arrives.
 *
 * The contract pinned here is shared by every caller: Ask the Twin renders
 * `sessionError`, and the /chat page navigates to `/chat/<id>` from
 * `onSessionCreated` — so a refused create must never be announced as a
 * created session (it used to call `onSessionCreated(undefined)`).
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/service-factory", () => ({
  httpClient: { getWebSocketToken: async () => "test-token" },
}));

import { useChatWebSocket } from "./useChatWebSocket";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  push(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

async function connected(onSessionCreated = vi.fn()) {
  const hook = renderHook(() =>
    useChatWebSocket({ runnerId: "runner-1", onSessionCreated })
  );
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const ws = FakeWebSocket.instances[0];
  if (!ws) throw new Error("the hook opened no socket");
  act(() => ws.open());
  return { ...hook, ws, onSessionCreated };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useChatWebSocket failure reporting", () => {
  it("reports a refused create and never announces it as a session", async () => {
    const { result, ws, onSessionCreated } = await connected();

    act(() => {
      result.current.createSession("Digital Twin question", "prompt", "q");
    });
    act(() =>
      ws.push({ type: "chat_created", error: "spawn-authorization deny: no" })
    );

    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(result.current.sessionState).toBe("error");
    expect(result.current.sessionError).toBe("spawn-authorization deny: no");
  });

  it("still announces a created session", async () => {
    const { result, ws, onSessionCreated } = await connected();

    act(() =>
      ws.push({
        type: "chat_created",
        id: "run-1",
        task_name: "Digital Twin question",
        state: "initializing",
      })
    );

    expect(onSessionCreated).toHaveBeenCalledWith(
      "run-1",
      "Digital Twin question"
    );
    expect(result.current.sessionError).toBeNull();
  });

  it("a new create clears the previous failure and its state", async () => {
    const { result, ws } = await connected();
    act(() => ws.push({ type: "chat_created", error: "device_drained: x" }));
    expect(result.current.sessionState).toBe("error");

    act(() => {
      result.current.createSession("Digital Twin question", "prompt", "q2");
    });

    expect(result.current.sessionError).toBeNull();
    expect(result.current.sessionState).toBe("disconnected");
  });

  it("keeps a session error state's message when the frame carries one", async () => {
    // No emitter puts a message on a session-state frame today (the runner's
    // `SessionStateEvent` carries its ids and the state only); the hook keeps
    // one should a frame ever carry it.
    const { result, ws } = await connected();

    act(() =>
      ws.push({
        type: "chat_session_state",
        data: { state: "error", error: "claude CLI exited (code 1)" },
      })
    );

    expect(result.current.sessionState).toBe("error");
    expect(result.current.sessionError).toBe("claude CLI exited (code 1)");
  });

  it("reports an unaccepted message", async () => {
    const { result, ws } = await connected();

    act(() =>
      ws.push({
        type: "chat_message_ack",
        success: false,
        error: "No active session for task_run_id",
        task_run_id: "run-1",
      })
    );

    expect(result.current.sessionError).toBe(
      "No active session for task_run_id"
    );
  });

  it("does not read an ack without `success` as a failure", async () => {
    const { result, ws } = await connected();

    act(() => ws.push({ type: "chat_message_ack", state: "processing" }));

    expect(result.current.sessionError).toBeNull();
    expect(result.current.sessionState).toBe("processing");
  });

  it("reads an error frame in either spelling", async () => {
    const { result, ws } = await connected();

    // The backend spells it `message` …
    act(() => ws.push({ type: "error", message: "Runner is not connected." }));
    expect(result.current.sessionError).toBe("Runner is not connected.");

    // … the runner spells it `error`.
    act(() => ws.push({ type: "error", error: "Interrupt failed: gone" }));
    expect(result.current.sessionError).toBe("Interrupt failed: gone");
  });

  it("reports a create the socket could not send", async () => {
    const hook = renderHook(() => useChatWebSocket({ runnerId: "runner-1" }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    // Never opened.

    let sent = true;
    act(() => {
      sent = hook.result.current.createSession("t", "p", "q");
    });

    expect(sent).toBe(false);
    expect(hook.result.current.sessionError).toContain("not sent");
  });
});
