import { Badge } from "@/components/ui/badge";
import {
  STATUS_CURRENCY_LABELS,
  STATUS_CURRENCY_STATES,
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

function isStatusCurrencyState(
  value: string | undefined
): value is StatusCurrencyState {
  return (STATUS_CURRENCY_STATES as readonly string[]).includes(value ?? "");
}

/**
 * The state to render and why. A currency the backend did not serve, or a
 * state this console was not written for, resolves to UNKNOWN with a detail
 * naming which — never to nothing, which would read as "fine".
 */
export function resolveStatusCurrency(currency: StatusCurrency | undefined): {
  state: StatusCurrencyState;
  detail: string | undefined;
} {
  const served: string | undefined = currency?.state;
  const recognised = isStatusCurrencyState(served);
  const state: StatusCurrencyState = recognised ? served : "unknown";
  const detail = !currency
    ? "status currency not served by this backend"
    : !recognised
      ? `unrecognised status currency '${served ?? ""}' — this console predates it`
      : (currency.detail ?? undefined);
  return { state, detail };
}

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
