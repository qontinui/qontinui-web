"use client";

/**
 * Shadow-reap (Tier-4 SHADOW reaper) audit helpers + UI.
 *
 * The coord `ai_gate_reaper` runs in SHADOW: each cycle it stamps the OPEN
 * gates it WOULD reap with a cited abandonment signal (`shadow_reap_signal`)
 * instead of acting. This surfaces that would-reap set on the gates dashboard
 * so the operator can judge per-class false-positive rates before arming the
 * reaper live (that's the arming decision).
 *
 * coord's classifiers produce three signal families:
 *   - plan-abandoned       — the anchored plan/work-unit was abandoned
 *                            (signal mentions a plan slug / "plan" / "abandon").
 *   - metric-flat          — the gated metric stopped moving toward its target
 *                            (signal mentions "metric" / "flat" / "target").
 *   - operator-dead-anchor — an operator_approval / anchor predicate went dead
 *                            (signal mentions "operator" / "anchor").
 *   - other                — matched none of the above (shown but uncolored).
 *
 * `signalClass` derives the family from the signal string by inspecting which
 * family-specific tokens it contains; a colored badge renders per class.
 */

import { Badge } from "@/components/ui/badge";
import type { GateOverviewRow } from "@/services/admin-dev-service";

export type ShadowSignalClass =
  | "plan-abandoned"
  | "metric-flat"
  | "operator-dead-anchor"
  | "other";

/**
 * Bucket a `shadow_reap_signal` string into one of the three coord classifier
 * families (or "other"). Token-based on the lower-cased signal — order matters
 * only for disambiguation: operator/anchor is checked before the generic
 * metric/plan tokens so an "operator_approval" anchor signal is not mislabeled.
 */
export function signalClass(signal: string): ShadowSignalClass {
  const s = signal.toLowerCase();
  if (s.includes("operator") || s.includes("anchor")) {
    return "operator-dead-anchor";
  }
  if (s.includes("metric") || s.includes("flat") || s.includes("target")) {
    return "metric-flat";
  }
  if (s.includes("plan") || s.includes("abandon") || s.includes("slug")) {
    return "plan-abandoned";
  }
  return "other";
}

const CLASS_LABEL: Record<ShadowSignalClass, string> = {
  "plan-abandoned": "plan-abandoned",
  "metric-flat": "metric-flat",
  "operator-dead-anchor": "operator-dead-anchor",
  other: "other",
};

/** All classes in a stable display order (drives the grouped summary). */
export const SHADOW_SIGNAL_CLASSES: ShadowSignalClass[] = [
  "plan-abandoned",
  "metric-flat",
  "operator-dead-anchor",
  "other",
];

/** Tailwind class string for a class's colored badge. */
function classBadgeClass(cls: ShadowSignalClass): string {
  switch (cls) {
    case "plan-abandoned":
      return "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "metric-flat":
      return "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-400";
    case "operator-dead-anchor":
      return "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-400";
    case "other":
      return "border-muted-foreground/40 bg-muted text-muted-foreground";
  }
}

/** A small colored badge naming the would-reap signal class. */
export function ShadowClassBadge({ cls }: { cls: ShadowSignalClass }) {
  return (
    <Badge
      variant="outline"
      className={classBadgeClass(cls)}
      data-testid={`shadow-reap-class-${cls}`}
    >
      {CLASS_LABEL[cls]}
    </Badge>
  );
}

/**
 * Inline would-reap evidence for a single gate: the class badge + the cited
 * signal text. Renders nothing when the gate is not a shadow would-reap
 * (`shadow_reap_signal` is null) so non-flagged rows are unaffected.
 */
export function ShadowReapEvidence({ gate }: { gate: GateOverviewRow }) {
  const signal = gate.shadow_reap_signal;
  if (!signal) return null;
  const cls = signalClass(signal);
  return (
    <div
      className="mt-1 flex items-center gap-1.5"
      data-testid="shadow-reap-evidence"
    >
      <ShadowClassBadge cls={cls} />
      <span
        className="text-[11px] text-muted-foreground truncate"
        title={signal}
      >
        {signal}
      </span>
    </div>
  );
}

/**
 * Per-class grouped counts of the current shadow would-reap set, so the
 * operator can judge per-class false-positive rates at a glance (the arming
 * decision). Counts only gates carrying a `shadow_reap_signal`. Renders
 * nothing when there are no would-reap gates in the page.
 */
export function ShadowReapGroups({ gates }: { gates: GateOverviewRow[] }) {
  const flagged = gates.filter((g) => g.shadow_reap_signal);
  if (flagged.length === 0) return null;

  const counts: Record<ShadowSignalClass, number> = {
    "plan-abandoned": 0,
    "metric-flat": 0,
    "operator-dead-anchor": 0,
    other: 0,
  };
  for (const g of flagged) {
    // g.shadow_reap_signal is non-null here (filtered above).
    counts[signalClass(g.shadow_reap_signal as string)] += 1;
  }

  return (
    <div
      className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2"
      data-testid="shadow-reap-groups"
    >
      <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
        Would-be-reaped (shadow) · {flagged.length} gate
        {flagged.length === 1 ? "" : "s"}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-3">
        {SHADOW_SIGNAL_CLASSES.map((cls) => (
          <div key={cls} className="flex items-center gap-1.5">
            <ShadowClassBadge cls={cls} />
            <span className="text-sm tabular-nums text-foreground">
              {counts[cls]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
