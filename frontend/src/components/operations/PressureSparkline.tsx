"use client";

/**
 * PressureSparkline — a lane's pressure ratio over its sample history.
 *
 * Moved out of `FleetResourceStrip.tsx` (where it was a private component) by
 * plan `2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-
 * has-no-resource-model` Phase 5, because `/admin/coord/computers/[computerId]`
 * draws the same series for the same lanes. A second sparkline beside this one
 * would be exactly the "new visual vocabulary" the console style guide's §6.4
 * forbids (`frontend/docs/console-ui-style-guide.md` §3.5 records the move).
 *
 * It takes POINTS rather than a `HistorySeries` so a caller whose wire shape is
 * not `/fleet/resource-samples`' can feed it; the behaviour below is unchanged.
 *
 * The Y domain is **pinned to [0, 1]**. Auto-scaling would draw a machine flat
 * at 5% and a machine flat at 95% as the same picture — and "spiky vs
 * saturated" is exactly the distinction that decides whether to drain a
 * machine.
 *
 * There is **no threshold reference line**. There used to be one, drawn at a
 * client-side `SATURATED_AT`; the floor coord actually admits on is a byte
 * count on a different column, so it has no honest Y position on a pressure
 * axis. Drawing a line where nothing happens is the same lie as colouring a
 * row from it. The stroke colour carries the server's verdict instead.
 *
 * Null points are gaps (`connectNulls={false}`): a period where the server
 * had no pressure opinion must not be drawn as a straight line between two
 * readings that never met.
 */

import { useMemo } from "react";
import {
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPercent, type RowTone } from "./fleetResources";

/** One point: an instant and the server's pressure ratio then (null = no opinion). */
export interface PressurePoint {
  sampled_at: string;
  pressure: number | null;
}

const SPARK_STROKE: Record<RowTone, string> = {
  ok: "var(--chart-2, #22c55e)",
  warn: "#eab308",
  critical: "#ef4444",
  unknown: "currentColor",
};

export interface PressureSparklineProps {
  points: readonly PressurePoint[] | undefined;
  tone: RowTone;
  /** Defaults keep the Dev Ops strip's frozen testids. */
  "data-testid"?: string;
  emptyTestId?: string;
}

export function PressureSparkline({
  points: rawPoints,
  tone,
  "data-testid": testId = "fleet-resource-sparkline",
  emptyTestId = "fleet-resource-sparkline-empty",
}: PressureSparklineProps) {
  // Time is the X value, not the array index. With index spacing a three-hour
  // publisher outage would draw as one 30-second-wide step between adjacent
  // points — compressing a gap into a slope, which is precisely the "spiky vs
  // saturated" distinction the chart exists to preserve. A numeric axis over
  // real timestamps spaces the outage honestly (and gives the tooltip a real
  // clock time instead of an array index reinterpreted as an epoch).
  const points = useMemo(
    () =>
      (rawPoints ?? []).map((p) => ({
        t: Date.parse(p.sampled_at),
        pressure: p.pressure,
      })),
    [rawPoints]
  );
  const usable = points.filter(
    (p) => p.pressure != null && Number.isFinite(p.t)
  ).length;

  if (usable < 2) {
    return (
      <span
        className="text-[11px] text-muted-foreground italic"
        data-testid={emptyTestId}
      >
        no history
      </span>
    );
  }

  return (
    <div data-testid={testId} className="inline-block">
      <LineChart
        width={120}
        height={28}
        data={points}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <XAxis
          hide
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
        />
        <YAxis hide domain={[0, 1]} />
        <RechartsTooltip
          isAnimationActive={false}
          // Both params are typed `unknown` and narrowed at RUNTIME on
          // purpose. recharts types them loosely (`ValueType`, `ReactNode`),
          // so annotating them as `number | string` would be an assertion
          // about what the library passes rather than a check — and that is
          // precisely how the first version of this tooltip ended up
          // rendering an array index as a wall-clock time.
          formatter={(v: unknown) =>
            typeof v === "number" ? formatPercent(v) : "—"
          }
          labelFormatter={(l: unknown) =>
            typeof l === "number" && Number.isFinite(l)
              ? new Date(l).toLocaleTimeString()
              : "—"
          }
          contentStyle={{
            backgroundColor: "var(--surface-raised)",
            border: "1px solid var(--border-default)",
            borderRadius: "6px",
            fontSize: "11px",
          }}
        />
        <Line
          type="monotone"
          dataKey="pressure"
          stroke={SPARK_STROKE[tone]}
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
