/**
 * WebSocket hook for streaming live test results
 *
 * Provides real-time updates from test execution including:
 * - Test run status changes
 * - Step-by-step execution progress
 * - Screenshot captures
 * - Coverage updates
 * - Deficiency detection
 */

import { useEffect, useState, useRef, useCallback } from "react";

export type TestStreamState =
  | "idle"
  | "connecting"
  | "connected"
  | "running"
  | "completed"
  | "failed"
  | "disconnected"
  | "reconnecting";

export interface TestStep {
  id: string;
  testRunId: string;
  stepNumber: number;
  stepType: "transition" | "action" | "assertion" | "screenshot";
  fromState?: string;
  toState?: string;
  actionType?: string;
  status: "pending" | "running" | "success" | "failed";
  duration: number;
  timestamp: string;
  screenshotUrl?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface CoverageUpdate {
  statesCovered: number;
  totalStates: number;
  coveragePercentage: number;
  uncoveredStates: string[];
  newlyCoveredStates: string[];
}

export interface DeficiencyAlert {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  stateName: string;
  timestamp: string;
}

export interface TestStreamMessage {
  type:
    | "test_started"
    | "test_completed"
    | "test_failed"
    | "step_started"
    | "step_completed"
    | "step_failed"
    | "coverage_update"
    | "deficiency_detected"
    | "heartbeat";
  testRunId: string;
  timestamp: string;
  data?: unknown;
}

export interface LiveTestData {
  testRunId: string | null;
  state: TestStreamState;
  workflowName: string | null;
  startTime: Date | null;
  elapsedTime: number;
  currentStep: TestStep | null;
  steps: TestStep[];
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  coverage: CoverageUpdate | null;
  deficiencies: DeficiencyAlert[];
  lastUpdate: Date | null;
}

export interface UseTestStreamOptions {
  testRunId?: string;
  enabled?: boolean;
  autoReconnect?: boolean;
  reconnectAttempts?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onStepComplete?: (step: TestStep) => void;
  onCoverageUpdate?: (coverage: CoverageUpdate) => void;
  onDeficiencyDetected?: (deficiency: DeficiencyAlert) => void;
  onTestComplete?: (data: { success: boolean; duration: number }) => void;
}

const DEFAULT_OPTIONS: Partial<UseTestStreamOptions> = {
  enabled: true,
  autoReconnect: true,
  reconnectAttempts: 5,
};

/**
 * Hook for streaming live test execution data via WebSocket
 */
export function useTestStream(options: UseTestStreamOptions = {}) {
  const {
    testRunId,
    enabled = true,
    autoReconnect = true,
    reconnectAttempts = 5,
    onConnect,
    onDisconnect,
    onError,
    onStepComplete,
    onCoverageUpdate,
    onDeficiencyDetected,
    onTestComplete,
  } = { ...DEFAULT_OPTIONS, ...options };

  const [testData, setTestData] = useState<LiveTestData>({
    testRunId: null,
    state: "idle",
    workflowName: null,
    startTime: null,
    elapsedTime: 0,
    currentStep: null,
    steps: [],
    totalSteps: 0,
    completedSteps: 0,
    failedSteps: 0,
    coverage: null,
    deficiencies: [],
    lastUpdate: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<Date | null>(null);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const messageQueue = useRef<string[]>([]);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastHeartbeatRef = useRef<Date | null>(null);

  /**
   * Start elapsed time counter
   */
  const startElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
    }

    startTimeRef.current = new Date();

    elapsedTimerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const elapsed = Math.floor(
          (new Date().getTime() - startTimeRef.current.getTime()) / 1000
        );
        setTestData((prev) => ({ ...prev, elapsedTime: elapsed }));
      }
    }, 1000);
  }, []);

  /**
   * Stop elapsed time counter
   */
  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  /**
   * Send queued messages after reconnection
   */
  const flushMessageQueue = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    while (messageQueue.current.length > 0) {
      const message = messageQueue.current.shift();
      if (message) {
        try {
          wsRef.current.send(message);
          console.log("[useTestStream] Sent queued message");
        } catch (error) {
          console.error(
            "[useTestStream] Failed to send queued message:",
            error
          );
          messageQueue.current.unshift(message);
          break;
        }
      }
    }
  }, []);

  /**
   * Send message or queue if disconnected
   */
  const sendMessage = useCallback((message: object) => {
    const messageStr = JSON.stringify(message);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(messageStr);
      } catch (error) {
        console.error("[useTestStream] Failed to send message:", error);
        messageQueue.current.push(messageStr);
      }
    } else {
      console.log("[useTestStream] Queueing message (not connected)");
      messageQueue.current.push(messageStr);
    }
  }, []);

  /**
   * Start heartbeat monitoring
   */
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    lastHeartbeatRef.current = new Date();

    heartbeatIntervalRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      const now = new Date();
      const lastHeartbeat = lastHeartbeatRef.current;

      if (lastHeartbeat) {
        const timeSinceLastHeartbeat = now.getTime() - lastHeartbeat.getTime();

        if (timeSinceLastHeartbeat > 60000) {
          console.warn(
            "[useTestStream] No heartbeat for 60s, connection may be stale"
          );
          if (wsRef.current) {
            wsRef.current.close();
          }
        }
      }

      sendMessage({ type: "ping" });
    }, 30000);
  }, [sendMessage]);

  /**
   * Stop heartbeat monitoring
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: TestStreamMessage = JSON.parse(event.data);

        if (message.type === "heartbeat") {
          lastHeartbeatRef.current = new Date();
          return;
        }

        setTestData((prev) => {
          const updated = { ...prev, lastUpdate: new Date() };

          switch (message.type) {
            case "test_started": {
              const data = message.data as {
                workflow_name: string;
                total_steps?: number;
              };
              startElapsedTimer();
              return {
                ...updated,
                testRunId: message.testRunId,
                state: "running",
                workflowName: data.workflow_name,
                startTime: new Date(message.timestamp),
                totalSteps: data.total_steps || 0,
                steps: [],
                completedSteps: 0,
                failedSteps: 0,
                coverage: null,
                deficiencies: [],
                elapsedTime: 0,
              };
            }

            case "step_started": {
              const data = message.data as {
                step_id: string;
                step_number: number;
                step_type: TestStep["stepType"];
                from_state?: string;
                to_state?: string;
                action_type?: string;
              };

              const newStep: TestStep = {
                id: data.step_id,
                testRunId: message.testRunId,
                stepNumber: data.step_number,
                stepType: data.step_type,
                fromState: data.from_state,
                toState: data.to_state,
                actionType: data.action_type,
                status: "running",
                duration: 0,
                timestamp: message.timestamp,
              };

              return {
                ...updated,
                currentStep: newStep,
                steps: [...prev.steps, newStep].slice(-500),
              };
            }

            case "step_completed": {
              const data = message.data as {
                step_id: string;
                duration: number;
                screenshot_url?: string;
                metadata?: Record<string, unknown>;
              };

              const updatedSteps = prev.steps.map((step) =>
                step.id === data.step_id
                  ? {
                      ...step,
                      status: "success" as const,
                      duration: data.duration,
                      screenshotUrl: data.screenshot_url,
                      metadata: data.metadata,
                    }
                  : step
              );

              const completedStep = updatedSteps.find(
                (s) => s.id === data.step_id
              );

              if (completedStep && onStepComplete) {
                onStepComplete(completedStep);
              }

              return {
                ...updated,
                steps: updatedSteps,
                completedSteps: prev.completedSteps + 1,
                currentStep: null,
              };
            }

            case "step_failed": {
              const data = message.data as {
                step_id: string;
                duration: number;
                error_message: string;
                screenshot_url?: string;
              };

              const updatedSteps = prev.steps.map((step) =>
                step.id === data.step_id
                  ? {
                      ...step,
                      status: "failed" as const,
                      duration: data.duration,
                      errorMessage: data.error_message,
                      screenshotUrl: data.screenshot_url,
                    }
                  : step
              );

              return {
                ...updated,
                steps: updatedSteps,
                failedSteps: prev.failedSteps + 1,
                currentStep: null,
              };
            }

            case "coverage_update": {
              const data = message.data as {
                states_covered: number;
                total_states: number;
                coverage_percentage: number;
                uncovered_states: string[];
                newly_covered_states: string[];
              };

              const coverage: CoverageUpdate = {
                statesCovered: data.states_covered,
                totalStates: data.total_states,
                coveragePercentage: data.coverage_percentage,
                uncoveredStates: data.uncovered_states,
                newlyCoveredStates: data.newly_covered_states,
              };

              if (onCoverageUpdate) {
                onCoverageUpdate(coverage);
              }

              return {
                ...updated,
                coverage,
              };
            }

            case "deficiency_detected": {
              const data = message.data as {
                id: string;
                severity: DeficiencyAlert["severity"];
                title: string;
                description: string;
                state_name: string;
              };

              const deficiency: DeficiencyAlert = {
                id: data.id,
                severity: data.severity,
                title: data.title,
                description: data.description,
                stateName: data.state_name,
                timestamp: message.timestamp,
              };

              if (onDeficiencyDetected) {
                onDeficiencyDetected(deficiency);
              }

              return {
                ...updated,
                deficiencies: [...prev.deficiencies, deficiency].slice(-100),
              };
            }

            case "test_completed": {
              const data = message.data as {
                success: boolean;
                duration: number;
              };
              stopElapsedTimer();

              if (onTestComplete) {
                onTestComplete(data);
              }

              return {
                ...updated,
                state: "completed",
                currentStep: null,
              };
            }

            case "test_failed": {
              stopElapsedTimer();

              return {
                ...updated,
                state: "failed",
                currentStep: null,
              };
            }

            default:
              console.warn("[useTestStream] Unknown message type:", message);
              return updated;
          }
        });
      } catch (error) {
        console.error("[useTestStream] Failed to parse message:", error);
        if (onError) {
          onError(error as Error);
        }
      }
    },
    [
      onStepComplete,
      onCoverageUpdate,
      onDeficiencyDetected,
      onTestComplete,
      onError,
      startElapsedTimer,
      stopElapsedTimer,
    ]
  );

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (!enabled || !testRunId) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.warn("[useTestStream] Already connected");
      return;
    }

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/v1/testing/stream/${testRunId}`;

      console.log("[useTestStream] Connecting to:", wsUrl);

      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log("[useTestStream] Connected");
        reconnectCount.current = 0;
        setTestData((prev) => ({ ...prev, state: "connected" }));

        startHeartbeat();
        flushMessageQueue();

        if (onConnect) {
          onConnect();
        }
      };

      wsRef.current.onmessage = handleMessage;

      wsRef.current.onerror = (event) => {
        console.error("[useTestStream] WebSocket error:", event);
        if (onError) {
          onError(new Error("WebSocket connection error"));
        }
      };

      wsRef.current.onclose = (event) => {
        console.log("[useTestStream] Disconnected:", event.code, event.reason);
        stopElapsedTimer();
        stopHeartbeat();

        const wasNormalClosure = event.code === 1000;
        const shouldReconnect =
          autoReconnect &&
          enabled &&
          reconnectCount.current < reconnectAttempts &&
          !wasNormalClosure;

        setTestData((prev) => ({
          ...prev,
          state: shouldReconnect ? "reconnecting" : "disconnected",
        }));

        if (onDisconnect) {
          onDisconnect();
        }

        if (shouldReconnect) {
          reconnectCount.current++;
          const delay = Math.min(
            1000 * Math.pow(2, reconnectCount.current - 1),
            30000
          );

          console.log(
            `[useTestStream] Reconnecting in ${delay}ms (attempt ${reconnectCount.current}/${reconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (
          reconnectCount.current >= reconnectAttempts &&
          !wasNormalClosure
        ) {
          console.error("[useTestStream] Max reconnect attempts reached");
          messageQueue.current = [];
          if (onError) {
            onError(
              new Error("Connection lost after maximum reconnection attempts")
            );
          }
        }
      };
    } catch (error) {
      console.error("[useTestStream] Failed to create WebSocket:", error);
      if (onError) {
        onError(error as Error);
      }
    }
  }, [
    enabled,
    testRunId,
    autoReconnect,
    reconnectAttempts,
    handleMessage,
    onConnect,
    onDisconnect,
    onError,
    stopElapsedTimer,
    stopHeartbeat,
    startHeartbeat,
    flushMessageQueue,
  ]);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    stopElapsedTimer();
    stopHeartbeat();
    messageQueue.current = [];

    if (wsRef.current) {
      wsRef.current.close(1000, "Client disconnect");
      wsRef.current = null;
    }

    setTestData((prev) => ({ ...prev, state: "idle" }));
  }, [stopElapsedTimer, stopHeartbeat]);

  /**
   * Connect on mount and when testRunId changes
   */
  useEffect(() => {
    if (enabled && testRunId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, testRunId, connect, disconnect]);

  return {
    ...testData,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    reconnectAttempt: reconnectCount.current,
    maxReconnectAttempts: reconnectAttempts,
    queuedMessages: messageQueue.current.length,
    connect,
    disconnect,
  };
}
