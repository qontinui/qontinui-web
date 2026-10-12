import { useState, useEffect, useRef, useCallback } from "react";
import type { AiSessionState, AiMessage } from "@qontinui/shared-types";
import { parseOutputLog } from "@qontinui/workflow-utils";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";

const log = createLogger("useChatWebSocket");

export type { AiSessionState, AiMessage };

interface ChatWebSocketOptions {
  runnerId: string | null;
  onSessionCreated?: (id: string, taskName: string) => void;
  onWorkflowGenerated?: (data: {
    taskRunId: string;
    success: boolean;
    workflow?: unknown;
    error?: string;
  }) => void;
}

interface ChatWebSocketReturn {
  isConnected: boolean;
  sessionState: AiSessionState;
  /**
   * The last error the runner or the relay reported for this conversation's
   * latest request, in its own words: a refused spawn (`chat_created` with
   * `error`), a session `error` state that carried a message, an unaccepted
   * message (`chat_message_ack` with `success: false`), an `error` frame, or
   * a request the socket could not send. `null` when the latest request has
   * reported none. Cleared when a new request starts (`createSession`,
   * `sendMessage`). A session `error` state with no message leaves this
   * `null` — read `sessionState` for that.
   *
   * "This conversation's" is enforced as far as the wire allows: a frame
   * that names a run other than this conversation's is ignored, including
   * before this conversation knows its own (see {@link frameRunId}), and a
   * `chat_created` this hook did not ask for is ignored. A frame that names
   * no run cannot be told apart and is read.
   */
  sessionError: string | null;
  messages: AiMessage[];
  streamingContent: string;
  createSession: (
    taskName?: string,
    initialPrompt?: string,
    displayText?: string
  ) => boolean;
  sendMessage: (content: string) => void;
  interruptSession: (taskRunId: string) => void;
  closeSession: (taskRunId: string) => void;
  generateWorkflow: (
    taskRunId: string,
    options?: { description?: string; includeUIBridge?: boolean }
  ) => void;
  getOutput: (taskRunId: string) => void;
  renameSession: (taskRunId: string, name: string) => void;
  loadSession: (taskRunId: string) => void;
  isGeneratingWorkflow: boolean;
}

/**
 * The first candidate that is a non-empty string. Every emitter sends its
 * error text as a string today (runner `handle_chat_create` /
 * `handle_chat_message`, backend `runner_chat_ws.py`); anything else is not
 * rendered verbatim.
 */
function errorText(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/**
 * The run a frame says it is about, or `null` when it names none.
 *
 * The runner's direct replies name it at the top level as `task_run_id`
 * (`chat_session_state`, `chat_message_ack`, `error`, `chat_output`, …). Its
 * `chat_response` broadcast carries an `AiOutputEvent` under `data`, which
 * spells it `taskRunId` (qontinui-runner `mcp/shared.rs`). A relay chat
 * session's output names its run on a runner that spawns it with a session
 * context (`backend_relay.rs` `handle_chat_create`); an older runner spawned it
 * without one, so its output names no run. The runner's `session-state`
 * broadcast arrives as `chat_session_state` with the same `data.taskRunId`.
 * The backend's own frames name none.
 */
function frameRunId(msg: Record<string, unknown>): string | null {
  if (typeof msg.task_run_id === "string" && msg.task_run_id) {
    return msg.task_run_id;
  }
  const data = msg.data;
  if (typeof data === "object" && data !== null) {
    const run = (data as Record<string, unknown>).taskRunId;
    if (typeof run === "string" && run) return run;
  }
  return null;
}

/** Every state `AiSessionState` admits. */
const KNOWN_SESSION_STATES: ReadonlySet<string> = new Set<AiSessionState>([
  "connecting",
  "initializing",
  "ready",
  "processing",
  "interrupting",
  "closed",
  "disconnected",
  "error",
  "not_found",
  "restoring",
]);

/**
 * The runner's own state word, read as an `AiSessionState`, or `null` when it
 * names none this page models. The runner's `SessionState::as_event_str` also
 * says `created`, `promoting` and `closing` (qontinui-runner
 * `claude_session/state.rs`), which its `session-state` broadcast now sends on
 * every transition; they map to the nearest state rather than leaking through
 * as values the UI does not know.
 */
export function toAiSessionState(raw: unknown): AiSessionState | null {
  if (typeof raw !== "string") return null;
  switch (raw) {
    case "created":
      return "initializing";
    case "promoting":
      return "processing";
    case "closing":
      return "closed";
    default:
      return KNOWN_SESSION_STATES.has(raw) ? (raw as AiSessionState) : null;
  }
}

/** The requests that load a session: its live state, then its transcript. */
function sessionLoadRequests(taskRunId: string): Record<string, unknown>[] {
  return [
    { type: "chat_session_state", params: { task_run_id: taskRunId } },
    { type: "chat_get_output", params: { task_run_id: taskRunId } },
  ];
}

/**
 * Core chat WebSocket hook.
 *
 * Connects to the backend chat WebSocket relay and handles bidirectional
 * message flow between the frontend and the runner's Claude session.
 */
export function useChatWebSocket({
  runnerId,
  onSessionCreated,
  onWorkflowGenerated,
}: ChatWebSocketOptions): ChatWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [sessionState, setSessionState] =
    useState<AiSessionState>("disconnected");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isGeneratingWorkflow, setIsGeneratingWorkflow] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  /** The run this conversation is about; `null` until one is known. */
  const activeTaskRunIdRef = useRef<string | null>(null);
  /**
   * The task name of a `chat_create` this hook sent that no `chat_created`
   * has answered; `null` when none is outstanding.
   */
  const pendingCreateTaskNameRef = useRef<string | null>(null);
  /** A run `loadSession` named before the socket could carry its requests. */
  const pendingLoadRef = useRef<string | null>(null);
  const streamingBufferRef = useRef("");
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Build WebSocket URL for the chat endpoint
  const connectWebSocket = useCallback(async () => {
    if (!runnerId) return;

    // Client-held Cognito bearer when present (hosted-UI sessions never set
    // the HttpOnly cookie), else the cookie-reading /api/v1/ws-token route.
    const token = await httpClient.getWebSocketToken();

    if (!token) {
      console.warn("[useChatWebSocket] No access token, cannot connect");
      setSessionState("disconnected");
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    // Empty apiUrl => same-origin: derive WS origin from window.location.
    const wsProtocol = apiUrl
      ? apiUrl.startsWith("https")
        ? "wss"
        : "ws"
      : window.location.protocol === "https:"
        ? "wss"
        : "ws";
    const apiHost = apiUrl
      ? apiUrl.replace(/^https?:\/\//, "")
      : window.location.host;
    const wsUrl = `${wsProtocol}://${apiHost}/api/v1/devices/${runnerId}/chat?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Guard: only update state if this is still the active WebSocket
        if (wsRef.current !== ws) return;
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Send the load a page asked for before this socket was open — if it
        // is still about this conversation's run (see `loadSession`).
        const pendingLoad = pendingLoadRef.current;
        pendingLoadRef.current = null;
        if (
          pendingLoad !== null &&
          pendingLoad === activeTaskRunIdRef.current
        ) {
          for (const request of sessionLoadRequests(pendingLoad)) {
            ws.send(JSON.stringify(request));
          }
        }

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);
      };

      ws.onclose = () => {
        // Guard: ignore close events from stale WebSockets (e.g., after
        // React StrictMode double-mount or runnerId change)
        if (wsRef.current !== ws) return;
        setIsConnected(false);
        wsRef.current = null;

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Flush any streaming buffer as a message
        if (streamingBufferRef.current.trim()) {
          const content = streamingBufferRef.current;
          streamingBufferRef.current = "";
          setStreamingContent("");
          setMessages((prev) => [
            ...prev,
            { role: "ai", content, timestamp: new Date().toISOString() },
          ]);
        }

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connectWebSocket();
          }, delay);
        } else {
          setSessionState("disconnected");
        }
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        setIsConnected(false);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch (error) {
          console.error("[useChatWebSocket] Failed to parse message:", error);
        }
      };
    } catch (error) {
      console.error("[useChatWebSocket] Failed to create WebSocket:", error);
      setSessionState("disconnected");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerId]);

  const handleMessage = useCallback(
    (msg: Record<string, unknown>) => {
      const type = msg.type as string;

      // The backend relay sends every chat socket of a device the same runner
      // frames (`chat_relay.py`, channel `runner:chat_response:{id}`), so
      // frames about other runs on that runner — another tab's chat, a
      // workflow agent — arrive here too. One that names a run other than
      // this conversation's is not this conversation's: it must not set its
      // state, its error, its transcript or its answer. That holds before this
      // conversation knows its run as well: until then a frame naming a run
      // names someone else's, because the one frame that introduces this
      // conversation's run is the `chat_created` it asked for, which names it
      // as `id`, not as a run field — and the runner writes that reply before
      // the session it announces exists (`handle_chat_create` spawns it in
      // the background), so none of this conversation's frames precede it. A
      // frame that names no run cannot be told apart and is read.
      const run = frameRunId(msg);
      if (run !== null && run !== activeTaskRunIdRef.current) {
        log.debug("Ignoring a frame about another run:", type, run);
        return;
      }

      switch (type) {
        case "connected":
          // Connection established
          break;

        case "pong":
          break;

        case "chat_created": {
          // The runner's reply carries no request id, so nothing on it says
          // which chat socket asked. One this hook did not ask for is another
          // tab's: adopting it would point this conversation at that session
          // (or report that tab's refusal here).
          const requestedTaskName = pendingCreateTaskNameRef.current;
          if (requestedTaskName === null) {
            log.debug("Ignoring a chat_created this hook did not request");
            break;
          }
          // A created session names its task, and the runner echoes the
          // request's `task_name` verbatim (`handle_chat_create`), so one
          // naming another task answers another conversation's create — Ask
          // the Twin's while this is the chat page's, say. A refusal names no
          // task and cannot be told apart.
          if (
            typeof msg.task_name === "string" &&
            msg.task_name !== requestedTaskName
          ) {
            log.debug(
              "Ignoring a chat_created for another task:",
              msg.task_name
            );
            break;
          }
          pendingCreateTaskNameRef.current = null;
          // A refused create — the runner's spawn-authorization or drain
          // refusal, or a failed task-run insert (`handle_chat_create`) —
          // answers `{ type: "chat_created", error }` with no id and no
          // state: NO session exists. Report it, and never announce it as a
          // created session: `onSessionCreated(undefined)` would route a
          // caller to a session that is not there, and a follow-up would wait
          // forever on a `ready` that cannot come. A reply with no id names
          // no session either.
          if (msg.error || typeof msg.id !== "string" || !msg.id) {
            setSessionError(
              errorText(msg.error) ??
                (msg.error
                  ? "The runner refused to start a session."
                  : "The runner did not say which session it started.")
            );
            setSessionState("error");
            break;
          }
          const id = msg.id;
          const taskName = (msg.task_name as string) || "New Chat";
          const state = msg.state as string;
          activeTaskRunIdRef.current = id;
          if (state === "ready" || state === "error") {
            setSessionState(state === "error" ? "error" : "ready");
          }
          onSessionCreated?.(id, taskName);
          break;
        }

        case "chat_response": {
          // Streaming AI output chunk
          const data = msg.data as Record<string, unknown>;
          if (!data) break;
          const line = (data.line as string) || "";
          const source = (data.source as string) || "";

          if (source === "user_message") {
            // This is an echo of our own message, ignore
            break;
          }

          // Accumulate streaming content
          streamingBufferRef.current += line;
          setStreamingContent(streamingBufferRef.current);
          break;
        }

        case "chat_session_state": {
          const rawState =
            (msg.state as string) ||
            ((msg.data as Record<string, unknown>)?.state as string) ||
            "not_found";
          const state = toAiSessionState(rawState);
          if (state === null) break;
          const canSend = msg.can_send as boolean;
          const canInterrupt = msg.can_interrupt as boolean;

          if (state === "error") {
            // Keep the session's own words when the frame carries any; an
            // error state with no message leaves `sessionError` null.
            const data = msg.data as Record<string, unknown> | undefined;
            setSessionError(
              errorText(msg.error, msg.message, data?.error, data?.message)
            );
          }

          // When transitioning from processing to ready, flush streaming buffer
          if (
            (state === "ready" || state === "closed") &&
            streamingBufferRef.current.trim()
          ) {
            const content = streamingBufferRef.current;
            streamingBufferRef.current = "";
            setStreamingContent("");
            setMessages((prev) => [
              ...prev,
              { role: "ai", content, timestamp: new Date().toISOString() },
            ]);
          }

          setSessionState(state);

          // Also use can_send/can_interrupt for more precise state
          if (canSend && state !== "closed") {
            setSessionState("ready");
          } else if (canInterrupt) {
            setSessionState("processing");
          }
          break;
        }

        case "chat_message_ack": {
          // `success: false` means the runner did not take the message (e.g.
          // "No active session for task_run_id"): no answer is coming, so it
          // is reported, not only logged. A missing `success` is no failure.
          if (msg.success === false) {
            console.error("[useChatWebSocket] Message send failed:", msg.error);
            setSessionError(
              errorText(msg.error) ?? "The runner did not accept the message."
            );
          }
          const ackState = toAiSessionState(msg.state);
          if (ackState) {
            setSessionState(ackState);
          }
          break;
        }

        case "chat_running_tasks": {
          // List of running tasks - handled externally
          break;
        }

        case "chat_output": {
          // Full conversation output loaded. It REPLACES the transcript, so
          // it is taken only when it names this conversation's run — every
          // other run's was dropped above, and one naming no run cannot be
          // told apart (the runner always names it).
          if (run === null) {
            log.debug("Ignoring a chat_output that names no run");
            break;
          }
          const outputLog = msg.output_log as string;
          if (outputLog) {
            const parsed = parseOutputLog(outputLog);
            setMessages(parsed);
          }
          break;
        }

        case "chat_workflow_generating":
          setIsGeneratingWorkflow(true);
          break;

        case "chat_workflow_generated": {
          // Only this conversation's generation ends its wait or reaches its
          // caller; as with `chat_output`, the runner always names the run.
          if (run === null) {
            log.debug("Ignoring a chat_workflow_generated that names no run");
            break;
          }
          setIsGeneratingWorkflow(false);
          onWorkflowGenerated?.({
            taskRunId: run,
            success: msg.success as boolean,
            workflow: msg.workflow,
            error: msg.error as string | undefined,
          });
          break;
        }

        case "chat_renamed":
          // Session renamed - handled externally via callback
          break;

        case "chat_sent":
        case "chat_create_sent":
          // Acknowledgments that messages were forwarded
          break;

        case "warning":
          console.warn("[useChatWebSocket] Warning:", msg.message);
          break;

        case "error": {
          // The backend spells its text `message` ("Runner is not
          // connected." when it could not forward a request); the runner
          // spells it `error`. Either way the request it answers failed.
          const text = errorText(msg.error, msg.message);
          console.error("[useChatWebSocket] Error:", text);
          setSessionError(text ?? "The relay reported an error.");
          break;
        }

        case "runner_disconnected":
          setSessionState("disconnected");
          break;

        default:
          log.debug("Unhandled message type:", type);
      }
    },
    [onSessionCreated, onWorkflowGenerated]
  );

  const sendWs = useCallback((data: Record<string, unknown>): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  const createSession = useCallback(
    (
      taskName?: string,
      initialPrompt?: string,
      displayText?: string
    ): boolean => {
      // One-shot: when `initialPrompt` is supplied it becomes the session's FIRST
      // turn (the runner reads `params.prompt`), so the session answers it
      // directly — no separate wait-for-ready → sendMessage handshake. Render the
      // human-facing `displayText` (e.g. the raw question, without the preamble)
      // immediately so the conversation shows what was asked.
      //
      // A new session starts from the no-session baseline (`disconnected`,
      // the initial state): the previous session's error, or its last state
      // (`error`, `closed`, a stale `ready`), is not this one's. Nor is its
      // run: this conversation is about the run the coming `chat_created`
      // names, so until then there is none to send to or filter by.
      setSessionError(null);
      setSessionState("disconnected");
      activeTaskRunIdRef.current = null;
      if (displayText) {
        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            content: displayText,
            timestamp: new Date().toISOString(),
          },
        ]);
        streamingBufferRef.current = "";
        setStreamingContent("");
      }
      const requestedTaskName = taskName || "New Chat";
      const sent = sendWs({
        type: "chat_create",
        params: {
          task_name: requestedTaskName,
          ...(initialPrompt ? { prompt: initialPrompt } : {}),
        },
      });
      // Only a create that went out can be answered.
      pendingCreateTaskNameRef.current = sent ? requestedTaskName : null;
      if (!sent) {
        setSessionError(
          "Not connected to the chat relay — the request was not sent."
        );
      }
      return sent;
    },
    [sendWs]
  );

  const sendMessage = useCallback(
    (content: string) => {
      if (!activeTaskRunIdRef.current) return;

      // Add user message to local state immediately
      setMessages((prev) => [
        ...prev,
        { role: "user", content, timestamp: new Date().toISOString() },
      ]);

      // Reset streaming buffer for new AI response
      streamingBufferRef.current = "";
      setStreamingContent("");

      setSessionError(null);
      const sent = sendWs({
        type: "chat_message",
        task_run_id: activeTaskRunIdRef.current,
        content,
      });
      if (!sent) {
        setSessionError(
          "Not connected to the chat relay — the message was not sent."
        );
      }
    },
    [sendWs]
  );

  const interruptSession = useCallback(
    (taskRunId: string) => {
      sendWs({
        type: "chat_interrupt",
        params: { task_run_id: taskRunId },
      });
    },
    [sendWs]
  );

  const closeSession = useCallback(
    (taskRunId: string) => {
      sendWs({
        type: "chat_close",
        params: { task_run_id: taskRunId },
      });
    },
    [sendWs]
  );

  const generateWorkflow = useCallback(
    (
      taskRunId: string,
      options?: { description?: string; includeUIBridge?: boolean }
    ) => {
      setIsGeneratingWorkflow(true);
      sendWs({
        type: "chat_generate_workflow",
        params: {
          task_run_id: taskRunId,
          description:
            options?.description || "Generate workflow from chat conversation",
          include_ui_bridge_instructions: options?.includeUIBridge ?? true,
        },
      });
    },
    [sendWs]
  );

  const getOutput = useCallback(
    (taskRunId: string) => {
      sendWs({
        type: "chat_get_output",
        params: { task_run_id: taskRunId },
      });
    },
    [sendWs]
  );

  const renameSession = useCallback(
    (taskRunId: string, name: string) => {
      sendWs({
        type: "chat_rename",
        params: { task_run_id: taskRunId, name },
      });
    },
    [sendWs]
  );

  const loadSession = useCallback(
    (taskRunId: string) => {
      activeTaskRunIdRef.current = taskRunId;
      // Request session state and output. A page loads its session when it
      // mounts, which is before this socket is open (`connectWebSocket`
      // awaits a token first), so these usually cannot go yet: the open
      // handler sends them then. Dropped instead, the page never learned its
      // session's state — so it could never send — nor its transcript.
      const sent = sessionLoadRequests(taskRunId)
        .map((request) => sendWs(request))
        .every(Boolean);
      pendingLoadRef.current = sent ? null : taskRunId;
    },
    [sendWs]
  );

  // Connect on mount
  useEffect(() => {
    if (runnerId) {
      connectWebSocket();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [connectWebSocket, runnerId]);

  return {
    isConnected,
    sessionState,
    sessionError,
    messages,
    streamingContent,
    createSession,
    sendMessage,
    interruptSession,
    closeSession,
    generateWorkflow,
    getOutput,
    renameSession,
    loadSession,
    isGeneratingWorkflow,
  };
}
