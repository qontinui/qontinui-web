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
 *
 * ## Console primitives (Phase 3 Wave 5)
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` moved this
 * onto `<RecordRow>` / `<RecordDetail>`. It was ALREADY row-shaped and already
 * expanded in place — it landed from a sibling plan built to the same
 * conventions — so nothing about the shape changed. What changed is that it is
 * now the shared implementation rather than a second copy of it: the guide's
 * §6.4 rule is *a console page adds no new visual vocabulary; it composes
 * primitives*, and a hand-rolled row that merely happens to agree is exactly
 * the drift `statusRow.tsx`'s own module doc records ("two surfaces sharing
 * one PARAGRAPH had already drifted; two surfaces sharing one IMPLEMENTATION
 * cannot").
 *
 * **`<RecordRow>` has no status slot filled here, deliberately.** R3's palette
 * answers "who must act", and the answer for an append-only event feed is
 * "nobody" on every row. Painting a hue would spend the vocabulary on
 * something that is not a condition — so this surface ships no kind→attention
 * table, and there is nothing for `paletteDisagreements` to audit.
 *
 * **The mark-read button is a SIBLING of the row, not a slot inside it**, for
 * the reason the previous implementation already recorded: `<RecordRow>`
 * renders the whole line as one `<button>`, and a button nested in a button is
 * invalid HTML whose click would fold the row instead of marking it read.
 *
 * Every authored `data-testid` is carried across unchanged (D4a):
 * `coord-notification-row`, `-unread-dot`, `-summary`, `-mark-read`,
 * `-detail`, `-link`, `-id`, `-device-id`, plus `row-time`, and the
 * `data-notification-kind` / `data-notification-unread` attributes.
 */

import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { RecordDetail, RecordRow, relativeTime } from "@/components/console";
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
  const subject = notificationSubject(notification);
  const actor = detailActor(notification);

  return (
    // The two `data-notification-*` attributes ride the wrapper rather than
    // the row: `<RecordRow>` deliberately forwards no arbitrary props, and
    // these are a frozen authored contract (D4a) even though nothing in `src/`
    // or `tests/` queries them today — an absent consumer is not permission to
    // drop an attribute a debugging session may be leaning on.
    <div
      className="flex items-start gap-2"
      data-notification-kind={notification.kind}
      data-notification-unread={unread ? "true" : "false"}
    >
      <div className="min-w-0 flex-1">
        <RecordRow
          data-testid="coord-notification-row"
          rowKey={notification.notification_id}
          expanded={expanded}
          onToggle={onToggle}
          className={cn(!unread && "opacity-70")}
          identity={
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                data-testid="coord-notification-unread-dot"
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  unread ? "bg-primary" : "bg-transparent"
                )}
              />
              {humanKind(notification.kind)}
            </span>
          }
          label={
            <span
              className={cn(!unread && "text-muted-foreground")}
              data-testid="coord-notification-summary"
            >
              {notificationHeadline(notification)}
            </span>
          }
          reason={subject ?? undefined}
          reasonTestId="coord-notification-subject"
          time={
            <span
              data-testid="row-time"
              title={absoluteTime(notification.occurred_at)}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {rowTimeLabel(notification.occurred_at)}
            </span>
          }
        >
          <RecordDetail
            data-testid="coord-notification-detail"
            why={
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{absoluteTime(notification.occurred_at)}</span>
                {actor && <span>by {actor}</span>}
                {notification.read_at && (
                  <span>read {relativeTime(notification.read_at)}</span>
                )}
              </div>
            }
            problems={
              notification.detail &&
              Object.keys(notification.detail).length > 0 ? (
                <DetailEntries detail={notification.detail} />
              ) : undefined
            }
            actions={
              notification.repo ? (
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
              ) : undefined
            }
            raw={
              /* R8/R5 — the only place ids are allowed: expanded, and
                 actionable — what you paste into a coord query or a bug
                 report. `device_id` is a first-class column on
                 `coord.notifications` specifically so it can be surfaced HERE
                 rather than smuggled into `summary`. */
              <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground/60">
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
            }
          />
        </RecordRow>
      </div>
      {unread && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onMarkRead}
          disabled={markPending}
          title="Mark read"
          data-testid="coord-notification-mark-read"
          className="h-[38px] shrink-0 px-2"
        >
          <Check className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
