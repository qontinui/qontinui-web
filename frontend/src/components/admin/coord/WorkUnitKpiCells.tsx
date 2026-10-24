"use client";

/**
 * The work-unit KPI surfaces: the headline chips on a `/admin/coord/work-units`
 * row, the full block inside a row's detail and on
 * `/admin/coord/work-units/[slug]`, and the window control both share.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4. Every figure is
 * rendered by `describeKpi` (`workUnitKpis.ts`) — this file never reads a
 * `Kpi`'s `value` — so the rules hold here by construction:
 *
 * - **UNKNOWN is explicit.** A null figure prints `unknown`; its reason (in
 *   words) and coverage are on the hover and in the detail block. Never `0`,
 *   never a dash, never blank.
 * - **Partial coverage is shown wherever a number is.** A value that saw 2 of 3
 *   inputs prints `(2/3)` beside it.
 * - **Cost is a LABELLED equivalent.** The chip is labelled "list-price equiv."
 *   and the block row says "list-price equivalent" in full.
 * - **No hue.** R3 spends colour on who must act; a KPI asks nothing of anyone.
 *   Like the difficulty chip, these are neutral, with UNKNOWN set apart by
 *   muted italics rather than by a colour that would read as a verdict.
 *
 * ## Why the row carries four chips and not seven
 *
 * R2 keeps a record on ONE line, and the row already holds an identity chip, a
 * truncating label, difficulty, status, the document markers, a reason and a
 * time. Seven labelled chips are ~630px; they do not fit beside those at any
 * desktop width, and wrapping a row is what R2 forbids. So the row carries the
 * headline four — speed (lead time), cost, autonomy (interventions) and
 * quality (rework), the trio D6/D7 say are read side by side — from `xl` up,
 * and the detail block (R5, every viewport) carries every figure the plan
 * lists, plus the segments, sessions, the cache token classes and the
 * intervention split.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  KPI_COLUMNS,
  KPI_WINDOWS,
  interventionsSplitText,
  kpiTitle,
  outsideChipText,
  prsText,
  unitBlockRows,
  unitColumnViews,
  type KpiCell,
  type KpiColumnKey,
  type KpiView,
} from "./workUnitKpis";

/** The columns the row carries (the detail block carries all of them). */
export const ROW_KPI_COLUMNS: readonly KpiColumnKey[] = [
  "lead_time",
  "cost",
  "interventions",
  "rework",
];

const CHIP_BASE =
  "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] leading-none tabular-nums";

function tone(view: Pick<KpiView, "kind">): string {
  return view.kind === "unknown"
    ? "text-muted-foreground/70 italic"
    : "text-foreground/80";
}

/**
 * The headline chips on a row. Renders nothing while the read is pending or
 * unavailable — the page-level line states that once, and 500 rows repeating
 * "unavailable" would bury the list — and one chip for a unit coord returned no
 * row for.
 */
export function KpiRowChips({ cell }: { cell: KpiCell }) {
  if (cell.kind === "pending" || cell.kind === "unavailable") return null;
  if (cell.kind === "outside") {
    return (
      <span
        className={`hidden xl:inline-flex ${CHIP_BASE} text-muted-foreground/70 italic`}
        data-testid="coord-plan-kpis-outside"
        data-kpi-state={cell.coverageUnknown ? "unknown" : "none"}
        title={cell.sentence}
      >
        {outsideChipText(cell)}
      </span>
    );
  }
  const views = unitColumnViews(cell.unit);
  return (
    <span
      className="hidden xl:inline-flex items-center gap-1.5"
      data-testid="coord-plan-kpis"
      data-kpi-state="unit"
    >
      {KPI_COLUMNS.filter((c) => ROW_KPI_COLUMNS.includes(c.key)).map((col) => {
        const view = views[col.key];
        return (
          <span
            key={col.key}
            className={`${CHIP_BASE} ${tone(view)}`}
            data-testid={`coord-plan-kpi-${col.key}`}
            data-kpi-state={view.kind}
            data-kpi-partial={view.partial ? "true" : undefined}
            data-kpi-reason={view.reason ?? undefined}
            title={kpiTitle(col.label, view)}
          >
            <span className="text-muted-foreground not-italic">
              {col.short}
            </span>
            {view.text}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The full block: every figure of one unit, one line each, in the same
 * `Label: value` shape the row detail already uses for status and difficulty.
 * Pending, unavailable and "coord returned no row for this unit" each say so in
 * words and show no figure.
 */
export function KpiBlock({ cell }: { cell: KpiCell }) {
  if (cell.kind === "pending") {
    return (
      <p
        className="text-xs text-muted-foreground italic"
        data-testid="coord-plan-kpis-pending"
      >
        Reading KPIs…
      </p>
    );
  }
  if (cell.kind === "unavailable") {
    return (
      <p
        className="text-xs text-muted-foreground italic"
        data-testid="coord-plan-kpis-unavailable"
      >
        KPIs unavailable — {cell.reason}. No figures are shown for this work
        unit.
      </p>
    );
  }
  if (cell.kind === "outside") {
    return (
      <p
        className="text-xs text-muted-foreground italic"
        data-testid="coord-plan-kpis-outside-detail"
        data-kpi-state={cell.coverageUnknown ? "unknown" : "none"}
      >
        {cell.sentence}
      </p>
    );
  }
  const { unit } = cell;
  return (
    <div className="text-xs space-y-1" data-testid="coord-plan-kpis-block">
      {unitBlockRows(unit).map((row) => (
        <div
          key={row.id}
          className={row.nested ? "pl-4" : undefined}
          data-testid={`coord-plan-kpi-row-${row.id}`}
          data-kpi-state={row.view.kind}
          data-kpi-partial={row.view.partial ? "true" : undefined}
          data-kpi-reason={row.view.reason ?? undefined}
        >
          <span className="text-muted-foreground">{row.label}: </span>
          <span
            className={
              row.view.kind === "unknown"
                ? "italic text-muted-foreground"
                : "text-foreground/90"
            }
          >
            {row.view.detail}
          </span>
          {row.view.basis && (
            <span className="text-muted-foreground/70">
              {" "}
              — {row.view.basis}
            </span>
          )}
        </div>
      ))}
      <div
        data-testid="coord-plan-kpi-row-interventions-split"
        className="pl-4"
      >
        <span className="text-muted-foreground">Intervention split: </span>
        <span className="text-foreground/90">
          {interventionsSplitText(unit)}
        </span>
      </div>
      <div data-testid="coord-plan-kpi-row-prs">
        <span className="text-muted-foreground">Pull requests: </span>
        <span className="text-foreground/90">{prsText(unit)}</span>
      </div>
    </div>
  );
}

/** The window control. Offers coord's `28d` grammar; sends what it shows. */
export function KpiWindowSelect({
  value,
  onChange,
  "data-testid": testId,
}: {
  value: string;
  onChange: (value: string) => void;
  "data-testid"?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="w-[160px]"
        data-testid={testId}
        aria-label="KPI window"
        title="The window of shipped work units the KPIs are measured over"
      >
        <SelectValue placeholder="KPI window" />
      </SelectTrigger>
      <SelectContent>
        {KPI_WINDOWS.map((w) => (
          <SelectItem key={w.value} value={w.value}>
            {w.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
