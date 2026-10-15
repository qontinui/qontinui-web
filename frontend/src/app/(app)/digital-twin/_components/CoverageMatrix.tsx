"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useDigitalTwinSubspaces } from "../_hooks/useDigitalTwinSubspaces";
import { resolveSubspaces, summarize } from "../_lib/resolve";
import {
  COUNT_FILLS,
  RESTRICTED_COUNT_MEANING,
} from "../_lib/status-presentation";
import type { ResolvedSubspace } from "../_lib/types";
import { SubspaceCell } from "./SubspaceCell";
import { SubspaceDetail } from "./SubspaceDetail";
import {
  CoordUnreachableBanner,
  TwinAccessRestricted,
} from "./TwinProbeNotices";

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "Tier 1 — minimum working set + high-leverage",
  2: "Tier 2 — situational",
  3: "Tier 3 — niche / deferred",
};

function Gauge({
  value,
  total,
  label,
  barClassName,
  pending = false,
  restricted = 0,
  testId,
}: {
  value: number;
  total: number;
  label: string;
  /** The fill: `COUNT_FILLS.live` for probe answers, `.claim` for claims. */
  barClassName: string;
  /** The count has no verdict yet (its probe is in flight). */
  pending?: boolean;
  /**
   * Cells coord refused for this tenant. Outside `total` (an access decision is
   * not an observer that failed to answer), so they are named beside the count
   * instead of reading as missing answers.
   */
  restricted?: number;
  testId: string;
}) {
  const pct = !pending && total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        {pending ? (
          <span className="text-base text-muted-foreground">probing…</span>
        ) : (
          <span className="text-2xl font-semibold tabular-nums">
            {value}
            <span className="text-base text-muted-foreground">/{total}</span>
          </span>
        )}
        <span className="text-sm text-muted-foreground">{label}</span>
        {restricted > 0 && (
          <span
            data-slot="gauge-restricted"
            className="text-sm text-muted-foreground"
            title={RESTRICTED_COUNT_MEANING}
          >
            · {restricted} restricted
          </span>
        )}
      </div>
      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
        <div
          data-slot="gauge-fill"
          className={cn("h-full rounded-full transition-all", barClassName)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function CoverageMatrix() {
  const { data, isLoading, isError, error } = useDigitalTwinSubspaces();
  const [selected, setSelected] = useState<ResolvedSubspace | null>(null);

  const rows = useMemo(
    () => resolveSubspaces(data?.subspaces, isLoading),
    [data?.subspaces, isLoading]
  );
  const summary = useMemo(() => summarize(rows), [rows]);

  const tiers: (1 | 2 | 3)[] = [1, 2, 3];

  if (data?.restricted) return <TwinAccessRestricted />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-8 rounded-lg border border-border bg-card p-4">
        <Gauge
          testId="digital-twin-gauge-live"
          value={summary.responding}
          total={summary.snapshotTotal}
          pending={summary.pending > 0}
          restricted={summary.restricted}
          label="live observers responding (this tenant)"
          barClassName={COUNT_FILLS.live}
        />
        {/* A static count over the checked-in manifest — never a probe, so
            it fills with the claim colour, not the live green. */}
        <Gauge
          testId="digital-twin-gauge-built"
          value={summary.built}
          total={summary.total}
          label="sub-spaces built (manifest claim)"
          barClassName={COUNT_FILLS.claim}
        />
      </div>

      {isError && <CoordUnreachableBanner error={error} />}

      {tiers.map((tier) => {
        const tierRows = rows.filter((r) => r.tier === tier);
        if (tierRows.length === 0) return null;
        return (
          <section key={tier} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {TIER_LABELS[tier]}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tierRows.map((row) => (
                <SubspaceCell key={row.id} row={row} onSelect={setSelected} />
              ))}
            </div>
          </section>
        );
      })}

      <SubspaceDetail
        row={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
