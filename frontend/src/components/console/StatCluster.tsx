"use client";

/**
 * StatCluster — an inline row of mono count badges.
 *
 * **Enforces R1 — "Health strip first"**, for the surfaces whose opening
 * signal is a set of counts rather than one traffic-light verdict (a table
 * page, a gates dashboard). See
 * `frontend/docs/console-ui-style-guide.md` §2 R1 and §3.2.
 *
 * Retuned from `gates/_components/SummaryCards.tsx`'s `StatCard` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1. That
 * component renders each count as a `<Card>` with a `text-2xl` number — ten of
 * them cost ~200px of vertical space above the fold to carry ten integers, on
 * a page whose whole point is the rows underneath. This renders the same ten
 * integers as one wrapping line of badges, at the same weight and hue rules
 * the `<HealthStrip>` badge cluster uses, so the two openings are the same
 * visual vocabulary.
 *
 * **`value: null` renders `–`, not `0`** — the same absence-is-not-zero rule
 * `<FilterTabs>` holds for an unfetched tab count (R6). A dashboard that has
 * not received a count yet must not claim there are none.
 *
 * Not yet consumed: `/gates` moves onto it in Phase 3 Wave 4, which is where
 * its `data-testid`s are ported. It ships in Phase 1 because the style guide's
 * primitive catalogue is the artefact later waves are reviewed against, and a
 * catalogue entry with no component is the "pointer to nothing" the plan warns
 * about.
 */

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";

/**
 * Tone. `attention` is the only one that borrows the R3 red, and it means the
 * same thing there as everywhere else: a human must act on what this counts.
 */
export type StatTone =
  | "default"
  | "success"
  | "warning"
  | "attention"
  | "muted";

const TONE_CLASS: Record<StatTone, string> = {
  default: "",
  success: "text-green-300 border-green-500/25",
  warning: "text-amber-200 border-amber-500/30",
  attention: "text-red-200 border-red-500/35",
  muted: "text-muted-foreground",
};

export interface Stat {
  key: string;
  label: string;
  /** `null`/`undefined` = not fetched → renders `–`, never `0`. */
  value: number | string | null | undefined;
  tone?: StatTone;
  title?: string;
  onClick?: () => void;
  "data-testid"?: string;
}

export interface StatClusterProps {
  stats: ReadonlyArray<Stat>;
  className?: string;
  "data-testid"?: string;
}

export function StatCluster({
  stats,
  className,
  "data-testid": testId,
}: StatClusterProps) {
  return (
    <div
      className={className ?? "flex items-center gap-2 flex-wrap"}
      data-testid={testId}
    >
      {stats.map((s) => {
        const badge = (
          <Badge
            variant="outline"
            className={[
              "font-mono text-[11px] tabular-nums",
              TONE_CLASS[s.tone ?? "default"],
              s.onClick ? "cursor-pointer" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={s.title}
            data-testid={s["data-testid"]}
          >
            <span className="text-muted-foreground font-normal">{s.label}</span>
            {s.value == null ? "–" : s.value}
          </Badge>
        );
        return s.onClick ? (
          <button
            key={s.key}
            type="button"
            onClick={s.onClick}
            className="contents"
          >
            {badge}
          </button>
        ) : (
          // A Fragment, not a wrapper: the badge must stay a direct child of
          // the flex cluster so it inherits the gap.
          <Fragment key={s.key}>{badge}</Fragment>
        );
      })}
    </div>
  );
}
