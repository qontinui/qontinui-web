"use client";

/**
 * Slot-hours per day demanded, stacked by work type, against the fleet's
 * available slot-hours per day and the {@link TREND_THRESHOLD} line the trend
 * projects a crossing of — the growth section of `/admin/coord/session-load`.
 *
 * Built the way the console's other count charts are (`SpawnRateChart`, style
 * guide §3.8): colours from `@/config/theme`, inside a `CollapsiblePanel`,
 * the series mirrored in a visually-hidden table. It draws only the days the
 * runners recorded IN FULL (`completeGrowthDays`): days before recording
 * began hold only backfilled runs and are left off — not drawn as zeros —
 * and the day holding now is still filling.
 */

import { TrendingUp } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CollapsiblePanel } from "@/components/console";
import { colors } from "@/config/theme";
import {
  TREND_THRESHOLD,
  formatSlotHoursPerDay,
  utcDate,
  workTypeLabel,
  type FleetAvailable,
  type GrowthDay,
} from "../_lib/sessionLoadStatus";
import { OTHER_COLOR } from "./charts";

const OTHER_KEY = "__other__";

export function GrowthChart({
  days,
  rankedWorkTypes,
  colorOf,
  available,
  backfilledDays,
}: {
  /** `null` = growth not read, so nothing is drawn. */
  days: GrowthDay[] | null;
  /** The work types drawn as their own series, most slot-hours first. */
  rankedWorkTypes: readonly string[];
  colorOf: ReadonlyMap<string, string>;
  available: FleetAvailable | null;
  backfilledDays: number;
}) {
  const named = rankedWorkTypes.filter((wt) => colorOf.get(wt) !== OTHER_COLOR);
  const data = (days ?? []).map((d) => {
    const row: Record<string, number> = { dayMs: d.dayMs };
    let other = 0;
    for (const [wt, v] of Object.entries(d.byType)) {
      if (named.includes(wt)) row[wt] = v;
      else other += v;
    }
    row[OTHER_KEY] = other;
    return row;
  });
  const availablePerDay = available?.kind === "known" ? available.perDay : null;
  return (
    <CollapsiblePanel
      title="Slot-hours per day, by work type"
      titleAs="h3"
      icon={
        <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
      }
      summary={
        <span className="text-xs normal-case tracking-normal text-muted-foreground">
          {days === null
            ? "not read yet — unknown"
            : `${days.length} complete UTC day${days.length === 1 ? "" : "s"}`}
        </span>
      }
      defaultOpen
      storageKey="coord-session-load-growth-chart-open"
      data-testid="coord-session-load-growth-chart"
    >
      {days === null ? (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-session-load-growth-chart-unknown"
        >
          No growth series from coord — slot-hours per day are unknown, not
          zero.
        </p>
      ) : days.length === 0 ? (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-session-load-growth-chart-empty"
        >
          No complete day is recorded yet — the per-day demand is unknown, not
          zero.
        </p>
      ) : (
        <div className="space-y-1">
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.border.subtle}
                />
                <XAxis
                  dataKey="dayMs"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  stroke={colors.text.muted}
                  style={{ fontSize: "10px" }}
                  tickFormatter={(v: unknown) =>
                    typeof v === "number" ? utcDate(v).slice(5) : ""
                  }
                />
                <YAxis
                  stroke={colors.text.muted}
                  style={{ fontSize: "10px" }}
                  domain={[
                    0,
                    (max: number) => Math.max(max, availablePerDay ?? 0) * 1.05,
                  ]}
                  label={{
                    value: "slot-h/day",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: "10px", fill: colors.text.muted },
                  }}
                />
                <Tooltip
                  isAnimationActive={false}
                  labelFormatter={(l: unknown) =>
                    typeof l === "number" ? `${utcDate(l)} (UTC)` : ""
                  }
                  formatter={(v: unknown) =>
                    typeof v === "number" ? formatSlotHoursPerDay(v) : String(v)
                  }
                  contentStyle={{
                    backgroundColor: colors.surface.raised,
                    border: `1px solid ${colors.border.default}`,
                    fontSize: "11px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                {named.map((wt) => (
                  <Bar
                    key={wt}
                    dataKey={wt}
                    name={workTypeLabel(wt)}
                    stackId="demand"
                    fill={colorOf.get(wt)}
                    isAnimationActive={false}
                  />
                ))}
                <Bar
                  dataKey={OTHER_KEY}
                  name="every other work type"
                  stackId="demand"
                  fill={OTHER_COLOR}
                  isAnimationActive={false}
                />
                {availablePerDay !== null && (
                  <ReferenceLine
                    y={availablePerDay}
                    stroke={colors.text.tertiary}
                    strokeDasharray="4 3"
                    label={{
                      value: "available",
                      position: "insideTopRight",
                      style: { fontSize: "10px", fill: colors.text.tertiary },
                    }}
                  />
                )}
                {availablePerDay !== null && (
                  <ReferenceLine
                    y={availablePerDay * TREND_THRESHOLD}
                    stroke={colors.text.muted}
                    strokeDasharray="2 3"
                    label={{
                      value: `${Math.round(TREND_THRESHOLD * 100)} %`,
                      position: "insideBottomRight",
                      style: { fontSize: "10px", fill: colors.text.muted },
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <table
            className="sr-only"
            data-testid="coord-session-load-growth-table"
          >
            <caption>
              Slot-hours held per complete UTC day, by work type
            </caption>
            <thead>
              <tr>
                <th scope="col">day (UTC)</th>
                <th scope="col">slot-hours, all work types</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.dayMs} data-testid="coord-session-load-growth-day">
                  <th scope="row">{utcDate(d.dayMs)}</th>
                  <td>{formatSlotHoursPerDay(d.totalSlotHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p
            className="text-[11px] text-muted-foreground m-0"
            data-testid="coord-session-load-growth-caption"
          >
            Each bar is one complete UTC day: the slot-hours its runs held, by
            work type. The dashed lines are the fleet&apos;s available
            slot-hours per day (published configured session budgets × 24) and{" "}
            {Math.round(TREND_THRESHOLD * 100)} % of it.
            {availablePerDay === null
              ? " Available is unknown, so neither line is drawn."
              : ""}
            {backfilledDays > 0
              ? ` ${backfilledDays} earlier day${backfilledDays === 1 ? " holds" : "s hold"} only backfilled runs and ${backfilledDays === 1 ? "is" : "are"} not drawn — incomplete, not zero.`
              : ""}
          </p>
        </div>
      )}
    </CollapsiblePanel>
  );
}
