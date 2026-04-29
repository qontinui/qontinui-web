import { useState, useEffect, useRef, useCallback } from "react";
import type { AiSessionState, AiMessage } from "@qontinui/shared-types";
import { parseOutputLog } from "@qontinui/workflow-utils";
import { createLogger } from "@/lib/logger";

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
  messages: AiMessage[];
  streamingContent: string;
  createSession: (taskName?: string) => boolean;
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

    let token: string | null = null;
    try {
      const response = await fetch("/api/v1/ws-token", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        token = data.token || null;
      }
    } catch (error) {
      console.error("[useChatWebSocket] Failed to get WebSocket token:", error);
    }

    if (!token) {
      console.warn("[useChatWebSocket] No access token, cannot connect");
      setSessionState("disconnected");
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws";
    const apiHost = apiUrl.replace(/^https?:\/\//, "");
    const wsUrl = `${wsProtocol}://${apiHost}/api/v1/runners/${runnerId}/chat?token=${encodeURIComponent(token)}`;

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
          const success = msg.success as boolean;
          if (!success) {
            console.error("[useChatWebSocket] Message send failed:", msg.error);
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

        case "error":
          console.error("[useChatWebSocket] Error:", msg.message);
          break;

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
    (taskName?: string): boolean => {
      return sendWs({
        type: "chat_create",
        params: { task_name: taskName || "New Chat" },
      });
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

      sendWs({
        type: "chat_message",
        task_run_id: activeTaskRunIdRef.current,
        content,
      });
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
