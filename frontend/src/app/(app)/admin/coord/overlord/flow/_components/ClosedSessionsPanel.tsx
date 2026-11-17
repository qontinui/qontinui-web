"use client";

/**
 * Which sessions the time-to-close tile counted (coord's
 * `time_to_close.sessions`), newest close first, so a median can be traced back
 * to the sessions behind it. Collapsed by default: the list can be long.
 */

import { CheckCircle2 } from "lucide-react";
import { CollapsiblePanel, RecordList } from "@/components/console";
import {
  CAPPED_READ_NOTE,
  closedCountMismatch,
  closedRowKey,
  countWords,
  type ClosedSessions,
} from "../_lib/overlordFlowStatus";
import { ClosedSessionRow } from "./ClosedSessionRow";

export function ClosedSessionsPanel({
  closed,
  total,
  windowWords,
  reading,
  capped,
}: {
  /** `null` = the list has not been read, or could not be: unknown, not empty. */
  closed: ClosedSessions | null;
  /** The tile's count over ALL closed sessions, which a cut list can be short of. */
  total: number | undefined;
  windowWords: string;
  /** No read has answered yet, so `closed === null` says nothing about coord. */
  reading: boolean;
  /** coord's `truncated`: the passes behind this list were themselves capped. */
  capped: boolean;
}) {
  const cut =
    closed?.truncated === true
      ? `The ${closed.sessions.length} that first stopped most recently, of ${total ?? "an unknown number of"} closed sessions. Coord cut the rest from this list, so a session that stopped earlier and closed just now can be missing; the tile above still counts them.`
      : closed?.truncated === undefined && closed
        ? "Coord did not say whether it cut this list, so it may not be every closed session."
        : closed
          ? closedCountMismatch(closed, total)
          : null;
  return (
    <CollapsiblePanel
      title="Closed sessions"
      titleAs="h2"
      icon={
        <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden />
      }
      summary={
        <span
          className="text-xs normal-case tracking-normal text-muted-foreground"
          data-testid="overlord-flow-closed-summary"
        >
          {reading
            ? "reading…"
            : closed === null
              ? "not read — unknown"
              : `${countWords(closed.sessions.length, closed.truncated !== false)} in ${windowWords}`}
        </span>
      }
      defaultOpen={false}
      storageKey="coord-overlord-flow-closed-open"
      data-testid="overlord-flow-closed"
    >
      {reading ? (
        <p
          className="text-sm text-muted-foreground m-0"
          data-testid="overlord-flow-closed-reading"
        >
          Reading the pass ledger…
        </p>
      ) : closed === null ? (
        <p
          className="text-sm text-muted-foreground italic m-0"
          data-testid="overlord-flow-closed-unknown"
        >
          No readable list of closed sessions from coord — this is unknown, not
          empty.
        </p>
      ) : (
        <div className="space-y-1">
          {capped && (
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="overlord-flow-closed-capped"
            >
              {CAPPED_READ_NOTE}
            </p>
          )}
          {cut && (
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="overlord-flow-closed-cut"
            >
              {cut}
            </p>
          )}
          <p
            className="text-[11px] text-muted-foreground m-0"
            data-testid="overlord-flow-closed-caption"
          >
            Time counts from the first stop seen in this window, so a session
            that stopped before the window began shows less than its real time.
          </p>
          <RecordList
            items={closed.sessions}
            itemKey={closedRowKey}
            loaded
            renderRow={(r, ctx) => (
              <ClosedSessionRow
                row={r}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
              />
            )}
            empty={
              <p
                className="text-sm text-muted-foreground italic m-0"
                data-testid="overlord-flow-closed-empty"
              >
                Coord counted no session that stopped in {windowWords} as closed
                yet.
              </p>
            }
          />
        </div>
      )}
    </CollapsiblePanel>
  );
}
