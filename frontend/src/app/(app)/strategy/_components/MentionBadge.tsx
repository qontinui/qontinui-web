"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { listUnreadMentions, type StrategyMention } from "@/lib/api/strategy";

/**
 * Read-only badge surfacing the current user's unread mention count.
 *
 * Phase 2.3 exports this for Phase 2.5 to compose into the app shell.
 * No WS subscription — the badge polls every 60s as a degraded
 * fallback until Phase 2.4 wires real-time `events.strategy.mention.*`.
 *
 * Hidden when count is 0 unless `alwaysShow` is set.
 */
export interface MentionBadgeProps {
  alwaysShow?: boolean;
  className?: string;
}

const REFRESH_INTERVAL_MS = 60_000;

export function MentionBadge({
  alwaysShow = false,
  className,
}: MentionBadgeProps) {
  const { data = [] } = useQuery<StrategyMention[]>({
    queryKey: ["strategy", "mentions", "unread"],
    queryFn: listUnreadMentions,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const count = data.length;
  if (count === 0 && !alwaysShow) return null;

  return (
    <span
      data-testid="mention-badge"
      className={cn(
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground",
        className
      )}
      aria-label={`${count} unread mention${count === 1 ? "" : "s"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
