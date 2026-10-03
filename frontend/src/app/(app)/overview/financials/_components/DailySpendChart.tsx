"use client";

/**
 * Daily spend, stacked by vendor, for the summary's window (the last 60
 * days). A day a vendor reported nothing for is a GAP in its stack — the
 * value is `null`, which draws no segment — never a $0 segment; a day no
 * vendor reported is an empty column, and the tooltip says "no data".
 *
 * The same numbers are available as a table (folded away), so identity never
 * rests on colour alone.
 */

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMicros } from "@/components/overview/money";
import { NotAvailable } from "@/components/overview/UnavailableNotes";
import {
  dailyBars,
  formatDay,
  formatShortDay,
  type DailyBar,
} from "../_lib/spend";
import type { SpendSummary, SpendVendor } from "../_lib/spend-api";

const MAX_SERIES = 8;
const OTHER = "__other__";

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  /** Vendor ids drawn under this series ("Other" holds several). */
  vendorIds: string[];
}

/**
 * The series drawn, in a fixed colour order by vendor name so a vendor keeps
 * its colour as others come and go. Only vendors with data in the window are
 * drawn. Past eight, the smallest fold into one "Other" series rather than a
 * generated ninth hue.
 */
export function chartSeries(
  vendors: readonly SpendVendor[],
  bars: readonly DailyBar[]
): ChartSeries[] {
  const totals = new Map<string, number>();
  for (const bar of bars) {
    for (const [id, value] of Object.entries(bar.values)) {
      if (value !== null) totals.set(id, (totals.get(id) ?? 0) + value);
    }
  }
  const drawn = vendors.filter((v) => totals.has(v.id));
  let kept = drawn;
  let folded: SpendVendor[] = [];
  if (drawn.length > MAX_SERIES) {
    const bySize = [...drawn].sort(
      (a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0)
    );
    kept = bySize.slice(0, MAX_SERIES - 1);
    folded = bySize.slice(MAX_SERIES - 1);
  }
  const series: ChartSeries[] = [...kept]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((v, i) => ({
      key: v.id,
      name: v.name,
      color: `var(--spend-series-${i + 1})`,
      vendorIds: [v.id],
    }));
  if (folded.length > 0) {
    series.push({
      key: OTHER,
      name: `Other (${folded.map((v) => v.name).join(", ")})`,
      color: "var(--spend-series-other)",
      vendorIds: folded.map((v) => v.id),
    });
  }
  return series;
}

type ChartRow = { day: string; hasData: boolean } & Record<
  string,
  number | null | string | boolean
>;

function toRows(bars: readonly DailyBar[], series: readonly ChartSeries[]) {
  return bars.map((bar) => {
    const row: ChartRow = { day: bar.day, hasData: bar.hasData };
    for (const s of series) {
      let sum: number | null = null;
      for (const id of s.vendorIds) {
        const value = bar.values[id];
        if (value !== null && value !== undefined) sum = (sum ?? 0) + value;
      }
      // `null`, not 0: recharts draws no segment for it — a gap.
      row[s.key] = sum;
    }
    return row;
  });
}

function money(units: number | null, currency: string): string | null {
  return units === null
    ? null
    : formatMicros(Math.round(units * 1_000_000), currency, {
        maximumFractionDigits: 2,
      });
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  currency,
}: {
  active?: boolean;
  payload?: { payload?: ChartRow }[];
  label?: string | number;
  series: readonly ChartSeries[];
  currency: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{formatDay(String(label ?? row.day))}</p>
      {!row.hasData ? (
        <p className="text-muted-foreground">No data reported for this day</p>
      ) : (
        <ul className="space-y-0.5">
          {series.map((s) => {
            const value = row[s.key] as number | null;
            return (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ background: s.color }}
                />
                <span>{s.name}</span>
                <span className="ml-auto pl-3 tabular-nums">
                  {money(value, currency) ?? "no data"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function DailySpendChart({ summary }: { summary: SpendSummary }) {
  const bars = useMemo(
    () => dailyBars(summary.series, summary.vendors, summary.from, summary.to),
    [summary]
  );
  const series = useMemo(
    () => chartSeries(summary.vendors, bars),
    [summary.vendors, bars]
  );
  const rows = useMemo(() => toRows(bars, series), [bars, series]);
  const gapDays = bars.filter((b) => !b.hasData).length;

  if (series.length === 0) {
    return (
      <p
        className="text-[15px] text-muted-foreground"
        data-ui-bridge-id="overview.costs.daily.empty"
      >
        No provider has reported a daily figure between{" "}
        {formatDay(summary.from)} and {formatDay(summary.to)}. That is not a $0
        period — see the sources below for why.
      </p>
    );
  }

  return (
    <div className="spend-viz" data-ui-bridge-id="overview.costs.daily">
      <div
        className="h-72 w-full"
        role="img"
        aria-label={`Daily spend by provider, ${formatDay(summary.from)} to ${formatDay(summary.to)}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="day"
              tickFormatter={formatShortDay}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) =>
                money(v, summary.currency) ?? String(v)
              }
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.4 }}
              content={
                <ChartTooltip series={series} currency={summary.currency} />
              }
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }}
              iconType="square"
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="spend"
                fill={s.color}
                stroke="var(--background)"
                strokeWidth={1}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {gapDays > 0 && (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-ui-bridge-id="overview.costs.daily.gaps"
        >
          {gapDays === 1 ? "One day has" : `${gapDays} days have`} no reported
          figures and {gapDays === 1 ? "is" : "are"} left empty — not counted as
          $0.
        </p>
      )}
      <details
        className="mt-3 text-sm"
        data-ui-bridge-id="overview.costs.daily.table"
      >
        <summary className="inline-block cursor-pointer select-none rounded-sm py-1.5 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Show as a table
        </summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Day</th>
                {series.map((s) => (
                  <th
                    key={s.key}
                    className="py-1.5 pr-3 text-right font-medium"
                  >
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.day} className="border-b border-border/50">
                  <td className="py-1 pr-3">{formatDay(row.day)}</td>
                  {series.map((s) => {
                    const text = money(
                      row[s.key] as number | null,
                      summary.currency
                    );
                    return (
                      <td
                        key={s.key}
                        className="py-1 pr-3 text-right tabular-nums"
                      >
                        {text ?? <NotAvailable label="no data reported" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
