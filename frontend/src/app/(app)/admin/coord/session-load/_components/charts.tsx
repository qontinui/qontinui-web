"use client";

/**
 * The small charts `/admin/coord/session-load` draws inline: a sparkline and
 * a stacked part-of-a-whole bar, plus the one series palette both share.
 *
 * Inline SVG / flex rather than Recharts, because they sit inside a one-line
 * row (R2) where a responsive container has nothing to measure. Colours come
 * from `@/config/theme`. Neither carries an attention hue: a series colour
 * names a WORK TYPE, never whose move a line is (R3, the share primitives'
 * "the bar is neutral" rule, style guide §3.7). Each is labelled for a screen
 * reader with the numbers it draws, so the values are reachable without the
 * glyph — and assertable in jsdom.
 */

import { colors } from "@/config/theme";

/**
 * Series colours, by rank: the work types holding the most slot-hours get
 * named colours and the rest share {@link OTHER_COLOR}. None is a red, an
 * amber or a green, so no series reads as an attention or "done" signal.
 */
export const SERIES_COLORS: readonly string[] = [
  colors.brand.primary,
  colors.brand.secondary,
  colors.text.secondary,
  colors.text.tertiary,
];
export const OTHER_COLOR = colors.border.strong;

/** Work type → colour, for the given ranking (most slot-hours first). */
export function seriesColorMap(
  rankedWorkTypes: readonly string[]
): Map<string, string> {
  const map = new Map<string, string>();
  rankedWorkTypes.forEach((wt, i) => {
    map.set(wt, SERIES_COLORS[i] ?? OTHER_COLOR);
  });
  return map;
}

export function Sparkline({
  points,
  label,
  width = 96,
  height = 20,
  reference,
  "data-testid": testId,
}: {
  points: readonly { dayMs: number; value: number }[];
  /** What the line is, with its unit — becomes the accessible name. */
  label: string;
  width?: number;
  height?: number;
  /** An optional horizontal reference (a budget), drawn dashed. */
  reference?: number | null;
  "data-testid"?: string;
}) {
  if (points.length === 0) {
    return (
      <span
        className="text-[11px] text-muted-foreground italic whitespace-nowrap"
        data-testid={testId}
        data-points={0}
        title={`${label}: no recorded history yet — unknown, not zero`}
      >
        no history
      </span>
    );
  }
  const values = points.map((p) => p.value);
  const max = Math.max(...values, reference ?? 0, 1e-9);
  const last = values[values.length - 1] ?? 0;
  const x = (i: number) =>
    points.length === 1
      ? width / 2
      : (i / (points.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - (v / max) * (height - 2);
  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`
    )
    .join(" ");
  const summary = `${label}: ${points.length} points, latest ${round(last)}, max ${round(Math.max(...values))}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={summary}
      className="shrink-0"
      data-testid={testId}
      data-points={points.length}
    >
      <title>{summary}</title>
      {reference != null && reference > 0 && (
        <line
          x1={0}
          x2={width}
          y1={y(reference)}
          y2={y(reference)}
          stroke={colors.text.muted}
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      )}
      <path d={d} fill="none" stroke={colors.brand.primary} strokeWidth={1.5} />
    </svg>
  );
}

function round(v: number): string {
  return v < 10 ? String(Number(v.toFixed(1))) : String(Math.round(v));
}

export interface StackSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * A part-of-a-whole bar of slices (slot-hours by work type), with a legend
 * line. An empty set is said in words, never drawn as an empty bar.
 */
export function StackedBar({
  slices,
  unit,
  empty,
  "data-testid": testId,
}: {
  slices: readonly StackSlice[];
  unit: string;
  empty: string;
  "data-testid"?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (slices.length === 0 || total <= 0) {
    return (
      <p
        className="text-xs text-muted-foreground italic m-0"
        data-testid={testId}
      >
        {empty}
      </p>
    );
  }
  return (
    <div className="space-y-1" data-testid={testId}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-sm border border-border"
        role="img"
        aria-label={slices
          .map((s) => `${s.label} ${round(s.value)} ${unit}`)
          .join(", ")}
      >
        {slices.map((s) => (
          <span
            key={s.key}
            style={{
              width: `${(s.value / total) * 100}%`,
              backgroundColor: s.color,
            }}
            title={`${s.label}: ${round(s.value)} ${unit}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground m-0 p-0 list-none">
        {slices.map((s) => (
          <li
            key={s.key}
            className="inline-flex items-center gap-1"
            data-testid={`${testId}-slice`}
          >
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            {s.label} {round(s.value)} {unit}
          </li>
        ))}
      </ul>
    </div>
  );
}
