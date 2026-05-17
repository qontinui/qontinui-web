/**
 * Strategy Collaboration — Phase 2.4 WebSocket hook.
 *
 * Plan reference: `plans/2026-05-17-strategy-phase-2.md` §2.4.
 *
 * Single connection per page mount, multiplexed by channel name on the
 * client side. Routing rationale (plan §2.4):
 *
 *   Opening N WebSockets — one per channel pattern — would pin N
 *   coord-side Redis pubsub conns per browser tab. With one connection
 *   subscribed to `events.strategy.*` and a small client-side
 *   emitter, sub-components in the same route subtree share the
 *   wire.
 *
 * Coord URL resolution mirrors `MachineStatusTile.tsx:18` —
 * `NEXT_PUBLIC_COORD_WS_URL` envvar with a `ws://localhost:9870/ws`
 * fallback for local dev. The coord `/ws` route is anonymous (see
 * `qontinui-coord/src/routes.rs:138`) so no token is needed; the
 * heartbeat HTTP endpoint (cookie-authed via the web backend) carries
 * the user identity.
 *
 * Frame format (per `qontinui-coord/src/ws.rs:94-97`):
 *
 *   { "channel": "events.strategy.post.created.<thread_id>",
 *     "payload": "<json string requiring JSON.parse>" }
 *
 * `payload` is a string; structured payloads need `JSON.parse`. The
 * dispatcher below does that once and hands subscribers parsed objects.
 *
 * Reconnect-with-backoff: 500 ms → 1 s → 2 s → … capped at 30 s. Reset
 * to 500 ms on a successful reconnect (the `open` event).
 */

import { useEffect, useRef } from "react";

/** Coord WebSocket URL. `MachineStatusTile.tsx` uses the same env. */
export const COORD_WS_URL =
  process.env.NEXT_PUBLIC_COORD_WS_URL || "ws://localhost:9870/ws";

/** Pattern the strategy route mounts. Matches every Phase 2.x channel
 *  (`events.strategy.thread.*`, `events.strategy.post.*`,
 *  `events.strategy.mention.*`, `events.strategy.presence.aggregate.*`,
 *  …). Client-side dispatcher routes by channel name. */
export const STRATEGY_WS_PATTERN = "events.strategy.*";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/** One parsed frame from the WS. Coord delivers `payload` as a JSON
 *  STRING (per `ws.rs:96`); we parse it once so subscribers see the
 *  object. */
export interface StrategyFrame<T = unknown> {
  channel: string;
  payload: T;
}

export type StrategyMessageHandler = (frame: StrategyFrame) => void;

interface UseStrategyWebSocketOptions {
  /** Glob pattern. Defaults to `events.strategy.*` — the broadest
   *  filter that still excludes unrelated traffic. Tighter patterns
   *  are fine but mean the same browser tab needs N connections;
   *  the §2.4 design prefers one. */
  pattern?: string;
  /** Single dispatcher. Per-channel routing is the caller's job (use
   *  the included `createChannelDispatcher` helper). */
  onMessage: StrategyMessageHandler;
  /** Pause the connection without unmounting the component. Useful
   *  for tab-visibility-aware variants. Defaults to true. */
  enabled?: boolean;
  /** Test seam: override the WebSocket constructor. Defaults to
   *  `globalThis.WebSocket`. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Connect to coord's `/ws?pattern=<glob>` for the lifetime of the
 * calling component. Reconnects with exponential backoff on close /
 * error; resets backoff on successful (re)connect.
 *
 * Returns nothing — the hook owns the connection. Callers consume
 * frames via the `onMessage` prop and route by channel name in their
 * handler (or use `createChannelDispatcher` to compose).
 */
export function useStrategyWebSocket(
  options: UseStrategyWebSocketOptions,
): void {
  const {
    pattern = STRATEGY_WS_PATTERN,
    onMessage,
    enabled = true,
    WebSocketImpl,
  } = options;

  // Stable ref to the latest handler so we don't have to tear down
  // the connection on every render.
  const handlerRef = useRef<StrategyMessageHandler>(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;

    const WS = WebSocketImpl ?? globalThis.WebSocket;
    if (!WS) {
      // Environment without WebSocket (e.g. SSR before this is gated
      // by `"use client"`). Bail; the page won't have real-time
      // updates but won't crash.
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;
    // Latched on unmount so deferred reconnects don't accidentally
    // open a new socket after the component is gone.
    let cancelled = false;

    const url = `${COORD_WS_URL}?pattern=${encodeURIComponent(pattern)}`;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WS(url);
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        // Successful (re)connect — reset backoff.
        backoff = INITIAL_BACKOFF_MS;
      };
      ws.onmessage = (event) => {
        let frame: StrategyFrame;
        try {
          const envelope = JSON.parse(event.data as string) as {
            channel: string;
            payload: string;
          };
          // `ws.rs:96` always sends payload as a JSON string; parse
          // it once so subscribers see structured data.
          let parsed: unknown;
          try {
            parsed = JSON.parse(envelope.payload);
          } catch {
            // Non-JSON payloads (theoretically possible if a future
            // publisher writes a raw string) pass through verbatim.
            parsed = envelope.payload;
          }
          frame = { channel: envelope.channel, payload: parsed };
        } catch {
          return;
        }
        handlerRef.current(frame);
      };
      ws.onerror = () => {
        // Errors precede a close; let onclose schedule the retry.
      };
      ws.onclose = () => {
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        connect();
      }, backoff);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        // Detach handlers BEFORE close so a synchronous onclose firing
        // doesn't schedule a stale reconnect.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
    };
  }, [pattern, enabled, WebSocketImpl]);
}

/**
 * Build a dispatcher that routes incoming frames by channel-name
 * predicate. Callers register handlers per-channel-pattern; the
 * returned function plugs into `useStrategyWebSocket`'s `onMessage`.
 *
 * Channel patterns are simple prefix matches (mirrors Redis glob
 * semantics for the `*`-style strategy events we publish). Pass
 * `"events.strategy.post.created."` to receive every post-created
 * event regardless of `thread_id`.
 */
export function createChannelDispatcher(
  routes: Array<{ prefix: string; handler: (frame: StrategyFrame) => void }>,
): StrategyMessageHandler {
  return (frame) => {
    for (const route of routes) {
      if (frame.channel.startsWith(route.prefix)) {
        route.handler(frame);
      }
    }
  };
}
