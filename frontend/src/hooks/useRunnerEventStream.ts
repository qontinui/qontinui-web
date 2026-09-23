"use client";

import { useRef, useCallback, useEffect } from "react";
import { routeOfTarget, type RunnerTarget } from "@/lib/runner/target";

/**
 * The event-stream WebSocket URL for a target, or null when there is none.
 *
 * `/ws/events` is a WebSocket and cannot ride the relay (the relay is
 * request/response HTTP and the runner's `RELAY_ALLOWED` carries no `/ws/*`
 * route), so a socket exists ONLY for a target whose route is loopback — a
 * runner proven to be on this machine, or the empty-list default. Built from
 * the resolved target's own base, never from a global. Spelled 127.0.0.1: the
 * runner binds IPv4 only.
 */
export function runnerEventStreamUrl(target: RunnerTarget): string | null {
  const route = routeOfTarget(target);
  if (route.kind !== "loopback") return null;
  try {
    return `ws://127.0.0.1:${new URL(route.base).port}/ws/events`;
  } catch {
    return null;
  }
}

/**
 * Whether the event stream can deliver anything.
 *
 * - `live`        — a loopback socket is (being) opened.
 * - `unavailable` — no socket can exist for this target (a relayed runner, or
 *                   no runner resolved): subscribers will receive NOTHING, and
 *                   must treat the stream as UNKNOWN and fall back to polling,
 *                   never read silence as "no events".
 */
export type RunnerEventStreamState = "live" | "unavailable";

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
 * Connects to ws://127.0.0.1:<port>/ws/events of the TARGET's loopback route
 * and dispatches messages to channel-based subscribers. Reconnects with
 * exponential backoff, and re-connects when the target's URL changes. For a
 * target with no loopback route no socket is opened and `state` is
 * `unavailable`.
 *
 * Includes subscriber leak protection: callbacks are tagged with an ID
 * so that re-subscriptions from the same hook instance (e.g. during HMR)
 * replace the previous callback instead of accumulating.
 */
export function useRunnerEventStream(
  target: RunnerTarget,
  enabled: boolean = true
): {
  subscribe: (
    channel: string,
    callback: EventCallback,
    subscriberId?: string
  ) => () => void;
  state: RunnerEventStreamState;
} {
  const wsUrl = runnerEventStreamUrl(target);
  const wsUrlRef = useRef(wsUrl);
  wsUrlRef.current = wsUrl;
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

    const url = wsUrlRef.current;
    if (url === null) return;

    try {
      const ws = new WebSocket(url);
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

  // Connect/disconnect based on enabled + visibility + the target's URL: a
  // changed URL (another runner, or a loopback route appearing/disappearing)
  // tears the old socket down and opens the new one.
  useEffect(() => {
    if (!enabled || wsUrl === null) {
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
  }, [enabled, wsUrl, connect, disconnect]);

  return { subscribe, state: wsUrl === null ? "unavailable" : "live" };
}
