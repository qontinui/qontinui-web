"use client";

/**
 * The per-row markers `/admin/coord/plans` adds to a reconciliation row:
 * coord's status class, the "needs a /vet-imp" marker, the plan's difficulty
 * and its live custody.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phases 3,
 * 5 and 6. Every reading comes from a pure module (R8); this file only paints.
 *
 * **All of these are NON-INTERACTIVE spans.** They render inside
 * `RecordRow`'s single `<button>`, where interactive content is invalid HTML
 * (see `ReconciliationRow.tsx`). Where a marker points somewhere, its `title`
 * says where, and the detail panel carries the real control.
 *
 * Colour follows R3 through the shared palette atoms only: an UNKNOWN reading
 * takes `UNKNOWN_AMBER`, a reading that asks someone to act (needs cleanup,
 * needs a /vet-imp) takes `WAITING_AMBER`, everything else is `INERT`.
 */

import { INERT, UNKNOWN_AMBER, WAITING_AMBER } from "@/components/console";
import { PlanDifficultyBadge } from "@/components/admin/coord/PlanDifficultyBadge";
import {
  difficultyCell,
  type DifficultyIndex,
} from "@/components/admin/coord/planDifficulty";
import type { ReconciliationRowData } from "@/components/admin/coord/planReconciliationStatus";
import { describeStatusClass, needsVetImp } from "./statusClass";
import { describeCustody } from "./custody";

const CHIP =
  "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap";

export function StatusClassBadge({ row }: { row: ReconciliationRowData }) {
  const reading = describeStatusClass(row.axis_a);
  if (reading.kind === "no_unit") return null;
  const tone = reading.unknown
    ? `${UNKNOWN_AMBER} italic`
    : reading.needsCleanup
      ? WAITING_AMBER
      : INERT;
  return (
    <span
      className={`${CHIP} ${tone}`}
      data-testid="coord-plan-status-class"
      data-status-class={reading.kind}
      data-needs-cleanup={reading.needsCleanup ? "true" : "false"}
      title={reading.detail}
    >
      {reading.needsCleanup
        ? `needs cleanup · ${reading.label}`
        : reading.label}
    </span>
  );
}

/** Shown for `yes` and for `undetermined` — the latter must not vanish. */
export function VetImpMarker({ row }: { row: ReconciliationRowData }) {
  const reading = needsVetImp(row.axis_a);
  if (reading.need === "no") return null;
  const yes = reading.need === "yes";
  return (
    <span
      className={`${CHIP} ${yes ? WAITING_AMBER : `${UNKNOWN_AMBER} italic`}`}
      data-testid="coord-plan-needs-vet-imp"
      data-need={reading.need}
      title={reading.why}
    >
      {yes ? "needs /vet-imp" : "vet-imp ?"}
    </span>
  );
}

export function CustodyBadge({
  row,
  now,
}: {
  row: ReconciliationRowData;
  now?: number;
}) {
  const reading = describeCustody(row.axis_a, now);
  if (reading.kind === "not_applicable") return null;
  if (reading.kind !== "claims") {
    return (
      <span
        className={`${CHIP} ${reading.unknown ? `${UNKNOWN_AMBER} italic` : INERT}`}
        data-testid="coord-plan-custody"
        data-custody={reading.kind}
        title={reading.title}
      >
        {reading.label}
      </span>
    );
  }
  return (
    <>
      {reading.claims.map((claim, i) => (
        // Keyed by INDEX: coord's live-session rows carry no unique id, and
        // two sessions on one device would collide on device_id.
        <span
          key={i}
          className={`${CHIP} ${claim.unknown ? `${UNKNOWN_AMBER} italic` : INERT}`}
          data-testid="coord-plan-custody"
          data-custody={claim.kind}
          title={claim.title}
        >
          {claim.label}
        </span>
      ))}
    </>
  );
}

/** Everything the row line carries beyond the shipped reconciliation cells. */
export function PlanRowBadges({
  row,
  difficulty,
}: {
  row: ReconciliationRowData;
  difficulty: DifficultyIndex;
}) {
  return (
    <>
      <StatusClassBadge row={row} />
      <VetImpMarker row={row} />
      <PlanDifficultyBadge cell={difficultyCell(difficulty, row.slug)} />
      <CustodyBadge row={row} />
    </>
  );
}
