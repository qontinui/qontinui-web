"use client";

/**
 * Spend by month and category, one table per currency, newest month first.
 * Every cell is the server's (`months` in the summary); a scheduled
 * subscription charge is included and marked, and an empty cell is a
 * category with nothing that month — written as a dash, not a zero.
 */

import { formatMicros } from "@/components/overview/money";
import type { MonthCategoryTotal } from "../../_lib/costs-api";
import { toDay } from "../../_lib/timeline";
import { format } from "date-fns";

const UNCATEGORISED = "none";

export function MonthTable({
  months,
  categoryName,
}: {
  months: MonthCategoryTotal[];
  categoryName: (id: string | null) => string | null;
}) {
  if (months.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-ui-bridge-id="overview.costs.months.empty"
      >
        Nothing has been spent yet.
      </p>
    );
  }
  const currencies = [...new Set(months.map((m) => m.currency))];
  return (
    <div className="space-y-8" data-ui-bridge-id="overview.costs.months">
      {currencies.map((currency) => {
        const cells = months.filter((m) => m.currency === currency);
        const monthKeys = [...new Set(cells.map((m) => m.month))]
          .sort()
          .reverse();
        const categoryKeys = [
          ...new Set(cells.map((m) => m.category_id ?? UNCATEGORISED)),
        ].sort((a, b) =>
          (a === UNCATEGORISED ? "~" : (categoryName(a) ?? "")).localeCompare(
            b === UNCATEGORISED ? "~" : (categoryName(b) ?? "")
          )
        );
        const cell = (month: string, category: string) =>
          cells.find(
            (m) =>
              m.month === month && (m.category_id ?? UNCATEGORISED) === category
          );
        const money = (micros: number) =>
          formatMicros(micros, currency, { maximumFractionDigits: 2 });
        return (
          <div
            key={currency}
            className="overflow-x-auto"
            data-ui-bridge-id={`overview.costs.months.${currency}`}
          >
            {currencies.length > 1 && (
              <h3 className="mb-2 text-sm font-medium text-foreground">
                In {currency}
              </h3>
            )}
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Month
                  </th>
                  {categoryKeys.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="py-2 pr-4 text-right font-normal"
                    >
                      {c === UNCATEGORISED
                        ? "No category"
                        : (categoryName(c) ?? "A removed category")}
                    </th>
                  ))}
                  <th scope="col" className="py-2 text-right font-normal">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthKeys.map((month) => {
                  let total = 0;
                  let anyScheduled = false;
                  const day = toDay(month);
                  return (
                    <tr key={month} className="border-b border-border/60">
                      <th
                        scope="row"
                        className="py-2 pr-4 text-left font-normal"
                      >
                        {day ? format(day, "MMM yyyy") : month}
                      </th>
                      {categoryKeys.map((c) => {
                        const found = cell(month, c);
                        if (!found)
                          return (
                            <td
                              key={c}
                              className="py-2 pr-4 text-right text-muted-foreground"
                            >
                              —
                            </td>
                          );
                        const sum =
                          found.recorded_micros + found.scheduled_micros;
                        total += sum;
                        anyScheduled ||= found.scheduled_micros !== 0;
                        return (
                          <td
                            key={c}
                            className="py-2 pr-4 text-right tabular-nums"
                          >
                            {money(sum)}
                            {found.scheduled_micros !== 0 && (
                              <span
                                className="ml-1 text-xs text-muted-foreground"
                                title={`Includes ${money(found.scheduled_micros)} of scheduled subscription charges`}
                              >
                                *
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2 text-right font-medium tabular-nums">
                        {money(total)}
                        {anyScheduled && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            *
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        * includes subscription charges that fell due and were not entered as a
        cost of their own.
      </p>
    </div>
  );
}
