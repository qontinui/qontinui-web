"use client";

/**
 * The facts a reader opens the Costs page for: what the project has spent,
 * what it spent this month, what is paid for and not yet here, and which
 * bills still need their amount.
 *
 * Every figure is the server's (`GET /overview/costs/summary`), one line per
 * currency — currencies are never added together. A total that leaves out a
 * bill whose amount is not known says so, rather than reading as complete.
 */

import { formatMicros } from "@/components/overview/money";
import type { CostSummary, CurrencyTotals } from "../../_lib/costs-api";

function Fact({
  label,
  lines,
  detail,
  uiBridgeId,
}: {
  label: string;
  lines: string[];
  detail?: string | null;
  uiBridgeId: string;
}) {
  return (
    <div data-ui-bridge-id={uiBridgeId}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-overview-serif)] text-xl leading-tight text-foreground sm:text-2xl">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </dd>
      {detail && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

function amounts(
  currencies: CurrencyTotals[],
  pick: (t: CurrencyTotals) => number,
  none: string
): string[] {
  const lines = currencies
    .filter((t) => pick(t) !== 0)
    .map(
      (t) => formatMicros(pick(t), t.currency, { maximumFractionDigits: 2 })!
    );
  return lines.length > 0 ? lines : [none];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function CostHeadline({ summary }: { summary: CostSummary }) {
  const scheduled = summary.currencies.some((t) => t.scheduled_micros !== 0);
  const missing = summary.awaiting_amount_count;
  const spentDetail = [
    scheduled
      ? "Includes subscriptions that fell due and were not entered separately."
      : null,
    missing > 0
      ? `Leaves out ${plural(missing, "bill", "bills")} whose amount is not entered yet.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section data-ui-bridge-id="overview.costs.header">
      <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label="Spent to date"
          lines={amounts(
            summary.currencies,
            (t) => t.spent_to_date_micros,
            "Nothing yet"
          )}
          detail={spentDetail || null}
          uiBridgeId="overview.costs.header.spent"
        />
        <Fact
          label="This month"
          lines={amounts(
            summary.currencies,
            (t) => t.this_month_micros,
            "Nothing yet"
          )}
          uiBridgeId="overview.costs.header.month"
        />
        <Fact
          label="Still to arrive"
          lines={[
            summary.awaiting_delivery_count === 0
              ? "Nothing"
              : plural(summary.awaiting_delivery_count, "item", "items"),
          ]}
          detail={
            summary.awaiting_delivery_count > 0
              ? `Paid: ${amounts(summary.currencies, (t) => t.awaiting_delivery_micros, "—").join(" + ")}`
              : null
          }
          uiBridgeId="overview.costs.header.delivery"
        />
        <Fact
          label="Bills to enter"
          lines={[missing === 0 ? "None" : plural(missing, "bill", "bills")]}
          detail={
            missing > 0
              ? "Recurring costs that vary — enter each period's amount below."
              : null
          }
          uiBridgeId="overview.costs.header.bills"
        />
      </dl>
    </section>
  );
}
