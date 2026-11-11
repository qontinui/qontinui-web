"use client";

/**
 * One session coord counts as closed in the window, with the time from its
 * first stop to its close — what the time-to-close tile's median is made of
 * (style guide R2 row, R5 detail).
 *
 * The wire carries no session name for a closed session, only its key. A
 * `terminal:` key means no Claude session id was proven, so it has no session
 * page, and the detail says so rather than hiding the gap.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  absoluteTime,
} from "@/components/console";
import {
  closedByWords,
  closedRowKey,
  closedSessionHref,
  closedSessionLabel,
  durationWords,
  laterStopAt,
  type ClosedSession,
} from "../_lib/overlordFlowStatus";

export function ClosedSessionRow({
  row,
  expanded,
  onToggle,
}: {
  row: ClosedSession;
  expanded: boolean;
  onToggle: () => void;
}) {
  const href = closedSessionHref(row.key);
  const lastStop = laterStopAt(row);
  return (
    <RecordRow
      data-testid="overlord-flow-closed-row"
      rowKey={closedRowKey(row)}
      expanded={expanded}
      onToggle={onToggle}
      identity={
        <span className="font-mono text-[11px]">
          {closedByWords(row.closedBy)}
        </span>
      }
      label={<span title={row.key}>{closedSessionLabel(row.key)}</span>}
      status={
        <Badge
          variant="outline"
          className="font-mono text-[11px]"
          title="from the first stop seen in this window to its close"
          data-testid="overlord-flow-closed-secs"
        >
          {durationWords(row.secs)}
        </Badge>
      }
      time={<RowTime at={row.closedAt} verb="Closed" />}
    >
      <RecordDetail
        why={
          <div className="space-y-1">
            <p className="text-[13px] text-foreground/85 m-0">
              First seen stopped {absoluteTime(row.firstStoppedAt)}, closed{" "}
              {absoluteTime(row.closedAt)}.
            </p>
            {lastStop && (
              <p
                className="text-xs text-muted-foreground m-0"
                data-testid="overlord-flow-closed-later-stop"
              >
                It showed another verdict and stopped again at{" "}
                {absoluteTime(lastStop)}, so it may not have been stopped for
                all of this time.
              </p>
            )}
          </div>
        }
        actions={
          href ? (
            <Link
              href={href}
              className="text-xs text-primary underline-offset-4 hover:underline"
              data-testid="overlord-flow-closed-open"
            >
              Open session ↗
            </Link>
          ) : (
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="overlord-flow-closed-no-session"
            >
              No Claude session id was proven for this terminal, so there is no
              session page to open.
            </p>
          )
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            key {row.key} · runner port {row.runnerPort ?? "unknown"}
          </p>
        }
      />
    </RecordRow>
  );
}
