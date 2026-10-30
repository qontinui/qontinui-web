"use client";

/**
 * The per-pass verdict histogram over time — one stacked bar per triage pass,
 * oldest first, for `/admin/coord/overlord/flow`.
 *
 * Built the way the console's other count charts are (`plans/ThroughputPanel`,
 * `spawns/_components/SpawnRateChart`, recorded under the style guide's
 * §3.8): Recharts inside a `CollapsiblePanel`, colours from `@/config/theme`,
 * and the whole series mirrored in a visually-hidden table so every count is
 * reachable without the canvas — and assertable in jsdom, where Recharts'
 * responsive container measures zero.
 *
 * What it says it covers, and what it does not:
 *
 * - **Each bar is one pass's own stored histogram** (coord's
 *   `verdict_series`), so a FILTERED pass (`--only` / `--tab`) is a short bar
 *   because it screened fewer terminals, not because fewer sessions existed.
 *   The caption counts them, and the tooltip and table name each bar's scope.
 *   A scope or mode this build does not recognise is "unknown" there, and the
 *   caption never claims every pass screened every terminal while one is.
 * - **The verdict vocabulary is open** (contract §2), so three verdicts get
 *   categorical slots (`chartCategorical`, fixed order — a slot follows the
 *   verdict, never its rank), UNKNOWN gets its own muted series, and every
 *   other verdict folds into a neutral "other". The tooltip and the table
 *   carry each pass's full breakdown in coord's own words.
 */

import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CollapsiblePanel, absoluteTime } from "@/components/console";
import type { BarShapeProps } from "recharts";
import { chartCategorical, colors } from "@/config/theme";
import {
  CHARTED_VERDICTS,
  OTHER_SERIES,
  UNKNOWN_SERIES,
  insetSegment,
  passWord,
  scopeCounts,
  verdictWords,
  type HistogramPoint,
} from "../_lib/overlordFlowStatus";

/** Series in stack order (bottom first), each with its fixed colour. */
const SERIES: ReadonlyArray<{ key: string; name: string; color: string }> = [
  ...CHARTED_VERDICTS.map((v, i) => ({
    key: v,
    name: verdictWords(v),
    color: chartCategorical[i] ?? colors.text.tertiary,
  })),
  {
    key: OTHER_SERIES,
    name: "every other verdict",
    color: colors.text.tertiary,
  },
  { key: UNKNOWN_SERIES, name: "unknown", color: colors.text.muted },
];

/** `MM-DD HH:MM UTC` — the pass's start, in UTC so a bar is not misplaced. */
function passLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

interface TooltipPayload {
  payload?: HistogramPoint & Record<string, unknown>;
}

function PassTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div
      className="rounded-md border px-2 py-1.5 text-[11px] space-y-0.5"
      style={{
        backgroundColor: colors.surface.raised,
        borderColor: colors.border.default,
      }}
    >
      <div className="font-medium">{passLabel(point.startedAt)}</div>
      <div className="text-muted-foreground">
        {passWord(point.scope)} pass · {passWord(point.mode)} · {point.total}{" "}
        rows
      </div>
      {point.breakdown.map(([verdict, n]) => (
        <div key={verdict} className="font-mono tabular-nums">
          {verdict} {n}
        </div>
      ))}
    </div>
  );
}

export function VerdictHistogramChart({
  points,
  windowWords,
}: {
  /** `null` = the series has not been read (or could not be): nothing is drawn. */
  points: HistogramPoint[] | null;
  windowWords: string;
}) {
  const scopes = points ? scopeCounts(points) : { filtered: 0, unknown: 0 };
  // Recharts reads flat keys, so each bar's counts are spread onto it.
  const data = points?.map((p) => ({ ...p, ...p.counts })) ?? [];
  return (
    <CollapsiblePanel
      title="Verdicts per pass"
      titleAs="h2"
      icon={<BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden />}
      summary={
        <span className="text-xs normal-case tracking-normal text-muted-foreground">
          {points === null
            ? "not read — unknown"
            : `${points.length} ${points.length === 1 ? "pass" : "passes"} in ${windowWords}`}
        </span>
      }
      storageKey="coord-overlord-flow-histogram-open"
      data-testid="overlord-flow-histogram"
    >
      {points === null ? (
        <p
          className="text-sm text-muted-foreground italic m-0"
          data-testid="overlord-flow-histogram-unknown"
        >
          No readable verdict series from coord — the per-pass histogram is
          unknown, not empty.
        </p>
      ) : points.length === 0 ? (
        <p
          className="text-sm text-muted-foreground italic m-0"
          data-testid="overlord-flow-histogram-empty"
        >
          No triage pass recorded in {windowWords} — coord answered, and there
          is nothing to draw.
        </p>
      ) : (
        <div className="space-y-1">
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.border.subtle}
                  vertical={false}
                />
                <XAxis
                  dataKey="startedAt"
                  stroke={colors.text.muted}
                  style={{ fontSize: "10px" }}
                  tickFormatter={(v: unknown) =>
                    typeof v === "string" ? passLabel(v) : ""
                  }
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  stroke={colors.text.muted}
                  style={{ fontSize: "10px" }}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ fill: colors.surface.hover }}
                  content={<PassTooltip />}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                {SERIES.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.name}
                    stackId="verdicts"
                    fill={s.color}
                    maxBarSize={28}
                    isAnimationActive={false}
                    // Stacked fills are separated by a 2px gap and never
                    // touch (dataviz mark spec). The gap is TRANSPARENT, not a
                    // painted stroke: every segment below the bar's top gives
                    // up up to 2px of its own top edge, never shrinking below
                    // 1px (`insetSegment`), so whatever the panel behind the
                    // chart is (a translucent card over the canvas) shows
                    // through, and no stroke colour can mismatch it. The
                    // topmost NON-ZERO segment keeps its full height, so the
                    // bar's total still reads true, and only it gets the
                    // rounded top — whichever verdict it is.
                    shape={(props: BarShapeProps) => {
                      const top =
                        (props.payload as HistogramPoint | undefined)
                          ?.topSeries === s.key;
                      const rect = insetSegment(props.y, props.height, top);
                      return (
                        <Rectangle
                          x={props.x}
                          y={rect.y}
                          width={props.width}
                          height={rect.height}
                          fill={s.color}
                          radius={top ? [2, 2, 0, 0] : 0}
                        />
                      );
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table
            className="sr-only"
            data-testid="overlord-flow-histogram-table"
          >
            <caption>
              Each triage pass in {windowWords}, oldest first, with the count of
              terminals it gave each verdict
            </caption>
            <thead>
              <tr>
                <th scope="col">pass started</th>
                <th scope="col">scope</th>
                <th scope="col">mode</th>
                <th scope="col">rows</th>
                <th scope="col">verdicts</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr
                  key={p.passId}
                  data-testid="overlord-flow-histogram-pass"
                  data-pass-id={p.passId}
                >
                  <th scope="row" title={absoluteTime(p.startedAt)}>
                    {passLabel(p.startedAt)}
                  </th>
                  <td>{passWord(p.scope)}</td>
                  <td>{passWord(p.mode)}</td>
                  <td data-series="total">{p.total}</td>
                  <td data-series="breakdown">
                    {p.breakdown.length === 0
                      ? "no rows"
                      : p.breakdown.map(([v, n]) => `${v} ${n}`).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p
            className="text-[11px] text-muted-foreground m-0"
            data-testid="overlord-flow-histogram-caption"
          >
            One bar per pass, from that pass&apos;s own stored histogram.
            {scopes.filtered > 0 &&
              ` ${scopes.filtered} of the ${points.length} passes were filtered (--only / --tab): their bars are short because they screened fewer terminals, not because fewer sessions existed.`}
            {scopes.unknown > 0 &&
              ` ${scopes.unknown} of the ${points.length} passes sent a scope this page does not know, so whether they screened every terminal is unknown.`}
            {scopes.filtered === 0 &&
              scopes.unknown === 0 &&
              " Every pass shown screened every terminal."}{" "}
            Verdicts other than {CHARTED_VERDICTS.map(verdictWords).join(", ")}{" "}
            and unknown are grouped as &ldquo;every other verdict&rdquo;; hover
            a bar for its full breakdown.
          </p>
        </div>
      )}
    </CollapsiblePanel>
  );
}
