"use client";

/**
 * Work units started / shipped per day, over a chosen range — the
 * corpus-health strip's throughput chart.
 *
 * **Work units, not plans.** coord's aggregate (`work_unit_throughput.rs`
 * `THROUGHPUT_SQL`) counts every work unit in the tenant — plan-shaped or
 * not — so every label here says "work units".
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 4.
 * Every number is coord's server-side aggregate (`throughput.ts` has the
 * contract). Three things this panel must never do:
 *
 * - **Render an absent day as a zero-height bar.** Only days coord returned
 *   a bucket for are on the axis, and within a day a series with no bucket
 *   draws no bar (its value is `undefined`, not `0`).
 * - **Render an empty answer as a flat chart.** It says "no data in this
 *   range" in words.
 * - **Render a failed read as an empty one.** That is UNKNOWN, and a 404 says
 *   the backend does not serve the route.
 *
 * - **Present a held reading as live.** A failed refresh of the same range
 *   keeps the last reading, and says "refresh failed — showing reading from
 *   HH:MM".
 *
 * The bars are mirrored in a visually-hidden table so the readings are
 * reachable without the canvas (and assertable in jsdom, where Recharts'
 * responsive container measures zero).
 */

import { BarChart3 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CollapsiblePanel } from "@/components/console";
import { colors } from "@/config/theme";
import {
  THROUGHPUT_RANGES,
  echoDate,
  type ThroughputReading,
} from "./throughput";
import { clockTime } from "./custody";
import type { ThroughputRefreshFailure } from "./useThroughput";

function summaryText(reading: ThroughputReading, days: number): string {
  switch (reading.state) {
    case "pending":
      return "reading…";
    case "failed":
      return reading.notServed
        ? "not served by this backend — UNKNOWN"
        : "could not be read — UNKNOWN";
    case "unparseable":
      return "unreadable response — UNKNOWN";
    case "empty":
      return `no data in the last ${days} days`;
    case "loaded":
      return `${reading.shippedUnitDays} shipped · ${reading.startedUnitDays} started (work-unit-days, last ${days} days)`;
  }
}

function ThroughputBody({ reading }: { reading: ThroughputReading }) {
  if (reading.state === "pending") {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="coord-plans-throughput-pending"
      >
        Reading coord&apos;s throughput aggregate…
      </p>
    );
  }
  if (reading.state === "failed") {
    return (
      <p
        className="text-xs text-amber-200"
        data-testid="coord-plans-throughput-unknown"
      >
        {reading.notServed
          ? "This backend does not serve the throughput route, so the rate is UNKNOWN — not zero."
          : `coord's throughput could not be read (${reading.reason}). The rate is UNKNOWN — not zero.`}
      </p>
    );
  }
  if (reading.state === "unparseable") {
    return (
      <p
        className="text-xs text-amber-200"
        data-testid="coord-plans-throughput-unknown"
      >
        The throughput response could not be read ({reading.reason}). The rate
        is UNKNOWN — not zero.
      </p>
    );
  }
  if (reading.state === "empty") {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="coord-plans-throughput-empty"
      >
        No data in this range ({echoDate(reading.since)} to{" "}
        {echoDate(reading.until)}, UTC): coord returned no started or shipped
        transition in it.
      </p>
    );
  }
  return (
    <div className="space-y-1" data-testid="coord-plans-throughput-chart">
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={reading.days}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={colors.border.subtle}
            />
            <XAxis
              dataKey="day"
              stroke={colors.text.muted}
              style={{ fontSize: "10px" }}
              tickFormatter={(d: string) => d.slice(5)}
            />
            <YAxis
              allowDecimals={false}
              stroke={colors.text.muted}
              style={{ fontSize: "10px" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: colors.surface.raised,
                border: `1px solid ${colors.border.default}`,
                fontSize: "11px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "11px" }} />
            <Bar
              dataKey="shipped"
              name="shipped / day"
              fill={colors.brand.success}
            />
            <Bar
              dataKey="started"
              name="started / day"
              fill={colors.brand.primary}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only" data-testid="coord-plans-throughput-table">
        <caption>
          Work units started and shipped per UTC day, as coord returned them
        </caption>
        <thead>
          <tr>
            <th scope="col">day</th>
            <th scope="col">shipped</th>
            <th scope="col">started</th>
          </tr>
        </thead>
        <tbody>
          {reading.days.map((d) => (
            <tr key={d.day} data-testid="coord-plans-throughput-day">
              <th scope="row">{d.day}</th>
              <td data-series="shipped">{d.shipped ?? "no bucket"}</td>
              <td data-series="started">{d.started ?? "no bucket"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground">
        UTC days {echoDate(reading.since)} to {echoDate(reading.until)}. A day
        appears only when coord returned a bucket for it — a missing day is not
        a measured zero. Each bar counts distinct work units — every unit in the
        tenant, not only plans — that entered the status that day, so a total is
        work-unit-days, not units.
      </p>
    </div>
  );
}

/** The held-reading marker: a refresh failed and the last reading stands. */
function RefreshFailedNote({ failure }: { failure: ThroughputRefreshFailure }) {
  const at =
    clockTime(new Date(failure.readingAt).toISOString()) ?? "an unknown time";
  return (
    <p
      className="text-xs text-amber-200"
      data-testid="coord-plans-throughput-refresh-failed"
      title={failure.reason}
    >
      refresh failed — showing reading from {at}
    </p>
  );
}

export function ThroughputPanel({
  reading,
  days,
  onDaysChange,
  refreshFailure = null,
}: {
  reading: ThroughputReading;
  days: number;
  onDaysChange: (days: number) => void;
  /** Set when the newest refresh failed and `reading` is the held one. */
  refreshFailure?: ThroughputRefreshFailure | null;
}) {
  const unknown =
    reading.state === "failed" ||
    reading.state === "unparseable" ||
    refreshFailure !== null;
  return (
    <CollapsiblePanel
      title="Throughput"
      titleAs="h3"
      icon={<BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden />}
      summary={
        <span
          className={`text-xs normal-case tracking-normal ${unknown ? "text-amber-200" : "text-muted-foreground"}`}
          data-testid="coord-plans-throughput-summary"
        >
          {summaryText(reading, days)}
          {refreshFailure !== null && " · refresh failed"}
        </span>
      }
      headerActions={
        <Select
          value={String(days)}
          onValueChange={(v) => onDaysChange(Number(v))}
        >
          <SelectTrigger
            className="h-7 w-[130px] text-xs"
            data-testid="coord-plans-throughput-range"
            title="The date range coord aggregates over (UTC days back from today)."
          >
            <SelectValue placeholder="range" />
          </SelectTrigger>
          <SelectContent>
            {THROUGHPUT_RANGES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                last {n} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      storageKey="coord-plans-throughput-open"
      data-testid="coord-plans-throughput"
    >
      {refreshFailure !== null && (
        <RefreshFailedNote failure={refreshFailure} />
      )}
      <ThroughputBody reading={reading} />
    </CollapsiblePanel>
  );
}
