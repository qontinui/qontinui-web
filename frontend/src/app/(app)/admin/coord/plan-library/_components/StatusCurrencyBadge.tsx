import { Badge } from "@/components/ui/badge";
import { resolveStatusCurrency } from "../statusCurrency";
import {
  STATUS_CURRENCY_LABELS,
  type StatusCurrency,
  type StatusCurrencyState,
} from "../types";

/**
 * Badge variant per currency state. Only `fed_in_step` reads as healthy;
 * `unknown` is neutral (`outline`), never a green default.
 */
const CURRENCY_VARIANT: Record<
  StatusCurrencyState,
  "success" | "warning" | "secondary" | "outline"
> = {
  fed_in_step: "success",
  fed_stale_ref: "warning",
  unfed_key: "secondary",
  asserted_once: "secondary",
  unknown: "outline",
};

/**
 * How far a row's `status` can be trusted now — the served `status_currency`,
 * with its own detail as the tooltip. Shared by the plan-library list, the
 * artifact detail panel and `/admin/coord/plan-candidates`, so the three read
 * one vocabulary.
 */
export function StatusCurrencyBadge({
  currency,
  testId = "artifact-row-currency",
}: {
  currency: StatusCurrency | undefined;
  testId?: string;
}) {
  const { state, detail } = resolveStatusCurrency(currency);
  return (
    <Badge
      variant={CURRENCY_VARIANT[state]}
      className="shrink-0 text-[11px]"
      title={detail}
      data-testid={testId}
      data-state={state}
    >
      {STATUS_CURRENCY_LABELS[state]}
    </Badge>
  );
}
