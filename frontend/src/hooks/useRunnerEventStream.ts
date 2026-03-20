"use client";

import { useRef, useCallback, useEffect } from "react";
import {
  getRunnerApiBase,
  onRunnerApiBaseChange,
} from "@/lib/runner/api-client";

// Derive the runner WebSocket URL from the current API base.
// Uses 127.0.0.1 to force IPv4 (runner only listens on IPv4).
function getRunnerWsUrl(): string {
  const base = getRunnerApiBase(); // e.g. "http://localhost:9876"
  // Extract port from the base URL
  try {
    const url = new URL(base);
    return `ws://127.0.0.1:${url.port}/ws/events`;
  } catch {
    return "ws://127.0.0.1:9876/ws/events";
  }
}

export type EventCallback = (data: unknown) => void;

/** Tagged callback for subscriber leak detection */
interface TaggedCallback {
  cb: EventCallback;
  id: string;
}

const MAX_SUBSCRIBERS_PER_CHANNEL = 50;

/**
 * Low-level WebSocket hook for the runner's event stream.
 *
 * Connects to ws://127.0.0.1:9876/ws/events and dispatches messages
 * to channel-based subscribers. Reconnects with exponential backoff.
 *
 * Includes subscriber leak protection: callbacks are tagged with an ID
 * so that re-subscriptions from the same hook instance (e.g. during HMR)
 * replace the previous callback instead of accumulating.
 */
export function useRunnerEventStream(enabled: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Map<string, TaggedCallback>>>(
    new Map()
  );
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
      subs.forEach((tagged) => {
        try {
          tagged.cb(data);
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

    // Reset reconnect counter so manual reconnects and visibility-triggered
    // reconnects start fresh instead of permanently giving up after exhaustion.
    reconnectAttemptsRef.current = 0;

    try {
      const ws = new WebSocket(getRunnerWsUrl());
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
    (
      channel: string,
      callback: EventCallback,
      /** Optional stable ID — re-subscribing with the same ID replaces the previous callback (prevents HMR leaks) */
      subscriberId?: string
    ): (() => void) => {
      if (!subscribersRef.current.has(channel)) {
        subscribersRef.current.set(channel, new Map());
      }
      const channelSubs = subscribersRef.current.get(channel)!;
      const id =
        subscriberId ??
        `anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Replace previous callback with same ID (prevents HMR double-subscribe)
      channelSubs.set(id, { cb: callback, id });

      if (channelSubs.size > MAX_SUBSCRIBERS_PER_CHANNEL) {
        console.warn(
          `[RunnerEventStream] Channel "${channel}" has ${channelSubs.size} subscribers — possible leak`
        );
      }

      return () => {
        const subs = subscribersRef.current.get(channel);
        if (subs) {
          subs.delete(id);
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

  // Reconnect when the active runner's API base URL changes
  useEffect(() => {
    const unsubscribe = onRunnerApiBaseChange(() => {
      if (enabledRef.current) {
        disconnect();
        // Brief delay so the new base URL is fully settled before connecting
        setTimeout(() => connect(), 50);
      }
    });
    return unsubscribe;
  }, [connect, disconnect]);

  return { subscribe };
}
