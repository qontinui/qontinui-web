"use client";

/**
 * The spawn request list — filter tabs with live counts (R6), a coverage line,
 * and one row per request (R2) whose detail expands in place (R5).
 *
 * It is the investigation view's (`/admin/coord/spawns/requests`): a triage
 * queue at agent altitude, which the agentic-activity page replaces with counts
 * that link here (`SpawnActivitySummary`). Every UNKNOWN arm it had there it
 * keeps: a tab whose read did not answer has no count and no "none" sentence,
 * and a truncated list says which rows the counts cover.
 */

import { useMemo, useState } from "react";
import { FilterTabs, RecordList } from "@/components/console";
import { SectionCaption } from "@/components/presentation";
import type { SpawnLedgerRead } from "../_lib/useSpawnLedger";
import {
  SPAWN_FILTERS,
  isSpawnRow,
  matchesSpawnFilter,
  mergeSpawnRows,
  spawnFilterAnswered,
  spawnFilterCounts,
  spawnFilterEmptyText,
  spawnFilterUnknownText,
  type DeviceNaming,
  type SpawnFilter,
} from "../_lib/spawnStatus";
import { SPAWNS_SOURCES } from "../_lib/spawnsSources";
import { clockTime } from "../_lib/useSpawnPageContext";
import { SpawnRow } from "./SpawnRow";

export function SpawnRequestList({
  ledger,
  windowLabel,
  naming,
  nowMs,
}: {
  ledger: Pick<SpawnLedgerRead, "list" | "pending">;
  windowLabel: string;
  naming: DeviceNaming;
  nowMs: number;
}) {
  const [filter, setFilter] = useState<SpawnFilter>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const list = ledger.list.data;
  const pending = ledger.pending.data;
  const listIssue = ledger.list.issue;
  const pendingIssue = ledger.pending.issue;
  const stale = listIssue !== null || pendingIssue !== null;
  const rows = useMemo(
    () => mergeSpawnRows(list?.items ?? null, pending?.items ?? null),
    [list, pending]
  );
  const unreadableRows = [
    ...(list?.items ?? []),
    ...(pending?.items ?? []),
  ].filter((r) => !isSpawnRow(r)).length;
  // Which read each tab's answer rests on: a tab whose read did not answer
  // has no count and no "none" sentence, whatever the other read brought.
  const reads = useMemo(
    () => ({ list: list !== null, pending: pending !== null }),
    [list, pending]
  );
  const counts = useMemo(() => spawnFilterCounts(rows, reads), [rows, reads]);
  const visible = useMemo(
    () => (rows ?? []).filter((r) => matchesSpawnFilter(r, filter)),
    [rows, filter]
  );

  return (
    <section className="space-y-2" data-testid="coord-spawns-list-section">
      <SectionCaption
        id="agentic-activity.requests"
        sources={[
          { source: SPAWNS_SOURCES.ledger, asOf: list?.as_of ?? null },
          {
            source: SPAWNS_SOURCES.ledgerWaiting,
            asOf: pending?.as_of ?? null,
          },
        ]}
      />
      <FilterTabs
        tabs={SPAWN_FILTERS.map((f) => ({
          id: f.id,
          label: <span title={f.title}>{f.label}</span>,
          count: counts[f.id],
          attention:
            f.id === "failed" && counts.failed !== null && counts.failed > 0,
        }))}
        active={filter}
        onChange={(id) => {
          setFilter(id);
          setExpandedKey(null);
        }}
        testIdPrefix="coord-spawns-filter"
      />
      {(list || pending) && (
        <p
          className="text-xs text-muted-foreground m-0"
          data-testid="coord-spawns-coverage"
        >
          {list === null
            ? `The requests in the ${windowLabel} could not be read; only requests still waiting are listed.`
            : list.truncated
              ? `Showing the ${list.items.length} most recent of ${list.total ?? "an unknown number of"} requests in the ${windowLabel}, as of ${clockTime(list.as_of)}; tab counts cover these rows only.`
              : `Every request in the ${windowLabel}, as of ${clockTime(list.as_of)}.`}
          {pending === null
            ? " Requests still waiting from before the window could not be read."
            : pending.truncated
              ? ` Plus the ${pending.items.length} oldest of ${pending.total ?? "an unknown number of"} requests still waiting, whatever their age.`
              : ` Plus every request still waiting, whatever its age (${pending.items.length}).`}
          {unreadableRows > 0
            ? ` ${unreadableRows} row${unreadableRows === 1 ? "" : "s"} in the answer could not be read and ${unreadableRows === 1 ? "is" : "are"} not listed.`
            : ""}
        </p>
      )}
      <RecordList
        items={visible}
        itemKey={(r) => r.id}
        loaded={rows !== null || listIssue !== null}
        expandedKey={expandedKey}
        onExpandedKeyChange={setExpandedKey}
        empty={
          rows === null || !spawnFilterAnswered(filter, reads) ? (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-spawns-list-unknown"
            >
              {spawnFilterUnknownText(filter, windowLabel, reads)}
            </p>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-spawns-list-empty"
            >
              {spawnFilterEmptyText(filter, windowLabel, {
                scope: list?.truncated ? "loaded" : "window",
                stale:
                  filter === "queued"
                    ? pendingIssue !== null
                    : filter === "all"
                      ? stale
                      : listIssue !== null,
              })}
            </p>
          )
        }
        renderRow={(row, ctx) => (
          <SpawnRow
            row={row}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
            naming={naming}
            nowMs={nowMs}
          />
        )}
      />
    </section>
  );
}
