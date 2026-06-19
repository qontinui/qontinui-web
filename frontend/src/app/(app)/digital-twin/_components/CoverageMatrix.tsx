"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { useDigitalTwinSubspaces } from "../_hooks/useDigitalTwinSubspaces";
import { resolveSubspaces, summarize } from "../_lib/resolve";
import type { ResolvedSubspace } from "../_lib/types";
import { SubspaceCell } from "./SubspaceCell";
import { SubspaceDetail } from "./SubspaceDetail";

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "Tier 1 — minimum working set + high-leverage",
  2: "Tier 2 — situational",
  3: "Tier 3 — niche / deferred",
};

function Gauge({ value, total, label }: { value: number; total: number; label: string }) {
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
    [data?.subspaces, isLoading],
  );
  const summary = useMemo(() => summarize(rows), [rows]);

  const tiers: (1 | 2 | 3)[] = [1, 2, 3];

  // coord's twin tenant gate denied this operator (home tenant outside the
  // configured internal-tenant allowlist). Show a clear access message rather
  // than an all-"error" grid — it's an access decision, not an outage.
  if (data?.restricted) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-center">
        <Lock className="size-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">Access restricted</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          The Digital Twin is limited to internal Qontinui operators. Your tenant
          isn&apos;t on the allowlist for the fleet-wide twin observers — ask an
          administrator if you need access.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-8 rounded-lg border border-border bg-card p-4">
        <Gauge
          value={summary.responding}
          total={summary.snapshotTotal}
          label="live observers responding (this tenant)"
        />
        <Gauge
          value={summary.built}
          total={summary.total}
          label="sub-spaces built (research roadmap)"
        />
      </div>

      {isError && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            Could not reach the coordination layer
            {error instanceof Error ? `: ${error.message}` : ""}. Live cells fall
            back to their last status; the taxonomy below is still accurate.
          </span>
        </div>
      )}

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
