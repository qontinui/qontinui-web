"use client";

/**
 * CostFigure — the ONLY component that may render a per-task cost (plan
 * `2026-10-23-console-presentation-spaces` D3.1).
 *
 * Served policy `production-and-cost` `per-task-cost-is-a-labelled-equivalent`
 * permits a per-task, per-work-unit or per-PR cost figure only when:
 *
 * 1. every rendering carries "list-price equivalent, not your bill" beside the
 *    number — {@link COST_EQUIVALENT_LABEL}, rendered here and nowhere else;
 * 2. the figure says whether it is the provider's REPORTED cost or a
 *    price-table ESTIMATE — `source`, rendered as "(estimated)", or as
 *    "(source unknown)" when the caller cannot say;
 * 3. an aggregate shows its coverage — `coverage`, the share of tasks whose
 *    cost is known; a task with no usage data is UNKNOWN, never $0 — pass
 *    `amount: null`;
 * 4. cost figures never reach a public surface — so in PRESENTATION mode this
 *    renders a descriptor and never the figure, the label or the coverage.
 *    The amount is not in the DOM at all, not even in an attribute.
 *
 * A presentation mode that is still unresolved withholds too (fail closed).
 * D3.1 layers two more guards on this one: a source scan that fails when a
 * cost renders outside this component, and the rendered-page check in
 * `expectPresentationSafe` (`src/test/presentation.tsx`), which fails on this
 * component's operator-mode figure, on the label, or on any currency figure in
 * a presentation-mode render.
 */

import { cn } from "@/lib/utils";
import { usePresentationMode } from "./PresentationModeProvider";

/** The policy's label, verbatim. */
export const COST_EQUIVALENT_LABEL = "list-price equivalent, not your bill";

/** What presentation mode renders in a cost's place. */
export const COST_WITHHELD_TEXT = "cost not shown";

const COST_WITHHELD_TITLE = "Costs are never shown in presentation mode.";

/** Whether the provider reported the cost or the price table estimated it. */
export type CostSource = "reported" | "estimated";

export interface CostCoverage {
  /** Tasks whose cost is known. `null` when that count is itself unknown. */
  readonly known: number | null;
  /** Tasks in the aggregate. `null` when unknown. */
  readonly total: number | null;
  /** What a task is called here — "sessions", "PRs". Default "tasks". */
  readonly unit?: string;
}

export interface CostFigureProps {
  /** The amount in `currency`. `null`/`undefined`, negative or non-finite → UNKNOWN. */
  amount: number | null | undefined;
  /** `null`/`undefined` when the caller cannot say which it is. */
  source: CostSource | null | undefined;
  /** ISO 4217. Default `"USD"`. */
  currency?: string;
  /** For an aggregate: how much of it the figure covers. */
  coverage?: CostCoverage;
  className?: string;
  "data-testid"?: string;
}

/**
 * The amount as a currency string, or `null` when it is not a figure we can
 * state. Sub-unit amounts keep four decimals, so a real $0.0042 does not
 * render as a fabricated $0.00.
 */
export function formatCostAmount(
  amount: number | null | undefined,
  currency = "USD"
): string | null {
  if (amount === null || amount === undefined) return null;
  if (!Number.isFinite(amount) || amount < 0) return null;
  const maximumFractionDigits = amount !== 0 && amount < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits,
    }).format(amount);
  } catch {
    // An unrecognised currency code: still the caller's figure, plainly.
    return `${amount.toFixed(maximumFractionDigits)} ${currency}`;
  }
}

/** "cost known for 7 of 9 tasks", or why the coverage cannot be stated. */
export function coverageText(coverage: CostCoverage): string {
  const unit = coverage.unit ?? "tasks";
  const { known, total } = coverage;
  const valid = (n: number | null): n is number =>
    n !== null && Number.isInteger(n) && n >= 0;
  if (!valid(known) || !valid(total) || known > total) {
    return `cost coverage of ${unit} unknown`;
  }
  return `cost known for ${known} of ${total} ${unit}`;
}

export function CostFigure({
  amount,
  source,
  currency = "USD",
  coverage,
  className,
  "data-testid": testId,
}: CostFigureProps) {
  const { presenting } = usePresentationMode();
  if (presenting) {
    return (
      <span
        className={cn("text-muted-foreground italic", className)}
        data-testid={testId}
        data-cost-figure="withheld"
        title={COST_WITHHELD_TITLE}
      >
        {COST_WITHHELD_TEXT}
      </span>
    );
  }

  const figure = formatCostAmount(amount, currency);
  return (
    <span
      className={cn("inline-flex flex-wrap items-baseline gap-x-1", className)}
      data-testid={testId}
      data-cost-figure="figure"
      data-cost-source={source ?? "unknown"}
    >
      <span className="font-mono tabular-nums" data-cost-amount="">
        {figure ?? "UNKNOWN"}
      </span>
      {figure !== null && source === "estimated" && (
        <span className="text-xs text-muted-foreground">(estimated)</span>
      )}
      {figure !== null && !source && (
        <span className="text-xs text-muted-foreground">(source unknown)</span>
      )}
      <span className="text-xs text-muted-foreground">
        · {COST_EQUIVALENT_LABEL}
      </span>
      {coverage && (
        <span className="text-xs text-muted-foreground">
          · {coverageText(coverage)}
        </span>
      )}
    </span>
  );
}
