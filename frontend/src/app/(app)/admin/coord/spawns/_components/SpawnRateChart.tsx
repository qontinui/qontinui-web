"use client";

/**
 * Requested per hour against started per hour, over the window — the one
 * chart on `/admin/coord/spawns` (plan
 * `2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration` D7,
 * "actual vs optimal rate").
 *
 * Built the way `plans/ThroughputPanel.tsx` builds the console's other count
 * chart (recorded under the style guide's §3.8): colours from
 * `@/config/theme`, inside a `CollapsiblePanel`, with the series mirrored in a
 * visually-hidden table so the counts are reachable without the canvas — and
 * assertable in jsdom, where Recharts' responsive container measures zero.
 *
 * The series is drawn from the window's request list (`hourlyRates`), so it
 * says what it covers, and what it does not:
 *
 * - **Requests made in the span, and when THOSE started.** A request made
 *   before the span that started inside it is not in the list, so the started
 *   line is not every start in the span — the caption says so rather than
 *   presenting it as a measured start rate.
 * - **The whole window, or less.** When coord truncated the list, the span
 *   begins at the first full UTC hour after the oldest row loaded; earlier
 *   hours are not drawn, never drawn as zeros.
 * - **UTC hours**, labelled as such: the buckets are UTC hours, and a local
 *   label would misplace them in a time zone with a half-hour offset.
 */

import { LineChart as LineChartIcon } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CollapsiblePanel } from "@/components/console";
import { colors } from "@/config/theme";
import type { RateSeries } from "../_lib/spawnStatus";

/** A UTC hour, `MM-DD HH:00 UTC`. */
function hourLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
}

export function SpawnRateChart({
  series,
  windowLabel,
  shown,
  total,
}: {
  /** `null` = the list has not been read (or could not be), so nothing is drawn. */
  series: RateSeries | null;
  windowLabel: string;
  /** Rows loaded, and the window's request count when coord sent one. */
  shown: number | null;
  total: number | null;
}) {
  const active =
    series === null
      ? []
      : series.points.filter((p) => p.requested > 0 || p.started > 0);
  return (
    <CollapsiblePanel
      title="Requested vs started per hour"
      titleAs="h2"
      icon={
        <LineChartIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
      }
      summary={
        <span className="text-xs normal-case tracking-normal text-muted-foreground">
          {series === null
            ? "not read yet — unknown"
            : series.partial
              ? `partial: the ${shown ?? "?"} most recent of ${total ?? "an unknown number of"} requests`
              : windowLabel}
        </span>
      }
      storageKey="coord-spawns-rate-chart-open"
      data-testid="coord-spawns-rate-chart"
    >
      {series === null ? (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-spawns-rate-chart-unknown"
        >
          No request list from coord — the hourly rates are unknown, not zero.
        </p>
      ) : (
        <div className="space-y-1">
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series.points}
                margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.border.subtle}
                />
                <XAxis
                  dataKey="hourMs"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  stroke={colors.text.muted}
                  style={{ fontSize: "10px" }}
                  tickFormatter={(v: unknown) =>
                    typeof v === "number" ? hourLabel(v) : ""
                  }
                />
                <YAxis
                  allowDecimals={false}
                  stroke={colors.text.muted}
                  style={{ fontSize: "10px" }}
                />
                <Tooltip
                  isAnimationActive={false}
                  labelFormatter={(l: unknown) =>
                    typeof l === "number" ? `hour from ${hourLabel(l)}` : ""
                  }
                  contentStyle={{
                    backgroundColor: colors.surface.raised,
                    border: `1px solid ${colors.border.default}`,
                    fontSize: "11px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Line
                  type="stepAfter"
                  dataKey="requested"
                  name="requested / h (optimal: every one started)"
                  stroke={colors.text.tertiary}
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="started"
                  name="of those, started / h"
                  stroke={colors.brand.primary}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only" data-testid="coord-spawns-rate-table">
            <caption>
              Spawn requests made per UTC hour, and how many of those requests
              started in each hour; hours not listed had neither
            </caption>
            <thead>
              <tr>
                <th scope="col">hour</th>
                <th scope="col">requested</th>
                <th scope="col">started</th>
              </tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.hourMs} data-testid="coord-spawns-rate-hour">
                  <th scope="row">{hourLabel(p.hourMs)}</th>
                  <td data-series="requested">{p.requested}</td>
                  <td data-series="started">{p.started}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p
            className="text-[11px] text-muted-foreground m-0"
            data-testid="coord-spawns-rate-caption"
          >
            {series.partial
              ? `Drawn from ${hourLabel(series.fromMs)} only: coord returned the ${shown ?? "?"} most recent of ${total ?? "an unknown number of"} requests in the ${windowLabel}, so earlier hours are not drawn — they are not zero.`
              : `Every UTC hour of the ${windowLabel}.`}{" "}
            Requested per hour is the optimal rate — every request started on
            its first attempt. The started line counts only requests made in
            this span, in the hour each started: a request made earlier that
            started here is not on it, so it is not every start in the span.
          </p>
        </div>
      )}
    </CollapsiblePanel>
  );
}
