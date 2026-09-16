/**
 * Strategy Collaboration — Phase 2.4 WebSocket hook.
 *
 * Plan reference: `plans/2026-05-17-strategy-phase-2.md` §2.4.
 *
 * Single connection per hook instance, multiplexed by channel name on
 * the client side. Routing rationale (plan §2.4):
 *
 *   Opening N WebSockets — one per channel pattern — would pin N
 *   coord-side Redis pubsub conns per browser tab. With one connection
 *   subscribed to `events.strategy.*` and a small client-side
 *   emitter, sub-components in the same route subtree share the
 *   wire.
 *
 * Transport: the web backend's coord-events bridge,
 * `WS /api/v1/operations/coord-events/ws?subscribe=strategy&token=<jwt>`
 * (`coordEventsWsUrl`). Coord's generic `/ws` verifies a credential at
 * the upgrade and takes a CLOSED set of named subscriptions — a browser
 * holds no coord credential, so the backend authenticates the operator
 * from the same session token every other operations WS uses, mints a
 * tenant-scoped coord service JWT, and relays frames. The hook used to
 * dial coord directly on `NEXT_PUBLIC_COORD_WS_URL` with a caller-chosen
 * `?pattern=` glob; both are gone (plan
 * `2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose`
 * Phase 2).
 *
 * Because the bridge's subscription set has no per-user or per-doc
 * names, `subscribe=strategy` (→ `events.strategy.*` server-side) covers
 * every strategy channel, and the caller's `pattern` is applied HERE as a
 * client-side filter with Redis PSUBSCRIBE glob semantics (`*` spans
 * `.`; see `matchesChannelPattern`). `MentionRealtimeSubscriber`'s
 * `events.strategy.mention.created.<userId>` and `PresenceIndicator`'s
 * `events.strategy.presence.aggregate.<docId>` therefore still see only
 * their own frames — the filter moved from Redis to the hook, and the
 * callers did not change.
 *
 * Frame format (per `qontinui-coord/src/ws.rs`), forwarded verbatim by
 * the bridge:
 *
 *   { "channel": "events.strategy.post.created.<thread_id>",
 *     "payload": "<json string requiring JSON.parse>" }
 *
 * `payload` is a string; structured payloads need `JSON.parse`. The
 * dispatcher below does that once and hands subscribers parsed objects.
 *
 * Reconnect-with-backoff: 500 ms → 1 s → 2 s → … capped at 30 s. Reset
 * to 500 ms on a successful reconnect (the `open` event). A fresh session
 * token is fetched on every (re)connect, so an expiring token never
 * strands the socket: the next flap presents a live one.
 */

import { useEffect, useRef } from "react";
import { httpClient } from "@/services/service-factory";
import { coordEventsWsUrl } from "@/components/operations/utils";

/** The bridge subscription every strategy hook instance opens. */
export const STRATEGY_SUBSCRIPTION = "strategy" as const;

/** Default client-side filter. Matches every Phase 2.x channel
 *  (`events.strategy.thread.*`, `events.strategy.post.*`,
 *  `events.strategy.mention.*`, `events.strategy.presence.aggregate.*`,
 *  …) — which is also exactly what the bridge's `strategy` subscription
 *  delivers, so the default filter drops nothing. */
export const STRATEGY_WS_PATTERN = "events.strategy.*";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/** One parsed frame from the WS. Coord delivers `payload` as a JSON
 *  STRING (per `ws.rs`); we parse it once so subscribers see the
 *  object. */
export interface StrategyFrame<T = unknown> {
  channel: string;
  payload: T;
}

export type StrategyMessageHandler = (frame: StrategyFrame) => void;

/**
 * Redis PSUBSCRIBE glob → anchored RegExp. `*` matches any run of
 * characters INCLUDING `.` (Redis has no segment notion — this is what
 * lets `events.strategy.*` cover `events.strategy.post.created.<id>`),
 * `?` matches exactly one character, everything else is literal. Redis
 * also has `[...]` classes; no strategy pattern uses them, so they are
 * treated literally rather than half-implemented.
 */
function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const ch of pattern) {
    if (ch === "*") source += ".*";
    else if (ch === "?") source += ".";
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(source + "$");
}

/** Compiled patterns, keyed by source. Patterns embed doc and user ids, so
 *  a long SPA session accumulates one entry per distinct doc visited; the
 *  cap keeps that growth bounded — on overflow the map is cleared, which
 *  costs one recompile per live pattern and nothing else. */
const COMPILED_PATTERN_CAP = 64;
const compiledPatterns = new Map<string, RegExp>();

/**
 * Does `channel` match the Redis-style `pattern`? The client-side stand-in
 * for the PSUBSCRIBE filter coord used to apply per socket — and the ONE
 * function the hook routes every frame through, so what the unit tests
 * pin is what runs.
 */
export function matchesChannelPattern(
  pattern: string,
  channel: string,
): boolean {
  let re = compiledPatterns.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    if (compiledPatterns.size >= COMPILED_PATTERN_CAP) compiledPatterns.clear();
    compiledPatterns.set(pattern, re);
  }
  return re.test(channel);
}

interface UseStrategyWebSocketOptions {
  /** Client-side channel filter, Redis glob semantics. Defaults to
   *  `events.strategy.*`, which passes everything the bridge delivers.
   *  Tighter patterns (a single user's mentions, a single doc's
   *  presence) filter locally; the socket itself is always the one
   *  `strategy` subscription. */
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
  /** Test seam: override the session-token source. Defaults to
   *  `httpClient.getWebSocketToken` — the client-held bearer when
   *  present, else the cookie-reading `/api/v1/ws-token` route. */
  getToken?: () => Promise<string | null>;
}

const defaultGetToken = (): Promise<string | null> =>
  httpClient.getWebSocketToken();

/**
 * Hold one bridge socket (`subscribe=strategy`) for the lifetime of the
 * calling component and hand it every frame whose channel matches
 * `pattern`. Reconnects with exponential backoff on close / error /
 * missing token; resets backoff on successful (re)connect.
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
    getToken,
  } = options;

  // Stable refs to the latest handler, filter and token source so we
  // don't tear down the connection on every render — and, for the
  // filter, so a pattern change re-filters the SAME socket rather than
  // reconnecting (the subscription is the same either way).
  const handlerRef = useRef<StrategyMessageHandler>(onMessage);
  handlerRef.current = onMessage;
  const patternRef = useRef<string>(pattern);
  patternRef.current = pattern;
  const getTokenRef = useRef<() => Promise<string | null>>(
    getToken ?? defaultGetToken,
  );
  getTokenRef.current = getToken ?? defaultGetToken;

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
    // Latched on unmount so deferred reconnects (and a token fetch still
    // in flight) don't open a new socket after the component is gone.
    let cancelled = false;
    // Each connect attempt awaits its token; an attempt overtaken by a
    // later one while it waited must create nothing.
    let connectGen = 0;

    const connect = () => {
      if (cancelled) return;
      const attempt = ++connectGen;
      getTokenRef.current().then(
        (token) => {
          if (cancelled || attempt !== connectGen) return;
          if (!token) {
            // No session yet (auth still loading, or signed out). Retry
            // on the same ladder; the bridge refuses without a token.
            scheduleReconnect();
            return;
          }
          open(coordEventsWsUrl(STRATEGY_SUBSCRIPTION, token));
        },
        () => {
          if (!cancelled && attempt === connectGen) scheduleReconnect();
        },
      );
    };

    const open = (url: string) => {
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
          if (typeof envelope.channel !== "string") return;
          // The bridge delivers every `events.strategy.*` frame; the
          // caller's pattern is applied here.
          if (!matchesChannelPattern(patternRef.current, envelope.channel)) {
            return;
          }
          // `ws.rs` always sends payload as a JSON string; parse it once
          // so subscribers see structured data.
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
      if (cancelled || reconnectTimer) return;
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
  }, [enabled, WebSocketImpl]);
}

/**
 * Build a dispatcher that routes incoming frames by channel-name
 * predicate. Callers register handlers per-channel-pattern; the
 * returned function plugs into `useStrategyWebSocket`'s `onMessage`.
 *
 * Channel patterns are simple prefix matches (a prefix is the
 * `<literal>*` special case of the Redis glob the hook's own filter
 * uses). Pass `"events.strategy.post.created."` to receive every
 * post-created event regardless of `thread_id`.
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
