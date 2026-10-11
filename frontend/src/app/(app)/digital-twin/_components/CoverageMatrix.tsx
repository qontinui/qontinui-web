"use client";

import { useMemo, useState } from "react";
import { useDigitalTwinSubspaces } from "../_hooks/useDigitalTwinSubspaces";
import { resolveSubspaces, summarize } from "../_lib/resolve";
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
}: {
  value: number;
  total: number;
  label: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {value}
          <span className="text-base text-muted-foreground">/{total}</span>
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
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
          value={summary.responding}
          total={summary.snapshotTotal}
          label="live observers responding (this tenant)"
        />
        {/* A static count over the checked-in manifest — never a probe. */}
        <Gauge
          value={summary.built}
          total={summary.total}
          label="sub-spaces built (manifest claim)"
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
