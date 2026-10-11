/**
 * `useChatWebSocket` reports the failures it used to drop, and only its own
 * conversation's.
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

    act(() => {
      result.current.createSession("Digital Twin question", "prompt", "q");
    });
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
    act(() => {
      result.current.createSession("Digital Twin question", "prompt", "q1");
    });
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

/**
 * The backend relay sends every chat socket of a device the same runner
 * frames, so frames about OTHER runs on that runner arrive here too. Each
 * frame below names its run the way its emitter does: direct replies as
 * top-level `task_run_id`, broadcast payloads as `data.taskRunId`.
 */
describe("useChatWebSocket keeps to its own conversation", () => {
  /** Connected, with a created session `run-1`. */
  async function inSession() {
    const hook = await connected();
    act(() => {
      hook.result.current.createSession("Digital Twin question", "p", "q");
    });
    act(() =>
      hook.ws.push({
        type: "chat_created",
        id: "run-1",
        task_name: "Digital Twin question",
        state: "initializing",
      })
    );
    return hook;
  }

  it("ignores a chat_created it did not ask for", async () => {
    // Another tab's create: the reply names no requester, so adopting it
    // would point this conversation at that tab's session.
    const { result, ws, onSessionCreated } = await connected();

    act(() =>
      ws.push({
        type: "chat_created",
        id: "run-other",
        task_name: "New Chat",
        state: "initializing",
      })
    );
    act(() =>
      ws.push({ type: "chat_created", error: "device_drained: other tab" })
    );

    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(result.current.sessionError).toBeNull();
    expect(result.current.sessionState).toBe("disconnected");
  });

  it("answers one create with one chat_created", async () => {
    const { ws, onSessionCreated } = await inSession();

    act(() =>
      ws.push({
        type: "chat_created",
        id: "run-other",
        task_name: "New Chat",
        state: "initializing",
      })
    );

    expect(onSessionCreated).toHaveBeenCalledTimes(1);
    expect(onSessionCreated).toHaveBeenCalledWith(
      "run-1",
      "Digital Twin question"
    );
  });

  it("ignores another run's failures once it knows its own", async () => {
    const { result, ws } = await inSession();

    act(() => {
      // A direct reply to another tab's state request …
      ws.push({
        type: "chat_session_state",
        task_run_id: "run-2",
        state: "error",
        can_send: false,
        can_interrupt: false,
      });
      // … the broadcast form, whose payload spells it `taskRunId` …
      ws.push({
        type: "chat_session_state",
        data: { taskRunId: "run-2", sessionId: "run-2", state: "error" },
      });
      // … another tab's unaccepted message, and the runner's error frame.
      ws.push({
        type: "chat_message_ack",
        success: false,
        error: "No active session for task_run_id",
        task_run_id: "run-2",
      });
      ws.push({
        type: "error",
        task_run_id: "run-2",
        error: "Interrupt failed: gone",
      });
    });

    expect(result.current.sessionError).toBeNull();
    expect(result.current.sessionState).not.toBe("error");
  });

  it("keeps another run's output out of its answer", async () => {
    const { result, ws } = await inSession();

    act(() => {
      // A workflow agent's output names its run …
      ws.push({
        type: "chat_response",
        data: { line: "agent noise", source: "claude", taskRunId: "run-2" },
      });
      // … this conversation's relay session names none (no session context).
      ws.push({
        type: "chat_response",
        data: { line: "the answer", source: "claude", taskRunId: null },
      });
    });

    expect(result.current.streamingContent).toBe("the answer");
  });

  it("still reads its own run's frames", async () => {
    const { result, ws } = await inSession();

    act(() =>
      ws.push({
        type: "chat_session_state",
        task_run_id: "run-1",
        state: "error",
        can_send: false,
        can_interrupt: false,
      })
    );

    expect(result.current.sessionState).toBe("error");
  });

  it("reads every frame while it does not know its own run", async () => {
    // Before `chat_created` names this conversation's run there is nothing to
    // compare against, so nothing is dropped: dropping here would also drop
    // this conversation's own frames if they ever named their run.
    const { result, ws } = await connected();
    act(() => {
      result.current.createSession("Digital Twin question", "p", "q");
    });

    act(() =>
      ws.push({
        type: "chat_response",
        data: { line: "partial", source: "claude", taskRunId: "run-9" },
      })
    );

    expect(result.current.streamingContent).toBe("partial");
  });

  it("a new create forgets the previous run instead of messaging it", async () => {
    const { result, ws } = await inSession();

    act(() => {
      result.current.createSession("Digital Twin question", "p", "q2");
    });
    act(() => {
      result.current.sendMessage("follow-up");
    });

    // No `chat_message` to run-1: until the new `chat_created` arrives this
    // conversation has no run to send to.
    expect(ws.sent.filter((m) => m.type === "chat_message")).toEqual([]);
  });
});
