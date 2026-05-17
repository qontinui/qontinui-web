"use client";

/**
 * Strategy Collaboration — Phase 2.4 PresenceIndicator.
 *
 * Plan reference: `plans/2026-05-17-strategy-phase-2.md` §2.4.
 *
 * Subscribes to `events.strategy.presence.aggregate.<docId>` via the
 * Phase 2.4 strategy WebSocket. Renders a small badge with the
 * current viewer count. Hides when count <= 1 (the viewer themselves
 * doesn't count as company); shows "👥 N viewing" otherwise.
 *
 * The aggregator emits one event per doc per count-delta — never on
 * every heartbeat — so this component only re-renders on real change.
 */

import { useEffect, useMemo, useState } from "react";
import {
  useStrategyWebSocket,
  createChannelDispatcher,
  type StrategyFrame,
} from "@/lib/strategy/useStrategyWebSocket";

interface AggregatePayload {
  doc_id: string;
  count: number;
  users: string[];
}

interface PresenceIndicatorProps {
  /** Canonical UUID for this doc. `null` while the first heartbeat
   *  is in flight — the indicator renders nothing until coord echoes
   *  the doc_id back. */
  docId: string | null;
  /** Test seam: override the WebSocket constructor. */
  WebSocketImpl?: typeof WebSocket;
}

export function PresenceIndicator({
  docId,
  WebSocketImpl,
}: PresenceIndicatorProps) {
  const [count, setCount] = useState(0);

  // Reset count when docId changes (navigation between docs).
  useEffect(() => {
    setCount(0);
  }, [docId]);

  const onMessage = useMemo(
    () =>
      createChannelDispatcher([
        {
          // Aggregate channel for THIS doc. Prefix-match — coord
          // pubsub guarantees the only suffix here is the literal
          // `docId`. Frame payload was JSON.parsed by the WS hook.
          prefix: `events.strategy.presence.aggregate.${docId ?? ""}`,
          handler: (frame: StrategyFrame) => {
            const payload = frame.payload as AggregatePayload;
            if (
              typeof payload?.count === "number" &&
              payload?.doc_id === docId
            ) {
              setCount(payload.count);
            }
          },
        },
      ]),
    [docId],
  );

  useStrategyWebSocket({
    pattern: docId
      ? `events.strategy.presence.aggregate.${docId}`
      : "events.strategy.presence.aggregate.*",
    onMessage,
    enabled: !!docId,
    WebSocketImpl,
  });

  // <=1 means "just me or nobody" — no point showing a badge. Also
  // suppress while doc_id is unresolved.
  if (!docId || count <= 1) return null;

  return (
    <span
      role="status"
      aria-label={`${count} viewers`}
      data-testid="presence-indicator"
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
    >
      <span aria-hidden="true">👥</span>
      {count} viewing
    </span>
  );
}
