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
  const activeTaskRunIdRef = useRef<string | null>(null);
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

      switch (type) {
        case "connected":
          // Connection established
          break;

        case "pong":
          break;

        case "chat_created": {
          // A refused create — the runner's spawn-authorization or drain
          // refusal, or a failed task-run insert (`handle_chat_create`) —
          // answers `{ type: "chat_created", error }` with no id and no
          // state: NO session exists. Report it, and never announce it as a
          // created session: `onSessionCreated(undefined)` would route a
          // caller to a session that is not there, and a follow-up would wait
          // forever on a `ready` that cannot come.
          if (msg.error) {
            setSessionError(
              errorText(msg.error) ?? "The runner refused to start a session."
            );
            setSessionState("error");
            break;
          }
          const id = msg.id as string;
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
          const state = rawState;
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

          setSessionState(state as AiSessionState);

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
          const ackState = msg.state as string;
          if (ackState) {
            setSessionState(ackState as AiSessionState);
          }
          break;
        }

        case "chat_running_tasks": {
          // List of running tasks - handled externally
          break;
        }

        case "chat_output": {
          // Full conversation output loaded
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
          setIsGeneratingWorkflow(false);
          onWorkflowGenerated?.({
            taskRunId: msg.task_run_id as string,
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
      // (`error`, `closed`, a stale `ready`), is not this one's.
      setSessionError(null);
      setSessionState("disconnected");
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
      const sent = sendWs({
        type: "chat_create",
        params: {
          task_name: taskName || "New Chat",
          ...(initialPrompt ? { prompt: initialPrompt } : {}),
        },
      });
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
      // Request session state and output
      sendWs({
        type: "chat_session_state",
        params: { task_run_id: taskRunId },
      });
      sendWs({
        type: "chat_get_output",
        params: { task_run_id: taskRunId },
      });
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
