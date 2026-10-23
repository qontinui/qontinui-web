"use client";

import { useEffect, useMemo, useState } from "react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import {
  Caption,
  NAVIGATION_ONLY_PROPS,
  captionEntry,
  usePresentationMode,
} from "@/components/presentation";
import { cn } from "@/lib/utils";
import { presentStatus } from "../_lib/status-presentation";
import { partName, type TwinAspect } from "../_lib/twin-aspects";
import {
  plansForSubspace,
  plansForSubspaces,
  type SubspacePlans,
  type TwinPlanRead,
} from "../_lib/twin-plans";
import type { ResolvedSubspace } from "../_lib/types";
import { ASPECT_DETAIL_ID } from "./AspectCard";
import { TwinPlanList } from "./TwinPlanList";

/** One part on its own line: status, and how many plans move it; a press filters the plans. */
function PartRow({
  row,
  plans,
  selected,
  onSelect,
}: {
  row: ResolvedSubspace;
  plans: SubspacePlans | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = presentStatus(row);
  const count = plans?.plans.length ?? null;
  return (
    <li>
      <button
        type="button"
        {...NAVIGATION_ONLY_PROPS}
        aria-pressed={selected}
        onClick={onSelect}
        data-testid={`digital-twin-part-${row.id}`}
        title={style.meaning}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent/50",
          selected && "bg-accent"
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", style.dot)}
          />
          <span className="truncate capitalize">{partName(row.id)}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {style.label}
          {count !== null && ` · ${count === 1 ? "1 plan" : `${count} plans`}`}
        </span>
      </button>
    </li>
  );
}

/** The plan side of the drill-down: the read's state, then the list. */
function PlanPanel({
  read,
  rows,
}: {
  read: TwinPlanRead;
  rows: readonly ResolvedSubspace[];
}) {
  const plans = useMemo(
    () => (read.kind === "ready" ? plansForSubspaces(rows, read.index) : []),
    [read, rows]
  );
  if (read.kind === "loading") {
    return <p className="text-sm text-muted-foreground">Reading the plans…</p>;
  }
  if (read.kind === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold">UNKNOWN</span> — the plans could not be
        read: {read.reason}
      </p>
    );
  }
  return <TwinPlanList plans={plans} complete={read.index.complete} />;
}

/**
 * The drill-down of one aspect: the parts of the factory it observes, each
 * with its status and how many plans move it, and those plans with their
 * live status — every one linking to its work unit. Pressing a part narrows
 * the plans to it; pressing it again shows the whole aspect's plans.
 *
 * Operator mode also names any area the manifest maps that no work unit
 * carries — drift between the manifest and the tenant's work units, shown
 * rather than silently resolving to fewer plans.
 */
export function AspectDetail({
  aspect,
  rows,
  read,
}: {
  aspect: TwinAspect;
  /** The aspect's parts, resolved (`aspectRows` over `resolveSubspaces`). */
  rows: readonly ResolvedSubspace[];
  read: TwinPlanRead;
}) {
  const { presenting } = usePresentationMode();
  const [part, setPart] = useState<string | null>(null);
  // A different aspect starts unfiltered.
  useEffect(() => setPart(null), [aspect.id]);

  const { ref } = useUIElement({
    id: ASPECT_DETAIL_ID,
    label: "Twin map — the chosen twin's parts and the plans moving it",
    type: "custom",
  });

  const perPart = useMemo(
    () =>
      read.kind === "ready"
        ? new Map(
            rows.map((row) => [row.id, plansForSubspace(row, read.index)])
          )
        : null,
    [read, rows]
  );
  const shownRows = useMemo(
    () => (part ? rows.filter((row) => row.id === part) : rows),
    [part, rows]
  );
  const drift = useMemo(() => {
    if (!perPart) return [];
    const areas = new Set<string>();
    for (const plans of perPart.values()) {
      for (const area of plans.unmatchedAreas ?? []) areas.add(area);
    }
    return [...areas].sort();
  }, [perPart]);

  const title = captionEntry(aspect.captionKey).title;
  const selectedName = part ? partName(part) : null;

  return (
    <section
      ref={ref}
      id={ASPECT_DETAIL_ID}
      data-testid={`${ASPECT_DETAIL_ID}-${aspect.id}`}
      aria-label={`${title}: its parts and the plans moving it`}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <Caption id="digital-twin.aspect-detail" level={3} persistent />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Parts ({rows.length})
          </h4>
          <ul className="space-y-0.5" data-testid="digital-twin-parts">
            {rows.map((row) => (
              <PartRow
                key={row.id}
                row={row}
                plans={perPart?.get(row.id) ?? null}
                selected={part === row.id}
                onSelect={() =>
                  setPart((current) => (current === row.id ? null : row.id))
                }
              />
            ))}
          </ul>
        </div>

        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {selectedName
              ? `Plans moving ${selectedName}`
              : `Plans moving the ${title.toLowerCase()}`}
          </h4>
          <PlanPanel read={read} rows={shownRows} />
        </div>
      </div>

      {!presenting && drift.length > 0 && (
        <p
          data-testid="digital-twin-area-drift"
          className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground"
        >
          Mapped in this page&apos;s manifest, carried by no work unit:{" "}
          <code>{drift.join(", ")}</code> — the area was renamed or retired, so
          the manifest needs updating.
        </p>
      )}
    </section>
  );
}
