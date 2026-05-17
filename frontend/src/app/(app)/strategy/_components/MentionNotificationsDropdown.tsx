"use client";

/**
 * Strategy Collaboration — Phase 2.5 MentionNotificationsDropdown.
 *
 * Plan reference: `plans/2026-05-17-strategy-phase-2.md` §2.5.
 *
 * Bell icon in the app-shell (sidebar footer). Clicking opens a
 * dropdown of the current user's unread mentions; clicking a mention
 * navigates to the mentioning post + marks that single mention read.
 *
 * Real-time:
 *
 *   - The badge count updates via `MentionRealtimeSubscriber` (mounted
 *     once per session in the app-shell), which listens for
 *     `events.strategy.mention.created.<my_user_id>` on the existing
 *     multiplexed coord WebSocket and invalidates the unread-mentions
 *     query.
 *   - Cache shape mirrors the Phase 2.3 `<MentionBadge>` query key
 *     (`["strategy", "mentions", "unread"]`) so both surfaces share a
 *     single round-trip per refresh.
 *
 * Mark-as-read:
 *
 *   - Click a single mention → optimistic remove + `markMentionRead`.
 *     The bulk-on-visit codepath (`markPostMentionsRead`) is wired in
 *     `[doc]/page.tsx` so the deep-link nav also clears every other
 *     unread mention on the same post.
 */

import React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Inbox } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  listUnreadMentions,
  markMentionRead,
  type StrategyMention,
} from "@/lib/api/strategy";

const REFRESH_INTERVAL_MS = 60_000;
const MAX_VISIBLE = 10;
const MENTIONS_QUERY_KEY = ["strategy", "mentions", "unread"] as const;

interface MentionNotificationsDropdownProps {
  /** Show the trigger as a compact icon-only button (sidebar collapsed). */
  isCollapsed?: boolean;
  className?: string;
  /** Test seam: force the dropdown open (Radix `DropdownMenu.Root`
   *  doesn't pop its `Portal` content in jsdom without a real
   *  pointer-event sequence, so tests render `defaultOpen` to verify
   *  list/empty state markup). */
  defaultOpen?: boolean;
}

export function MentionNotificationsDropdown({
  isCollapsed = false,
  className,
  defaultOpen,
}: MentionNotificationsDropdownProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: mentions = [] } = useQuery<StrategyMention[]>({
    queryKey: MENTIONS_QUERY_KEY,
    queryFn: listUnreadMentions,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const markRead = useMutation({
    mutationFn: (mentionId: string) => markMentionRead(mentionId),
    onMutate: async (mentionId) => {
      await queryClient.cancelQueries({ queryKey: MENTIONS_QUERY_KEY });
      const prev =
        queryClient.getQueryData<StrategyMention[]>(MENTIONS_QUERY_KEY) ?? [];
      queryClient.setQueryData<StrategyMention[]>(
        MENTIONS_QUERY_KEY,
        prev.filter((m) => m.mention_id !== mentionId)
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(MENTIONS_QUERY_KEY, ctx.prev);
      }
      toast.error("Couldn't mark mention as read");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: MENTIONS_QUERY_KEY });
    },
  });

  const count = mentions.length;
  const visible = mentions.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, count - MAX_VISIBLE);

  const handleSelect = (mention: StrategyMention) => {
    // Optimistically clear this single mention; the doc-visit path
    // then bulk-clears every other mention for the same post.
    markRead.mutate(mention.mention_id);

    // Build the destination URL. We only have post_id / thread_id —
    // the `[doc]/page.tsx` reads `?post=<post_id>` on mount. The doc
    // route requires `doc_name`; we surface coord's `doc_name`
    // enrichment when present and fall back to the per-post deep-link
    // resolver `/strategy/_jump?post=<post_id>` only if coord didn't
    // ship enrichment.
    const docName = (mention as StrategyMention & { doc_name?: string })
      .doc_name;
    if (docName) {
      router.push(
        `/strategy/${encodeURIComponent(docName)}?post=${encodeURIComponent(
          mention.post_id
        )}&thread=${encodeURIComponent(mention.thread_id ?? "")}`
      );
    } else {
      // No doc_name → toast so the user knows the link is incomplete
      // (and we don't no-op silently). Coord enrichment lands in the
      // dropdown payload once Phase 2.5+ wires it; until then we still
      // mark-read so the badge clears.
      toast.message("Mention marked read", {
        description: "Open the doc from the sidebar to view the thread.",
      });
    }
  };

  const trigger = (
    <button
      type="button"
      data-testid="mention-notifications-trigger"
      aria-label={
        count === 0
          ? "No unread mentions"
          : `${count} unread mention${count === 1 ? "" : "s"}`
      }
      className={cn(
        "relative inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-hover",
        isCollapsed ? "size-10" : "size-8",
        className
      )}
    >
      <Bell className={cn(isCollapsed ? "size-5" : "size-4")} />
      {count > 0 && (
        <span
          data-testid="mention-notifications-badge"
          className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      {isCollapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Mentions</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent
        align="end"
        side={isCollapsed ? "right" : "top"}
        className="w-80 max-h-[28rem] overflow-y-auto"
        data-testid="mention-notifications-content"
      >
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Mentions</span>
          <span className="text-xs font-normal text-text-muted">
            {count === 0
              ? "no unread"
              : `${count} unread`}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {count === 0 ? (
          <div
            className="flex flex-col items-center gap-2 px-3 py-6 text-center text-xs text-text-muted"
            data-testid="mention-notifications-empty"
          >
            <Inbox className="size-6 opacity-50" />
            <span>You&rsquo;re all caught up.</span>
          </div>
        ) : (
          <ul data-testid="mention-notifications-list">
            {visible.map((m) => (
              <MentionRow
                key={m.mention_id}
                mention={m}
                onSelect={() => handleSelect(m)}
              />
            ))}
            {overflow > 0 && (
              <li className="px-3 py-2 text-center text-xs text-text-muted">
                +{overflow} more — open a doc to clear them
              </li>
            )}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MentionRow({
  mention,
  onSelect,
}: {
  mention: StrategyMention;
  onSelect: () => void;
}) {
  const enriched = mention as StrategyMention & {
    doc_name?: string;
    post_excerpt?: string;
  };
  const title = enriched.thread_title ?? "Strategy thread";
  const where = enriched.doc_name ?? "";
  const excerpt = enriched.post_excerpt ?? "";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        data-testid={`mention-notifications-item-${mention.mention_id}`}
        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
      >
        <div className="font-medium truncate">{title}</div>
        {excerpt && (
          <div className="mt-0.5 line-clamp-2 text-xs text-text-muted">
            {excerpt}
          </div>
        )}
        <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
          {where && <span className="truncate">{where}</span>}
          <span className="shrink-0">{formatRelative(mention.created_at)}</span>
        </div>
      </button>
    </li>
  );
}

/**
 * Tiny relative-time formatter. Avoids pulling in `date-fns` for
 * three rendering surfaces (dropdown row, doc viewer, post listing).
 * Boundaries match Slack/Linear conventions.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffS = Math.max(0, (Date.now() - then) / 1000);
  if (diffS < 60) return "just now";
  if (diffS < 60 * 60) return `${Math.floor(diffS / 60)} min ago`;
  if (diffS < 60 * 60 * 24) return `${Math.floor(diffS / 3600)} h ago`;
  const days = Math.floor(diffS / 86400);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}
