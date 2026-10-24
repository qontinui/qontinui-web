"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useDigitalTwinSubspaces } from "../_hooks/useDigitalTwinSubspaces";
import { useTwinCatalog } from "../_hooks/useTwinCatalog";
import {
  allProbesRestricted,
  resolveSubspaces,
  summarize,
  unlistedDeclaredProbes,
} from "../_lib/resolve";
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
  testId,
}: {
  value: number;
  total: number;
  label: string;
  /** The fill: `COUNT_FILLS.live` for probe answers, `.claim` for claims. */
  barClassName: string;
  /** The count has no verdict yet (its probe is in flight). */
  pending?: boolean;
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
  // coord's declaration of what the twin probes: the matrix joins the manifest
  // to it, so a row coord declares is live and one it does not is not.
  const { data: catalog } = useTwinCatalog();
  const [selected, setSelected] = useState<ResolvedSubspace | null>(null);

  const rows = useMemo(
    () => resolveSubspaces(data?.subspaces, isLoading, catalog),
    [data?.subspaces, isLoading, catalog]
  );
  const summary = useMemo(() => summarize(rows), [rows]);
  const unlisted = useMemo(() => unlistedDeclaredProbes(catalog), [catalog]);

  const tiers: (1 | 2 | 3)[] = [1, 2, 3];

  // The whole-view notice only when EVERY probe was refused; a single refused
  // sub-space renders as its own `restricted` cell.
  if (allProbesRestricted(data)) return <TwinAccessRestricted />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-8 rounded-lg border border-border bg-card p-4">
        <Gauge
          testId="digital-twin-gauge-live"
          value={summary.responding}
          total={summary.graded}
          pending={summary.pending > 0}
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
        {(summary.served > 0 || summary.restricted > 0) && (
          <p
            data-testid="digital-twin-gauge-notes"
            title={RESTRICTED_COUNT_MEANING}
            className="text-xs text-muted-foreground"
          >
            Also probed, outside the live count: {summary.served} served (a
            report, not graded) · {summary.restricted} restricted (not yours to
            read)
          </p>
        )}
      </div>

      {unlisted.length > 0 && (
        <p
          data-testid="digital-twin-unlisted-probes"
          className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground"
        >
          Declared by coord, not in this page&apos;s taxonomy:{" "}
          <code>{unlisted.join(", ")}</code> — probed by coord&apos;s
          declaration, but the manifest has no row to show{" "}
          {unlisted.length === 1 ? "it" : "them"} in.
        </p>
      )}

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
