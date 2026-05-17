"use client";

/**
 * Strategy Collaboration — Phase 2.5 MentionRealtimeSubscriber.
 *
 * Mounted ONCE at app-shell level (sibling of the bell dropdown).
 * Subscribes to `events.strategy.mention.created.<my_user_id>` on
 * coord's multiplexed `/ws` and invalidates the unread-mentions
 * React Query cache on every matching frame. The dropdown's existing
 * query then re-fetches via the same code path the polling refresh
 * already used, so the badge count updates without a page refresh.
 *
 * Headless (renders null). Splitting render from data lets the
 * subscriber live in the app shell while the dropdown itself sits in
 * the sidebar footer — both share the React Query cache.
 *
 * Channel pattern: the WS hook subscribes to a tight
 * `events.strategy.mention.created.<my_user_id>` glob. Per the plan
 * §2.5 sub-task 4, per-user PSUBSCRIBE patterns are scoped server-
 * side via Redis glob — no risk of cross-user leakage. The
 * client-side dispatcher does a defensive prefix check too in case
 * coord one day broadens the relay filter.
 */

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  useStrategyWebSocket,
  createChannelDispatcher,
} from "@/lib/strategy/useStrategyWebSocket";

interface MentionRealtimeSubscriberProps {
  /** Current user UUID. `null` while auth is loading — the subscriber
   *  renders nothing (and doesn't open a WS) until the user is known. */
  userId: string | null;
  /** Test seam: override the WebSocket constructor. */
  WebSocketImpl?: typeof WebSocket;
}

export function MentionRealtimeSubscriber({
  userId,
  WebSocketImpl,
}: MentionRealtimeSubscriberProps) {
  const queryClient = useQueryClient();

  const onMessage = useMemo(
    () =>
      createChannelDispatcher([
        {
          // Defensive prefix-match — coord-side PSUBSCRIBE pattern
          // should already scope to this user, but the dispatcher
          // confirms once more so a broader pattern wouldn't leak.
          prefix: `events.strategy.mention.created.${userId ?? ""}`,
          handler: () => {
            // The frame carries `{mention_id, post_id, mentioned_user_id, created_at}`
            // (see qontinui-coord/src/strategy_threads.rs:574-582). We
            // could optimistically prepend it, but the response is
            // missing the enriched fields (doc_name, thread_title,
            // post_excerpt) the dropdown wants — so just invalidate
            // and let the next refetch carry the canonical row.
            queryClient.invalidateQueries({
              queryKey: ["strategy", "mentions", "unread"],
            });
          },
        },
      ]),
    [userId, queryClient]
  );

  useStrategyWebSocket({
    // Tighten the pattern to only this user's mentions so the WS
    // server doesn't fan out unrelated traffic to this tab. The
    // dispatcher above is a defensive secondary filter.
    pattern: userId
      ? `events.strategy.mention.created.${userId}`
      : "events.strategy.mention.created.*",
    onMessage,
    enabled: !!userId,
    WebSocketImpl,
  });

  return null;
}
