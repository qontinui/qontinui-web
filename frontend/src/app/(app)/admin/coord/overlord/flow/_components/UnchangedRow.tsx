"use client";

/**
 * One session whose verdict and reason codes did not move across consecutive
 * full triage passes (style guide R2 row, R5 detail).
 *
 * The row is a `<RecordRow>` button, so the link to the session cannot live on
 * it (a link inside a button is invalid and unreachable by keyboard); it is the
 * detail's action — "Open session ↗" to `/sessions/<claude_session_id>`, the
 * console's per-session view, which resolves a Claude session id. A row whose
 * Claude session id was never proven has no page to open, so it says so and
 * shows the full terminal id instead of hiding the gap.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  absoluteTime,
} from "@/components/console";
import type { FlowUnchangedSession } from "@/lib/api/operations/overlordFlow";
import { sessionHref, verdictWords } from "../_lib/overlordFlowStatus";

export function UnchangedRow({
  row,
  expanded,
  onToggle,
}: {
  row: FlowUnchangedSession;
  expanded: boolean;
  onToggle: () => void;
}) {
  const href = sessionHref(row);
  const name = row.session_name ?? `terminal ${row.terminal_id}`;
  const reasons =
    row.reason_codes.length > 0
      ? row.reason_codes.join(", ")
      : "no reason codes";
  return (
    <RecordRow
      data-testid="overlord-flow-unchanged-row"
      rowKey={row.key}
      expanded={expanded}
      onToggle={onToggle}
      identity={
        <span
          className="font-mono text-[11px]"
          data-testid="overlord-flow-unchanged-verdict"
        >
          {row.verdict}
        </span>
      }
      label={<span title={name}>{name}</span>}
      status={
        <Badge
          variant="outline"
          className="font-mono text-[11px]"
          title="consecutive full passes with the same verdict and reasons"
          data-testid="overlord-flow-unchanged-passes"
        >
          ×{row.consecutive_full_passes}
        </Badge>
      }
      reason={reasons}
      reasonTestId="overlord-flow-unchanged-reasons"
      time={<RowTime at={row.last_seen_at || null} verb="Last seen" />}
    >
      <RecordDetail
        why={
          <p className="text-[13px] text-foreground/85 m-0">
            {verdictWords(row.verdict)} with the same reasons ({reasons}) in
            each of the last {row.consecutive_full_passes} full passes, first
            seen{" "}
            {row.first_seen_at
              ? absoluteTime(row.first_seen_at)
              : "at an unknown time"}
            .
          </p>
        }
        actions={
          href ? (
            <Link
              href={href}
              className="text-xs text-primary underline-offset-4 hover:underline"
              data-testid="overlord-flow-unchanged-open"
            >
              Open session ↗
            </Link>
          ) : (
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="overlord-flow-unchanged-no-session"
            >
              No Claude session id was proven for this terminal, so there is no
              session page to open — terminal{" "}
              <span className="font-mono">{row.terminal_id}</span>.
            </p>
          )
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            key {row.key} · terminal {row.terminal_id} · claude session{" "}
            {row.claude_session_id ?? "not proven"}
          </p>
        }
      />
    </RecordRow>
  );
}
