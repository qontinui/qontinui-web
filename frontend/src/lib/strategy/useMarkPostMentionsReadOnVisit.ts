/**
 * Strategy Collaboration — Phase 2.5 hook.
 *
 * When the user lands on `/strategy/<doc>?post=<post_id>` via a
 * mention deep-link, fire a single bulk mark-read so EVERY unread
 * mention they have on that post is cleared in one round-trip. The
 * dropdown's optimistic single-mention update only handles the row
 * the user clicked; this catches the rest (e.g. multiple mentions
 * on the same post).
 *
 * Wraps `markPostMentionsRead` so the page-level useEffect stays
 * declarative and the hook is unit-testable without rendering the
 * full doc page (which pulls in ReactMarkdown + presence + comments).
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { markPostMentionsRead } from "@/lib/api/strategy";

const UNREAD_QUERY_KEY = ["strategy", "mentions", "unread"] as const;

export function useMarkPostMentionsReadOnVisit(postId: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    markPostMentionsRead(postId)
      .then((n) => {
        if (cancelled) return;
        if (n > 0) {
          queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY });
        }
      })
      .catch(() => {
        // Best-effort: a 503 (strategy disabled) or stale post_id
        // shouldn't break the doc view. Badge will self-correct on
        // the 60s poll.
      });
    return () => {
      cancelled = true;
    };
  }, [postId, queryClient]);
}
