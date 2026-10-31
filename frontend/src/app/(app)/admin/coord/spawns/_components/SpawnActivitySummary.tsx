"use client";

/**
 * The requests and where they were placed, as counts — each linking to the
 * investigation view (`/admin/coord/spawns/requests`) that lists them.
 *
 * The per-request list with its filters, and the per-device placement detail,
 * are a triage queue at agent altitude: the operator monitors, and does not
 * supervise, and an evaluator does not need a triage queue at all (UX pass,
 * "features that should not exist"). This page keeps what answers its question
 * — how many, and how they ended — and the list is one click away.
 *
 * Every count keeps its UNKNOWN arm (R6): a count whose read did not answer is
 * a dash with the reason, never 0, and a truncated list says the counts cover
 * the rows loaded.
 */

import { useMemo } from "react";
import { ListChecks } from "lucide-react";
import { UNKNOWN_AMBER } from "@/components/console";
import Link from "next/link";
import {
  OperatorOnly,
  SectionCaption,
  captionEntry,
  type SectionSource,
} from "@/components/presentation";
import { cn } from "@/lib/utils";
import type { SpawnStatsWindow } from "@/lib/api/operations/coordSpawns";
import { spawnRequestsHref } from "../_lib/spawnRequestsRoute";
import type { SpawnLedgerRead } from "../_lib/useSpawnLedger";
import {
  SPAWN_FILTERS,
  mergeSpawnRows,
  spawnFilterCounts,
  type SpawnStatsWire,
} from "../_lib/spawnStatus";

function Count({
  value,
  label,
  testId,
}: {
  value: number | null;
  label: string;
  testId: string;
}) {
  return (
    <span
      className="inline-flex items-baseline gap-1"
      data-testid={testId}
      data-count={value === null ? "unknown" : String(value)}
    >
      {value === null ? (
        <span
          className={cn(
            "rounded border px-1 text-xs font-medium",
            UNKNOWN_AMBER
          )}
        >
          –
        </span>
      ) : (
        <span className="font-semibold tabular-nums">{value}</span>
      )}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** How many were placed, and on how many devices; `null` while unread. */
export function placementCounts(
  stats: SpawnStatsWire | null
): { placed: number; devices: number } | null {
  if (stats === null) return null;
  const rows = Array.isArray(stats.per_device) ? stats.per_device : [];
  let placed = 0;
  let devices = 0;
  for (const d of rows) {
    const n = typeof d.placed === "number" ? d.placed : 0;
    placed += n;
    if (n > 0) devices += 1;
  }
  return { placed, devices };
}

export function SpawnActivitySummary({
  ledger,
  windowId,
  windowLabel,
  requestSources,
  placementSources,
}: {
  ledger: Pick<SpawnLedgerRead, "list" | "pending" | "stats">;
  windowId: SpawnStatsWindow;
  windowLabel: string;
  requestSources: readonly SectionSource[];
  placementSources: readonly SectionSource[];
}) {
  const list = ledger.list.data;
  const pending = ledger.pending.data;
  const counts = useMemo(
    () =>
      spawnFilterCounts(
        mergeSpawnRows(list?.items ?? null, pending?.items ?? null),
        { list: list !== null, pending: pending !== null }
      ),
    [list, pending]
  );
  const placement = placementCounts(ledger.stats.data);
  const label = (id: string) =>
    SPAWN_FILTERS.find((f) => f.id === id)?.label.toLowerCase() ?? id;

  return (
    <>
      <section
        className="space-y-1"
        data-testid="coord-spawns-requests-summary"
      >
        <SectionCaption
          id="agentic-activity.requests"
          sources={requestSources}
        />
        <h2 className="text-sm font-medium flex items-center gap-1.5 m-0">
          <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden />
          {captionEntry("agentic-activity.requests").title}
        </h2>
        <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <Count
            value={counts.all}
            label={`in the ${windowLabel} and still waiting`}
            testId="coord-spawns-count-all"
          />
          {SPAWN_FILTERS.filter((f) => f.id !== "all").map((f) => (
            <Count
              key={f.id}
              value={counts[f.id]}
              label={label(f.id)}
              testId={`coord-spawns-count-${f.id}`}
            />
          ))}
          {/* The investigation view is the operator's, never a lens page. */}
          <OperatorOnly>
            <Link
              href={spawnRequestsHref(windowId)}
              className="text-xs font-medium underline underline-offset-2 hover:no-underline"
              data-testid="coord-spawns-requests-link"
              title="Every request, filtered by how it ended, with where it went and how long it waited"
            >
              Investigate the requests
            </Link>
          </OperatorOnly>
        </p>
        {list?.truncated && (
          <p
            className="m-0 text-xs text-muted-foreground"
            data-testid="coord-spawns-count-truncated"
          >
            Counts cover the {list.items.length} most recent of{" "}
            {list.total ?? "an unknown number of"} requests loaded.
          </p>
        )}
      </section>

      <section
        className="space-y-1"
        data-testid="coord-spawns-placement-summary"
      >
        <SectionCaption
          id="agentic-activity.placement"
          sources={placementSources}
        />
        <h2 className="text-sm font-medium m-0">
          {captionEntry("agentic-activity.placement").title}
        </h2>
        <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <Count
            value={placement?.placed ?? null}
            label={`placed in the ${windowLabel}`}
            testId="coord-spawns-count-placed"
          />
          <Count
            value={placement?.devices ?? null}
            label={placement?.devices === 1 ? "device" : "devices"}
            testId="coord-spawns-count-devices"
          />
          {/* The investigation view is the operator's, never a lens page. */}
          <OperatorOnly>
            <Link
              href={spawnRequestsHref(windowId, "placement")}
              className="text-xs font-medium underline underline-offset-2 hover:no-underline"
              data-testid="coord-spawns-placement-link"
              title="Each device's share, with its role, its time-to-spawn p50 and how many started, were refused and were deferred"
            >
              Investigate the placement
            </Link>
          </OperatorOnly>
        </p>
      </section>
    </>
  );
}
