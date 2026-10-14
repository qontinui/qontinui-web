/**
 * `useChatWebSocket` reports the failures it used to drop, and only its own
 * conversation's.
 *
 * Each frame below has the shape its emitter writes — the runner
 * (`backend_relay.rs`) or the backend (`runner_chat_ws.py`) — except where a
 * test says otherwise. Which runner frames reach this socket is the backend
 * relay's decision (`devices_ws.py` `_route_device_message`, which hands the
 * runner's chat frames to every chat socket of the device); these tests pin
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

import { toAiSessionState, useChatWebSocket } from "./useChatWebSocket";

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
  /** Frames this client sent, minus keepalive pings. */
  requests(): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.type !== "ping");
  }
}

function renderChat(onSessionCreated = vi.fn(), onWorkflowGenerated = vi.fn()) {
  const hook = renderHook(() =>
    useChatWebSocket({
      runnerId: "runner-1",
      onSessionCreated,
      onWorkflowGenerated,
    })
  );
  return { ...hook, onSessionCreated, onWorkflowGenerated };
}

/** The hook's socket, once its token fetch has let it open one. */
async function hookSocket(): Promise<FakeWebSocket> {
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const ws = FakeWebSocket.instances[0];
  if (!ws) throw new Error("the hook opened no socket");
  return ws;
}

async function connected(onSessionCreated = vi.fn()) {
  const hook = renderChat(onSessionCreated);
  const ws = await hookSocket();
  act(() => ws.open());
  return { ...hook, ws };
}

/** Everything the hook exposes as state. */
function observed(current: ReturnType<typeof useChatWebSocket>) {
  const {
    isConnected,
    sessionState,
    sessionError,
    messages,
    streamingContent,
    isGeneratingWorkflow,
  } = current;
  return {
    isConnected,
    sessionState,
    sessionError,
    messages,
    streamingContent,
    isGeneratingWorkflow,
  };
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
    // An ack answers a message this conversation sent, so it has its run.
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
      // … one naming it under `data`, as the runner's broadcasts spell it
      // (`taskRunId`; only `chat_response` has a producer today) …
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

  it("drops a frame naming a run while it does not know its own", async () => {
    // Until `chat_created` names this conversation's run, a frame naming a
    // run names someone else's: a workflow agent streaming on the same
    // runner, another tab's session. Read, it streamed into an Ask the Twin
    // nobody had asked anything yet.
    //
    // None of this conversation's own frames can be lost this way. The
    // runner writes `chat_created` before the session it announces exists
    // (`handle_chat_create` returns the reply and spawns the session in the
    // background), the relay keeps the device socket's order on one channel,
    // and a relay chat session's own output names no run at all.
    const { result, ws } = await connected();
    act(() => {
      result.current.createSession("Digital Twin question", "p", "q");
    });

    act(() =>
      ws.push({
        type: "chat_response",
        data: { line: "agent noise", source: "claude", taskRunId: "run-9" },
      })
    );

    expect(result.current.streamingContent).toBe("");
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

/** The runner's `chat_created` for a session it started. */
function created(id: string, taskName = "Digital Twin question") {
  return {
    type: "chat_created",
    id,
    task_name: taskName,
    state: "initializing",
  };
}

describe("useChatWebSocket answers only its own create", () => {
  it("a session created for another task answers another conversation's create", async () => {
    // The runner echoes the request's `task_name` (`handle_chat_create`).
    const { result, ws, onSessionCreated } = await connected();
    act(() => {
      result.current.createSession("Digital Twin question", "p", "q");
    });

    // The chat page's create, answered while this one is outstanding.
    act(() => ws.push(created("run-other", "New Chat")));
    expect(onSessionCreated).not.toHaveBeenCalled();

    act(() => ws.push(created("run-1")));
    expect(onSessionCreated.mock.calls).toEqual([
      ["run-1", "Digital Twin question"],
    ]);
  });

  it("a reply that names no session is a failure, not a session", async () => {
    const { result, ws, onSessionCreated } = await connected();
    act(() => {
      result.current.createSession("Digital Twin question", "p", "q");
    });

    act(() =>
      ws.push({
        type: "chat_created",
        task_name: "Digital Twin question",
        state: "ready",
      })
    );

    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(result.current.sessionError).toBe(
      "The runner did not say which session it started."
    );
  });

  it("its messages go to its own run after another tab's create", async () => {
    const { result, ws } = await connected();
    act(() => {
      result.current.createSession("Digital Twin question", "p", "q");
    });
    act(() => ws.push(created("run-1")));
    act(() => ws.push(created("run-other")));

    act(() => {
      result.current.sendMessage("follow-up");
    });

    expect(ws.requests().at(-1)).toMatchObject({
      type: "chat_message",
      task_run_id: "run-1",
      content: "follow-up",
    });
  });

  it("after a refused create there is no session to message", async () => {
    const { result, ws } = await connected();
    act(() => {
      result.current.createSession("Digital Twin question", "p", "q");
    });
    act(() =>
      ws.push({ type: "chat_created", error: "device_drained: drained" })
    );

    act(() => {
      result.current.sendMessage("follow-up");
    });

    expect(ws.requests().map((r) => r.type)).toEqual(["chat_create"]);
  });
});

/** Every runner frame that names a run, as the runner writes it for `run`. */
function framesAbout(run: string): Array<[string, Record<string, unknown>]> {
  return [
    [
      "chat_output",
      {
        type: "chat_output",
        task_run_id: run,
        output_log:
          "\n[USER_MESSAGE]\nsomeone else's question\n[/USER_MESSAGE]\n",
      },
    ],
    [
      "chat_session_state (the reply to a close)",
      {
        type: "chat_session_state",
        task_run_id: run,
        state: "closed",
        can_send: false,
        can_interrupt: false,
      },
    ],
    [
      "chat_session_state (an error state)",
      {
        type: "chat_session_state",
        task_run_id: run,
        state: "error",
        can_send: false,
        can_interrupt: false,
      },
    ],
    [
      "chat_message_ack (refused)",
      {
        type: "chat_message_ack",
        success: false,
        error: "No active session for task_run_id",
        task_run_id: run,
      },
    ],
    [
      "chat_message_ack (accepted)",
      {
        type: "chat_message_ack",
        success: true,
        queued: false,
        task_run_id: run,
        state: "processing",
      },
    ],
    [
      "chat_renamed",
      { type: "chat_renamed", task_run_id: run, new_name: "Their chat" },
    ],
    [
      "chat_workflow_generated",
      {
        type: "chat_workflow_generated",
        task_run_id: run,
        success: false,
        error: "No conversation history available",
      },
    ],
    [
      "error (a refused interrupt)",
      {
        type: "error",
        task_run_id: run,
        error: "Interrupt failed: not running",
      },
    ],
    [
      "chat_response (a workflow agent's output)",
      {
        type: "chat_response",
        data: {
          id: "ai-1760169600001-18",
          timestamp: 1760169600001,
          line: "someone else's answer",
          source: "claude",
          actionId: null,
          taskRunId: run,
          sessionId: `${run}-agentic-1`,
          sessionName: "Fix login",
          phase: "agentic",
          phaseIteration: 1,
        },
      },
    ],
  ];
}

type ChatHook = ReturnType<typeof renderChat>["result"];

/** Where this conversation stands when another run's frame arrives. */
const STANDINGS: Array<
  [string, (result: ChatHook, ws: FakeWebSocket) => void]
> = [
  [
    "once it has its run",
    (result, ws) => {
      act(() => {
        result.current.createSession("Digital Twin question", "p", "q");
      });
      act(() => ws.push(created("run-1")));
      act(() =>
        ws.push({
          type: "chat_session_state",
          task_run_id: "run-1",
          state: "ready",
          can_send: true,
          can_interrupt: false,
        })
      );
      act(() =>
        ws.push({
          type: "chat_output",
          task_run_id: "run-1",
          output_log: "\n[USER_MESSAGE]\nq\n[/USER_MESSAGE]\nmy answer\n",
        })
      );
    },
  ],
  [
    "while its create is outstanding",
    (result) => {
      act(() => {
        result.current.createSession("Digital Twin question", "p", "q");
      });
    },
  ],
  ["before it has asked for anything", () => {}],
];

describe.each(STANDINGS)(
  "a frame about another run, %s",
  (_standing, arrange) => {
    it.each(framesAbout("run-2"))(
      "%s changes nothing",
      async (_name, frame) => {
        const { result, ws, onWorkflowGenerated } = await connected();
        arrange(result, ws);
        const before = observed(result.current);

        act(() => ws.push(frame));

        expect(observed(result.current)).toEqual(before);
        expect(onWorkflowGenerated).not.toHaveBeenCalled();
      }
    );
  }
);

describe("useChatWebSocket reads its own run's frames (control)", () => {
  async function inOwnSession() {
    const hook = await connected();
    act(() => {
      hook.result.current.createSession("Digital Twin question", "p", "q");
    });
    act(() => hook.ws.push(created("run-1")));
    return hook;
  }

  it("its transcript, errors and state are applied", async () => {
    const { result, ws } = await inOwnSession();

    act(() =>
      ws.push({
        type: "chat_output",
        task_run_id: "run-1",
        output_log:
          "\n[USER_MESSAGE]\nmy question\n[/USER_MESSAGE]\nmy answer\n",
      })
    );
    expect(result.current.messages).toEqual([
      { role: "user", content: "my question" },
      { role: "ai", content: "my answer" },
    ]);

    act(() =>
      ws.push({
        type: "error",
        task_run_id: "run-1",
        error: "Interrupt failed: not running",
      })
    );
    expect(result.current.sessionError).toBe("Interrupt failed: not running");

    act(() =>
      ws.push({
        type: "chat_session_state",
        task_run_id: "run-1",
        state: "closed",
        can_send: false,
        can_interrupt: false,
      })
    );
    expect(result.current.sessionState).toBe("closed");
  });

  it("its generated workflow reaches the caller and ends the wait", async () => {
    const { result, ws, onWorkflowGenerated } = await inOwnSession();

    act(() => result.current.generateWorkflow("run-1"));
    expect(result.current.isGeneratingWorkflow).toBe(true);
    act(() =>
      ws.push({
        type: "chat_workflow_generated",
        task_run_id: "run-1",
        success: false,
        error: "No conversation history available",
      })
    );

    expect(result.current.isGeneratingWorkflow).toBe(false);
    expect(onWorkflowGenerated).toHaveBeenCalledWith({
      taskRunId: "run-1",
      success: false,
      workflow: undefined,
      error: "No conversation history available",
    });
  });

  it("a transcript or workflow that names no run is not taken as its own", async () => {
    // Both replace or complete what the conversation shows, and the runner
    // always names the run on them.
    const { result, ws, onWorkflowGenerated } = await inOwnSession();
    const before = observed(result.current);

    act(() => {
      ws.push({
        type: "chat_output",
        output_log: "\n[USER_MESSAGE]\n?\n[/USER_MESSAGE]\n",
      });
      ws.push({ type: "chat_workflow_generated", success: true, workflow: {} });
    });

    expect(observed(result.current)).toEqual(before);
    expect(onWorkflowGenerated).not.toHaveBeenCalled();
  });
});

/**
 * A session page calls `loadSession` when it mounts, which is before the
 * hook's socket has opened: `connectWebSocket` awaits a token first. The load
 * used to be dropped there, so the page never learned its session's state or
 * transcript.
 */
describe("useChatWebSocket loadSession", () => {
  it("a load asked for before the socket opened is sent when it opens", async () => {
    const { result } = renderChat();
    act(() => result.current.loadSession("run-1"));
    const ws = await hookSocket();
    expect(ws.requests()).toEqual([]);

    act(() => ws.open());

    expect(ws.requests()).toEqual([
      { type: "chat_session_state", params: { task_run_id: "run-1" } },
      { type: "chat_get_output", params: { task_run_id: "run-1" } },
    ]);
    act(() =>
      ws.push({
        type: "chat_session_state",
        task_run_id: "run-1",
        state: "ready",
        can_send: true,
        can_interrupt: false,
      })
    );
    expect(result.current.sessionState).toBe("ready");
  });

  it("only the latest load is sent when the socket opens", async () => {
    const { result } = renderChat();
    act(() => {
      result.current.loadSession("run-2");
      result.current.loadSession("run-1");
    });
    const ws = await hookSocket();

    act(() => ws.open());

    expect(ws.requests().map((r) => r.params)).toEqual([
      { task_run_id: "run-1" },
      { task_run_id: "run-1" },
    ]);
  });

  it("an open socket sends the load at once", async () => {
    const { result, ws } = await connected();

    act(() => result.current.loadSession("run-1"));

    expect(ws.requests()).toEqual([
      { type: "chat_session_state", params: { task_run_id: "run-1" } },
      { type: "chat_get_output", params: { task_run_id: "run-1" } },
    ]);
  });
});

describe("toAiSessionState", () => {
  it("maps the runner's extra state words onto modelled states", () => {
    expect(toAiSessionState("created")).toBe("initializing");
    expect(toAiSessionState("promoting")).toBe("processing");
    expect(toAiSessionState("closing")).toBe("closed");
  });

  it("passes modelled states through and drops unknown ones", () => {
    expect(toAiSessionState("ready")).toBe("ready");
    expect(toAiSessionState("not_found")).toBe("not_found");
    expect(toAiSessionState("something-new")).toBeNull();
    expect(toAiSessionState(undefined)).toBeNull();
    expect(toAiSessionState(3)).toBeNull();
  });
});
