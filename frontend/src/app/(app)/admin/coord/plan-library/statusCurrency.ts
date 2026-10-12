import {
  STATUS_CURRENCY_STATES,
  type StatusCurrency,
  type StatusCurrencyState,
} from "./types";

function isStatusCurrencyState(
  value: string | undefined
): value is StatusCurrencyState {
  return (STATUS_CURRENCY_STATES as readonly string[]).includes(value ?? "");
}

/**
 * The state to render and why. A currency the backend did not serve, or a
 * state this console was not written for, resolves to UNKNOWN with a detail
 * naming which — never to nothing, which would read as "fine".
 *
 * Pure, so the badge and any page-level tally read one resolution.
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
      ? `unrecognised status currency '${served ?? ""}' — this console predates it${
          currency.detail ? `; served detail: ${currency.detail}` : ""
        }`
      : (currency.detail ?? undefined);
  return { state, detail };
}
