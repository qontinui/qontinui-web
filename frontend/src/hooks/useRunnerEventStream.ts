"use client";

import { useRef, useCallback, useEffect } from "react";

// Use 127.0.0.1 to force IPv4 (runner only listens on IPv4)
const RUNNER_WS_URL = "ws://127.0.0.1:9876/ws/events";

export type EventCallback = (data: unknown) => void;

/**
 * Low-level WebSocket hook for the runner's event stream.
 *
 * Connects to ws://127.0.0.1:9876/ws/events and dispatches messages
 * to channel-based subscribers. Reconnects with exponential backoff.
 */
export function useRunnerEventStream(enabled: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Set<EventCallback>>>(new Map());
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const MAX_RECONNECT_ATTEMPTS = 10;
  const HEARTBEAT_INTERVAL = 30000;

  const notifySubscribers = useCallback((channel: string, data: unknown) => {
    const subs = subscribersRef.current.get(channel);
    if (subs) {
      subs.forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error(
            `[RunnerEventStream] Subscriber error on channel "${channel}":`,
            e
          );
        }
      });
    }
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: "ping" }));
        } catch {
          // Ignore send errors
        }
      }
    }, HEARTBEAT_INTERVAL);
  }, [stopHeartbeat]);

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    try {
      const ws = new WebSocket(RUNNER_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        startHeartbeat();

        // Notify all subscribers of reconnection so they can refresh data
        for (const channel of subscribersRef.current.keys()) {
          notifySubscribers(channel, { event_type: "__reconnected__" });
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);
          // Runner sends: { channel, payload: { event_type, data } }
          // or variations thereof
          const channel = msg.channel as string | undefined;
          const payload = msg.payload ?? msg.data ?? msg;

          if (channel) {
            notifySubscribers(channel, payload);
          }

          // Also notify a wildcard channel for global listeners
          notifySubscribers("*", { channel, payload });
        } catch {
          // Ignore parse errors (e.g. pong messages)
        }
      };

      ws.onerror = () => {
        // Error handling done in onclose
      };

      ws.onclose = (event) => {
        stopHeartbeat();

        const wasNormalClosure = event.code === 1000;
        if (
          enabledRef.current &&
          !wasNormalClosure &&
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current - 1),
            30000
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch {
      // Connection failed, will retry via onclose
    }
  }, [startHeartbeat, stopHeartbeat, notifySubscribers]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    stopHeartbeat();
    if (wsRef.current) {
      wsRef.current.close(1000, "Client disconnect");
      wsRef.current = null;
    }
  }, [stopHeartbeat]);

  const subscribe = useCallback(
    (channel: string, callback: EventCallback): (() => void) => {
      if (!subscribersRef.current.has(channel)) {
        subscribersRef.current.set(channel, new Set());
      }
      subscribersRef.current.get(channel)!.add(callback);

      return () => {
        const subs = subscribersRef.current.get(channel);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) {
            subscribersRef.current.delete(channel);
          }
        }
      };
    },
    []
  );

  // Connect/disconnect based on enabled + visibility
  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    connect();

    const handleVisibility = () => {
      if (document.hidden) {
        disconnect();
      } else {
        connect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return { subscribe };
}
