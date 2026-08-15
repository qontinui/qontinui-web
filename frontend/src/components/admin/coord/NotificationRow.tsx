"use client";

/**
 * NotificationRow — one `coord.notifications` event, one plain-language line.
 *
 * Plan `2026-08-05-coord-notifications-type-and-tab.md` Change 4, per the
 * SHARED UI CONVENTIONS in the sibling alerts plan: one row per event, one
 * scannable sentence, detail behind the click, and **no UUID in the default
 * view** (the id lives in the expanded panel, where it is a paste target).
 *
 * The row is a button so the whole line is the expand affordance — matching
 * `MergePipeline`'s `PipelineRowDisplay`. Detail is conditionally rendered,
 * so collapsing unmounts it rather than hiding it.
 *
 * Read state is the only row state: unread rows carry a dot and normal
 * foreground weight, read rows dim. There is no severity here — an event that
 * happened is not a condition that is true.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/components/operations/utils";
import {
  type CoordNotificationRow,
  detailActor,
  humanKind,
  isUnread,
  notificationHeadline,
  notificationSubject,
} from "./notificationStatus";

/** Absent/unparseable timestamps render as UNKNOWN, never as a blank. */
const TIME_UNKNOWN = "time unknown";

function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return TIME_UNKNOWN;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? TIME_UNKNOWN : d.toLocaleString();
}

/**
 * The row's relative time.
 *
 * `relativeTime` answers "never" for a null input, which is the right word for
 * a *last-seen* field and the wrong one here: a notification is an event that
 * by definition happened, so "never occurred" is a contradiction, and it also
 * disagreed with the tooltip's "time unknown" on the very same element. Both
 * now say UNKNOWN — a missing `occurred_at` is a payload gap, not a fact about
 * the world.
 */
function rowTimeLabel(iso: string | null | undefined): string {
  if (!iso) return TIME_UNKNOWN;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? TIME_UNKNOWN : relativeTime(iso);
}

/** Detail payload as label/value pairs. Objects and arrays are JSON-rendered
 *  rather than dropped — this panel is the debugging surface. */
function DetailEntries({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground truncate">{k}</dt>
          <dd className="break-words text-foreground/90">
            {typeof v === "object" && v !== null
              ? JSON.stringify(v)
              : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function NotificationRow({
  notification,
  expanded,
  onToggle,
  onMarkRead,
  markPending = false,
}: {
  notification: CoordNotificationRow;
  expanded: boolean;
  onToggle: () => void;
  onMarkRead: () => void;
  markPending?: boolean;
}) {
  const unread = isUnread(notification);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const subject = notificationSubject(notification);
  const actor = detailActor(notification);

  return (
    <div
      data-testid="coord-notification-row"
      data-notification-kind={notification.kind}
      data-notification-unread={unread ? "true" : "false"}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-border bg-card/30 pr-2 transition-colors",
          expanded && "rounded-b-none bg-accent/60",
          !unread && "opacity-70"
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-accent/60 rounded-l-md"
        >
          <span
            aria-hidden
            data-testid="coord-notification-unread-dot"
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              unread ? "bg-primary" : "bg-transparent"
            )}
          />
          <Badge variant="outline" className="shrink-0 text-xs">
            {humanKind(notification.kind)}
          </Badge>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              unread ? "text-foreground" : "text-muted-foreground"
            )}
            data-testid="coord-notification-summary"
          >
            {notificationHeadline(notification)}
          </span>
          {subject && (
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {subject}
            </span>
          )}
          <span
            data-testid="row-time"
            title={absoluteTime(notification.occurred_at)}
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            {rowTimeLabel(notification.occurred_at)}
          </span>
          <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
        {unread && (
          // Outside the toggle button — nesting a button inside a button is
          // invalid HTML and the click would fold the row instead of marking.
          <Button
            variant="ghost"
            size="sm"
            onClick={onMarkRead}
            disabled={markPending}
            title="Mark read"
            data-testid="coord-notification-mark-read"
            className="h-7 shrink-0 px-2"
          >
            <Check className="h-3 w-3" />
          </Button>
        )}
      </div>
      {expanded && (
        <div
          data-testid="coord-notification-detail"
          className="space-y-2 rounded-b-md border border-t-0 border-border bg-card/20 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{absoluteTime(notification.occurred_at)}</span>
            {actor && <span>by {actor}</span>}
            {notification.read_at && (
              <span>read {relativeTime(notification.read_at)}</span>
            )}
          </div>
          {notification.detail &&
            Object.keys(notification.detail).length > 0 && (
              <DetailEntries detail={notification.detail} />
            )}
          {notification.repo && (
            <div className="text-xs">
              <a
                href={
                  notification.pr_number != null
                    ? `https://github.com/${notification.repo}/pull/${notification.pr_number}`
                    : `https://github.com/${notification.repo}`
                }
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
                data-testid="coord-notification-link"
              >
                {notification.pr_number != null
                  ? `${notification.repo}#${notification.pr_number} on GitHub`
                  : `${notification.repo} on GitHub`}
              </a>
            </div>
          )}
          {/* The only place ids are allowed: expanded, and actionable — what
              you paste into a coord query or a bug report. `device_id` is a
              first-class column on `coord.notifications` specifically so it
              can be surfaced HERE rather than smuggled into `summary`. */}
          <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground/70">
            <dt>notification_id</dt>
            <dd className="break-all" data-testid="coord-notification-id">
              {notification.notification_id}
            </dd>
            {notification.device_id && (
              <>
                <dt>device_id</dt>
                <dd
                  className="break-all"
                  data-testid="coord-notification-device-id"
                >
                  {notification.device_id}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
